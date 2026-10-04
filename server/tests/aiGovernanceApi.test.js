// ---------------------------------------------------------------------------
// AI governance API integration (W9-01 / BRD NFR-03).
//
// Proves the governance surface: any authenticated user can read the policy and
// the AI-output label, an administrator can change the policy and the provider
// register (audited, revisioned), an unapproved provider blocks model calls,
// and the governed-call log is admin-only. Skips when the server is offline.
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dealforge.local';
const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';

let online = false;
let adminCookie = null;
let originalConfig = null;

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
  if (!online) { console.warn('[aiGovernanceApi.test] server not reachable — tests will be skipped'); return; }
  const admin = await req('/api/auth/sign-in/email', { method: 'POST', body: { email: ADMIN_EMAIL, password: DEFAULT_PASSWORD } });
  if (admin.status === 200) adminCookie = admin.cookie;
  const current = await req('/api/ai-governance', { cookie: adminCookie || undefined });
  if (current.status === 200) originalConfig = current.data.config;
});

describe('AI governance (NFR-03)', () => {
  test('exposes the policy, label and approval summary to a reader', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/ai-governance', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.equal(data.config.version, 'NFR-03.1');
    assert.equal(data.config.log_prompts, true);
    assert.equal(data.label, 'AI-generated');
    assert.equal(typeof data.disclaimer, 'string');
    assert.ok(data.approval.total > 0);
    assert.ok(Array.isArray(data.config.providers));
    assert.equal(data.can_configure, false, 'a deal lead cannot configure');
  });

  test('exposes the security posture with a passing go-live gate', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await req('/api/ai-governance', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.security_posture, 'security_posture present');
    assert.equal(data.security_posture.gate.pass, true);
    assert.equal(data.security_posture.summary.open_critical_or_high, 0);
    assert.ok(data.security_posture.controls.length > 0);
  });

  test('an administrator can approve a provider, which bumps the revision', async (t) => {
    if (!online) return t.skip('server offline');
    if (!adminCookie) return t.skip('no admin session');
    const providers = originalConfig.providers.map((p) => (p.id === 'custom' ? { ...p, approval_status: 'approved' } : p));
    const res = await req('/api/ai-governance', {
      method: 'PUT', cookie: adminCookie,
      body: { config: { ...originalConfig, providers, log_prompts: true } },
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.config.revision > (originalConfig.revision || 1));
    assert.equal(res.data.config.updated_by, ADMIN_EMAIL);
    assert.ok(res.data.approval.approved_ids.includes('custom'));
    const approved = res.data.config.providers.find((p) => p.id === 'custom');
    assert.equal(approved.approved_by, ADMIN_EMAIL, 'approver recorded');
    assert.ok(approved.approved_on, 'approval date recorded');
    // Restore so the test does not leak provider approvals into other runs.
    await req('/api/ai-governance', { method: 'PUT', cookie: adminCookie, body: { config: originalConfig } });
  });

  test('a non-administrator cannot change the policy', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await req('/api/ai-governance', { method: 'PUT', user: 'user-deal-lead', body: { config: { log_prompts: false } } });
    assert.equal(res.status, 403);
  });

  test('rejects an invalid policy with 400', async (t) => {
    if (!online) return t.skip('server offline');
    if (!adminCookie) return t.skip('no admin session');
    const res = await req('/api/ai-governance', { method: 'PUT', cookie: adminCookie, body: { config: { retention_days: 0 } } });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.data.errors));
  });

  test('the governed-call log is admin-only', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await req('/api/ai-governance/log', { user: 'user-deal-lead' });
    assert.equal(denied.status, 403);
    if (!adminCookie) return t.skip('no admin session');
    const ok = await req('/api/ai-governance/log', { cookie: adminCookie });
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.data.logs));
  });

  test('a model call to an unapproved provider is refused before it leaves the server', async (t) => {
    if (!online) return t.skip('server offline');
    if (!adminCookie) return t.skip('no admin session');
    // openai is pending by default; a call that names it must be blocked 403.
    const res = await req('/api/integrations/invoke-llm', {
      method: 'POST', cookie: adminCookie,
      body: { prompt: 'hello', base_url: 'https://api.openai.com/v1' },
    });
    assert.equal(res.status, 403);
    assert.match(String(res.data.error || ''), /not approved/i);
  });
});
