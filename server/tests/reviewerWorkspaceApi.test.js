// ---------------------------------------------------------------------------
// Reviewer Workspace API: the draft recommendation, "checked against" on
// validation results, and section-scoped Q&A with internal notes, through the
// real routers, real auth/org scoping and the real database.
// Synthetic data only: one throwaway submitted opportunity, removed afterwards.
// ---------------------------------------------------------------------------
process.env.RATE_LIMIT_DISABLED = '1';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';
process.env.AUTH_ALLOW_HEADER_IDENTITY = '1'; // this test process only; the .env default stays off

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

let pool; let server; let BASE; let online = false;

const SIRIUS = 'deal.lead@sirius.local';       // Sirius reviewer / Gate-1 decider
const VERTICAL = 'vertical.head@sirius.local'; // another Sirius reviewer role
const PREPARER = 'deal.lead@infinia.local';    // owns the opportunity
const CEO = 'ceo@infinia.local';
const CFO = 'cfo@infinia.local';
const OUTSIDER = 'deal.lead@finstreet.local';  // a different subsidiary
const OPP = 'zz-reviewer-' + crypto.randomBytes(4).toString('hex');
const ORG = 'org-infinia-technologies-limited';

async function call(base, path, { method = 'GET', body, as = SIRIUS } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers['x-user-email'] = as;
  const res = await fetch(BASE + base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const ai = (path, o) => call('/api/ai-review', path, o);
const qa = (path, o) => call('/api/qa', path, o);
const open = (body, o) => qa(`/opportunities/${OPP}/threads`, { method: 'POST', body, ...o });
const list = async (as, section) => (await qa(`/opportunities/${OPP}/threads${section ? '?section=' + section : ''}`, { as })).data.threads || [];

before(async () => {
  try {
    const db = await import('../db.js');
    pool = db.pool;
    await pool.query('SELECT 1');
    if (typeof db.initDb === 'function') await db.initDb(); // idempotent: makes sure qa_thread.section exists
    online = true;
  } catch (e) { console.warn('[reviewerWorkspaceApi.test] database unavailable:', e.message); online = false; }
  if (!online) return;
  const { aiReviewRouter, setAiDeps } = await import('../aiReview.js');
  const { qaRouter } = await import('../qa.js');
  setAiDeps({ isAiConfigured: () => false }); // rule-based checks only; the model is never called
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'DealOpportunity',$2,$3,$4,$4)",
    [OPP, ORG, JSON.stringify({
      opportunity_name: 'ZZ reviewer synthetic', status: 'screening_review', owner_email: PREPARER, submitted_by: PREPARER,
      opportunity_type: 'strategic_acquisition', sector: 'Technology', geography: 'UAE', total_commitment_aed: 85, ask_aed: 40,
      funding_source: 'Internal accruals', narrative_what: 'Synthetic acquisition.',
    }), PREPARER]
  );
  const app = express();
  app.use(express.json());
  app.use('/api/ai-review', aiReviewRouter);
  app.use('/api/qa', qaRouter);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  BASE = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (online) {
    await pool.query("DELETE FROM qa_message WHERE thread_id IN (SELECT id FROM qa_thread WHERE opportunity_id = $1)", [OPP]);
    await pool.query("DELETE FROM qa_participant WHERE thread_id IN (SELECT id FROM qa_thread WHERE opportunity_id = $1)", [OPP]);
    await pool.query("DELETE FROM qa_thread WHERE opportunity_id = $1", [OPP]);
    await pool.query("DELETE FROM notification WHERE entity_id = $1", [OPP]);
    await pool.query("DELETE FROM entity_record WHERE id LIKE $1 OR id = $2", [`air-${OPP}-%`, OPP]);
  }
  if (pool) await pool.end();
});

const skipIfOffline = (t) => { if (!online) { t.skip('database unavailable'); return true; } return false; };

describe('draft recommendation', () => {
  test('Sirius reviewer roles can read it; it is a rule-based draft with a rating', async (t) => {
    if (skipIfOffline(t)) return;
    for (const as of [SIRIUS, VERTICAL]) {
      const r = await ai(`/opportunities/${OPP}/recommendation`, { as });
      assert.equal(r.status, 200, as);
      assert.ok(['Go', 'Conditional Go', 'No-Go'].includes(r.data.recommendation.rating));
      assert.equal(r.data.recommendation.label, 'Rule-based draft');
      assert.ok(Array.isArray(r.data.recommendation.rules) && r.data.recommendation.rules.length > 0);
      // An unscored, partly empty submission is never a plain Go.
      assert.notEqual(r.data.recommendation.rating, 'Go');
    }
  });

  test('subsidiary roles and other subsidiaries are refused; no identity is 401', async (t) => {
    if (skipIfOffline(t)) return;
    for (const as of [PREPARER, CEO, CFO]) assert.equal((await ai(`/opportunities/${OPP}/recommendation`, { as })).status, 403, as);
    assert.equal((await ai(`/opportunities/${OPP}/recommendation`, { as: OUTSIDER })).status, 403);
    assert.equal((await ai(`/opportunities/${OPP}/recommendation`, { as: null })).status, 401);
  });

  test('reading it does not change the opportunity', async (t) => {
    if (skipIfOffline(t)) return;
    const before = (await pool.query('SELECT data, updated_date FROM entity_record WHERE id = $1', [OPP])).rows[0];
    await ai(`/opportunities/${OPP}/recommendation`);
    const after = (await pool.query('SELECT data, updated_date FROM entity_record WHERE id = $1', [OPP])).rows[0];
    assert.deepEqual(after.data, before.data);
    assert.equal(String(after.updated_date), String(before.updated_date));
  });
});

describe('checked against', () => {
  test('every validation check carries a checked_against list', async (t) => {
    if (skipIfOffline(t)) return;
    const run = await ai(`/opportunities/${OPP}/validate`, { method: 'POST', body: { tab: 'executive_summary' }, as: SIRIUS });
    assert.equal(run.status, 200);
    assert.ok(run.data.result.checks.length > 0);
    for (const c of run.data.result.checks) assert.ok(Array.isArray(c.checked_against), c.key);
    const res = await ai(`/opportunities/${OPP}/results`, { as: SIRIUS });
    const stored = res.data.results.executive_summary.validation;
    assert.ok(stored.checks.every((c) => Array.isArray(c.checked_against)));
  });
});

describe('section-scoped Q&A and internal notes', () => {
  let sharedId; let internalId;

  test('a reviewer opens a shared question scoped to a section; an unknown section is refused', async (t) => {
    if (skipIfOffline(t)) return;
    const bad = await open({ subject: 'x', body: 'y', section: 'not_a_section' });
    assert.equal(bad.status, 400);
    const r = await open({ subject: 'Financials: top-10 customers', body: 'Please send the top-10 customer revenue split.', section: 'financials', requires_response: true, visibility: 'shared' });
    assert.equal(r.status, 200);
    assert.equal(r.data.section, 'financials');
    assert.equal(r.data.visibility, 'shared');
    sharedId = r.data.id;
  });

  test('a reviewer opens an internal note on a section', async (t) => {
    if (skipIfOffline(t)) return;
    const r = await open({ subject: 'Financials: internal view', body: 'Our concentration worry stays in the group.', section: 'financials', requires_response: false, visibility: 'internal' });
    assert.equal(r.status, 200);
    assert.equal(r.data.visibility, 'internal');
    internalId = r.data.id;
  });

  test('the section filter returns only that section', async (t) => {
    if (skipIfOffline(t)) return;
    const fin = await list(SIRIUS, 'financials');
    assert.deepEqual(fin.map((x) => x.id).sort(), [sharedId, internalId].sort());
    assert.equal((await list(SIRIUS, 'funding')).length, 0);
  });

  test('Sirius reviewers see the internal note and read its messages', async (t) => {
    if (skipIfOffline(t)) return;
    for (const as of [SIRIUS, VERTICAL]) {
      assert.ok((await list(as)).some((x) => x.id === internalId), as);
      const d = await qa(`/threads/${internalId}`, { as });
      assert.equal(d.status, 200, as);
      assert.ok(d.data.messages.length >= 1);
    }
  });

  test('the Preparer, CEO and CFO see the shared question but never the internal note', async (t) => {
    if (skipIfOffline(t)) return;
    for (const as of [PREPARER, CEO, CFO]) {
      const ids = (await list(as)).map((x) => x.id);
      assert.ok(ids.includes(sharedId), `${as} sees the shared question`);
      assert.ok(!ids.includes(internalId), `${as} must not see the internal note in the list`);
      assert.equal((await qa(`/threads/${internalId}`, { as })).status, 403, `${as} must not read the internal thread`);
      assert.equal((await qa(`/threads/${internalId}/audit`, { as })).status, 403, `${as} must not read its audit trail`);
      const mine = (await qa('/my-threads', { as })).data.items || [];
      assert.ok(!mine.some((x) => x.id === internalId), `${as} inbox must not list it`);
    }
    // The section filter does not bypass the rule.
    assert.ok(!(await list(CEO, 'financials')).some((x) => x.id === internalId));
  });

  test('the internal note notifies no subsidiary user', async (t) => {
    if (skipIfOffline(t)) return;
    const { rows } = await pool.query(
      "SELECT recipient_email, subject FROM notification WHERE entity_id = $1 AND recipient_email LIKE '%@infinia.local' AND subject LIKE '%internal view%'", [OPP]);
    assert.equal(rows.length, 0);
  });

  test('a subsidiary user cannot create an internal thread or post an internal message', async (t) => {
    if (skipIfOffline(t)) return;
    for (const as of [PREPARER, CEO, CFO]) {
      const r = await open({ subject: 'Hidden', body: 'try', visibility: 'internal', section: 'funding' }, { as });
      assert.equal(r.status, 403, as);
      const m = await qa(`/threads/${sharedId}/messages`, { method: 'POST', body: { body: 'secret', visibility: 'internal' }, as });
      assert.equal(m.status, 403, as);
    }
    assert.equal((await list(SIRIUS, 'funding')).length, 0, 'nothing was created');
  });

  test('the subsidiary can answer the shared question; another subsidiary sees nothing', async (t) => {
    if (skipIfOffline(t)) return;
    const reply = await qa(`/threads/${sharedId}/messages`, { method: 'POST', body: { body: 'Here is the split.', is_response: true }, as: PREPARER });
    assert.equal(reply.status, 200);
    assert.equal((await qa(`/threads/${sharedId}`, { as: OUTSIDER })).status, 403);
    assert.equal((await qa(`/opportunities/${OPP}/threads`, { as: OUTSIDER })).status, 403);
  });

  test('an internal message on a shared thread stays internal for the subsidiary', async (t) => {
    if (skipIfOffline(t)) return;
    const post = await qa(`/threads/${sharedId}/messages`, { method: 'POST', body: { body: 'Group-only aside.', visibility: 'internal' }, as: SIRIUS });
    assert.equal(post.status, 200);
    const asSirius = (await qa(`/threads/${sharedId}`, { as: SIRIUS })).data.messages.map((m) => m.body);
    const asCeo = (await qa(`/threads/${sharedId}`, { as: CEO })).data.messages.map((m) => m.body);
    assert.ok(asSirius.includes('Group-only aside.'));
    assert.ok(!asCeo.includes('Group-only aside.'));
  });
});

describe('the submitted opportunity cannot be edited by a Sirius reviewer', () => {
  test('the entities API refuses a reviewer edit of a submitted opportunity', async (t) => {
    if (skipIfOffline(t)) return;
    const { entitiesRouter } = await import('../entities.js');
    const app = express();
    app.use(express.json());
    app.use('/api/entities', entitiesRouter);
    const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
    try {
      const base = 'http://127.0.0.1:' + srv.address().port;
      for (const as of [SIRIUS, VERTICAL]) {
        const res = await fetch(`${base}/api/entities/DealOpportunity/${OPP}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-user-email': as }, body: JSON.stringify({ ask_aed: 1, narrative_what: 'tampered' }),
        });
        assert.equal(res.status, 403, as);
      }
      const row = (await pool.query('SELECT data FROM entity_record WHERE id = $1', [OPP])).rows[0];
      assert.equal(row.data.ask_aed, 40);
      assert.equal(row.data.narrative_what, 'Synthetic acquisition.');
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});
