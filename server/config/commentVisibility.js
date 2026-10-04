// ---------------------------------------------------------------------------
// Internal vs shared comment visibility (W6-04 / BRD AUD-03, REQ-RBAC-04).
//
// The pure resolution and enforcement functions for the visibility flag. A
// comment is either 'shared' (visible to everyone who can see the owning org)
// or 'internal' (visible only to the group investment layer). The accept
// criterion is a hard guarantee - "internal comments are never visible to
// subsidiary roles" - so the model is deny-by-default for a subsidiary-only
// user: an internal comment is dropped from every list, never returned in a
// thread detail, and never notified.
//
// Pure functions only - no database, no network. The HTTP route and the
// filtered reads live in server/qa.js with the configuration held in
// AppSettings by server/commentVisibility.js.
// ---------------------------------------------------------------------------

import {
  COMMENT_VISIBILITY_CONFIG_KEY, COMMENT_VISIBILITY_VERSION, COMMENT_VISIBILITY_VERSION_PREFIX,
  COMMENT_VISIBILITY_DEFAULT_REVISION, COMMENT_VISIBILITY_OWNER, COMMENT_VISIBILITIES,
  COMMENT_VISIBILITY_KEYS, DEFAULT_MESSAGE_VISIBILITY, DEFAULT_THREAD_VISIBILITY,
  DEFAULT_SUBSIDIARY_ROLES, COMMENT_VISIBILITY_CROSS_ORG_ROLES, COMMENT_VISIBILITY_MESSAGES,
} from './commentVisibilityData.js';

export {
  COMMENT_VISIBILITY_CONFIG_KEY, COMMENT_VISIBILITY_VERSION, COMMENT_VISIBILITY_VERSION_PREFIX,
  COMMENT_VISIBILITY_DEFAULT_REVISION, COMMENT_VISIBILITY_OWNER, COMMENT_VISIBILITIES,
  COMMENT_VISIBILITY_KEYS, DEFAULT_MESSAGE_VISIBILITY, DEFAULT_THREAD_VISIBILITY,
  DEFAULT_SUBSIDIARY_ROLES, COMMENT_VISIBILITY_CROSS_ORG_ROLES, COMMENT_VISIBILITY_MESSAGES,
};

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function normRoleList(list, fallback) {
  const src = Array.isArray(list) ? list : fallback;
  return [...new Set((src || []).filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()))];
}

function normVisibility(value, fallback) {
  const key = String(value || '').trim().toLowerCase();
  return COMMENT_VISIBILITY_KEYS.includes(key) ? key : fallback;
}

// The shipped visibility policy. Deterministic so two calls compare equal.
export function defaultCommentVisibilityConfig() {
  return {
    version: COMMENT_VISIBILITY_VERSION,
    revision: COMMENT_VISIBILITY_DEFAULT_REVISION,
    source: 'default',
    owner: COMMENT_VISIBILITY_OWNER,
    // The core guarantee the BRD requires. A deployment can relax the rule by
    // switching it off without a deploy, but it ships on.
    restrict_internal_to_group: true,
    notify_internal_messages: false,
    subsidiary_roles: [...DEFAULT_SUBSIDIARY_ROLES],
    default_message_visibility: DEFAULT_MESSAGE_VISIBILITY,
    default_thread_visibility: DEFAULT_THREAD_VISIBILITY,
    updated_by: null,
    updated_at: null,
  };
}

function normConfig(raw, base = defaultCommentVisibilityConfig()) {
  const bool = (key) => (raw[key] === undefined ? base[key] : Boolean(raw[key]));
  const roles = normRoleList(raw.subsidiary_roles, base.subsidiary_roles);
  return {
    version: base.version,
    revision: Number.isInteger(raw.revision) ? raw.revision : base.revision,
    source: raw.source || base.source,
    owner: raw.owner !== undefined && String(raw.owner).trim() !== '' ? String(raw.owner).trim() : base.owner,
    restrict_internal_to_group: bool('restrict_internal_to_group'),
    notify_internal_messages: bool('notify_internal_messages'),
    subsidiary_roles: roles.length ? roles : [...base.subsidiary_roles],
    default_message_visibility: normVisibility(raw.default_message_visibility, base.default_message_visibility),
    default_thread_visibility: normVisibility(raw.default_thread_visibility, base.default_thread_visibility),
    updated_by: raw.updated_by ?? base.updated_by,
    updated_at: raw.updated_at ?? base.updated_at,
  };
}

export function validateCommentVisibilityConfig(config = {}) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', COMMENT_VISIBILITY_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  const candidate = normConfig(config);
  const explicitRoles = Array.isArray(config.subsidiary_roles)
    ? config.subsidiary_roles.filter((r) => typeof r === 'string' && r.trim())
    : null;
  if (candidate.restrict_internal_to_group && candidate.subsidiary_roles.length === 0) {
    push('subsidiary_roles', COMMENT_VISIBILITY_MESSAGES.subsidiary_minimum_roles);
  } else if (candidate.restrict_internal_to_group && explicitRoles && explicitRoles.length === 0) {
    push('subsidiary_roles', COMMENT_VISIBILITY_MESSAGES.subsidiary_minimum_roles);
  }
  // A role cannot be both the restricted subsidiary layer and a cross-org
  // reader; the two lists must not overlap.
  const overlap = candidate.subsidiary_roles.filter((r) => COMMENT_VISIBILITY_CROSS_ORG_ROLES.includes(r));
  if (overlap.length) push('subsidiary_roles', COMMENT_VISIBILITY_MESSAGES.cross_org_conflict + ' (' + overlap.join(', ') + ')');
  if (config.default_message_visibility !== undefined
    && !COMMENT_VISIBILITY_KEYS.includes(String(config.default_message_visibility).toLowerCase())) {
    push('default_message_visibility', COMMENT_VISIBILITY_MESSAGES.invalid_visibility);
  }
  if (config.default_thread_visibility !== undefined
    && !COMMENT_VISIBILITY_KEYS.includes(String(config.default_thread_visibility).toLowerCase())) {
    push('default_thread_visibility', COMMENT_VISIBILITY_MESSAGES.invalid_visibility);
  }
  return { ok: errors.length === 0, errors };
}

export function resolveCommentVisibilityConfig(config = null) {
  const base = defaultCommentVisibilityConfig();
  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) return base;
  return { ...normConfig(config, base), version: config.version || base.version, source: config.source || 'stored' };
}

export function diffCommentVisibilityConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveCommentVisibilityConfig(before);
  const a = resolveCommentVisibilityConfig(after);
  for (const field of [
    'restrict_internal_to_group', 'notify_internal_messages',
    'default_message_visibility', 'default_thread_visibility',
  ]) {
    if (b[field] !== a[field]) changes.push({ field, before: b[field], after: a[field] });
  }
  for (const field of ['subsidiary_roles', 'owner']) {
    if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
      changes.push({ field, before: b[field], after: a[field] });
    }
  }
  return changes;
}

export function buildCommentVisibilityConfig(body = {}, { actor = null, base = defaultCommentVisibilityConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveCommentVisibilityConfig(base);
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const merged = { ...resolvedBase, ...body };
  const next = {
    ...normConfig(merged, resolvedBase),
    version: COMMENT_VISIBILITY_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateCommentVisibilityConfig(next);
  if (!ok) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    e.data = { errors };
    throw e;
  }
  return next;
}

// Is this actor a subsidiary-only user for the purpose of comment visibility?
// True when they hold at least one restricted role and no cross-org read role.
// A user with no restricted role at all (a pure group user) is not restricted.
export function isSubsidiaryViewer(config, actor = {}) {
  const cfg = resolveCommentVisibilityConfig(config);
  if (!cfg.restrict_internal_to_group) return false;
  const roles = new Set(Array.isArray(actor.roles) ? actor.roles : []);
  const hasSubsidiaryRole = cfg.subsidiary_roles.some((r) => roles.has(r));
  if (!hasSubsidiaryRole) return false;
  const isCrossOrg = COMMENT_VISIBILITY_CROSS_ORG_ROLES.some((r) => roles.has(r));
  return !isCrossOrg;
}

// The single visibility gate. An 'internal' comment is visible to this actor
// only when they are not a subsidiary-only viewer (and the restriction ships
// on). A 'shared' comment is always visible. Anything unrecognised is treated
// as internal so a corrupt row can never leak to a subsidiary role.
export function mayViewVisibility(config, actor, visibility) {
  const cfg = resolveCommentVisibilityConfig(config);
  const key = String(visibility || '').trim().toLowerCase();
  if (key === 'shared') return true;
  if (key === 'internal') {
    if (!cfg.restrict_internal_to_group) return true;
    return !isSubsidiaryViewer(cfg, actor);
  }
  // Unknown visibility: fail closed for a restricted viewer, open otherwise.
  return !isSubsidiaryViewer(cfg, actor);
}

export function canViewInternal(config, actor) {
  return mayViewVisibility(config, actor, 'internal');
}

// The effective visibility a stored comment renders as. A thread's visibility
// applies to every message on it: a message is internal when either the thread
// or the message is internal. This keeps an internal thread's replies internal
// even if a client forgets to send the flag.
export function effectiveMessageVisibility(threadVisibility, messageVisibility) {
  const t = String(threadVisibility || '').trim().toLowerCase();
  const m = String(messageVisibility || '').trim().toLowerCase();
  if (t === 'internal' || m === 'internal') return 'internal';
  return m === 'shared' || t === 'shared' ? 'shared' : DEFAULT_MESSAGE_VISIBILITY;
}

export default {
  defaultCommentVisibilityConfig, validateCommentVisibilityConfig, resolveCommentVisibilityConfig,
  diffCommentVisibilityConfig, buildCommentVisibilityConfig,
  isSubsidiaryViewer, mayViewVisibility, canViewInternal, effectiveMessageVisibility,
  COMMENT_VISIBILITY_CONFIG_KEY, COMMENT_VISIBILITY_VERSION, COMMENT_VISIBILITIES,
  COMMENT_VISIBILITY_MESSAGES,
};
