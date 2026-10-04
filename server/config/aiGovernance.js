// ---------------------------------------------------------------------------
// AI governance (W9-01 / BRD NFR-03).
//
// The platform can call an OpenAI-compatible model for deal analysis. NFR-03
// requires that this is governed: prompts and outputs are logged, model output
// is labelled as AI-generated, and a provider is approved in writing before it
// is used. This module owns the policy, the provider register and the small
// pure helpers the router and the LLM call path share. It is intentionally
// dependency-free so the governance rules are auditable in one file.
// ---------------------------------------------------------------------------

export const AI_GOVERNANCE_VERSION = 'NFR-03.1';
export const AI_GOVERNANCE_SETTING_KEY = 'ai_governance';

// The label attached to any model output and the caveat that must travel with
// it. Kept short enough to render as a badge with the detail on hover.
export const AI_OUTPUT_LABEL = 'AI-generated';
export const AI_OUTPUT_DISCLAIMER =
  'AI-generated. Decision support only; it may be incomplete or wrong and must be reviewed by a qualified person before it is relied on.';

export const AI_PROVIDER_APPROVAL_STATUSES = ['approved', 'pending', 'rejected'];

// Provider register. Approval is recorded with an approver and a date so the
// evidence for "provider approved in writing" lives with the config. A self-
// hosted provider is approved by default because no data leaves the boundary.
export const AI_DEFAULT_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    approval_status: 'pending',
    data_residency: 'US (OpenAI-operated)',
    approved_by: null,
    approved_on: null,
    notes: 'Record a written approval before this provider is used for screening.',
  },
  {
    id: 'azure_openai',
    label: 'Azure OpenAI',
    approval_status: 'pending',
    data_residency: 'Selectable region (includes UAE North)',
    approved_by: null,
    approved_on: null,
    notes: '',
  },
  {
    id: 'localai',
    label: 'LocalAI / self-hosted',
    approval_status: 'approved',
    data_residency: 'On-premises (UAE)',
    approved_by: 'platform',
    approved_on: '2026-09-01',
    notes: 'No data leaves the platform boundary; approved by default.',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    approval_status: 'pending',
    data_residency: 'Unknown',
    approved_by: null,
    approved_on: null,
    notes: '',
  },
];

// The governance policy. Every field is a switch an operator can read from the
// resolved config; the defaults are the conservative ones the BRD asks for.
export const AI_GOVERNANCE_POLICY = {
  log_prompts: true,
  log_responses: true,
  redact_emails: true,
  redact_secrets: true,
  label_ai_output: true,
  require_provider_approval: true,
  human_review_required: true,
  retention_days: 365,
  log_max_chars: 20_000,
};

export const AI_GOVERNANCE_MESSAGES = {
  admin_required: 'Administrator role required to change AI governance',
  provider_unknown: 'Unknown AI provider',
  status_invalid: 'Unknown provider approval status',
  provider_not_approved:
    'AI provider is not approved for use. Record a written approval in Settings before enabling model calls.',
  invalid_policy: 'AI governance policy is invalid',
};

// The built-in, unedited policy for a deployment that has never saved one.
export function defaultAIGovernanceConfig() {
  return {
    version: AI_GOVERNANCE_VERSION,
    revision: 1,
    source: 'default',
    ...AI_GOVERNANCE_POLICY,
    providers: AI_DEFAULT_PROVIDERS.map((p) => ({ ...p })),
    updated_by: null,
    updated_at: null,
  };
}

// Coerce a stored value (string or object) back into a usable config, falling
// back to the default for anything missing or malformed.
export function resolveAIGovernanceConfig(stored) {
  let value = stored;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (!value || typeof value !== 'object') return defaultAIGovernanceConfig();
  const base = defaultAIGovernanceConfig();
  const providers = Array.isArray(value.providers) && value.providers.length
    ? value.providers.map((p) => ({
        id: String(p.id || 'custom'),
        label: String(p.label || p.id || 'custom'),
        approval_status: AI_PROVIDER_APPROVAL_STATUSES.includes(p.approval_status) ? p.approval_status : 'pending',
        data_residency: p.data_residency || 'Unknown',
        approved_by: p.approved_by || null,
        approved_on: p.approved_on || null,
        notes: p.notes || '',
      }))
    : base.providers;
  return {
    ...base,
    ...value,
    providers,
    source: value.source === 'stored' ? 'stored' : base.source,
  };
}

export function validateAIGovernanceConfig(input) {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['policy must be an object'] };
  const errors = [];
  for (const key of ['log_prompts', 'log_responses', 'redact_emails', 'redact_secrets',
    'label_ai_output', 'require_provider_approval', 'human_review_required']) {
    if (key in input && typeof input[key] !== 'boolean') errors.push(key + ' must be a boolean');
  }
  if ('retention_days' in input) {
    const n = Number(input.retention_days);
    if (!Number.isFinite(n) || n < 1 || n > 3650) errors.push('retention_days must be between 1 and 3650');
  }
  if ('log_max_chars' in input) {
    const n = Number(input.log_max_chars);
    if (!Number.isFinite(n) || n < 100 || n > 200_000) errors.push('log_max_chars must be between 100 and 200000');
  }
  if ('providers' in input) {
    if (!Array.isArray(input.providers)) errors.push('providers must be an array');
    else for (const p of input.providers) {
      if (!p || typeof p !== 'object') { errors.push('each provider must be an object'); continue; }
      if (p.approval_status && !AI_PROVIDER_APPROVAL_STATUSES.includes(p.approval_status)) {
        errors.push('unknown approval status for provider ' + (p.id || '?'));
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// Merge an admin patch onto the current config, mint a revision and record who
// changed it. Only governance fields and the provider register are writable.
export function buildAIGovernanceConfig(patch = {}, { actor, base, at } = {}) {
  const prior = resolveAIGovernanceConfig(base);
  const next = { ...prior };
  for (const key of ['log_prompts', 'log_responses', 'redact_emails', 'redact_secrets',
    'label_ai_output', 'require_provider_approval', 'human_review_required']) {
    if (key in patch) next[key] = Boolean(patch[key]);
  }
  if ('retention_days' in patch) next.retention_days = Number(patch.retention_days);
  if ('log_max_chars' in patch) next.log_max_chars = Number(patch.log_max_chars);
  if (Array.isArray(patch.providers)) next.providers = patch.providers;
  next.revision = (Number(prior.revision) || 1) + 1;
  next.version = AI_GOVERNANCE_VERSION;
  next.source = 'stored';
  next.updated_by = actor?.email || null;
  next.updated_at = at || new Date().toISOString();
  return next;
}

export function diffAIGovernanceConfig(before, after) {
  const a = resolveAIGovernanceConfig(before);
  const b = resolveAIGovernanceConfig(after);
  const changes = [];
  for (const key of Object.keys(a)) {
    if (key === 'providers' || key === 'version' || key === 'revision' || key === 'updated_by' || key === 'updated_at') continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes.push({ field: key, before: a[key], after: b[key] });
  }
  if (JSON.stringify(a.providers) !== JSON.stringify(b.providers)) {
    changes.push({ field: 'providers', before: a.providers, after: b.providers });
  }
  return changes;
}

// Redact secrets and personal data before a prompt or response is written to
// the log, then cap it to the policy length so a single call cannot bloat the
// store. The raw values are never persisted when redaction is on.
export function redactForLog(text, policy = AI_GOVERNANCE_POLICY) {
  let out = String(text === undefined || text === null ? '' : text);
  if (policy.redact_secrets !== false) {
    out = out.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [redacted]');
    out = out.replace(/\b(sk|pk|rk)[-_][A-Za-z0-9]{12,}\b/g, '[redacted-key]');
    out = out.replace(/\b(api[_-]?key|apikey|token|secret|password)\s*[:=]\s*["']?[^\s"',}]{6,}/gi, '$1=[redacted]');
  }
  if (policy.redact_emails !== false) {
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]');
  }
  const cap = Number(policy.log_max_chars) || 20_000;
  return out.length > cap ? out.slice(0, cap) : out;
}

// Map a configured base URL to a provider register id so an approval can be
// enforced. Unknown endpoints fall back to the 'custom' entry.
export function providerIdForBase(baseUrl) {
  const base = String(baseUrl || '').toLowerCase();
  if (!base) return 'custom';
  if (base.includes('openai.azure.com') || base.includes('azure')) return 'azure_openai';
  if (base.includes('api.openai.com') || base.includes('openai.com')) return 'openai';
  if (base.includes('localhost') || base.includes('127.0.0.1') || base.includes('localai') || base.includes('ollama') || base.includes('lmstudio')) return 'localai';
  return 'custom';
}

export function providerForBase(config, baseUrl) {
  const cfg = resolveAIGovernanceConfig(config);
  const id = providerIdForBase(baseUrl);
  return cfg.providers.find((p) => p.id === id) || { id, label: id, approval_status: 'pending' };
}

export function isProviderApproved(config, baseUrl) {
  const provider = providerForBase(config, baseUrl);
  return provider.approval_status === 'approved';
}

// Roll-up for the settings/console surface: how many providers are approved and
// whether the platform is cleared to use a model at all.
export function approvalSummary(config) {
  const cfg = resolveAIGovernanceConfig(config);
  const approved = cfg.providers.filter((p) => p.approval_status === 'approved');
  return {
    total: cfg.providers.length,
    approved: approved.length,
    pending: cfg.providers.filter((p) => p.approval_status === 'pending').length,
    rejected: cfg.providers.filter((p) => p.approval_status === 'rejected').length,
    approved_ids: approved.map((p) => p.id),
  };
}

export default {
  AI_GOVERNANCE_VERSION,
  AI_GOVERNANCE_SETTING_KEY,
  AI_OUTPUT_LABEL,
  AI_OUTPUT_DISCLAIMER,
  AI_GOVERNANCE_POLICY,
  AI_DEFAULT_PROVIDERS,
  defaultAIGovernanceConfig,
  resolveAIGovernanceConfig,
  validateAIGovernanceConfig,
  buildAIGovernanceConfig,
  diffAIGovernanceConfig,
  redactForLog,
  providerIdForBase,
  providerForBase,
  isProviderApproved,
  approvalSummary,
};
