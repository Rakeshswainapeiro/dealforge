// ---------------------------------------------------------------------------
// Feature-flags integration tests (config-time module/menu visibility).
//
// Runs against a live DealForge server:
//   BASE_URL=http://localhost:34000 node --test server/tests/features.test.js
//
// Skips (rather than fails) when the server is unreachable.
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');

let online = false;

async function api(path, { method = 'GET', body, user } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-user-id'] = user;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

before(async () => {
  try {
    const res = await fetch(BASE + '/api/health');
    online = res.ok;
  } catch {
    online = false;
  }
  if (!online) console.warn('[features.test] server not reachable — tests will be skipped');
});

describe('feature flags', () => {
  test('public settings expose feature map without authentication', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/auth/public-settings');
    assert.equal(status, 200);
    assert.ok(data.features);
    assert.equal(data.features.Dashboard, true);
    assert.equal(typeof data.appName, 'string');
  });

  test('GET /api/features returns defaults and groups for an authenticated user', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/features', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.ok(data.features);
    assert.ok(Array.isArray(data.groups));
    assert.ok(data.features.Dashboard === true);
  });

  test('non-admin cannot write feature config', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/features', {
      method: 'PUT',
      user: 'user-deal-lead',
      body: { features: { Dashboard: false } },
    });
    assert.equal(status, 403);
    assert.ok(data.error);
  });

  test('admin can persist and read back feature overrides', async (t) => {
    if (!online) return t.skip('server offline');
    const overrides = { MergerSimulator: false };
    const put = await api('/api/features', {
      method: 'PUT',
      user: 'user-admin',
      body: { features: overrides },
    });
    assert.equal(put.status, 200);
    assert.ok(put.data.features.MergerSimulator === false);
    // Restore so other suites are unaffected.
    await api('/api/features', {
      method: 'PUT',
      user: 'user-admin',
      body: { features: {} },
    });
  });
});
