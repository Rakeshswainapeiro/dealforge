// ---------------------------------------------------------------------------
// Decision reason code configuration (W6-01 / BRD WF-05).
//
// Source of truth: the Phase-1 BRD, Workflow - "Decision reason codes" with
// accept criterion "Reason required; declines captured for comparables".
//
// A reason is a code from a maintained catalogue plus optional free text. The
// catalogue lives in configuration so the Investment Team can add, relabel or
// disable a code without a deploy. Reads fall back to the shipped default, so
// nothing changes until an administrator edits it.
//
// Pure functions only - no database, no network. The HTTP route lives in
// server/decisionReasons.js.
// ---------------------------------------------------------------------------

import {
  DECISION_REASON_CONFIG_KEY, DECISION_REASON_VERSION, DECISION_REASON_DEFAULT_REVISION,
  DECISION_REASON_VERSION_PREFIX, DECISION_REASON_OWNER, DECISION_CLASSES, DECISION_CLASS_KEYS,
  DECISION_REASONS, DECISION_REASON_MESSAGES, findDecisionClass, decisionClassForState, reasonsForClass,
} from './decisionReasonsData.js';

export {
  DECISION_REASON_CONFIG_KEY, DECISION_REASON_VERSION, DECISION_REASON_DEFAULT_REVISION,
  DECISION_REASON_VERSION_PREFIX, DECISION_REASON_OWNER, DECISION_CLASSES, DECISION_CLASS_KEYS,
  DECISION_REASONS, DECISION_REASON_MESSAGES, findDecisionClass, decisionClassForState, reasonsForClass,
};

// A stored AppSettings value can arrive as an object or as the JSON string the
// writer persisted. Normalise both before resolving.
function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

// The shipped catalogue: one entry per reason code, every code enabled, each
// class carrying its free-text policy. Deterministic so two calls compare equal.
export function defaultDecisionReasonConfig() {
  return {
    version: DECISION_REASON_VERSION,
    revision: DECISION_REASON_DEFAULT_REVISION,
    source: 'default',
    owner: DECISION_REASON_OWNER,
    classes: DECISION_CLASSES.map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      // Whether free text is mandatory alongside the code for this class.
      require_text: c.key === 'decline',
      enabled: true,
      reasons: reasonsForClass(c.key).map((r) => ({
        id: r.id,
        label: r.label,
        description: r.description,
        counts_as_decline: r.counts_as_decline,
        enabled: true,
      })),
    })),
    updated_by: null,
    updated_at: null,
  };
}

// Validate a candidate catalogue. Returns { ok, errors } with { key, field,
// message } so the admin editor can point at the offending row.
export function validateDecisionReasonConfig(config = {}) {
  const errors = [];
  const push = (field, message, key = null) => errors.push({ key, field, message });

  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', DECISION_REASON_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  if (config.classes !== undefined && !Array.isArray(config.classes)) {
    push('classes', 'classes must be an array.');
  }
  const seen = new Set();
  for (const cls of Array.isArray(config.classes) ? config.classes : []) {
    if (!cls || typeof cls !== 'object') { push('classes', 'Each decision class must be an object.'); continue; }
    if (!DECISION_CLASS_KEYS.includes(cls.key)) {
      push('classes', DECISION_REASON_MESSAGES.config_invalid + ' Unknown class (' + cls.key + ').', cls.key);
      continue;
    }
    if (cls.require_text !== undefined && typeof cls.require_text !== 'boolean') {
      push('require_text', 'require_text must be true or false for ' + cls.key + '.', cls.key);
    }
    if (cls.enabled !== undefined && typeof cls.enabled !== 'boolean') {
      push('enabled', 'enabled must be true or false for ' + cls.key + '.', cls.key);
    }
    for (const reason of Array.isArray(cls.reasons) ? cls.reasons : []) {
      if (!reason || typeof reason !== 'object') { push('reasons', 'Each reason must be an object.', cls.key); continue; }
      const id = String(reason.id || '').trim();
      if (!id) { push('reasons', 'A reason code is required.', cls.key); continue; }
      if (seen.has(cls.key + ':' + id)) { push('reasons', 'Duplicate reason code (' + id + ').', id); continue; }
      seen.add(cls.key + ':' + id);
      if (reason.label !== undefined && String(reason.label).trim() === '') {
        push('reasons', 'A label is required for ' + id + '.', id);
      }
      if (reason.enabled !== undefined && typeof reason.enabled !== 'boolean') {
        push('reasons', 'enabled must be true or false for ' + id + '.', id);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// Resolve a stored catalogue to an effective one, filling any class or code the
// store omits from the shipped default so a partial store never loses a code.
export function resolveDecisionReasonConfig(config = null) {
  const base = defaultDecisionReasonConfig();
  config = coerce(config);
  if (!config || typeof config !== 'object') return base;
  const stored = Array.isArray(config.classes) ? config.classes : [];
  const byKey = new Map(stored.filter((c) => c && c.key).map((c) => [c.key, c]));
  const classes = base.classes.map((row) => {
    const s = byKey.get(row.key);
    if (!s) return row;
    const storedReasons = Array.isArray(s.reasons) ? s.reasons : [];
    const rById = new Map(storedReasons.filter((r) => r && r.id).map((r) => [String(r.id), r]));
    const byBaseId = new Map(row.reasons.map((r) => [r.id, r]));
    // Keep shipped codes (respecting overrides), then append any custom codes
    // the administrator added that are not in the shipped set.
    const reasons = row.reasons.map((r) => {
      const o = rById.get(r.id);
      if (!o) return r;
      return {
        ...r,
        label: o.label !== undefined && String(o.label).trim() !== '' ? String(o.label).trim() : r.label,
        description: o.description !== undefined && String(o.description).trim() !== '' ? String(o.description).trim() : r.description,
        counts_as_decline: typeof o.counts_as_decline === 'boolean' ? o.counts_as_decline : r.counts_as_decline,
        enabled: typeof o.enabled === 'boolean' ? o.enabled : r.enabled,
      };
    });
    for (const o of storedReasons) {
      const id = o && o.id !== undefined ? String(o.id) : '';
      if (!id || byBaseId.has(id)) continue;
      reasons.push({
        id,
        label: o.label !== undefined && String(o.label).trim() !== '' ? String(o.label).trim() : id,
        description: o.description !== undefined ? String(o.description) : '',
        counts_as_decline: typeof o.counts_as_decline === 'boolean' ? o.counts_as_decline : false,
        enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
        custom: true,
      });
    }
    return {
      ...row,
      label: s.label !== undefined && String(s.label).trim() !== '' ? String(s.label).trim() : row.label,
      description: s.description !== undefined && String(s.description).trim() !== '' ? String(s.description).trim() : row.description,
      require_text: typeof s.require_text === 'boolean' ? s.require_text : row.require_text,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : row.enabled,
      reasons,
    };
  });
  return {
    ...base,
    version: config.version || base.version,
    revision: Number.isInteger(config.revision) ? config.revision : base.revision,
    source: config.source || 'stored',
    owner: config.owner || base.owner,
    classes,
    updated_by: config.updated_by || null,
    updated_at: config.updated_at || null,
  };
}

// The field-level diff between two catalogues, for the audit trail.
export function diffDecisionReasonConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveDecisionReasonConfig(before);
  const a = resolveDecisionReasonConfig(after);
  const bByKey = new Map(b.classes.map((c) => [c.key, c]));
  for (const cls of a.classes) {
    const prev = bByKey.get(cls.key);
    if (!prev) { changes.push({ field: 'class', key: cls.key, before: null, after: cls.label }); continue; }
    for (const field of ['label', 'description', 'require_text', 'enabled']) {
      if (prev[field] !== cls[field]) changes.push({ field, key: cls.key, before: prev[field], after: cls[field] });
    }
    const bReasons = new Map(prev.reasons.map((r) => [r.id, r]));
    for (const reason of cls.reasons) {
      const p = bReasons.get(reason.id);
      if (!p) { changes.push({ field: 'reason', key: cls.key, id: reason.id, before: null, after: reason.label }); continue; }
      for (const field of ['label', 'description', 'counts_as_decline', 'enabled']) {
        if (p[field] !== reason[field]) changes.push({ field, key: cls.key, id: reason.id, before: p[field], after: reason[field] });
      }
    }
  }
  return changes;
}

// Build the next catalogue revision. Mints revision + 1 and the matching
// DRC-01.N version, recording who changed it and when.
export function buildDecisionReasonConfig(body = {}, { actor = null, base = defaultDecisionReasonConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveDecisionReasonConfig(base);
  const classesIn = Array.isArray(body.classes) ? body.classes : null;
  const classes = resolvedBase.classes.map((row) => {
    if (!classesIn) return row;
    const s = classesIn.find((c) => c && c.key === row.key);
    if (!s) return row;
    const storedReasons = Array.isArray(s.reasons) ? s.reasons : null;
    let reasons = row.reasons;
    if (storedReasons) {
      const rById = new Map(storedReasons.filter((r) => r && r.id).map((r) => [String(r.id), r]));
      reasons = row.reasons.map((r) => {
        const o = rById.get(r.id);
        if (!o) return r;
        return {
          ...r,
          label: o.label !== undefined && String(o.label).trim() !== '' ? String(o.label).trim() : r.label,
          description: o.description !== undefined && String(o.description).trim() !== '' ? String(o.description).trim() : r.description,
          counts_as_decline: typeof o.counts_as_decline === 'boolean' ? o.counts_as_decline : r.counts_as_decline,
          enabled: typeof o.enabled === 'boolean' ? o.enabled : r.enabled,
        };
      });
      const baseIds = new Set(row.reasons.map((r) => r.id));
      for (const o of storedReasons) {
        const id = o && o.id !== undefined ? String(o.id).trim() : '';
        if (!id || baseIds.has(id)) continue;
        reasons.push({
          id,
          label: o.label !== undefined && String(o.label).trim() !== '' ? String(o.label).trim() : id,
          description: o.description !== undefined ? String(o.description) : '',
          counts_as_decline: typeof o.counts_as_decline === 'boolean' ? o.counts_as_decline : false,
          enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
          custom: true,
        });
      }
    }
    return {
      ...row,
      label: s.label !== undefined && String(s.label).trim() !== '' ? String(s.label).trim() : row.label,
      description: s.description !== undefined && String(s.description).trim() !== '' ? String(s.description).trim() : row.description,
      require_text: typeof s.require_text === 'boolean' ? s.require_text : row.require_text,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : row.enabled,
      reasons,
    };
  });
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const next = {
    ...resolvedBase,
    version: DECISION_REASON_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    owner: body.owner !== undefined && String(body.owner).trim() !== '' ? String(body.owner).trim() : resolvedBase.owner,
    classes,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateDecisionReasonConfig(next);
  if (!ok) {
    const e = new Error(DECISION_REASON_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    throw e;
  }
  return next;
}

// The enabled reason codes for a class, ready for a picker.
export function reasonOptions(config, classKey) {
  const resolved = resolveDecisionReasonConfig(config);
  const cls = resolved.classes.find((c) => c.key === classKey);
  if (!cls || cls.enabled === false) return [];
  return cls.reasons
    .filter((r) => r.enabled !== false)
    .map((r) => ({ id: r.id, label: r.label, description: r.description, counts_as_decline: r.counts_as_decline === true, custom: r.custom === true }));
}

// Is this code a valid, enabled reason for the class?
export function isReasonCodeValid(config, classKey, code) {
  if (!code) return false;
  return reasonOptions(config, classKey).some((r) => r.id === code);
}

// The display label for a recorded code, falling back to the raw code.
export function reasonCodeLabel(config, classKey, code) {
  const found = reasonOptions(config, classKey).find((r) => r.id === code);
  return found ? found.label : code;
}

// Whether the class demands free text alongside the code.
export function classRequiresText(config, classKey) {
  const resolved = resolveDecisionReasonConfig(config);
  const cls = resolved.classes.find((c) => c.key === classKey);
  return Boolean(cls && cls.require_text);
}

// Validate a decision's reason and, on success, return the fields to stamp on
// the record. Returns { ok, errors, data } where data holds the reason_* keys.
export function recordDecisionReason(config, { decisionClass, code, text, actor = null, at = null } = {}) {
  const errors = [];
  if (!DECISION_CLASS_KEYS.includes(decisionClass)) {
    return { ok: false, errors: [DECISION_REASON_MESSAGES.reason_code_invalid], data: null };
  }
  const codeText = code === undefined || code === null ? '' : String(code).trim();
  const freeText = text === undefined || text === null ? '' : String(text).trim();
  if (!codeText) errors.push(DECISION_REASON_MESSAGES.reason_required);
  else if (!isReasonCodeValid(config, decisionClass, codeText)) errors.push(DECISION_REASON_MESSAGES.reason_code_invalid);
  if (classRequiresText(config, decisionClass) && !freeText) errors.push(DECISION_REASON_MESSAGES.reason_text_required);
  if (errors.length) return { ok: false, errors, data: null };
  return {
    ok: true,
    errors: [],
    data: {
      decision_reason: codeText,
      decision_reason_label: reasonCodeLabel(config, decisionClass, codeText),
      decision_reason_text: freeText || null,
      decision_reason_class: decisionClass,
      decision_reason_by: actor?.email || actor?.id || null,
      decision_reason_at: at || new Date().toISOString(),
    },
  };
}

export default {
  defaultDecisionReasonConfig, validateDecisionReasonConfig,
  resolveDecisionReasonConfig, diffDecisionReasonConfig, buildDecisionReasonConfig,
  reasonOptions, isReasonCodeValid, reasonCodeLabel, classRequiresText, recordDecisionReason,
  DECISION_REASON_CONFIG_KEY, DECISION_REASON_VERSION,
};
