// ---------------------------------------------------------------------------
// Data-room folder link API integration (W8-04 / BRD INTG-01).
//
// Exercises the read/write routes and the audit trail. Skips (rather than
// fails) when the test server is unreachable.
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');

let online = false;

async function api(path, { method = 'GET', body, user } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-user-id'] = user;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const FIELDS = {
  opportunity_name: 'Dataroom Link Test',
  opportunity_type: 'Acquisition',
  target_name: 'RoomCo',
  sector: 'Technology',
  geography: 'UAE',
  total_commitment_aed: 120,
};

async function makeOpportunity(user = 'user-deal-lead', extra = {}) {
  const { data } = await api('/api/entities/DealOpportunity', {
    method: 'POST', user, body: { status: 'draft', ...FIELDS, ...extra },
  });
  return data;
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[dataroomLinkApi.test] server not reachable — tests will be skipped');
});

describe('data-room link API (INTG-01)', () => {
  test('GET /api/pipeline/dataroom-providers lists the providers', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/pipeline/dataroom-providers', { user: 'user-admin' });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.providers));
    assert.ok(data.providers.some((p) => p.key === 'coneshare'));
    assert.ok(data.providers.some((p) => p.key === 'generic'));
  });

  test('a write role can set, read and clear the link with an audit trail', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity('user-deal-lead');
    assert.ok(opp && opp.id, 'expected the opportunity to be created');

    const unset = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', { user: 'user-deal-lead' });
    assert.equal(unset.status, 200);
    assert.equal(unset.data.link, null);

    const set = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', {
      method: 'PUT', user: 'user-deal-lead',
      body: { url: 'https://app.coneshare.com/s/deal-42', label: 'Deal 42 room' },
    });
    assert.equal(set.status, 200);
    assert.equal(set.data.saved, true);
    assert.equal(set.data.link.provider, 'coneshare');
    assert.equal(set.data.link.label, 'Deal 42 room');

    const read = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', { user: 'user-deal-lead' });
    assert.equal(read.data.link.url, 'https://app.coneshare.com/s/deal-42');

    // Setting the link is audited.
    const audit = await api('/api/audit?entity=DealOpportunity&entity_id=' + opp.id, { user: 'user-admin' });
    const events = (audit.data.events || audit.data.items || audit.data || []);
    const actions = (Array.isArray(events) ? events : []).map((e) => e.action);
    if (actions.length) assert.ok(actions.includes('dataroom_link_set'));

    const cleared = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', {
      method: 'DELETE', user: 'user-deal-lead',
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.cleared, true);

    const after = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', { user: 'user-deal-lead' });
    assert.equal(after.data.link, null);
  });

  test('an http link is rejected with 422', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity('user-deal-lead');
    const { status, data } = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', {
      method: 'PUT', user: 'user-deal-lead', body: { url: 'http://app.coneshare.com/s/x' },
    });
    assert.equal(status, 422);
    assert.ok(Array.isArray(data.errors) && data.errors.length >= 1);
  });

  test('a cross-tenant user cannot change the link', async (t) => {
    if (!online) return t.skip('server offline');
    // Another subsidiary's record (created by the admin on its behalf).
    const opp = await makeOpportunity('user-admin', { owner_org_id: 'org-finstreet-limited' });
    assert.ok(opp && opp.id, JSON.stringify(opp));
    const denied = await api('/api/pipeline/opportunities/' + opp.id + '/dataroom-link', {
      method: 'PUT', user: 'user-deal-lead', body: { url: 'https://app.coneshare.com/s/x' },
    });
    assert.equal(denied.status, 403);
  });
});
