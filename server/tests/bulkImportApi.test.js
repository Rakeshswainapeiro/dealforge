// ---------------------------------------------------------------------------
// Bulk import API integration (W8-05 / BRD INTG-03).
//
// Exercises the dry-run report, the execute pass and its guard rails. Skips
// (rather than fails) when the test server is unreachable.
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

const ORG_A = 'org-infinia-technologies-limited';
const ORG_B = 'org-finstreet-limited';

// Every run uses a unique name so repeated runs do not collide.
let stamp = 0;
function uniqueName(prefix) { stamp += 1; return prefix + ' ' + Date.now() + '-' + stamp; }

const HEADER = 'Opportunity name,Sector,Geography,Total commitment (AED mn),Owning org id,State';

function csvWith(...rows) { return [HEADER, ...rows].join('\n'); }

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[bulkImportApi.test] server not reachable — tests will be skipped');
});

describe('bulk import API (INTG-03)', () => {
  test('GET /api/bulk-import/policy returns the versioned policy', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/bulk-import/policy');
    assert.equal(status, 200);
    assert.ok(data.version);
    assert.ok(Array.isArray(data.columns) && data.columns.length > 0);
    assert.ok(data.policy.required_columns.includes('opportunity_name'));
  });

  test('GET /template.csv streams a CSV template', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await fetch(BASE + '/api/bulk-import/template.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/csv/);
    const body = await res.text();
    assert.match(body.split('\n')[0], /Opportunity name/);
  });

  test('validate is admin-only', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/bulk-import/validate', {
      method: 'POST', user: 'user-deal-lead', body: { csv: csvWith() },
    });
    assert.equal(status, 403);
  });

  test('validate returns a row-level report for an admin dry run', async (t) => {
    if (!online) return t.skip('server offline');
    const name = uniqueName('Dry Run Deal');
    const csv = csvWith(
      name + ',Technology,UAE,120,' + ORG_A,
      ',Energy,UAE,80,' + ORG_B,
    );
    const { status, data } = await api('/api/bulk-import/validate', {
      method: 'POST', user: 'user-admin', body: { csv },
    });
    assert.equal(status, 200);
    assert.equal(data.total, 2);
    assert.equal(data.valid, 1);
    assert.equal(data.error, 1);
    assert.equal(data.ok, false);
  });

  test('execute blocks an upload that is missing required columns (422)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/bulk-import/execute', {
      method: 'POST', user: 'user-admin', body: { csv: 'Opportunity name\nDeal only\n', confirm: true },
    });
    assert.equal(status, 422);
  });

  test('execute requires confirmation (400)', async (t) => {
    if (!online) return t.skip('server offline');
    const name = uniqueName('No Confirm Deal');
    const { status } = await api('/api/bulk-import/execute', {
      method: 'POST', user: 'user-admin', body: { csv: csvWith(name + ',Technology,UAE,120,' + ORG_A) },
    });
    assert.equal(status, 400);
  });

  test('execute creates the importable rows and skips the invalid ones', async (t) => {
    if (!online) return t.skip('server offline');
    const good = uniqueName('Loaded Deal');
    const csv = csvWith(
      good + ',Technology,UAE,120,' + ORG_A + ',draft',
      'Bad Org Deal,Energy,UAE,80,org-does-not-exist',
    );
    const { status, data } = await api('/api/bulk-import/execute', {
      method: 'POST', user: 'user-admin', body: { csv, confirm: true },
    });
    assert.equal(status, 200);
    assert.ok(data.created_count >= 1, 'expected at least the good row to load');
    assert.ok(data.created.some((c) => c.opportunity_name === good));
    assert.ok(!data.created.some((c) => c.opportunity_name === 'Bad Org Deal'), 'the unknown-org row is not created');

    // The loaded deal is a real record: readable back through the entity API.
    const id = data.created.find((c) => c.opportunity_name === good).id;
    const rec = await api('/api/entities/DealOpportunity/' + id, { user: 'user-admin' });
    assert.equal(rec.status, 200);
    assert.equal(rec.data.opportunity_name, good);
    assert.equal(rec.data.owner_org_id, ORG_A);
  });
});
