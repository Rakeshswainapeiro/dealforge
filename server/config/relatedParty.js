// ---------------------------------------------------------------------------
// Related-party / affiliate overlay configuration (W6-03 / BRD WF-06, REQ-RPT-01).
//
// Source of truth: the Phase-1 BRD, Workflow - "Related-party / affiliate
// overlay" with accept criteria "case cannot reach the Screening Decision
// without an independent sign-off" and "conflicted users are ineligible".
//
// The overlay turns the related-party flag (E9.5) into an enforced governance
// gate on the Gate-1 Screening Decision:
//
//   * a flagged deal needs a written arm's-length basis and evidence before an
//     independent sign-off can be given;
//   * only a role the configuration delegates may sign off;
//   * no one conflicted with the deal (the preparer, or anyone the review names
//     as conflicted) may sign off or take the Screening Decision.
//
// The rule set lives in configuration so Group Compliance can retune it without
// a deploy. Reads fall back to the shipped default, so nothing changes until an
// administrator edits it.
//
// Pure functions only - no database, no network. The HTTP route lives in
// server/relatedParty.js.
// ---------------------------------------------------------------------------

import {
  RELATED_PARTY_CONFIG_KEY, RELATED_PARTY_VERSION, RELATED_PARTY_VERSION_PREFIX,
  RELATED_PARTY_DEFAULT_REVISION, RELATED_PARTY_OWNER, RELATED_PARTY_GATE,
  RELATED_PARTY_GATE_LABEL, RELATED_PARTY_STATUSES, RELATED_PARTY_STATUS_LABELS,
  ARM_LENGTH_BASES, ARM_LENGTH_BASIS_KEYS, DEFAULT_SIGNOFF_ROLES, RELATED_PARTY_MESSAGES,
} from './relatedPartyData.js';

export {
  RELATED_PARTY_CONFIG_KEY, RELATED_PARTY_VERSION, RELATED_PARTY_VERSION_PREFIX,
  RELATED_PARTY_DEFAULT_REVISION, RELATED_PARTY_OWNER, RELATED_PARTY_GATE,
  RELATED_PARTY_GATE_LABEL, RELATED_PARTY_STATUSES, RELATED_PARTY_STATUS_LABELS,
  ARM_LENGTH_BASES, ARM_LENGTH_BASIS_KEYS, DEFAULT_SIGNOFF_ROLES, RELATED_PARTY_MESSAGES,
};

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

const normEmail = (v) => (v === null || v === undefined ? null : String(v).trim().toLowerCase() || null);

function normRoleList(list, fallback) {
  const src = Array.isArray(list) ? list : fallback;
  return [...new Set((src || []).filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()))];
}

// The shipped overlay: the enforcement switches, the sign-off roles Group
// Compliance delegates, and the accepted arm's-length bases. Deterministic so
// two calls compare equal.
export function defaultRelatedPartyConfig() {
  return {
    version: RELATED_PARTY_VERSION,
    revision: RELATED_PARTY_DEFAULT_REVISION,
    source: 'default',
    owner: RELATED_PARTY_OWNER,
    gate: RELATED_PARTY_GATE,
    gate_label: RELATED_PARTY_GATE_LABEL,
    // The core enforcements the BRD requires. Each is a switch so a deployment
    // can relax the overlay without a code change, but all ship on.
    require_arm_length_documentation: true,
    require_independent_signoff: true,
    block_decision_without_signoff: true,
    exclude_conflicted_users: true,
    signoff_roles: [...DEFAULT_SIGNOFF_ROLES],
    arm_length_bases: ARM_LENGTH_BASES.map((b) => b.key),
    updated_by: null,
    updated_at: null,
  };
}

function normConfig(raw, base = defaultRelatedPartyConfig()) {
  const bool = (key) => (raw[key] === undefined ? base[key] : Boolean(raw[key]));
  const bases = Array.isArray(raw.arm_length_bases)
    ? raw.arm_length_bases.filter((k) => ARM_LENGTH_BASIS_KEYS.includes(k))
    : base.arm_length_bases;
  return {
    version: base.version,
    revision: Number.isInteger(raw.revision) ? raw.revision : base.revision,
    source: raw.source || base.source,
    owner: raw.owner !== undefined && String(raw.owner).trim() !== '' ? String(raw.owner).trim() : base.owner,
    gate: raw.gate || base.gate,
    gate_label: raw.gate_label || base.gate_label,
    require_arm_length_documentation: bool('require_arm_length_documentation'),
    require_independent_signoff: bool('require_independent_signoff'),
    block_decision_without_signoff: bool('block_decision_without_signoff'),
    exclude_conflicted_users: bool('exclude_conflicted_users'),
    signoff_roles: normRoleList(raw.signoff_roles, base.signoff_roles).length
      ? normRoleList(raw.signoff_roles, base.signoff_roles)
      : [...base.signoff_roles],
    arm_length_bases: bases.length ? bases : [...base.arm_length_bases],
    updated_by: raw.updated_by ?? base.updated_by,
    updated_at: raw.updated_at ?? base.updated_at,
  };
}

// Validate a candidate overlay. Returns { ok, errors } so the admin editor can
// point at the offending switch.
export function validateRelatedPartyConfig(config = {}) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', RELATED_PARTY_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  const candidate = normConfig(config);
  // An explicit empty list is a mistake worth refusing, not a request to fall
  // back to the shipped defaults, so inspect what the caller actually sent.
  const explicitRoles = Array.isArray(config.signoff_roles)
    ? config.signoff_roles.filter((r) => typeof r === 'string' && r.trim())
    : null;
  const explicitBases = Array.isArray(config.arm_length_bases) ? config.arm_length_bases : null;
  if (candidate.require_independent_signoff && candidate.signoff_roles.length === 0) {
    push('signoff_roles', RELATED_PARTY_MESSAGES.signoff_minimum_roles);
  } else if (candidate.require_independent_signoff && explicitRoles && explicitRoles.length === 0) {
    push('signoff_roles', RELATED_PARTY_MESSAGES.signoff_minimum_roles);
  }
  if (candidate.require_arm_length_documentation && candidate.arm_length_bases.length === 0) {
    push('arm_length_bases', 'At least one arm\'s-length basis must be accepted when the requirement is on.');
  } else if (candidate.require_arm_length_documentation && explicitBases && explicitBases.length === 0) {
    push('arm_length_bases', 'At least one arm\'s-length basis must be accepted when the requirement is on.');
  }
  return { ok: errors.length === 0, errors };
}

// Resolve a stored overlay to an effective one, filling anything the store
// omits from the shipped default.
export function resolveRelatedPartyConfig(config = null) {
  const base = defaultRelatedPartyConfig();
  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) return base;
  return { ...normConfig(config, base), version: config.version || base.version, source: config.source || 'stored' };
}

// The field-level diff between two overlays, for the audit trail.
export function diffRelatedPartyConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveRelatedPartyConfig(before);
  const a = resolveRelatedPartyConfig(after);
  for (const field of [
    'require_arm_length_documentation', 'require_independent_signoff',
    'block_decision_without_signoff', 'exclude_conflicted_users',
  ]) {
    if (b[field] !== a[field]) changes.push({ field, before: b[field], after: a[field] });
  }
  for (const field of ['signoff_roles', 'arm_length_bases', 'owner']) {
    if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
      changes.push({ field, before: b[field], after: a[field] });
    }
  }
  return changes;
}

// Build the next overlay revision. Mints revision + 1 and the matching RPT-01.N
// version, recording who changed it and when.
export function buildRelatedPartyConfig(body = {}, { actor = null, base = defaultRelatedPartyConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveRelatedPartyConfig(base);
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const merged = { ...resolvedBase, ...body };
  const next = {
    ...normConfig(merged, resolvedBase),
    version: RELATED_PARTY_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateRelatedPartyConfig(next);
  if (!ok) {
    const e = new Error(RELATED_PARTY_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    e.data = { errors };
    throw e;
  }
  return next;
}

// The effective status of the overlay for one review record against the config.
// The review is the related_party_review row (flag, disclosure, arm's-length
// basis, sign-off). Returns the status plus the outstanding requirements, so
// the board and the decision guard read the same verdict.
export function resolveOverlayStatus(config, review = {}) {
  const cfg = resolveRelatedPartyConfig(config);
  const flagged = Boolean(review.flagged);
  const outstanding = [];
  if (!flagged) {
    return {
      status: 'not_required', status_label: RELATED_PARTY_STATUS_LABELS.not_required,
      flagged: false, gate: cfg.gate, gate_label: cfg.gate_label, version: cfg.version,
      requires_signoff: false, signed_off: false, conflicted: false,
      outstanding, blocked: false,
      message: RELATED_PARTY_MESSAGES.not_flagged,
    };
  }
  const disclosure = String(review.disclosure || '').trim();
  const armLengthBasis = String(review.arm_length_basis || '').trim();
  const armLengthNote = String(review.arm_length_note || '').trim();
  const signedOffBy = normEmail(review.independent_signed_off_by);
  const conflicted = Boolean(review.conflicted_user_excluded);
  const documented = Boolean(disclosure) && (!cfg.require_arm_length_documentation || (Boolean(armLengthBasis) && Boolean(armLengthNote)));
  const signedOff = Boolean(signedOffBy);
  if (!disclosure) outstanding.push({ key: 'disclosure', label: RELATED_PARTY_MESSAGES.disclosure_required });
  if (cfg.require_arm_length_documentation) {
    if (!armLengthBasis) outstanding.push({ key: 'arm_length_basis', label: RELATED_PARTY_MESSAGES.arm_length_required });
    if (!armLengthNote) outstanding.push({ key: 'arm_length_note', label: 'An arm\'s-length evidence note is required.' });
  }
  const signoffRequired = cfg.require_independent_signoff || cfg.block_decision_without_signoff;
  if (signoffRequired && !signedOff) {
    outstanding.push({ key: 'independent_signoff', label: RELATED_PARTY_MESSAGES.signoff_missing });
  }
  let status;
  if (signoffRequired && signedOff) status = 'signed_off';
  else if (documented && !signedOff) status = 'documented';
  else status = 'open';
  const blocked = Boolean(cfg.block_decision_without_signoff) && !signedOff;
  const message = blocked
    ? (outstanding.find((o) => o.key === 'independent_signoff')?.label || RELATED_PARTY_MESSAGES.signoff_missing)
    : 'The related-party overlay requirements are met for the Gate-1 Screening Decision.';
  return {
    status, status_label: RELATED_PARTY_STATUS_LABELS[status],
    flagged: true, gate: cfg.gate, gate_label: cfg.gate_label, version: cfg.version,
    requires_signoff: signoffRequired, signed_off: signedOff,
    signed_off_by: signedOffBy, conflicted,
    arm_length_basis: armLengthBasis || null,
    documented, outstanding, blocked, message,
  };
}

// Is this actor conflicted with the deal? A user is conflicted when they are
// the preparer / owner, or the review names them as conflicted, and when the
// config excludes conflicted users.
export function isConflictedActor(config, { actor = {}, review = {}, opportunity = {} } = {}) {
  const cfg = resolveRelatedPartyConfig(config);
  if (!cfg.exclude_conflicted_users) return { conflicted: false, reasons: [] };
  const actorEmail = normEmail(actor.email);
  const reasons = [];
  if (!actorEmail) return { conflicted: true, reasons: ['no-identity'] };
  const ownerEmail = normEmail(opportunity?.data?.owner_email || opportunity?.owner_email);
  if (ownerEmail && ownerEmail === actorEmail) reasons.push('preparer');
  const conflictedEmails = (review.conflicted_users || [])
    .map((c) => normEmail(typeof c === 'string' ? c : c?.email))
    .filter(Boolean);
  if (conflictedEmails.includes(actorEmail)) reasons.push('named-conflicted');
  return { conflicted: reasons.length > 0, reasons };
}

// May this actor give the independent sign-off for this deal? Requires the
// delegated role, no conflict, and (when configured) a recorded arm's-length
// basis. Returns a denial reason so the route can explain the refusal.
export function maySignOff(config, { actor = {}, review = {}, opportunity = {} } = {}) {
  const cfg = resolveRelatedPartyConfig(config);
  const conflict = isConflictedActor(cfg, { actor, review, opportunity });
  const roleSet = new Set(Array.isArray(actor.roles) ? actor.roles : []);
  const hasRole = cfg.signoff_roles.some((r) => roleSet.has(r));
  if (conflict.conflicted) {
    return { allowed: false, reason: RELATED_PARTY_MESSAGES.signoff_conflicted, conflicted: true, reasons: conflict.reasons };
  }
  if (!hasRole) {
    return { allowed: false, reason: RELATED_PARTY_MESSAGES.signoff_role_required, conflicted: false, reasons: [] };
  }
  if (cfg.require_arm_length_documentation) {
    const hasBasis = Boolean(String(review.arm_length_basis || '').trim()) && Boolean(String(review.arm_length_note || '').trim());
    if (!hasBasis) {
      return { allowed: false, reason: RELATED_PARTY_MESSAGES.arm_length_required, conflicted: false, reasons: [] };
    }
  }
  return { allowed: true, reason: null, conflicted: false, reasons: [] };
}

// May this actor take the Gate-1 Screening Decision? A conflicted user may not
// when the overlay excludes them; anyone else is governed by the DoA matrix.
export function mayDecide(config, { actor = {}, review = {}, opportunity = {} } = {}) {
  const cfg = resolveRelatedPartyConfig(config);
  const status = resolveOverlayStatus(cfg, review);
  if (!status.flagged) return { allowed: true, reason: null, conflicted: false };
  const conflict = isConflictedActor(cfg, { actor, review, opportunity });
  if (conflict.conflicted) {
    return { allowed: false, reason: RELATED_PARTY_MESSAGES.decision_conflicted, conflicted: true, status };
  }
  if (status.blocked) {
    return { allowed: false, reason: RELATED_PARTY_MESSAGES.signoff_missing, conflicted: false, status };
  }
  return { allowed: true, reason: null, conflicted: false, status };
}

export default {
  defaultRelatedPartyConfig, validateRelatedPartyConfig, resolveRelatedPartyConfig,
  diffRelatedPartyConfig, buildRelatedPartyConfig, resolveOverlayStatus,
  isConflictedActor, maySignOff, mayDecide,
  RELATED_PARTY_CONFIG_KEY, RELATED_PARTY_VERSION, RELATED_PARTY_STATUSES,
};
