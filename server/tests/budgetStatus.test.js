// ---------------------------------------------------------------------------
// Budget status unit tests (W2-07 / FIN-07, REQ-FIN-07).
//
// The rule: the preparer confirms whether the opportunity is in the approved
// budget. If 'No', a variance memo upload becomes mandatory (and a variance
// justification is required); if 'Yes', a budget line reference is recorded and
// its absence is advisory only. Pure — no server needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBudgetStatus, BUDGET_FIELDS, VARIANCE_MEMO_KEY,
} from '../config/budgetStatus.js';

describe('budget status (FIN-07)', () => {
  test('in-budget with a line reference is satisfied with no flags', () => {
    const r = evaluateBudgetStatus({
      [BUDGET_FIELDS.answer]: 'yes',
      [BUDGET_FIELDS.line_reference]: 'FY27 capex — subsidiary growth envelope',
    });
    assert.equal(r.satisfied, true);
    assert.equal(r.in_budget, true);
    assert.equal(r.off_budget, false);
    assert.equal(r.variance_memo_required, false);
    assert.deepEqual(r.stops, []);
    assert.deepEqual(r.flags, []);
  });

  test('in-budget without a line reference is satisfied but flagged advisory', () => {
    const r = evaluateBudgetStatus({ [BUDGET_FIELDS.answer]: 'yes' });
    assert.equal(r.satisfied, true);
    assert.deepEqual(r.stops, []);
    assert.deepEqual(r.flags.map((f) => f.reason), ['budget_line_missing']);
  });

  test('an unanswered budget status is a hard stop', () => {
    const r = evaluateBudgetStatus({});
    assert.equal(r.answered, false);
    assert.equal(r.satisfied, false);
    assert.ok(r.stops.some((s) => s.code === 'budget_answer_required'));
  });

  test('off-budget makes the variance memo mandatory and the justification required', () => {
    const r = evaluateBudgetStatus(
      { [BUDGET_FIELDS.answer]: 'no' },
      { documents: [] }
    );
    assert.equal(r.off_budget, true);
    assert.equal(r.variance_memo_required, true);
    assert.equal(r.variance_memo_key, VARIANCE_MEMO_KEY);
    assert.equal(r.satisfied, false);
    const codes = r.stops.map((s) => s.code);
    assert.ok(codes.includes('variance_justification_required'));
    assert.ok(codes.includes('variance_memo_required'));
    assert.ok(r.stops.find((s) => s.code === 'variance_memo_required').document);
  });

  test('off-budget is satisfied once the justification and the memo are supplied', () => {
    const r = evaluateBudgetStatus(
      { [BUDGET_FIELDS.answer]: 'no', [BUDGET_FIELDS.justification]: 'Timing slipped a quarter; the board approved the variance.' },
      { documents: [VARIANCE_MEMO_KEY] }
    );
    assert.equal(r.variance_memo_present, true);
    assert.equal(r.satisfied, true);
    assert.deepEqual(r.stops, []);
  });

  test('off-budget with a justification but no memo still stops on the memo', () => {
    const r = evaluateBudgetStatus(
      { [BUDGET_FIELDS.answer]: 'no', [BUDGET_FIELDS.justification]: 'Board approved the variance.' },
      { documents: [] }
    );
    assert.equal(r.satisfied, false);
    assert.deepEqual(r.stops.map((s) => s.code), ['variance_memo_required']);
  });

  test('the document check is skipped when no document set is given', () => {
    const r = evaluateBudgetStatus({
      [BUDGET_FIELDS.answer]: 'no',
      [BUDGET_FIELDS.justification]: 'Variance approved by the board.',
    });
    assert.equal(r.variance_memo_present, null);
    assert.equal(r.satisfied, true);
  });

  test('the in-budget advisory note never blocks submission', () => {
    const r = evaluateBudgetStatus({ [BUDGET_FIELDS.answer]: 'yes', [BUDGET_FIELDS.status]: 'in_budget' });
    assert.equal(r.satisfied, true);
    assert.equal(r.budget_status, 'in_budget');
  });
});
