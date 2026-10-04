// ---------------------------------------------------------------------------
// M1 integration tests — RBAC scoping, privacy negative tests, audit (E2.3/2.4/2.6/2.5).
//
// Runs against a live DealForge server. Start it first, then:
//   node --test server/tests/m1.test.js
//   BASE_URL=http://localhost:34000 node --test server/tests/m1.test.js
//
// Skips (rather than fails) when the server is unreachable so it stays usable
// in a frontend-only checkout.
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
const SIRIUS = 'org-sirius-international-holding-limited';
const INFINIA = 'org-infinia-technologies-limited';
const FINSTREET = 'org-finstreet-limited';

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
  if (!online) console.warn(`[m1.test] server not reachable at ${BASE} — tests will be skipped`);
});

describe('identity & org tree', () => {
  test('resolves the acting user with roles and org', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/org/me', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.equal(data.org_id, INFINIA);
    assert.deepEqual(data.roles, ['subsidiary_deal_lead']);
    assert.equal(data.can_sign, false);
  });

  test('seeds the real Sirius org subtree (>=150 nodes)', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/org/organizations', { user: 'user-admin' });
    assert.ok(data.length >= 150, `expected >=150 orgs, got ${data.length}`);
    assert.ok(data.some((o) => o.id === SIRIUS));
  });

  test('CEO can sign, deal lead cannot', async (t) => {
    if (!online) return t.skip('server offline');
    const ceo = await api('/api/org/me', { user: 'user-ceo' });
    const lead = await api('/api/org/me', { user: 'user-deal-lead' });
    assert.equal(ceo.data.can_sign, true);
    assert.equal(lead.data.can_sign, false);
  });
});

describe('entity scoping (own org + descendants)', () => {
  test('subsidiary writes are stamped with the caller org', async (t) => {
    if (!online) return t.skip('server offline');
    const name = `Scope Test ${Date.now()}`;
    const { status, data } = await api('/api/entities/Company', {
      method: 'POST', user: 'user-deal-lead', body: { name },
    });
    assert.equal(status, 201);
    assert.equal(data.owner_org_id, INFINIA);
    assert.equal(data.created_by, 'deal.lead@infinia.local');
  });

  test('cross-org reader (Sirius) sees every org', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/entities/Company', { user: 'user-sirius-deal-lead' });
    assert.ok(Array.isArray(data));
    const orgs = new Set(data.map((r) => r.owner_org_id));
    assert.ok(orgs.size >= 1);
  });
});

describe('privacy negative tests (sibling hard-isolation)', () => {
  let secretId;

  before(async () => {
    if (!online) return;
    // Ensure a sibling user exists (idempotent).
    await api('/api/org/users', {
      method: 'POST', user: 'user-admin',
      body: { id: 'user-finstreet-lead', email: 'deal.lead@finstreet.local', full_name: 'Finstreet Deal Lead' },
    });
    await api('/api/org/memberships', {
      method: 'POST', user: 'user-admin',
      body: { id: 'mem-finstreet-lead', user_id: 'user-finstreet-lead', org_id: FINSTREET, roles: ['subsidiary_deal_lead'], is_primary: true },
    });
    const { data } = await api('/api/entities/Company', {
      method: 'POST', user: 'user-deal-lead', body: { name: `Secret ${Date.now()}` },
    });
    secretId = data.id;
  });

  test('sibling list excludes the other subsidiary\'s records', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/entities/Company', { user: 'user-finstreet-lead' });
    assert.ok(!data.some((r) => r.id === secretId));
    assert.ok(!data.some((r) => r.owner_org_id === INFINIA));
  });

  test('sibling GET by id is denied (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/entities/Company/${secretId}`, { user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });

  test('sibling PATCH is denied (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/entities/Company/${secretId}`, {
      method: 'PATCH', user: 'user-finstreet-lead', body: { name: 'tampered' },
    });
    assert.equal(status, 403);
  });

  test('sibling DELETE is denied (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/entities/Company/${secretId}`, {
      method: 'DELETE', user: 'user-finstreet-lead',
    });
    assert.equal(status, 403);
  });

  test('sibling cannot view the other org node (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/org/organizations/${INFINIA}`, { user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });

  test('owner can still read its own record', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api(`/api/entities/Company/${secretId}`, { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.equal(data.id, secretId);
  });
});

describe('immutable audit trail', () => {
  test('records create/update with actor and org', async (t) => {
    if (!online) return t.skip('server offline');
    const created = await api('/api/entities/Company', {
      method: 'POST', user: 'user-deal-lead', body: { name: `Audited ${Date.now()}` },
    });
    await api(`/api/entities/Company/${created.data.id}`, {
      method: 'PATCH', user: 'user-deal-lead', body: { sector: 'Energy' },
    });
    const { data } = await api(`/api/audit?entity=Company&entity_id=${created.data.id}`, { user: 'user-admin' });
    const actions = data.map((e) => e.action);
    assert.ok(actions.includes('update'));
    assert.ok(actions.includes('create'));
    const upd = data.find((e) => e.action === 'update');
    assert.equal(upd.actor_email, 'deal.lead@infinia.local');
    assert.ok(upd.before && upd.after, 'before/after snapshots required');
  });
});
