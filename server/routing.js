import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure, canViewOrg } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { notify } from './notify.js';
import { onSubmit, withLockedOpportunity } from './lifecycle.js';
import { OPEN_STATES, normalizeState, isReviewer, isAdmin, isProducerFor } from './config/workflowStates.js';
import {
  ROUTING_CONFIG_KEY, ROUTING_FLAGS, ROUTABLE_ROLES, defaultRoutingConfig, resolveRoutingConfig, validateRoutingConfig,
  buildRoutingConfig, diffRoutingConfig, selectRoute, pickLeastLoaded,
} from './config/routingRules.js';

// ---------------------------------------------------------------------------
// Named owner and reviewer routing (BRD v2 WF-02, WF-03).
//
// On submission the opportunity is assigned, inside the submit transaction, a
// named Sirius owner and reviewers by the first matching routing rule. The
// owner can be re-assigned with a reason. Both are audited and notified
// (NTF-01 "assignment"). The rules are configuration, edited by an admin.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
// Roles that may hand an opportunity to another owner (besides its owner).
const REASSIGN_ROLES = ['sirius_vertical_head', 'cio', 'leadership', 'cluster_head'];
// Roles that may own an opportunity (the investment team, not the independent reviewer).
const OWNER_ROLES = ROUTABLE_ROLES.filter((r) => r !== 'independent_reviewer');

function httpError(status, message, data) {
  const e = new Error(message); e.status = status; if (data) e.data = data; return e;
}

export async function loadRoutingConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS v FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [ROUTING_CONFIG_KEY]
    );
    return resolveRoutingConfig(rows[0]?.v || null);
  } catch {
    return resolveRoutingConfig(null);
  }
}

async function persistRoutingConfig(config, actor) {
  const payload = {
    setting_key: ROUTING_CONFIG_KEY, setting_value: JSON.stringify(config),
    description: 'Owner assignment and reviewer routing rules (WF-02, WF-03)', last_updated_by: actor.email,
  };
  const { rows } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [ROUTING_CONFIG_KEY]
  );
  if (rows[0]) {
    await pool.query('UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [rows[0].id, JSON.stringify(payload), actor.email]);
    return rows[0].id;
  }
  const id = 'routing-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

/**
 * Active users holding any of `roles`, with how many open opportunities each
 * owns or reviews: [{ email, full_name, roles, open_count }].
 */
export async function candidatesFor(roles, db = pool) {
  const { rows } = await db.query(
    `SELECT u.email, u.full_name, array_agg(DISTINCT r) AS roles,
       (SELECT count(*)::int FROM entity_record e
          WHERE e.entity = 'DealOpportunity' AND e.deleted = false
            AND (lower(e.data->>'sirius_owner_email') = lower(u.email)
              OR COALESCE(e.data->'assigned_reviewers', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('email', lower(u.email))))
            AND e.data->>'status' = ANY($2)) AS open_count
     FROM app_user u
     JOIN membership m ON m.user_id = u.id
     CROSS JOIN LATERAL unnest(m.roles) AS r
     WHERE u.is_active = true AND r = ANY($1)
     GROUP BY u.email, u.full_name
     ORDER BY u.email`,
    [roles, [...OPEN_STATES, 'submission', 'screening', 'returned']]
  );
  return rows.map((r) => ({ email: r.email.toLowerCase(), full_name: r.full_name, roles: r.roles, open_count: r.open_count }));
}

async function personFor(email, roles, db) {
  if (!email) return null;
  const list = await candidatesFor(roles, db);
  return list.find((c) => c.email === email.toLowerCase()) || null;
}

/**
 * Resolve the owner and reviewers for a record (no write).
 * Returns { owner, reviewers, rule, flags }.
 */
export async function resolveAssignment(row, { config, db = pool } = {}) {
  const cfg = config || await loadRoutingConfig();
  const { rule, flags } = selectRoute(cfg, { ownerOrgId: row.owner_org_id, data: row.data || {} });
  let owner = rule.owner_email ? await personFor(rule.owner_email, OWNER_ROLES, db) : null;
  if (!owner && rule.owner_role) owner = pickLeastLoaded(await candidatesFor([rule.owner_role], db));
  if (!owner && cfg.fallback_owner_role) owner = pickLeastLoaded(await candidatesFor([cfg.fallback_owner_role], db));
  const reviewers = [];
  const add = (p, role) => {
    if (p && p.email !== owner?.email && !reviewers.some((r) => r.email === p.email)) reviewers.push({ email: p.email, name: p.full_name, role });
  };
  for (const email of rule.reviewer_emails || []) add(await personFor(email, ROUTABLE_ROLES, db), null);
  for (const role of rule.reviewer_roles || []) add(pickLeastLoaded(await candidatesFor([role], db)), role);
  return { owner, reviewers, rule: { key: rule.key, label: rule.label }, flags };
}

// --- Submit hook: assign inside the submit transaction ----------------------

onSubmit({
  inTransaction: async ({ client, row, actor }) => {
    const a = await resolveAssignment(row, { db: client });
    const now = new Date().toISOString();
    const patch = {
      sirius_owner_email: a.owner?.email || null,
      sirius_owner_name: a.owner?.full_name || null,
      sirius_owner_assigned_at: a.owner ? now : null,
      sirius_owner_rule: a.rule.key,
      assigned_reviewers: a.reviewers,
      routing_flags: a.flags,
    };
    await writeAudit({
      client, entity: OPPORTUNITY_ENTITY, entityId: row.id, action: a.owner ? 'owner_assigned' : 'owner_unassigned',
      actor, orgId: row.owner_org_id,
      after: { owner: patch.sirius_owner_email, rule: a.rule.key, reviewers: a.reviewers.map((r) => r.email), flags: a.flags },
      comment: a.owner ? 'Assigned by routing rule: ' + a.rule.label : 'No active user holds the routed role; the opportunity is unassigned',
    });
    return patch;
  },
  afterCommit: async ({ row, actor }) => {
    const data = row.data || {};
    const name = data.opportunity_name || row.id;
    if (data.sirius_owner_email) {
      await notify({
        to: data.sirius_owner_email, kind: 'assignment',
        subject: 'Assigned to you: ' + name,
        body: name + ' is in Screening Review and you are the named owner. SLA: decide or request information within the screening window.',
        entity: OPPORTUNITY_ENTITY, entityId: row.id, orgId: row.owner_org_id, actor,
      });
    }
    for (const r of data.assigned_reviewers || []) {
      await notify({
        to: r.email, kind: 'assignment', subject: 'For your review: ' + name,
        body: name + ' has been routed to you for review' + (r.role ? ' (' + r.role.replace(/_/g, ' ') + ')' : '') + '.',
        entity: OPPORTUNITY_ENTITY, entityId: row.id, orgId: row.owner_org_id, actor,
      });
    }
  },
});

/** Re-assign the named owner (WF-02). */
export async function reassignOwner(opportunityId, { email, reason } = {}, actor) {
  const target = String(email || '').trim().toLowerCase();
  const why = String(reason || '').trim();
  if (!target) throw httpError(400, 'Choose the new owner');
  if (why.length < 5) throw httpError(400, 'Give a reason for the re-assignment');
  const result = await withLockedOpportunity(opportunityId, async (client, row) => {
    if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
      throw httpError(403, 'Not permitted to view this opportunity');
    }
    const current = String(row.data?.sirius_owner_email || '').toLowerCase();
    const mayReassign = isAdmin(actor)
      || (isReviewer(actor) && !isProducerFor(actor, row.owner_org_id)
        && ((actor.roles || []).some((r) => REASSIGN_ROLES.includes(r)) || (current && current === String(actor.email).toLowerCase())));
    if (!mayReassign) throw httpError(403, 'Only the current owner or an Investment Team lead can re-assign this opportunity');
    const state = normalizeState(row.data?.status);
    if (!OPEN_STATES.includes(state)) throw httpError(409, 'Only an opportunity with Sirius can be re-assigned (it is ' + state.replace(/_/g, ' ') + ')', { state });
    const person = await personFor(target, OWNER_ROLES, client);
    if (!person) throw httpError(422, target + ' is not an active member of the Sirius investment team');
    if (person.email === current) throw httpError(409, 'That person already owns this opportunity');
    const patch = { sirius_owner_email: person.email, sirius_owner_name: person.full_name, sirius_owner_assigned_at: new Date().toISOString(), sirius_owner_rule: 'manual' };
    await client.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(patch), actor.email]
    );
    await writeAudit({
      client, entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'owner_reassigned', actor, orgId: row.owner_org_id,
      before: { owner: current || null }, after: { owner: person.email }, comment: why,
    });
    return { row, person, previous: current || null };
  });
  const name = result.row.data?.opportunity_name || result.row.id;
  await notify({
    to: result.person.email, kind: 'assignment', subject: 'Re-assigned to you: ' + name,
    body: (actor.full_name || actor.email) + ' re-assigned ' + name + ' to you. Reason: ' + why,
    entity: OPPORTUNITY_ENTITY, entityId: result.row.id, orgId: result.row.owner_org_id, actor,
  }).catch((err) => console.warn('[routing] notify failed:', err.message));
  return { ok: true, opportunity_id: result.row.id, owner_email: result.person.email, owner_name: result.person.full_name, previous_owner_email: result.previous };
}

// ---------------------------------------------------------------------------
// HTTP routes - /api/routing
// ---------------------------------------------------------------------------
export const routingRouter = express.Router();

routingRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

routingRouter.get('/', async (_req, res) => {
  try {
    const config = await loadRoutingConfig();
    const { ok, errors } = validateRoutingConfig(config);
    res.json({ config, defaults: defaultRoutingConfig(), valid: ok, errors, flags: ROUTING_FLAGS, roles: ROUTABLE_ROLES });
  } catch (err) { sendErr(res, err); }
});

routingRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required to change the routing rules' });
    const base = await loadRoutingConfig();
    const config = buildRoutingConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffRoutingConfig(base, config);
    const id = await persistRoutingConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'routing_rules_updated', actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision }, after: { revision: config.revision, changes },
    });
    res.json({ ok: true, config, changes });
  } catch (err) { sendErr(res, err); }
});

routingRouter.get('/history', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership) && !isReviewer(req.actor)) return res.status(403).json({ error: 'Not permitted' });
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 100 });
    res.json(events.filter((e) => e.action === 'routing_rules_updated'));
  } catch (err) { sendErr(res, err); }
});

// The people who can own an opportunity, with their open load (for the
// re-assign picker). Sirius team only.
routingRouter.get('/owners', async (req, res) => {
  try {
    if (!isReviewer(req.actor)) return res.status(403).json({ error: 'Sirius investment team only' });
    res.json({ owners: await candidatesFor(OWNER_ROLES) });
  } catch (err) { sendErr(res, err); }
});

// Which rule, owner and reviewers an opportunity would get (no write).
routingRouter.get('/preview/:id', async (req, res) => {
  try {
    if (!isReviewer(req.actor) && !canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Sirius investment team only' });
    const { rows } = await pool.query("SELECT * FROM entity_record WHERE entity = 'DealOpportunity' AND id = $1 AND deleted = false", [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    res.json(await resolveAssignment(row));
  } catch (err) { sendErr(res, err); }
});

routingRouter.post('/opportunities/:id/owner', async (req, res) => {
  try {
    res.json(await reassignOwner(req.params.id, req.body || {}, req.actor));
  } catch (err) { sendErr(res, err); }
});

export default routingRouter;
