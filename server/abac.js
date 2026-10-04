import express from 'express';
import crypto from 'node:crypto';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure, isCrossOrgReader } from './rbac.js';
import { writeAudit } from './audit.js';

// ---------------------------------------------------------------------------
// ABAC — attribute-based access control (Policy API).
//
// RBAC (server/rbac.js) decides WHO (role x org) may do WHAT at a stage. ABAC
// adds attribute-level rules: a resource's attributes (e.g. geography, sector,
// commitment band, related-party flag) can further allow or deny an action for
// a subject (role / user / org / group). Rules live in the abac_policy table
// and are managed through /api/abac, enforced on read paths via canRead().
//
// Evaluation order:
//   1. administrators and cross-org readers are always allowed (RBAC short-circuit)
//   2. a matching DENY policy that is not overridden by a higher-priority ALLOW
//      blocks the action
//   3. otherwise the action is allowed
// ---------------------------------------------------------------------------

export const ABAC_RESOURCES = [
  'opportunity', 'company', 'theme', 'document', 'pipeline', 'qa',
  'user', 'org', 'group', 'workflow', 'notification', 'contact', 'scenario', 'analytics',
];

const uuid = () => crypto.randomUUID();

export async function ensureAbacSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS abac_policy (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      subject_type   TEXT NOT NULL,   -- role | user | org | group
      subject_value  TEXT NOT NULL,
      resource   TEXT NOT NULL,
      action     TEXT NOT NULL DEFAULT 'read', -- read | write | delete | approve
      effect     TEXT NOT NULL DEFAULT 'deny', -- allow | deny
      conditions JSONB NOT NULL DEFAULT '{}',   -- attribute predicates
      priority   INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      status     TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS abac_policy_subject_idx ON abac_policy(subject_type, subject_value, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS abac_policy_resource_idx ON abac_policy(resource)');
}

function matchesConditions(conditions, context) {
  for (const [key, expected] of Object.entries(conditions || {})) {
    const actual = context?.[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (typeof expected === 'object' && expected !== null) {
      if (expected.$in && !expected.$in.includes(actual)) return false;
      if (expected.$ne && actual === expected.$ne) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function subjectMatches(actor, policy) {
  const memberships = actor?.memberships || [actor?.membership].filter(Boolean);
  const userId = actor?.id;
  const orgId = actor?.org_id;
  const roles = new Set((actor?.roles || []).flat());
  const groups = new Set((actor?.groups || []).flat());
  switch (policy.subject_type) {
    case 'role': return roles.has(policy.subject_value);
    case 'user': return userId === policy.subject_value;
    case 'org': return orgId === policy.subject_value || (actor?.descendant_ids || []).includes(policy.subject_value);
    case 'group': return groups.has(policy.subject_value);
    default: return false;
  }
}

// Evaluate the ABAC rules for an actor + resource + action + context attributes.
// Returns { allowed, decision, reason, policies }. Administrators short-circuit to
// allow. Deny wins unless overridden by a higher-priority allow with a matching subject.
export async function evaluateAbac(actor, resource, action, context = {}) {
  if (!actor) return { allowed: false, decision: 'deny', reason: 'No actor', policies: [] };
  if (actor.roles?.includes('admin') || actor.roles?.some((r) => isCrossOrgReader(actor.membership))) {
    return { allowed: true, decision: 'allow', reason: 'Administrator / cross-org reader', policies: [] };
  }
  const { rows } = await pool.query(
    `SELECT * FROM abac_policy WHERE resource = $1 AND action = $2 AND status = 'active' ORDER BY priority DESC`,
    [resource, action]
  );
  if (!rows.length) return { allowed: true, decision: 'allow', reason: 'No ABAC policy for resource/action', policies: [] };
  const applicable = rows.filter((p) => subjectMatches(actor, p) && matchesConditions(p.conditions, context));
  if (!applicable.length) return { allowed: true, decision: 'allow', reason: 'No applicable policy', policies: [] };
  const deny = applicable.find((p) => p.effect === 'deny');
  const allow = applicable.find((p) => p.effect === 'allow');
  if (allow && (!deny || allow.priority >= deny.priority)) {
    return { allowed: true, decision: 'allow', reason: 'Matching allow policy at highest priority', policies: applicable };
  }
  return { allowed: false, decision: 'deny', reason: 'Matching deny policy', policies: applicable };
}

// Convenience guard for read paths. Throws a 403 (via next-style error) when the
// ABAC rule denies the resource for the actor.
export async function assertAbacRead(actor, resource, context = {}) {
  return evaluateAbac(actor, resource, 'read', context);
}

export const abacRouter = express.Router();

abacRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

let schemaReady = false;
async function ready() {
  if (!schemaReady) { await ensureAbacSchema(); schemaReady = true; }
}

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/abac/policies — list active policies (admin).
abacRouter.get('/policies', async (req, res) => {
  try {
    await ready();
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const { rows } = await pool.query('SELECT * FROM abac_policy WHERE status = \'active\' ORDER BY resource, priority DESC, name');
    res.json({ resources: ABAC_RESOURCES, policies: rows });
  } catch (err) { sendErr(res, err); }
});

// POST /api/abac/policies — create a rule (admin).
abacRouter.post('/policies', async (req, res) => {
  try {
    await ready();
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const b = req.body || {};
    if (!b.subject_type || !b.subject_value || !b.resource || !b.action || !b.effect) {
      return res.status(400).json({ error: 'subject_type, subject_value, resource, action and effect are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO abac_policy
         (id, name, subject_type, subject_value, resource, action, effect, conditions, priority, description, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) RETURNING *`,
      [uuid(), b.name || (b.resource + ':' + b.action + ':' + b.subject_value),
       b.subject_type, b.subject_value, b.resource, b.action, b.effect,
       JSON.stringify(b.conditions || {}), Number(b.priority || 0), b.description || null, req.actor.email]
    );
    await writeAudit({ entity: 'abac_policy', entityId: rows[0].id, action: 'create', actor: req.actor, after: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) { sendErr(res, err); }
});

// DELETE /api/abac/policies/:id — deactivate a rule (admin, soft delete).
abacRouter.delete('/policies/:id', async (req, res) => {
  try {
    await ready();
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const { rows } = await pool.query(
      `UPDATE abac_policy SET status='deleted', updated_at=now() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Policy not found' });
    await writeAudit({ entity: 'abac_policy', entityId: rows[0].id, action: 'delete', actor: req.actor, before: rows[0] });
    res.json(rows[0]);
  } catch (err) { sendErr(res, err); }
});

// GET /api/abac/check?resource=&action= — evaluate for the current actor.
abacRouter.get('/check', async (req, res) => {
  try {
    await ready();
    const resource = req.query.resource;
    if (!resource) return res.status(400).json({ error: 'resource query param is required' });
    const action = req.query.action || 'read';
    let context = {};
    if (req.query.geography) context.geography = req.query.geography;
    if (req.query.sector) context.sector = req.query.sector;
    if (req.query.commitment_aed) context.commitment_aed = req.query.commitment_aed;
    if (req.query.flag) context.flag = req.query.flag;
    const result = await evaluateAbac(req.actor, resource, action, context);
    res.json({ resource, action, ...result });
  } catch (err) { sendErr(res, err); }
});

export default abacRouter;
