// ---------------------------------------------------------------------------
// Super-admin console tests   user management, RBAC and tenancy mapping.
//
// Runs against a live DealForge server (skips when unreachable):
//   BASE_URL=http://localhost:34000 node --test server/tests/admin.test.js
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dealforge.local';
const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';

let online = false;
let adminCookie = null;
let nonAdminCookie = null;
let nonAdminEmail = null;

function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Origin: BASE };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: cookieFrom(res) };
}

async function signIn(email, password = DEFAULT_PASSWORD) {
  return req('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
}

before(async () => {
  try {
    const res = await fetch(BASE + '/api/health');
    online = res.ok;
  } catch {
    online = false;
  }
  if (!online) {
    console.warn('[admin.test] server not reachable at ' + BASE + '   tests will be skipped');
    return;
  }

  const admin = await signIn(ADMIN_EMAIL);
  if (admin.status === 200) adminCookie = admin.cookie;

  // Find a seeded user without the admin role to prove the gate is enforced.
  const users = await req('/api/admin/users', { cookie: adminCookie });
  if (users.status === 200) {
    const candidate = (users.data.users || []).find((u) =>
      u.email !== ADMIN_EMAIL && !(u.memberships || []).flatMap((m) => m.roles).includes('admin')
    );
    if (candidate) {
      nonAdminEmail = candidate.email;
      const signed = await signIn(candidate.email);
      if (signed.status === 200) nonAdminCookie = signed.cookie;
    }
  }
});

describe('Super-admin console access control', () => {
  test('requires an authenticated session', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await req('/api/admin/overview');
    assert.equal(status, 401, 'anonymous requests are rejected');
  });

  test('rejects a signed-in user without the admin role', async (t) => {
    if (!online) return t.skip('server offline');
    if (!nonAdminCookie) return t.skip('no non-admin seeded actor available');
    const { status } = await req('/api/admin/users', { cookie: nonAdminCookie });
    assert.equal(status, 403, 'non-admin gets 403');
  });

  test('exposes the role catalog to an admin', async (t) => {
    if (!online) return t.skip('server offline');
    assert.ok(adminCookie, 'admin session established');
    const { status, data } = await req('/api/admin/roles', { cookie: adminCookie });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.roles) && data.roles.length > 0);
    assert.ok(data.roles.some((r) => r.key === 'admin' && r.admin === true));
  });

  test('returns an overview with counts and recent activity', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/admin/overview', { cookie: adminCookie });
    assert.equal(status, 200);
    assert.equal(typeof data.counts.users, 'number');
    assert.equal(typeof data.counts.organizations, 'number');
    assert.ok(Array.isArray(data.role_distribution));
    assert.ok(Array.isArray(data.recent_activity));
  });

  test('returns the tenancy matrix (orgs + per-user assignments)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/admin/tenancy-matrix', { cookie: adminCookie });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.orgs) && data.orgs.length > 0);
    assert.ok(Array.isArray(data.users));
    for (const u of data.users) assert.ok(Array.isArray(u.assignments));
  });
});

describe('Super-admin user + tenancy management', () => {
  test('creates a user, maps an organisation, grants access, then cleans up', async (t) => {
    if (!online) return t.skip('server offline');

    const orgs = await req('/api/admin/organizations', { cookie: adminCookie });
    assert.equal(orgs.status, 200);
    if (!orgs.data.length) return t.skip('no organisations seeded');
    const orgA = orgs.data[0].id;
    const orgB = (orgs.data[1] || orgs.data[0]).id;

    const email = 'admin-test-' + Date.now() + '@dealforge.local';
    const created = await req('/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        full_name: 'Admin Console Test',
        email,
        password: 'TestPass!2026',
        org_id: orgA,
        roles: ['subsidiary_deal_lead'],
        is_primary: true,
      },
    });
    assert.equal(created.status, 201, 'user created');
    assert.equal(created.data.has_credential, true, 'credential provisioned');
    const userId = created.data.id;

    let membershipId = null;
    let grantId = null;
    try {
      // Second org mapping.
      const mem = await req('/api/admin/memberships', {
        method: 'POST',
        cookie: adminCookie,
        body: { user_id: userId, org_id: orgB, roles: ['independent_reviewer'] },
      });
      assert.equal(mem.status, 201, 'membership created');
      membershipId = mem.data.id;

      // Cross-org grant.
      const grant = await req('/api/admin/access-grants', {
        method: 'POST',
        cookie: adminCookie,
        body: { user_id: userId, org_id: orgB, scope: 'read', reason: 'admin test' },
      });
      assert.equal(grant.status, 201, 'grant created');
      grantId = grant.data.id;

      // The tenancy matrix reflects both mappings and the grant.
      const matrix = await req('/api/admin/tenancy-matrix', { cookie: adminCookie });
      const row = matrix.data.users.find((u) => u.id === userId);
      assert.ok(row, 'user present in tenancy matrix');
      assert.equal(row.assignments.length, 2, 'two org assignments');
      const granted = row.assignments.find((a) => a.org_id === orgB);
      assert.equal(granted.has_grant, true, 'grant flagged on the assignment');

      // The new identity can actually sign in.
      const signed = await signIn(email, 'TestPass!2026');
      assert.equal(signed.status, 200, 'new user signs in with the provisioned password');
    } finally {
      if (grantId) await req('/api/admin/access-grants/' + grantId, { method: 'DELETE', cookie: adminCookie });
      if (membershipId) await req('/api/admin/memberships/' + membershipId, { method: 'DELETE', cookie: adminCookie });
      await req('/api/admin/users/' + userId, { method: 'DELETE', cookie: adminCookie });
    }
  });

  test('rejects a duplicate email', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await req('/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { full_name: 'Dup', email: ADMIN_EMAIL },
    });
    assert.equal(status, 409, 'duplicate email is a conflict');
  });

  test('refuses to deactivate the acting admin (self-protection)', async (t) => {
    if (!online) return t.skip('server offline');
    const me = await req('/api/org/me', { cookie: adminCookie });
    const selfId = me.data.id;
    const { status } = await req('/api/admin/users/' + selfId, { method: 'DELETE', cookie: adminCookie });
    assert.equal(status, 400, 'self-deactivation blocked');
  });
});

