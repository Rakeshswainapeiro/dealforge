// ---------------------------------------------------------------------------
// Reporting currency and per-opportunity FX rate (W2-10 / NFR-08).
//
// Source of truth: the Phase-1 BRD, Non-functional — "Currency and units":
// "Figures in AED mn by default, with USD shown where the Sirius mandate uses
// USD; FX rate recorded per opportunity." Accept criterion: "Currency and unit
// shown on every financial field; FX rate recorded."
//
// The whole page-4 financial matrix is captured in millions, so the unit is
// always 'mn'. The reporting currency is AED by default. When a deal is
// reported in USD, the preparer records the FX rate used (AED per USD) so every
// figure in that opportunity is reproducible against the AED base. The rate is
// advisory evidence: a USD opportunity without a rate is flagged, never
// blocked, matching the financials workstream's flag-don't-discard pattern.
//
// Pure functions only — no database, no network. See evaluateCurrency().
// ---------------------------------------------------------------------------

export const BASE_CURRENCY = 'AED';
export const BASE_UNIT = 'mn';

// The currencies a deal may be reported in, in the order shown. AED is the
// Sirius base; USD is used where the Sirius mandate works in dollars.
export const REPORTING_CURRENCIES = [
  { value: 'AED', label: 'AED — UAE dirham (Sirius base)' },
  { value: 'USD', label: 'USD — US dollar' },
];

export const REPORTING_CURRENCY_VALUES = REPORTING_CURRENCIES.map((c) => c.value);

// The capture keys: the chosen reporting currency and the FX rate used (AED per
// USD) when that currency is not the base.
export const CURRENCY_FIELDS = {
  currency: 'reporting_currency',
  fx_rate: 'fx_rate_usd_aed',
};

export const FX_RATE_MISSING_MESSAGE =
  'This deal is reported in USD but no FX rate is recorded. Record the AED per USD rate used so every figure is reproducible against the AED base.';
export const FX_RATE_INVALID_MESSAGE =
  'The recorded FX rate is not a positive number. Record the AED per USD rate used.';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function num(value) {
  if (blank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Normalise the chosen currency onto its canonical code, defaulting to the base.
export function normaliseCurrency(value) {
  if (blank(value)) return BASE_CURRENCY;
  const code = String(value).trim().toUpperCase();
  return REPORTING_CURRENCY_VALUES.includes(code) ? code : BASE_CURRENCY;
}

/**
 * Evaluate the reporting currency and FX capture for an opportunity's data.
 * Pure.
 *
 * @param {object} data the opportunity data (flat capture fields)
 *
 * Returns:
 *   currency        - the canonical reporting currency code (default 'AED')
 *   unit            - the unit label ('mn')
 *   is_base         - true when the currency is the AED base
 *   fx_rate         - the recorded AED-per-USD rate, or null
 *   fx_required     - true when a rate is needed (a non-base currency)
 *   fx_present      - whether a rate was captured
 *   fx_valid        - whether the captured rate is a positive number
 *   base_currency   - the base currency ('AED')
 *   label           - the currency + unit label ('AED mn' / 'USD mn')
 *   complete        - true when no rate is needed or a valid rate is present
 *   flags           - advisory observations
 *   message         - a summary of the outstanding item, or null
 */
export function evaluateCurrency(data = {}) {
  const currency = normaliseCurrency(data[CURRENCY_FIELDS.currency]);
  const isBase = currency === BASE_CURRENCY;
  const fxRate = num(data[CURRENCY_FIELDS.fx_rate]);
  const fxRequired = !isBase;
  const fxPresent = !blank(data[CURRENCY_FIELDS.fx_rate]);
  const fxValid = fxRate !== null && fxRate > 0;
  const complete = !fxRequired || (fxPresent && fxValid);

  const flags = [];
  if (fxRequired && !fxPresent) {
    flags.push({ reason: 'fx_rate_missing', key: CURRENCY_FIELDS.fx_rate, message: FX_RATE_MISSING_MESSAGE });
  } else if (fxRequired && !fxValid) {
    flags.push({ reason: 'fx_rate_invalid', key: CURRENCY_FIELDS.fx_rate, message: FX_RATE_INVALID_MESSAGE });
  }

  const label = currency + ' ' + BASE_UNIT;
  const rateLabel = fxRequired && fxValid
    ? label + ' (@ ' + fxRate + ' AED/USD)'
    : label;

  let message = null;
  if (fxRequired && !fxPresent) message = FX_RATE_MISSING_MESSAGE;
  else if (fxRequired && !fxValid) message = FX_RATE_INVALID_MESSAGE;

  return {
    currency,
    unit: BASE_UNIT,
    is_base: isBase,
    fx_rate: fxRate,
    fx_required: fxRequired,
    fx_present: fxPresent,
    fx_valid: fxValid,
    base_currency: BASE_CURRENCY,
    label,
    rate_label: rateLabel,
    complete,
    flags,
    message,
  };
}

// Convert an amount in the opportunity's reporting currency into the AED base.
// A base-currency amount is returned unchanged; a USD amount is multiplied by
// the recorded rate. Returns null when a conversion is needed but impossible.
export function toBaseCurrency(value, { currency, fx_rate: fxRate } = {}) {
  const amount = num(value);
  if (amount === null) return null;
  const code = normaliseCurrency(currency);
  if (code === BASE_CURRENCY) return amount;
  const rate = num(fxRate);
  if (rate === null || rate <= 0) return null;
  return Math.round(amount * rate * 1e6) / 1e6;
}

export default {
  BASE_CURRENCY, BASE_UNIT, REPORTING_CURRENCIES, REPORTING_CURRENCY_VALUES,
  CURRENCY_FIELDS, FX_RATE_MISSING_MESSAGE, FX_RATE_INVALID_MESSAGE,
  normaliseCurrency, evaluateCurrency, toBaseCurrency,
};

