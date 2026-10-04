import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import {
  AI_GOVERNANCE_SETTING_KEY,
  AI_GOVERNANCE_MESSAGES,
  AI_OUTPUT_LABEL,
  AI_OUTPUT_DISCLAIMER,
  defaultAIGovernanceConfig,
  resolveAIGovernanceConfig,
  validateAIGovernanceConfig,
  buildAIGovernanceConfig,
  diffAIGovernanceConfig,
  redactForLog,
  providerForBase,
  isProviderApproved,
  approvalSummary,
} from './config/aiGovernance.js';
import { buildSecurityPosture } from './config/securityPosture.js';
import { classifyResidency } from './config/residency.js';

// ---------------------------------------------------------------------------
// AI governance (W9-01 / BRD NFR-03).
//
// The governance policy, the provider register and the redaction rules live in
// an AppSettings record (setting_key = 'ai_governance') so the group can tune
// them without a deploy; reads fall back to the shipped default. The router is
// the admin surface for that config and the read surface the AI call path uses
// to decide whether a provider is cleared and how to log the call.
// ---------------------------------------------------------------------------

export async function loadAIGovernanceConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [AI_GOVERNANCE_SETTING_KEY]
    );
    if (!rows[0]?.setting_value) return defaultAIGovernanceConfig();
    return resolveAIGovernanceConfig(rows[0].setting_value);
  } catch {
    return defaultAIGovernanceConfig();
  }
}

async function persistAIGovernanceConfig(config, actor) {
  const payload = {
    setting_key: AI_GOVERNANCE_SETTING_KEY,
    setting_value: JSON.stringify(config),
    description: 'AI governance policy and provider register (NFR-03)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [AI_GOVERNANCE_SETTING_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'ai-governance-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

// Called by the AI call path before a model call. Returns the resolved config
// and whether the configured endpoint's provider is cleared for use. When
// approval is required and missing, `allowed` is false and `reason` explains.
export async function checkAIProvider(baseUrl) {
  const config = await loadAIGovernanceConfig();
  const provider = providerForBase(config, baseUrl);
  const approved = isProviderApproved(config, baseUrl);
  const allowed = !config.require_provider_approval || approved;
  return { config, provider, approved, allowed, reason: allowed ? null : AI_GOVERNANCE_MESSAGES.provider_not_approved };
}

// The log writer shared by the call path: redacts per policy, trims, and writes
// the row. Errors are swallowed so a logging failure never breaks a call.
export async function logLLMCall({ model, baseUrl, prompt, response, error, actor, config } = {}) {
  const policy = resolveAIGovernanceConfig(config);
  const row = {
    model: model || null,
    prompt: policy.log_prompts ? redactForLog(prompt, policy) : null,
    response: policy.log_responses ? redactForLog(response, policy) : null,
    error: error ? String(error).slice(0, 2000) : null,
  };
  try {
    const { rows } = await pool.query(
      'INSERT INTO llm_logs (model, prompt, response, error, actor_email, provider_id, redacted) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [row.model, row.prompt, row.response, row.error, actor?.email || null,
        providerForBase(policy, baseUrl).id, true]
    );
    return rows[0]?.id || null;
  } catch {
    return null;
  }
}

// Delete log rows older than the retention window. Called on a timer by the
// server and available as a one-off for operators. Returns the number removed.
export async function purgeExpiredLLMLogs(config) {
  try {
    const policy = resolveAIGovernanceConfig(config);
    const { rowCount } = await pool.query(
      "DELETE FROM llm_logs WHERE created_at < now() - ($1 || ' days')::interval",
      [String(Number(policy.retention_days) || 365)]
    );
    return rowCount || 0;
  } catch {
    return 0;
  }
}

export const aiGovernanceRouter = express.Router();

aiGovernanceRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/ai-governance - the policy, provider register and approval summary.
// Readable by any authenticated user so the UI can render the AI-output label.
aiGovernanceRouter.get('/', async (req, res) => {
  try {
    const config = await loadAIGovernanceConfig();
    res.json({
      config,
      label: AI_OUTPUT_LABEL,
      disclaimer: AI_OUTPUT_DISCLAIMER,
      approval: approvalSummary(config),
      security_posture: buildSecurityPosture(),
      residency: classifyResidency(),
      can_configure: canConfigure(req.actor.membership),
    });
  } catch (err) { sendErr(res, err); }
});

// GET /api/ai-governance/log - the recent governed AI calls (admin only).
aiGovernanceRouter.get('/log', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: AI_GOVERNANCE_MESSAGES.admin_required });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      'SELECT id, model, provider_id, actor_email, redacted, ' +
        'left(coalesce(prompt, \'\'), 400) AS prompt_preview, ' +
        'left(coalesce(response, \'\'), 400) AS response_preview, error, created_at ' +
        'FROM llm_logs ORDER BY id DESC LIMIT $1',
      [limit]
    );
    res.json({ logs: rows, count: rows.length });
  } catch (err) { sendErr(res, err); }
});

// GET /api/ai-governance/log/status - governed-call roll-up (admin only).
aiGovernanceRouter.get('/log/status', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: AI_GOVERNANCE_MESSAGES.admin_required });
    const { rows } = await pool.query(
      'SELECT count(*)::int AS total, count(error)::int AS with_error, max(created_at) AS last_call_at FROM llm_logs'
    );
    res.json({ status: rows[0] || { total: 0, with_error: 0, last_call_at: null } });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/ai-governance - update the policy / provider register (admin only).
aiGovernanceRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: AI_GOVERNANCE_MESSAGES.admin_required });
    const patch = req.body?.config && typeof req.body.config === 'object' ? req.body.config : req.body || {};
    const check = validateAIGovernanceConfig(patch);
    if (!check.ok) return res.status(400).json({ error: AI_GOVERNANCE_MESSAGES.invalid_policy, errors: check.errors });
    const base = await loadAIGovernanceConfig();
    const next = buildAIGovernanceConfig(patch, { actor: req.actor, base });
    if (Array.isArray(patch.providers)) {
      for (const p of patch.providers) {
        if (p.approval_status === 'approved' && !p.approved_by) p.approved_by = req.actor.email;
        if (p.approval_status === 'approved' && !p.approved_on) p.approved_on = new Date().toISOString().slice(0, 10);
      }
    }
    await persistAIGovernanceConfig(next, req.actor);
    await writeAudit({
      entity: 'ai_governance', entityId: AI_GOVERNANCE_SETTING_KEY, action: 'ai_governance_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: base, after: next,
      comment: diffAIGovernanceConfig(base, next).map((c) => c.field).join(',') || 'no change',
    });
    res.json({ config: next, approval: approvalSummary(next) });
  } catch (err) { sendErr(res, err); }
});

export default aiGovernanceRouter;
