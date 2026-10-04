import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  SUFFICIENCY_CONFIG_KEY,
  SUFFICIENCY_MESSAGES,
  defaultSufficiencyConfig,
  validateSufficiencyConfig,
  resolveSufficiencyConfig,
  diffSufficiencyConfig,
  buildSufficiencyConfig,
} from './config/sufficiency.js';

// ---------------------------------------------------------------------------
// Content sufficiency configuration API (W5-03 / BRD DOC-04).
//
// The advisory content sufficiency rule set is held in an AppSettings record
// (setting_key = 'sufficiency_config'). Reads fall back to the shipped default,
// which enables the BRD's example rules, so nothing new is flagged until an
// administrator changes it. Writes require the admin / configurator role and
// mint the next revision.
// ---------------------------------------------------------------------------

export async function loadSufficiencyConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [SUFFICIENCY_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultSufficiencyConfig();
    return resolveSufficiencyConfig(rows[0].setting_value);
  } catch {
    return defaultSufficiencyConfig();
  }
}

async function persistSufficiency(config, actor) {
  const payload = {
    setting_key: SUFFICIENCY_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Content sufficiency check (advisory rules, thresholds and enabled set)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [SUFFICIENCY_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'sufficiency-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const sufficiencyRouter = express.Router();

sufficiencyRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/sufficiency - the effective configuration (any authenticated reader).
sufficiencyRouter.get('/', async (_req, res) => {
  try {
    const config = await loadSufficiencyConfig();
    const { ok, errors } = validateSufficiencyConfig(config);
    res.json({ config, valid: ok, errors, defaults: defaultSufficiencyConfig(), disclaimer: SUFFICIENCY_MESSAGES.disclaimer });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/sufficiency - replace the configuration and mint a revision.
sufficiencyRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the sufficiency configuration' });
    }
    const base = await loadSufficiencyConfig();
    const config = buildSufficiencyConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffSufficiencyConfig(base, config);
    const id = await persistSufficiency(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'sufficiency_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/sufficiency/history - the revision history (audit trail).
sufficiencyRouter.get('/history', async (req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'sufficiency_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default sufficiencyRouter;

