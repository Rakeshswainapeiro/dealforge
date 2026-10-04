// Performance SIT targets and verdicts (W9-04 / BRD NFR-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile, mean, summariseEndpoints, PERFORMANCE_TARGETS, PERFORMANCE_VERSION,
} from '../config/performance.js';

test('targets are a 3s P95 page budget and a 15-minute screening SLA', () => {
  assert.equal(PERFORMANCE_VERSION, 'NFR-04.1');
  assert.equal(PERFORMANCE_TARGETS.p95_page_ms, 3000);
  assert.equal(PERFORMANCE_TARGETS.screening_ms, 15 * 60 * 1000);
});

test('percentile uses the nearest-rank method and tolerates empty input', () => {
  const xs = [10, 20, 30, 40, 50];
  assert.equal(percentile(xs, 50), 30);
  assert.equal(percentile(xs, 95), 50);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([], 95), null);
});

test('a fast endpoint passes the P95 gate', () => {
  const r = summariseEndpoints({ board: [10, 12, 11, 9, 15, 13] });
  assert.equal(r.endpoints.board.pass, true);
  assert.equal(r.endpoints.board.p95_ms, 15);
  assert.equal(r.gate.pass, true);
});

test('an endpoint over the P95 budget fails the gate', () => {
  const slow = [100, 200, 3500, 4000, 5000, 6000];
  const r = summariseEndpoints({ slow });
  assert.equal(r.endpoints.slow.within_p95_target, false);
  assert.equal(r.endpoints.slow.pass, false);
  assert.equal(r.gate.pass, false);
  assert.equal(r.summary.failing, 1);
});

test('too few samples fails even when every sample is fast', () => {
  const r = summariseEndpoints({ sparse: [10, 11] });
  assert.equal(r.endpoints.sparse.min_samples_met, false);
  assert.equal(r.endpoints.sparse.pass, false);
});

test('a single request over the hard ceiling fails the endpoint', () => {
  const r = summariseEndpoints({ spiky: [10, 11, 12, 13, 12000, 14] });
  assert.equal(r.endpoints.spiky.within_hard_ceiling, false);
  assert.equal(r.endpoints.spiky.pass, false);
});

test('mean rounds to whole milliseconds', () => {
  assert.equal(mean([10, 11, 12]), 11);
  assert.equal(mean([]), null);
});

