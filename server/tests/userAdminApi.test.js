// ---------------------------------------------------------------------------
// User-administration hardening API integration (W8-06 / BRD PLT-05).
//
// Proves the accept criterion "deactivated users lose access immediately": a
// deactivation takes effect on the next request, is audited, and reactivation
// restores access. Skips (rather than fails) when the server is unreachable.
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dealforge.local';
const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';

let online = false;
let adminCookie = null;

function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function req(path, { method = 'GET', body, cookie, user } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Origin: BASE };
  if (cookie) headers['Cookie'] = cookie;
  if (user) headers['x-user-id'] = user;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: cookieFrom(res) };
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) { console.warn('[userAdminApi.test] server not reachable — tests will be skipped'); return; }
  const admin = await req('/api/auth/sign-in/email', { method: 'POST', body: { email: ADMIN_EMAIL, password: DEFAULT_PASSWORD } });
  if (admin.status === 200) adminCookie = admin.cookie;
});

describe('user administration hardening (PLT-05)', () => {
  test('exposes the versioned lifecycle policy to an admin', async (t) => {
    if (!online) return t.skip('server offline');
    if (!adminCookie) return t.skip('no admin session');
    const { status, data } = await req('/api/admin/user-admin/policy', { cookie: adminCookie });
    assert.equal(status, 200);
    assert.equal(data.version, 'PLT-05.1');
    assert.equal(data.policy.deactivation_takes_effect, 'immediately');
    assert.ok(data.statuses.some((s) => s.key === 'deactivated'));
    assert.ok(data.actions.some((a) => a.key === 'deactivate'));
  });

  test('deactivation takes effect immediately and is audited, then reactivates', async (t) => {
    if (!online) return t.skip('server offline');
    if (!adminCookie) return t.skip('no admin session');

    const orgs = await req('/api/admin/organizations', { cookie: adminCookie });
    if (!orgs.data.length) return t.skip('no organisations seeded');
    const orgId = orgs.data[0].id;

    const email = 'useradmin-test-' + Date.now() + '@dealforge.local';
    const created = await req('/api/admin/users', {
      method: 'POST', cookie: adminCookie,
      body: { full_name: 'User Admin Test', email, password: 'TestPass!2026', org_id: orgId, roles: ['subsidiary_deal_lead'], is_primary: true },
    });
    assert.equal(created.status, 201, 'user created');
    const userId = created.data.id;
    assert.equal(created.data.status, 'active', 'a new account starts active');

    try {
      // The header path resolves the new identity while it is active.
      const before = await req('/api/pipeline/board', { user: userId });
      assert.equal(before.status, 200, 'an active account resolves to an actor');

      // Deactivate. The response reports the sessions it revoked.
      const off = await req('/api/admin/users/' + userId, { method: 'DELETE', cookie: adminCookie });
      assert.equal(off.status, 200);
      assert.equal(typeof off.data.revoked_sessions, 'number');

      // The very next request from the deactivated account is refused.
      const blocked = await req('/api/pipeline/board', { user: userId });
      assert.equal(blocked.status, 401, 'a deactivated account loses access immediately');

      // The console shows the derived status.
      const detail = await req('/api/admin/users/' + userId, { cookie: adminCookie });
      assert.equal(detail.data.status, 'deactivated');
      assert.equal(detail.data.can_authenticate, false);

      // Reactivate restores access (the operator must sign in again).
      const on = await req('/api/admin/users/' + userId + '/reactivate', { method: 'POST', cookie: adminCookie });
      assert.equal(on.status, 200);
      assert.equal(on.data.status, 'active');
      const restored = await req('/api/pipeline/board', { user: userId });
      assert.equal(restored.status, 200, 'reactivation restores access');

      // Both lifecycle changes are on the immutable trail.
      const trail = await req('/api/admin/audit?limit=200', { cookie: adminCookie });
      const forUser = trail.data.filter((e) => e.entity === 'app_user' && e.entity_id === userId);
      assert.ok(forUser.some((e) => e.action === 'deactivate'), 'deactivation audited');
      assert.ok(forUser.some((e) => e.action === 'reactivate'), 'reactivation audited');
    } finally {
      await req('/api/admin/users/' + userId, { method: 'DELETE', cookie: adminCookie });
    }
  });

  test('a deactivated account cannot be banned into a fallback identity', async (t) => {
    if (!online) return t.skip('server offline');
    if (!adminCookie) return t.skip('no admin session');
    // The default-admin fallback must never resurrect a known, inactive account.
    const orgs = await req('/api/admin/organizations', { cookie: adminCookie });
    if (!orgs.data.length) return t.skip('no organisations seeded');
    const email = 'useradmin-fallback-' + Date.now() + '@dealforge.local';
    const created = await req('/api/admin/users', {
      method: 'POST', cookie: adminCookie,
      body: { full_name: 'Fallback Test', email, password: 'TestPass!2026', org_id: orgs.data[0].id, roles: ['analyst'] },
    });
    const userId = created.data.id;
    try {
      await req('/api/admin/users/' + userId, { method: 'DELETE', cookie: adminCookie });
      const blocked = await req('/api/pipeline/board', { user: userId });
      assert.equal(blocked.status, 401);
    } finally {
      await req('/api/admin/users/' + userId, { method: 'DELETE', cookie: adminCookie });
    }
  });
});
