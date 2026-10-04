// ---------------------------------------------------------------------------
// Delegation of Authority configuration (W6-02 / BRD WF-08, REQ-GATE-05).
//
// Source of truth: the Phase-1 BRD, Workflow - "Delegation of Authority
// routing" with accept criterion "RACI enforced at Gate 1". The Gate-1 decision
// is reserved to the party the ticket band makes accountable (Vertical Head,
// CIO, IC or Board); everyone else is refused, so the RACI matrix is enforced
// rather than documented.
//
// The bands live in configuration so the Investment Committee can retune a
// threshold without a deploy. Reads fall back to the shipped default, so
// nothing changes until an administrator edits it.
//
// Pure functions only - no database, no network. The HTTP route lives in
// server/doa.js.
// ---------------------------------------------------------------------------

import {
  DOA_CONFIG_KEY, DOA_VERSION, DOA_DEFAULT_REVISION, DOA_VERSION_PREFIX, DOA_OWNER,
  DOA_GATE, DOA_GATE_LABEL, DOA_RESPONSIBILITY_CODES, DOA_PARTIES, DOA_PARTY_KEYS,
  DOA_TIERS, DOA_UNSPECIFIED_TIER, DOA_MESSAGES, findDoaParty, doaRoleUniverse,
} from './doaData.js';

export {
  DOA_CONFIG_KEY, DOA_VERSION, DOA_DEFAULT_REVISION, DOA_VERSION_PREFIX, DOA_OWNER,
  DOA_GATE, DOA_GATE_LABEL, DOA_RESPONSIBILITY_CODES, DOA_PARTIES, DOA_PARTY_KEYS,
  DOA_TIERS, DOA_UNSPECIFIED_TIER, DOA_MESSAGES, findDoaParty, doaRoleUniverse,
};

// A stored AppSettings value can arrive as an object or as the JSON string the
// writer persisted. Normalise both before resolving.
function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function normResponsibilities(src = {}, fallback = {}) {
  const out = {};
  for (const key of DOA_PARTY_KEYS) {
    const raw = src[key] !== undefined ? src[key] : fallback[key];
    const value = raw === undefined || raw === null ? '-' : String(raw).trim().toUpperCase();
    out[key] = DOA_RESPONSIBILITY_CODES.includes(value) ? value : '-';
  }
  return out;
}

function normTier(tier = {}, fallback = {}) {
  const min = tier.min_aed !== undefined ? tier.min_aed : fallback.min_aed;
  const max = tier.max_aed !== undefined ? tier.max_aed : fallback.max_aed;
  const roles = Array.isArray(tier.decision_roles) ? tier.decision_roles : fallback.decision_roles;
  return {
    key: tier.key !== undefined ? String(tier.key).trim() : fallback.key,
    label: tier.label !== undefined && String(tier.label).trim() !== '' ? String(tier.label).trim() : fallback.label,
    gate: tier.gate !== undefined ? String(tier.gate).trim() : (fallback.gate || DOA_GATE),
    min_aed: min === null || min === undefined || min === '' ? null : Number(min),
    max_aed: max === null || max === undefined || max === '' ? null : Number(max),
    responsibilities: normResponsibilities(tier.responsibilities || {}, fallback.responsibilities || {}),
    decision_roles: (roles || []).filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()),
    description: tier.description !== undefined ? String(tier.description) : (fallback.description || ''),
  };
}

// The shipped Gate-1 matrix: the four ordered ticket bands plus the size-not-
// captured band, each with the RACI responsibilities and the roles delegated
// the Gate-1 decision. Deterministic so two calls compare equal.
export function defaultDoaConfig() {
  return {
    version: DOA_VERSION,
    revision: DOA_DEFAULT_REVISION,
    source: 'default',
    owner: DOA_OWNER,
    gate: DOA_GATE,
    gate_label: DOA_GATE_LABEL,
    tiers: DOA_TIERS.map((t) => normTier(t, t)),
    unspecified_tier: normTier(DOA_UNSPECIFIED_TIER, DOA_UNSPECIFIED_TIER),
    updated_by: null,
    updated_at: null,
  };
}

// Validate a candidate matrix. Returns { ok, errors } with { key, field,
// message } so the admin editor can point at the offending band.
export function validateDoaConfig(config = {}) {
  const errors = [];
  const push = (field, message, key = null) => errors.push({ key, field, message });

  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', DOA_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  const tiers = Array.isArray(config.tiers) ? config.tiers : [];
  if (!tiers.length) push('tiers', 'At least one ticket band is required.');
  const seen = new Set();
  const ranges = [];
  for (const raw of tiers) {
    if (!raw || typeof raw !== 'object') { push('tiers', 'Each ticket band must be an object.'); continue; }
    const tier = normTier(raw, raw);
    if (!tier.key) { push('key', DOA_MESSAGES.band_invalid); continue; }
    if (seen.has(tier.key)) { push('key', 'Duplicate band key (' + tier.key + ').', tier.key); continue; }
    seen.add(tier.key);
    if (!tier.label) push('label', DOA_MESSAGES.band_invalid, tier.key);
    const min = tier.min_aed;
    const max = tier.max_aed;
    if (min !== null && (!Number.isFinite(min) || min < 0)) {
      push('min_aed', 'The band floor must be a non-negative number.', tier.key);
    }
    if (max !== null && (!Number.isFinite(max) || max <= 0)) {
      push('max_aed', 'The band ceiling must be a positive number.', tier.key);
    }
    if (min !== null && max !== null && !(max > min)) {
      push('max_aed', 'The band ceiling must exceed its floor.', tier.key);
    }
    if (!tier.decision_roles.length) {
      push('decision_roles', DOA_MESSAGES.decision_roles_required, tier.key);
    }
    ranges.push({ key: tier.key, min: min === null ? 0 : min, max: max === null ? Infinity : max });
  }
  // Bands must not overlap (a floor may equal the previous ceiling).
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].min < sorted[i - 1].max) {
      push('tiers', DOA_MESSAGES.band_overlap + ' (' + sorted[i - 1].key + ' / ' + sorted[i].key + ').', sorted[i].key);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Resolve a stored matrix to an effective one, filling any band the store
// omits from the shipped default so a partial store never loses a band.
export function resolveDoaConfig(config = null) {
  const base = defaultDoaConfig();
  config = coerce(config);
  if (!config || typeof config !== 'object') return base;
  const stored = Array.isArray(config.tiers) ? config.tiers : [];
  const byKey = new Map(stored.filter((t) => t && t.key).map((t) => [String(t.key), t]));
  const tiers = base.tiers.map((row) => (byKey.has(row.key) ? normTier(byKey.get(row.key), row) : row));
  for (const s of stored) {
    const key = s && s.key !== undefined ? String(s.key).trim() : '';
    if (!key || base.tiers.some((t) => t.key === key)) continue;
    tiers.push(normTier(s, s));
  }
  return {
    ...base,
    version: config.version || base.version,
    revision: Number.isInteger(config.revision) ? config.revision : base.revision,
    source: config.source || 'stored',
    owner: config.owner || base.owner,
    gate: config.gate || base.gate,
    gate_label: config.gate_label || base.gate_label,
    tiers,
    unspecified_tier: config.unspecified_tier ? normTier(config.unspecified_tier, base.unspecified_tier) : base.unspecified_tier,
    updated_by: config.updated_by || null,
    updated_at: config.updated_at || null,
  };
}

// The field-level diff between two matrices, for the audit trail.
export function diffDoaConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveDoaConfig(before);
  const a = resolveDoaConfig(after);
  const bByKey = new Map(b.tiers.map((t) => [t.key, t]));
  for (const tier of a.tiers) {
    const prev = bByKey.get(tier.key);
    if (!prev) { changes.push({ field: 'tier', key: tier.key, before: null, after: tier.label }); continue; }
    for (const field of ['label', 'gate', 'min_aed', 'max_aed', 'description']) {
      if (JSON.stringify(prev[field]) !== JSON.stringify(tier[field])) {
        changes.push({ field, key: tier.key, before: prev[field], after: tier[field] });
      }
    }
    if (JSON.stringify(prev.responsibilities) !== JSON.stringify(tier.responsibilities)) {
      changes.push({ field: 'responsibilities', key: tier.key, before: prev.responsibilities, after: tier.responsibilities });
    }
    if (JSON.stringify(prev.decision_roles) !== JSON.stringify(tier.decision_roles)) {
      changes.push({ field: 'decision_roles', key: tier.key, before: prev.decision_roles, after: tier.decision_roles });
    }
  }
  return changes;
}

// Build the next matrix revision. Mints revision + 1 and the matching DOA-01.N
// version, recording who changed it and when.
export function buildDoaConfig(body = {}, { actor = null, base = defaultDoaConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveDoaConfig(base);
  const tiersIn = Array.isArray(body.tiers) ? body.tiers : null;
  let tiers = resolvedBase.tiers;
  if (tiersIn) {
    const byKey = new Map(tiersIn.filter((t) => t && t.key).map((t) => [String(t.key), t]));
    tiers = resolvedBase.tiers.map((row) => (byKey.has(row.key) ? normTier(byKey.get(row.key), row) : row));
    for (const s of tiersIn) {
      const key = s && s.key !== undefined ? String(s.key).trim() : '';
      if (!key || resolvedBase.tiers.some((t) => t.key === key)) continue;
      tiers.push(normTier(s, s));
    }
  }
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const next = {
    ...resolvedBase,
    version: DOA_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    owner: body.owner !== undefined && String(body.owner).trim() !== '' ? String(body.owner).trim() : resolvedBase.owner,
    tiers,
    unspecified_tier: body.unspecified_tier ? normTier(body.unspecified_tier, resolvedBase.unspecified_tier) : resolvedBase.unspecified_tier,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateDoaConfig(next);
  if (!ok) {
    const e = new Error(DOA_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    throw e;
  }
  return next;
}

// The band a ticket size falls into. A floor is inclusive and a ceiling
// exclusive, so adjacent bands never both claim a boundary value. An
// uncaptured size resolves to the unspecified band rather than guessing.
export function tierForCommitment(config, amountAed) {
  const resolved = resolveDoaConfig(config);
  // A missing size must never be coerced (Number(null) is 0, which would look
  // like the smallest ticket). Treat null / undefined / '' as uncaptured.
  const missing = amountAed === null || amountAed === undefined || amountAed === '';
  const amount = missing ? NaN : Number(amountAed);
  if (!Number.isFinite(amount)) {
    return { tier: resolved.unspecified_tier, matched: false, amount: null, unknown_size: true };
  }
  const ordered = [...resolved.tiers].sort((a, b) => (a.min_aed ?? 0) - (b.min_aed ?? 0));
  for (const tier of ordered) {
    const min = tier.min_aed === null ? 0 : tier.min_aed;
    const max = tier.max_aed === null ? Infinity : tier.max_aed;
    if (amount >= min && amount < max) return { tier, matched: true, amount, unknown_size: false };
  }
  // Above every ceiling: the most senior band owns it.
  const top = ordered[ordered.length - 1] || resolved.unspecified_tier;
  return { tier: top, matched: true, amount, unknown_size: false, above_all: true };
}

// Resolve the Gate-1 authority for a ticket size against an actor's roles.
// Returns the band, the RACI row, the delegated role set, whether this actor
// may decide and a plain-language reason, so the board can show who owns the
// decision and the API can refuse anyone else.
export function resolveAuthority(config, { amountAed, roles = [], gate = DOA_GATE } = {}) {
  const resolved = resolveDoaConfig(config);
  const match = tierForCommitment(resolved, amountAed);
  const tier = match.tier;
  const roleSet = new Set(Array.isArray(roles) ? roles : []);
  const authorized = tier.decision_roles.some((r) => roleSet.has(r));
  const accountableParty = DOA_PARTIES.find((p) => tier.responsibilities?.[p.key] === 'A') || null;
  const responsibleParty = DOA_PARTIES.find((p) => tier.responsibilities?.[p.key] === 'R') || null;
  let reason;
  if (match.unknown_size) {
    reason = 'The ticket size is not captured, so the standard decision set applies (' + tier.label + ').';
  } else if (authorized) {
    reason = 'Your role is delegated the Gate-1 decision for a ' + tier.label.toLowerCase() + ' ticket (AED ' + match.amount + 'mn).';
  } else {
    const who = tier.decision_roles.length ? tier.decision_roles.join(', ') : 'no configured role';
    reason = 'A ' + tier.label.toLowerCase() + ' ticket (AED ' + match.amount + 'mn) is delegated to: ' + who + '.';
  }
  return {
    gate: gate || resolved.gate,
    gate_label: resolved.gate_label,
    version: resolved.version,
    revision: resolved.revision,
    tier: {
      key: tier.key, label: tier.label, min_aed: tier.min_aed, max_aed: tier.max_aed,
      description: tier.description, responsibilities: tier.responsibilities,
      decision_roles: tier.decision_roles,
    },
    amount_aed: match.amount,
    unknown_size: match.unknown_size === true,
    above_all: match.above_all === true,
    accountable_party: accountableParty ? { key: accountableParty.key, label: accountableParty.label } : null,
    responsible_party: responsibleParty ? { key: responsibleParty.key, label: responsibleParty.label } : null,
    authorized,
    reason,
    disclaimer: DOA_MESSAGES.disclaimer,
  };
}

// The practical Gate-1 role set for a band, ready for a picker or the board.
export function decisionRolesFor(config, amountAed) {
  return tierForCommitment(config, amountAed).tier.decision_roles || [];
}

export default {
  defaultDoaConfig, validateDoaConfig, resolveDoaConfig, diffDoaConfig, buildDoaConfig,
  tierForCommitment, resolveAuthority, decisionRolesFor,
  DOA_CONFIG_KEY, DOA_VERSION,
};
