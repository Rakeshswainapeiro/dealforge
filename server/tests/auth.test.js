// ---------------------------------------------------------------------------
// Auth + ABAC integration tests  Better Auth sessions, multi-tenant actor
// resolution, and attribute-based read enforcement.
//
// Runs against a live DealForge server (skips when unreachable):
//   BASE_URL=http://localhost:34000 node --test server/tests/auth.test.js
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dealforge.local';
const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';

let online = false;

function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function req(path, { method = 'GET', body, user, cookie } = {}) {
  // Better Auth's CSRF check requires an Origin on state-changing requests;
  // browsers always send one, so the test mirrors that.
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Origin: BASE };
  if (user) headers['x-user-id'] = user;
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res, cookie: cookieFrom(res) };
}

before(async () => {
  try {
    const res = await fetch(BASE + '/api/health');
    online = res.ok;
  } catch {
    online = false;
  }
  if (!online) console.warn('[auth.test] server not reachable at ' + BASE + '  tests will be skipped');
});

describe('Better Auth sessions', () => {
  test('get-session is empty when logged out', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/auth/get-session');
    assert.equal(status, 200);
    assert.ok(data === null || data?.session === null || data === undefined);
  });

  test('admin can sign in with the seeded password and receive a session', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data, cookie } = await req('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: DEFAULT_PASSWORD },
    });
    assert.equal(status, 200);
    assert.ok(data?.user?.email === ADMIN_EMAIL, 'returns the signed-in user');
    assert.ok(cookie && cookie.includes('better-auth.session_token'), 'sets a session cookie');

    // The cookie alone authenticates the actor on the app API.
    const me = await req('/api/org/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, ADMIN_EMAIL);
    assert.ok(me.data.roles.includes('admin'));

    // And get-session reflects it.
    const sess = await req('/api/auth/get-session', { cookie });
    assert.equal(sess.status, 200);
    assert.equal(sess.data?.user?.email, ADMIN_EMAIL);
  });

  test('invalid credentials are rejected', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await req('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: 'definitely-not-the-password' },
    });
    assert.ok(status >= 400, 'expected a 4xx for bad credentials');
  });

  test('header identity still resolves for API clients (no regression)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/org/me', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.equal(data.email, ADMIN_EMAIL);
  });
});

describe('ABAC read enforcement', () => {
  test('a deny policy blocks reads for the matching role and spares admins', async (t) => {
    if (!online) return t.skip('server offline');

    // Pick a subsidiary actor: not an admin, and not a cross-org reader (those
    // short-circuit ABAC and would mask the policy under test).
    const CROSS_ORG = new Set(['admin', 'sirius_deal_lead', 'sirius_vertical_head', 'leadership', 'cio', 'ic_member', 'board_member', 'group_compliance']);
    const usersRes = await req('/api/org/users', { user: 'user-admin' });
    assert.equal(usersRes.status, 200);
    const actor = (usersRes.data || []).find((u) => {
      const roles = (u.memberships || []).flatMap((m) => m.roles || []);
      // Must be an account that can actually act: deactivation is immediate
      // (PLT-05), so a leftover inactive fixture would 401 rather than exercise
      // the ABAC path under test.
      return u.is_active !== false && roles.length && roles.every((r) => !CROSS_ORG.has(r));
    });
    if (!actor) return t.skip('no non-admin, non-cross-org seeded actor available');

    const role = actor.memberships.flatMap((m) => m.roles)[0];
    const orgId = actor.memberships[0].org_id;
    const marker = 'abac-test-' + Date.now();

    // Create a record carrying the attribute the policy keys on.
    const created = await req('/api/entities/opportunity', {
      method: 'POST',
      user: actor.id,
      body: { name: 'ABAC ' + marker, owner_org_id: orgId, sector: marker },
    });
    assert.equal(created.status, 201, 'test record created');
    const recordId = created.data.id;

    // Policy: deny role X read of opportunity when sector == marker.
    const policy = await req('/api/abac/policies', {
      method: 'POST',
      user: 'user-admin',
      body: {
        name: 'abac-test-' + marker,
        subject_type: 'role',
        subject_value: role,
        resource: 'opportunity',
        action: 'read',
        effect: 'deny',
        conditions: { sector: marker },
        priority: 10,
      },
    });
    assert.equal(policy.status, 201, 'policy created');
    const policyId = policy.data.id;

    try {
      // Direct read is denied.
      const denied = await req('/api/entities/opportunity/' + recordId, { user: actor.id });
      assert.equal(denied.status, 403, 'direct read blocked by ABAC');

      // List is filtered (the record is not present).
      const list = await req('/api/entities/opportunity', { user: actor.id });
      assert.equal(list.status, 200);
      assert.ok(!(list.data || []).some((r) => r.id === recordId), 'denied record filtered from list');

      // Admin short-circuits and can still read it.
      const admin = await req('/api/entities/opportunity/' + recordId, { user: 'user-admin' });
      assert.equal(admin.status, 200, 'admin bypasses the policy');

      // The check endpoint reports the decision.
      const check = await req('/api/abac/check?resource=opportunity&sector=' + encodeURIComponent(marker), { user: actor.id });
      assert.equal(check.status, 200);
      assert.equal(check.data.allowed, false);
    } finally {
      await req('/api/abac/policies/' + policyId, { method: 'DELETE', user: 'user-admin' });
      await req('/api/entities/opportunity/' + recordId, { method: 'DELETE', user: 'user-admin' });
    }
  });
});

// ---------------------------------------------------------------------------
// Authentication policy route (W8-01 / BRD PLT-04): MFA mode + enforcement,
// the approved local-account domains and registered SSO providers.
// ---------------------------------------------------------------------------
describe('Auth policy (PLT-04)', () => {
  test('the effective policy advertises the MFA vocabulary and viewer standing', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/auth-policy', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.mfa_modes) && data.mfa_modes.length >= 4);
    assert.ok(data.mfa_modes.some((m) => m.key === 'required_admins'));
    assert.ok(Array.isArray(data.config.local_account_domains));
    assert.ok(data.config.local_account_domains.includes('sirius.local'));
    assert.equal(typeof data.viewer.mfa_required, 'boolean');
    assert.equal(typeof data.viewer.has_mfa, 'boolean');
    assert.ok(data.disclaimer);
  });

  test('a non-admin cannot change the policy', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await req('/api/auth-policy/policy', {
      method: 'PUT', user: 'user-deal-lead', body: { mfa_mode: 'off' },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints the next revision and is recorded in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await req('/api/auth-policy', { user: 'user-admin' });
    const baseRevision = before.data?.config?.revision || 1;
    const baseMode = before.data?.config?.mfa_mode;

    // Toggle the MFA mode, save, and confirm the revision advanced.
    const target = baseMode === 'required_admins' ? 'required_all' : 'required_admins';
    const save = await req('/api/auth-policy/policy', {
      method: 'PUT', user: 'user-admin',
      body: { mfa_mode: target },
    });
    assert.equal(save.status, 200);
    assert.equal(save.data.config.revision, baseRevision + 1);
    assert.equal(save.data.config.mfa_mode, target);
    assert.ok(save.data.changes.some((c) => c.field === 'mfa_mode'));
    // Enforcement is advertised but off unless deliberately switched on.
    assert.equal(save.data.config.enforce_mfa, false);

    const history = await req('/api/auth-policy/policy-history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1);
    assert.equal(history.data[0].action, 'auth_policy_config_updated');

    // Restore the prior mode so the suite leaves no lasting policy change.
    const restore = await req('/api/auth-policy/policy', {
      method: 'PUT', user: 'user-admin',
      body: { mfa_mode: baseMode || 'required_admins' },
    });
    assert.equal(restore.status, 200);
  });

  test('an admin can register, list and remove an OIDC provider', async (t) => {
    if (!online) return t.skip('server offline');
    const providerId = 'sso-test-' + Date.now();
    const registered = await req('/api/auth-policy/providers', {
      method: 'POST', user: 'user-admin',
      body: {
        provider_id: providerId,
        kind: 'oidc',
        label: 'Test IdP',
        domain: providerId + '.example.com',
        issuer: 'https://idp.' + providerId + '.example.com',
        client_id: 'client-id',
        client_secret: 'client-secret',
        skip_discovery: true,
        authorization_endpoint: 'https://idp.' + providerId + '.example.com/authorize',
        token_endpoint: 'https://idp.' + providerId + '.example.com/token',
        jwks_endpoint: 'https://idp.' + providerId + '.example.com/jwks',
      },
    });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    assert.equal(registered.data.provider.provider_id, providerId);
    assert.equal(registered.data.provider.has_client_secret, true);
    assert.equal(registered.data.provider.client_secret, undefined, 'secret is never returned');

    try {
      const list = await req('/api/auth-policy/providers', { user: 'user-admin' });
      assert.equal(list.status, 200);
      assert.ok(list.data.some((p) => p.provider_id === providerId));

      // Sign-in with SSO resolves the provider from the email domain and
      // returns the IdP authorization URL.
      const sso = await req('/api/auth/sign-in/sso', {
        method: 'POST',
        body: { email: 'user@' + providerId + '.example.com', callbackURL: '/' },
      });
      assert.equal(sso.status, 200, JSON.stringify(sso.data));
      assert.ok(String(sso.data.url || '').startsWith('https://idp.' + providerId + '.example.com/authorize'));
    } finally {
      const removed = await req('/api/auth-policy/providers/' + providerId, { method: 'DELETE', user: 'user-admin' });
      assert.equal(removed.status, 200);
    }
  });

  test('registering an invalid provider is rejected with field errors', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/auth-policy/providers', {
      method: 'POST', user: 'user-admin',
      body: { provider_id: 'bad-' + Date.now(), kind: 'oidc', domain: 'bad.example.com' },
    });
    assert.equal(status, 422);
    assert.ok(Array.isArray(data.errors) && data.errors.length >= 1);
  });
});
