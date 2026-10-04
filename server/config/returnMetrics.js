// ---------------------------------------------------------------------------
// Return metrics across three scenarios (FIN-03, REQ-FIN-03).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "Equity IRR, ROIC
// and payback period are captured for base, upside and downside cases, with
// MOIC where relevant", accept criterion "All three scenarios mandatory.
// Downside case must be present ('survivable downside')."
//
// The capture model is deliberately flat (one field per metric per scenario) so
// the six-section form keeps rendering simple number inputs; this module is the
// single place that maps those flat fields onto the scenario table the gate, the
// form and the Sirius memo all read. Nothing is derived by guesswork: a metric
// with no captured value is reported as missing rather than defaulted.
//
// Pure functions only — no database, no network. See evaluateReturnMetrics().
// ---------------------------------------------------------------------------

// The three mandated scenarios, in the running order the memo prints them.
export const RETURN_SCENARIOS = [
  { key: 'base',     label: 'Base',     required: true },
  { key: 'upside',   label: 'Upside',   required: true },
  { key: 'downside', label: 'Downside', required: true },
];

export const RETURN_SCENARIO_KEYS = RETURN_SCENARIOS.map((s) => s.key);

// The metrics captured per scenario. Equity IRR, ROIC and payback are required
// across all three scenarios; MOIC is captured "where relevant" and never
// blocks. Each metric names the flat capture fields it reads, keyed by scenario,
// so the form and the gate agree on the field names without duplicating them.
export const RETURN_METRICS = [
  {
    key: 'equity_irr', label: 'Equity IRR', unit: '%', required: true,
    fields: { base: 'return_irr_base', upside: 'return_irr_upside', downside: 'return_irr_downside' },
  },
  {
    key: 'roic', label: 'ROIC', unit: '%', required: true,
    fields: { base: 'return_roic_base', upside: 'return_roic_upside', downside: 'return_roic_downside' },
  },
  {
    key: 'payback', label: 'Payback period', unit: 'yrs', required: true,
    fields: { base: 'return_payback_years', upside: 'return_payback_upside', downside: 'return_payback_downside' },
  },
  {
    key: 'moic', label: 'MOIC', unit: 'x', required: false, where_relevant: true,
    fields: { base: 'return_moic_base', upside: 'return_moic_upside', downside: 'return_moic_downside' },
  },
];

export const RETURN_METRIC_KEYS = RETURN_METRICS.map((m) => m.key);

// The IRR hurdle, used only to describe the scenario set; the meets/does-not-meet
// comparison itself is owned by the hurdle table (W2-04 / FIN-04).
export const DOWNSIDE_REQUIRED_MESSAGE =
  'The downside case is mandatory: returns must include a survivable downside scenario.';
export const SCENARIOS_REQUIRED_MESSAGE =
  'Base, upside and downside returns are all mandatory for Equity IRR, ROIC and payback.';

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function label(metric, scenario) {
  return metric.label + ' \u2014 ' + scenario.label;
}

// The scenario table read by the memo: { equity_irr: { base, upside, downside },
// ... }. A metric with no captured value for a scenario is null, so the memo
// renders the template placeholder rather than a fabricated number.
export function returnsFromFlatFields(data = {}) {
  const table = {};
  for (const metric of RETURN_METRICS) {
    const row = {};
    let any = false;
    for (const scenario of RETURN_SCENARIOS) {
      const value = num(data[metric.fields[scenario.key]]);
      row[scenario.key] = value;
      if (value !== null) any = true;
    }
    if (any) table[metric.key] = row;
  }
  return table;
}

// Evaluate the captured returns for the gate, the form and the memo. Reports
// which scenario/metric pairs are still open and whether the mandatory downside
// case is present. Advisory: returns completeness is surfaced as a flag and a
// missing list, matching the financials workstream's flag-don't-discard pattern.
export function evaluateReturnMetrics(data = {}) {
  const scenarios = {};
  const missing = [];
  for (const scenario of RETURN_SCENARIOS) {
    const metrics = {};
    let capturedCount = 0;
    let requiredCount = 0;
    for (const metric of RETURN_METRICS) {
      const key = metric.fields[scenario.key];
      const value = num(data[key]);
      metrics[metric.key] = { key, label: label(metric, scenario), unit: metric.unit, value, present: value !== null };
      if (value !== null) capturedCount += 1;
      if (metric.required) {
        requiredCount += 1;
        if (value === null) missing.push({ metric: metric.key, scenario: scenario.key, key, label: label(metric, scenario) });
      }
    }
    scenarios[scenario.key] = {
      key: scenario.key,
      label: scenario.label,
      present: requiredCount > 0 && metrics.equity_irr.present,
      captured: capturedCount,
      required: requiredCount,
      metrics,
    };
  }

  const moicRelevant = Object.values(scenarios).some((s) => s.metrics.moic.present);
  const complete = missing.length === 0;
  const downsidePresent = scenarios.downside.present;
  const notes = [];
  if (!downsidePresent) notes.push(DOWNSIDE_REQUIRED_MESSAGE);
  else if (!complete) notes.push(SCENARIOS_REQUIRED_MESSAGE);
  if (!moicRelevant) notes.push('MOIC is not captured; add it where a multiple is the agreed return measure.');

  return {
    applies: true,
    scenarios,
    scenario_order: RETURN_SCENARIO_KEYS,
    metrics: RETURN_METRICS.map((m) => ({ key: m.key, label: m.label, unit: m.unit, required: m.required })),
    moic_relevant: moicRelevant,
    downside_present: downsidePresent,
    complete,
    missing,
    missing_count: missing.length,
    message: complete
      ? 'Base, upside and downside returns captured for Equity IRR, ROIC and payback.'
      : notes.join(' '),
    table: returnsFromFlatFields(data),
  };
}

export default {
  RETURN_SCENARIOS, RETURN_SCENARIO_KEYS, RETURN_METRICS, RETURN_METRIC_KEYS,
  DOWNSIDE_REQUIRED_MESSAGE, SCENARIOS_REQUIRED_MESSAGE,
  returnsFromFlatFields, evaluateReturnMetrics,
};
