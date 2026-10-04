// Financial summary configuration tests (FIN-01, W2-01).
//
// Pure functions only — these assert the Part B page-4 matrix, the derived
// ratios and the new-venture rule, and that the memo reproduces them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FINANCIAL_PERIODS, FINANCIAL_PERIOD_KEYS, ACTUAL_PERIOD_KEYS, PROJECTION_PERIOD_KEYS,
  FINANCIAL_ROWS, FINANCIAL_INPUT_KEYS, FINANCIAL_DERIVED_KEYS,
  deriveFinancials, financialProgress, evaluateFinancials, isNewVenture,
} from '../config/financials.js';
import { buildSiriusMemo } from '../config/siriusMemo.js';

const CAPTURED = {
  revenue:    { fy3a: 92, fy2a: 108, fy1a: 128, y1p: 148, y2p: 171 },
  ebitda:     { fy3a: 14, fy2a: 18, fy1a: 23, y1p: 29, y2p: 36 },
  net_income: { fy3a: 6, fy2a: 9, fy1a: 12, y1p: 16, y2p: 21 },
  capex:      { fy3a: 5, fy2a: 6, fy1a: 7, y1p: 9, y2p: 10 },
};

describe('financial summary config (FIN-01)', () => {
  test('the columns are exactly the Part B page-4 FY-3 A ... Y5 P periods', () => {
    assert.deepEqual(FINANCIAL_PERIODS, ['FY-3 A', 'FY-2 A', 'FY-1 A', 'Y1 P', 'Y2 P', 'Y3 P', 'Y4 P', 'Y5 P']);
    assert.equal(FINANCIAL_PERIOD_KEYS.length, FINANCIAL_PERIODS.length);
    assert.deepEqual(ACTUAL_PERIOD_KEYS, ['fy3a', 'fy2a', 'fy1a']);
    assert.deepEqual(PROJECTION_PERIOD_KEYS, ['y1p', 'y2p', 'y3p', 'y4p', 'y5p']);
  });

  test('the eight rows match the template order and kinds', () => {
    assert.deepEqual(FINANCIAL_ROWS.map((r) => r.label), [
      'Revenue', 'Growth %', 'EBITDA', 'EBITDA margin %',
      'Net income', 'Capex', 'Free cash flow', 'Net debt / EBITDA',
    ]);
    assert.deepEqual(FINANCIAL_DERIVED_KEYS, ['growth', 'ebitda_margin', 'free_cash_flow']);
    assert.ok(FINANCIAL_INPUT_KEYS.includes('revenue'));
    assert.ok(FINANCIAL_INPUT_KEYS.includes('net_debt_ebitda'));
  });

  test('growth % is derived from revenue against the prior period', () => {
    const d = deriveFinancials(CAPTURED);
    // (108-92)/92 = 17.39 -> 17.4
    assert.equal(d.growth.fy2a, 17.4);
    // (148-128)/128 = 15.625 -> 15.6
    assert.equal(d.growth.y1p, 15.6);
    // no prior year for FY-3 A
    assert.equal(d.growth.fy3a, null);
  });

  test('EBITDA margin % is derived from EBITDA / revenue', () => {
    const d = deriveFinancials(CAPTURED);
    assert.equal(d.ebitda_margin.fy3a, Math.round((14 / 92) * 1000) / 10); // 15.2
    assert.equal(d.ebitda_margin.fy1a, Math.round((23 / 128) * 1000) / 10); // 18.0
  });

  test('free cash flow is derived as EBITDA minus capex', () => {
    const d = deriveFinancials(CAPTURED);
    assert.equal(d.free_cash_flow.fy3a, 9);   // 14 - 5
    assert.equal(d.free_cash_flow.y1p, 20);   // 29 - 9
  });

  test('net debt / EBITDA is derived when a net debt line is supplied', () => {
    const d = deriveFinancials({
      ebitda:   { y1p: 29 },
      net_debt: { y1p: 40 },
    });
    assert.equal(d.net_debt_ebitda.y1p, Math.round((40 / 29) * 100) / 100); // 1.38
  });

  test('a captured derived value overrides the formula', () => {
    const d = deriveFinancials({
      revenue: { y1p: 100, y2p: 120 },
      growth:  { y2p: 42 },
    });
    assert.equal(d.growth.y2p, 42);
  });

  test('a new venture may leave the actual columns blank', () => {
    const venture = {
      opportunity_type: 'greenfield',
      financials: {
        revenue: { y1p: 20, y2p: 46 },
        ebitda:  { y1p: 2,  y2p: 8 },
        net_income: { y1p: -1, y2p: 3 },
        capex:   { y1p: 12, y2p: 14 },
        net_debt: { y1p: 18, y2p: 22 },
      },
    };
    assert.equal(isNewVenture('greenfield'), true);
    const result = evaluateFinancials(venture);
    assert.equal(result.new_venture, true);
    assert.equal(result.missing.length, 0, 'blank actuals are not a gap for a new venture');
  });

  test('a mature opportunity with no financials reports every input row missing', () => {
    const result = evaluateFinancials({ opportunity_type: 'strategic_acquisition' });
    assert.equal(result.new_venture, false);
    assert.ok(result.missing.includes('revenue'));
    assert.ok(result.missing.includes('ebitda'));
    assert.ok(result.missing.includes('net_debt_ebitda'));
    assert.equal(result.complete, false);
  });

  test('financialProgress counts present cells per row', () => {
    const progress = financialProgress(CAPTURED);
    const revenue = progress.rows.find((r) => r.key === 'revenue');
    assert.equal(revenue.present, 5);
    assert.equal(revenue.total, 8);
    assert.ok(progress.progress > 0 && progress.progress <= 100);
  });
});

describe('page-4 financials flow through the memo (FIN-01)', () => {
  test('the memo financial table renders the derived ratios', () => {
    const memo = buildSiriusMemo({
      opportunity: { id: 'opp-fin', owner_org_id: 'org-x', data: { opportunity_name: 'Fin Test', financials: CAPTURED } },
      org: { id: 'org-x', name: 'Test Co' },
    });
    const fin = memo.pages[3].sections.find((s) => s.type === 'finTable');
    assert.deepEqual(fin.periods, FINANCIAL_PERIODS);
    const growth = fin.rows.find((r) => r.label === 'Growth %');
    assert.equal(growth.values[1], '17.4');
    const fcf = fin.rows.find((r) => r.label === 'Free cash flow');
    assert.equal(fcf.values[0], '9');
    const margin = fin.rows.find((r) => r.label === 'EBITDA margin %');
    assert.equal(margin.values[0], '15.2');
  });

  test('a sparse financial matrix still yields the template placeholder', () => {
    const memo = buildSiriusMemo({
      opportunity: { id: 'opp-empty', owner_org_id: 'org-x', data: { opportunity_name: 'Empty' } },
      org: null,
    });
    const fin = memo.pages[3].sections.find((s) => s.type === 'finTable');
    assert.equal(fin.rows.length, 8);
    assert.ok(fin.rows.every((r) => r.values.every((v) => v === '[ ]')));
  });
});
