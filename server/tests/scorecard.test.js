// ---------------------------------------------------------------------------
// Unit tests for the Gate 2 weighted scorecard (W3-05 / SCO-02).
//
//   node --test server/tests/scorecard.test.js
//
// Pure module: the tests pass the opportunity data by hand and assert the seven
// criteria, the weights, the weighted total and the pass / override outcome. No
// server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORECARD_ITEMS, SCORECARD_KEYS, SCORECARD_FIELDS, SCORECARD_PASS_THRESHOLD,
  SCORECARD_WEIGHT_TOTAL, SCORECARD_OUTCOMES, SCORECARD_TAG, SCORECARD_OVERRIDE_TAG,
  SCORECARD_LENSES, SCORECARD_LENS_FLOOR,
  SCORECARD_ADJUST_REASON_MIN,
  validateWeights, capturedScore, proposeScorecardItem, evaluateLenses, evaluateScorecard, buildScorecard, buildScorecardOverride,
  defaultScorecardConfig, validateScorecardConfig, resolveScorecardConfig, diffScorecardConfig, buildScorecardConfig,
  SCORECARD_CONFIG_DEFAULT_REVISION,
} from '../config/scorecard.js';

const allScores = (n) => Object.fromEntries(SCORECARD_KEYS.map((k) => [SCORECARD_FIELDS['score_' + k], n]));
const byKey = (sc) => Object.fromEntries(sc.items.map((i) => [i.key, i]));

describe('scorecard vocabulary (SCO-02)', () => {
  test('names the seven BRD criteria in order with the D4 weights', () => {
    assert.deepEqual(SCORECARD_KEYS, [
      'revenue_scale', 'growth_rate', 'entry_valuation', 'ownership_control',
      'capital_structure', 'path_to_liquidity', 'unit_economics',
    ]);
    assert.deepEqual(SCORECARD_ITEMS.map((i) => i.order), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(SCORECARD_ITEMS.map((i) => i.weight), [15, 15, 20, 10, 10, 15, 15]);
  });

  test('the weights sum to 100 and the pass bar is 3.5', () => {
    const v = validateWeights();
    assert.equal(v.ok, true);
    assert.equal(v.total, SCORECARD_WEIGHT_TOTAL);
    assert.equal(SCORECARD_PASS_THRESHOLD, 3.5);
    assert.deepEqual(SCORECARD_OUTCOMES, ['proceed', 'override_required', 'proceed_override']);
  });

  test('a recalibrated weight set that does not total 100 is rejected', () => {
    const bad = SCORECARD_ITEMS.map((i, idx) => (idx === 0 ? { ...i, weight: 20 } : i));
    const v = validateWeights(bad);
    assert.equal(v.ok, false);
    assert.equal(v.total, 105);
  });
});

describe('scorecard evaluation (SCO-02)', () => {
  test('an unscored scorecard is incomplete with no total or outcome', () => {
    const sc = evaluateScorecard({});
    assert.equal(sc.complete, false);
    assert.equal(sc.scored_count, 0);
    assert.equal(sc.total, null);
    assert.equal(sc.outcome, null);
    assert.equal(sc.weights_valid, true);
  });

  test('an all-3 scorecard totals 3 and requires an override', () => {
    const sc = evaluateScorecard(allScores(3));
    assert.equal(sc.complete, true);
    assert.equal(sc.total, 3);
    assert.equal(sc.outcome, 'override_required');
    assert.equal(sc.rejected_below_bar, true);
  });

  test('an all-4 scorecard totals 4 and proceeds', () => {
    const sc = evaluateScorecard(allScores(4));
    assert.equal(sc.total, 4);
    assert.equal(sc.outcome, 'proceed');
    assert.equal(sc.rejected_below_bar, false);
  });

  test('the weighted total respects the criterion weights', () => {
    // Every criterion at 3 except entry valuation (weight 20) at 5.
    const data = { ...allScores(3), [SCORECARD_FIELDS.score_entry_valuation]: 5 };
    const sc = evaluateScorecard(data);
    // (6*3 + 5*1) weighted at 100 -> (3*80 + 5*20)/100 = (240+100)/100 = 3.4
    assert.equal(sc.total, 3.4);
    assert.equal(sc.outcome, 'override_required');
    assert.equal(byKey(sc).entry_valuation.score, 5);
    assert.equal(byKey(sc).growth_rate.weight, 15);
  });

  test('a below-bar scorecard with a recorded override memo proceeds', () => {
    const data = { ...allScores(3), [SCORECARD_OVERRIDE_TAG]: { reason: 'Strategic entry into a priority sector.', by: 'cio@sirius.local' } };
    const sc = evaluateScorecard(data);
    assert.equal(sc.total, 3);
    assert.equal(sc.outcome, 'proceed_override');
    assert.equal(sc.overridden, true);
    assert.equal(sc.rejected_below_bar, false);
  });

  test('a score recorded through the capture tag is read back', () => {
    const tag = SCORECARD_TAG;
    const data = { [tag]: { scores: Object.fromEntries(SCORECARD_KEYS.map((k) => [k, 5])) } };
    const sc = evaluateScorecard(data);
    assert.equal(sc.total, 5);
    assert.equal(capturedScore(data, 'revenue_scale'), 5);
  });
});

describe('scorecard capture validation (SCO-02)', () => {
  test('a complete capture normalises to whole 1-5 scores', () => {
    const scores = Object.fromEntries(SCORECARD_KEYS.map((k) => [k, 4]));
    const rec = buildScorecard({ scores, notes: { growth_rate: 'Sustained 28% YoY.' } });
    assert.equal(rec.scores.revenue_scale, 4);
    assert.equal(rec.notes.growth_rate, 'Sustained 28% YoY.');
    assert.equal(rec.by, null);
  });

  test('a missing or out-of-range score is refused', () => {
    assert.throws(() => buildScorecard({ scores: { revenue_scale: 4 } }), /score/);
    const scores = Object.fromEntries(SCORECARD_KEYS.map((k) => [k, 4]));
    scores.unit_economics = 9;
    assert.throws(() => buildScorecard({ scores }), /score/);
  });

  test('an override memo needs a named CIO and a reason of at least 10 characters', () => {
    assert.throws(() => buildScorecardOverride({ reason: 'short', by: 'cio@sirius.local' }), /reason/);
    assert.throws(() => buildScorecardOverride({ reason: 'A sufficiently long reason here.', by: '' }), /CIO/);
    const rec = buildScorecardOverride({ reason: 'Strategic priority entry approved by the IC.', by: 'cio@sirius.local' });
    assert.equal(rec.by, 'cio@sirius.local');
  });
});

describe('two-lens floor (SCO-04)', () => {
  const scoresData = (scores) => ({ [SCORECARD_TAG]: { scores } });
  const all = (n) => Object.fromEntries(SCORECARD_KEYS.map((k) => [k, n]));

  test('the seven criteria split into a strategic and a financial lens', () => {
    assert.deepEqual(SCORECARD_LENSES.map((l) => l.key), ['strategic', 'financial']);
    assert.deepEqual(SCORECARD_LENSES[0].criteria, ['revenue_scale', 'growth_rate', 'ownership_control', 'path_to_liquidity']);
    assert.deepEqual(SCORECARD_LENSES[1].criteria, ['entry_valuation', 'capital_structure', 'unit_economics']);
    assert.equal(SCORECARD_LENS_FLOOR, 3.0);
  });

  test('each lens reports its own weighted sub-total', () => {
    const data = scoresData({
      revenue_scale: 5, growth_rate: 5, ownership_control: 5, path_to_liquidity: 5,
      entry_valuation: 3, capital_structure: 3, unit_economics: 3,
    });
    const sc = evaluateScorecard(data);
    const lens = Object.fromEntries(sc.lenses.map((l) => [l.key, l]));
    assert.equal(lens.strategic.subtotal, 5);
    assert.equal(lens.financial.subtotal, 3);
    assert.equal(lens.strategic.below_floor, false);
    assert.equal(lens.financial.below_floor, false);
  });

  test('a lens below its floor blocks even when the weighted total clears the bar', () => {
    // Strategic five (weight 55), financial two (weight 45): the weighted
    // total is (275 + 90)/100 = 3.65, which clears 3.5, but the financial
    // lens sits at 2.0, below the 3.0 floor. A strong strategic case cannot
    // mask a weak financial one.
    const data = scoresData({
      revenue_scale: 5, growth_rate: 5, ownership_control: 5, path_to_liquidity: 5,
      entry_valuation: 2, capital_structure: 2, unit_economics: 2,
    });
    const sc = evaluateScorecard(data);
    assert.equal(sc.total, 3.65);
    assert.equal(sc.below_lens_floor, true);
    assert.deepEqual(sc.lenses_below_floor, ['financial']);
    assert.equal(sc.outcome, 'override_required');
    assert.match(sc.message, /lens sub-total is below/);
  });

  test('a below-lens-floor deal proceeds once the CIO override memo is on file', () => {
    const data = scoresData({
      revenue_scale: 5, growth_rate: 5, ownership_control: 5, path_to_liquidity: 5,
      entry_valuation: 2, capital_structure: 2, unit_economics: 2,
    });
    data[SCORECARD_OVERRIDE_TAG] = { reason: 'Strategic priority entry approved.', by: 'cio@sirius.local' };
    const sc = evaluateScorecard(data);
    assert.equal(sc.outcome, 'proceed_override');
  });

  test('a balanced scorecard above both floors proceeds', () => {
    const sc = evaluateScorecard(scoresData(all(4)));
    assert.equal(sc.total, 4);
    assert.equal(sc.below_lens_floor, false);
    assert.equal(sc.outcome, 'proceed');
  });

  test('a lens is incomplete until every one of its criteria is scored', () => {
    const lenses = evaluateLenses([
      { key: 'revenue_scale', weight: 15, score: 4, scored: true },
      { key: 'growth_rate', weight: 15, score: null, scored: false },
      { key: 'ownership_control', weight: 10, score: 4, scored: true },
      { key: 'path_to_liquidity', weight: 15, score: 4, scored: true },
      { key: 'entry_valuation', weight: 20, score: 4, scored: true },
      { key: 'capital_structure', weight: 10, score: 4, scored: true },
      { key: 'unit_economics', weight: 15, score: 4, scored: true },
    ]);
    const lens = Object.fromEntries(lenses.map((l) => [l.key, l]));
    assert.equal(lens.strategic.complete, false);
    assert.equal(lens.strategic.below_floor, false);
    assert.equal(lens.financial.complete, true);
  });
});

describe('system-proposed scores (SCO-03)', () => {
  test('growth is proposed from the captured financial growth percentages', () => {
    const data = { financials: { growth: { fy23: 10, fy24: 27 } } };
    const p = proposeScorecardItem('growth_rate', data);
    assert.equal(p.score, 4);
    assert.ok(p.refs.some((r) => r.key === 'financials'));
  });

  test('revenue scale is proposed from the captured snapshot revenue', () => {
    assert.equal(proposeScorecardItem('revenue_scale', { snapshot_revenue_last_fy_aed: 220 }).score, 5);
    assert.equal(proposeScorecardItem('revenue_scale', { snapshot_revenue_last_fy_aed: 60 }).score, 3);
  });

  test('entry valuation is proposed from the captured comps count', () => {
    const data = { entry_valuation_method: 'trading_comps', valuation_comparables: { comparables: [{}, {}, {}] } };
    assert.equal(proposeScorecardItem('entry_valuation', data).score, 4);
  });

  test('a criterion with no supporting data is proposed neutral, never a silent pass', () => {
    const p = proposeScorecardItem('path_to_liquidity', {});
    assert.equal(p.score, 3);
    assert.equal(p.refs.length, 0);
  });

  test('a proposed score is offered but does not count until the reviewer confirms it', () => {
    const data = { snapshot_revenue_last_fy_aed: 220 };
    const sc = evaluateScorecard(data);
    const scale = sc.items.find((i) => i.key === 'revenue_scale');
    assert.equal(scale.proposed_score, 5);
    assert.equal(scale.has_review, false);
    assert.equal(scale.scored, false);
    assert.equal(sc.complete, false);
    assert.equal(sc.awaiting_review, true);
  });

  test('an adjustment away from the proposal is stored with its comment; an exact confirm needs none', () => {
    const proposals = { revenue_scale: 5, growth_rate: 4 };
    const scores = Object.fromEntries(SCORECARD_KEYS.map((k) => [k, 4]));
    // revenue_scale 4 vs proposed 5 is an adjustment and needs a comment.
    assert.throws(() => buildScorecard({ scores }, { proposals }), /comment/);
    const rec = buildScorecard({ scores, comments: { revenue_scale: 'Scale is strong but below the top decile this cycle.' } }, { proposals });
    assert.deepEqual(rec.adjusted, ['revenue_scale']);
    assert.equal(rec.proposed_scores.revenue_scale, 5);
    assert.equal(rec.comments.revenue_scale, 'Scale is strong but below the top decile this cycle.');
    assert.equal(SCORECARD_ADJUST_REASON_MIN, 10);
  });
});

// ---------------------------------------------------------------------------
// Scorecard configuration admin (W3-08 / SCO-05). Versioned criteria, weights,
// thresholds and guide text; each opportunity keeps the revision it scored
// under so a recalibration never silently rewrites history.
// ---------------------------------------------------------------------------
describe('scorecard configuration (SCO-05)', () => {
  test('the shipped default carries a revision, a version and deep-copied criteria', () => {
    const cfg = defaultScorecardConfig();
    assert.equal(cfg.revision, SCORECARD_CONFIG_DEFAULT_REVISION);
    assert.equal(cfg.version, 'SC-01.' + SCORECARD_CONFIG_DEFAULT_REVISION);
    assert.deepEqual(cfg.criteria.map((c) => c.weight), SCORECARD_ITEMS.map((c) => c.weight));
    assert.notEqual(cfg.criteria, SCORECARD_ITEMS);
    assert.equal(validateScorecardConfig(cfg).ok, true);
  });

  test('a weight set that does not total 100, an unknown lens criterion and an out-of-range pass bar are refused', () => {
    const cfg = defaultScorecardConfig();
    const heavy = { ...cfg, criteria: cfg.criteria.map((c) => (c.key === 'revenue_scale' ? { ...c, weight: 30 } : c)) };
    const badWeights = validateScorecardConfig(heavy);
    assert.equal(badWeights.ok, false);
    assert.ok(badWeights.errors.some((e) => /100/.test(e)));

    const badLens = validateScorecardConfig({ ...cfg, lenses: [{ key: 'strategic', label: 'Strategic', criteria: ['nope'] }] });
    assert.equal(badLens.ok, false);
    assert.ok(badLens.errors.some((e) => /unknown criterion/.test(e)));

    const badBar = validateScorecardConfig({ ...cfg, pass_threshold: 9 });
    assert.equal(badBar.ok, false);
    assert.ok(badBar.errors.some((e) => /pass bar/.test(e)));
  });

  test('buildScorecardConfig mints the next revision and a matching version', () => {
    const base = defaultScorecardConfig();
    const next = buildScorecardConfig({ pass_threshold: 3.8 }, { actor: { email: 'admin@dealforge.local' }, base });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.version, 'SC-01.' + next.revision);
    assert.equal(next.pass_threshold, 3.8);
    assert.equal(next.updated_by, 'admin@dealforge.local');
    assert.throws(() => buildScorecardConfig({ pass_threshold: 42 }, { base }), /invalid/);
  });

  test('resolveScorecardConfig falls back to the default when the stored value is invalid or absent', () => {
    assert.equal(resolveScorecardConfig(null).revision, SCORECARD_CONFIG_DEFAULT_REVISION);
    assert.equal(resolveScorecardConfig('{ not json').revision, SCORECARD_CONFIG_DEFAULT_REVISION);
    const good = { ...defaultScorecardConfig(), revision: 9, version: 'SC-01.9', pass_threshold: 4.0 };
    const resolved = resolveScorecardConfig(JSON.stringify(good));
    assert.equal(resolved.revision, 9);
    assert.equal(resolved.pass_threshold, 4.0);
    const corrupt = JSON.stringify({ ...good, pass_threshold: 99 });
    assert.equal(resolveScorecardConfig(corrupt).revision, SCORECARD_CONFIG_DEFAULT_REVISION);
  });

  test('diffScorecardConfig names the fields a recalibration changed', () => {
    const base = defaultScorecardConfig();
    const next = { ...base, revision: base.revision + 1, pass_threshold: 4.0, lens_floor: 2.5 };
    const diff = diffScorecardConfig(base, next);
    assert.ok(diff.some((c) => c.field === 'pass_threshold' && c.to === 4.0));
    assert.ok(diff.some((c) => c.field === 'lens_floor' && c.to === 2.5));
  });

  test('evaluateScorecard honours a custom criteria set and pass bar', () => {
    const criteria = [
      { key: 'alpha', label: 'Alpha', weight: 60, order: 1, threshold: null, guide: null },
      { key: 'beta', label: 'Beta', weight: 40, order: 2, threshold: null, guide: null },
    ];
    const lenses = [{ key: 'all', label: 'All', criteria: ['alpha', 'beta'] }];
    const scores = { alpha: 5, beta: 5 };
    const data = { [SCORECARD_TAG]: { scores } };
    const res = evaluateScorecard(data, { criteria, lenses, passThreshold: 4.9, lensFloor: 4.0, version: 'SC-TEST' });
    assert.equal(res.version, 'SC-TEST');
    assert.deepEqual(res.items.map((i) => i.key), ['alpha', 'beta']);
    assert.equal(res.total, 5);
    assert.equal(res.outcome, 'proceed');
    // A 3.5 bar on the same scores is not enough; 4.9 forces a low score out.
    const low = { [SCORECARD_TAG]: { scores: { alpha: 4, beta: 4 } } };
    const res2 = evaluateScorecard(low, { criteria, lenses, passThreshold: 4.9, lensFloor: 4.0 });
    assert.equal(res2.outcome, 'override_required');
  });

  test('a capture records the configuration version it was scored under', () => {
    const criteria = [
      { key: 'alpha', label: 'Alpha', weight: 100, order: 1, threshold: null, guide: null },
    ];
    const rec = buildScorecard({ scores: { alpha: 4 } }, { criteria, version: 'SC-01.9', proposals: { alpha: 4 } });
    assert.equal(rec.version, 'SC-01.9');
    assert.deepEqual(rec.scores, { alpha: 4 });
  });
});
