// ---------------------------------------------------------------------------
// Financial summary configuration (FIN-01, REQ-FIN-01; Part B p.4).
//
// Source of truth: docs/Sirius_Investment_Framework_Subsidiaries_Final.pdf,
// "Part B · Submission Template" page 4 — the Financials & returns vs.
// hurdles table. It is an AED mn matrix of eight rows against three audited
// actuals (FY-3 A … FY-1 A) and five projections (Y1 P … Y5 P).
//
// Three of the rows are derived, not captured: Growth %, EBITDA margin % and
// Free cash flow are calculated from the captured rows so the memo can never
// show a ratio that disagrees with its inputs. Net debt / EBITDA is captured
// directly, or derived from a captured Net debt line when one is supplied.
//
// New ventures (greenfield) may leave the actual columns blank — the table and
// the derived ratios simply omit them rather than raising a completeness flag.
//
// Pure functions only — no database, no network. See deriveFinancials().
// ---------------------------------------------------------------------------

// Columns of the page-4 table, in template order.
export const FINANCIAL_PERIODS = ['FY-3 A', 'FY-2 A', 'FY-1 A', 'Y1 P', 'Y2 P', 'Y3 P', 'Y4 P', 'Y5 P'];
export const FINANCIAL_PERIOD_KEYS = ['fy3a', 'fy2a', 'fy1a', 'y1p', 'y2p', 'y3p', 'y4p', 'y5p'];

// Audited actuals and projections split, so the UI can label the two blocks and
// a new venture can legitimately omit the actuals.
export const ACTUAL_PERIOD_KEYS = ['fy3a', 'fy2a', 'fy1a'];
export const PROJECTION_PERIOD_KEYS = ['y1p', 'y2p', 'y3p', 'y4p', 'y5p'];

// The eight rows exactly as printed on page 4, in order. `kind` is 'input'
// (captured) or 'derived' (calculated from other rows, never typed).
export const FINANCIAL_ROWS = [
  { key: 'revenue',         label: 'Revenue',            kind: 'input',   unit: 'AED mn' },
  { key: 'growth',          label: 'Growth %',           kind: 'derived', unit: '%',      decimals: 1 },
  { key: 'ebitda',          label: 'EBITDA',             kind: 'input',   unit: 'AED mn' },
  { key: 'ebitda_margin',   label: 'EBITDA margin %',    kind: 'derived', unit: '%',      decimals: 1 },
  { key: 'net_income',      label: 'Net income',         kind: 'input',   unit: 'AED mn' },
  { key: 'capex',           label: 'Capex',              kind: 'input',   unit: 'AED mn' },
  { key: 'free_cash_flow',  label: 'Free cash flow',     kind: 'derived', unit: 'AED mn' },
  { key: 'net_debt_ebitda', label: 'Net debt / EBITDA',  kind: 'input',   unit: 'x',      decimals: 2 },
];

export const FINANCIAL_ROW_KEYS = FINANCIAL_ROWS.map((r) => r.key);
export const FINANCIAL_INPUT_KEYS = FINANCIAL_ROWS.filter((r) => r.kind === 'input').map((r) => r.key);
export const FINANCIAL_DERIVED_KEYS = FINANCIAL_ROWS.filter((r) => r.kind === 'derived').map((r) => r.key);

// Auxiliary inputs that are not rows of the printed table but let a ratio be
// derived instead of typed: Net debt feeds Net debt / EBITDA; an explicit
// free_cash_flow / net_debt_ebitda value overrides the derivation.
export const FINANCIAL_AUX_KEYS = ['net_debt', 'free_cash_flow', 'net_debt_ebitda'];

export function isNewVenture(opportunityType) {
  return opportunityType === 'greenfield';
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals) {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** (decimals ?? 2);
  return Math.round(value * f) / f;
}

// Growth % for a period from this period's revenue against the prior period's.
function growthFor(revenue, periodKey) {
  const idx = FINANCIAL_PERIOD_KEYS.indexOf(periodKey);
  if (idx <= 0) return null;
  const prev = revenue[FINANCIAL_PERIOD_KEYS[idx - 1]];
  const curr = revenue[periodKey];
  if (prev === null || curr === null || prev === 0) return null;
  return round(((curr - prev) / Math.abs(prev)) * 100, 1);
}

// Normalise any stored financials block to a { rowKey: { periodKey: value } }
// matrix, tolerating both a nested object and (for a single value) a scalar.
function normalise(matrix = {}) {
  const out = {};
  for (const key of [...FINANCIAL_ROW_KEYS, ...FINANCIAL_AUX_KEYS]) {
    const row = matrix[key];
    const periods = {};
    for (const p of FINANCIAL_PERIOD_KEYS) periods[p] = null;
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const p of FINANCIAL_PERIOD_KEYS) periods[p] = num(row[p]);
    }
    out[key] = periods;
  }
  return out;
}

// Fill the derived rows (Growth %, EBITDA margin %, Free cash flow, and
// Net debt / EBITDA when a Net debt line is present). An explicitly captured
// value always wins over the derivation, so a model that disagrees with the
// simple formula can be recorded without being overwritten.
export function deriveFinancials(matrix = {}) {
  const src = normalise(matrix);
  const derived = {};
  for (const key of FINANCIAL_ROW_KEYS) {
    derived[key] = { ...src[key] };
  }
  for (const p of FINANCIAL_PERIOD_KEYS) {
    derived.growth[p] = src.growth[p] !== null ? src.growth[p] : growthFor(src.revenue, p);

    const rev = src.revenue[p];
    const ebitda = src.ebitda[p];
    derived.ebitda_margin[p] = src.ebitda_margin[p] !== null
      ? src.ebitda_margin[p]
      : (rev ? round((ebitda / rev) * 100, 1) : null);

    derived.free_cash_flow[p] = src.free_cash_flow[p] !== null
      ? src.free_cash_flow[p]
      : (ebitda !== null && src.capex[p] !== null ? round(ebitda - src.capex[p], 2) : null);

    const netDebt = src.net_debt[p];
    derived.net_debt_ebitda[p] = src.net_debt_ebitda[p] !== null
      ? src.net_debt_ebitda[p]
      : (netDebt !== null && ebitda ? round(netDebt / ebitda, 2) : null);
  }
  return derived;
}

// True when a period has at least one captured value, so the table can show a
// column and completeness can distinguish 'blank actuals' from 'missing row'.
export function periodHasData(matrix = {}, periodKey) {
  const src = normalise(matrix);
  return [...FINANCIAL_ROW_KEYS, ...FINANCIAL_AUX_KEYS].some((k) => src[k][periodKey] !== null);
}

// Present-count per row across the columns that carry any data, for the
// capture-progress indicator. Derived rows count as present when derivable.
export function financialProgress(matrix = {}, { newVenture = false } = {}) {
  const derived = deriveFinancials(matrix);
  const keys = newVenture ? PROJECTION_PERIOD_KEYS : FINANCIAL_PERIOD_KEYS;
  const rows = FINANCIAL_ROWS.map((row) => {
    const present = keys.filter((p) => derived[row.key][p] !== null).length;
    return { key: row.key, label: row.label, kind: row.kind, present, total: keys.length, complete: present === keys.length };
  });
  const present = rows.reduce((s, r) => s + r.present, 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return { rows, present, total, progress: total === 0 ? 0 : Math.round((present / total) * 100) };
}

// Evaluate the page-4 financials for an opportunity. `applies` is always true
// (every opportunity carries the table); `missing` names the input rows that
// are wholly blank. A new venture is not flagged for blank actual columns.
export function evaluateFinancials(data = {}) {
  const matrix = data.financials || {};
  const newVenture = isNewVenture(data.opportunity_type);
  const derived = deriveFinancials(matrix);
  const keys = newVenture ? PROJECTION_PERIOD_KEYS : FINANCIAL_PERIOD_KEYS;
  const missing = [];
  for (const key of FINANCIAL_INPUT_KEYS) {
    const present = keys.some((p) => derived[key][p] !== null);
    if (!present) missing.push(key);
  }
  const progress = financialProgress(matrix, { newVenture });
  return {
    applies: true,
    new_venture: newVenture,
    periods: FINANCIAL_PERIODS,
    period_keys: FINANCIAL_PERIOD_KEYS,
    actual_period_keys: ACTUAL_PERIOD_KEYS,
    projection_period_keys: PROJECTION_PERIOD_KEYS,
    rows: FINANCIAL_ROWS,
    matrix: derived,
    missing,
    complete: missing.length === 0,
    progress: progress.progress,
  };
}

export default {
  FINANCIAL_PERIODS, FINANCIAL_PERIOD_KEYS, ACTUAL_PERIOD_KEYS, PROJECTION_PERIOD_KEYS,
  FINANCIAL_ROWS, FINANCIAL_ROW_KEYS, FINANCIAL_INPUT_KEYS, FINANCIAL_DERIVED_KEYS,
  FINANCIAL_AUX_KEYS, isNewVenture, deriveFinancials, periodHasData,
  financialProgress, evaluateFinancials,
};
