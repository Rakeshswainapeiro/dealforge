// ---------------------------------------------------------------------------
// Gate 1 soft filters (W3-03 / BRD SCR-04, REQ-RULE-02).
//
// Source of truth: the Phase-1 BRD, "Gate 1 soft filters". Three filters are
// SCORED, not used to kill:
//
//   1. adjacency to portfolio companies
//   2. alignment with UAE national priorities
//   3. management openness to an active investor
//
// Each is scored 1-5 with a rationale. The system proposes a score from the
// structured data on the record; the reviewer (Investment Analyst) confirms the
// proposal or adjusts it, and every confirmed score carries a written rationale.
// A soft filter never rejects an opportunity - the aggregate is a scoring band,
// not a gate.
//
// This module is pure: the theme, the portfolio register, the national-priority
// configuration and every message are passed in, so the form, the panel, the
// memo and the tests read one source (REQ-RULE-10).
// ---------------------------------------------------------------------------

export const SOFT_FILTER_VERSION = 'SF-01.1';

// The 1-5 scale and its band labels (SCR-04).
export const SOFT_FILTER_SCALE = [
  { value: 1, label: 'Very weak' },
  { value: 2, label: 'Weak' },
  { value: 3, label: 'Moderate' },
  { value: 4, label: 'Strong' },
  { value: 5, label: 'Very strong' },
];

export const SOFT_FILTER_MIN_SCORE = 1;
export const SOFT_FILTER_MAX_SCORE = 5;

// The reviewer either confirms the proposed score or adjusts it; both require a
// written rationale per filter (SCR-04).
export const SOFT_FILTER_REVIEW_DECISIONS = ['confirmed', 'adjusted'];
export const SOFT_FILTER_REVIEW_REASON_MIN = 10;
export const SOFT_FILTER_REVIEW_TAG = 'soft_filter_review';

// Aggregate bands. A soft-filter set never kills a deal; it reads as strong,
// moderate or weak for the reviewer.
export const SOFT_FILTER_OUTCOMES = ['strong', 'moderate', 'weak'];
export const SOFT_FILTER_OUTCOME_MIN_STRONG = 4;
export const SOFT_FILTER_OUTCOME_MIN_MODERATE = 3;

// The captured inputs. The three notes are evidence for a proposed score; the
// management-openness verdict is the one judgement captured by the preparer
// from management interaction. None is required (the documented 14-key minimum
// stands); a blank verdict leaves the filter proposed-neutral with a flag.
export const SOFT_FILTER_FIELDS = {
  adjacency_note: 'soft_filter_adjacency_note',
  national_priorities_note: 'soft_filter_national_priorities_note',
  management_openness: 'soft_filter_management_openness',
  management_openness_note: 'soft_filter_management_openness_note',
};

// UAE national-priority sectors (SCR-04). Configuration, not logic: reorder or
// extend to re-shape the national-priorities proposal.
export const UAE_PRIORITY_SECTORS = [
  'Technology',
  'Healthcare',
  'Energy',
  'Financial Services',
  'Telecommunications',
  'Industrials',
  'Consumer Goods',
];

// The three soft filters in BRD order. 'derived' marks a filter the system
// proposes from structured data; a derived filter is always available.
export const SOFT_FILTER_ITEMS = [
  {
    key: 'portfolio_adjacency', label: 'Adjacency to portfolio companies', group: 'strategic', order: 1,
    description: 'How close the target is to an existing portfolio company (sector, capability, geography).',
    note_field: SOFT_FILTER_FIELDS.adjacency_note,
  },
  {
    key: 'national_priorities', label: 'Alignment with UAE national priorities', group: 'strategic', order: 2,
    description: 'Fit with the UAE national priority sectors and the group strategic agenda.',
    note_field: SOFT_FILTER_FIELDS.national_priorities_note,
  },
  {
    key: 'management_openness', label: 'Management openness to an active investor', group: 'execution', order: 3,
    description: 'Willingness of the target management to accept an active, governance-driven investor.',
    field: SOFT_FILTER_FIELDS.management_openness,
    note_field: SOFT_FILTER_FIELDS.management_openness_note,
  },
];

export const SOFT_FILTER_KEYS = SOFT_FILTER_ITEMS.map((i) => i.key);

// Operator-facing messages kept in configuration (REQ-RULE-10).
export const SOFT_FILTER_MESSAGES = {
  scored: 'Soft filters scored. They are scored, not used to kill a deal; the reviewer confirms or adjusts each score.',
  awaiting_review: 'A score is proposed for every soft filter. The reviewer confirms or adjusts each score with a written rationale.',
  reviewed: 'The reviewer has confirmed or adjusted the soft-filter scores.',
  reason_required: 'A written rationale of at least ' + SOFT_FILTER_REVIEW_REASON_MIN + ' characters is required for each score.',
  score_range: 'Every soft-filter score must be a whole number from ' + SOFT_FILTER_MIN_SCORE + ' to ' + SOFT_FILTER_MAX_SCORE + '.',
  decision_required: 'decision must be one of: ' + SOFT_FILTER_REVIEW_DECISIONS.join(', '),
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const clampScore = (n) => Math.max(SOFT_FILTER_MIN_SCORE, Math.min(SOFT_FILTER_MAX_SCORE, Math.round(n)));

const isUae = (geography) => {
  const g = norm(geography);
  return g === 'uae' || g.includes('united arab emirates') || g.includes('emirates');
};

const isGcc = (geography) => {
  const g = norm(geography);
  return isUae(g) || ['saudi', 'qatar', 'bahrain', 'oman', 'kuwait', 'gcc'].some((t) => g.includes(t));
};

const keywordHit = (data, theme) => {
  if (!theme || !Array.isArray(theme.keywords)) return null;
  const haystack = [data.opportunity_name, data.sector, data.geography, data.target_name,
    data.narrative_what, data.narrative_why_now, data.narrative_why_us, data.strategy_link]
    .filter(Boolean).join(' ').toLowerCase();
  return theme.keywords.find((k) => haystack.includes(String(k).toLowerCase())) || null;
};

// 1. Adjacency to portfolio companies. Prefers the portfolio register when one
// is supplied; falls back to the mandate theme the register is derived from.
export function proposePortfolioAdjacency(data = {}, { theme = null, portfolio = null } = {}) {
  const sector = data.sector;
  const holdings = Array.isArray(portfolio) ? portfolio : [];
  const refs = [];
  if (!blank(sector)) refs.push({ type: 'sector', key: 'sector', label: 'Sector: ' + sector });
  const note = data[SOFT_FILTER_FIELDS.adjacency_note];
  if (!blank(note)) refs.push({ type: 'note', key: SOFT_FILTER_FIELDS.adjacency_note, label: String(note) });

  const detail = { sector: sector ?? null, portfolio_size: holdings.length, matches: [] };

  if (blank(sector)) {
    return { score: 3, rationale: 'The sector is not captured yet, so adjacency is proposed neutral pending capture.', refs, detail };
  }
  if (holdings.length > 0) {
    const matches = holdings.filter((h) => norm(h.sector) === norm(sector));
    detail.matches = matches.map((h) => h.name || h.sector).filter(Boolean);
    if (matches.length > 0) {
      refs.push({ type: 'portfolio', key: 'portfolio', label: matches.length + ' portfolio company match in ' + sector });
      return {
        score: matches.length >= 2 ? 5 : 4,
        rationale: 'Direct sector adjacency to ' + matches.length + ' portfolio company(ies) in ' + sector + '.',
        refs, detail,
      };
    }
    return { score: 2, rationale: 'No portfolio company shares the ' + sector + ' sector.', refs, detail };
  }

  if (theme && norm(sector) === norm(theme.sector)) {
    return { score: 4, rationale: 'Sector ‘' + sector + '’ matches the subsidiary mandate focus, so adjacency is likely.', refs, detail };
  }
  const hit = keywordHit(data, theme);
  if (hit) {
    refs.push({ type: 'keyword', key: 'keyword', label: 'Mandate keyword: ' + hit });
    return { score: 3, rationale: 'Adjacency is indicated by the mandate keyword ‘' + hit + '’ rather than a named holding.', refs, detail };
  }
  if (!blank(data.concentration_impact) || !blank(data.below_floor_synergy_case)) {
    return { score: 3, rationale: 'A portfolio-synergy or concentration statement is on the record; the reviewer should confirm the proximity.', refs, detail };
  }
  return { score: 2, rationale: 'No portfolio adjacency is evident from the captured sector and mandate.', refs, detail };
}

// 2. Alignment with UAE national priorities.
export function proposeNationalPriorities(data = {}, { nationalPriorities = null } = {}) {
  const sectors = (nationalPriorities?.sectors || UAE_PRIORITY_SECTORS).map(norm);
  const geography = data.geography;
  const sector = data.sector;
  const refs = [];
  if (!blank(geography)) refs.push({ type: 'geography', key: 'geography', label: 'Geography: ' + geography });
  const note = data[SOFT_FILTER_FIELDS.national_priorities_note];
  if (!blank(note)) refs.push({ type: 'note', key: SOFT_FILTER_FIELDS.national_priorities_note, label: String(note) });
  const detail = { geography: geography ?? null, sector: sector ?? null, priority_sector: false };

  if (blank(geography)) {
    return { score: 3, rationale: 'The geography is not captured yet, so national-priority alignment is proposed neutral.', refs, detail };
  }
  const prioritySector = !blank(sector) && sectors.includes(norm(sector));
  detail.priority_sector = prioritySector;
  if (isUae(geography) && prioritySector) {
    refs.push({ type: 'priority_sector', key: 'priority_sector', label: 'UAE priority sector: ' + sector });
    return { score: 5, rationale: 'The opportunity is in the UAE and in a national priority sector (' + sector + ').', refs, detail };
  }
  if (isUae(geography)) {
    return { score: 4, rationale: 'The opportunity is in the UAE, directly supporting the national agenda.', refs, detail };
  }
  if (isGcc(geography)) {
    return { score: 3, rationale: 'The opportunity is in the GCC, adjacent to the UAE national agenda.', refs, detail };
  }
  return { score: 2, rationale: 'The opportunity is outside the UAE, so direct national-priority alignment is limited.', refs, detail };
}

// 3. Management openness to an active investor. Proposed from the captured
// management-interaction verdict; neutral pending capture.
export function proposeManagementOpenness(data = {}) {
  const raw = data[SOFT_FILTER_FIELDS.management_openness];
  const refs = [];
  if (!blank(raw)) refs.push({ type: 'verdict', key: SOFT_FILTER_FIELDS.management_openness, label: 'Management openness: ' + raw });
  const note = data[SOFT_FILTER_FIELDS.management_openness_note];
  if (!blank(note)) refs.push({ type: 'note', key: SOFT_FILTER_FIELDS.management_openness_note, label: String(note) });
  const detail = { value: blank(raw) ? null : raw };

  if (blank(raw)) {
    return { score: 3, rationale: 'Management openness is not yet recorded, so it is proposed neutral pending the interaction.', refs, detail };
  }
  const value = norm(raw);
  if (['open', 'receptive', 'very_open', 'welcoming'].includes(value)) {
    return { score: 5, rationale: 'Management is open to an active, governance-driven investor.', refs, detail };
  }
  if (['neutral', 'undecided', 'receptive_with_terms'].includes(value)) {
    return { score: 3, rationale: 'Management is neutral; openness depends on terms and governance.', refs, detail };
  }
  if (['resistant', 'reluctant', 'opposed', 'closed'].includes(value)) {
    return { score: 2, rationale: 'Management is reluctant to accept an active investor.', refs, detail };
  }
  return { score: 3, rationale: 'The openness verdict ‘' + raw + '’ is not recognised; proposed neutral.', refs, detail };
}

export function scoreLabel(score) {
  const n = Number(score);
  const band = SOFT_FILTER_SCALE.find((s) => s.value === n);
  return band ? band.label : null;
}

/**
 * Evaluate the three Gate-1 soft filters. Pure: no database, no network.
 *
 * @param {object} data     the opportunity data
 * @param {object} options
 * @param {object} options.theme              the effective investment theme (or null)
 * @param {Array}  options.portfolio          the portfolio register (or null)
 * @param {object} options.nationalPriorities the national-priority configuration (or null)
 *
 * Returns the three ordered scores (proposed and effective), the aggregate
 * average and band, and the reviewer record when one is on file. A soft filter
 * never rejects an opportunity.
 */
export function evaluateSoftFilters(data = {}, { theme = null, portfolio = null, nationalPriorities = null } = {}) {
  const spec = (key) => SOFT_FILTER_ITEMS.find((i) => i.key === key);

  const proposals = [
    { key: 'portfolio_adjacency', ...proposePortfolioAdjacency(data, { theme, portfolio }) },
    { key: 'national_priorities', ...proposeNationalPriorities(data, { nationalPriorities }) },
    { key: 'management_openness', ...proposeManagementOpenness(data) },
  ];

  const review = data[SOFT_FILTER_REVIEW_TAG] && typeof data[SOFT_FILTER_REVIEW_TAG] === 'object'
    ? data[SOFT_FILTER_REVIEW_TAG]
    : null;
  const reviewedScores = review?.scores && typeof review.scores === 'object' ? review.scores : {};
  const reviewedRationales = review?.rationales && typeof review.rationales === 'object' ? review.rationales : {};

  const items = proposals.map((p) => {
    const s = spec(p.key);
    const hasReview = reviewedScores[p.key] != null;
    const effective = hasReview ? clampScore(Number(reviewedScores[p.key])) : p.score;
    const rationale = hasReview && !blank(reviewedRationales[p.key]) ? String(reviewedRationales[p.key]) : p.rationale;
    return {
      key: p.key,
      label: s.label,
      group: s.group,
      order: s.order,
      description: s.description,
      field: s.field || null,
      note_field: s.note_field || null,
      proposed_score: p.score,
      proposed_label: scoreLabel(p.score),
      score: effective,
      label_band: scoreLabel(effective),
      confirmed: hasReview,
      adjusted: hasReview && effective !== p.score,
      rationale,
      evidence_refs: p.refs,
      detail: p.detail,
    };
  }).sort((a, b) => a.order - b.order);

  const proposedAverage = items.reduce((t, i) => t + i.proposed_score, 0) / items.length;
  const effectiveAverage = items.reduce((t, i) => t + i.score, 0) / items.length;
  const avg = Math.round(effectiveAverage * 100) / 100;

  const outcome = avg >= SOFT_FILTER_OUTCOME_MIN_STRONG ? 'strong'
    : (avg >= SOFT_FILTER_OUTCOME_MIN_MODERATE ? 'moderate' : 'weak');

  const confirmed = items.every((i) => i.confirmed);
  const weak = items.filter((i) => i.score <= 2);
  const flags = weak.map((i) => ({ key: i.key, label: i.label, score: i.score, rationale: i.rationale }));

  let message;
  if (!confirmed) message = SOFT_FILTER_MESSAGES.awaiting_review;
  else message = SOFT_FILTER_MESSAGES.reviewed;

  return {
    version: SOFT_FILTER_VERSION,
    applies: true,
    scale: SOFT_FILTER_SCALE,
    items,
    item_count: items.length,
    proposed_average: Math.round(proposedAverage * 100) / 100,
    average: avg,
    average_label: scoreLabel(Math.round(avg)),
    outcome,
    review,
    confirmed,
    awaiting_review: !confirmed,
    weak: weak.map((i) => i.key),
    flags,
    complete: confirmed,
    message,
  };
}

/**
 * Validate a reviewer confirm/adjust of the soft-filter scores. Pure. Returns
 * the normalised record to persist, or throws a 400-shaped error. Every score
 * is required and every score needs a written rationale (SCR-04).
 */
export function buildSoftFilterReview(body = {}, { actor = null, at = null } = {}) {
  const decision = norm(body.decision);
  if (!SOFT_FILTER_REVIEW_DECISIONS.includes(decision)) {
    const e = new Error(SOFT_FILTER_MESSAGES.decision_required);
    e.status = 400;
    throw e;
  }
  const rawScores = body.scores && typeof body.scores === 'object' ? body.scores : {};
  const rawRationales = body.rationales && typeof body.rationales === 'object' ? body.rationales : {};
  const scores = {};
  const rationales = {};
  for (const key of SOFT_FILTER_KEYS) {
    const n = Number(rawScores[key]);
    if (!Number.isFinite(n) || n < SOFT_FILTER_MIN_SCORE || n > SOFT_FILTER_MAX_SCORE) {
      const e = new Error(SOFT_FILTER_MESSAGES.score_range + ' Missing or invalid: ' + key + '.');
      e.status = 400;
      throw e;
    }
    const reason = String(rawRationales[key] || '').trim();
    if (reason.length < SOFT_FILTER_REVIEW_REASON_MIN) {
      const e = new Error(SOFT_FILTER_MESSAGES.reason_required + ' Short for: ' + key + '.');
      e.status = 400;
      throw e;
    }
    scores[key] = clampScore(n);
    rationales[key] = reason;
  }
  return {
    decision,
    scores,
    rationales,
    overall_rationale: blank(body.overall_rationale) ? null : String(body.overall_rationale).trim(),
    by: actor?.email || actor?.id || null,
    at: at || new Date().toISOString(),
  };
}

export default {
  SOFT_FILTER_VERSION, SOFT_FILTER_SCALE, SOFT_FILTER_MIN_SCORE, SOFT_FILTER_MAX_SCORE,
  SOFT_FILTER_REVIEW_DECISIONS, SOFT_FILTER_REVIEW_REASON_MIN, SOFT_FILTER_REVIEW_TAG,
  SOFT_FILTER_OUTCOMES, SOFT_FILTER_OUTCOME_MIN_STRONG, SOFT_FILTER_OUTCOME_MIN_MODERATE,
  SOFT_FILTER_FIELDS, SOFT_FILTER_ITEMS, SOFT_FILTER_KEYS, SOFT_FILTER_MESSAGES,
  UAE_PRIORITY_SECTORS, scoreLabel,
  proposePortfolioAdjacency, proposeNationalPriorities, proposeManagementOpenness,
  evaluateSoftFilters, buildSoftFilterReview,
};
