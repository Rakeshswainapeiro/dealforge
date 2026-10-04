// Data residency posture (W9-03 / BRD NFR-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyResidency, APPROVED_REGIONS, RESIDENCY_DEPENDENCIES, RESIDENCY_VERSION,
} from '../config/residency.js';

test('the approved regions are UAE/GCC sovereign regions', () => {
  assert.equal(RESIDENCY_VERSION, 'NFR-01.1');
  assert.ok(APPROVED_REGIONS.includes('me-central-1'));
  assert.ok(APPROVED_REGIONS.includes('ae'));
});

test('an all-local deployment is fully in-jurisdiction', () => {
  const r = classifyResidency({});
  assert.equal(r.summary.unpinned, 0);
  assert.equal(r.posture_satisfied, true);
  const storage = r.dependencies.find((d) => d.id === 'storage');
  assert.equal(storage.status, 'local');
  const pg = r.dependencies.find((d) => d.id === 'postgres');
  assert.equal(pg.status, 'in_boundary');
});

test('object storage pinned to a UAE region is approved', () => {
  const r = classifyResidency({ S3_ENDPOINT: 'https://s3.me-central-1.example', S3_REGION: 'me-central-1' });
  const storage = r.dependencies.find((d) => d.id === 'storage');
  assert.equal(storage.status, 'pinned');
  assert.equal(r.posture_satisfied, true);
});

test('object storage configured with a non-UAE region is flagged unpinned', () => {
  const r = classifyResidency({ S3_ENDPOINT: 'https://s3.us-east-1.example', S3_REGION: 'us-east-1' });
  const storage = r.dependencies.find((d) => d.id === 'storage');
  assert.equal(storage.status, 'unpinned');
  assert.equal(r.posture_satisfied, false);
  assert.ok(r.summary.unpinned_ids.includes('storage'));
});

test('a configured model provider without a residency pin is flagged', () => {
  const r = classifyResidency({ OPENAI_BASE_URL: 'https://api.openai.com/v1' });
  const ai = r.dependencies.find((d) => d.id === 'ai_model');
  assert.equal(ai.status, 'unpinned');
  assert.equal(r.posture_satisfied, false);
});

test('the sign-off is always recorded as an external Sirius activity', () => {
  const r = classifyResidency({});
  assert.equal(r.signoff.status, 'external');
  assert.match(r.signoff.owner, /Sirius/);
});

test('every dependency carries a note explaining its residency posture', () => {
  for (const d of RESIDENCY_DEPENDENCIES) {
    assert.ok(d.id && d.label, 'dependency has id and label');
    assert.ok(d.note && d.note.length > 0, 'dependency has a note');
    assert.ok(typeof d.in_boundary === 'boolean');
  }
});

