// ---------------------------------------------------------------------------
// Unit tests for the automatic disqualifier flags (W3-04 / SCR-05).
//
//   node --test server/tests/disqualifiers.test.js
//
// Pure module: the tests pass the opportunity data and the related-party signal
// by hand and assert the five flags, the open-flag set, the valuation-premium
// band and the named-reviewer clear. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDisqualifiers, buildDisqualifierReview, DISQUALIFIER_KEYS, DISQUALIFIER_ITEMS,
  DISQUALIFIER_REVIEW_TAG, DISQUALIFIER_CLEAR_REASON_MIN,
  DISQUALIFIER_VALUATION_PREMIUM_MIN, DISQUALIFIER_VALUATION_PREMIUM_MAX,
  DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD, DISQUALIFIER_MESSAGES,
} from '../config/disqualifiers.js';

const CLEAN = {
  disqualifier_sanctions_pep: 'no',
  disqualifier_minority_protections: 'no',
  disqualifier_valuation_premium_pct: 10,
  disqualifier_undisclosed_related_party: 'no',
  disqualifier_licence_transferable: 'no',
};
const byKey = (dq) => Object.fromEntries(dq.items.map((i) => [i.key, i]));

describe('disqualifier vocabulary (SCR-05)', () => {
  test('names the five BRD disqualifiers in order', () => {
    assert.deepEqual(DISQUALIFIER_KEYS, [
      'sanctions_pep', 'minority_protections', 'valuation_premium', 'undisclosed_related_party', 'licence_transfer',
    ]);
    assert.deepEqual(DISQUALIFIER_ITEMS.map((i) => i.order), [1, 2, 3, 4, 5]);
  });

  test('sets the valuation premium band at 30-40% with a 35% threshold', () => {
    assert.equal(DISQUALIFIER_VALUATION_PREMIUM_MIN, 30);
    assert.equal(DISQUALIFIER_VALUATION_PREMIUM_MAX, 40);
    assert.equal(DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD, 35);
  });
});

describe('disqualifier evaluation (SCR-05)', () => {
  test('a clean opportunity raises no flag and is not complete-blocking', () => {
    const dq = evaluateDisqualifiers(CLEAN);
    assert.equal(dq.has_open_flag, false);
    assert.deepEqual(dq.flagged, []);
    assert.equal(dq.message, DISQUALIFIER_MESSAGES.clear);
  });

  test('an affirmative manual answer raises a named flag', () => {
    const dq = evaluateDisqualifiers({ ...CLEAN, disqualifier_sanctions_pep: 'yes' });
    assert.equal(dq.has_open_flag, true);
    assert.deepEqual(dq.open_flags.map((f) => f.key), ['sanctions_pep']);
    assert.ok(byKey(dq).sanctions_pep.rationale.includes('sanctions'));
  });

  test('an unrecorded disqualifier is not evaluated, never a silent clear', () => {
    const dq = evaluateDisqualifiers({});
    assert.equal(dq.has_open_flag, false);
    assert.equal(dq.items.every((i) => i.status === 'not_evaluated'), true);
    assert.equal(dq.complete, false);
    assert.deepEqual(dq.not_evaluated.sort(), [...DISQUALIFIER_KEYS].sort());
  });

  test('the valuation premium flags inside and above the band, clears below it', () => {
    assert.equal(byKey(evaluateDisqualifiers({ ...CLEAN, disqualifier_valuation_premium_pct: 20 })).valuation_premium.status, 'clear');
    assert.equal(byKey(evaluateDisqualifiers({ ...CLEAN, disqualifier_valuation_premium_pct: 32 })).valuation_premium.status, 'flagged');
    assert.equal(byKey(evaluateDisqualifiers({ ...CLEAN, disqualifier_valuation_premium_pct: 45 })).valuation_premium.status, 'flagged');
  });

  test('an undisclosed related-party signal trips the fourth disqualifier', () => {
    const dq = evaluateDisqualifiers({ ...CLEAN, disqualifier_undisclosed_related_party: undefined }, { relatedParty: { status: 'detected', disclosed: false } });
    assert.equal(byKey(dq).undisclosed_related_party.status, 'flagged');
    assert.ok(byKey(dq).undisclosed_related_party.rationale.includes('related-party'));
  });

  test('an unrecognised answer leaves the disqualifier flagged for a person', () => {
    const dq = evaluateDisqualifiers({ ...CLEAN, disqualifier_licence_transferable: 'maybe' });
    assert.equal(byKey(dq).licence_transfer.status, 'flagged');
  });
});

describe('disqualifier clear (SCR-05)', () => {
  test('a named reviewer with a reason clears an open flag', () => {
    const review = buildDisqualifierReview({ key: 'sanctions_pep', reviewer: 'reviewer@sirius.local', reason: 'Independent screening returned clear.' });
    assert.equal(review.clears.length, 1);
    const dq = evaluateDisqualifiers({ ...CLEAN, disqualifier_sanctions_pep: 'yes', [DISQUALIFIER_REVIEW_TAG]: review });
    assert.equal(dq.has_open_flag, false);
    assert.deepEqual(dq.cleared, ['sanctions_pep']);
    assert.deepEqual(dq.flagged.map((f) => f.key), ['sanctions_pep']);
  });

  test('a short reason or a missing reviewer is rejected', () => {
    assert.throws(() => buildDisqualifierReview({ key: 'sanctions_pep', reviewer: 'reviewer@sirius.local', reason: 'short' }), /reason/);
    assert.throws(() => buildDisqualifierReview({ key: 'sanctions_pep', reason: 'A sufficiently long reason here.' }, { actor: null }), /reviewer/);
    assert.throws(() => buildDisqualifierReview({ key: 'nope', reviewer: 'r@s.local', reason: 'A sufficiently long reason here.' }), /Unknown/);
    assert.equal(DISQUALIFIER_CLEAR_REASON_MIN, 10);
  });

  test('clearing one flag leaves another open', () => {
    const review = buildDisqualifierReview({ key: 'sanctions_pep', reviewer: 'r@s.local', reason: 'Cleared after review.' });
    const dq = evaluateDisqualifiers(
      { ...CLEAN, disqualifier_sanctions_pep: 'yes', disqualifier_minority_protections: 'yes', [DISQUALIFIER_REVIEW_TAG]: review }
    );
    assert.equal(dq.has_open_flag, true);
    assert.deepEqual(dq.open_flags.map((f) => f.key), ['minority_protections']);
  });
});
