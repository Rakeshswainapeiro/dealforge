// ---------------------------------------------------------------------------
// Entry valuation and exit (W2-08 / FIN-09, REQ-FIN-09).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "Entry valuation and
// exit". Entry valuation is captured as structured fields (basis: EV /
// equity value, the amount, the multiple and the method), a comparable set of
// 3-5 names, and the exit / value-realisation route, timing and target multiple.
// Accept criteria: "Captured as structured fields; comps list allows 3-5 names."
//
// The comparables are a nested list (data.valuation.comparables =
// [{name, metric, multiple}]) so the memo renders them as a table rather than a
// wall of text; the entry and exit figures stay flat capture fields. This
// module is the single place that turns the capture into the structured result
// the gate, the form and the Sirius memo all read.
//
// Advisory only — matching the financials workstream's flag-don't-discard
// pattern: a partially captured valuation raises flags and a message, it never
// discards the capture or blocks submission on its own.
//
// Pure functions only — no database, no network. See evaluateValuation().
// ---------------------------------------------------------------------------

// How the entry figure is expressed: enterprise value or equity value.
export const VALUATION_BASIS = [
  { value: 'ev', label: 'Enterprise value (EV)' },
  { value: 'equity', label: 'Equity value' },
];

export const VALUATION_BASIS_VALUES = VALUATION_BASIS.map((b) => b.value);

// The valuation method used to arrive at the entry figure.
export const VALUATION_METHODS = [
  { value: 'trading_comps', label: 'Trading comparables' },
  { value: 'precedent_transactions', label: 'Precedent transactions' },
  { value: 'dcf', label: 'Discounted cash flow' },
  { value: 'asset_based', label: 'Asset-based' },
  { value: 'other', label: 'Other (state in the rationale)' },
];

export const VALUATION_METHOD_VALUES = VALUATION_METHODS.map((m) => m.value);

// The comparable set must carry at least three and no more than five names.
export const COMPARABLE_MIN = 3;
export const COMPARABLE_MAX = 5;

// The flat capture keys owned by this requirement, plus the nested comparables
// key. entry_valuation_aed and entry_multiple pre-date this workstream and are
// reused rather than renamed, so existing captures keep working.
export const VALUATION_FIELDS = {
  basis: 'entry_valuation_basis',
  amount: 'entry_valuation_aed',
  multiple: 'entry_multiple',
  method: 'entry_valuation_method',
  comparables: 'valuation_comparables',
  exit_route: 'exit_route',
  exit_timing: 'exit_timing',
  exit_multiple: 'exit_multiple',
};

export const VALUATION_MESSAGES = {
  entry_required:
    'Entry valuation not captured: record the amount, the basis (EV or equity value) and the multiple.',
  basis_required: 'Entry valuation basis is missing: state whether the figure is EV or equity value.',
  method_required: 'Valuation method is missing: state how the entry figure was derived.',
  comps_incomplete:
    'Comparable set incomplete: capture between ' + COMPARABLE_MIN + ' and ' + COMPARABLE_MAX + ' comparable names.',
  comps_too_many:
    'Comparable set has more than ' + COMPARABLE_MAX + ' names: trim it to between ' + COMPARABLE_MIN + ' and ' + COMPARABLE_MAX + '.',
  exit_required: 'Exit / value-realisation route and timing not captured.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const text = (v) => (blank(v) ? null : String(v).trim());

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Normalise the comparables block (array, or keyed object) into ordered rows,
// keeping only rows that name a comparable.
function normalizeComparables(list) {
  const out = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const name = text(entry.name);
      if (!name) continue;
      out.push({ name, metric: text(entry.metric), multiple: num(entry.multiple) });
    }
  } else if (list && typeof list === 'object') {
    for (const [key, entry] of Object.entries(list)) {
      const name = text(entry?.name) || (blank(key) ? null : String(key));
      if (!name) continue;
      out.push({ name, metric: text(entry?.metric), multiple: num(entry?.multiple) });
    }
  }
  return out;
}

/**
 * Evaluate the entry valuation and exit capture for an opportunity's data. Pure.
 *
 * @param {object} data the opportunity data (flat capture fields + valuation block)
 *
 * Returns:
 *   applies          - true, this requirement is always evaluated
 *   entry            - { amount, basis, basis_valid, multiple, method, method_valid, present }
 *   comparables      - the normalised comparable rows
 *   comparable_count - how many comparable names were captured
 *   comparables_ok   - true when the count is within COMPARABLE_MIN..COMPARABLE_MAX
 *   exit             - { route, timing, multiple, present }
 *   captured         - any part of the entry / exit capture is present
 *   complete         - the full structured capture is present (advisory signal)
 *   flags            - advisory observations, each with a reason and a message
 *   message          - a summary of the outstanding items, or null when complete
 */
export function evaluateValuation(data = {}) {
  const block = data[VALUATION_FIELDS.comparables] && typeof data[VALUATION_FIELDS.comparables] === 'object'
    ? data[VALUATION_FIELDS.comparables]
    : (data.valuation && typeof data.valuation === 'object' ? data.valuation : {});

  const amount = num(data[VALUATION_FIELDS.amount]);
  const basis = text(data[VALUATION_FIELDS.basis]);
  const multiple = num(data[VALUATION_FIELDS.multiple]);
  const method = text(data[VALUATION_FIELDS.method]);
  const basisValid = basis !== null && VALUATION_BASIS_VALUES.includes(basis);
  const methodValid = method !== null && VALUATION_METHOD_VALUES.includes(method);

  const entryPresent = amount !== null || multiple !== null || basis !== null || method !== null;
  const entryComplete = amount !== null && basisValid && multiple !== null && methodValid;

  const comparables = normalizeComparables(block.comparables || block);
  const comparableCount = comparables.length;
  const comparablesOk = comparableCount >= COMPARABLE_MIN && comparableCount <= COMPARABLE_MAX;

  const route = text(data[VALUATION_FIELDS.exit_route]);
  const timing = text(data[VALUATION_FIELDS.exit_timing]);
  const exitMultiple = num(data[VALUATION_FIELDS.exit_multiple]);
  const exitPresent = route !== null || timing !== null || exitMultiple !== null;
  const exitComplete = route !== null && timing !== null;

  const captured = entryPresent || comparableCount > 0 || exitPresent;

  const flags = [];
  if (entryPresent && amount === null) {
    flags.push({ reason: 'entry_amount_missing', key: VALUATION_FIELDS.amount, message: VALUATION_MESSAGES.entry_required });
  }
  if (entryPresent && !basisValid) {
    flags.push({ reason: 'entry_basis_missing', key: VALUATION_FIELDS.basis, message: VALUATION_MESSAGES.basis_required });
  }
  if (entryPresent && !methodValid) {
    flags.push({ reason: 'entry_method_missing', key: VALUATION_FIELDS.method, message: VALUATION_MESSAGES.method_required });
  }
  if (comparableCount > 0 && comparableCount < COMPARABLE_MIN) {
    flags.push({
      reason: 'comps_incomplete', key: VALUATION_FIELDS.comparables,
      count: comparableCount, message: VALUATION_MESSAGES.comps_incomplete,
    });
  }
  if (comparableCount > COMPARABLE_MAX) {
    flags.push({
      reason: 'comps_too_many', key: VALUATION_FIELDS.comparables,
      count: comparableCount, message: VALUATION_MESSAGES.comps_too_many,
    });
  }
  if (exitPresent && !exitComplete) {
    flags.push({ reason: 'exit_incomplete', key: VALUATION_FIELDS.exit_route, message: VALUATION_MESSAGES.exit_required });
  }

  const complete = entryComplete && comparablesOk && exitComplete;

  const messages = [];
  if (!captured) {
    messages.push('Entry valuation and exit not captured.');
  } else if (!complete) {
    for (const f of flags) messages.push(f.message);
  }
  const message = messages.length ? messages.join(' ') : null;

  return {
    applies: true,
    entry: {
      amount,
      basis: basisValid ? basis : (basis || null),
      basis_valid: basisValid,
      multiple,
      method: methodValid ? method : (method || null),
      method_valid: methodValid,
      present: entryPresent,
      complete: entryComplete,
    },
    comparables,
    comparable_count: comparableCount,
    comparables_ok: comparablesOk,
    comparable_min: COMPARABLE_MIN,
    comparable_max: COMPARABLE_MAX,
    exit: {
      route,
      timing,
      multiple: exitMultiple,
      present: exitPresent,
      complete: exitComplete,
    },
    captured,
    complete,
    flags,
    message,
  };
}

// A display label for the entry basis ('EV' / 'equity value').
export function basisLabel(value) {
  return VALUATION_BASIS.find((b) => b.value === value)?.label || null;
}

export function methodLabel(value) {
  return VALUATION_METHODS.find((m) => m.value === value)?.label || null;
}

export default {
  VALUATION_BASIS, VALUATION_BASIS_VALUES, VALUATION_METHODS, VALUATION_METHOD_VALUES,
  COMPARABLE_MIN, COMPARABLE_MAX, VALUATION_FIELDS, VALUATION_MESSAGES,
  evaluateValuation, basisLabel, methodLabel,
};

