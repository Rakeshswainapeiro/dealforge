// Below-floor exception route tests (W1-02 / INT-03, REQ-RULE-02).
//
// Pure configuration + evaluation; no server needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BELOW_FLOOR_TAG, BELOW_FLOOR_FIELDS, BELOW_FLOOR_MESSAGES,
  isBelowFloor, evaluateBelowFloor,
} from '../config/belowFloor.js';
import { MIN_COMMITMENT_AED_MN, BELOW_FLOOR_EXCEPTION_IRR } from '../config/intakeConfig.js';
import { evaluateSelfScreen } from '../config/selfScreen.js';

describe('below-floor exception route (INT-03)', () => {
  test('the route does not apply at or above the floor', () => {
    assert.equal(evaluateBelowFloor({ total_commitment_aed: MIN_COMMITMENT_AED_MN }), null);
    assert.equal(evaluateBelowFloor({ total_commitment_aed: 120 }), null);
    assert.equal(isBelowFloor(MIN_COMMITMENT_AED_MN), false);
    assert.equal(isBelowFloor(9.99), true);
  });

  test('a sub-floor ticket without the exception is not satisfied', () => {
    const r = evaluateBelowFloor({ total_commitment_aed: 6 });
    assert.equal(r.applies, true);
    assert.equal(r.exception, false);
    assert.equal(r.satisfied, false);
    assert.deepEqual(r.stops.map((s) => s.code), ['no_exception']);
  });

  test('the exception needs both a synergy statement and an IRR >= 35%', () => {
    const noSynergy = evaluateBelowFloor({ total_commitment_aed: 6, below_floor_exception: true, return_irr_base: 40 });
    assert.equal(noSynergy.satisfied, false);
    assert.ok(noSynergy.stops.some((s) => s.code === 'synergy_required'));

    const lowIrr = evaluateBelowFloor({ total_commitment_aed: 6, below_floor_exception: true, below_floor_synergy_case: 'Shared rail saves 4mn', return_irr_base: 30 });
    assert.equal(lowIrr.satisfied, false);
    assert.ok(lowIrr.stops.some((s) => s.code === 'irr_required'));

    const ok = evaluateBelowFloor({ total_commitment_aed: 6, below_floor_exception: true, below_floor_synergy_case: 'Shared rail saves 4mn', return_irr_base: BELOW_FLOOR_EXCEPTION_IRR });
    assert.equal(ok.satisfied, true);
    assert.equal(ok.qualifying, true);
    assert.equal(ok.escalated, true);
    assert.equal(ok.stops.length, 0);
  });

  test('exactly at the 35% bar qualifies (boundary)', () => {
    const r = evaluateBelowFloor({ total_commitment_aed: 6, below_floor_exception: true, below_floor_synergy_case: 'x', return_irr_base: 35 });
    assert.equal(r.satisfied, true);
  });

  test('the field keys and tag are configuration, not call-site literals', () => {
    assert.equal(BELOW_FLOOR_TAG, 'below_floor_exception');
    assert.equal(BELOW_FLOOR_FIELDS.synergy, 'below_floor_synergy_case');
    assert.equal(BELOW_FLOOR_FIELDS.irr, 'return_irr_base');
    assert.ok(BELOW_FLOOR_MESSAGES.synergy_required && BELOW_FLOOR_MESSAGES.irr_required);
  });

  test('the self-screen surfaces the below-floor route for a sub-floor answer', () => {
    const base = { opportunity_type: 'bolt_on', total_commitment_aed: 6, sector: 'Technology', geography: 'UAE', in_approved_budget: 'yes', related_party: 'no' };
    const stopped = evaluateSelfScreen(base);
    assert.equal(stopped.decision, 'stop');
    assert.equal(stopped.below_floor.applies, true);
    assert.equal(stopped.below_floor.satisfied, false);

    const flagged = evaluateSelfScreen({ ...base, below_floor_exception: true });
    assert.equal(flagged.decision, 'pass_with_flags');
    // At the pre-form stage the synergy/IRR are not yet captured, so the route
    // is exposed but not satisfied until the financials are filled in.
    assert.equal(flagged.below_floor.applies, true);
    assert.equal(flagged.below_floor.satisfied, false);

    // An above-floor case carries no below-floor route at all.
    assert.equal(evaluateSelfScreen({ ...base, total_commitment_aed: 120 }).below_floor, null);
  });
});
