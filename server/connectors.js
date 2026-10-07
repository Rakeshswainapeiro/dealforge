import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure, canViewOrg } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { isReviewer, isAdmin } from './config/workflowStates.js';
import {
  CONNECTORS_CONFIG_KEY, MATURITY_LEVELS, CATEGORIES, EVIDENCE_FIELDS, METHODS, CADENCES, defaultConnectorsConfig,
  resolveConnectorsConfig, validateConnectorsConfig, buildConnectorsConfig, diffConnectorsConfig, connectorMaturity,
  needsConfirmation, mapPayload, validateEvidence, launchUrlFor, seatStatus,
} from './config/connectors.js';

// ---------------------------------------------------------------------------
// Connectors, evidence & provenance, tool launchpad and entitlements
// (BRD v2 INTG-07, INTG-11, INTG-12, EXP-03, ACC-01, ACC-02, ACC-04).
//   /api/connectors   - connector registry (admin edits; reviewers read)
//   /api/evidence     - external values with provenance on an opportunity
//   /api/tools        - launchpad, launches and the entitlement register
// ---------------------------------------------------------------------------

const uuid = () => crypto.randomUUID();
const OPPORTUNITY_ENTITY = 'DealOpportunity';

function httpError(status, message, data) { const e = new Error(message); e.status = status; if (data) e.data = data; return e; }
function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

async function withActor(req, res, next) {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
}

export async function loadConnectorsConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS v FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [CONNECTORS_CONFIG_KEY]
    );
    return resolveConnectorsConfig(rows[0]?.v || null);
  } catch {
    return defaultConnectorsConfig();
  }
}

async function persistConnectorsConfig(config, actor) {
  const payload = { setting_key: CONNECTORS_CONFIG_KEY, setting_value: JSON.stringify(config), description: 'Connector registry (INTG-11)', last_updated_by: actor.email };
  const { rows } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1", [CONNECTORS_CONFIG_KEY]
  );
  if (rows[0]) {
    await pool.query('UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1', [rows[0].id, JSON.stringify(payload), actor.email]);
    return rows[0].id;
  }
  const id = 'connectors-' + Date.now().toString(36);
  await pool.query("INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]);
  return id;
}

async function loadOpportunity(id, actor) {
  const { rows } = await pool.query('SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false', [OPPORTUNITY_ENTITY, id]);
  const row = rows[0];
  if (!row) throw httpError(404, 'Opportunity not found');
  if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    throw httpError(403, 'Not permitted to view this opportunity');
  }
  return row;
}

// External evidence is the investment team's working material.
function requireTeam(actor) {
  if (!isReviewer(actor)) throw httpError(403, 'External evidence is available to the Sirius investment team');
}

function toEvidence(r) {
  return {
    id: r.id, opportunity_id: r.opportunity_id, field: r.field,
    field_label: EVIDENCE_FIELDS.find((f) => f.key === r.field)?.label || r.field,
    value: r.value, source: r.source, source_ref: r.source_ref, method: r.method,
    confidence: r.confidence == null ? null : Number(r.confidence), maturity: r.maturity,
    retrieved_at: r.retrieved_at, recorded_by: r.recorded_by, recorded_at: r.recorded_at,
    status: r.status, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, review_note: r.review_note,
  };
}

export async function addEvidence(opportunityId, input, actor, { config, db = pool } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  requireTeam(actor);
  const cfg = config || await loadConnectorsConfig();
  const v = validateEvidence(input);
  if (!v.ok) throw httpError(400, v.errors.join('; '), { errors: v.errors });
  const connector = cfg.connectors.find((c) => c.key === input.source);
  const method = input.method || (connector ? 'api' : 'manual');
  const maturity = connector ? connectorMaturity(connector) : (method === 'ai' ? 'L3' : 'L1');
  const status = needsConfirmation({ maturity, method }) ? 'proposed' : 'confirmed';
  const value = v.field.type === 'number' ? Number(input.value) : String(input.value);
  const { rows } = await db.query(
    `INSERT INTO evidence_item (id, opportunity_id, owner_org_id, field, value, source, source_ref, method, confidence, maturity, retrieved_at, recorded_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now()),$12,$13) RETURNING *`,
    [uuid(), opp.id, opp.owner_org_id, input.field, JSON.stringify(value), String(input.source).trim(), input.source_ref || null, method,
      input.confidence === undefined || input.confidence === '' ? null : Number(input.confidence), maturity, input.retrieved_at || null, actor.email, status]
  );
  await writeAudit({ entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'evidence_recorded', actor, orgId: opp.owner_org_id,
    after: { evidence_id: rows[0].id, field: input.field, source: input.source, method, maturity, status } });
  return toEvidence(rows[0]);
}

// ---------------------------------------------------------------------------
export const connectorsRouter = express.Router();
connectorsRouter.use(withActor);

connectorsRouter.get('/', async (req, res) => {
  try {
    if (!isReviewer(req.actor) && !canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Sirius investment team or admin only' });
    const config = await loadConnectorsConfig();
    const { ok, errors } = validateConnectorsConfig(config);
    res.json({ config, valid: ok, errors, maturity_levels: MATURITY_LEVELS, categories: CATEGORIES, evidence_fields: EVIDENCE_FIELDS, methods: METHODS, cadences: CADENCES,
      connectors: config.connectors.map((c) => ({ ...c, maturity: connectorMaturity(c) })) });
  } catch (err) { sendErr(res, err); }
});

connectorsRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required to change connectors' });
    const base = await loadConnectorsConfig();
    const config = buildConnectorsConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffConnectorsConfig(base, config);
    const id = await persistConnectorsConfig(config, req.actor);
    await writeAudit({ entity: 'AppSettings', entityId: id, action: 'connectors_updated', actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision }, after: { revision: config.revision, changes } });
    res.json({ ok: true, config, changes });
  } catch (err) { sendErr(res, err); }
});

connectorsRouter.get('/history', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 100 });
    res.json(events.filter((e) => e.action === 'connectors_updated'));
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
export const evidenceRouter = express.Router();
evidenceRouter.use(withActor);

evidenceRouter.get('/opportunities/:id', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    requireTeam(req.actor);
    const { rows } = await pool.query("SELECT * FROM evidence_item WHERE opportunity_id = $1 AND status <> 'rejected' ORDER BY field, retrieved_at DESC", [opp.id]);
    res.json({ opportunity_id: opp.id, items: rows.map(toEvidence), fields: EVIDENCE_FIELDS });
  } catch (err) { sendErr(res, err); }
});

evidenceRouter.post('/opportunities/:id', async (req, res) => {
  try { res.status(201).json(await addEvidence(req.params.id, req.body || {}, req.actor)); } catch (err) { sendErr(res, err); }
});

// A record pulled from a tool, normalised through the connector's field map.
evidenceRouter.post('/opportunities/:id/import', async (req, res) => {
  try {
    const config = await loadConnectorsConfig();
    const connector = config.connectors.find((c) => c.key === req.body?.connector);
    if (!connector) return res.status(404).json({ error: 'Unknown connector' });
    if (!connector.enabled) return res.status(409).json({ error: connector.label + ' is not enabled for data exchange' });
    const { items, unmapped } = mapPayload(connector, req.body?.payload || {});
    if (!items.length) return res.status(422).json({ error: 'Nothing in the payload maps onto an evidence field', unmapped });
    const saved = [];
    for (const item of items) {
      saved.push(await addEvidence(req.params.id, {
        field: item.field, value: item.value, source: connector.key, source_ref: req.body?.source_ref || item.source_field,
        method: req.body?.method || 'api', confidence: req.body?.confidence, retrieved_at: req.body?.retrieved_at,
      }, req.actor, { config }));
    }
    res.status(201).json({ items: saved, unmapped });
  } catch (err) { sendErr(res, err); }
});

async function reviewEvidence(id, decision, note, actor) {
  const { rows } = await pool.query('SELECT * FROM evidence_item WHERE id = $1', [id]);
  const item = rows[0];
  if (!item) throw httpError(404, 'Evidence not found');
  await loadOpportunity(item.opportunity_id, actor);
  requireTeam(actor);
  if (item.status !== 'proposed') throw httpError(409, 'Only a proposed value can be confirmed or rejected');
  if (String(item.recorded_by || '').toLowerCase() === String(actor.email).toLowerCase() && !isAdmin(actor)) {
    throw httpError(403, 'Someone other than the person who recorded it must confirm it');
  }
  const { rows: updated } = await pool.query(
    'UPDATE evidence_item SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE id = $1 RETURNING *',
    [id, decision, actor.email, note || null]
  );
  await writeAudit({ entity: OPPORTUNITY_ENTITY, entityId: item.opportunity_id, action: 'evidence_' + decision, actor, orgId: item.owner_org_id,
    after: { evidence_id: id, field: item.field, source: item.source }, comment: note || null });
  return toEvidence(updated[0]);
}

evidenceRouter.post('/:id/confirm', async (req, res) => {
  try { res.json(await reviewEvidence(req.params.id, 'confirmed', req.body?.note, req.actor)); } catch (err) { sendErr(res, err); }
});
evidenceRouter.post('/:id/reject', async (req, res) => {
  try {
    if (!String(req.body?.note || '').trim()) return res.status(400).json({ error: 'Say why the value is rejected' });
    res.json(await reviewEvidence(req.params.id, 'rejected', req.body.note, req.actor));
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
export const toolsRouter = express.Router();
toolsRouter.use(withActor);

async function entitlementsFor(email) {
  const { rows } = await pool.query('SELECT * FROM tool_entitlement WHERE lower(user_email) = lower($1) AND revoked_at IS NULL', [email]);
  return new Map(rows.map((r) => [r.connector_key, r]));
}

// The launchpad: every tool, with the opportunity in context. Launch is never
// blocked by the portal (ACC-04); the tool applies its own entitlements.
toolsRouter.get('/launchpad', async (req, res) => {
  try {
    const config = await loadConnectorsConfig();
    const opp = req.query.opportunity_id ? await loadOpportunity(String(req.query.opportunity_id), req.actor) : null;
    const seats = await entitlementsFor(req.actor.email);
    res.json({
      opportunity_id: opp?.id || null,
      categories: CATEGORIES,
      tools: config.connectors.map((c) => ({
        key: c.key, label: c.label, category: c.category, maturity: connectorMaturity(c), data_exchange: c.enabled,
        entitled: seats.has(c.key), seat_status: seats.has(c.key) ? seatStatus(seats.get(c.key)) : null,
        launch_url: launchUrlFor(c, { opportunity: opp?.data || null, ssoTemplate: config.sso_launch_template }),
        sso: Boolean(config.sso_launch_template && c.sso_app_id),
      })).filter((t) => t.launch_url),
    });
  } catch (err) { sendErr(res, err); }
});

toolsRouter.post('/:key/launch', async (req, res) => {
  try {
    const config = await loadConnectorsConfig();
    const connector = config.connectors.find((c) => c.key === req.params.key);
    if (!connector) return res.status(404).json({ error: 'Unknown tool' });
    const opp = req.body?.opportunity_id ? await loadOpportunity(String(req.body.opportunity_id), req.actor) : null;
    const seats = await entitlementsFor(req.actor.email);
    const entitled = seats.has(connector.key);
    await pool.query('INSERT INTO tool_launch (id, user_email, connector_key, opportunity_id, entitled) VALUES ($1,$2,$3,$4,$5)',
      [uuid(), req.actor.email, connector.key, opp?.id || null, entitled]);
    if (entitled) await pool.query('UPDATE tool_entitlement SET last_launched_at = now() WHERE id = $1', [seats.get(connector.key).id]);
    res.json({ url: launchUrlFor(connector, { opportunity: opp?.data || null, ssoTemplate: config.sso_launch_template }), entitled,
      note: entitled ? null : 'No seat is recorded for you in the register; the tool will ask you to sign in or request access.' });
  } catch (err) { sendErr(res, err); }
});

toolsRouter.get('/entitlements', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const { rows } = await pool.query(
      `SELECT e.*, (SELECT count(*)::int FROM tool_launch l WHERE l.connector_key = e.connector_key AND lower(l.user_email) = lower(e.user_email)) AS launches
       FROM tool_entitlement e WHERE e.revoked_at IS NULL ORDER BY e.connector_key, e.user_email`
    );
    const items = rows.map((r) => ({ ...r, status: seatStatus(r) }));
    const summary = {};
    for (const r of items) {
      const s = summary[r.connector_key] || (summary[r.connector_key] = { active: 0, dormant: 0 });
      s[r.status] = (s[r.status] || 0) + 1;
    }
    res.json({ items, summary });
  } catch (err) { sendErr(res, err); }
});

toolsRouter.post('/entitlements', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const email = String(req.body?.user_email || '').trim().toLowerCase();
    const key = String(req.body?.connector_key || '').trim();
    const config = await loadConnectorsConfig();
    if (!config.connectors.some((c) => c.key === key)) return res.status(400).json({ error: 'Unknown tool' });
    const { rows: users } = await pool.query('SELECT 1 FROM app_user WHERE lower(email) = $1 AND is_active = true', [email]);
    if (!users.length) return res.status(400).json({ error: 'No active user with that email' });
    const { rows } = await pool.query(
      `INSERT INTO tool_entitlement (id, user_email, connector_key, seat_type, granted_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (lower(user_email), connector_key) WHERE revoked_at IS NULL DO NOTHING RETURNING *`,
      [uuid(), email, key, req.body?.seat_type || 'named', req.actor.email]
    );
    if (!rows[0]) return res.status(409).json({ error: 'That user already holds a seat for this tool' });
    await writeAudit({ entity: 'tool_entitlement', entityId: rows[0].id, action: 'entitlement_granted', actor: req.actor, orgId: req.actor.org_id, after: { user_email: email, connector_key: key } });
    res.status(201).json({ ...rows[0], status: seatStatus(rows[0]) });
  } catch (err) { sendErr(res, err); }
});

toolsRouter.delete('/entitlements/:id', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Administrator role required' });
    const { rows } = await pool.query('UPDATE tool_entitlement SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *', [req.params.id, req.actor.email]);
    if (!rows[0]) return res.status(404).json({ error: 'Seat not found' });
    await writeAudit({ entity: 'tool_entitlement', entityId: rows[0].id, action: 'entitlement_revoked', actor: req.actor, orgId: req.actor.org_id, after: { user_email: rows[0].user_email, connector_key: rows[0].connector_key } });
    res.json({ ok: true });
  } catch (err) { sendErr(res, err); }
});

export default { connectorsRouter, evidenceRouter, toolsRouter };
