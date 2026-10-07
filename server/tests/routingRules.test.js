// Owner assignment and reviewer routing rules (WF-02, WF-03). Pure.
//   node --test server/tests/routingRules.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRoutingConfig, resolveRoutingConfig, validateRoutingConfig, buildRoutingConfig, routingFlagsFor,
  selectRoute, pickLeastLoaded, diffRoutingConfig,
} from '../config/routingRules.js';

const INFINIA = 'org-infinia';

describe('routing rules', () => {
  test('the shipped default is valid and role-based (no hard-coded people)', () => {
    const cfg = resolveRoutingConfig(null);
    assert.equal(validateRoutingConfig(cfg).ok, true);
    for (const r of cfg.rules) {
      assert.equal(r.owner_email, null);
      assert.ok(r.owner_role);
    }
  });

  test('flags are derived from the record', () => {
    assert.deepEqual(routingFlagsFor({ related_party_auto_flag: true, compressed_timeline: true }), ['related_party', 'compressed_timeline']);
    assert.deepEqual(routingFlagsFor({ below_floor_tag: 'BF' }), ['below_floor']);
    assert.deepEqual(routingFlagsFor({}), []);
  });

  test('first matching rule wins: related party, then committee size, then standard', () => {
    const cfg = defaultRoutingConfig();
    assert.equal(selectRoute(cfg, { ownerOrgId: INFINIA, data: { related_party_auto_flag: true, total_commitment_aed: 500 } }).rule.key, 'related_party');
    assert.equal(selectRoute(cfg, { ownerOrgId: INFINIA, data: { total_commitment_aed: 300 } }).rule.key, 'committee');
    assert.equal(selectRoute(cfg, { ownerOrgId: INFINIA, data: { total_commitment_aed: 120 } }).rule.key, 'standard');
  });

  test('entity and sector conditions narrow a rule', () => {
    const cfg = { rules: [
      { key: 'infinia_health', when: { org_ids: [INFINIA], sectors: ['Healthcare'] }, owner_email: 'a@sirius.local' },
      { key: 'rest', when: {}, owner_role: 'sirius_deal_lead' },
    ] };
    assert.equal(selectRoute(cfg, { ownerOrgId: INFINIA, data: { sector: 'healthcare' } }).rule.key, 'infinia_health');
    assert.equal(selectRoute(cfg, { ownerOrgId: INFINIA, data: { sector: 'Energy' } }).rule.key, 'rest');
    assert.equal(selectRoute(cfg, { ownerOrgId: 'org-other', data: { sector: 'Healthcare' } }).rule.key, 'rest');
  });

  test('no match falls back to the fallback role', () => {
    const cfg = { fallback_owner_role: 'sirius_deal_lead', rules: [{ key: 'big', when: { min_aed: 1000 }, owner_role: 'cio' }] };
    const r = selectRoute(cfg, { ownerOrgId: INFINIA, data: { total_commitment_aed: 10 } });
    assert.equal(r.rule.key, 'fallback');
    assert.equal(r.rule.owner_role, 'sirius_deal_lead');
  });

  test('the least-loaded holder is picked, ties by email', () => {
    assert.equal(pickLeastLoaded([{ email: 'b@x', open_count: 1 }, { email: 'a@x', open_count: 3 }]).email, 'b@x');
    assert.equal(pickLeastLoaded([{ email: 'b@x', open_count: 0 }, { email: 'a@x', open_count: 0 }]).email, 'a@x');
    assert.equal(pickLeastLoaded([]), null);
  });

  test('validation refuses subsidiary roles, unknown flags and empty owners', () => {
    const bad = validateRoutingConfig({ rules: [
      { key: 'x', when: { flags: ['nope'] }, owner_role: 'subsidiary_deal_lead' },
      { key: 'x', when: {} },
    ] });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /not a Sirius reviewer role/.test(e)));
    assert.ok(bad.errors.some((e) => /unknown flag/.test(e)));
    assert.ok(bad.errors.some((e) => /duplicate key/.test(e)));
    assert.ok(bad.errors.some((e) => /name an owner/.test(e)));
  });

  test('an admin edit mints revision + 1 and reports the change', () => {
    const base = resolveRoutingConfig(null);
    const next = buildRoutingConfig({ rules: [...base.rules.slice(0, 2), { key: 'standard', when: {}, owner_email: 'lead@sirius.local' }] },
      { actor: { email: 'admin@x' }, base });
    assert.equal(next.revision, base.revision + 1);
    assert.ok(diffRoutingConfig(base, next).some((c) => c.rule === 'standard' && c.change === 'edited'));
    assert.throws(() => buildRoutingConfig({ rules: [] }, { base }), /Invalid routing rules/);
  });
});
