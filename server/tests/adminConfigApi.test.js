// Unified admin configuration registry API integration (W8-03 / BRD ADM-01).
//
// Exercises the admin-only registry and per-domain history endpoints. Skips
// (rather than fails) when the test server is unreachable.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');

let online = false;

async function api(path, { user } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-user-id'] = user;
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[adminConfigApi.test] server not reachable — tests will be skipped');
});

describe('admin config API', () => {
  test('GET /api/admin-config returns the registry to an administrator', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/admin-config', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.equal(data.viewer.can_configure, true);
    assert.ok(data.groups.length >= 5);
    assert.ok(data.summary.total >= 20);
    assert.equal(data.summary.audited, data.summary.total);
    assert.equal(data.groups.flatMap((g) => g.domains).length, data.summary.total);
    assert.match(data.scope_note, /new screenings only/i);
  });

  test('GET /api/admin-config forbids a non-administrator', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/admin-config', { user: 'user-deal-lead' });
    assert.equal(status, 403);
  });

  test('GET /api/admin-config/domains lists the areas', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/admin-config/domains', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.ok(data.domains.some((d) => d.domain === 'scorecard'));
    assert.ok(data.domain_keys.includes('decision_reasons'));
  });

  test('GET /api/admin-config/:domain returns the area and its history', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/admin-config/scorecard', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.equal(data.domain.domain, 'scorecard');
    assert.equal(data.domain.action, 'scorecard_config_updated');
    assert.ok(Array.isArray(data.history));
  });

  test('GET /api/admin-config/:domain/history is scoped to the area action', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/admin-config/decision_reasons/history', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.equal(data.action, 'decision_reason_config_updated');
    assert.ok(Array.isArray(data.history));
    for (const row of data.history) assert.equal(row.action, 'decision_reason_config_updated');
  });

  test('GET /api/admin-config/:domain 404s an unknown area', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/admin-config/not-a-domain', { user: 'user-admin' });
    assert.equal(status, 404);
  });
});
