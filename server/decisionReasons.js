import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  DECISION_REASON_CONFIG_KEY,
  DECISION_REASON_MESSAGES,
  defaultDecisionReasonConfig,
  validateDecisionReasonConfig,
  resolveDecisionReasonConfig,
  diffDecisionReasonConfig,
  buildDecisionReasonConfig,
  reasonOptions,
} from './config/decisionReasons.js';

// ---------------------------------------------------------------------------
// Decision reason code API (W6-01 / BRD WF-05).
//
// The catalogue is held in an AppSettings record (setting_key =
// 'decision_reason_config') so the Investment Team can add, relabel or disable
// a reason code without a deploy. Reads fall back to the shipped default, so
// nothing changes until an administrator edits it.
//
// The same configuration is read by both the pipeline (decline / return /
// withdraw) and the workflow route (return / approve) at decision time, so a
// reason code is always checked against the current catalogue.
// ---------------------------------------------------------------------------

export async function loadDecisionReasonConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [DECISION_REASON_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultDecisionReasonConfig();
    return resolveDecisionReasonConfig(rows[0].setting_value);
  } catch {
    return defaultDecisionReasonConfig();
  }
}

async function persistDecisionReasonConfig(config, actor) {
  const payload = {
    setting_key: DECISION_REASON_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Decision reason codes (maintained decision catalogue)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [DECISION_REASON_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'decision-reasons-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const decisionReasonsRouter = express.Router();

decisionReasonsRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/decision-reasons - the effective catalogue (any authenticated reader).
decisionReasonsRouter.get('/', async (_req, res) => {
  try {
    const config = await loadDecisionReasonConfig();
    const { ok, errors } = validateDecisionReasonConfig(config);
    res.json({
      config,
      defaults: defaultDecisionReasonConfig(),
      // Per-class enabled options, so a picker never has to walk the tree.
      options: resolved(config).reduce((acc, cls) => {
        acc[cls.key] = reasonOptions(config, cls.key);
        return acc;
      }, {}),
      valid: ok,
      errors,
      disclaimer: DECISION_REASON_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

function resolved(config) {
  return resolveDecisionReasonConfig(config).classes;
}

// PUT /api/decision-reasons - replace the catalogue and mint a revision.
decisionReasonsRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change decision reason codes' });
    }
    const base = await loadDecisionReasonConfig();
    const config = buildDecisionReasonConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffDecisionReasonConfig(base, config);
    const id = await persistDecisionReasonConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'decision_reason_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/decision-reasons/history - the revision history (audit trail).
decisionReasonsRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'decision_reason_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default decisionReasonsRouter;
