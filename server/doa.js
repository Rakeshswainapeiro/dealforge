import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure, canViewOrg } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  DOA_CONFIG_KEY,
  DOA_MESSAGES,
  DOA_GATE,
  defaultDoaConfig,
  validateDoaConfig,
  resolveDoaConfig,
  diffDoaConfig,
  buildDoaConfig,
  resolveAuthority,
} from './config/doa.js';

// ---------------------------------------------------------------------------
// Delegation of Authority API (W6-02 / BRD WF-08).
//
// The Gate-1 matrix is held in an AppSettings record (setting_key =
// 'doa_config') so the Investment Committee can retune a ticket band without a
// deploy. Reads fall back to the shipped default, so nothing changes until an
// administrator edits it.
//
// The same configuration is read by the pipeline when a Gate-1 decision is
// taken, by the screening board to show who owns the decision, and by the memo,
// so the RACI matrix is enforced in one place.
// ---------------------------------------------------------------------------

export async function loadDoaConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [DOA_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultDoaConfig();
    return resolveDoaConfig(rows[0].setting_value);
  } catch {
    return defaultDoaConfig();
  }
}

async function persistDoaConfig(config, actor) {
  const payload = {
    setting_key: DOA_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Delegation of Authority matrix (Gate 1 ticket bands)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [DOA_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'doa-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

// The Gate-1 authority for one opportunity: its ticket size against the matrix
// and the actor's roles. Used by the pipeline guard and the board read path.
export async function authorityForOpportunity(opportunity, actor, { config } = {}) {
  const cfg = config || await loadDoaConfig();
  const amount = opportunity?.data?.total_commitment_aed ?? opportunity?.total_commitment_aed ?? null;
  return resolveAuthority(cfg, { amountAed: amount, roles: actor?.roles || [], gate: cfg.gate || DOA_GATE });
}

export const doaRouter = express.Router();

doaRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/doa - the effective matrix (any authenticated reader).
doaRouter.get('/', async (_req, res) => {
  try {
    const config = await loadDoaConfig();
    const { ok, errors } = validateDoaConfig(config);
    res.json({
      config,
      defaults: defaultDoaConfig(),
      valid: ok,
      errors,
      disclaimer: DOA_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// POST /api/doa/resolve - resolve the Gate-1 authority for a ticket size and a
// role set (read-only). Body: { amount_aed, roles? }.
doaRouter.post('/resolve', async (req, res) => {
  try {
    const config = await loadDoaConfig();
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : (req.actor.roles || []);
    res.json({ authority: resolveAuthority(config, { amountAed: req.body?.amount_aed, roles, gate: config.gate || DOA_GATE }) });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/doa - replace the matrix and mint a revision (admin-only).
doaRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the Delegation of Authority' });
    }
    const base = await loadDoaConfig();
    const config = buildDoaConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffDoaConfig(base, config);
    const id = await persistDoaConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'doa_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/doa/history - the revision history (audit trail).
doaRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'doa_config_updated'));
  } catch (err) { sendErr(res, err); }
});

// GET /api/doa/opportunities/:id - the Gate-1 authority for one opportunity,
// from its ticket size and the requesting actor's roles.
doaRouter.get('/opportunities/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM entity_record WHERE entity = 'DealOpportunity' AND id = $1 AND deleted = false",
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    const config = await loadDoaConfig();
    const roles = req.actor.roles || [];
    res.json({
      opportunity_id: row.id,
      authority: resolveAuthority(config, { amountAed: row.data?.total_commitment_aed, roles, gate: config.gate || DOA_GATE }),
    });
  } catch (err) { sendErr(res, err); }
});

export default doaRouter;
