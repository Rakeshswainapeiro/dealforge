import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHurdles, hurdleThresholds, HURDLE_META, HURDLE_KEYS, HURDLE_TABLE_VERSION,
} from '../config/hurdleTable.js';

const THRESHOLDS = {
  equity_irr_min: 20, greenfield_irr_min: 25, roic_wacc_spread: 5,
  payback_max_years: 3.5, concentration_max_pct: 35, leverage_max: 3,
};

const DATA = {
  return_irr_base: 24, return_irr_upside: 31, return_irr_downside: 12,
  return_roic_base: 18, return_roic_upside: 23, return_roic_downside: 6,
  return_payback_years: 3.2, return_payback_upside: 2.7, return_payback_downside: 4.4,
  concentration_pct: 30,
  financials: { net_debt_ebitda: { y1p: 2.8 } },
};

describe('hurdle thresholds (FIN-04)', () => {
  test('the ROIC hurdle is WACC plus the configured spread', () => {
    const thr = hurdleThresholds(THRESHOLDS, { effective_wacc: 9 });
    assert.equal(thr.roic.value, 14);
    assert.equal(thr.equity_irr.value, 20);
    assert.equal(thr.payback.value, 3.5);
  });

  test('the WACC block overrides the stored wacc_pct when present', () => {
    const thr = hurdleThresholds({ ...THRESHOLDS, wacc_pct: 8 }, { effective_wacc: 11 });
    assert.equal(thr.roic.value, 16);
  });

  test('a missing WACC leaves the ROIC hurdle null rather than guessed', () => {
    const thr = hurdleThresholds({ roic_wacc_spread: 5 }, null);
    assert.equal(thr.roic.value, null);
  });
});

describe('computeHurdles (FIN-04)', () => {
  test('reports a Meets? verdict per hurdle per scenario', () => {
    const t = computeHurdles({ data: DATA, thresholds: THRESHOLDS, wacc: { effective_wacc: 9 } });
    const irr = t.rows.find((r) => r.key === 'equity_irr');
    assert.equal(irr.threshold, 20);
    assert.equal(irr.scenarios.base.meets, true);
    assert.equal(irr.scenarios.upside.meets, true);
    assert.equal(irr.scenarios.downside.meets, false);
    const roic = t.rows.find((r) => r.key === 'roic');
    assert.equal(roic.threshold, 14);
    assert.equal(roic.scenarios.base.meets, true);
    assert.equal(roic.scenarios.downside.meets, false);
    const payback = t.rows.find((r) => r.key === 'payback');
    assert.equal(payback.scenarios.downside.meets, false);
  });

  test('the deal-level hurdles are constant across scenarios', () => {
    const t = computeHurdles({ data: DATA, thresholds: THRESHOLDS, wacc: { effective_wacc: 9 } });
    const c = t.rows.find((r) => r.key === 'concentration');
    assert.equal(c.basis, 'deal');
    assert.equal(c.scenarios.base.value, 30);
    assert.equal(c.scenarios.base.meets, true);
    assert.equal(c.scenarios.downside.value, 30);
    const lev = t.rows.find((r) => r.key === 'leverage');
    assert.equal(lev.scenarios.base.value, 2.8);
    assert.equal(lev.scenarios.base.meets, true);
  });

  test('concentration falls back to the percentage named in the rationale', () => {
    const t = computeHurdles({
      data: { ...DATA, concentration_pct: undefined, concentration_impact: 'Rises from 18% to 41%, above the ceiling.' },
      thresholds: THRESHOLDS, wacc: { effective_wacc: 9 },
    });
    const c = t.rows.find((r) => r.key === 'concentration');
    assert.equal(c.scenarios.base.value, 18);
  });

  test('a greenfield opportunity uses the higher IRR hurdle', () => {
    const t = computeHurdles({
      data: { ...DATA, opportunity_type: 'greenfield', return_irr_base: 22 },
      thresholds: THRESHOLDS, wacc: { effective_wacc: 9 },
    });
    assert.equal(t.greenfield, true);
    assert.equal(t.equity_irr_threshold, 25);
    assert.equal(t.rows.find((r) => r.key === 'equity_irr').scenarios.base.meets, false);
  });

  test('below-hurdle cases surface as advisory flags, never a block', () => {
    const t = computeHurdles({ data: DATA, thresholds: THRESHOLDS, wacc: { effective_wacc: 9 } });
    assert.equal(t.any_below, true);
    assert.equal(t.meets_all, false);
    assert.ok(t.flags.some((f) => f.reason === 'below_hurdle' && f.key === 'payback'));
    assert.ok(t.flags.every((f) => !('blocked' in f)));
  });

  test('a hurdle with no configured threshold is flagged as unconfigured', () => {
    const t = computeHurdles({ data: DATA, thresholds: { ...THRESHOLDS, leverage_max: undefined }, wacc: { effective_wacc: 9 } });
    assert.ok(t.flags.some((f) => f.reason === 'no_threshold' && f.key === 'leverage'));
  });

  test('the result and its config are stamped with the policy revision', () => {
    const t = computeHurdles({ data: DATA, thresholds: THRESHOLDS, wacc: { effective_wacc: 9 } });
    assert.equal(t.version, HURDLE_TABLE_VERSION);
    assert.deepEqual(t.rows.map((r) => r.key), HURDLE_KEYS);
    assert.deepEqual(HURDLE_META.map((h) => h.key), HURDLE_KEYS);
  });

  test('an empty capture yields no verdicts rather than false ones', () => {
    const t = computeHurdles({ data: {}, thresholds: THRESHOLDS, wacc: { effective_wacc: 9 } });
    const irr = t.rows.find((r) => r.key === 'equity_irr');
    assert.equal(irr.scenarios.base.meets, null);
    assert.equal(irr.scenarios.base.present, false);
    assert.equal(t.any_below, false);
  });

  test('leverage derives from a captured Net debt line when the ratio is absent', () => {
    const t = computeHurdles({
      data: { ...DATA, financials: { net_debt: { y1p: 40 }, ebitda: { y1p: 20 } } },
      thresholds: THRESHOLDS, wacc: { effective_wacc: 9 },
    });
    const lev = t.rows.find((r) => r.key === 'leverage');
    assert.equal(lev.scenarios.base.value, 2);
    assert.equal(lev.scenarios.base.meets, true);
  });


});

