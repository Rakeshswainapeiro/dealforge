// ---------------------------------------------------------------------------
// Overall AI assessment: a weighted score from the AI *analysis* ratings.
//
// Pure: no database, no network, no model. The overall assessment on the
// Scorecard tab is built from the analysis rating of each of the seven tabs
// (Strong / Adequate / Weak / Not enough evidence) and never from the AI
// validation status, which stays a separate pass / review / fail signal.
//
// Each tab rating becomes a score on the same 1-5 scale as the Gate 2
// scorecard; the tab weights sum to 100%. A tab that cannot be scored honestly
// (no analysis, a failed run, AI not configured, "Not enough evidence", or an
// analysis that is out of date against the current inputs) is left out and the
// remaining weights are re-normalised. Below a minimum coverage of weight the
// assessment is "Incomplete" and carries no number, so a score is never shown
// on the strength of a minority of the pack.
//
// Advisory only: it is not the Gate 2 scorecard total and never changes state.
// ---------------------------------------------------------------------------

export const ANALYSIS_SCORE_VERSION = 'AS-01.1';
export const ANALYSIS_SCORE_MAX = 5;
export const ANALYSIS_WEIGHT_TOTAL = 100;

// Rating -> score. "Not enough evidence" is deliberately absent: it is unscored.
export const ANALYSIS_RATING_SCORES = Object.freeze({ Strong: 5, Adequate: 3, Weak: 1 });
export const NOT_ENOUGH_EVIDENCE_RATING = 'Not enough evidence';

// Tab weights (whole percentages, sum 100), fixed in code.
export const ANALYSIS_TAB_WEIGHTS = Object.freeze({
  executive_summary: 10,
  opportunity_overview: 15,
  rationale: 15,
  financials: 25,
  funding: 15,
  risks: 15,
  documents: 5,
});

// The overall rating bands sit midway between the score points (5 / 3 / 1).
export const ANALYSIS_BANDS = Object.freeze([
  { rating: 'Strong', min: 4 },
  { rating: 'Adequate', min: 2 },
  { rating: 'Weak', min: -Infinity },
]);

// Below this share of the total weight, no overall score is given.
export const ANALYSIS_MIN_COVERAGE = 60;
export const INCOMPLETE_RATING = 'Incomplete';

// Why a tab is (or is not) in the score.
export const SCORE_STATES = Object.freeze({
  scored: 'scored',
  not_run: 'not_run',
  failed: 'failed',
  not_configured: 'not_configured',
  insufficient_evidence: 'insufficient_evidence',
  stale: 'stale',
});

// Which tabs' AI analysis informs each Gate 2 scorecard criterion. Shown on the
// scorecard as "From the AI analysis"; it does not change any scorecard score.
export const SCORECARD_ANALYSIS_LINKS = Object.freeze({
  revenue_scale: ['financials', 'opportunity_overview'],
  growth_rate: ['financials'],
  entry_valuation: ['financials'],
  ownership_control: ['opportunity_overview', 'funding'],
  capital_structure: ['funding', 'financials'],
  path_to_liquidity: ['rationale', 'executive_summary'],
  unit_economics: ['financials'],
});

const round2 = (n) => Math.round(n * 100) / 100;

export function ratingScore(rating) {
  return Object.prototype.hasOwnProperty.call(ANALYSIS_RATING_SCORES, rating) ? ANALYSIS_RATING_SCORES[rating] : null;
}

export function bandFor(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return ANALYSIS_BANDS.find((b) => score >= b.min).rating;
}

/**
 * The score state of one tab. Input is the effective analysis view of the tab:
 *   { rating, overridden, ran, stale, failed_run, not_configured }
 * A live reviewer override was made against the current inputs, so it counts
 * even when the stored AI analysis is out of date.
 */
export function tabScoreState({ rating = null, overridden = false, ran = false, stale = false, failed_run = false, not_configured = false } = {}) {
  if (overridden) {
    return ratingScore(rating) === null ? SCORE_STATES.insufficient_evidence : SCORE_STATES.scored;
  }
  if (!ran) {
    if (failed_run) return SCORE_STATES.failed;
    if (not_configured) return SCORE_STATES.not_configured;
    return SCORE_STATES.not_run;
  }
  if (stale) return SCORE_STATES.stale;
  if (ratingScore(rating) === null) return SCORE_STATES.insufficient_evidence;
  return SCORE_STATES.scored;
}

/**
 * Score every tab and the overall assessment.
 * rows: [{ tab, rating, overridden, ran, stale, failed_run, not_configured }]
 * Returns { rows: [{ tab, weight, state, score, weighted }], assessment }.
 */
export function scoreAnalysis(rows = [], { weights = ANALYSIS_TAB_WEIGHTS, minCoverage = ANALYSIS_MIN_COVERAGE } = {}) {
  const scoredRows = rows.map((r) => {
    const weight = Number(weights[r.tab] || 0);
    const state = tabScoreState(r);
    const score = state === SCORE_STATES.scored ? ratingScore(r.rating) : null;
    return {
      tab: r.tab,
      weight,
      state,
      score,
      weighted: score === null ? null : round2((score * weight) / ANALYSIS_WEIGHT_TOTAL),
    };
  });
  const counted = scoredRows.filter((r) => r.score !== null && r.weight > 0);
  const coverage = counted.reduce((t, r) => t + r.weight, 0);
  const totalWeight = scoredRows.reduce((t, r) => t + r.weight, 0) || ANALYSIS_WEIGHT_TOTAL;
  const coveragePct = round2((coverage / totalWeight) * 100);
  const enough = coverage > 0 && coveragePct >= minCoverage;
  const score = enough ? round2(counted.reduce((t, r) => t + r.score * r.weight, 0) / coverage) : null;

  let incompleteReason = null;
  if (!enough) {
    incompleteReason = counted.length === 0
      ? 'No tab has a current AI analysis rating yet.'
      : `Only ${coveragePct}% of the assessment weight has a current AI analysis rating; at least ${minCoverage}% is needed for an overall score.`;
  }

  return {
    rows: scoredRows,
    assessment: {
      basis: 'analysis',
      score,
      max: ANALYSIS_SCORE_MAX,
      rating: enough ? bandFor(score) : INCOMPLETE_RATING,
      coverage_weight: coveragePct,
      min_coverage: minCoverage,
      scored_tabs: counted.length,
      total_tabs: scoredRows.length,
      incomplete_reason: incompleteReason,
      version: ANALYSIS_SCORE_VERSION,
    },
  };
}

export default {
  ANALYSIS_SCORE_VERSION, ANALYSIS_RATING_SCORES, ANALYSIS_TAB_WEIGHTS, ANALYSIS_BANDS, ANALYSIS_MIN_COVERAGE,
  SCORE_STATES, SCORECARD_ANALYSIS_LINKS, ratingScore, bandFor, tabScoreState, scoreAnalysis,
};
