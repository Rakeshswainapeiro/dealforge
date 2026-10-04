// ---------------------------------------------------------------------------
// Automatic hurdle test (W2-04 / FIN-04).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "Automatic hurdle
// test", accept criterion "Meets / Does-not-meet per hurdle per scenario;
// values versioned."
//
// Every hurdle is evaluated per captured scenario (base / upside / downside) so
// the memo's page-4 "Financials & returns vs. hurdles" table prints a Meets?
// verdict that can never disagree with its inputs. The thresholds are read from
// the same mandate_threshold configuration the rest of the engine uses, so an
// admin change moves the verdicts without a code change; the ROIC hurdle is
// WACC (FIN-05) + the configured spread.
//
// Two of the hurdles are deal-level rather than scenario-level — post-deal
// concentration and entry leverage do not vary by case — so they are evaluated
// once and reported against every scenario, with a basis of 'deal'.
//
// Pure functions only — no database, no network. See computeHurdles().
// ---------------------------------------------------------------------------

// Bumping this revision stamps every evaluation, so an audit trail can tell
// which policy produced a given set of verdicts (FIN-04: "values versioned").
export const HURDLE_TABLE_VERSION = 1;

// The shipped hurdle defaults (D2 placeholders, overridable per entity through
// mandate_threshold). Consumed by server/themes.js DEFAULT_THRESHOLDS so the
// table and the rest of the engine share one set of numbers (REQ-RULE-10).
export const HURDLE_DEFAULTS = {
  equity_irr_min: 20,
  greenfield_irr_min: 25,
  roic_wacc_spread: 5,
  payback_max_years: 3.5,
  concentration_max_pct: 35,
  leverage_max: 3,
};

export const HURDLE_META = [
  { key: 'equity_irr',    label: 'Equity IRR',           unit: '%',   comparator: 'gte', basis: 'scenario' },
  { key: 'roic',          label: 'ROIC',                 unit: '%',   comparator: 'gte', basis: 'scenario' },
  { key: 'payback',       label: 'Payback period',       unit: 'yrs', comparator: 'lte', basis: 'scenario' },
  { key: 'concentration', label: 'Single-deal concentration', unit: '%', comparator: 'lte', basis: 'deal' },
  { key: 'leverage',      label: 'Net debt / EBITDA',    unit: 'x',   comparator: 'lte', basis: 'deal' },
];

export const HURDLE_KEYS = HURDLE_META.map((h) => h.key);

import { deriveFinancials } from './financials.js';

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function meetsFor(comparator, value, threshold) {
  if (value === null || threshold === null) return null;
  return comparator === 'gte' ? value >= threshold : value <= threshold;
}

// The scenario table read from the flat capture fields. Mirrors
// returnMetrics.returnsFromFlatFields so the hurdle engine accepts either the
// already-resolved returns block or the raw opportunity data.
function returnsFor(data = {}, returns = null) {
  if (returns && typeof returns === 'object') return returns;
  const table = {};
  const map = {
    equity_irr: ['return_irr_base', 'return_irr_upside', 'return_irr_downside'],
    roic: ['return_roic_base', 'return_roic_upside', 'return_roic_downside'],
    payback: ['return_payback_years', 'return_payback_upside', 'return_payback_downside'],
    moic: ['return_moic_base', 'return_moic_upside', 'return_moic_downside'],
  };
  for (const [key, [b, u, d]] of Object.entries(map)) {
    const row = { base: num(data[b]), upside: num(data[u]), downside: num(data[d]) };
    if (row.base !== null || row.upside !== null || row.downside !== null) table[key] = row;
  }
  return table;
}

// Deal-level concentration: prefer a structured percentage, fall back to the
// first percentage named in the free-text concentration-impact rationale.
function concentrationPct(data = {}) {
  const direct = num(data.concentration_pct);
  if (direct !== null) return direct;
  const text = typeof data.concentration_impact === 'string' ? data.concentration_impact : '';
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

// Deal-level leverage: the Net debt / EBITDA ratio, preferring an explicitly
// captured value, then the ratio derived from a captured Net debt line, so a
// model that only supplies net debt still evaluates the leverage hurdle.
function leverageRatio(financials = {}) {
  const order = ['y1p', 'y2p', 'y3p', 'y4p', 'y5p', 'fy1a', 'fy2a', 'fy3a'];
  const captured = financials?.net_debt_ebitda || financials?.derived?.net_debt_ebitda || null;
  if (captured) {
    for (const key of order) {
      const value = num(captured[key]);
      if (value !== null) return value;
    }
  }
  const derived = deriveFinancials(financials || {}).net_debt_ebitda || {};
  for (const key of order) {
    const value = num(derived[key]);
    if (value !== null) return value;
  }
  return null;
}


// Build the effective threshold for each hurdle from the mandate thresholds and
// the resolved WACC. Returns a plain object keyed by hurdle key.
export function hurdleThresholds(thresholds = {}, wacc = null) {
  const t = thresholds || {};
  const waccPct = num(wacc?.effective_wacc) ?? num(t.wacc_pct);
  const spread = num(t.roic_wacc_spread);
  return {
    equity_irr: { value: num(t.equity_irr_min), greenfield: num(t.greenfield_irr_min), kind: 'threshold' },
    roic: { value: waccPct !== null && spread !== null ? waccPct + spread : null, kind: 'wacc_spread' },
    payback: { value: num(t.payback_max_years), kind: 'threshold' },
    concentration: { value: num(t.concentration_max_pct), kind: 'threshold' },
    leverage: { value: num(t.leverage_max), kind: 'threshold' },
  };
}

// Evaluate every hurdle per scenario. `data` is the opportunity data; `returns`
// is optional (defaults to the flat capture fields); `financials` is the
// captured summary matrix; `thresholds` is the mandate configuration; `wacc` is
// the resolved WACC block (FIN-05). Returns the per-scenario verdict rows plus
// per-hurdle metadata for the gate, the form and the memo.
export function computeHurdles({
  data = {}, returns = null, financials = null, thresholds = {}, wacc = null,
  scenarios = ['base', 'upside', 'downside'],
} = {}) {
  const table = returnsFor(data, returns);
  const thr = hurdleThresholds(thresholds, wacc);

  // Greenfield builds carry a higher equity-IRR hurdle (REQ-RULE-05). Use the
  // recorded opportunity type when present, otherwise the greenfield block.
  const isGreenfield = data.opportunity_type === 'greenfield'
    || (data.greenfield && typeof data.greenfield === 'object');
  const equityIrrThreshold = isGreenfield && thr.equity_irr.greenfield !== null
    ? thr.equity_irr.greenfield
    : thr.equity_irr.value;

  const dealValues = {
    concentration: concentrationPct(data),
    leverage: leverageRatio(financials || data.financials || {}),
  };

  const rowFor = (key) => {
    const meta = HURDLE_META.find((h) => h.key === key);
    const threshold = key === 'equity_irr' ? equityIrrThreshold : (thr[key]?.value ?? null);
    const perScenario = {};
    for (const scenario of scenarios) {
      const value = meta.basis === 'deal' ? dealValues[key] : num(table[key]?.[scenario]);
      perScenario[scenario] = {
        value,
        present: value !== null,
        meets: meetsFor(meta.comparator, value, threshold),
      };
    }
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      comparator: meta.comparator,
      basis: meta.basis,
      threshold,
      threshold_kind: key === 'roic' ? 'wacc_spread' : 'threshold',
      scenarios: perScenario,
    };
  };

  const rows = HURDLE_KEYS.map(rowFor);
  const passRate = {};
  for (const scenario of scenarios) {
    passRate[scenario] = rows.filter((r) => r.scenarios[scenario].meets === true).length;
  }

  // Advisory: a hurdle whose value is captured but falls short, or that has no
  // threshold configured, is surfaced as a flag rather than a hard block. A
  // hurdle with no captured value is simply omitted (the form may not have
  // reached it yet).
  const flags = [];
  for (const row of rows) {
    if (row.threshold === null) flags.push({ key: row.key, reason: 'no_threshold', label: row.label });
    for (const scenario of scenarios) {
      const s = row.scenarios[scenario];
      if (s.present && s.meets === false) {
        flags.push({
          key: row.key, scenario, reason: 'below_hurdle', label: row.label,
          value: s.value, threshold: row.threshold, unit: row.unit,
          message: row.label + ' ' + s.value + row.unit + ' does not meet the ' + row.threshold + row.unit + ' hurdle in the ' + scenario + ' case.',
        });
      }
    }
  }

  const anyBelow = flags.some((f) => f.reason === 'below_hurdle');
  return {
    applies: true,
    version: HURDLE_TABLE_VERSION,
    scenarios,
    greenfield: isGreenfield,
    equity_irr_threshold: equityIrrThreshold,
    thresholds: Object.fromEntries(rows.map((r) => [r.key, r.threshold])),
    rows,
    pass_rate: passRate,
    flags,
    any_below: anyBelow,
    meets_all: !anyBelow,
    message: anyBelow
      ? 'One or more hurdles are not met; the memo flags each case for review.'
      : 'All captured hurdles meet their thresholds across the evaluated scenarios.',
  };
}

export default { HURDLE_TABLE_VERSION, HURDLE_META, HURDLE_KEYS, hurdleThresholds, computeHurdles };
