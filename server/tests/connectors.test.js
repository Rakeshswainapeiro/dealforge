// Connectors, provenance and launchpad rules (INTG-07/11/12, EXP-03, ACC-02/04). Pure.
//   node --test server/tests/connectors.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConnectorsConfig, resolveConnectorsConfig, validateConnectorsConfig, buildConnectorsConfig, connectorMaturity,
  needsConfirmation, mapPayload, validateEvidence, launchUrlFor, seatStatus, EVIDENCE_FIELDS,
} from '../config/connectors.js';

describe('connector registry', () => {
  test('the shipped stack has the fifteen tools, all switched off, and is valid', () => {
    const cfg = defaultConnectorsConfig();
    assert.equal(cfg.connectors.length, 15);
    assert.ok(cfg.connectors.every((c) => c.enabled === false));
    assert.equal(validateConnectorsConfig(cfg).ok, true);
  });
  test('a field map can only target evidence fields, and URLs must be https', () => {
    const bad = validateConnectorsConfig({ connectors: [{ key: 'x_tool', launch_url: 'http://x', field_map: [{ source: 'a', target: 'total_commitment_aed' }] }] });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /unknown evidence field/.test(e)));
    assert.ok(bad.errors.some((e) => /https/.test(e)));
  });
  test('an admin edit mints a revision', () => {
    const base = resolveConnectorsConfig(null);
    const next = buildConnectorsConfig({ connectors: base.connectors.map((c) => (c.key === 'grata' ? { ...c, enabled: true, refresh_cadence: 'daily' } : c)) }, { base });
    assert.equal(next.revision, 2);
    assert.equal(next.connectors.find((c) => c.key === 'grata').enabled, true);
  });
});

describe('maturity governance (INTG-12)', () => {
  test('a connector carries its highest capability level', () => {
    assert.equal(connectorMaturity({ capabilities: [{ maturity: 'L1' }, { maturity: 'L3' }] }), 'L3');
    assert.equal(connectorMaturity({ capabilities: [] }), 'L0');
  });
  test('L3 and above, and anything AI-derived, needs a person to confirm', () => {
    assert.equal(needsConfirmation({ maturity: 'L2', method: 'api' }), false);
    assert.equal(needsConfirmation({ maturity: 'L3', method: 'api' }), true);
    assert.equal(needsConfirmation({ maturity: 'L4' }), true);
    assert.equal(needsConfirmation({ maturity: 'L1', method: 'ai' }), true);
  });
});

describe('normalisation and provenance (INTG-07, INTG-11)', () => {
  test('mapPayload keeps mapped fields and reports the rest', () => {
    const grata = defaultConnectorsConfig().connectors.find((c) => c.key === 'grata');
    const out = mapPayload(grata, { employee_count: 300, ceo_name: 'X', hq_location: 'Dubai' });
    assert.deepEqual(out.items.map((i) => i.field).sort(), ['employees', 'headquarters']);
    assert.deepEqual(out.unmapped, ['ceo_name']);
  });
  test('evidence needs a known field, a typed value, a source and a sane confidence', () => {
    assert.equal(validateEvidence({ field: 'employees', value: '300', source: 'grata' }).ok, true);
    assert.equal(validateEvidence({ field: 'employees', value: 'many', source: 'grata' }).ok, false);
    assert.equal(validateEvidence({ field: 'employees', value: 3 }).ok, false);
    assert.equal(validateEvidence({ field: 'nope', value: 3, source: 'x' }).ok, false);
    assert.equal(validateEvidence({ field: 'note', value: 'x', source: 'x', confidence: 2 }).ok, false);
    assert.ok(EVIDENCE_FIELDS.length >= 10);
  });
});

describe('launchpad and entitlements (EXP-03, ACC-01/02/04)', () => {
  const grata = defaultConnectorsConfig().connectors.find((c) => c.key === 'grata');
  test('launch carries the opportunity context, URL-encoded', () => {
    assert.equal(launchUrlFor(grata, { opportunity: { target_name: 'Gulf & Co' } }), 'https://search.grata.com/search?query=Gulf%20%26%20Co');
    assert.equal(launchUrlFor(grata), 'https://search.grata.com');
  });
  test('with an IdP launch template and app id, launch goes through SSO', () => {
    const url = launchUrlFor({ ...grata, sso_app_id: 'abc' }, { ssoTemplate: 'https://idp.example/launch/{app_id}?target={redirect}' });
    assert.equal(url, 'https://idp.example/launch/abc?target=' + encodeURIComponent('https://search.grata.com'));
  });
  test('a seat unused for 90 days is dormant', () => {
    const now = new Date('2026-10-01');
    assert.equal(seatStatus({ granted_at: '2026-09-01' }, now), 'active');
    assert.equal(seatStatus({ granted_at: '2026-01-01', last_launched_at: '2026-05-01' }, now), 'dormant');
    assert.equal(seatStatus({ granted_at: '2026-01-01', revoked_at: '2026-02-01' }, now), 'revoked');
  });
});
