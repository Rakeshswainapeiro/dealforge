// Security posture (W9-02 / BRD NFR-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSecurityPosture, SECURITY_POSTURE_VERSION,
  SECURITY_GOLIVE_SCAN, SECURITY_CONTROLS,
} from '../config/securityPosture.js';

test('go-live gate passes with no open critical or high advisories', () => {
  const posture = buildSecurityPosture();
  assert.equal(posture.version, SECURITY_POSTURE_VERSION);
  assert.equal(posture.scan.open_critical_or_high, 0);
  assert.equal(posture.summary.open_critical_or_high, 0);
  assert.equal(posture.gate.pass, true);
  assert.match(posture.gate.policy, /critical or high/i);
});

test('the server runtime tree is the go-live advisory surface and is clean', () => {
  // The Docker runtime image installs only server/ deps, so it is the tree that
  // ships. It must have zero advisories.
  assert.equal(SECURITY_GOLIVE_SCAN.server_runtime.total, 0);
  assert.equal(SECURITY_GOLIVE_SCAN.server_runtime.critical, 0);
  assert.equal(SECURITY_GOLIVE_SCAN.server_runtime.high, 0);
  assert.equal(SECURITY_GOLIVE_SCAN.syntax_failures, 0);
  assert.equal(SECURITY_GOLIVE_SCAN.unresolved_sinks, 0);
});

test('every control carries an id, label, status and evidence pointer', () => {
  assert.ok(SECURITY_CONTROLS.length >= 10);
  const ids = new Set();
  for (const c of SECURITY_CONTROLS) {
    assert.ok(c.id && typeof c.id === 'string', 'control has id');
    assert.ok(!ids.has(c.id), 'control ids are unique');
    ids.add(c.id);
    assert.ok(c.label && c.label.length > 0, 'control has label');
    assert.ok(['implemented', 'passing', 'external', 'open'].includes(c.status), 'control status is known');
    assert.ok(c.evidence && c.evidence.length > 0, 'control has evidence');
  }
});

test('external go-live dependencies are tracked, not claimed as done', () => {
  const posture = buildSecurityPosture();
  const external = posture.controls.filter((c) => c.status === 'external');
  assert.ok(external.some((c) => c.id === 'pen_test'));
  assert.ok(external.some((c) => c.id === 'data_residency'));
  assert.equal(posture.summary.external, external.length);
});

test('summary counts reconcile with the control catalog', () => {
  const posture = buildSecurityPosture();
  assert.equal(posture.summary.total, posture.controls.length);
  assert.equal(
    posture.summary.implemented + posture.summary.passing + posture.summary.external,
    posture.summary.total,
  );
});
