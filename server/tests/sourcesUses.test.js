import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSourcesUses, SOURCE_ROWS, USE_ROWS,
  SOURCES_NOT_USES_MESSAGE, SIRIUS_HIERARCHY_MESSAGE,
} from '../config/sourcesUses.js';

const plan = (sources, uses) => ({ funding_plan: { sources, uses } });

describe('funding sources and uses (FIN-06)', () => {
  test('the source and use rows match the BRD list', () => {
    assert.deepEqual(SOURCE_ROWS.map((s) => s.key), ['subsidiary_accruals', 'subsidiary_debt', 'partner_co_investor', 'sirius_capital']);
    assert.deepEqual(USE_ROWS.map((u) => u.key), ['purchase_price', 'transaction_costs', 'working_capital', 'contingency']);
  });

  test('sources equal to uses reconcile and carry no balance flag', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'subsidiary_accruals', aed: 20, status: 'secured' }, { key: 'sirius_capital', aed: 80, status: 'secured' }],
      [{ key: 'purchase_price', aed: 90 }, { key: 'transaction_costs', aed: 10 }],
    ));
    assert.equal(r.captured, true);
    assert.equal(r.total_sources, 100);
    assert.equal(r.total_uses, 100);
    assert.equal(r.balanced, true);
    assert.ok(!r.flags.some((f) => f.reason === 'sources_not_uses'));
  });

  test('an imbalance raises sources-not-equal-uses', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'sirius_capital', aed: 60, status: 'secured' }],
      [{ key: 'purchase_price', aed: 100 }],
    ));
    assert.equal(r.balanced, false);
    assert.ok(r.flags.some((f) => f.reason === 'sources_not_uses'));
    assert.match(r.message, /do not equal uses/);
  });

  test('percentages are derived when not captured', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'subsidiary_debt', aed: 25 }, { key: 'sirius_capital', aed: 75 }],
      [{ key: 'purchase_price', aed: 100 }],
    ));
    const debt = r.sources.find((s) => s.key === 'subsidiary_debt');
    const sirius = r.sources.find((s) => s.key === 'sirius_capital');
    assert.equal(debt.pct, 25);
    assert.equal(sirius.pct, 75);
  });

  test('Sirius capital drawn ahead of a cheaper source raises the hierarchy warning', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'subsidiary_accruals', aed: 10, status: 'indicative' }, { key: 'sirius_capital', aed: 90, status: 'secured' }],
      [{ key: 'purchase_price', aed: 100 }],
    ));
    assert.equal(r.hierarchy.violation, true);
    assert.ok(r.hierarchy.ahead_of.includes('subsidiary_accruals'));
    assert.ok(r.flags.some((f) => f.reason === 'funding_hierarchy'));
    assert.match(r.message, /ahead of cheaper sources/);
  });

  test('the hierarchy warning does not fire when cheaper sources are secured first', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'subsidiary_accruals', aed: 40, status: 'secured' }, { key: 'sirius_capital', aed: 60, status: 'secured' }],
      [{ key: 'purchase_price', aed: 100 }],
    ));
    assert.equal(r.hierarchy.violation, false);
    assert.ok(!r.flags.some((f) => f.reason === 'funding_hierarchy'));
  });

  test('an unknown status is flagged rather than silently accepted', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'sirius_capital', aed: 100, status: 'maybe' }],
      [{ key: 'purchase_price', aed: 100 }],
    ));
    assert.ok(r.flags.some((f) => f.reason === 'invalid_status'));
  });

  test('an empty plan reports not captured without a false balance', () => {
    const r = evaluateSourcesUses({});
    assert.equal(r.captured, false);
    assert.equal(r.balanced, false);
    assert.ok(!r.flags.length);
    assert.match(r.message, /not captured/);
  });

  test('a small rounding difference within tolerance still balances', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'sirius_capital', aed: 100, status: 'secured' }],
      [{ key: 'purchase_price', aed: 99.5 }],
    ));
    assert.equal(r.balanced, true);
  });

  test('the message names both imbalance and hierarchy when both apply', () => {
    const r = evaluateSourcesUses(plan(
      [{ key: 'subsidiary_debt', aed: 10, status: 'indicative' }, { key: 'sirius_capital', aed: 80, status: 'secured' }],
      [{ key: 'purchase_price', aed: 100 }],
    ));
    assert.equal(r.balanced, false);
    assert.equal(r.hierarchy.violation, true);
    assert.ok(r.message.includes(SOURCES_NOT_USES_MESSAGE));
    assert.ok(r.message.includes(SIRIUS_HIERARCHY_MESSAGE));
  });
});

