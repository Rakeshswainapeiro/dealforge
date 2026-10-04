// ---------------------------------------------------------------------------
// Automatic disqualifier flags (W3-04 / BRD SCR-05).
//
// Source of truth: the Phase-1 BRD, "Automatic disqualifier flags". The system
// raises a named disqualifier flag on the record when any of the five automatic
// disqualifiers is present:
//
//   1. sanctions / PEP exposure without mitigation
//   2. no enforceable minority protections
//   3. valuation more than 30-40% above the tightest comparable
//   4. undisclosed related party found after Gate 1
//   5. non-transferable licence
//
// A flag is prominent on the record and in the memo. Clearing a flag requires a
// named reviewer and a reason (SCR-05). The system never clears its own flag.
// This module is pure - the effective theme and every message are passed in, so
// the gate, the form, the memo and the tests read one source (REQ-RULE-10).
// ---------------------------------------------------------------------------

export const DISQUALIFIER_VERSION = 'DQ-01.1';

export const DISQUALIFIER_STATUSES = ['clear', 'flagged'];
// A reviewer clears a flag with a named reviewer and a reason of this length.
export const DISQUALIFIER_CLEAR_REASON_MIN = 10;
export const DISQUALIFIER_REVIEW_TAG = 'disqualifier_review';

// The valuation premium over the tightest comparable that trips the third
// disqualifier. The BRD states a 30-40% band; 35% is the mid-point threshold and
// is configurable here in one place.
export const DISQUALIFIER_VALUATION_PREMIUM_MIN = 30;
export const DISQUALIFIER_VALUATION_PREMIUM_MAX = 40;
export const DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD = 35;

// The manual-capture inputs for the disqualifiers that a person records rather
// than the system deriving. None is a required capture field (the documented
// 14-key minimum stands); an unrecorded disqualifier is a flag when the derived
// signal is present, and not-evaluated otherwise (never a silent clear).
export const DISQUALIFIER_FIELDS = {
  sanctions_pep: 'disqualifier_sanctions_pep',
  sanctions_pep_note: 'disqualifier_sanctions_pep_note',
  minority_protections: 'disqualifier_minority_protections',
  minority_protections_note: 'disqualifier_minority_protections_note',
  valuation_premium_pct: 'disqualifier_valuation_premium_pct',
  valuation_premium_note: 'disqualifier_valuation_premium_note',
  undisclosed_related_party: 'disqualifier_undisclosed_related_party',
  undisclosed_related_party_note: 'disqualifier_undisclosed_related_party_note',
  licence_transferable: 'disqualifier_licence_transferable',
  licence_transferable_note: 'disqualifier_licence_transferable_note',
};

// The five disqualifiers in BRD order.
export const DISQUALIFIER_ITEMS = [
  {
    key: 'sanctions_pep', label: 'Sanctions / PEP exposure without mitigation', group: 'compliance', order: 1,
    description: 'A sanctions or politically-exposed-person exposure is present and no mitigation is on the record.',
    manual: true, field: DISQUALIFIER_FIELDS.sanctions_pep, note_field: DISQUALIFIER_FIELDS.sanctions_pep_note,
  },
  {
    key: 'minority_protections', label: 'No enforceable minority protections', group: 'terms', order: 2,
    description: 'The proposed terms carry no enforceable minority protections.',
    manual: true, field: DISQUALIFIER_FIELDS.minority_protections, note_field: DISQUALIFIER_FIELDS.minority_protections_note,
  },
  {
    key: 'valuation_premium', label: 'Valuation more than 30-40% above the tightest comparable', group: 'valuation', order: 3,
    description: 'The entry valuation exceeds the tightest comparable by more than the configured premium.',
    manual: true, field: DISQUALIFIER_FIELDS.valuation_premium_pct, note_field: DISQUALIFIER_FIELDS.valuation_premium_note,
  },
  {
    key: 'undisclosed_related_party', label: 'Undisclosed related party found after Gate 1', group: 'governance', order: 4,
    description: 'A related party surfaced after Gate 1 that was not disclosed on the record.',
    manual: true, field: DISQUALIFIER_FIELDS.undisclosed_related_party, note_field: DISQUALIFIER_FIELDS.undisclosed_related_party_note,
  },
  {
    key: 'licence_transfer', label: 'Non-transferable licence', group: 'regulatory', order: 5,
    description: 'A material licence the deal depends on cannot be transferred to the acquirer.',
    manual: true, field: DISQUALIFIER_FIELDS.licence_transferable, note_field: DISQUALIFIER_FIELDS.licence_transferable_note,
  },
];

export const DISQUALIFIER_KEYS = DISQUALIFIER_ITEMS.map((i) => i.key);

export const DISQUALIFIER_MESSAGES = {
  clear: 'No automatic disqualifier flag is raised.',
  flagged:
    'One or more automatic disqualifiers are flagged. A flag is prominent on the record and in the memo; clearing it requires a named reviewer and a reason.',
  reason_required: 'A written reason of at least ' + DISQUALIFIER_CLEAR_REASON_MIN + ' characters and a named reviewer are required to clear a disqualifier flag.',
  reviewer_required: 'A named reviewer is required to clear a disqualifier flag.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

const YES = ['yes', 'true', 'y', '1', 'present', 'flagged'];
const NO = ['no', 'false', 'n', '0', 'none', 'clear', 'mitigated'];

function makeItem(spec, { status, rationale, evidence_refs = [], detail = {} }) {
  return {
    key: spec.key,
    label: spec.label,
    group: spec.group,
    order: spec.order,
    manual: Boolean(spec.manual),
    description: spec.description,
    status,
    flagged: status === 'flagged',
    evaluated: status !== 'not_evaluated',
    rationale,
    evidence_refs,
    detail,
  };
}

const clearItem = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'clear', rationale, evidence_refs: refs, detail });
const flagItem = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'flagged', rationale, evidence_refs: refs, detail });
const naItem = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'not_evaluated', rationale, evidence_refs: refs, detail });

function refsFor(spec, data) {
  const refs = [];
  const raw = data[spec.field];
  const note = spec.note_field ? data[spec.note_field] : null;
  if (!blank(raw)) refs.push({ type: 'confirmation', key: spec.field, label: spec.label + ': ' + raw });
  if (!blank(note)) refs.push({ type: 'note', key: spec.note_field, label: String(note) });
  return refs;
}

// A yes/no disqualifier where a 'yes' (or an unmitigated 'present') raises the
// flag and a 'no' clears it. Any other value leaves it flagged for a person.
function yesNoItem(spec, data, { flaggedRationale, clearRationale, unrecordedRationale, derivedFlag = false, derivedRationale = null }) {
  const raw = data[spec.field];
  const refs = refsFor(spec, data);
  const detail = { value: blank(raw) ? null : raw, note: spec.note_field && !blank(data[spec.note_field]) ? String(data[spec.note_field]) : null };
  if (blank(raw)) {
    if (derivedFlag) return flagItem(spec, derivedRationale || flaggedRationale, refs, detail);
    return naItem(spec, unrecordedRationale, refs, detail);
  }
  const value = norm(raw);
  if (YES.includes(value)) return flagItem(spec, flaggedRationale, refs, detail);
  if (NO.includes(value)) return clearItem(spec, clearRationale, refs, detail);
  return flagItem(spec, 'The recorded value \u2018' + raw + '\u2019 is not recognised; record whether the disqualifier is present.', refs, detail);
}

/**
 * Evaluate the five automatic disqualifiers. Pure: no database, no network.
 *
 * @param {object} data        the opportunity data
 * @param {object} options
 * @param {object} options.relatedParty   the related-party signal (or null)
 *
 * Returns the five ordered disqualifiers, the flagged set, and a summary. A flag
 * is raised, never cleared, by the system: clearing needs a named reviewer and
 * reason, recorded through the review route.
 */
export function evaluateDisqualifiers(data = {}, { relatedParty = null } = {}) {
  const spec = (key) => DISQUALIFIER_ITEMS.find((i) => i.key === key);

  // The related-party signal is derived: an undisclosed related party found
  // after Gate 1 is disqualifier 4. The opportunity's declared related_party
  // disclosure and the review record feed the derived flag.
  const rpReview = relatedParty && typeof relatedParty === 'object' ? relatedParty : null;
  const rpFlagged = rpReview
    ? ['flagged', 'open', 'detected', 'undisclosed'].includes(norm(rpReview.status || rpReview.state))
      && !rpReview.disclosed
    : false;

  const items = [
    yesNoItem(spec('sanctions_pep'), data, {
      flaggedRationale: 'A sanctions / PEP exposure is recorded without mitigation; the disqualifier is flagged.',
      clearRationale: 'No unmitigated sanctions / PEP exposure is recorded.',
      unrecordedRationale: 'No sanctions / PEP confirmation is recorded, so this disqualifier is not evaluated.',
    }),
    yesNoItem(spec('minority_protections'), data, {
      flaggedRationale: 'No enforceable minority protections are recorded; the disqualifier is flagged.',
      clearRationale: 'Enforceable minority protections are recorded.',
      unrecordedRationale: 'No minority-protections confirmation is recorded, so this disqualifier is not evaluated.',
    }),
    valuationPremiumItem(spec('valuation_premium'), data),
    yesNoItem(spec('undisclosed_related_party'), data, {
      flaggedRationale: 'An undisclosed related party was found after Gate 1; the disqualifier is flagged.',
      clearRationale: 'No undisclosed related party found after Gate 1.',
      unrecordedRationale: 'No undisclosed-related-party confirmation is recorded and no related-party signal is on the record, so this disqualifier is not evaluated.',
      derivedFlag: rpFlagged,
      derivedRationale: 'A related-party signal is on the record without a disclosure; the disqualifier is flagged.',
    }),
    yesNoItem(spec('licence_transfer'), data, {
      flaggedRationale: 'A material licence is recorded as non-transferable; the disqualifier is flagged.',
      clearRationale: 'The material licence is recorded as transferable.',
      unrecordedRationale: 'No licence-transferability confirmation is recorded, so this disqualifier is not evaluated.',
    }),
  ].sort((a, b) => a.order - b.order);

  const flagged = items.filter((i) => i.status === 'flagged');
  const notEvaluated = items.filter((i) => i.status === 'not_evaluated');

  const review = data[DISQUALIFIER_REVIEW_TAG] && typeof data[DISQUALIFIER_REVIEW_TAG] === 'object'
    ? data[DISQUALIFIER_REVIEW_TAG]
    : null;
  // Only flags that are not cleared in the review count as open. Clearing is per
  // disqualifier key, needs a named reviewer and a reason, and is audited.
  const cleared = new Set(
    Array.isArray(review?.clears || review?.cleared)
      ? (review.clears || review.cleared).filter((c) => c && c.reviewer && String(c.reason || '').trim().length >= DISQUALIFIER_CLEAR_REASON_MIN).map((c) => c.key)
      : []
  );
  const openFlags = flagged.filter((i) => !cleared.has(i.key));

  let message;
  if (openFlags.length === 0 && flagged.length === 0) message = DISQUALIFIER_MESSAGES.clear;
  else if (openFlags.length === 0) message = 'All automatic disqualifier flags have a named clear with a reason on the record. ' + DISQUALIFIER_MESSAGES.clear;
  else message = DISQUALIFIER_MESSAGES.flagged;

  return {
    version: DISQUALIFIER_VERSION,
    applies: true,
    items,
    item_count: items.length,
    flagged: flagged.map((i) => ({ key: i.key, label: i.label, rationale: i.rationale })),
    open_flags: openFlags.map((i) => ({ key: i.key, label: i.label, rationale: i.rationale })),
    not_evaluated: notEvaluated.map((i) => i.key),
    has_open_flag: openFlags.length > 0,
    review,
    cleared: [...cleared],
    complete: notEvaluated.length === 0,
    message,
  };
}

// 3. Valuation more than the premium above the tightest comparable. Derived from
// the recorded premium percentage; unrecorded leaves it not-evaluated.
function valuationPremiumItem(spec, data) {
  const raw = data[spec.field];
  const refs = refsFor(spec, data);
  const detail = { value: blank(raw) ? null : raw, threshold_pct: DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD, note: null };
  if (blank(raw)) {
    return naItem(spec, 'No comparable-premium figure is recorded, so this disqualifier is not evaluated.', refs, detail);
  }
  const pct = Number(raw);
  if (!Number.isFinite(pct)) {
    return flagItem(spec, 'The recorded premium \u2018' + raw + '\u2019 is not a number; record the premium over the tightest comparable.', refs, detail);
  }
  if (pct > DISQUALIFIER_VALUATION_PREMIUM_MAX) {
    return flagItem(spec, 'Entry valuation is ' + pct + '% above the tightest comparable, beyond the ' + DISQUALIFIER_VALUATION_PREMIUM_MAX + '% band; the disqualifier is flagged.', refs, detail);
  }
  if (pct >= DISQUALIFIER_VALUATION_PREMIUM_MIN) {
    return flagItem(spec, 'Entry valuation is ' + pct + '% above the tightest comparable, inside the ' + DISQUALIFIER_VALUATION_PREMIUM_MIN + '-' + DISQUALIFIER_VALUATION_PREMIUM_MAX + '% band a reviewer must clear; the disqualifier is flagged.', refs, detail);
  }
  return clearItem(spec, 'Entry valuation is ' + pct + '% above the tightest comparable, within the ' + DISQUALIFIER_VALUATION_PREMIUM_MIN + '% limit.', refs, detail);
}

/**
 * Validate a reviewer clear for one or more disqualifier flags. Pure. Each clear
 * needs a known disqualifier key, a named reviewer and a reason of at least
 * DISQUALIFIER_CLEAR_REASON_MIN characters. Returns the tagged record to persist,
 * or throws a 400-shaped error.
 */
export function buildDisqualifierReview(body = {}, { actor = null, at = null } = {}) {
  const input = Array.isArray(body.clears) ? body.clears : (body.key ? [body] : []);
  if (!input.length) {
    const e = new Error('Provide at least one disqualifier clear with a key, a reviewer and a reason.');
    e.status = 400;
    throw e;
  }
  const clears = input.map((c) => {
    const key = norm(c.key);
    if (!DISQUALIFIER_KEYS.includes(key)) {
      const e = new Error('Unknown disqualifier key \u2018' + (c.key || '') + '\u2019.');
      e.status = 400;
      throw e;
    }
    const reason = String(c.reason || '').trim();
    if (reason.length < DISQUALIFIER_CLEAR_REASON_MIN) {
      const e = new Error(DISQUALIFIER_MESSAGES.reason_required);
      e.status = 400;
      throw e;
    }
    const reviewer = String(c.reviewer || actor?.email || actor?.id || '').trim();
    if (!reviewer) {
      const e = new Error(DISQUALIFIER_MESSAGES.reviewer_required);
      e.status = 400;
      throw e;
    }
    return { key, reviewer, reason };
  });
  return {
    clears,
    by: actor?.email || actor?.id || null,
    at: at || new Date().toISOString(),
  };
}

export default {
  DISQUALIFIER_VERSION, DISQUALIFIER_STATUSES, DISQUALIFIER_CLEAR_REASON_MIN,
  DISQUALIFIER_REVIEW_TAG, DISQUALIFIER_VALUATION_PREMIUM_MIN,
  DISQUALIFIER_VALUATION_PREMIUM_MAX, DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD,
  DISQUALIFIER_FIELDS, DISQUALIFIER_ITEMS, DISQUALIFIER_KEYS, DISQUALIFIER_MESSAGES,
  evaluateDisqualifiers, buildDisqualifierReview,
};
