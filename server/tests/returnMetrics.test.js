// ---------------------------------------------------------------------------
// Unit tests for the three-scenario return metrics (W2-03 / FIN-03).
// Pure functions only — no server, no database.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETURN_SCENARIOS, RETURN_SCENARIO_KEYS, RETURN_METRICS, RETURN_METRIC_KEYS,
  returnsFromFlatFields, evaluateReturnMetrics,
} from '../config/returnMetrics.js';

const COMPLETE = {
  return_irr_base: 26, return_irr_upside: 34, return_irr_downside: 13,
  return_roic_base: 19, return_roic_upside: 24, return_roic_downside: 9,
  return_payback_years: 3.1, return_payback_upside: 2.6, return_payback_downside: 4.2,
  return_moic_base: 2.4, return_moic_upside: 3.2, return_moic_downside: 1.5,
};

describe('return metrics config', () => {
  test('declares the three mandated scenarios in order', () => {
    assert.deepEqual(RETURN_SCENARIO_KEYS, ['base', 'upside', 'downside']);
    assert.ok(RETURN_SCENARIOS.every((s) => s.required));
  });

  test('captures Equity IRR, ROIC and payback as required, MOIC where relevant', () => {
    assert.deepEqual(RETURN_METRIC_KEYS, ['equity_irr', 'roic', 'payback', 'moic']);
    const moic = RETURN_METRICS.find((m) => m.key === 'moic');
    assert.equal(moic.required, false);
    assert.equal(moic.where_relevant, true);
    assert.ok(RETURN_METRICS.filter((m) => m.required).every((m) => !m.where_relevant));
  });
});

describe('returnsFromFlatFields', () => {
  test('maps flat capture fields onto the memo scenario table', () => {
    const table = returnsFromFlatFields(COMPLETE);
    assert.deepEqual(table.equity_irr, { base: 26, upside: 34, downside: 13 });
    assert.deepEqual(table.roic, { base: 19, upside: 24, downside: 9 });
    assert.deepEqual(table.payback, { base: 3.1, upside: 2.6, downside: 4.2 });
    assert.deepEqual(table.moic, { base: 2.4, upside: 3.2, downside: 1.5 });
  });

  test('omits a metric with no captured value and blanks empty cells', () => {
    const table = returnsFromFlatFields({ return_irr_base: 22 });
    assert.deepEqual(table.equity_irr, { base: 22, upside: null, downside: null });
    assert.equal(table.roic, undefined);
  });
});

describe('evaluateReturnMetrics', () => {
  test('a full three-scenario set is complete with the downside present', () => {
    const r = evaluateReturnMetrics(COMPLETE);
    assert.equal(r.applies, true);
    assert.equal(r.complete, true);
    assert.equal(r.missing_count, 0);
    assert.equal(r.downside_present, true);
    assert.equal(r.moic_relevant, true);
    assert.equal(r.scenarios.base.present, true);
    assert.deepEqual(r.scenario_order, ['base', 'upside', 'downside']);
  });

  test('a missing downside case is flagged as mandatory', () => {
    const r = evaluateReturnMetrics({ ...COMPLETE, return_irr_downside: '', return_roic_downside: '', return_payback_downside: '' });
    assert.equal(r.downside_present, false);
    assert.equal(r.complete, false);
    assert.ok(r.missing.some((m) => m.scenario === 'downside' && m.metric === 'equity_irr'));
    assert.match(r.message, /downside/i);
  });

  test('missing required cells are listed per metric and scenario', () => {
    const r = evaluateReturnMetrics({ return_irr_base: 20 });
    assert.equal(r.complete, false);
    // 3 scenarios x 3 required metrics = 9; only base IRR captured.
    assert.equal(r.missing_count, 8);
    assert.ok(r.missing.every((m) => m.metric !== 'moic'));
  });

  test('MOIC alone does not make an incomplete set complete', () => {
    const r = evaluateReturnMetrics({ return_moic_base: 2.1 });
    assert.equal(r.complete, false);
    assert.equal(r.moic_relevant, true);
  });
});
