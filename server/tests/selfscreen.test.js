// Pre-form self-screen tests (W1-01 / INT-02, REQ-RULE-02/03/04/05).
//
// Pure configuration + evaluation; no server needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SELF_SCREEN_QUESTIONS, SELF_SCREEN_STOPS, SELF_SCREEN_FLAGS, SELF_SCREEN_MESSAGES,
  evaluateSelfScreen, themeSectorMismatch, relatedPartyAnswerFromData,
} from '../config/selfScreen.js';
import { MIN_COMMITMENT_AED_MN, isOutsideAppetite } from '../config/intakeConfig.js';


describe('pre-form self-screen configuration', () => {
  test('asks the six BRD questions (type, commitment, sector, geography, in-plan, related party)', () => {
    assert.deepEqual(SELF_SCREEN_QUESTIONS.map((q) => q.key), [
      'opportunity_type', 'total_commitment_aed', 'sector', 'geography', 'in_approved_budget', 'related_party',
    ]);
  });

  test('every question seeds a capture-model field and every stop has a message', () => {
    for (const q of SELF_SCREEN_QUESTIONS) {
      assert.ok(q.field, q.key + ' needs a capture field');
      assert.ok(['select', 'number'].includes(q.control), q.key + ' needs a control');
      if (q.control === 'select') assert.ok(Array.isArray(q.options) && q.options.length > 0, q.key + ' needs options');
    }
    for (const code of Object.values(SELF_SCREEN_STOPS)) {
      assert.ok(SELF_SCREEN_MESSAGES[code], 'missing message for ' + code);
    }
  });

  test('the floor question carries the AED 10mn minimum (REQ-RULE-02)', () => {
    const commit = SELF_SCREEN_QUESTIONS.find((q) => q.key === 'total_commitment_aed');
    assert.equal(commit.min, MIN_COMMITMENT_AED_MN);
    assert.equal(commit.stop, SELF_SCREEN_STOPS.below_floor);
  });
});

describe('evaluateSelfScreen decisions', () => {
  const base = {
    opportunity_type: 'strategic_acquisition', total_commitment_aed: 120, sector: 'Technology',
    geography: 'UAE', in_approved_budget: 'yes', related_party: 'no',
  };

  test('a clean in-appetite, above-floor case passes with no flags', () => {
    const r = evaluateSelfScreen(base);
    assert.equal(r.decision, 'pass');
    assert.equal(r.blocked, false);
    assert.equal(r.stops.length, 0);
    assert.equal(r.flags.length, 0);
  });

  test('an outside-appetite type stops with the appetites reason (REQ-RULE-04)', () => {
    const r = evaluateSelfScreen({ ...base, opportunity_type: 'passive_punt' });
    assert.equal(r.decision, 'stop');
    assert.equal(r.blocked, true);
    assert.deepEqual(r.stops.map((s) => s.code), [SELF_SCREEN_STOPS.outside_appetite]);
    assert.ok(isOutsideAppetite('passive_punt'));
  });

  test('a below-floor commitment stops unless the exception is chosen (REQ-RULE-02)', () => {
    const stopped = evaluateSelfScreen({ ...base, total_commitment_aed: 6 });
    assert.equal(stopped.decision, 'stop');
    assert.deepEqual(stopped.stops.map((s) => s.code), [SELF_SCREEN_STOPS.below_floor]);

    const excepted = evaluateSelfScreen({ ...base, total_commitment_aed: 6, below_floor_exception: true });
    assert.equal(excepted.decision, 'pass_with_flags');
    assert.equal(excepted.blocked, false);
    assert.ok(excepted.flags.some((f) => f.code === SELF_SCREEN_FLAGS.below_floor_exception));
  });

  test('exactly at the floor clears it (boundary)', () => {
    assert.equal(evaluateSelfScreen({ ...base, total_commitment_aed: MIN_COMMITMENT_AED_MN }).decision, 'pass');
  });

  test('in-plan No, related party Yes and out-of-scope geography raise advisory flags', () => {
    const r = evaluateSelfScreen({ ...base, geography: 'Kenya', in_approved_budget: 'no', related_party: 'yes' });
    assert.equal(r.decision, 'pass_with_flags');
    const codes = r.flags.map((f) => f.code);
    assert.ok(codes.includes(SELF_SCREEN_FLAGS.not_in_plan));
    assert.ok(codes.includes(SELF_SCREEN_FLAGS.related_party));
    assert.ok(codes.includes(SELF_SCREEN_FLAGS.out_of_scope_geography));
  });

  test('a sector off the owning org theme flags a mismatch', () => {
    const r = evaluateSelfScreen({ ...base, sector: 'Energy' }, { theme: { sector: 'Technology' } });
    assert.ok(r.flags.some((f) => f.code === SELF_SCREEN_FLAGS.theme_mismatch));
    assert.equal(themeSectorMismatch('Technology', { sector: 'Technology' }), false);
    assert.equal(themeSectorMismatch('Energy', { sector: 'Technology' }), true);
    assert.equal(themeSectorMismatch('', { sector: 'Technology' }), false);
  });

  test('missing required answers mark the screen incomplete and stop', () => {
    const r = evaluateSelfScreen({});
    assert.equal(r.complete, false);
    assert.equal(r.decision, 'stop');
    assert.ok(r.stops.length >= 2);
  });

  test('each required answer left blank stops the screen, not a false pass', () => {
    // A partly-filled screen must never read as a pass: the in-plan answer alone
    // being missing is enough to halt it with the named reason.
    const r = evaluateSelfScreen({ ...base, in_approved_budget: '' });
    assert.equal(r.complete, false);
    assert.equal(r.decision, 'stop');
    assert.deepEqual(r.stops.map((s) => s.code), ['missing_in_approved_budget']);
  });

  test('related-party answer is derived from the sourcing channel / disclosure', () => {
    assert.equal(relatedPartyAnswerFromData({ sourcing_channel: 'ihc_affiliate_referral' }), 'yes');
    assert.equal(relatedPartyAnswerFromData({ related_party_disclosure: 'Referred by an IHC affiliate.' }), 'yes');
    assert.equal(relatedPartyAnswerFromData({ sourcing_channel: 'proprietary' }), 'no');
  });
});
