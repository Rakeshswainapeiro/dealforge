import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  SIRIUS_MANDATE_CONFIG_KEY,
  SIRIUS_MANDATE_MESSAGES,
  defaultSiriusMandate,
  validateSiriusMandate,
  resolveSiriusMandate,
  diffSiriusMandate,
  buildSiriusMandate,
} from './config/siriusMandate.js';
import { SIRIUS_MANDATE_INSTRUMENTS, SIRIUS_MANDATE_STAGES } from './config/siriusMandateData.js';

// ---------------------------------------------------------------------------
// Sirius group mandate API (W4-04 / BRD ENT-03).
//
// The versioned group mandate is held in an AppSettings record
// (setting_key = 'sirius_mandate_config'). Reads fall back to the shipped
// mandate (the client brief), so screening always has a mandate in force.
// Writes require the admin / configurator role and mint the next revision.
// ---------------------------------------------------------------------------

export async function loadSiriusMandateConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [SIRIUS_MANDATE_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultSiriusMandate();
    return resolveSiriusMandate(rows[0].setting_value);
  } catch {
    return defaultSiriusMandate();
  }
}

async function persistMandate(config, actor) {
  const payload = {
    setting_key: SIRIUS_MANDATE_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Sirius group mandate (sectors, geographies, stage, instruments, ticket, 1bn-people objective)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [SIRIUS_MANDATE_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'sirius-mandate-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const mandateRouter = express.Router();

mandateRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/mandate - the effective group mandate (any authenticated reader).
mandateRouter.get('/', async (_req, res) => {
  try {
    const config = await loadSiriusMandateConfig();
    const { ok, errors } = validateSiriusMandate(config);
    res.json({
      config, valid: ok, errors, defaults: defaultSiriusMandate(),
      vocabulary: { instruments: SIRIUS_MANDATE_INSTRUMENTS, stages: SIRIUS_MANDATE_STAGES },
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/mandate - replace the mandate and mint a revision.
mandateRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the group mandate' });
    }
    const base = await loadSiriusMandateConfig();
    const config = buildSiriusMandate(req.body || {}, { actor: req.actor, base });
    const changes = diffSiriusMandate(base, config);
    const id = await persistMandate(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'sirius_mandate_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/mandate/history - the revision history (audit trail).
mandateRouter.get('/history', async (req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'sirius_mandate_updated'));
  } catch (err) { sendErr(res, err); }
});

export { SIRIUS_MANDATE_MESSAGES };
export default mandateRouter;
