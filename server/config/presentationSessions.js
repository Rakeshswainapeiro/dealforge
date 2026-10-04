// ---------------------------------------------------------------------------
// Subsidiary presentation scheduling (W6-06 / BRD WF-07).
//
// Pure functions only - no database, no network. A presentation is captured on
// the opportunity record with a date, the attendees, the outcome and the next
// steps; the validity rules live here so the route and the admin editor share
// them. The configuration (statuses, formats, required fields, owner) is held in
// AppSettings by server/presentationSessions.js; this module owns the vocabulary
// and the validation.
// ---------------------------------------------------------------------------

import {
  PRESENTATION_CONFIG_KEY, PRESENTATION_VERSION, PRESENTATION_VERSION_PREFIX,
  PRESENTATION_DEFAULT_REVISION, PRESENTATION_OWNER, PRESENTATION_STATUSES,
  PRESENTATION_STATUS_KEYS, PRESENTATION_FORMATS, PRESENTATION_FORMAT_KEYS,
  DEFAULT_PRESENTATION_STATUS, DEFAULT_PRESENTATION_FORMAT, PRESENTATION_REQUIRED_FIELDS,
  PRESENTATION_CROSS_ORG_ROLES, PRESENTATION_MESSAGES,
} from './presentationSessionsData.js';

export {
  PRESENTATION_CONFIG_KEY, PRESENTATION_VERSION, PRESENTATION_VERSION_PREFIX,
  PRESENTATION_DEFAULT_REVISION, PRESENTATION_OWNER, PRESENTATION_STATUSES,
  PRESENTATION_STATUS_KEYS, PRESENTATION_FORMATS, PRESENTATION_FORMAT_KEYS,
  DEFAULT_PRESENTATION_STATUS, DEFAULT_PRESENTATION_FORMAT, PRESENTATION_REQUIRED_FIELDS,
  PRESENTATION_CROSS_ORG_ROLES, PRESENTATION_MESSAGES,
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

// The shipped presentation policy: a scheduled date and at least one attendee
// are mandatory, video is the default format.
export function defaultPresentationConfig() {
  return {
    version: PRESENTATION_VERSION,
    revision: PRESENTATION_DEFAULT_REVISION,
    source: 'default',
    owner: PRESENTATION_OWNER,
    require_attendees: true,
    // Whether an outcome must be recorded before a session can be completed.
    require_outcome_on_complete: true,
    default_format: DEFAULT_PRESENTATION_FORMAT,
    required_fields: [...PRESENTATION_REQUIRED_FIELDS],
    updated_by: null,
    updated_at: null,
  };
}

function normConfig(raw, base = defaultPresentationConfig()) {
  const bool = (key) => (raw[key] === undefined ? base[key] : Boolean(raw[key]));
  const fields = Array.isArray(raw.required_fields)
    ? [...new Set(raw.required_fields.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()))]
    : base.required_fields;
  return {
    version: base.version,
    revision: Number.isInteger(raw.revision) ? raw.revision : base.revision,
    source: raw.source || base.source,
    owner: raw.owner !== undefined && String(raw.owner).trim() !== '' ? String(raw.owner).trim() : base.owner,
    require_attendees: bool('require_attendees'),
    require_outcome_on_complete: bool('require_outcome_on_complete'),
    default_format: PRESENTATION_FORMAT_KEYS.includes(String(raw.default_format || '').toLowerCase())
      ? String(raw.default_format).toLowerCase() : base.default_format,
    required_fields: fields.length ? fields : [...base.required_fields],
    updated_by: raw.updated_by ?? base.updated_by,
    updated_at: raw.updated_at ?? base.updated_at,
  };
}

export function validatePresentationConfig(config = {}) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  config = coerce(config);
  if (!isPlainObject(config)) {
    push('config', PRESENTATION_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  return { ok: errors.length === 0, errors };
}

export function resolvePresentationConfig(config = null) {
  const base = defaultPresentationConfig();
  config = coerce(config);
  if (!isPlainObject(config)) return base;
  return { ...normConfig(config, base), version: config.version || base.version, source: config.source || 'stored' };
}

export function diffPresentationConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolvePresentationConfig(before);
  const a = resolvePresentationConfig(after);
  for (const field of ['require_attendees', 'require_outcome_on_complete', 'default_format', 'owner']) {
    if (b[field] !== a[field]) changes.push({ field, before: b[field], after: a[field] });
  }
  if (JSON.stringify(b.required_fields) !== JSON.stringify(a.required_fields)) {
    changes.push({ field: 'required_fields', before: b.required_fields, after: a.required_fields });
  }
  return changes;
}

export function buildPresentationConfig(body = {}, { actor = null, base = defaultPresentationConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolvePresentationConfig(base);
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const merged = { ...resolvedBase, ...body };
  const next = {
    ...normConfig(merged, resolvedBase),
    version: PRESENTATION_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validatePresentationConfig(next);
  if (!ok) {
    const e = new Error(PRESENTATION_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    e.data = { errors };
    throw e;
  }
  return next;
}

// Normalise one session payload against the policy. Returns the cleaned fields
// or { error } naming the first problem. Attendees are trimmed and de-duplicated
// by email (case-insensitive) but keep their display name.
export function normaliseSession(payload = {}, config = defaultPresentationConfig()) {
  const cfg = resolvePresentationConfig(config);
  let scheduledAt = null;
  if (payload.scheduled_at instanceof Date) {
    scheduledAt = Number.isNaN(payload.scheduled_at.getTime()) ? null : payload.scheduled_at.toISOString();
  } else if (payload.scheduled_at != null && String(payload.scheduled_at).trim() !== '') {
    scheduledAt = String(payload.scheduled_at).trim();
  }
  const status = PRESENTATION_STATUS_KEYS.includes(String(payload.status || '').toLowerCase())
    ? String(payload.status).toLowerCase() : DEFAULT_PRESENTATION_STATUS;
  const format = PRESENTATION_FORMAT_KEYS.includes(String(payload.format || '').toLowerCase())
    ? String(payload.format).toLowerCase() : (payload.format ? null : cfg.default_format);

  const rawAttendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const seen = new Set();
  const attendees = [];
  for (const a of rawAttendees) {
    const email = (typeof a === 'string' ? a : String(a?.email || a?.name || '')).trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    attendees.push({
      name: (typeof a === 'object' && String(a?.name || '').trim()) || null,
      email,
      role: (typeof a === 'object' && String(a?.role || '').trim()) || null,
    });
  }

  const required = new Set(cfg.required_fields);
  if (required.has('scheduled_at') && !scheduledAt) return { error: PRESENTATION_MESSAGES.scheduled_at_required, field: 'scheduled_at' };
  if ((required.has('attendees') || cfg.require_attendees) && attendees.length === 0) {
    return { error: PRESENTATION_MESSAGES.attendees_required, field: 'attendees' };
  }
  if (payload.status !== undefined && !PRESENTATION_STATUS_KEYS.includes(String(payload.status).toLowerCase())) {
    return { error: PRESENTATION_MESSAGES.invalid_status, field: 'status' };
  }
  if (payload.format !== undefined && payload.format !== null && String(payload.format).trim() !== ''
    && !PRESENTATION_FORMAT_KEYS.includes(String(payload.format).toLowerCase())) {
    return { error: PRESENTATION_MESSAGES.invalid_format, field: 'format' };
  }

  const outcome = payload.outcome != null && String(payload.outcome).trim() !== '' ? String(payload.outcome).trim() : null;
  const nextSteps = payload.next_steps != null && String(payload.next_steps).trim() !== '' ? String(payload.next_steps).trim() : null;
  if (status === 'completed' && cfg.require_outcome_on_complete && !outcome) {
    return { error: PRESENTATION_MESSAGES.outcome_required, field: 'outcome' };
  }

  return {
    value: {
      scheduled_at: scheduledAt,
      status,
      format,
      location: payload.location != null && String(payload.location).trim() !== '' ? String(payload.location).trim() : null,
      attendees,
      outcome,
      next_steps: nextSteps,
      notes: payload.notes != null && String(payload.notes).trim() !== '' ? String(payload.notes).trim() : null,
    },
  };
}

// Whether this actor may manage (create/update) presentations for an opportunity
// owned by ownerOrgId. A cross-org reader may manage any; otherwise the actor
// must own the org (or one of its descendants / an explicit grant).
export function mayManagePresentations(actor = {}, ownerOrgId) {
  if (!actor) return false;
  const roles = new Set(Array.isArray(actor.roles) ? actor.roles : []);
  if (PRESENTATION_CROSS_ORG_ROLES.some((r) => roles.has(r))) return true;
  if (!ownerOrgId) return false;
  if (actor.org_id === ownerOrgId) return true;
  const readable = new Set([...(actor.descendant_ids || []), ...(actor.granted_org_ids || [])]);
  return readable.has(ownerOrgId);
}

export default {
  defaultPresentationConfig, validatePresentationConfig, resolvePresentationConfig,
  diffPresentationConfig, buildPresentationConfig, normaliseSession, mayManagePresentations,
  PRESENTATION_CONFIG_KEY, PRESENTATION_VERSION, PRESENTATION_STATUSES, PRESENTATION_FORMATS,
  PRESENTATION_MESSAGES,
};
