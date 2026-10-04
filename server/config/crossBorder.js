// ---------------------------------------------------------------------------
// Cross-border considerations (W2-09 / FIN-08, REQ-FIN-08).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "Cross-border
// considerations": "For cross-border deals, FX exposure, withholding tax,
// transfer pricing and repatriation restrictions are captured." Accept
// criterion: "Fields appear when target geography differs from the subsidiary's
// home country."
//
// The four considerations are captured as free-text advisories. The conditional
// behaviour is the point of this requirement: the block applies only when the
// target's geography is a different country from the owning subsidiary's
// registered geography. When the two match, the block is not applicable and
// nothing is demanded. When they differ, each of the four considerations is
// captured; a missing one is flagged, never blocks (matching the financials
// workstream's flag-don't-discard pattern).
//
// Geographies are free text, so both sides are mapped onto a canonical country
// using the GEOGRAPHY_TAGS table (natureOfBusiness.js) before comparison: 'UAE'
// and 'United Arab Emirates' resolve to the same country.
//
// Pure functions only — no database, no network. See evaluateCrossBorder().
// ---------------------------------------------------------------------------

import { GEOGRAPHY_TAGS } from './natureOfBusiness.js';

// The four considerations, in BRD order, keyed by their capture field.
export const CROSS_BORDER_FIELDS = {
  fx: 'cross_border_fx',
  wht: 'cross_border_wht',
  transfer_pricing: 'cross_border_transfer_pricing',
  repatriation: 'cross_border_repatriation',
};

export const CROSS_BORDER_ITEMS = [
  { key: CROSS_BORDER_FIELDS.fx, label: 'FX exposure', short: 'FX', message: 'Record the FX exposure of the target\'s cash flows and how it is hedged.' },
  { key: CROSS_BORDER_FIELDS.wht, label: 'Withholding tax', short: 'WHT', message: 'Record the withholding-tax position on dividends, interest and royalties, and any treaty relief.' },
  { key: CROSS_BORDER_FIELDS.transfer_pricing, label: 'Transfer pricing', short: 'TP', message: 'Record the transfer-pricing position on any intercompany flows and the supporting study.' },
  { key: CROSS_BORDER_FIELDS.repatriation, label: 'Repatriation restrictions', short: 'Repatriation', message: 'Record any repatriation restrictions on capital, dividends or exit proceeds.' },
];

export const CROSS_BORDER_MISSING_MESSAGE =
  'Cross-border considerations incomplete: capture FX exposure, withholding tax, transfer pricing and repatriation restrictions.';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Map a free-text geography onto its canonical country name. A value that is
// already a country key in GEOGRAPHY_TAGS resolves to itself; a value that is
// one of a country's tags (e.g. 'UAE', 'GCC') resolves to that country;
// anything else falls back to its trimmed lower-case form so two identical
// unknowns still compare equal.
export function canonicalCountry(value) {
  if (blank(value)) return null;
  const needle = String(value).trim().toLowerCase();
  for (const [country, tags] of Object.entries(GEOGRAPHY_TAGS)) {
    if (country.toLowerCase() === needle) return country;
    if (tags.some((tag) => tag.toLowerCase() === needle)) return country;
  }
  return needle;
}

// True when two free-text geographies name a different country.
export function isCrossBorder(targetGeography, homeCountry) {
  const target = canonicalCountry(targetGeography);
  const home = canonicalCountry(homeCountry);
  if (!target || !home) return false;
  return target !== home;
}

/**
 * Evaluate the cross-border capture for an opportunity's data. Pure.
 *
 * @param {object} data        the opportunity data (flat capture fields)
 * @param {object} [options]
 * @param {string} [options.homeCountry] the owning subsidiary's registered country
 *
 * Returns:
 *   applies          - true when the target geography differs from home country
 *   target_country   - the canonical target country (or null)
 *   home_country     - the canonical home country (or null)
 *   items            - the four considerations with their captured text and presence
 *   captured         - how many of the four are captured
 *   total            - the number of considerations (4)
 *   complete         - applies and all four are captured (true when not applicable)
 *   flags            - advisory observations (only when applies)
 *   message          - a summary of the outstanding items, or null
 */
export function evaluateCrossBorder(data = {}, { homeCountry = null } = {}) {
  const targetCountry = canonicalCountry(data.geography);
  const home = canonicalCountry(homeCountry);
  const applies = isCrossBorder(data.geography, homeCountry);

  const text = (v) => (blank(v) ? null : String(v).trim());
  const items = CROSS_BORDER_ITEMS.map((item) => {
    const value = text(data[item.key]);
    return { key: item.key, label: item.label, short: item.short, value, present: value !== null };
  });
  const captured = items.filter((i) => i.present).length;
  const complete = !applies || captured === items.length;

  const flags = [];
  if (applies) {
    for (const item of items) {
      if (!item.present) {
        flags.push({
          reason: item.short.toLowerCase().replace(/\s+/g, '_') + '_missing',
          key: item.key,
          label: item.label,
          message: item.message,
        });
      }
    }
  }

  let message = null;
  if (applies && captured < items.length) {
    message = CROSS_BORDER_MISSING_MESSAGE;
  }

  return {
    applies,
    target_country: targetCountry,
    home_country: home,
    items,
    captured,
    total: items.length,
    complete,
    flags,
    message,
  };
}

export default {
  CROSS_BORDER_FIELDS, CROSS_BORDER_ITEMS, CROSS_BORDER_MISSING_MESSAGE,
  canonicalCountry, isCrossBorder, evaluateCrossBorder,
};
