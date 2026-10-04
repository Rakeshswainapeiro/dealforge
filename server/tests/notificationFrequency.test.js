// Notification email frequency (W6-07 / BRD NTF-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultNotificationFrequencyConfig, validateNotificationFrequencyConfig,
  resolveNotificationFrequencyConfig, diffNotificationFrequencyConfig,
  buildNotificationFrequencyConfig, effectiveFrequency, validateUserPreference, composeDigest,
  NOTIFICATION_FREQUENCY_VERSION, NOTIFICATION_FREQUENCY_MESSAGES, NOTIFICATION_FREQUENCIES,
} from '../config/notificationFrequency.js';

test('default policy is user-selectable, immediate, digest at 07:00', () => {
  const cfg = defaultNotificationFrequencyConfig();
  assert.equal(cfg.version, NOTIFICATION_FREQUENCY_VERSION);
  assert.equal(cfg.user_selectable, true);
  assert.equal(cfg.default_frequency, 'immediate');
  assert.equal(cfg.digest_hour, 7);
  assert.equal(cfg.source, 'default');
});

test('resolve falls back to the default for junk input', () => {
  assert.deepEqual(resolveNotificationFrequencyConfig('nope'), defaultNotificationFrequencyConfig());
  const stored = resolveNotificationFrequencyConfig(JSON.stringify({ user_selectable: false, source: 'stored' }));
  assert.equal(stored.user_selectable, false);
  assert.equal(stored.source, 'stored');
});

test('validate rejects an unknown frequency and a bad hour', () => {
  assert.equal(validateNotificationFrequencyConfig({}).ok, true);
  assert.equal(validateNotificationFrequencyConfig({ default_frequency: 'weekly' }).ok, false);
  assert.equal(validateNotificationFrequencyConfig({ digest_hour: 30 }).ok, false);
  assert.equal(validateNotificationFrequencyConfig('nope').ok, false);
});

test('build mints a revision and records the actor', () => {
  const next = buildNotificationFrequencyConfig(
    { default_frequency: 'daily_digest', digest_hour: 6 },
    { actor: { email: 'admin@dealforge.local' }, base: defaultNotificationFrequencyConfig(), at: '2026-02-01T00:00:00.000Z' },
  );
  assert.equal(next.revision, 2);
  assert.equal(next.version, 'NTF-01.2');
  assert.equal(next.default_frequency, 'daily_digest');
  assert.equal(next.digest_hour, 6);
  assert.equal(next.updated_by, 'admin@dealforge.local');
});

test('diff reports only the changed fields', () => {
  const before = defaultNotificationFrequencyConfig();
  const after = { ...before, default_frequency: 'daily_digest' };
  const fields = diffNotificationFrequencyConfig(before, after).map((c) => c.field);
  assert.deepEqual(fields, ['default_frequency']);
});

test('effectiveFrequency honours the user choice when allowed', () => {
  const cfg = defaultNotificationFrequencyConfig();
  assert.equal(effectiveFrequency('daily_digest', cfg), 'daily_digest');
  assert.equal(effectiveFrequency(null, cfg), 'immediate');
  assert.equal(effectiveFrequency('bogus', cfg), 'immediate');
  const fixed = { ...cfg, user_selectable: false, default_frequency: 'daily_digest' };
  assert.equal(effectiveFrequency('immediate', fixed), 'daily_digest');
});

test('validateUserPreference rejects an unknown value and a locked policy', () => {
  const cfg = defaultNotificationFrequencyConfig();
  assert.equal(validateUserPreference('immediate', cfg).value, 'immediate');
  assert.equal(validateUserPreference('weekly', cfg).field, 'frequency');
  const locked = { ...cfg, user_selectable: false };
  assert.ok(validateUserPreference('daily_digest', locked).error, 'a locked policy refuses a user choice');
});

test('composeDigest groups only the rows passed in, by kind', () => {
  const rows = [
    { id: '1', recipient_email: 'a@x.com', kind: 'assignment', subject: 'S1', org_id: 'org-a', created_at: '2026-02-01T10:00:00Z' },
    { id: '2', recipient_email: 'a@x.com', kind: 'decision', subject: 'S2', org_id: 'org-a', created_at: '2026-02-01T11:00:00Z' },
    { id: '3', recipient_email: 'a@x.com', kind: 'assignment', subject: 'S3', org_id: 'org-a', created_at: '2026-02-01T09:00:00Z' },
  ];
  const digest = composeDigest(rows, { email: 'a@x.com', at: '2026-02-02T00:00:00Z' });
  assert.equal(digest.recipient_email, 'a@x.com');
  assert.equal(digest.total, 3);
  assert.equal(digest.kinds[0].kind, 'assignment');
  assert.equal(digest.kinds[0].count, 2);
  assert.equal(digest.kinds[0].items[0].subject, 'S1', 'newest first');
  assert.equal(digest.composed_at, '2026-02-02T00:00:00Z');
});

test('composeDigest of nothing is empty, not an error', () => {
  const digest = composeDigest([], { email: 'a@x.com' });
  assert.equal(digest.total, 0);
  assert.deepEqual(digest.kinds, []);
});

test('vocabulary exposes both frequencies', () => {
  const keys = NOTIFICATION_FREQUENCIES.map((f) => f.key).sort();
  assert.deepEqual(keys, ['daily_digest', 'immediate']);
});
