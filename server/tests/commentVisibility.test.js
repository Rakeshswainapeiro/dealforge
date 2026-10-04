// Internal vs shared comment visibility (W6-04 / BRD AUD-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCommentVisibilityConfig,
  validateCommentVisibilityConfig,
  resolveCommentVisibilityConfig,
  diffCommentVisibilityConfig,
  buildCommentVisibilityConfig,
  isSubsidiaryViewer,
  mayViewVisibility,
  canViewInternal,
  effectiveMessageVisibility,
  COMMENT_VISIBILITY_MESSAGES,
} from '../config/commentVisibility.js';

const cfg = defaultCommentVisibilityConfig();

test('the shipped policy restricts internal comments to the group layer', () => {
  assert.equal(cfg.restrict_internal_to_group, true);
  assert.equal(cfg.notify_internal_messages, false);
  assert.equal(cfg.default_message_visibility, 'shared');
  assert.equal(cfg.default_thread_visibility, 'shared');
  assert.ok(cfg.subsidiary_roles.includes('subsidiary_deal_lead'));
});

test('a subsidiary-only user may never see an internal comment', () => {
  const sub = { roles: ['subsidiary_deal_lead'] };
  assert.equal(isSubsidiaryViewer(cfg, sub), true);
  assert.equal(mayViewVisibility(cfg, sub, 'internal'), false);
  assert.equal(canViewInternal(cfg, sub), false);
  // A shared comment is always visible.
  assert.equal(mayViewVisibility(cfg, sub, 'shared'), true);
});

test('a cross-org reader always sees internal comments', () => {
  for (const roles of [['sirius_deal_lead'], ['admin'], ['cio'], ['leadership']]) {
    assert.equal(isSubsidiaryViewer(cfg, { roles }), false);
    assert.equal(mayViewVisibility(cfg, { roles }, 'internal'), true);
  }
  // Holding a subsidiary role AND a cross-org role is not subsidiary-only.
  assert.equal(isSubsidiaryViewer(cfg, { roles: ['subsidiary_deal_lead', 'admin'] }), false);
  assert.equal(mayViewVisibility(cfg, { roles: ['subsidiary_deal_lead', 'admin'] }, 'internal'), true);
});

test('an unknown visibility fails closed for a subsidiary viewer', () => {
  assert.equal(mayViewVisibility(cfg, { roles: ['subsidiary_deal_lead'] }, 'weird'), false);
  assert.equal(mayViewVisibility(cfg, { roles: ['sirius_deal_lead'] }, null), true);
});

test('the restriction can be switched off by configuration', () => {
  const open = { ...cfg, restrict_internal_to_group: false };
  assert.equal(isSubsidiaryViewer(open, { roles: ['subsidiary_deal_lead'] }), false);
  assert.equal(mayViewVisibility(open, { roles: ['subsidiary_deal_lead'] }, 'internal'), true);
});

test('validation refuses an empty subsidiary list and a cross-org overlap', () => {
  const empty = validateCommentVisibilityConfig({ ...cfg, subsidiary_roles: [] });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((e) => e.field === 'subsidiary_roles'));

  const overlap = validateCommentVisibilityConfig({ ...cfg, subsidiary_roles: ['subsidiary_deal_lead', 'admin'] });
  assert.equal(overlap.ok, false);
  assert.ok(overlap.errors.some((e) => e.message.includes('cross-org')));

  const bad = validateCommentVisibilityConfig({ ...cfg, default_message_visibility: 'secret' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.field === 'default_message_visibility'));

  assert.equal(validateCommentVisibilityConfig(cfg).ok, true);
});

test('a build mints the next revision and records who changed it', () => {
  const next = buildCommentVisibilityConfig(
    { notify_internal_messages: true },
    { actor: { email: 'admin@sirius.local' }, base: cfg, at: '2026-01-01T00:00:00.000Z' }
  );
  assert.equal(next.revision, cfg.revision + 1);
  assert.equal(next.version, 'CVD-01.' + (cfg.revision + 1));
  assert.equal(next.source, 'stored');
  assert.equal(next.notify_internal_messages, true);
  assert.equal(next.updated_by, 'admin@sirius.local');
  assert.equal(next.updated_at, '2026-01-01T00:00:00.000Z');
});

test('the diff reports only the changed fields', () => {
  const after = { ...cfg, restrict_internal_to_group: false };
  const changes = diffCommentVisibilityConfig(cfg, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { field: 'restrict_internal_to_group', before: true, after: false });
});

test('resolve fills a partial stored config from the shipped default', () => {
  const resolved = resolveCommentVisibilityConfig({ subsidiary_roles: ['subsidiary_cfo'] });
  assert.equal(resolved.restrict_internal_to_group, true);
  assert.equal(resolved.notify_internal_messages, false);
  assert.deepEqual(resolved.subsidiary_roles, ['subsidiary_cfo']);
  assert.equal(resolved.source, 'stored');
});

test('an internal thread keeps every reply internal', () => {
  assert.equal(effectiveMessageVisibility('internal', 'shared'), 'internal');
  assert.equal(effectiveMessageVisibility('shared', 'internal'), 'internal');
  assert.equal(effectiveMessageVisibility('internal', undefined), 'internal');
  assert.equal(effectiveMessageVisibility('shared', 'shared'), 'shared');
  assert.equal(effectiveMessageVisibility(undefined, undefined), 'shared');
});

test('the disclaimer names the hard guarantee', () => {
  assert.ok(COMMENT_VISIBILITY_MESSAGES.disclaimer.includes('subsidiary'));
  assert.ok(COMMENT_VISIBILITY_MESSAGES.internal_hidden.includes('not visible'));
});
