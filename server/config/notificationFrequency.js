// ---------------------------------------------------------------------------
// Notification email frequency (W6-07 / BRD NTF-01).
//
// Pure functions only - no database, no network. A user picks immediate or a
// daily digest; the policy (the allowed frequencies, the digest hour, whether
// the choice is user-editable) lives here so the route and the settings UI
// share it. The configuration is held in AppSettings by
// server/notificationFrequency.js; this module owns the vocabulary and the
// validation.
// ---------------------------------------------------------------------------

import {
  NOTIFICATION_FREQUENCY_KEY, NOTIFICATION_FREQUENCY_VERSION, NOTIFICATION_FREQUENCY_VERSION_PREFIX,
  NOTIFICATION_FREQUENCY_DEFAULT_REVISION, NOTIFICATION_FREQUENCY_OWNER, NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_KEYS, DEFAULT_NOTIFICATION_FREQUENCY, DEFAULT_DIGEST_HOUR,
  NOTIFICATION_FREQUENCY_MESSAGES,
} from './notificationFrequencyData.js';

export {
  NOTIFICATION_FREQUENCY_KEY, NOTIFICATION_FREQUENCY_VERSION, NOTIFICATION_FREQUENCY_VERSION_PREFIX,
  NOTIFICATION_FREQUENCY_DEFAULT_REVISION, NOTIFICATION_FREQUENCY_OWNER, NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_KEYS, DEFAULT_NOTIFICATION_FREQUENCY, DEFAULT_DIGEST_HOUR,
  NOTIFICATION_FREQUENCY_MESSAGES,
};

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function defaultNotificationFrequencyConfig() {
  return {
    version: NOTIFICATION_FREQUENCY_VERSION,
    revision: NOTIFICATION_FREQUENCY_DEFAULT_REVISION,
    source: 'default',
    owner: NOTIFICATION_FREQUENCY_OWNER,
    // Whether a user may override the group default for their own inbox.
    user_selectable: true,
    default_frequency: DEFAULT_NOTIFICATION_FREQUENCY,
    digest_hour: DEFAULT_DIGEST_HOUR,
    updated_by: null,
    updated_at: null,
  };
}

function normConfig(raw, base = defaultNotificationFrequencyConfig()) {
  const hour = Number(raw.digest_hour);
  return {
    version: base.version,
    revision: Number.isInteger(raw.revision) ? raw.revision : base.revision,
    source: raw.source || base.source,
    owner: raw.owner !== undefined && String(raw.owner).trim() !== '' ? String(raw.owner).trim() : base.owner,
    user_selectable: raw.user_selectable === undefined ? base.user_selectable : Boolean(raw.user_selectable),
    default_frequency: NOTIFICATION_FREQUENCY_KEYS.includes(String(raw.default_frequency || '').toLowerCase())
      ? String(raw.default_frequency).toLowerCase() : base.default_frequency,
    digest_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : base.digest_hour,
    updated_by: raw.updated_by ?? base.updated_by,
    updated_at: raw.updated_at ?? base.updated_at,
  };
}

export function validateNotificationFrequencyConfig(config = {}) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  config = coerce(config);
  if (!isPlainObject(config)) {
    push('config', NOTIFICATION_FREQUENCY_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  const freq = String(config.default_frequency || '').toLowerCase();
  if (freq && !NOTIFICATION_FREQUENCY_KEYS.includes(freq)) {
    push('default_frequency', NOTIFICATION_FREQUENCY_MESSAGES.invalid_frequency);
  }
  if (config.digest_hour !== undefined) {
    const hour = Number(config.digest_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      push('digest_hour', 'The digest hour must be a whole number between 0 and 23.');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function resolveNotificationFrequencyConfig(config = null) {
  const base = defaultNotificationFrequencyConfig();
  config = coerce(config);
  if (!isPlainObject(config)) return base;
  return { ...normConfig(config, base), version: config.version || base.version, source: config.source || 'stored' };
}

export function diffNotificationFrequencyConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveNotificationFrequencyConfig(before);
  const a = resolveNotificationFrequencyConfig(after);
  for (const field of ['user_selectable', 'default_frequency', 'digest_hour', 'owner']) {
    if (b[field] !== a[field]) changes.push({ field, before: b[field], after: a[field] });
  }
  return changes;
}

export function buildNotificationFrequencyConfig(body = {}, { actor = null, base = defaultNotificationFrequencyConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveNotificationFrequencyConfig(base);
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const merged = { ...resolvedBase, ...body };
  const next = {
    ...normConfig(merged, resolvedBase),
    version: NOTIFICATION_FREQUENCY_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateNotificationFrequencyConfig(next);
  if (!ok) {
    const e = new Error(NOTIFICATION_FREQUENCY_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    e.data = { errors };
    throw e;
  }
  return next;
}

// The frequency that applies to one user: their own choice when they have one
// and the policy allows it, otherwise the group default.
export function effectiveFrequency(userPreference, config = defaultNotificationFrequencyConfig()) {
  const cfg = resolveNotificationFrequencyConfig(config);
  if (!cfg.user_selectable) return cfg.default_frequency;
  const pref = String(userPreference || '').toLowerCase();
  return NOTIFICATION_FREQUENCY_KEYS.includes(pref) ? pref : cfg.default_frequency;
}

// Validate a user's own preference against the policy. Returns the cleaned
// frequency or { error }.
export function validateUserPreference(frequency, config = defaultNotificationFrequencyConfig()) {
  const cfg = resolveNotificationFrequencyConfig(config);
  const value = String(frequency || '').toLowerCase();
  if (!NOTIFICATION_FREQUENCY_KEYS.includes(value)) {
    return { error: NOTIFICATION_FREQUENCY_MESSAGES.invalid_frequency, field: 'frequency' };
  }
  if (!cfg.user_selectable) {
    return { error: 'The group does not allow a per-user notification frequency.', field: 'frequency' };
  }
  return { value };
}

// Compose a daily digest from a user's notification rows. Only the rows passed
// in are grouped, so the caller decides the scope (a single recipient); the
// function never widens it. Rows are bucketed by kind and ordered newest first.
export function composeDigest(rows = [], { email, since = null, at = null } = {}) {
  const items = (Array.isArray(rows) ? rows : []).filter((r) => r && r.recipient_email);
  const byKind = new Map();
  for (const r of items) {
    const key = r.kind || 'other';
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key).push({
      id: r.id, kind: r.kind, subject: r.subject || null, entity: r.entity || null,
      entity_id: r.entity_id != null ? String(r.entity_id) : null, org_id: r.org_id || null,
      created_at: r.created_at || null,
    });
  }
  const kinds = [...byKind.entries()].map(([kind, rowsForKind]) => ({
    kind,
    count: rowsForKind.length,
    items: rowsForKind.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
  })).sort((a, b) => b.count - a.count);
  return {
    recipient_email: email || (items[0]?.recipient_email || null),
    since: since || null,
    composed_at: at || new Date().toISOString(),
    total: items.length,
    kinds,
  };
}

export default {
  defaultNotificationFrequencyConfig, validateNotificationFrequencyConfig, resolveNotificationFrequencyConfig,
  diffNotificationFrequencyConfig, buildNotificationFrequencyConfig, effectiveFrequency,
  validateUserPreference, composeDigest,
  NOTIFICATION_FREQUENCY_KEY, NOTIFICATION_FREQUENCY_VERSION, NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_MESSAGES,
};
