// ---------------------------------------------------------------------------
// Unit tests for the Gate-1 hard filters (W3-02 / SCR-03).
//
//   node --test server/tests/hardFilters.test.js
//
// Pure module: the tests pass the theme and thresholds by hand and assert the
// five filters, the recommended outcome and the reviewer decision. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateHardFilters, buildHardFilterReview, HARD_FILTER_KEYS, HARD_FILTER_ITEMS,
  HARD_FILTER_OUTCOMES, HARD_FILTER_REVIEW_DECISIONS, HARD_FILTER_REVIEW_TAG,
  HARD_FILTER_MESSAGES,
} from '../config/hardFilters.js';

// A deal that passes every filter: in-theme, inside the band, all manual
// confirmations clear, no portfolio conflict.
const CLEAN = {
  sector: 'Technology',
  total_commitment_aed: 120,
  hard_filter_sanctions: 'clear',
  hard_filter_structuring: 'compatible',
  hard_filter_portfolio_conflict: 'none',
};

const THEME = { sector: 'Technology', min_aed: 10, max_aed: 500 };
const THRESHOLDS = { floor_aed: 10 };

const byKey = (hf) => Object.fromEntries(hf.items.map((i) => [i.key, i]));

describe('hard filter vocabulary (SCR-03)', () => {
  test('names the five BRD filters in order', () => {
    assert.deepEqual(HARD_FILTER_KEYS, ['designated_vertical', 'check_size', 'sanctions_export', 'structuring', 'portfolio_conflict']);
    assert.deepEqual(HARD_FILTER_ITEMS.map((i) => i.order), [1, 2, 3, 4, 5]);
    assert.deepEqual(HARD_FILTER_OUTCOMES, ['proceed', 'recommended_decline']);
    assert.deepEqual(HARD_FILTER_REVIEW_DECISIONS, ['confirmed', 'overridden']);
  });
});

describe('hard filter evaluation (SCR-03)', () => {
  test('a clean, in-theme deal proceeds and every filter passes', () => {
    const hf = evaluateHardFilters(CLEAN, { theme: THEME, thresholds: THRESHOLDS });
    assert.equal(hf.recommended_outcome, 'proceed');
    assert.equal(hf.complete, true);
    assert.equal(hf.failed.length, 0);
    assert.equal(hf.awaiting_review, false);
    for (const item of hf.items) assert.equal(item.status, 'pass', item.key + ': ' + item.rationale);
    assert.ok(hf.message.includes('may proceed'));
  });

  test('an off-theme sector fails the designated-vertical filter with the reason', () => {
    const hf = evaluateHardFilters({ ...CLEAN, sector: 'Industrials' }, { theme: THEME, thresholds: THRESHOLDS });
    const v = byKey(hf).designated_vertical;
    assert.equal(v.status, 'fail');
    assert.ok(v.rationale.includes('outside the designated vertical'));
    assert.equal(hf.recommended_outcome, 'recommended_decline');
    assert.ok(hf.recommended_reason.startsWith('Recommended decline.'));
    assert.equal(hf.awaiting_review, true);
  });

  test('a reasoned theme exception passes the designated-vertical filter', () => {
    const hf = evaluateHardFilters(
      { ...CLEAN, sector: 'Industrials', theme_exception_reason: 'Adjacent logistics platform approved by the IC.' },
      { theme: THEME, thresholds: THRESHOLDS }
    );
    assert.equal(byKey(hf).designated_vertical.status, 'pass');
    assert.equal(hf.recommended_outcome, 'proceed');
  });

  test('a missing theme leaves the vertical not evaluated, never a false verdict', () => {
    const hf = evaluateHardFilters(CLEAN, { theme: null, thresholds: THRESHOLDS });
    const v = byKey(hf).designated_vertical;
    assert.equal(v.status, 'not_evaluated');
    assert.equal(v.pending, true);
    assert.equal(hf.complete, false);
  });

  test('a commitment below the band floor fails the size filter', () => {
    const hf = evaluateHardFilters({ ...CLEAN, total_commitment_aed: 4 }, { theme: THEME, thresholds: THRESHOLDS });
    const s = byKey(hf).check_size;
    assert.equal(s.status, 'fail');
    assert.ok(s.rationale.includes('below the AED 10mn band floor'));
    assert.equal(hf.recommended_outcome, 'recommended_decline');
  });

  test('a commitment above the band ceiling fails the size filter', () => {
    const hf = evaluateHardFilters({ ...CLEAN, total_commitment_aed: 900 }, { theme: THEME, thresholds: THRESHOLDS });
    assert.equal(byKey(hf).check_size.status, 'fail');
    assert.ok(byKey(hf).check_size.rationale.includes('above the AED 500mn band ceiling'));
  });

  test('an unconfirmed manual filter is a flag, never a silent pass', () => {
    const hf = evaluateHardFilters({ ...CLEAN, hard_filter_sanctions: '' }, { theme: THEME, thresholds: THRESHOLDS });
    const s = byKey(hf).sanctions_export;
    assert.equal(s.status, 'flag');
    assert.equal(s.pending, true);
    assert.equal(hf.recommended_outcome, 'proceed', 'an unconfirmed filter does not by itself recommend decline');
  });

  test('a sanctions exposure fails the compliance filter', () => {
    const hf = evaluateHardFilters(
      { ...CLEAN, hard_filter_sanctions: 'exposure', hard_filter_sanctions_note: 'A minority shareholder is on a sanctions list.' },
      { theme: THEME, thresholds: THRESHOLDS }
    );
    const s = byKey(hf).sanctions_export;
    assert.equal(s.status, 'fail');
    assert.equal(s.detail.note, 'A minority shareholder is on a sanctions list.');
    assert.equal(hf.recommended_outcome, 'recommended_decline');
  });

  test('a structuring exception fails the structuring filter', () => {
    const hf = evaluateHardFilters({ ...CLEAN, hard_filter_structuring: 'exception_needed' }, { theme: THEME, thresholds: THRESHOLDS });
    assert.equal(byKey(hf).structuring.status, 'fail');
  });

  test('a declared conflict with no assessment fails the portfolio-conflict filter', () => {
    const hf = evaluateHardFilters(
      { ...CLEAN, hard_filter_portfolio_conflict: '', conflict_of_interest: 'The target competes with an existing holding.' },
      { theme: THEME, thresholds: THRESHOLDS }
    );
    assert.equal(byKey(hf).portfolio_conflict.status, 'fail');
    assert.ok(byKey(hf).portfolio_conflict.rationale.includes('un-mitigable'));
  });

  test('a mitigable conflict needs a named reviewer to pass', () => {
    const withoutReviewer = evaluateHardFilters({ ...CLEAN, hard_filter_portfolio_conflict: 'mitigated' }, { theme: THEME, thresholds: THRESHOLDS });
    assert.equal(byKey(withoutReviewer).portfolio_conflict.status, 'fail');
    const withReviewer = evaluateHardFilters(
      { ...CLEAN, hard_filter_portfolio_conflict: 'mitigated', hard_filter_conflict_reviewer: 'ci.office@infinia.local' },
      { theme: THEME, thresholds: THRESHOLDS }
    );
    assert.equal(byKey(withReviewer).portfolio_conflict.status, 'pass');
  });

  test('an un-mitigable conflict fails the filter', () => {
    const hf = evaluateHardFilters({ ...CLEAN, hard_filter_portfolio_conflict: 'unmitigable' }, { theme: THEME, thresholds: THRESHOLDS });
    assert.equal(byKey(hf).portfolio_conflict.status, 'fail');
  });
});

describe('hard filter reviewer decision (SCR-03 / SCR-09)', () => {
  test('the system never rejects on its own: a failed filter only recommends decline', () => {
    const hf = evaluateHardFilters({ ...CLEAN, sector: 'Industrials' }, { theme: THEME, thresholds: THRESHOLDS });
    assert.equal(hf.recommended_outcome, 'recommended_decline');
    assert.equal(hf.effective_outcome, 'recommended_decline');
    assert.equal(hf.review, null);
    assert.equal(hf.awaiting_review, true);
    assert.ok(HARD_FILTER_MESSAGES.recommended_decline.includes('recommends decline'));
  });

  test('an override needs a written reason and records who decided', () => {
    assert.throws(() => buildHardFilterReview({ decision: 'overridden', reason: 'too short' }), /at least 10 characters/);
    assert.throws(() => buildHardFilterReview({ decision: 'maybe', reason: 'a good long reason' }), /decision must be one of/);
    const review = buildHardFilterReview(
      { decision: 'overridden', reason: 'The vertical exception was approved by the IC.' },
      { actor: { email: 'cio@sirius.local' }, at: '2026-02-01T09:00:00.000Z' }
    );
    assert.equal(review.decision, 'overridden');
    assert.equal(review.by, 'cio@sirius.local');
    assert.equal(review.at, '2026-02-01T09:00:00.000Z');
  });

  test('an override on the record flips the effective outcome and the message', () => {
    const hf = evaluateHardFilters(
      {
        ...CLEAN, sector: 'Industrials',
        [HARD_FILTER_REVIEW_TAG]: { decision: 'overridden', reason: 'The vertical exception was approved.', by: 'cio@sirius.local', at: '2026-02-01T09:00:00.000Z' },
      },
      { theme: THEME, thresholds: THRESHOLDS }
    );
    assert.equal(hf.recommended_outcome, 'recommended_decline');
    assert.equal(hf.effective_outcome, 'overridden');
    assert.equal(hf.awaiting_review, false);
    assert.ok(hf.message.includes('overrode'));
  });

  test('a confirmation keeps the recommended decline and clears the awaiting state', () => {
    const hf = evaluateHardFilters(
      {
        ...CLEAN, sector: 'Industrials',
        [HARD_FILTER_REVIEW_TAG]: { decision: 'confirmed', reason: 'The filter genuinely fails.', by: 'cio@sirius.local', at: '2026-02-01T09:00:00.000Z' },
      },
      { theme: THEME, thresholds: THRESHOLDS }
    );
    assert.equal(hf.effective_outcome, 'recommended_decline');
    assert.equal(hf.awaiting_review, false);
    assert.ok(hf.message.includes('confirmed'));
  });
});

