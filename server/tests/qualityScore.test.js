// ---------------------------------------------------------------------------
// Unit tests for the overall pre-screening quality score (W3-09 / SCO-01).
//
//   node --test server/tests/qualityScore.test.js
//
// Pure module: the tests pass the gate / alignment results by hand and assert
// the component breakdown, the weighted total, the bands and the configuration
// validation. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_COMPONENTS, QUALITY_COMPONENT_KEYS, QUALITY_BANDS, QUALITY_WEIGHT_TOTAL,
  QUALITY_SCORE_VERSION, QUALITY_SCORE_CONFIG_KEY,
  defaultQualityScoreConfig, validateQualityScoreConfig, resolveQualityScoreConfig,
  buildQualityScoreConfig, evaluateQualityScore, qualityBand,
} from '../config/qualityScore.js';

const fullGate = {
  complete: true,
  missing: [],
  fields: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }],
  hard_filters: { items: [{ status: 'pass' }, { status: 'pass' }, { status: 'pass' }] },
  soft_filters: { applies: true, average: 4 },
  hurdle_table: { applies: true, pass_rate: { base: 8, upside: 8, downside: 8 }, rows: new Array(8) },
  scorecard: { total: 4 },
};

describe('quality score vocabulary (SCO-01)', () => {
  test('names six components whose weights total 100', () => {
    assert.deepEqual(QUALITY_COMPONENT_KEYS, ['eligibility', 'hard_filters', 'soft_filters', 'hurdles', 'alignment', 'scorecard']);
    assert.equal(QUALITY_COMPONENTS.reduce((t, c) => t + c.weight, 0), QUALITY_WEIGHT_TOTAL);
    assert.equal(QUALITY_SCORE_CONFIG_KEY, 'quality_score_config');
  });

  test('the bands are ordered highest first and one has a minimum of 0', () => {
    assert.equal(qualityBand(90).key, 'strong');
    assert.equal(qualityBand(60).key, 'moderate');
    assert.equal(qualityBand(10).key, 'weak');
    assert.ok(QUALITY_BANDS.some((b) => b.min === 0));
  });
});

describe('quality score evaluation (SCO-01)', () => {
  test('a fully available deal gets a weighted 0-100 score with a band', () => {
    const q = evaluateQualityScore({ gate: fullGate, alignment: { score: 80 } });
    assert.equal(q.advisory, true);
    assert.equal(q.available_count, 6);
    assert.equal(q.score, 90);
    assert.equal(q.band, 'strong');
    assert.equal(q.complete, true);
  });

  test('a component with no data is left out and its weight redistributed', () => {
    const gate = { ...fullGate, scorecard: { total: null } };
    const q = evaluateQualityScore({ gate, alignment: { score: 80 } });
    assert.equal(q.components.find((c) => c.key === 'scorecard').available, false);
    assert.deepEqual(q.unavailable, ['scorecard']);
    // Only the other 75% of weight counts, so the score is not dragged to zero.
    assert.ok(q.score > 80);
  });

  test('an entirely empty input yields no score rather than a fabricated one', () => {
    const q = evaluateQualityScore({});
    assert.equal(q.score, null);
    assert.equal(q.band, null);
    assert.equal(q.complete, false);
  });

  test('a failed hard filter lowers the score without blocking the total', () => {
    const gate = { ...fullGate, hard_filters: { items: [{ status: 'fail' }, { status: 'pass' }, { status: 'pass' }] } };
    const q = evaluateQualityScore({ gate, alignment: { score: 80 } });
    assert.ok(q.score < 90);
    const hf = q.components.find((c) => c.key === 'hard_filters');
    assert.ok(hf.score < 100);
  });
});

describe('quality score configuration (SCO-01)', () => {
  test('the shipped default validates and carries a revision', () => {
    const cfg = defaultQualityScoreConfig();
    assert.equal(cfg.revision, 1);
    assert.equal(cfg.version, QUALITY_SCORE_VERSION);
    const v = validateQualityScoreConfig(cfg);
    assert.equal(v.ok, true);
    assert.deepEqual(v.errors, []);
  });

  test('a weight set that does not total 100 or a band set with no zero minimum is refused', () => {
    const cfg = defaultQualityScoreConfig();
    const heavy = { ...cfg, components: cfg.components.map((c) => (c.key === 'eligibility' ? { ...c, weight: 30 } : c)) };
    assert.equal(validateQualityScoreConfig(heavy).ok, false);
    const noZero = { ...cfg, bands: cfg.bands.map((b) => ({ ...b, min: b.min + 1 })) };
    assert.equal(validateQualityScoreConfig(noZero).ok, false);
  });

  test('buildQualityScoreConfig mints the next revision; resolve falls back on garbage', () => {
    const base = defaultQualityScoreConfig();
    const next = buildQualityScoreConfig({ bands: [{ key: 'a', label: 'A', min: 0 }] }, { actor: { email: 'admin@dealforge.local' }, base });
    assert.equal(next.revision, 2);
    assert.equal(next.version, 'QS-01.2');
    assert.throws(() => buildQualityScoreConfig({ components: [{ key: 'x', weight: 5 }] }, { base }), /invalid/);
    assert.equal(resolveQualityScoreConfig('{ bad').revision, 1);
    assert.equal(resolveQualityScoreConfig(JSON.stringify({ ...base, revision: 7 })).revision, 7);
  });
});

