// Related-party overlay configuration + governance (W6-03 / BRD WF-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRelatedPartyConfig,
  validateRelatedPartyConfig,
  resolveRelatedPartyConfig,
  diffRelatedPartyConfig,
  buildRelatedPartyConfig,
  resolveOverlayStatus,
  isConflictedActor,
  maySignOff,
  mayDecide,
  ARM_LENGTH_BASES,
} from '../config/relatedParty.js';

const cfg = defaultRelatedPartyConfig();

test('the shipped overlay enforces arm-length, an independent sign-off and conflict exclusion', () => {
  assert.equal(cfg.require_arm_length_documentation, true);
  assert.equal(cfg.require_independent_signoff, true);
  assert.equal(cfg.block_decision_without_signoff, true);
  assert.equal(cfg.exclude_conflicted_users, true);
  assert.deepEqual(cfg.signoff_roles, ['independent_reviewer']);
  assert.ok(cfg.arm_length_bases.includes('third_party_valuation'));
});

test('an unflagged deal needs nothing and is never blocked', () => {
  const s = resolveOverlayStatus(cfg, { flagged: false });
  assert.equal(s.status, 'not_required');
  assert.equal(s.blocked, false);
  assert.equal(s.requires_signoff, false);
});

test('a flagged deal with no disclosure, basis or sign-off is open and blocked', () => {
  const s = resolveOverlayStatus(cfg, { flagged: true });
  assert.equal(s.status, 'open');
  assert.equal(s.blocked, true);
  assert.ok(s.outstanding.some((o) => o.key === 'disclosure'));
  assert.ok(s.outstanding.some((o) => o.key === 'arm_length_basis'));
  assert.ok(s.outstanding.some((o) => o.key === 'independent_signoff'));
});

test('an arm-length basis without a signed-off reviewer reads documented, still blocked', () => {
  const s = resolveOverlayStatus(cfg, {
    flagged: true, disclosure: 'Referred by an affiliate.',
    arm_length_basis: 'third_party_valuation', arm_length_note: 'Big-4 valuation on file.',
  });
  assert.equal(s.status, 'documented');
  assert.equal(s.documented, true);
  assert.equal(s.blocked, true);
  assert.ok(!s.outstanding.some((o) => o.key === 'arm_length_basis'));
});

test('an independent sign-off clears the overlay and unblocks the decision', () => {
  const s = resolveOverlayStatus(cfg, {
    flagged: true, disclosure: 'Referred by an affiliate.',
    arm_length_basis: 'third_party_valuation', arm_length_note: 'Big-4 valuation on file.',
    independent_signed_off_by: 'reviewer@sirius.local',
  });
  assert.equal(s.status, 'signed_off');
  assert.equal(s.blocked, false);
  assert.equal(s.signed_off, true);
});

test('the preparer is conflicted and may neither sign off nor decide', () => {
  const opportunity = { data: { owner_email: 'deal.lead@infinia.local' } };
  const review = { flagged: true };
  const actor = { email: 'deal.lead@infinia.local', roles: ['independent_reviewer'] };
  const conflict = isConflictedActor(cfg, { actor, review, opportunity });
  assert.equal(conflict.conflicted, true);
  assert.ok(conflict.reasons.includes('preparer'));
  const signoff = maySignOff(cfg, { actor, review, opportunity });
  assert.equal(signoff.allowed, false);
  assert.equal(signoff.conflicted, true);
  const decide = mayDecide(cfg, { actor, review, opportunity });
  assert.equal(decide.allowed, false);
  assert.equal(decide.conflicted, true);
});

test('a named conflicted user is ineligible even with the right role', () => {
  const actor = { email: 'cio@sirius.local', roles: ['independent_reviewer'] };
  const review = { flagged: true, conflicted_users: ['cio@sirius.local'] };
  const conflict = isConflictedActor(cfg, { actor, review, opportunity: {} });
  assert.equal(conflict.conflicted, true);
  assert.ok(conflict.reasons.includes('named-conflicted'));
});

test('only a delegated role may sign off, and only with the arm-length record on file', () => {
  const opportunity = { data: { owner_email: 'someone@x.local' } };
  const noRole = maySignOff(cfg, { actor: { email: 'a@x.local', roles: ['subsidiary_deal_lead'] }, review: { flagged: true }, opportunity });
  assert.equal(noRole.allowed, false);
  assert.match(noRole.reason, /independent reviewer/i);

  const noBasis = maySignOff(cfg, { actor: { email: 'reviewer@sirius.local', roles: ['independent_reviewer'] }, review: { flagged: true }, opportunity });
  assert.equal(noBasis.allowed, false);
  assert.match(noBasis.reason, /arm/i);

  const ok = maySignOff(cfg, {
    actor: { email: 'reviewer@sirius.local', roles: ['independent_reviewer'] },
    review: { flagged: true, arm_length_basis: 'market_benchmarking', arm_length_note: 'Benchmarked vs listed comps.' },
    opportunity,
  });
  assert.equal(ok.allowed, true);
});

test('an unsigned flagged deal cannot reach the screening decision', () => {
  const decide = mayDecide(cfg, {
    actor: { email: 'cio@sirius.local', roles: ['cio'] },
    review: { flagged: true, disclosure: 'x', arm_length_basis: 'market_benchmarking', arm_length_note: 'y' },
    opportunity: {},
  });
  assert.equal(decide.allowed, false);
  assert.equal(decide.status.blocked, true);
});

test('validation refuses a sign-off requirement with no sign-off role', () => {
  const bad = { ...cfg, signoff_roles: [] };
  const { ok, errors } = validateRelatedPartyConfig(bad);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.field === 'signoff_roles'));
});

test('an admin edit mints revision + 1 and reports the switch that changed', () => {
  const next = buildRelatedPartyConfig({ block_decision_without_signoff: false }, { actor: { email: 'admin@x.local' }, base: cfg });
  assert.equal(next.revision, cfg.revision + 1);
  assert.equal(next.version, 'RPT-01.2');
  assert.equal(next.block_decision_without_signoff, false);
  const changes = diffRelatedPartyConfig(cfg, next);
  assert.ok(changes.some((c) => c.field === 'block_decision_without_signoff' && c.after === false));
});

test('resolveRelatedPartyConfig falls back to the shipped default and keeps the bases', () => {
  const resolved = resolveRelatedPartyConfig({ revision: 4, signoff_roles: ['cio'], arm_length_bases: ['market_benchmarking'] });
  assert.equal(resolved.revision, 4);
  assert.deepEqual(resolved.signoff_roles, ['cio']);
  assert.equal(resolved.arm_length_bases.length, 1);
  assert.equal(resolveRelatedPartyConfig(null).version, cfg.version);
  assert.ok(ARM_LENGTH_BASES.length >= 5);
});
