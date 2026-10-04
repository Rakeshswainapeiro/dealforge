// ---------------------------------------------------------------------------
// Overall pre-screening quality score (W3-09 / SCO-01).
//
// Source of truth: the Phase-1 BRD, "Pre-screening quality score". The six Gate-1
// screening signals are rolled into a single 0-100% quality score with a
// component breakdown and configurable bands. The score is advisory only: it
// summarises how ready and how attractive a deal looks across the checks the
// platform already produces, and it never decides anything on its own.
//
// Every component sub-score is derived from a result the platform already
// computed (the submission completeness gate, the Gate-1 hard and soft filters,
// the return hurdles, the theme alignment score and the Gate-2 scorecard), so
// this module never re-derives a rule. A component with no data yet is left out
// of the weighted total and its weight is redistributed, so an early-stage deal
// is never penalised for a check it has not reached.
//
// The component weights and the band thresholds are configuration: the shipped
// defaults live here and an administrator can recalibrate them at runtime
// through the AppSettings record (setting_key = 'quality_score_config'), with a
// new revision minted on every save, exactly as the Gate-2 scorecard does.
//
// Pure functions only - no database, no network. See evaluateQualityScore().
// ---------------------------------------------------------------------------

export const QUALITY_SCORE_VERSION = 'SCO-01.1';
export const QUALITY_SCORE_CONFIG_KEY = 'quality_score_config';
export const QUALITY_SCORE_DEFAULT_REVISION = 1;
export const QUALITY_SCORE_VERSION_PREFIX = 'QS-01.';
export const QUALITY_WEIGHT_TOTAL = 100;

export const QUALITY_SCORE_DISCLAIMER =
  'The quality score is advisory. It summarises the screening signals and never takes the decision on its own.';

// The six components, in display order, each taking its sub-score from a result
// the platform already produces. Weights sum to 100.
export const QUALITY_COMPONENTS = [
  { key: 'eligibility', label: 'Eligibility & completeness', weight: 15, source: 'gate.completeness', description: 'The submission pack completeness across the six sections.' },
  { key: 'hard_filters', label: 'Gate 1 hard filters', weight: 15, source: 'gate.hard_filters', description: 'The five standing filters; a failed filter lowers the score without deciding the outcome.' },
  { key: 'soft_filters', label: 'Gate 1 soft filters', weight: 10, source: 'gate.soft_filters', description: 'The three 1-5 scored filters, averaged.' },
  { key: 'hurdles', label: 'Return hurdles', weight: 20, source: 'gate.hurdle_table', description: 'The share of return hurdles met across the scenarios.' },
  { key: 'alignment', label: 'Strategic alignment', weight: 15, source: 'alignment.score', description: 'Fit against the owning subsidiary mandate and the group strategy.' },
  { key: 'scorecard', label: 'Gate 2 scorecard', weight: 25, source: 'gate.scorecard', description: 'The weighted 1-5 Gate 2 scorecard total, scaled to 100.' },
];

export const QUALITY_COMPONENT_KEYS = QUALITY_COMPONENTS.map((c) => c.key);

// The shipped bands, highest first. A score at or above a band minimum takes
// that band; the last band has a minimum of 0 and always matches.
export const QUALITY_BANDS = [
  { key: 'strong', label: 'Strong', min: 75, tone: 'emerald' },
  { key: 'moderate', label: 'Moderate', min: 50, tone: 'amber' },
  { key: 'weak', label: 'Weak', min: 0, tone: 'red' },
];

export const QUALITY_MESSAGES = {
  unstarted: 'No screening signal is available yet.',
  scored: 'Overall quality score computed from the available screening signals.',
  config_invalid: 'The proposed quality-score configuration is invalid:',
  config_saved: 'The quality-score configuration was saved under a new revision.',
};

const round1 = (n) => Math.round(n * 10) / 10;
const clamp100 = (n) => Math.max(0, Math.min(100, n));

// The shipped (default) configuration, in the shape the admin console stores
// and the gate resolves.
export function defaultQualityScoreConfig() {
  return {
    revision: QUALITY_SCORE_DEFAULT_REVISION,
    version: QUALITY_SCORE_VERSION,
    components: QUALITY_COMPONENTS.map((c) => ({ ...c })),
    bands: QUALITY_BANDS.map((b) => ({ ...b })),
  };
}

const versionFor = (revision) => QUALITY_SCORE_VERSION_PREFIX + revision;

// The sub-score (0-100) for one component from the screening result it reads, or
// null when the result is not available yet (so its weight is redistributed).
function componentScore(key, gate, alignment) {
  const g = gate || {};
  if (key === 'eligibility') {
    const fields = Array.isArray(g.fields) ? g.fields : [];
    if (!fields.length) return g.complete === true ? 100 : null;
    const missing = Array.isArray(g.missing) ? g.missing.length : 0;
    return clamp100(((fields.length - missing) / fields.length) * 100);
  }
  if (key === 'hard_filters') {
    const hf = g.hard_filters;
    if (!hf || !Array.isArray(hf.items) || !hf.items.length) return null;
    const failed = hf.items.filter((i) => i.status === 'fail').length;
    const flagged = hf.items.filter((i) => i.status === 'flag').length;
    return clamp100(100 - ((failed * 100 + flagged * 40) / hf.items.length));
  }
  if (key === 'soft_filters') {
    const sf = g.soft_filters;
    if (!sf || !sf.applies) return null;
    const avg = sf.average != null ? sf.average : sf.proposed_average;
    return avg == null ? null : clamp100((avg / 5) * 100);
  }
  if (key === 'hurdles') {
    const ht = g.hurdle_table;
    if (!ht || !ht.applies || !ht.pass_rate) return null;
    const scenarios = Object.values(ht.pass_rate);
    if (!scenarios.length) return null;
    // Score on the share of hurdles met per scenario, averaged across the
    // scenarios present (the base case weighs the same as upside / downside).
    const rows = Array.isArray(ht.rows) ? ht.rows.length : 0;
    if (!rows) return null;
    return clamp100((scenarios.reduce((t, n) => t + n, 0) / scenarios.length / rows) * 100);
  }
  if (key === 'alignment') {
    if (!alignment || alignment.score == null) return null;
    return clamp100(alignment.score);
  }
  if (key === 'scorecard') {
    const sc = g.scorecard;
    if (!sc || sc.total == null) return null;
    return clamp100((sc.total / 5) * 100);
  }
  return null;
}

const componentMeta = (key, components) => components.find((c) => c.key === key)
  || QUALITY_COMPONENTS.find((c) => c.key === key)
  || { key, label: key, weight: 0, description: null };

/**
 * Evaluate the overall pre-screening quality score. Pure.
 *
 * @param {object} input   { gate, alignment } - the screening results already computed
 * @param {object} options
 * @param {Array}  options.components  the component weights (defaults to scope defaults)
 * @param {Array}  options.bands       the band thresholds (defaults to scope defaults)
 * @param {string} options.version     the configuration version to stamp
 */
export function evaluateQualityScore({ gate = null, alignment = null } = {}, { components = QUALITY_COMPONENTS, bands = QUALITY_BANDS, version = QUALITY_SCORE_VERSION } = {}) {
  const items = components.map((c) => {
    const meta = componentMeta(c.key, components);
    const sub = componentScore(c.key, gate, alignment);
    return {
      key: c.key,
      label: meta.label,
      description: meta.description || null,
      weight: Number(c.weight || 0),
      score: sub == null ? null : round1(sub),
      available: sub != null,
      contribution: sub == null ? null : round1((sub * Number(c.weight || 0)) / QUALITY_WEIGHT_TOTAL),
    };
  });

  const availableItems = items.filter((i) => i.available);
  const weightAvailable = availableItems.reduce((t, i) => t + i.weight, 0);
  const score = weightAvailable > 0
    ? round1(availableItems.reduce((t, i) => t + i.score * i.weight, 0) / weightAvailable)
    : null;

  const band = score == null ? null : qualityBand(score, bands);
  const missing = items.filter((i) => !i.available).map((i) => i.key);

  return {
    version,
    min_score: 0,
    max_score: 100,
    advisory: true,
    disclaimer: QUALITY_SCORE_DISCLAIMER,
    components: items,
    component_count: items.length,
    available_count: availableItems.length,
    unavailable: missing,
    weight_total: Number(components.reduce((t, c) => t + Number(c.weight || 0), 0).toFixed(1)),
    weight_available: round1(weightAvailable),
    score,
    band: band?.key || null,
    band_label: band?.label || null,
    bands: bands.map((b) => ({ ...b })),
    complete: weightAvailable > 0,
    message: score == null ? QUALITY_MESSAGES.unstarted : QUALITY_MESSAGES.scored,
  };
}

// The band a score falls into; the first (highest) band whose minimum is met.
export function qualityBand(score, bands = QUALITY_BANDS) {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => score >= b.min) || sorted[sorted.length - 1] || null;
}

// Normalise and validate a proposed configuration. Pure. Returns
// { ok, errors, config }.
export function validateQualityScoreConfig(input = {}, { base = defaultQualityScoreConfig() } = {}) {
  const errors = [];
  const rawComponents = Array.isArray(input.components) && input.components.length ? input.components : base.components;
  const components = rawComponents.map((c, idx) => {
    const key = String(c.key || '').trim();
    const weight = Number(c.weight);
    if (!key) errors.push('Every component needs a key.');
    if (!Number.isFinite(weight) || weight < 0) errors.push('Component ' + (key || idx) + ' needs a non-negative weight.');
    return {
      key,
      label: String(c.label || key),
      weight: Number.isFinite(weight) ? weight : 0,
      source: c.source != null ? String(c.source) : null,
      description: c.description != null ? String(c.description) : null,
    };
  });
  const total = components.reduce((t, c) => t + c.weight, 0);
  if (total !== QUALITY_WEIGHT_TOTAL) errors.push('Component weights must total ' + QUALITY_WEIGHT_TOTAL + '% (currently ' + total + '%).');
  const keys = components.map((c) => c.key);
  if (new Set(keys).size !== keys.length) errors.push('Component keys must be unique.');

  const rawBands = Array.isArray(input.bands) && input.bands.length ? input.bands : base.bands;
  const bands = rawBands.map((b) => {
    const min = Number(b.min);
    if (!Number.isFinite(min) || min < 0 || min > 100) errors.push('Band ' + (b.key || '?') + ' needs a minimum between 0 and 100.');
    return {
      key: String(b.key || '').trim(),
      label: String(b.label || b.key || ''),
      min: Number.isFinite(min) ? min : 0,
      tone: b.tone != null ? String(b.tone) : null,
    };
  });
  if (!bands.some((b) => b.min === 0)) errors.push('One band must have a minimum of 0 so every score maps to a band.');

  const revision = Number.isInteger(input.revision) && input.revision >= 1 ? input.revision : base.revision;
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    config: {
      revision,
      version: input.version || versionFor(revision),
      components,
      bands,
    },
  };
}

// Resolve a stored configuration, falling back to the shipped defaults.
export function resolveQualityScoreConfig(stored) {
  const base = defaultQualityScoreConfig();
  if (!stored) return base;
  const parsed = typeof stored === 'string' ? safeJson(stored) : stored;
  if (!parsed || typeof parsed !== 'object') return base;
  const { ok, config } = validateQualityScoreConfig(parsed, { base });
  if (!ok) return base;
  return { ...config, updated_by: parsed.updated_by || null, updated_at: parsed.updated_at || null };
}

function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }

// Validate a recalibration from the admin console and mint the next revision.
export function buildQualityScoreConfig(body = {}, { actor = null, at = null, base = defaultQualityScoreConfig() } = {}) {
  const { ok, errors, config } = validateQualityScoreConfig({ ...body, revision: base.revision + 1, version: null }, { base });
  if (!ok) {
    const e = new Error(QUALITY_MESSAGES.config_invalid + ' ' + errors.join(' '));
    e.status = 400;
    e.errors = errors;
    throw e;
  }
  return {
    ...config,
    version: versionFor(config.revision),
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
}

export default {
  QUALITY_SCORE_VERSION, QUALITY_SCORE_CONFIG_KEY, QUALITY_SCORE_DEFAULT_REVISION,
  QUALITY_SCORE_VERSION_PREFIX, QUALITY_WEIGHT_TOTAL, QUALITY_SCORE_DISCLAIMER,
  QUALITY_COMPONENTS, QUALITY_COMPONENT_KEYS, QUALITY_BANDS, QUALITY_MESSAGES,
  defaultQualityScoreConfig, validateQualityScoreConfig, resolveQualityScoreConfig,
  buildQualityScoreConfig, evaluateQualityScore, qualityBand,
};

