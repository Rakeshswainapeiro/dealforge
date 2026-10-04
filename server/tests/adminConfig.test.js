// ---------------------------------------------------------------------------
// Unified admin configuration registry - pure functions (W8-03 / BRD ADM-01).
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  configDomain, domainsByGroup, registrySummary, groupedDomains,
  buildAdminConfigPayload,
} from '../config/adminConfig.js';
import {
  ADMIN_CONFIG_VERSION, ADMIN_CONFIG_KEY, CONFIG_GROUPS, CONFIG_GROUP_KEYS,
  CONFIG_DOMAINS, CONFIG_DOMAIN_KEYS, NEW_WORK_SCOPE_NOTE,
} from '../config/adminConfigData.js';

describe('admin config registry', () => {
  test('configDomain finds an area by id, case-insensitively', () => {
    assert.equal(configDomain('scorecard').key, 'scorecard_config');
    assert.equal(configDomain('SCORECARD').domain, 'scorecard');
    assert.equal(configDomain('nope'), null);
    assert.equal(configDomain(null), null);
  });

  test('every registered area is complete and well formed', () => {
    for (const d of CONFIG_DOMAINS) {
      assert.ok(d.domain && typeof d.domain === 'string', 'domain id');
      assert.ok(d.label && typeof d.label === 'string', d.domain + ' label');
      assert.ok(CONFIG_GROUP_KEYS.includes(d.group), d.domain + ' group');
      assert.ok(d.action && typeof d.action === 'string', d.domain + ' action');
      assert.ok(d.route && d.route.startsWith('/api/'), d.domain + ' route');
      assert.ok(d.code && d.code.startsWith('server/'), d.domain + ' code');
      assert.equal(typeof d.versioned, 'boolean', d.domain + ' versioned');
      assert.equal(typeof d.audited, 'boolean', d.domain + ' audited');
      assert.equal(d.audited, true, d.domain + ' must be audited');
    }
  });

  test('domain ids are unique and every group holds at least one area', () => {
    assert.equal(new Set(CONFIG_DOMAIN_KEYS).size, CONFIG_DOMAIN_KEYS.length);
    for (const g of CONFIG_GROUPS) {
      assert.ok(domainsByGroup(g.key).length > 0, g.key + ' should hold areas');
    }
  });

  test('registrySummary rolls up totals per group', () => {
    const s = registrySummary();
    assert.equal(s.total, CONFIG_DOMAINS.length);
    assert.equal(s.groups, CONFIG_GROUPS.length);
    assert.equal(s.audited, CONFIG_DOMAINS.length);
    assert.ok(s.versioned >= 1 && s.versioned <= s.total);
    const sum = s.by_group.reduce((n, g) => n + g.count, 0);
    assert.equal(sum, s.total);
  });

  test('groupedDomains annotates each group with its areas in registry order', () => {
    const groups = groupedDomains();
    assert.equal(groups.length, CONFIG_GROUPS.length);
    const scoring = groups.find((g) => g.key === 'scoring');
    assert.deepEqual(scoring.domains.map((d) => d.domain), domainsByGroup('scoring').map((d) => d.domain));
  });

  test('buildAdminConfigPayload carries version, scope note and roll-up', () => {
    const p = buildAdminConfigPayload();
    assert.equal(p.version, ADMIN_CONFIG_VERSION);
    assert.equal(p.key, ADMIN_CONFIG_KEY);
    assert.equal(p.scope_note, NEW_WORK_SCOPE_NOTE);
    assert.equal(p.groups.length, CONFIG_GROUPS.length);
    assert.equal(p.summary.total, CONFIG_DOMAINS.length);
    assert.deepEqual(p.domain_keys, CONFIG_DOMAIN_KEYS);
    assert.deepEqual(p.group_keys, CONFIG_GROUP_KEYS);
    assert.match(p.disclaimer, /audited/i);
  });

  test('the scope note pins changes to new screenings only', () => {
    assert.match(NEW_WORK_SCOPE_NOTE, /new\s+screenings only/i);
    assert.match(NEW_WORK_SCOPE_NOTE, /in-flight/i);
  });
});
