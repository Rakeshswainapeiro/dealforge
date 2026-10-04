// ---------------------------------------------------------------------------
// Gate 1 hard filters (W3-02 / BRD SCR-03, REQ-RULE-02/05).
//
// Source of truth: the Phase-1 BRD, "Gate 1 hard filters". Before a submission
// reaches the screening decision, five Standing filters are evaluated:
//
//   1. designated vertical (or a reasoned exception on the record)
//   2. check size within the deployment band (theme band + entity floor)
//   3. no sanctions / export-control / reputational exposure
//   4. ADGM / DIFC-compatible structuring
//   5. no un-mitigable portfolio conflict
//
// Any failed filter sets the outcome to 'Recommended decline' with the reason.
// The system never rejects on its own (SCR-09): a reviewer confirms the decline
// or overrides it with a written reason, and both are audited. This module is
// pure - thresholds, the effective theme and every message are passed in, so the
// gate, the form, the memo and the tests read one source (REQ-RULE-10).
// ---------------------------------------------------------------------------

export const HARD_FILTER_VERSION = 'HF-01.1';

export const HARD_FILTER_STATUSES = ['pass', 'fail', 'flag', 'not_evaluated'];
export const HARD_FILTER_OUTCOMES = ['proceed', 'recommended_decline'];
// The reviewer either confirms the recommended decline or overrides it. Either
// way a written reason of at least this length is required (SCR-03).
export const HARD_FILTER_REVIEW_DECISIONS = ['confirmed', 'overridden'];
export const HARD_FILTER_REVIEW_REASON_MIN = 10;
export const HARD_FILTER_REVIEW_TAG = 'hard_filter_review';

// The manual-confirmation inputs for the two compliance filters and the
// portfolio-conflict filter. None is a required capture field (the documented
// 14-key minimum stands); an unconfirmed filter is a flag, never a silent pass.
export const HARD_FILTER_FIELDS = {
  sanctions: 'hard_filter_sanctions',
  sanctions_note: 'hard_filter_sanctions_note',
  structuring: 'hard_filter_structuring',
  structuring_note: 'hard_filter_structuring_note',
  portfolio_conflict: 'hard_filter_portfolio_conflict',
  conflict_reviewer: 'hard_filter_conflict_reviewer',
};

// The five filters in BRD order. 'manual' marks a filter confirmed by a person
// rather than derived from structured data.
export const HARD_FILTER_ITEMS = [
  {
    key: 'designated_vertical', label: 'Designated vertical', group: 'strategy', order: 1,
    description: 'The opportunity sits in the subsidiary\u2019s designated vertical, or a reasoned exception is on the record.',
    exception_field: 'theme_exception_reason',
  },
  {
    key: 'check_size', label: 'Check size within the deployment band', group: 'strategy', order: 2,
    description: 'The total commitment sits inside the mandated deployment band and above the entity floor.',
  },
  {
    key: 'sanctions_export', label: 'No sanctions / export-control / reputational exposure', group: 'compliance', order: 3,
    manual: true, field: HARD_FILTER_FIELDS.sanctions, note_field: HARD_FILTER_FIELDS.sanctions_note,
  },
  {
    key: 'structuring', label: 'ADGM / DIFC-compatible structuring', group: 'compliance', order: 4,
    manual: true, field: HARD_FILTER_FIELDS.structuring, note_field: HARD_FILTER_FIELDS.structuring_note,
  },
  {
    key: 'portfolio_conflict', label: 'No un-mitigable portfolio conflict', group: 'portfolio', order: 5,
    field: HARD_FILTER_FIELDS.portfolio_conflict, reviewer_field: HARD_FILTER_FIELDS.conflict_reviewer,
  },
];

export const HARD_FILTER_KEYS = HARD_FILTER_ITEMS.map((i) => i.key);

export const HARD_FILTER_MESSAGES = {
  proceed: 'No hard filter failed. The opportunity may proceed to the screening decision.',
  recommended_decline:
    'One or more hard filters failed. The system recommends decline; a reviewer confirms or overrides with a written reason.',
  awaiting_review:
    'A hard filter failed, so the outcome is Recommended decline. A reviewer must confirm the decline or override it with a written reason.',
  review_confirmed: 'A reviewer confirmed the recommended decline.',
  review_overridden: 'A reviewer overrode the recommended decline.',
  reason_required: 'A written reason of at least ' + HARD_FILTER_REVIEW_REASON_MIN + ' characters is required.',
};

const PENDING_STATUSES = ['flag', 'not_evaluated'];

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function makeItem(spec, { status, rationale, evidence_refs = [], detail = {} }) {
  return {
    key: spec.key,
    label: spec.label,
    group: spec.group,
    order: spec.order,
    manual: Boolean(spec.manual),
    description: spec.description,
    status,
    pending: PENDING_STATUSES.includes(status),
    failed: status === 'fail',
    rationale,
    evidence_refs,
    detail,
  };
}

const pass = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'pass', rationale, evidence_refs: refs, detail });
const fail = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'fail', rationale, evidence_refs: refs, detail });
const flag = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'flag', rationale, evidence_refs: refs, detail });
const na = (spec, rationale, refs = [], detail = {}) => makeItem(spec, { status: 'not_evaluated', rationale, evidence_refs: refs, detail });

// 1. Designated vertical, or a reasoned exception on the record (SCR-03).
function verticalItem(spec, data, theme) {
  const sector = data.sector;
  const themeSector = theme?.sector || null;
  const exceptionReason = data.theme_exception_reason;
  const refs = [];
  if (!blank(sector)) refs.push({ type: 'sector', key: 'sector', label: 'Sector: ' + sector });
  if (themeSector) refs.push({ type: 'theme_sector', key: 'theme_sector', label: 'Designated vertical: ' + themeSector });
  if (!blank(exceptionReason)) refs.push({ type: 'theme_exception', key: 'theme_exception_reason', label: 'Reasoned exception: ' + exceptionReason });
  const detail = { sector: sector ?? null, theme_sector: themeSector, has_theme: Boolean(theme) };

  if (!theme) {
    return na(spec, 'No approved investment theme is configured for the owning subsidiary, so the designated vertical cannot be confirmed.', refs, detail);
  }
  if (blank(sector)) {
    return flag(spec, 'The sector is not captured yet, so the designated-vertical filter cannot be evaluated.', refs, detail);
  }
  if (themeSector && norm(sector) === norm(themeSector)) {
    return pass(spec, 'Sector \u2018' + sector + '\u2019 matches the designated vertical \u2018' + themeSector + '\u2019.', refs, detail);
  }
  if (!blank(exceptionReason)) {
    return pass(spec, 'Sector \u2018' + sector + '\u2019 differs from the designated vertical \u2018' + themeSector + '\u2019, but a reasoned exception is on the record.', refs, detail);
  }
  return fail(spec, 'Sector \u2018' + sector + '\u2019 is outside the designated vertical \u2018' + (themeSector || 'none configured') + '\u2019 and no reasoned exception is on the record.', refs, detail);
}

// 2. Check size within the deployment band (theme band + entity floor).
function sizeItem(spec, data, theme, thresholds) {
  const amount = Number(data.total_commitment_aed);
  const floor = thresholds?.floor_aed != null ? Number(thresholds.floor_aed) : null;
  const themeMin = theme?.min_aed != null ? Number(theme.min_aed) : null;
  const themeMax = theme?.max_aed != null ? Number(theme.max_aed) : null;
  const lower = [floor, themeMin].filter((n) => n != null && Number.isFinite(n));
  const lowerBound = lower.length ? Math.max(...lower) : null;
  const refs = [];
  if (Number.isFinite(amount)) refs.push({ type: 'commitment', key: 'total_commitment_aed', label: 'Total commitment: AED ' + amount + 'mn' });
  if (lowerBound != null) refs.push({ type: 'band', key: 'lower', label: 'Band floor: AED ' + lowerBound + 'mn' });
  if (themeMax != null) refs.push({ type: 'band', key: 'upper', label: 'Band ceiling: AED ' + themeMax + 'mn' });
  const detail = { amount: Number.isFinite(amount) ? amount : null, lower_bound: lowerBound, upper_bound: themeMax, floor_aed: floor };

  if (!Number.isFinite(amount)) {
    return flag(spec, 'The total commitment is not captured yet, so the size filter cannot be evaluated.', refs, detail);
  }
  if (lowerBound == null && themeMax == null) {
    return na(spec, 'No deployment band is configured for the owning subsidiary, so the size filter cannot be evaluated.', refs, detail);
  }
  if (lowerBound != null && amount < lowerBound) {
    return fail(spec, 'Total commitment AED ' + amount + 'mn is below the AED ' + lowerBound + 'mn band floor.', refs, detail);
  }
  if (themeMax != null && amount > themeMax) {
    return fail(spec, 'Total commitment AED ' + amount + 'mn is above the AED ' + themeMax + 'mn band ceiling.', refs, detail);
  }
  return pass(spec, 'Total commitment AED ' + amount + 'mn sits inside the deployment band.', refs, detail);
}

// 3 + 4. Manual compliance confirmations (sanctions / structuring).
function manualItem(spec, data, { passValues, failValues, passRationale, failRationale }) {
  const raw = data[spec.field];
  const note = spec.note_field ? data[spec.note_field] : null;
  const refs = [];
  if (!blank(raw)) refs.push({ type: 'confirmation', key: spec.field, label: spec.label + ': ' + raw });
  if (!blank(note)) refs.push({ type: 'note', key: spec.note_field, label: String(note) });
  const detail = { value: blank(raw) ? null : raw, note: blank(note) ? null : String(note) };

  if (blank(raw)) {
    return flag(spec, 'Not yet confirmed. This filter needs a manual confirmation' + (spec.note_field ? ' and, for an exposure, a supporting note.' : '.'), refs, detail);
  }
  const value = norm(raw);
  if (passValues.includes(value)) return pass(spec, passRationale, refs, detail);
  if (failValues.includes(value)) return fail(spec, failRationale, refs, detail);
  return flag(spec, 'The confirmation value \u2018' + raw + '\u2019 is not recognised; record a clear or exposure verdict.', refs, detail);
}

// 5. No un-mitigable portfolio conflict.
function conflictItem(spec, data) {
  const raw = data[spec.field];
  const declared = data.conflict_of_interest;
  const reviewer = data[spec.reviewer_field];
  const refs = [];
  if (!blank(raw)) refs.push({ type: 'confirmation', key: spec.field, label: spec.label + ': ' + raw });
  if (!blank(declared)) refs.push({ type: 'conflict', key: 'conflict_of_interest', label: 'Declared conflict: ' + declared });
  if (!blank(reviewer)) refs.push({ type: 'reviewer', key: spec.reviewer_field, label: 'Named reviewer: ' + reviewer });
  const detail = { value: blank(raw) ? null : raw, declared: blank(declared) ? null : String(declared), reviewer: blank(reviewer) ? null : String(reviewer) };

  if (blank(raw)) {
    if (!blank(declared)) {
      return fail(spec, 'A portfolio conflict is declared and has no mitigation assessment; it is un-mitigable until assessed.', refs, detail);
    }
    return flag(spec, 'Not yet confirmed. Record whether any portfolio conflict exists or is mitigated.', refs, detail);
  }
  const value = norm(raw);
  if (['none', 'no', 'clear', 'no_conflict'].includes(value)) {
    return pass(spec, 'No portfolio conflict with an existing holding.', refs, detail);
  }
  if (['mitigated', 'mitigable', 'mitigable_with_review'].includes(value)) {
    if (blank(reviewer)) {
      return fail(spec, 'The conflict is assessed as mitigable but no named reviewer is recorded, so it is un-mitigable as submitted.', refs, detail);
    }
    return pass(spec, 'The portfolio conflict is mitigated with a named reviewer on the record.', refs, detail);
  }
  if (['unmitigable', 'un_mitigable', 'not_mitigable', 'yes'].includes(value)) {
    return fail(spec, 'The portfolio conflict is un-mitigable.', refs, detail);
  }
  return flag(spec, 'The conflict value \u2018' + raw + '\u2019 is not recognised; record none, mitigated or un-mitigable.', refs, detail);
}

/**
 * Evaluate the five Gate-1 hard filters. Pure: no database, no network.
 *
 * @param {object} data        the opportunity data
 * @param {object} options
 * @param {object} options.theme        the effective investment theme (or null)
 * @param {object} options.thresholds   the entity mandate thresholds (or null)
 *
 * Returns the five ordered filter results, the failed set, the recommended
 * outcome ('proceed' or 'recommended_decline'), the reason, and the reviewer
 * decision when one is on the record. The system never rejects on its own.
 */
export function evaluateHardFilters(data = {}, { theme = null, thresholds = null } = {}) {
  const spec = (key) => HARD_FILTER_ITEMS.find((i) => i.key === key);

  const items = [
    verticalItem(spec('designated_vertical'), data, theme),
    sizeItem(spec('check_size'), data, theme, thresholds),
    manualItem(spec('sanctions_export'), data, {
      passValues: ['clear', 'no', 'none', 'yes', 'true', 'clean'],
      failValues: ['exposure', 'flag', 'flagged', 'yes_exposure', 'adverse'],
      passRationale: 'No sanctions, export-control or reputational exposure confirmed.',
      failRationale: 'Sanctions, export-control or reputational exposure confirmed; the filter fails.',
    }),
    manualItem(spec('structuring'), data, {
      passValues: ['compatible', 'clear', 'yes', 'true', 'adgm', 'difc', 'ok'],
      failValues: ['exception_needed', 'not_compatible', 'no', 'false', 'incompatible'],
      passRationale: 'ADGM / DIFC-compatible structuring confirmed.',
      failRationale: 'ADGM / DIFC-compatible structuring is not confirmed; the filter fails.',
    }),
    conflictItem(spec('portfolio_conflict'), data),
  ].sort((a, b) => a.order - b.order);

  const failed = items.filter((i) => i.status === 'fail');
  const pending = items.filter((i) => i.pending);
  const recommended_outcome = failed.length > 0 ? 'recommended_decline' : 'proceed';
  const complete = pending.length === 0;

  const reasons = failed.map((i) => i.label + ': ' + i.rationale);
  const recommended_reason = failed.length
    ? 'Recommended decline. ' + reasons.join(' ')
    : null;

  const review = data[HARD_FILTER_REVIEW_TAG] && typeof data[HARD_FILTER_REVIEW_TAG] === 'object'
    ? data[HARD_FILTER_REVIEW_TAG]
    : null;
  const awaiting_review = recommended_outcome === 'recommended_decline' && !review;
  const effective_outcome = review?.decision === 'overridden' ? 'overridden' : recommended_outcome;

  let message;
  if (failed.length === 0) message = HARD_FILTER_MESSAGES.proceed;
  else if (review?.decision === 'confirmed') message = HARD_FILTER_MESSAGES.review_confirmed + ' ' + recommended_reason;
  else if (review?.decision === 'overridden') message = HARD_FILTER_MESSAGES.review_overridden + ' ' + recommended_reason;
  else message = HARD_FILTER_MESSAGES.awaiting_review + ' ' + recommended_reason;

  return {
    version: HARD_FILTER_VERSION,
    applies: true,
    items,
    item_count: items.length,
    failed: failed.map((i) => ({ key: i.key, label: i.label, rationale: i.rationale })),
    pending: pending.map((i) => i.key),
    recommended_outcome,
    recommended_reason,
    effective_outcome,
    review,
    awaiting_review,
    complete,
    flags: items
      .filter((i) => i.status === 'fail' || i.status === 'flag')
      .map((i) => ({ key: i.key, label: i.label, status: i.status, rationale: i.rationale })),
    message,
  };
}

/**
 * Validate a reviewer confirm/override decision. Pure. Returns the normalised
 * decision plus the tagged record to persist, or throws a 400-shaped error.
 */
export function buildHardFilterReview(body = {}, { actor = null, at = null } = {}) {
  const decision = norm(body.decision);
  if (!HARD_FILTER_REVIEW_DECISIONS.includes(decision)) {
    const e = new Error('decision must be one of: ' + HARD_FILTER_REVIEW_DECISIONS.join(', '));
    e.status = 400;
    throw e;
  }
  const reason = String(body.reason || '').trim();
  if (reason.length < HARD_FILTER_REVIEW_REASON_MIN) {
    const e = new Error(HARD_FILTER_MESSAGES.reason_required);
    e.status = 400;
    throw e;
  }
  return {
    decision,
    reason,
    by: actor?.email || actor?.id || null,
    at: at || new Date().toISOString(),
  };
}

export default {
  HARD_FILTER_VERSION, HARD_FILTER_STATUSES, HARD_FILTER_OUTCOMES,
  HARD_FILTER_REVIEW_DECISIONS, HARD_FILTER_REVIEW_REASON_MIN, HARD_FILTER_REVIEW_TAG,
  HARD_FILTER_FIELDS, HARD_FILTER_ITEMS, HARD_FILTER_KEYS, HARD_FILTER_MESSAGES,
  evaluateHardFilters, buildHardFilterReview,
};
