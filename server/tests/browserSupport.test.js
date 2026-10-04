// Browser/device support matrix and gate (W9-06 / BRD NFR-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBrowserSit, SUPPORTED_BROWSERS, DEVICE_PROFILES, BROWSER_SUPPORT_VERSION,
} from '../config/browserSupport.js';

test('the support matrix names Chrome, Edge and Safari plus a tablet profile', () => {
  assert.equal(BROWSER_SUPPORT_VERSION, 'NFR-06.1');
  const ids = SUPPORTED_BROWSERS.map((b) => b.id);
  assert.deepEqual(ids, ['chrome', 'edge', 'safari']);
  assert.ok(DEVICE_PROFILES.some((p) => p.id === 'tablet_ipad'));
  assert.ok(DEVICE_PROFILES.some((p) => p.viewport.isMobile && p.viewport.hasTouch));
});

test('Safari is recorded as external, not tested', () => {
  const safari = SUPPORTED_BROWSERS.find((b) => b.id === 'safari');
  assert.equal(safari.tested, false);
  assert.equal(safari.external, true);
  assert.equal(safari.engine, 'webkit');
});

test('all-tested-profiles-pass yields a passing gate', () => {
  const v = evaluateBrowserSit([
    { status: 'pass' }, { status: 'pass' }, { status: 'pass' }, { status: 'external' },
  ]);
  assert.equal(v.profiles_tested, 3);
  assert.equal(v.profiles_passed, 3);
  assert.equal(v.external, 1);
  assert.equal(v.pass, true);
});

test('any failing profile fails the gate', () => {
  const v = evaluateBrowserSit([{ status: 'pass' }, { status: 'fail' }]);
  assert.equal(v.profiles_failed, 1);
  assert.equal(v.pass, false);
});

test('an empty run does not pass (nothing was actually verified)', () => {
  const v = evaluateBrowserSit([{ status: 'external' }]);
  assert.equal(v.profiles_tested, 0);
  assert.equal(v.pass, false);
});

