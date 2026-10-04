// Sourcing-channel side-effects tests (W1-08 / BRD INT-05, REQ-GATE-08).
//
// Pure configuration + evaluation: the channel is mandatory, an IHC /
// affiliate referral auto-sets the related-party flag, and a banker /
// advisor-led process sets the compressed-timeline indicator.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateSourcingChannel, findSourcingChannel, SOURCING_CHANNEL_MESSAGES,
  RELATED_PARTY_TAG, COMPRESSED_TIMELINE_TAG, COMPRESSED_TIMELINE_CHANNEL,
} from '../config/sourcingChannel.js';
import { SOURCING_CHANNELS } from '../config/intakeConfig.js';

describe('sourcing-channel config', () => {
  test('exposes all five REQ-GATE-08 channels', () => {
    const values = SOURCING_CHANNELS.map((c) => c.value);
    for (const v of ['ihc_affiliate_referral', 'banker_advisor', 'proprietary', 'portfolio_bolt_on', 'government_dge']) {
      assert.ok(values.includes(v), 'expected channel ' + v);
    }
  });

  test('findSourcingChannel matches a known value and rejects the rest', () => {
    assert.equal(findSourcingChannel('proprietary').label, 'Proprietary / direct');
    assert.equal(findSourcingChannel('nope'), null);
    assert.equal(findSourcingChannel(''), null);
  });

  test('a missing channel is a stop (the channel is mandatory)', () => {
    const r = evaluateSourcingChannel({});
    assert.equal(r.required, true);
    assert.equal(r.satisfied, false);
    assert.ok(r.stops.some((s) => s.code === 'sourcing_channel_required'));
    assert.ok(r.stops.some((s) => s.message === SOURCING_CHANNEL_MESSAGES.required));
  });

  test('an unrecognised channel is a stop', () => {
    const r = evaluateSourcingChannel({ sourcing_channel: 'carrier-pigeon' });
    assert.equal(r.satisfied, false);
    assert.ok(r.stops.some((s) => s.code === 'sourcing_channel_unknown'));
  });

  test('an IHC / affiliate referral auto-sets the related-party flag', () => {
    const r = evaluateSourcingChannel({ sourcing_channel: 'ihc_affiliate_referral' });
    assert.equal(r.satisfied, true);
    assert.equal(r.related_party_auto_flag, true);
    assert.equal(r.compressed_timeline, false);
    assert.deepEqual(r.tags, [RELATED_PARTY_TAG]);
    assert.ok(r.flags.some((f) => f.code === RELATED_PARTY_TAG));
  });

  test('a banker / advisor-led channel sets the compressed-timeline indicator', () => {
    const r = evaluateSourcingChannel({ sourcing_channel: 'banker_advisor' });
    assert.equal(r.satisfied, true);
    assert.equal(r.compressed_timeline, true);
    assert.equal(r.related_party_auto_flag, false);
    assert.deepEqual(r.tags, [COMPRESSED_TIMELINE_TAG]);
    assert.equal(COMPRESSED_TIMELINE_CHANNEL, 'banker_advisor');
  });

  test('a proprietary channel carries no side-effects', () => {
    const r = evaluateSourcingChannel({ sourcing_channel: 'proprietary' });
    assert.equal(r.satisfied, true);
    assert.deepEqual(r.tags, []);
    assert.equal(r.related_party_auto_flag, false);
    assert.equal(r.compressed_timeline, false);
  });

  test('a channel value is normalised before lookup', () => {
    const r = evaluateSourcingChannel({ sourcing_channel: '  BANKER_ADVISOR  ' });
    assert.equal(r.satisfied, true);
    assert.equal(r.compressed_timeline, true);
  });
});

