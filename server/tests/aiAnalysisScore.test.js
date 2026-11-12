// Overall AI assessment scored from the AI analysis ratings. Pure: no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_RATING_SCORES, ANALYSIS_TAB_WEIGHTS, ANALYSIS_MIN_COVERAGE, SCORE_STATES, SCORECARD_ANALYSIS_LINKS,
  ratingScore, bandFor, tabScoreState, scoreAnalysis,
} from '../config/aiAnalysisScore.js';
import { AI_TAB_KEYS } from '../config/aiReview.js';
import { SCORECARD_KEYS } from '../config/scorecard.js';
import { buildOverview } from '../config/aiReviewDecisions.js';

const TABS = Object.keys(ANALYSIS_TAB_WEIGHTS);
const row = (tab, rating, extra = {}) => ({ tab, rating, ran: true, stale: false, overridden: false, failed_run: false, not_configured: false, ...extra });

test('rating scores: Strong 5, Adequate 3, Weak 1, Not enough evidence unscored', () => {
  assert.deepEqual({ ...ANALYSIS_RATING_SCORES }, { Strong: 5, Adequate: 3, Weak: 1 });
  assert.equal(ratingScore('Not enough evidence'), null);
  assert.equal(ratingScore(null), null);
  assert.equal(ratingScore('strong'), null);
});

test('tab weights cover the seven AI tabs and sum to 100', () => {
  assert.deepEqual(TABS.slice().sort(), AI_TAB_KEYS.slice().sort());
  assert.equal(Object.values(ANALYSIS_TAB_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(AI_TAB_KEYS.map((k) => ANALYSIS_TAB_WEIGHTS[k]), [10, 15, 15, 25, 15, 15, 5]);
});

test('rating bands at their edges', () => {
  assert.equal(bandFor(5), 'Strong');
  assert.equal(bandFor(4), 'Strong');
  assert.equal(bandFor(3.99), 'Adequate');
  assert.equal(bandFor(2), 'Adequate');
  assert.equal(bandFor(1.99), 'Weak');
  assert.equal(bandFor(1), 'Weak');
  assert.equal(bandFor(null), null);
});

test('all tabs scored: the weighted average on the 1-5 scale', () => {
  const ratings = { executive_summary: 'Adequate', opportunity_overview: 'Adequate', rationale: 'Adequate', financials: 'Weak', funding: 'Weak', risks: 'Weak', documents: 'Strong' };
  const out = scoreAnalysis(TABS.map((t) => row(t, ratings[t])));
  // (3*10 + 3*15 + 3*15 + 1*25 + 1*15 + 1*15 + 5*5) / 100 = 200/100
  assert.equal(out.assessment.score, 2);
  assert.equal(out.assessment.rating, 'Adequate');
  assert.equal(out.assessment.coverage_weight, 100);
  assert.equal(out.assessment.scored_tabs, 7);
  assert.equal(out.assessment.basis, 'analysis');
  const fin = out.rows.find((r) => r.tab === 'financials');
  assert.deepEqual({ weight: fin.weight, score: fin.score, weighted: fin.weighted, state: fin.state }, { weight: 25, score: 1, weighted: 0.25, state: 'scored' });
});

test('missing, failed, not configured, stale and insufficient-evidence tabs are left out and weights re-normalise', () => {
  const rows = [
    row('executive_summary', 'Strong'), // 10
    row('opportunity_overview', 'Strong'), // 15
    row('rationale', 'Adequate'), // 15
    row('financials', 'Weak', { stale: true }), // excluded: out of date
    row('funding', null, { ran: false, failed_run: true }), // excluded: failed run
    row('risks', 'Not enough evidence'), // excluded: unscored rating
    row('documents', null, { ran: false }), // excluded: not run
  ];
  const out = scoreAnalysis(rows);
  const states = Object.fromEntries(out.rows.map((r) => [r.tab, r.state]));
  assert.equal(states.financials, SCORE_STATES.stale);
  assert.equal(states.funding, SCORE_STATES.failed);
  assert.equal(states.risks, SCORE_STATES.insufficient_evidence);
  assert.equal(states.documents, SCORE_STATES.not_run);
  for (const t of ['financials', 'funding', 'risks', 'documents']) {
    const r = out.rows.find((x) => x.tab === t);
    assert.equal(r.score, null, t);
    assert.equal(r.weighted, null, t);
  }
  // 40% of weight scored: below the 60% minimum, so no number.
  assert.equal(out.assessment.coverage_weight, 40);
  assert.equal(out.assessment.score, null);
  assert.equal(out.assessment.rating, 'Incomplete');
  assert.match(out.assessment.incomplete_reason, /40%/);
});

test('coverage at exactly the minimum gives a score from the scored tabs only', () => {
  assert.equal(ANALYSIS_MIN_COVERAGE, 60);
  const rows = [
    row('executive_summary', 'Strong'), // 10
    row('opportunity_overview', 'Adequate'), // 15
    row('rationale', 'Adequate'), // 15
    row('financials', null, { ran: false }),
    row('funding', 'Weak'), // 15
    row('risks', null, { ran: false }),
    row('documents', 'Strong'), // 5
  ];
  const out = scoreAnalysis(rows);
  assert.equal(out.assessment.coverage_weight, 60);
  // (5*10 + 3*15 + 3*15 + 1*15 + 5*5) / 60 = 180/60
  assert.equal(out.assessment.score, 3);
  assert.equal(out.assessment.rating, 'Adequate');
  assert.equal(out.assessment.scored_tabs, 5);
});

test('AI not configured is its own state, and nothing run is Incomplete', () => {
  assert.equal(tabScoreState({ ran: false, not_configured: true }), SCORE_STATES.not_configured);
  const out = scoreAnalysis(TABS.map((t) => row(t, null, { ran: false })));
  assert.equal(out.assessment.score, null);
  assert.equal(out.assessment.rating, 'Incomplete');
  assert.match(out.assessment.incomplete_reason, /No tab/);
});

test('a live reviewer override is scored even when the AI analysis is out of date', () => {
  assert.equal(tabScoreState({ rating: 'Strong', overridden: true, ran: true, stale: true }), SCORE_STATES.scored);
  assert.equal(tabScoreState({ rating: 'Not enough evidence', overridden: true, ran: true }), SCORE_STATES.insufficient_evidence);
});

test('scorecard links name only real criteria and real tabs', () => {
  for (const [criterion, tabs] of Object.entries(SCORECARD_ANALYSIS_LINKS)) {
    assert.ok(SCORECARD_KEYS.includes(criterion), criterion);
    for (const t of tabs) assert.ok(AI_TAB_KEYS.includes(t), t);
  }
});

// --- through buildOverview ----------------------------------------------------

const analysis = (rating, extra = {}) => ({ analysis: { recommendation: { rating } }, ai_status: 'ok', stale: false, ...extra });

test('overview: the assessment follows the analysis ratings, never the validation status', () => {
  const results = Object.fromEntries(AI_TAB_KEYS.map((k) => [k, { validation: { status: 'fail', ai_status: 'ok' }, analysis: analysis('Strong') }]));
  const o = buildOverview({ results, decisions: [], hashes: {} });
  assert.equal(o.overall_validation, 'fail'); // validation is unchanged
  assert.equal(o.analysis_assessment.score, 5);
  assert.equal(o.analysis_assessment.rating, 'Strong');
  assert.ok(o.analysis_assessment.scorecard_links.growth_rate.includes('financials'));
  const all = Object.fromEntries(AI_TAB_KEYS.map((k) => [k, { validation: { status: 'pass', ai_status: 'ok' }, analysis: analysis('Weak') }]));
  const o2 = buildOverview({ results: all, decisions: [], hashes: {} });
  assert.equal(o2.overall_validation, 'pass');
  assert.equal(o2.analysis_assessment.rating, 'Weak');
  assert.equal(o2.analysis_assessment.score, 1);
});

test('overview: an analysis override with the current hash replaces the rating and its score', () => {
  const results = Object.fromEntries(AI_TAB_KEYS.map((k) => [k, { validation: null, analysis: analysis('Adequate') }]));
  results.financials.analysis = analysis('Weak', { stale: true });
  const hashes = Object.fromEntries(AI_TAB_KEYS.map((k) => [k, 'h']));
  const decisions = [{ tab: 'financials', kind: 'analysis', finding_key: '__tab__', action: 'override', to_status: 'Strong', input_hash: 'h' }];
  const o = buildOverview({ results, decisions, hashes });
  const fin = o.tabs.find((t) => t.tab === 'financials');
  assert.equal(fin.analysis_rating, 'Strong');
  assert.equal(fin.analysis_overridden, true);
  assert.equal(fin.analysis_score, 5);
  assert.equal(fin.analysis_score_state, 'scored');
  // An override made against older inputs does not apply: the stale AI rating is excluded.
  const old = buildOverview({ results, decisions: [{ ...decisions[0], input_hash: 'old' }], hashes });
  const fin2 = old.tabs.find((t) => t.tab === 'financials');
  assert.equal(fin2.analysis_score, null);
  assert.equal(fin2.analysis_score_state, 'stale');
  assert.equal(old.analysis_assessment.coverage_weight, 75);
  assert.equal(old.analysis_assessment.score, 3);
});

test('overview: a failed analysis run with no earlier result is not scored', () => {
  const results = Object.fromEntries(AI_TAB_KEYS.map((k) => [k, { validation: null, analysis: analysis('Adequate') }]));
  results.funding.analysis = { analysis: null, ai_status: 'unavailable', stale: false };
  results.documents.analysis = { analysis: null, ai_status: 'not_configured', stale: false };
  const o = buildOverview({ results, decisions: [], hashes: {} });
  const by = Object.fromEntries(o.tabs.map((t) => [t.tab, t]));
  assert.equal(by.funding.analysis_score_state, 'failed');
  assert.equal(by.documents.analysis_score_state, 'not_configured');
  assert.equal(o.analysis_assessment.coverage_weight, 80);
  assert.equal(o.analysis_assessment.score, 3);
});
