// ---------------------------------------------------------------------------
// Unit tests for the portfolio register (W4-01 / BRD ENT-04).
//
//   node --test server/tests/portfolioRegister.test.js
//
// Pure module: the tests assert the shipped register shape, the validation
// rules, revision minting, the resolve fallback, the CSV template round-trip
// and the sector / geography / capability match helpers. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PORTFOLIO_REGISTER_VERSION, PORTFOLIO_REGISTER_CONFIG_KEY, PORTFOLIO_CLUSTER_KEYS,
  defaultPortfolioRegister, validatePortfolioRegister, resolvePortfolioRegister,
  buildPortfolioRegister, diffPortfolioRegister, portfolioCompanyId,
  portfolioRegisterTemplateCsv, parsePortfolioRegisterCsv,
  registerMatchesSector, registerMatchesGeography, registerCapabilityOverlap,
} from '../config/portfolioRegister.js';

describe('portfolio register - shipped register', () => {
  test('carries the fifteen BRD-named companies with a version and revision', () => {
    const reg = defaultPortfolioRegister();
    assert.equal(reg.version, PORTFOLIO_REGISTER_VERSION);
    assert.equal(reg.revision, 1);
    assert.equal(reg.companies.length, 15);
    assert.ok(PORTFOLIO_REGISTER_CONFIG_KEY);
  });

  test('every record has a sector, a valid cluster and a geography tag', () => {
    for (const c of defaultPortfolioRegister().companies) {
      assert.ok(c.id && c.name, 'record has an id and name');
      assert.ok(c.sector, c.name + ' has a sector');
      assert.ok(c.geography, c.name + ' has a geography');
      assert.ok(PORTFOLIO_CLUSTER_KEYS.includes(c.cluster), c.name + ' has a valid cluster');
    }
  });

  test('the BRD-named-only companies are flagged with their source', () => {
    const reg = defaultPortfolioRegister();
    for (const name of ['Judan', 'ADI Chain', 'DDSC']) {
      const c = reg.companies.find((x) => x.name === name);
      assert.ok(c, name + ' is present');
      assert.equal(c.source, 'brd_register');
      assert.equal(c.org_id, null);
    }
  });

  test('company ids are stable and URL-safe', () => {
    assert.equal(portfolioCompanyId('ADI Chain'), 'pf-adi-chain');
    assert.equal(portfolioCompanyId('  Some Co.  '), 'pf-some-co');
  });
});

describe('portfolio register - validation', () => {
  const base = defaultPortfolioRegister();

  test('refuses an empty payload and an empty company list', () => {
    assert.equal(validatePortfolioRegister(null).ok, false);
    assert.equal(validatePortfolioRegister({ companies: [] }).ok, false);
  });

  test('refuses duplicate names (case/space-insensitive)', () => {
    const res = validatePortfolioRegister({ companies: [
      { name: 'Acme', cluster: 'other', sector: 'Holding' },
      { name: ' acme ', cluster: 'other', sector: 'Holding' },
    ] });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /unique/i.test(e)));
  });

  test('refuses an unknown cluster and a missing sector', () => {
    assert.equal(validatePortfolioRegister({ companies: [{ name: 'Acme', cluster: 'nope', sector: 'Holding' }] }).ok, false);
    assert.equal(validatePortfolioRegister({ companies: [{ name: 'Acme', cluster: 'other', sector: '' }] }).ok, false);
  });

  test('accepts a valid minimal register', () => {
    const res = validatePortfolioRegister({ companies: [{ name: 'Acme', cluster: 'other', sector: 'Holding' }] });
    assert.equal(res.ok, true);
    assert.equal(res.config.companies[0].status, 'active');
  });

  test('build mints the next revision and throws a 400-shaped error on invalid input', () => {
    const next = buildPortfolioRegister({ companies: [{ name: 'Acme', cluster: 'other', sector: 'Holding' }] }, { base });
    assert.equal(next.revision, 2);
    assert.equal(next.version, 'PR-01.2');
    assert.throws(() => buildPortfolioRegister({ companies: [] }, { base }), (e) => e.status === 400);
  });

  test('resolve falls back to the shipped register when stored data is absent or invalid', () => {
    assert.equal(resolvePortfolioRegister(null).companies.length, 15);
    assert.equal(resolvePortfolioRegister('{not json').companies.length, 15);
    assert.equal(resolvePortfolioRegister({ companies: [] }).companies.length, 15);
    const stored = JSON.stringify({ companies: [{ name: 'Acme', cluster: 'other', sector: 'Holding' }] });
    assert.equal(resolvePortfolioRegister(stored).companies.length, 1);
  });

  test('resolve keeps the stored revision and version', () => {
    const stored = { revision: 4, version: 'PR-01.4', companies: [{ name: 'Acme', cluster: 'other', sector: 'Holding' }] };
    const reg = resolvePortfolioRegister(stored);
    assert.equal(reg.revision, 4);
    assert.equal(reg.version, 'PR-01.4');
  });

  test('diff reports added, removed and edited records', () => {
    const next = { ...base, companies: base.companies.map((c) => ({ ...c })) };
    next.companies[1] = { ...next.companies[1], cluster: 'other' };
    const removed = next.companies.shift();
    const changes = diffPortfolioRegister(base, next);
    assert.ok(changes.edited.some((e) => e.name === base.companies[1].name));
    assert.ok(changes.removed.includes(removed.name));
  });
});

describe('portfolio register - CSV template', () => {
  test('template has a header and one row per company and round-trips', () => {
    const csv = portfolioRegisterTemplateCsv();
    const lines = csv.split('\n');
    assert.equal(lines[0], 'name,legal_name,cluster,sector,geography,capabilities,status,note');
    assert.equal(lines.length, 16);
    const parsed = parsePortfolioRegisterCsv(csv);
    assert.equal(parsed.companies.length, 15);
    const esy = parsed.companies.find((c) => c.name === 'Esyasoft');
    assert.ok(esy.capabilities.length >= 1);
    assert.equal(esy.cluster, 'energy_utilities');
  });
});

describe('portfolio register - match helpers', () => {
  const reg = defaultPortfolioRegister();
  const companies = reg.companies;

  test('sector match finds the companies in a sector', () => {
    const hits = registerMatchesSector(companies, 'Energy');
    assert.ok(hits.length >= 1);
    assert.ok(hits.every((c) => c.sector === 'Energy'));
  });

  test('geography match finds the companies in a geography', () => {
    const hits = registerMatchesGeography(companies, 'UAE');
    assert.ok(hits.length >= 1);
  });

  test('capability overlap ranks the companies sharing a capability', () => {
    const hits = registerCapabilityOverlap(companies, ['software']);
    assert.ok(hits.length >= 1);
    assert.ok(hits.every((c) => (c.capabilities || []).map((s) => s.toLowerCase()).includes('software')));
    assert.equal(registerCapabilityOverlap(companies, []).length, 0);
  });
});
