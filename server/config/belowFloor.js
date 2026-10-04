// ---------------------------------------------------------------------------
// Below-floor exception route (W1-02 / BRD INT-03, REQ-RULE-02).
//
// A ticket under the AED 10mn floor may proceed only on the exception route:
// the preparer asserts a clear portfolio synergy AND a base-case IRR of at
// least 35%. Such a case is tagged "Below-floor exception" and always escalated
// to Sirius; it cannot be closed at subsidiary level. Every threshold, tag and
// message lives here so the gate, the form, the submit route and the tests read
// one source (REQ-RULE-10).
// ---------------------------------------------------------------------------

import { MIN_COMMITMENT_AED_MN, BELOW_FLOOR_EXCEPTION_IRR, clearsFloor } from './intakeConfig.js';

// The persisted tag. Sits on the opportunity's data so every downstream view
// (screening board, memo, audit) can see the case took the exception route.
export const BELOW_FLOOR_TAG = 'below_floor_exception';

// The two financial inputs the route requires. IRR is read from the standard
// financials field; the synergy statement is a dedicated below-floor field.
export const BELOW_FLOOR_FIELDS = {
  synergy: 'below_floor_synergy_case',
  irr: 'return_irr_base',
};

export const BELOW_FLOOR_MESSAGES = {
  synergy_required:
    'The below-floor exception needs a portfolio-synergy statement: describe the cost, revenue or strategic synergy the ticket unlocks for the group.',
  irr_required:
    "The below-floor exception needs a base-case IRR of at least " + BELOW_FLOOR_EXCEPTION_IRR + "%. Raise the return or take the standard floor route.",
  escalated:
    'Tagged "Below-floor exception" and escalated to Sirius. The case cannot be closed at subsidiary level.',
};

export const BELOW_FLOOR_ESCALATION = {
  org_id: 'org-sirius-international-holding-limited',
  note: 'Below-floor exception (INT-03): requires Sirius investment-team review before any decision.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function isBelowFloor(value) {
  if (blank(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && !clearsFloor(n);
}

/**
 * Evaluate the below-floor exception route for an opportunity's data. Pure.
 *
 * Returns null when the ticket is not below the floor (the route does not
 * apply). Below the floor it returns a decision the gate, the submit route and
 * the UI all read:
 *
 *   applies      - true, the ticket is sub-floor
 *   exception    - the preparer asserts a portfolio synergy
 *   qualifying   - exception asserted AND a synergy statement present AND the
 *                  base IRR clears the >= 35% bar
 *   satisfied    - a sub-floor ticket that may proceed (qualifying)
 *   stops        - reasons the route is not yet satisfied, each with a message
 *   tag          - the tag to persist when the route is taken
 *   escalated    - true when the case must go to Sirius
 */
export function evaluateBelowFloor(data = {}) {
  const commitment = data.total_commitment_aed;
  if (!isBelowFloor(commitment)) return null;

  const exception = ['true', 'yes', 'y', '1', true].includes(
    typeof data[BELOW_FLOOR_TAG] === 'string' ? data[BELOW_FLOOR_TAG].trim().toLowerCase() : data[BELOW_FLOOR_TAG]
  );
  const synergy = data[BELOW_FLOOR_FIELDS.synergy];
  const irr = data[BELOW_FLOOR_FIELDS.irr];

  const stops = [];
  if (exception) {
    if (blank(synergy)) stops.push({ code: 'synergy_required', message: BELOW_FLOOR_MESSAGES.synergy_required });
    const irrNum = blank(irr) ? NaN : Number(irr);
    if (!Number.isFinite(irrNum) || irrNum < BELOW_FLOOR_EXCEPTION_IRR) {
      stops.push({ code: 'irr_required', message: BELOW_FLOOR_MESSAGES.irr_required });
    }
  } else {
    stops.push({ code: 'no_exception', message: 'Choose the below-floor exception route to proceed below the floor.' });
  }

  const qualifying = exception && stops.length === 0;
  return {
    applies: true,
    exception,
    qualifying,
    satisfied: qualifying,
    floor_aed_mn: MIN_COMMITMENT_AED_MN,
    irr_threshold: BELOW_FLOOR_EXCEPTION_IRR,
    irr: blank(irr) ? null : Number(irr),
    synergy: blank(synergy) ? null : String(synergy),
    stops,
    tag: BELOW_FLOOR_TAG,
    escalated: exception,
  };
}

export default {
  BELOW_FLOOR_TAG, BELOW_FLOOR_FIELDS, BELOW_FLOOR_MESSAGES, BELOW_FLOOR_ESCALATION,
  isBelowFloor, evaluateBelowFloor,
};
