// ---------------------------------------------------------------------------
// Unit tests for the data-point to source mapping (W5-04 / BRD DOC-05).
//
//   node --test server/tests/dataSource.test.js
//
// Pure module: the shipped mapping, validation, resolve fallback, revision
// minting, diff, per-link resolution against the record and the grouped map.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_SOURCE_CONFIG_KEY, DATA_SOURCE_VERSION, DATA_SOURCE_DEFAULT_REVISION,
  DATA_SOURCE_VERSION_PREFIX, DATA_SOURCE_TYPES, DATA_SOURCE_TYPE_KEYS,
  DATA_SOURCE_PAGES, DATA_SOURCE_TARGETS, DATA_SOURCE_TARGET_KEYS,
  DATA_SOURCE_MESSAGES,
  defaultDataSourceConfig, validateDataSourceConfig, resolveDataSourceConfig,
  diffDataSourceConfig, buildDataSourceConfig, resolveLink, buildSourceMap,
} from '../config/dataSource.js';

const doc = (key, extra = {}) => ({
  id: 'doc-' + key, requirement_key: key, label: key.replace(/_/g, ' '),
  version: 2, original_name: key + '.pdf', file_url: '/api/files/' + key + '.pdf',
  sha256: 'abc123', ...extra,
});

describe('data-source mapping - shipped configuration', () => {
  test('carries a version, a revision and a link per data point', () => {
    const c = defaultDataSourceConfig();
    assert.equal(c.version, DATA_SOURCE_VERSION);
    assert.equal(c.revision, DATA_SOURCE_DEFAULT_REVISION);
    assert.equal(c.source, 'default');
    assert.equal(DATA_SOURCE_CONFIG_KEY, 'data_source_config');
    assert.equal(DATA_SOURCE_VERSION_PREFIX, 'SRC-01.');
    assert.equal(c.links.length, DATA_SOURCE_TARGETS.length);
    const targets = c.links.map((l) => l.target).sort();
    assert.deepEqual(targets, [...DATA_SOURCE_TARGET_KEYS].sort());
  });

  test('every link has a known type and a memo page', () => {
    const pageKeys = DATA_SOURCE_PAGES.map((p) => p.key);
    for (const link of defaultDataSourceConfig().links) {
      assert.ok(DATA_SOURCE_TYPE_KEYS.includes(link.source_type), link.target + ' type');
      assert.ok(pageKeys.includes(link.page), link.target + ' page');
      assert.ok(link.source_ref, link.target + ' ref');
    }
  });

  test('is deterministic so two calls compare equal', () => {
    assert.deepEqual(defaultDataSourceConfig(), defaultDataSourceConfig());
  });

  test('ships links for the BRD financial data points', () => {
    const byTarget = new Map(defaultDataSourceConfig().links.map((l) => [l.target, l]));
    assert.equal(byTarget.get('financials_returns').source_ref, 'returns_model');
    assert.equal(byTarget.get('financials_returns').source_type, 'document');
    assert.equal(byTarget.get('header_total_commitment').source_ref, 'total_commitment_aed');
    assert.equal(byTarget.get('header_total_commitment').source_type, 'field');
  });
});

describe('data-source mapping - validation', () => {
  test('accepts the shipped default', () => {
    assert.equal(validateDataSourceConfig(defaultDataSourceConfig()).ok, true);
  });

  test('rejects an unknown data point', () => {
    const { ok, errors } = validateDataSourceConfig({ links: [{ target: 'nope', source_ref: 'x' }] });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /Unknown data point/.test(e.message)));
  });

  test('rejects an unknown source type', () => {
    const { ok, errors } = validateDataSourceConfig({ links: [{ target: DATA_SOURCE_TARGET_KEYS[0], source_type: 'magic', source_ref: 'x' }] });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /Unknown source type/.test(e.message)));
  });

  test('rejects a blank source reference', () => {
    const { ok, errors } = validateDataSourceConfig({ links: [{ target: DATA_SOURCE_TARGET_KEYS[0], source_ref: '  ' }] });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /source reference is required/.test(e.message)));
  });
});

describe('data-source mapping - resolve fallback', () => {
  test('fills a missing link from the shipped default', () => {
    const partial = { revision: 3, source: 'stored', links: [{ target: 'financials_returns', source_ref: 'market_data', source_type: 'document' }] };
    const resolved = resolveDataSourceConfig(partial);
    assert.equal(resolved.revision, 3);
    assert.equal(resolved.links.length, DATA_SOURCE_TARGETS.length);
    assert.equal(resolved.links.find((l) => l.target === 'financials_returns').source_ref, 'market_data');
    assert.equal(resolved.links.find((l) => l.target === 'risks_register').source_ref, 'risk_register');
  });

  test('returns the default for null input', () => {
    assert.deepEqual(resolveDataSourceConfig(null), defaultDataSourceConfig());
  });
});

describe('data-source mapping - revision minting and diff', () => {
  test('build mints revision + 1 and the matching version', () => {
    const base = defaultDataSourceConfig();
    const next = buildDataSourceConfig({ links: [{ target: 'financials_returns', source_ref: 'valuation_basis', source_type: 'document' }] }, { base, actor: { email: 'admin@x' } });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.version, DATA_SOURCE_VERSION_PREFIX + next.revision);
    assert.equal(next.updated_by, 'admin@x');
    assert.equal(next.links.find((l) => l.target === 'financials_returns').source_ref, 'valuation_basis');
  });

  test('diff reports the re-pointed data point', () => {
    const base = defaultDataSourceConfig();
    const next = buildDataSourceConfig({ links: [{ target: 'financials_returns', source_ref: 'valuation_basis' }] }, { base });
    const changes = diffDataSourceConfig(base, next);
    const c = changes.find((x) => x.target === 'financials_returns' && x.field === 'source_ref');
    assert.ok(c);
    assert.equal(c.before, 'returns_model');
    assert.equal(c.after, 'valuation_basis');
  });

  test('build throws 400 on an invalid body', () => {
    assert.throws(() => buildDataSourceConfig({ links: [{ target: 'nope', source_ref: 'x' }] }), (e) => e.status === 400);
  });
});

describe('data-source mapping - resolution', () => {
  test('a document link resolves to the attached version', () => {
    const link = defaultDataSourceConfig().links.find((l) => l.target === 'financials_returns');
    const resolved = resolveLink(link, { documents: [doc('returns_model')], data: {} });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.availability, 'attached');
    assert.equal(resolved.version, 2);
    assert.equal(resolved.url, '/api/files/returns_model.pdf');
    assert.equal(resolved.document_id, 'doc-returns_model');
  });

  test('a document link reports missing when not attached', () => {
    const link = defaultDataSourceConfig().links.find((l) => l.target === 'financials_returns');
    const resolved = resolveLink(link, { documents: [], data: {} });
    assert.equal(resolved.resolved, false);
    assert.equal(resolved.availability, 'missing');
    assert.equal(resolved.version, null);
  });

  test('a field link resolves to the captured value', () => {
    const link = defaultDataSourceConfig().links.find((l) => l.target === 'header_total_commitment');
    const resolved = resolveLink(link, { documents: [], data: { total_commitment_aed: 250 } });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.availability, 'captured');
    assert.equal(resolved.value, 250);
  });

  test('a field link reports missing when blank', () => {
    const link = defaultDataSourceConfig().links.find((l) => l.target === 'header_total_commitment');
    const resolved = resolveLink(link, { documents: [], data: {} });
    assert.equal(resolved.resolved, false);
    assert.equal(resolved.availability, 'missing');
  });
});

describe('data-source mapping - buildSourceMap', () => {
  test('groups the links by memo page in running order and lists missing', () => {
    const map = buildSourceMap({ config: null, documents: [doc('returns_model'), doc('risk_register')], data: { total_commitment_aed: 10 } });
    assert.equal(map.links.length, DATA_SOURCE_TARGETS.length);
    assert.ok(map.pages.length > 0);
    const pageKeys = map.pages.map((p) => p.key);
    const expectedOrder = DATA_SOURCE_PAGES.map((p) => p.key).filter((k) => pageKeys.includes(k));
    assert.deepEqual(pageKeys, expectedOrder);
    assert.ok(Array.isArray(map.missing));
    assert.ok(map.missing.some((m) => m.target === 'financials_returns') === false, 'attached doc is not missing');
    assert.ok(map.missing.some((m) => m.target === 'rationale_market'), 'unattached market data is missing');
    assert.ok(map.disclaimer);
  });

  test('carries the effective version and revision', () => {
    const map = buildSourceMap({ config: { revision: 4, version: 'SRC-01.4', links: [] } });
    assert.equal(map.revision, 4);
    assert.equal(map.version, 'SRC-01.4');
  });
});
