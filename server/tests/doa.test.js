import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultDoaConfig,
  validateDoaConfig,
  resolveDoaConfig,
  diffDoaConfig,
  buildDoaConfig,
  tierForCommitment,
  resolveAuthority,
  decisionRolesFor,
  DOA_CONFIG_KEY,
} from '../config/doa.js';
import { DOA_TIERS, DOA_PARTY_KEYS } from '../config/doaData.js';

describe('delegation of authority (W6-02 / WF-08)', () => {
  test('the shipped default carries the four ordered bands', () => {
    const cfg = defaultDoaConfig();
    assert.equal(cfg.version, 'DOA-01.1');
    assert.equal(cfg.revision, 1);
    assert.equal(cfg.source, 'default');
    assert.equal(DOA_CONFIG_KEY, 'doa_config');
    assert.deepEqual(cfg.tiers.map((t) => t.key), ['standard', 'elevated', 'committee', 'board']);
    assert.equal(cfg.unspecified_tier.key, 'unspecified');
  });

  test('every band names a RACI row for each party and at least one deciding role', () => {
    for (const tier of DOA_TIERS) {
      for (const party of DOA_PARTY_KEYS) {
        assert.ok(['R', 'A', 'C', 'I', '-'].includes(tier.responsibilities[party]), tier.key + '/' + party);
      }
      assert.ok(tier.decision_roles.length >= 1, tier.key + ' needs a deciding role');
    }
  });

  test('the configured parties step the accountable seat up the house', () => {
    const cfg = defaultDoaConfig();
    const accountable = cfg.tiers.map((t) => {
      const key = Object.keys(t.responsibilities).find((k) => t.responsibilities[k] === 'A');
      return key;
    });
    assert.deepEqual(accountable, ['vertical_head', 'cio', 'ic', 'board']);
  });

  test('validation accepts the shipped default', () => {
    const { ok, errors } = validateDoaConfig(defaultDoaConfig());
    assert.equal(ok, true, JSON.stringify(errors));
  });

  test('validation rejects overlapping bands', () => {
    const cfg = defaultDoaConfig();
    cfg.tiers[0].max_aed = 500;
    const { ok, errors } = validateDoaConfig(cfg);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /overlap/i.test(e.message)));
  });

  test('validation rejects a ceiling below its floor and an empty deciding role set', () => {
    const cfg = defaultDoaConfig();
    cfg.tiers[1].max_aed = 100;
    cfg.tiers[2].decision_roles = [];
    const { ok, errors } = validateDoaConfig(cfg);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /exceed its floor/i.test(e.message)));
    assert.ok(errors.some((e) => /at least one role/i.test(e.message)));
  });

  test('a partial store resolves without losing a band', () => {
    const resolved = resolveDoaConfig({ tiers: [{ key: 'elevated', label: 'Elevated', min_aed: 200, max_aed: 350, decision_roles: ['cio'] }] });
    assert.equal(resolved.tiers.length, 4);
    const elevated = resolved.tiers.find((t) => t.key === 'elevated');
    assert.equal(elevated.max_aed, 350);
    assert.deepEqual(elevated.decision_roles, ['cio']);
    // untouched bands keep the shipped values
    assert.equal(resolved.tiers.find((t) => t.key === 'standard').max_aed, 200);
  });

  test('buildDoaConfig mints revision + 1 and the matching version', () => {
    const base = defaultDoaConfig();
    const next = buildDoaConfig({ tiers: base.tiers }, { actor: { email: 'admin@x' }, base, at: '2026-01-01T00:00:00.000Z' });
    assert.equal(next.revision, 2);
    assert.equal(next.version, 'DOA-01.2');
    assert.equal(next.source, 'stored');
    assert.equal(next.updated_by, 'admin@x');
    assert.equal(next.updated_at, '2026-01-01T00:00:00.000Z');
  });

  test('buildDoaConfig refuses an invalid matrix', () => {
    const base = defaultDoaConfig();
    const bad = base.tiers.map((t, i) => (i === 0 ? { ...t, max_aed: 5000 } : t));
    assert.throws(() => buildDoaConfig({ tiers: bad }, { base }), /invalid/i);
  });

  test('diffDoaConfig reports the retuned field', () => {
    const before = defaultDoaConfig();
    const after = buildDoaConfig({ tiers: before.tiers.map((t) => (t.key === 'standard' ? { ...t, max_aed: 150 } : t)) }, { base: before });
    const changes = diffDoaConfig(before, after);
    assert.ok(changes.some((c) => c.key === 'standard' && c.field === 'max_aed' && c.after === 150));
  });

  test('tierForCommitment uses inclusive floors and exclusive ceilings', () => {
    const cfg = defaultDoaConfig();
    assert.equal(tierForCommitment(cfg, 0).tier.key, 'standard');
    assert.equal(tierForCommitment(cfg, 199).tier.key, 'standard');
    assert.equal(tierForCommitment(cfg, 200).tier.key, 'elevated');
    assert.equal(tierForCommitment(cfg, 399).tier.key, 'elevated');
    assert.equal(tierForCommitment(cfg, 400).tier.key, 'committee');
    assert.equal(tierForCommitment(cfg, 749).tier.key, 'committee');
    assert.equal(tierForCommitment(cfg, 750).tier.key, 'board');
  });

  test('an uncaptured size resolves to the unspecified band, not a guess', () => {
    const cfg = defaultDoaConfig();
    const match = tierForCommitment(cfg, null);
    assert.equal(match.tier.key, 'unspecified');
    assert.equal(match.unknown_size, true);
  });

  test('a size above every ceiling falls to the top band', () => {
    // The shipped top band is open-ended, so a huge ticket simply matches it.
    const open = tierForCommitment(defaultDoaConfig(), 9000);
    assert.equal(open.tier.key, 'board');
    // A closed top band lets the overflow branch claim the most senior band.
    const closed = resolveDoaConfig({
      tiers: [
        { key: 'board', label: 'Board', min_aed: 900, max_aed: 1200, decision_roles: ['board_member'] },
      ],
    });
    const match = tierForCommitment(closed, 9000);
    assert.equal(match.tier.key, 'board');
    assert.equal(match.above_all, true);
  });

  test('resolveAuthority authorises a delegated role and refuses others', () => {
    const cfg = defaultDoaConfig();
    const lead = resolveAuthority(cfg, { amountAed: 150, roles: ['sirius_deal_lead'] });
    assert.equal(lead.authorized, true);
    assert.equal(lead.tier.key, 'standard');
    assert.equal(lead.accountable_party.key, 'vertical_head');
    assert.equal(lead.responsible_party.key, 'deal_lead');

    const refused = resolveAuthority(cfg, { amountAed: 150, roles: ['independent_reviewer'] });
    assert.equal(refused.authorized, false);
    assert.match(refused.reason, /delegated to/i);
  });

  test('a board-scale ticket is reserved to the board role', () => {
    const cfg = defaultDoaConfig();
    assert.equal(resolveAuthority(cfg, { amountAed: 800, roles: ['cio'] }).authorized, false);
    assert.equal(resolveAuthority(cfg, { amountAed: 800, roles: ['board_member'] }).authorized, true);
  });

  test('an unknown size falls back to the standard decision set', () => {
    const cfg = defaultDoaConfig();
    const res = resolveAuthority(cfg, { amountAed: null, roles: ['sirius_vertical_head'] });
    assert.equal(res.unknown_size, true);
    assert.equal(res.authorized, true);
  });

  test('decisionRolesFor returns the delegated roles for a size', () => {
    const cfg = defaultDoaConfig();
    assert.deepEqual(decisionRolesFor(cfg, 500), ['cio', 'ic_member']);
  });
});
