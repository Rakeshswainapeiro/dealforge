// ---------------------------------------------------------------------------
// Entry valuation and exit unit tests (W2-08 / FIN-09, REQ-FIN-09).
//
// The accept criteria: the entry valuation is captured as structured fields
// (EV / equity value, amount, multiple, method), the comparable set allows
// 3-5 names, and the exit / value-realisation route and timing are recorded.
// Advisory only — a partial capture raises flags, it never blocks. Pure — no
// server needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateValuation, VALUATION_FIELDS, VALUATION_BASIS_VALUES,
  VALUATION_METHOD_VALUES, COMPARABLE_MIN, COMPARABLE_MAX,
} from '../config/valuation.js';

const comparable = (name, metric, multiple) => ({ name, metric, multiple });

const COMPLETE = {
  [VALUATION_FIELDS.amount]: 210,
  [VALUATION_FIELDS.basis]: 'ev',
  [VALUATION_FIELDS.multiple]: 8.5,
  [VALUATION_FIELDS.method]: 'trading_comps',
  [VALUATION_FIELDS.comparables]: [
    comparable('Al Noor Diagnostics', 'EV/EBITDA', 8.1),
    comparable('Gulf Imaging Holdings', 'EV/EBITDA', 8.7),
    comparable('MedCare Group', 'EV/EBITDA', 8.4),
  ],
  [VALUATION_FIELDS.exit_route]: 'Strategic sale to a regional healthcare platform',
  [VALUATION_FIELDS.exit_timing]: 'FY30 (5-year hold)',
  [VALUATION_FIELDS.exit_multiple]: 9.5,
};

describe('entry valuation and exit (FIN-09)', () => {
  test('a complete capture is complete with no flags', () => {
    const r = evaluateValuation(COMPLETE);
    assert.equal(r.captured, true);
    assert.equal(r.complete, true);
    assert.equal(r.entry.amount, 210);
    assert.equal(r.entry.basis_valid, true);
    assert.equal(r.entry.method_valid, true);
    assert.equal(r.comparable_count, 3);
    assert.equal(r.comparables_ok, true);
    assert.equal(r.exit.complete, true);
    assert.deepEqual(r.flags, []);
    assert.equal(r.message, null);
  });

  test('the basis and method vocabularies are the documented sets', () => {
    assert.deepEqual(VALUATION_BASIS_VALUES, ['ev', 'equity']);
    assert.ok(VALUATION_METHOD_VALUES.includes('trading_comps'));
    assert.ok(VALUATION_METHOD_VALUES.includes('precedent_transactions'));
    assert.ok(VALUATION_METHOD_VALUES.includes('dcf'));
  });

  test('an entry figure without a basis or method is flagged, not discarded', () => {
    const r = evaluateValuation({
      [VALUATION_FIELDS.amount]: 210,
      [VALUATION_FIELDS.multiple]: 8.5,
    });
    assert.equal(r.captured, true);
    assert.equal(r.complete, false);
    const reasons = r.flags.map((f) => f.reason);
    assert.ok(reasons.includes('entry_basis_missing'));
    assert.ok(reasons.includes('entry_method_missing'));
  });

  test('an entry with a valid basis and method but no amount is flagged', () => {
    const r = evaluateValuation({
      [VALUATION_FIELDS.basis]: 'equity',
      [VALUATION_FIELDS.method]: 'dcf',
      [VALUATION_FIELDS.multiple]: 7,
    });
    const reasons = r.flags.map((f) => f.reason);
    assert.ok(reasons.includes('entry_amount_missing'));
    assert.equal(r.entry.basis_valid, true);
  });

  test('a comparable set below the minimum is flagged', () => {
    const r = evaluateValuation({
      ...COMPLETE,
      [VALUATION_FIELDS.comparables]: [
        comparable('Al Noor Diagnostics', 'EV/EBITDA', 8.1),
        comparable('Gulf Imaging Holdings', 'EV/EBITDA', 8.7),
      ],
    });
    assert.equal(r.comparable_count, 2);
    assert.equal(r.comparables_ok, false);
    assert.ok(r.flags.some((f) => f.reason === 'comps_incomplete'));
    assert.equal(r.complete, false);
  });

  test('a comparable set above the maximum is flagged', () => {
    const comps = Array.from({ length: COMPARABLE_MAX + 1 }, (_, i) => comparable('Comp ' + i, 'EV/EBITDA', 8 + i));
    const r = evaluateValuation({ ...COMPLETE, [VALUATION_FIELDS.comparables]: comps });
    assert.equal(r.comparable_count, COMPARABLE_MAX + 1);
    assert.equal(r.comparables_ok, false);
    assert.ok(r.flags.some((f) => f.reason === 'comps_too_many'));
  });

  test('exactly the minimum and maximum comparable counts are both acceptable', () => {
    const atMin = evaluateValuation({
      ...COMPLETE,
      [VALUATION_FIELDS.comparables]: Array.from({ length: COMPARABLE_MIN }, (_, i) => comparable('C' + i, 'EV/EBITDA', 8)),
    });
    assert.equal(atMin.comparables_ok, true);
    const atMax = evaluateValuation({
      ...COMPLETE,
      [VALUATION_FIELDS.comparables]: Array.from({ length: COMPARABLE_MAX }, (_, i) => comparable('C' + i, 'EV/EBITDA', 8)),
    });
    assert.equal(atMax.comparables_ok, true);
  });

  test('an exit route without timing is flagged', () => {
    const r = evaluateValuation({
      ...COMPLETE,
      [VALUATION_FIELDS.exit_timing]: '',
    });
    assert.equal(r.exit.complete, false);
    assert.ok(r.flags.some((f) => f.reason === 'exit_incomplete'));
    assert.equal(r.complete, false);
  });

  test('rows without a comparable name are ignored', () => {
    const r = evaluateValuation({
      [VALUATION_FIELDS.comparables]: [
        comparable('', 'EV/EBITDA', 8),
        comparable('Al Noor Diagnostics', 'EV/EBITDA', 8.1),
      ],
    });
    assert.equal(r.comparable_count, 1);
    assert.deepEqual(r.comparables.map((c) => c.name), ['Al Noor Diagnostics']);
  });

  test('empty data is not captured and not complete', () => {
    const r = evaluateValuation({});
    assert.equal(r.captured, false);
    assert.equal(r.complete, false);
    assert.equal(r.entry.present, false);
    assert.equal(r.comparable_count, 0);
    assert.equal(r.exit.present, false);
    assert.match(r.message, /not captured/i);
  });
});
