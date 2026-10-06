// Deny-by-default identity (BRD PLT-02 entity isolation, NFR-02 security).
//
// Regression tests for the critical finding that an anonymous request was
// resolved as the default admin, x-user-* headers impersonated any user, and
// /api/integrations accepted uploads with no identity at all.
//
// Part 1 runs against the live suite server (BASE_URL), which has header
// identity enabled for the rest of the suite. Part 2 starts its own server on
// a spare port with header identity OFF (the deployed configuration); it needs
// DATABASE_URL and skips without it. Part 3 checks the production startup
// guard and needs nothing.
//
//   BASE_URL=http://localhost:3001 DATABASE_URL=postgres://... node --test server/tests/authDenyByDefault.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dealforge.local';
const PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';
const STRONG_SECRET = 'deny-by-default-test-secret-0123456789abcdef';

// One representative private route per application area, including routers
// that never checked identity before (integrations) and local uploads.
const PRIVATE_ROUTES = [
  ['GET', '/api/org/me'],
  ['GET', '/api/org/memberships'],
  ['GET', '/api/entities/DealOpportunity'],
  ['GET', '/api/pipeline/board'],
  ['GET', '/api/pipeline/my-opportunities'],
  ['GET', '/api/features'],
  ['GET', '/api/audit'],
  ['GET', '/api/memo-verification'],
  ['GET', '/api/auth-policy'],
  ['GET', '/api/admin/overview'],
  ['POST', '/api/integrations/upload-file'],
  ['POST', '/api/integrations/send-email'],
  ['POST', '/api/integrations/invoke-llm'],
  ['GET', '/uploads/any-file.txt'],
];

async function call(base, method, p, headers = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : '{}',
    redirect: 'manual',
  });
  return res;
}

async function waitForHealth(base, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(base + '/api/health')).ok) return true; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Spawn a server process. cwd is a temp dir so a developer's local .env (which
// may enable header identity) cannot leak into the isolated instance.
function startServer(env) {
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ---------------------------------------------------------------------------
describe('part 1: anonymous requests to the suite server are refused', () => {
  let online = false;
  before(async () => {
    try { online = (await fetch(BASE + '/api/health')).ok; } catch { online = false; }
    if (!online) console.warn(`[authDenyByDefault] server not reachable at ${BASE} - part 1 skipped`);
  });

  for (const [method, p] of PRIVATE_ROUTES) {
    test(`${method} ${p} without identity -> 401`, async (t) => {
      if (!online) return t.skip('server offline');
      const res = await call(BASE, method, p);
      assert.equal(res.status, 401, `${method} ${p} must not be reachable anonymously`);
    });
  }

  test('an anonymous upload is refused and nothing is stored', async (t) => {
    if (!online) return t.skip('server offline');
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'h.txt');
    const res = await fetch(BASE + '/api/integrations/upload-file', { method: 'POST', body: form });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.file_url, undefined);
  });

  test('a header naming an unknown user does not fall back to anyone', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await call(BASE, 'GET', '/api/org/me', { 'x-user-id': 'user-does-not-exist' });
    assert.equal(res.status, 401);
    const res2 = await call(BASE, 'GET', '/api/org/me', { 'x-user-email': 'nobody@nowhere.local' });
    assert.equal(res2.status, 401);
  });

  test('public routes stay reachable without a session', async (t) => {
    if (!online) return t.skip('server offline');
    assert.equal((await call(BASE, 'GET', '/api/health')).status, 200);
    assert.equal((await call(BASE, 'GET', '/api/auth/public-settings')).status, 200);
    assert.equal((await call(BASE, 'GET', '/api/i18n')).status, 200);
    const verify = await call(BASE, 'GET', '/api/memo-verification/verify');
    assert.notEqual(verify.status, 401, 'QR verification must work from a phone with no session');
  });

  test('CORS: a foreign origin gets no CORS grant; an allowed origin does', async (t) => {
    if (!online) return t.skip('server offline');
    const evil = await call(BASE, 'GET', '/api/health', { Origin: 'https://evil.example.com' });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const dev = await call(BASE, 'GET', '/api/health', { Origin: 'http://localhost:5173' });
    assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(dev.headers.get('access-control-allow-credentials'), 'true');
  });
});

// ---------------------------------------------------------------------------
describe('part 2: deployed configuration (header identity OFF)', () => {
  const PORT = Number(process.env.DENY_TEST_PORT || 3097);
  const base = `http://localhost:${PORT}`;
  let proc = null;
  let ready = false;

  before(async () => {
    if (!process.env.DATABASE_URL) return;
    proc = startServer({
      DATABASE_URL: process.env.DATABASE_URL,
      PORT: String(PORT),
      PUBLIC_BASE_URL: base,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      SEED_PROFILE: 'off', // the suite server already seeded this database
      RATE_LIMIT_DISABLED: '1',
      AUTH_ALLOW_HEADER_IDENTITY: '0',
      ADMIN_ALLOW_HEADER_AUTH: '0',
    });
    ready = await waitForHealth(base);
  });

  after(() => { if (proc) proc.kill('SIGTERM'); });

  const skipReason = () => (!process.env.DATABASE_URL ? 'DATABASE_URL not set' : (!ready ? 'isolated server did not start' : null));

  test('x-user-id cannot impersonate the admin', async (t) => {
    if (skipReason()) return t.skip(skipReason());
    const res = await call(base, 'GET', '/api/org/me', { 'x-user-id': 'user-admin' });
    assert.equal(res.status, 401);
  });

  test('x-user-email cannot impersonate the CIO', async (t) => {
    if (skipReason()) return t.skip(skipReason());
    const res = await call(base, 'GET', '/api/entities/DealOpportunity', { 'x-user-email': 'cio@sirius.local' });
    assert.equal(res.status, 401);
  });

  test('no identity at all -> 401 (no default admin)', async (t) => {
    if (skipReason()) return t.skip(skipReason());
    assert.equal((await call(base, 'GET', '/api/org/memberships')).status, 401);
  });

  test('a real Better Auth session is accepted', async (t) => {
    if (skipReason()) return t.skip(skipReason());
    const signIn = await fetch(base + '/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
    });
    assert.equal(signIn.status, 200, 'seeded admin can sign in');
    const cookie = (signIn.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'a session cookie is issued');
    const me = await call(base, 'GET', '/api/org/me', { Cookie: cookie });
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.ok((body.roles || []).includes('admin'));
  });
});

// ---------------------------------------------------------------------------
describe('part 3: production refuses an unsafe configuration', () => {
  function runUntilExit(env, ms = 15_000) {
    return new Promise((resolve) => {
      const p = startServer(env);
      let output = '';
      p.stdout.on('data', (d) => { output += d; });
      p.stderr.on('data', (d) => { output += d; });
      const timer = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: null, output }); }, ms);
      p.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }); });
    });
  }

  test('a published default secret stops the server', async () => {
    const { code, output } = await runUntilExit({
      NODE_ENV: 'production',
      PORT: '3098',
      PUBLIC_BASE_URL: 'https://dealforge.example.ae',
      BETTER_AUTH_SECRET: 'dealforge-local-dev-secret-change-me-4d1f8c9e0b2a',
    });
    assert.equal(code, 1);
    assert.match(output, /published default/);
    assert.match(output, /refusing to start/);
  });

  test('header identity in production stops the server', async () => {
    const { code, output } = await runUntilExit({
      NODE_ENV: 'production',
      PORT: '3098',
      PUBLIC_BASE_URL: 'https://dealforge.example.ae',
      BETTER_AUTH_SECRET: STRONG_SECRET,
      AUTH_ALLOW_HEADER_IDENTITY: '1',
    });
    assert.equal(code, 1);
    assert.match(output, /AUTH_ALLOW_HEADER_IDENTITY/);
  });
});
