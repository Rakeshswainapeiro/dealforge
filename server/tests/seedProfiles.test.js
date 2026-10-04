// Seed profile unit tests (W1-11 / W1-12, REQ-SEED-01).
//
// Pure resolution logic only; no database or running server needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEED_PROFILES, PROFILE_COMPOSITION, resolveSeedProfile, isSeedProfile,
  profileLoadsBase, profileLoadsMvp, describeSeedProfiles,
} from '../seedProfiles.js';

describe('seed profile resolution', () => {
  test('the three profiles are declared with a composition each', () => {
    assert.deepEqual(SEED_PROFILES, ['base', 'mvp', 'off']);
    for (const p of SEED_PROFILES) {
      assert.ok(PROFILE_COMPOSITION[p], 'composition for ' + p);
    }
  });

  test('an explicit SEED_PROFILE wins over the legacy boolean', () => {
    assert.equal(resolveSeedProfile({ env: { SEED_PROFILE: 'off', SEED_DEMO_DATA: '1' } }), 'off');
    assert.equal(resolveSeedProfile({ env: { SEED_PROFILE: 'base', SEED_DEMO_DATA: '0' } }), 'base');
    assert.equal(resolveSeedProfile({ profile: 'mvp', env: { SEED_PROFILE: 'off' } }), 'mvp');
  });

  test('the legacy SEED_DEMO_DATA boolean still maps to a profile', () => {
    assert.equal(resolveSeedProfile({ env: { SEED_DEMO_DATA: '1' } }), 'mvp');
    assert.equal(resolveSeedProfile({ env: { SEED_DEMO_DATA: 'true' } }), 'mvp');
    assert.equal(resolveSeedProfile({ env: { SEED_DEMO_DATA: '0' } }), 'off');
    assert.equal(resolveSeedProfile({ env: { SEED_DEMO_DATA: 'false' } }), 'off');
  });

  test('the default profile is base', () => {
    assert.equal(resolveSeedProfile({ env: {} }), 'base');
    assert.equal(resolveSeedProfile({ env: { SEED_PROFILE: '  ' } }), 'base');
  });

  test('an unknown profile is a hard error, not a silent fallback', () => {
    assert.throws(() => resolveSeedProfile({ env: { SEED_PROFILE: 'demo' } }), /Unknown SEED_PROFILE/);
  });

  test('profile composition drives which layers load', () => {
    assert.equal(profileLoadsBase('base'), true);
    assert.equal(profileLoadsMvp('base'), false);
    assert.equal(profileLoadsBase('mvp'), true);
    assert.equal(profileLoadsMvp('mvp'), true);
    assert.equal(profileLoadsBase('off'), false);
    assert.equal(profileLoadsMvp('off'), false);
  });

  test('off loads no sample data and the catalogue is exposed for the API', () => {
    const described = describeSeedProfiles();
    assert.deepEqual(described.profiles, SEED_PROFILES);
    assert.ok(described.env.includes('SEED_PROFILE'));
    assert.ok(isSeedProfile('mvp') && !isSeedProfile('nope'));
  });
});

