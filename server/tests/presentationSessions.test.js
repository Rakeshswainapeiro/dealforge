// Subsidiary presentation scheduling (W6-06 / BRD WF-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPresentationConfig, validatePresentationConfig, resolvePresentationConfig,
  diffPresentationConfig, buildPresentationConfig, normaliseSession, mayManagePresentations,
  PRESENTATION_VERSION, PRESENTATION_MESSAGES, PRESENTATION_STATUSES, PRESENTATION_FORMATS,
} from '../config/presentationSessions.js';

test('default policy requires a date and an attendee, defaults to video', () => {
  const cfg = defaultPresentationConfig();
  assert.equal(cfg.version, PRESENTATION_VERSION);
  assert.equal(cfg.require_attendees, true);
  assert.equal(cfg.require_outcome_on_complete, true);
  assert.equal(cfg.default_format, 'video');
  assert.deepEqual(cfg.required_fields, ['scheduled_at', 'attendees']);
  assert.equal(cfg.source, 'default');
});

test('resolve falls back to the default for junk input', () => {
  assert.deepEqual(resolvePresentationConfig('not json'), defaultPresentationConfig());
  assert.deepEqual(resolvePresentationConfig(null), defaultPresentationConfig());
  const stored = resolvePresentationConfig(JSON.stringify({ require_attendees: false, source: 'stored' }));
  assert.equal(stored.require_attendees, false);
  assert.equal(stored.source, 'stored');
});

test('validate accepts a plain object and rejects non-objects', () => {
  assert.equal(validatePresentationConfig({}).ok, true);
  assert.equal(validatePresentationConfig('nope').ok, false);
});

test('build mints a revision and records the actor', () => {
  const next = buildPresentationConfig(
    { require_outcome_on_complete: false },
    { actor: { email: 'admin@dealforge.local' }, base: defaultPresentationConfig(), at: '2026-02-01T00:00:00.000Z' },
  );
  assert.equal(next.revision, 2);
  assert.equal(next.version, 'PRS-01.2');
  assert.equal(next.require_outcome_on_complete, false);
  assert.equal(next.updated_by, 'admin@dealforge.local');
  assert.equal(next.updated_at, '2026-02-01T00:00:00.000Z');
});

test('diff reports only the changed fields', () => {
  const before = defaultPresentationConfig();
  const after = { ...before, require_attendees: false, default_format: 'in_person' };
  const changes = diffPresentationConfig(before, after);
  const fields = changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ['default_format', 'require_attendees']);
});

test('normaliseSession requires a date and at least one attendee', () => {
  const cfg = defaultPresentationConfig();
  assert.equal(normaliseSession({ attendees: [{ email: 'a@x.com' }] }, cfg).field, 'scheduled_at');
  assert.equal(normaliseSession({ scheduled_at: '2026-02-01T10:00:00Z' }, cfg).field, 'attendees');
});

test('normaliseSession trims, de-duplicates and validates', () => {
  const cfg = defaultPresentationConfig();
  const { value } = normaliseSession({
    scheduled_at: '2026-02-01T10:00:00Z',
    attendees: [{ email: 'A@X.com', name: 'A' }, { email: 'a@x.com' }, { email: 'b@x.com' }],
    format: 'hybrid',
  }, cfg);
  assert.equal(value.attendees.length, 2);
  assert.equal(value.format, 'hybrid');
  assert.equal(value.status, 'scheduled');
});

test('normaliseSession refuses an invalid format or status', () => {
  const cfg = defaultPresentationConfig();
  const bad = normaliseSession({
    scheduled_at: '2026-02-01T10:00:00Z', attendees: [{ email: 'a@x.com' }], format: 'carrier_pigeon',
  }, cfg);
  assert.equal(bad.field, 'format');
  const badStatus = normaliseSession({
    scheduled_at: '2026-02-01T10:00:00Z', attendees: [{ email: 'a@x.com' }], status: 'maybe',
  }, cfg);
  assert.equal(badStatus.field, 'status');
});

test('completing a session requires an outcome', () => {
  const cfg = defaultPresentationConfig();
  const missing = normaliseSession({
    scheduled_at: '2026-02-01T10:00:00Z', attendees: [{ email: 'a@x.com' }], status: 'completed',
  }, cfg);
  assert.equal(missing.field, 'outcome');
  const done = normaliseSession({
    scheduled_at: '2026-02-01T10:00:00Z', attendees: [{ email: 'a@x.com' }], status: 'completed', outcome: 'Approved to proceed',
  }, cfg);
  assert.equal(done.value.status, 'completed');
  assert.equal(done.value.outcome, 'Approved to proceed');
});

test('mayManagePresentations lets cross-org roles through and scopes the rest', () => {
  assert.equal(mayManagePresentations({ roles: ['admin'], org_id: 'x' }, 'org-infinia'), true);
  assert.equal(mayManagePresentations({ roles: ['sirius_deal_lead'], org_id: 'x' }, 'org-infinia'), true);
  assert.equal(mayManagePresentations({ roles: ['subsidiary_deal_lead'], org_id: 'org-infinia' }, 'org-infinia'), true);
  assert.equal(mayManagePresentations({ roles: ['subsidiary_deal_lead'], org_id: 'org-sibling' }, 'org-infinia'), false);
  assert.equal(mayManagePresentations({ roles: ['subsidiary_deal_lead'], org_id: 'org-sibling', descendant_ids: ['org-infinia'] }, 'org-infinia'), true);
  assert.equal(mayManagePresentations(null, 'org-infinia'), false);
});

test('vocabulary exposes the statuses and formats', () => {
  assert.ok(PRESENTATION_STATUSES.some((s) => s.key === 'completed'));
  assert.ok(PRESENTATION_FORMATS.some((f) => f.key === 'in_person'));
  assert.ok(PRESENTATION_MESSAGES.outcome_required.includes('outcome'));
});
