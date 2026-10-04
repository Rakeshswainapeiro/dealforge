// ---------------------------------------------------------------------------
// Content sufficiency check (W5-03 / BRD DOC-04).
//
// Source of truth: the Phase-1 BRD, Documents & Completeness - "Content
// sufficiency check (e.g. model missing cash flow, < 3y history, no downside)"
// accept criterion "Flags to preparer pre-submit and reviewer post; override
// with reason".
//
// The check is advisory. It reads the evidence other modules already produce -
// the financial summary, the three-statement model, the return metrics and the
// attached documents - and raises a flag per deficiency, carrying the observed
// value, the expected value and a plain reason. Nothing here re-derives a rule
// and nothing blocks a submission: a reviewer resolves a flag or records an
// override with a written reason.
//
// Pure functions only - no database, no network. See evaluateSufficiency().
// ---------------------------------------------------------------------------

import { ACTUAL_PERIOD_KEYS } from './financials.js';
import {
  SUFFICIENCY_CONFIG_KEY, SUFFICIENCY_VERSION, SUFFICIENCY_DEFAULT_REVISION,
  SUFFICIENCY_VERSION_PREFIX, SUFFICIENCY_REASON_MIN,
  SUFFICIENCY_MIN_HISTORY_YEARS,
  SUFFICIENCY_CATEGORIES, SUFFICIENCY_RULES, SUFFICIENCY_RULE_KEYS,
  SUFFICIENCY_BRD_EXAMPLES, SUFFICIENCY_MESSAGES, SUFFICIENCY_OVERRIDE_TAG,
} from './sufficiencyData.js';

export {
  SUFFICIENCY_CONFIG_KEY, SUFFICIENCY_VERSION, SUFFICIENCY_DEFAULT_REVISION,
  SUFFICIENCY_VERSION_PREFIX, SUFFICIENCY_REASON_MIN, SUFFICIENCY_MIN_HISTORY_YEARS,
  SUFFICIENCY_CATEGORIES, SUFFICIENCY_RULES, SUFFICIENCY_RULE_KEYS,
  SUFFICIENCY_BRD_EXAMPLES, SUFFICIENCY_MESSAGES, SUFFICIENCY_OVERRIDE_TAG,
};

const RULE_INDEX = new Map(SUFFICIENCY_RULES.map((r) => [r.key, r]));

function ruleMeta(key) {
  return RULE_INDEX.get(key) || { key, label: key, category: 'documents', severity: 'advisory' };
}

// The shipped, valid configuration. Deterministic so two calls compare equal.
export function defaultSufficiencyConfig() {
  return {
    version: SUFFICIENCY_VERSION,
    revision: SUFFICIENCY_DEFAULT_REVISION,
    source: 'default',
    min_history_years: SUFFICIENCY_MIN_HISTORY_YEARS,
    rules: SUFFICIENCY_RULES.map((r) => ({
      key: r.key,
      label: r.label,
      category: r.category,
      severity: r.severity,
      enabled: r.enabled,
    })),
    updated_by: null,
    updated_at: null,
  };
}

// Validate a candidate configuration. Returns { ok, errors } where each error is
// { key, field, message } so the admin editor can point at the offending row.
export function validateSufficiencyConfig(config = {}) {
  const errors = [];
  const push = (field, message, key = null) => errors.push({ key, field, message });

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', SUFFICIENCY_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  const years = config.min_history_years;
  if (years !== undefined && years !== null && years !== '') {
    const n = Number(years);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      push('min_history_years', 'min_history_years must be a whole number between 1 and 10.');
    }
  } else {
    push('min_history_years', 'min_history_years is required.');
  }
  if (config.rules !== undefined) {
    if (!Array.isArray(config.rules)) {
      push('rules', 'rules must be an array.');
    } else {
      for (const row of config.rules) {
        if (!row || typeof row !== 'object') { push('rules', 'Each rule must be an object.'); continue; }
        if (!SUFFICIENCY_RULE_KEYS.includes(row.key)) {
          push('rules', SUFFICIENCY_MESSAGES.unknown_rule + ' (' + row.key + ')', row.key);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// Resolve a stored configuration to an effective one, filling any missing rule
// from the shipped default so a partially stored config never loses a rule.
export function resolveSufficiencyConfig(config = null) {
  const base = defaultSufficiencyConfig();
  if (!config || typeof config !== 'object') return base;
  const stored = Array.isArray(config.rules) ? config.rules : [];
  const byKey = new Map(stored.filter((r) => r && r.key).map((r) => [r.key, r]));
  const enabledOverride = config.enabled && typeof config.enabled === 'object' ? config.enabled : null;
  const rules = base.rules.map((row) => {
    const s = byKey.get(row.key);
    let enabled = row.enabled;
    if (s && typeof s.enabled === 'boolean') enabled = s.enabled;
    if (enabledOverride && typeof enabledOverride[row.key] === 'boolean') enabled = enabledOverride[row.key];
    return { ...row, ...(s || {}), key: row.key, category: row.category, label: row.label, enabled };
  });
  const years = Number(config.min_history_years);
  return {
    ...base,
    version: config.version || base.version,
    revision: Number.isInteger(config.revision) ? config.revision : base.revision,
    source: config.source || 'stored',
    min_history_years: Number.isInteger(years) && years >= 1 && years <= 10 ? years : base.min_history_years,
    rules,
    updated_by: config.updated_by || null,
    updated_at: config.updated_at || null,
  };
}

// The field-level diff between two configurations, for the audit trail.
export function diffSufficiencyConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveSufficiencyConfig(before);
  const a = resolveSufficiencyConfig(after);
  if (b.min_history_years !== a.min_history_years) {
    changes.push({ field: 'min_history_years', before: b.min_history_years, after: a.min_history_years });
  }
  const bRules = new Map(b.rules.map((r) => [r.key, r]));
  for (const row of a.rules) {
    const prev = bRules.get(row.key);
    if (!prev) { changes.push({ field: 'rule', key: row.key, before: null, after: row.enabled }); continue; }
    if (prev.enabled !== row.enabled) {
      changes.push({ field: 'enabled', key: row.key, before: prev.enabled, after: row.enabled });
    }
  }
  return changes;
}

// Build the next configuration revision. mints revision + 1 and the matching
// SUF-01.N version, recording who changed it and when.
export function buildSufficiencyConfig(body = {}, { actor = null, base = defaultSufficiencyConfig(), at = null } = {}) {
  const resolvedBase = resolveSufficiencyConfig(base);
  const enabledOverride = body.enabled && typeof body.enabled === 'object' ? body.enabled : null;
  const rulesIn = Array.isArray(body.rules) ? body.rules : null;
  const rules = resolvedBase.rules.map((row) => {
    let enabled = row.enabled;
    if (rulesIn) {
      const s = rulesIn.find((r) => r && r.key === row.key);
      if (s && typeof s.enabled === 'boolean') enabled = s.enabled;
    }
    if (enabledOverride && typeof enabledOverride[row.key] === 'boolean') enabled = enabledOverride[row.key];
    return { ...row, enabled };
  });
  const yearsRaw = body.min_history_years;
  const years = yearsRaw === undefined || yearsRaw === null || yearsRaw === ''
    ? resolvedBase.min_history_years
    : Number(yearsRaw);
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const next = {
    ...resolvedBase,
    version: SUFFICIENCY_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    min_history_years: years,
    rules,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateSufficiencyConfig(next);
  if (!ok) {
    const e = new Error(SUFFICIENCY_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    throw e;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function countHistoryYears(financials = {}) {
  // A period is a year of actual history when any row of the derived matrix
  // carries a value in that period.
  const matrix = financials.matrix && typeof financials.matrix === 'object' ? financials.matrix : null;
  if (matrix) {
    let withData = 0;
    for (const key of ACTUAL_PERIOD_KEYS) {
      const any = Object.values(matrix).some((row) => row && typeof row === 'object' && row[key] !== null && row[key] !== undefined && row[key] !== '');
      if (any) withData += 1;
    }
    return withData;
  }
  return 0;
}

// Evaluate one rule against the composed evidence, returning a flag or null.
function evaluateRule(key, ctx) {
  const { gate = {}, documents = [] } = ctx;
  const attachedCount = documents.length;
  switch (key) {
    case 'cash_flow': {
      const model = gate.statement_model || {};
      const statements = model.statements || {};
      const cashFlow = statements.cash_flow_statement === true;
      const matrix = (gate.financials || {}).matrix || {};
      const fcfRow = matrix.free_cash_flow || {};
      const fcfDerivable = Object.values(fcfRow).some((v) => v !== null && v !== undefined && v !== '');
      if (cashFlow && fcfDerivable) return null;
      return { observed: cashFlow ? 'no derivable free cash flow' : 'cash flow statement missing', expected: 'cash flow statement and free cash flow' };
    }
    case 'history_years': {
      const years = countHistoryYears(gate.financials || {});
      const expected = ctx.min_history_years;
      if (years >= expected) return null;
      return { observed: years + ' year(s) of actual history', expected: expected + ' years' };
    }
    case 'downside_case': {
      const rm = gate.return_metrics || {};
      if (rm.downside_present === true) return null;
      return { observed: 'downside scenario not captured', expected: 'base, upside and downside' };
    }
    case 'model_attached': {
      const model = gate.statement_model || {};
      if (model.attached) return null;
      return { observed: attachedCount + ' document(s) attached', expected: 'three-statement model attached' };
    }
    case 'risk_register': {
      if (ctx.documentKeys.has('risk_register')) return null;
      return { observed: 'risk register not attached', expected: 'risk_register document' };
    }
    case 'market_data': {
      if (ctx.documentKeys.has('market_data')) return null;
      return { observed: 'market data not attached', expected: 'market_data document' };
    }
    default:
      return null;
  }
}

// Evaluate the content sufficiency of a submission.
//
// ctx:
//   gate        - the evaluateGate() result (financials, statement_model, return_metrics)
//   documents   - the attached document requirement keys, array or Set
//   config      - the effective sufficiency configuration
//   overrides   - the recorded reviewer overrides, keyed by rule key
//
// Returns the per-rule status, the raised flags, the open (unresolved) flags and
// the reviewer overrides, plus a headline message. Never throws for bad input.
export function evaluateSufficiency({ gate = {}, documents = [], config = null, overrides = null, phase = 'preparer' } = {}) {
  const effective = resolveSufficiencyConfig(config);
  const documentKeys = documents instanceof Set ? documents : new Set(documents);
  const overrideMap = overrides && typeof overrides === 'object' ? overrides : {};
  const ctx = {
    gate,
    documents: [...documentKeys],
    documentKeys,
    min_history_years: effective.min_history_years,
  };

  const byCategory = new Map(SUFFICIENCY_CATEGORIES.map((c) => [c.key, { key: c.key, label: c.label, passed: 0, flagged: 0, rules: [] }]));
  const rules = [];
  const flags = [];
  const resolved = [];

  for (const row of effective.rules) {
    const meta = ruleMeta(row.key);
    if (!row.enabled) {
      rules.push({ key: row.key, label: meta.label, category: meta.category, enabled: false, passed: null, flag: null, advisory: true, brd_example: SUFFICIENCY_BRD_EXAMPLES.includes(row.key) });
      continue;
    }
    const deficiency = evaluateRule(row.key, ctx);
    const override = overrideMap[row.key] || null;
    const passed = !deficiency;
    const flag = deficiency
      ? {
        key: row.key,
        label: meta.label,
        category: meta.category,
        severity: 'advisory',
        brd_example: SUFFICIENCY_BRD_EXAMPLES.includes(row.key),
        message: meta.message,
        observed: deficiency.observed,
        expected: deficiency.expected,
        overridden: Boolean(override),
        override_reason: override?.reason || null,
        override_by: override?.by || null,
        override_at: override?.at || null,
      }
      : null;
    if (flag) {
      flags.push(flag);
      if (flag.overridden) resolved.push(flag);
    }
    rules.push({
      key: row.key, label: meta.label, category: meta.category, enabled: true,
      passed, flag, advisory: true, brd_example: SUFFICIENCY_BRD_EXAMPLES.includes(row.key),
    });
    const bucket = byCategory.get(meta.category);
    if (bucket) {
      if (passed) bucket.passed += 1; else bucket.flagged += 1;
      bucket.rules.push(row.key);
    }
  }

  const openFlags = flags.filter((f) => !f.overridden);
  const sufficient = openFlags.length === 0;
  const notes = [];
  if (!sufficient) notes.push(SUFFICIENCY_MESSAGES.deficiencies);
  else if (resolved.length) notes.push('All raised flags carry a reviewer override.');
  else notes.push(SUFFICIENCY_MESSAGES.all_sufficient);

  return {
    applies: true,
    phase,
    version: effective.version,
    revision: effective.revision,
    min_history_years: effective.min_history_years,
    rules,
    flags,
    open_flags: openFlags,
    open_count: openFlags.length,
    resolved_count: resolved.length,
    resolved,
    categories: [...byCategory.values()],
    sufficient,
    advisory: true,
    disclaimer: SUFFICIENCY_MESSAGES.disclaimer,
    message: notes.join(' '),
  };
}

// Validate a reviewer override payload. A written reason of at least
// SUFFICIENCY_REASON_MIN characters is mandatory (BRD DOC-04).
export function buildSufficiencyOverride(body = {}, { actor = null, at = null } = {}) {
  const reason = String(body.reason || '').trim();
  if (reason.length < SUFFICIENCY_REASON_MIN) {
    const e = new Error(SUFFICIENCY_MESSAGES.reason_required);
    e.status = 400;
    throw e;
  }
  const by = String(body.by || actor?.email || actor?.id || '').trim();
  if (!by) {
    const e = new Error('A named reviewer is required to override a sufficiency flag.');
    e.status = 400;
    throw e;
  }
  return { reason, by, at: at || new Date().toISOString() };
}

// Read the reviewer overrides recorded on an opportunity's data, tolerating a
// missing or malformed block.
export function sufficiencyOverridesFromData(data = {}) {
  const block = data[SUFFICIENCY_OVERRIDE_TAG];
  return block && typeof block === 'object' && !Array.isArray(block) ? block : {};
}

export default {
  defaultSufficiencyConfig, validateSufficiencyConfig, resolveSufficiencyConfig,
  diffSufficiencyConfig, buildSufficiencyConfig, evaluateSufficiency,
  buildSufficiencyOverride, sufficiencyOverridesFromData,
};
