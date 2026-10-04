import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents, verifyAuditChain, invalidateAuditChainCache, loadAuditChainConfig } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import {
  AUDIT_CHAIN_CONFIG_KEY, AUDIT_CHAIN_MESSAGES, AUDIT_CHAIN_GENESIS,
  defaultAuditChainConfig, validateAuditChainConfig, resolveAuditChainConfig,
  diffAuditChainConfig, buildAuditChainConfig,
} from './config/auditChain.js';

// ---------------------------------------------------------------------------
// Hash-chained, tamper-evident audit (W6-05 / BRD AUD-01).
//
// The chain policy (on/off, algorithm, owner, genesis) lives in configuration
// (AppSettings, setting_key = 'audit_chain_config') so Internal Audit can retune
// it without a deploy; the pure math lives in config/auditChain.js and the
// chaining write path in server/audit.js. This router exposes the effective
// policy to any authenticated user and the verify/apply actions to
// administrators.
// ---------------------------------------------------------------------------

async function persistAuditChainConfig(config, actor) {
  const payload = {
    setting_key: AUDIT_CHAIN_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Hash-chained audit policy (AUD-01)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [AUDIT_CHAIN_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'audit-chain-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export {
  AUDIT_CHAIN_MESSAGES, AUDIT_CHAIN_GENESIS, defaultAuditChainConfig,
  resolveAuditChainConfig, validateAuditChainConfig,
};

export const auditChainRouter = express.Router();

auditChainRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/audit-chain - the effective policy, the shipped default and the
// current chain status (row counts + last verified summary is separate).
auditChainRouter.get('/', async (_req, res) => {
  try {
    const config = await loadAuditChainConfig();
    const { ok, errors } = validateAuditChainConfig(config);
    res.json({
      config,
      defaults: defaultAuditChainConfig(),
      valid: ok,
      errors,
      disclaimer: AUDIT_CHAIN_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/audit-chain - replace the policy and mint a revision (admin).
auditChainRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the audit chain policy' });
    }
    const base = await loadAuditChainConfig();
    const config = buildAuditChainConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffAuditChainConfig(base, config);
    const id = await persistAuditChainConfig(config, req.actor);
    invalidateAuditChainCache();
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'audit_chain_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// POST /api/audit-chain/verify - recompute the chain end to end (admin). Every
// run is itself written to the audit trail so verification is accountable.
auditChainRouter.post('/verify', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to verify the audit chain' });
    }
    const summary = await verifyAuditChain();
    await writeAudit({
      entity: 'audit_event', entityId: null, action: 'audit_chain_verified',
      actor: req.actor, orgId: req.actor.org_id,
      after: { ok: summary.ok, checked: summary.checked, broken_at: summary.broken_at, reason: summary.reason },
      comment: summary.ok ? 'Audit chain verified intact' : 'Audit chain verification FAILED',
    });
    res.json({ ok: summary.ok, summary, message: summary.message });
  } catch (err) { sendErr(res, err); }
});

auditChainRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 100 });
    res.json(events.filter((e) => e.action === 'audit_chain_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default auditChainRouter;
