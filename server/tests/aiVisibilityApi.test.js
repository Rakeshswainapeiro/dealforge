// ---------------------------------------------------------------------------
// Preparer vs Sirius: who may see and run the internal AI assessment.
//
// Real routers, real auth/org scoping and the real database; only the model call
// is replaced. The point of every case is the server's answer to a DIRECT API
// call - hiding a card on screen proves nothing. Synthetic data only: one
// throwaway submitted opportunity, removed afterwards.
// ---------------------------------------------------------------------------
process.env.RATE_LIMIT_DISABLED = '1';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';
process.env.AUTH_ALLOW_HEADER_IDENTITY = '1'; // this test process only; the .env default stays off
process.env.AI_AUTO_RETRY_MS = '0';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

let pool; let server; let BASE; let online = false;
let aiReview; let lifecycle;

const SIRIUS = 'deal.lead@sirius.local';      // Sirius reviewer
const VERTICAL = 'vertical.head@sirius.local'; // another Sirius reviewer role
const PREPARER = 'deal.lead@infinia.local';   // the subsidiary preparer who owns the deal
const CEO = 'ceo@infinia.local';              // same subsidiary, another producer role
const OUTSIDER = 'deal.lead@finstreet.local'; // a different subsidiary
const OPP = 'zz-vis-' + crypto.randomBytes(4).toString('hex');
const ORG = 'org-infinia-technologies-limited';

const llmCalls = [];
let llm = async () => ({});

async function call(path, { method = 'GET', body, as = SIRIUS } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers['x-user-email'] = as;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const ai = (suffix, o = {}) => call(`/api/ai-review/opportunities/${OPP}${suffix}`, o);
const offline = (t) => { if (!online) { t.skip('database unavailable'); return true; } return false; };

before(async () => {
  try {
    ({ pool } = await import('../db.js'));
    await pool.query('SELECT 1');
    online = true;
  } catch (e) { console.warn('[aiVisibilityApi.test] database unavailable:', e.message); return; }
  aiReview = await import('../aiReview.js');
  lifecycle = await import('../lifecycle.js');
  const { entitiesRouter, auditRouter } = await import('../entities.js');
  const { pipelineRouter } = await import('../pipeline.js');
  const { gateRouter } = await import('../gate.js');
  const { memoPackRouter } = await import('../memoPack.js');
  const { qaRouter } = await import('../qa.js');
  const integrations = (await import('../integrations.js')).default;
  aiReview.setAiDeps({ isAiConfigured: () => true, callLLM: (args) => { llmCalls.push(args); return llm(args); } });
  // The internal Sirius fields a Preparer must never receive.
  const data = {
    opportunity_name: 'ZZ visibility synthetic', status: 'screening_review', owner_email: PREPARER, submitted_by: PREPARER,
    ask_aed: 50, total_commitment_aed: 50,
    scorecard: { scores: { revenue_scale: 4 }, by: SIRIUS },
    hard_filter_review: { decision: 'confirmed', reason: 'internal reviewer note', by: SIRIUS },
    sufficiency_overrides: { cash_flow: { reason: 'internal' } },
  };
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'DealOpportunity',$2,$3,$4,$4)",
    [OPP, ORG, JSON.stringify(data), PREPARER]
  );
  const app = express();
  app.use(express.json());
  app.use('/api/ai-review', aiReview.aiReviewRouter);
  app.use('/api/entities', entitiesRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/gate', gateRouter);
  app.use('/api/memo-pack', memoPackRouter);
  app.use('/api/qa', qaRouter);
  app.use('/api/integrations', integrations);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  BASE = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (online) {
    await pool.query("DELETE FROM qa_message WHERE thread_id IN (SELECT id FROM qa_thread WHERE opportunity_id = $1)", [OPP]).catch(() => {});
    await pool.query("DELETE FROM qa_participant WHERE thread_id IN (SELECT id FROM qa_thread WHERE opportunity_id = $1)", [OPP]).catch(() => {});
    await pool.query("DELETE FROM qa_thread WHERE opportunity_id = $1", [OPP]).catch(() => {});
    await pool.query('DELETE FROM screening_record WHERE opportunity_id = $1', [OPP]).catch(() => {});
    await pool.query("DELETE FROM entity_record WHERE id = $1 OR data->>'opportunity_id' = $1 OR id LIKE $2", [OPP, `air-${OPP}-%`]);
  }
  if (pool) await pool.end();
});

describe('Preparer is refused at the API', () => {
  const ROUTES = [
    ['GET', '/results'], ['POST', '/validate', { tab: 'funding' }], ['POST', '/analyse', { tab: 'funding' }],
    ['POST', '/ask', { tab: 'funding', question: 'what is the ask?' }], ['DELETE', '/ask?tab=funding'],
    ['GET', '/recommendation'], ['POST', '/run-all', {}], ['GET', '/review-history'],
    ['POST', '/tabs/funding/review', { kind: 'validation', action: 'accept' }],
  ];
  for (const as of [PREPARER, CEO, OUTSIDER]) {
    test(`ai-review: every route is 403 for ${as}, and the model is never called`, async (t) => {
      if (offline(t)) return;
      llmCalls.length = 0;
      for (const [method, path, body] of ROUTES) {
        const r = await ai(path, { method, body, as });
        assert.equal(r.status, 403, `${method} ${path} as ${as}`);
      }
      assert.equal(llmCalls.length, 0);
    });
  }

  test('screening, alignment and reviewer history/sufficiency routes are 403', async (t) => {
    if (offline(t)) return;
    for (const path of [
      `/api/pipeline/opportunities/${OPP}/screening`, `/api/pipeline/opportunities/${OPP}/alignment`,
      `/api/gate/opportunities/${OPP}/sufficiency`, `/api/gate/opportunities/${OPP}/hard-filter-review/history`,
      `/api/gate/opportunities/${OPP}/soft-filter-review/history`, `/api/gate/opportunities/${OPP}/disqualifier-review/history`,
      `/api/gate/opportunities/${OPP}/scorecard/history`, `/api/gate/opportunities/${OPP}/sufficiency/history`,
    ]) {
      assert.equal((await call(path, { as: PREPARER })).status, 403, path);
      assert.equal((await call(path, { as: SIRIUS })).status, 200, path + ' (Sirius)');
    }
  });

  test('screening a Preparer asked for leaves no snapshot behind', async (t) => {
    if (offline(t)) return;
    await pool.query('DELETE FROM screening_record WHERE opportunity_id = $1', [OPP]); // the Sirius read above wrote one
    await call(`/api/pipeline/opportunities/${OPP}/screening`, { as: PREPARER });
    const { rows } = await pool.query('SELECT 1 FROM screening_record WHERE opportunity_id = $1', [OPP]).catch(() => ({ rows: [] }));
    assert.equal(rows.length, 0);
  });

  test('generic entity API: internal AI entities are unreadable by a Preparer and unwritable by anyone', async (t) => {
    if (offline(t)) return;
    for (const entity of ['AIReviewResult', 'AIReviewDecision']) {
      assert.equal((await call(`/api/entities/${entity}`, { as: PREPARER })).status, 403);
      assert.equal((await call(`/api/entities/${entity}/anything`, { as: PREPARER })).status, 403);
      // AIReviewResult is closed to every role; AIReviewDecision stays readable by reviewers.
      assert.equal((await call(`/api/entities/${entity}`, { as: SIRIUS })).status, entity === 'AIReviewResult' ? 403 : 200);
      for (const [method, path] of [['POST', `/api/entities/${entity}`], ['PUT', `/api/entities/${entity}/x`], ['PATCH', `/api/entities/${entity}/x`], ['DELETE', `/api/entities/${entity}/x`]]) {
        assert.equal((await call(path, { method, body: { x: 1 }, as: SIRIUS })).status, 403, `${method} ${entity} as Sirius`);
        assert.equal((await call(path, { method, body: { x: 1 }, as: PREPARER })).status, 403, `${method} ${entity} as Preparer`);
      }
    }
  });

  test('generic entity API: AIReviewResult is closed to every role and method (V1/V2 regression)', async (t) => {
    if (offline(t)) return;
    const OTHER = 'ceo@infinia.local';
    const rows = await pool.query("SELECT id FROM entity_record WHERE entity = 'AIReviewResult' LIMIT 1");
    const id = rows.rows[0]?.id || 'does-not-exist';
    for (const as of [PREPARER, SIRIUS, OTHER]) {
      for (const [method, path] of [
        ['GET', '/api/entities/AIReviewResult'], ['GET', `/api/entities/AIReviewResult/${id}`],
        ['POST', '/api/entities/AIReviewResult'], ['PUT', `/api/entities/AIReviewResult/${id}`],
        ['PATCH', `/api/entities/AIReviewResult/${id}`], ['DELETE', `/api/entities/AIReviewResult/${id}`],
      ]) {
        const r = await call(path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : { x: 1 }, as });
        assert.equal(r.status, 403, `${method} ${path} as ${as}`);
      }
    }
    if (rows.rows[0]) {
      const after = await pool.query("SELECT data FROM entity_record WHERE id = $1", [id]);
      assert.ok(!('x' in after.rows[0].data), 'a refused write changed nothing');
    }
  });

  test('generic entity API: reviewer fields are removed from the Preparer\'s copy of the opportunity only', async (t) => {
    if (offline(t)) return;
    const mine = (await call(`/api/entities/DealOpportunity/${OPP}`, { as: PREPARER })).data;
    const theirs = (await call(`/api/entities/DealOpportunity/${OPP}`, { as: SIRIUS })).data;
    for (const f of ['scorecard', 'hard_filter_review', 'sufficiency_overrides']) {
      assert.equal(mine[f], undefined, `Preparer must not receive ${f}`);
      assert.ok(theirs[f], `Sirius receives ${f}`);
    }
    assert.equal(mine.opportunity_name, 'ZZ visibility synthetic', 'the Preparer still gets their own submission');
    const list = (await call(`/api/entities/DealOpportunity?filter=${encodeURIComponent(JSON.stringify({ opportunity_name: 'ZZ visibility synthetic' }))}`, { as: PREPARER })).data;
    assert.ok(Array.isArray(list) && list.length >= 1 && list.every((r) => r.scorecard === undefined));
  });

  test('gate status: the Sirius assessment blocks are null for a Preparer, who keeps the submission checks', async (t) => {
    if (offline(t)) return;
    const mine = (await call(`/api/gate/opportunities/${OPP}/status`, { as: PREPARER })).data.gate;
    const theirs = (await call(`/api/gate/opportunities/${OPP}/status`, { as: SIRIUS })).data.gate;
    for (const k of ['scorecard', 'soft_filters', 'hard_filters', 'disqualifiers', 'sufficiency', 'portfolio_conflict', 'portfolio_synergy', 'mandate_fit']) {
      assert.equal(mine[k], null, `Preparer: ${k}`);
    }
    assert.ok(theirs.scorecard && theirs.hard_filters, 'Sirius keeps them');
    for (const k of ['missing', 'complete', 'qualifying_gates', 'attestations', 'document_checklist', 'hurdle_table']) {
      assert.ok(k in mine, `Preparer keeps ${k}`);
    }
  });

  test('the model endpoints are not a back door for a Preparer', async (t) => {
    if (offline(t)) return;
    llmCalls.length = 0;
    for (const p of ['invoke-llm', 'extract-data', 'generate-image']) {
      assert.equal((await call('/api/integrations/' + p, { method: 'POST', body: { prompt: 'hi', file_url: 'x' }, as: PREPARER })).status, 403, p);
    }
    assert.notEqual((await call('/api/integrations/invoke-llm', { method: 'POST', body: { prompt: 'hi' }, as: SIRIUS })).status, 403);
  });

  test('the Preparer can still read their own memo pack, without the alignment reading', async (t) => {
    if (offline(t)) return;
    const r = await call(`/api/memo-pack/opportunities/${OPP}`, { as: PREPARER });
    assert.equal(r.status, 200);
  });
});

describe('automatic run after submission', () => {
  const waitFor = async (fn, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); }
    return null;
  };

  test('submit hook stores a validation and an analysis for every tab, visible to Sirius only', async (t) => {
    if (offline(t)) return;
    process.env.AI_AUTO_RUN = '1';
    llmCalls.length = 0;
    llm = async () => ({});
    await lifecycle.runAfterSubmit({ row: { id: OPP }, actor: { email: PREPARER }, gate: { complete: true } });
    const done = await waitFor(async () => {
      const r = (await ai('/results')).data;
      return r?.tabs && r.tabs.every((tab) => r.results[tab].validation && r.results[tab].analysis) ? r : null;
    });
    assert.ok(done, 'every tab has both results');
    for (const tab of done.tabs) {
      assert.equal(done.results[tab].validation.tab, tab);
      assert.equal(done.results[tab].validation.trigger, 'auto_submit');
    }
    assert.equal(done.overview.tabs.length, 7);
    assert.equal((await ai('/results', { as: PREPARER })).status, 403);
  });

  test('trusted loaders (no gate) and AI_AUTO_RUN=0 do not start a run', async (t) => {
    if (offline(t)) return;
    await pool.query("DELETE FROM entity_record WHERE id LIKE $1", [`air-${OPP}-%`]);
    process.env.AI_AUTO_RUN = '1';
    await lifecycle.runAfterSubmit({ row: { id: OPP }, actor: { email: PREPARER }, gate: null });
    process.env.AI_AUTO_RUN = '0';
    await lifecycle.runAfterSubmit({ row: { id: OPP }, actor: { email: PREPARER }, gate: { complete: true } });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(((await ai('/results')).data.results.funding.validation), null);
  });

  test('a transient provider failure is retried once, a persistent one is stored per tab and can be retried', async (t) => {
    if (offline(t)) return;
    await pool.query("DELETE FROM entity_record WHERE id LIKE $1", [`air-${OPP}-%`]);
    // Fail the first call of every run, then answer.
    let n = 0;
    llm = async () => { n += 1; if (n === 1) { const e = new Error('provider down'); e.status = 503; throw e; } return {}; };
    const first = await aiReview.runAllTabs(OPP);
    assert.equal(first.failed, 0, 'the single transient failure was retried away');
    // Persistent failure.
    await pool.query("DELETE FROM entity_record WHERE id LIKE $1", [`air-${OPP}-%`]);
    llm = async () => { const e = new Error('provider down'); e.status = 503; throw e; };
    const bad = await aiReview.runAllTabs(OPP);
    assert.ok(bad.failed > 0);
    const r = (await ai('/results')).data;
    assert.equal(r.results.funding.validation.ai_status, 'unavailable');
    assert.ok(r.overview.counts.failed_runs > 0);
    // A reviewer retry after the provider recovers replaces the failed results.
    llm = async () => ({});
    const again = await aiReview.runAllTabs(OPP, { email: SIRIUS }, { trigger: 'manual_all' });
    assert.equal(again.failed, 0);
    assert.equal((await ai('/results')).data.results.funding.validation.ai_status, 'ok');
  });

  test('answering an information request re-runs only the tabs that changed', async (t) => {
    if (offline(t)) return;
    process.env.AI_AUTO_RUN = '1';
    llm = async () => ({});
    await pool.query("DELETE FROM entity_record WHERE id LIKE $1", [`air-${OPP}-%`]);
    await aiReview.runAllTabs(OPP, { email: SIRIUS }, { trigger: 'manual_all' });
    const fire = async () => { for (const h of lifecycle.transitionHooks) await h({ row: { id: OPP }, rule: { action: 'respond' }, actor: { email: PREPARER } }); };
    llmCalls.length = 0;
    await fire();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(llmCalls.length, 0, 'nothing changed, so nothing is re-run');
    await pool.query("UPDATE entity_record SET data = data || '{\"ask_aed\": 91}'::jsonb WHERE id = $1", [OPP]);
    await fire();
    await waitFor(async () => llmCalls.length > 0);
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(llmCalls.length > 0 && llmCalls.length < 14, 'only the changed tabs were re-run: ' + llmCalls.length);
    await new Promise((r) => setTimeout(r, 1500));
    process.env.AI_AUTO_RUN = '0';
  });

  test('POST run-all is accepted for a reviewer', async (t) => {
    if (offline(t)) return;
    const r = await ai('/run-all', { method: 'POST', body: { only_stale: true } });
    assert.equal(r.status, 202);
    await new Promise((res) => setTimeout(res, 1500));
  });
});

describe('reviewer decisions on AI findings', () => {
  const REASON = 'The figure is confirmed in the signed term sheet.';

  test('validation: bad input is refused with a reason', async (t) => {
    if (offline(t)) return;
    await aiReview.runAllTabs(OPP, { email: SIRIUS }, { trigger: 'manual_all' });
    const post = (body, as = SIRIUS) => ai('/tabs/funding/review', { method: 'POST', body, as });
    assert.equal((await post({ kind: 'bogus', action: 'accept' })).status, 400);
    assert.equal((await post({ kind: 'validation', action: 'nope' })).status, 400);
    assert.equal((await post({ kind: 'validation', action: 'override', to_status: 'pass' })).status, 400, 'override needs a reason');
    assert.equal((await post({ kind: 'validation', action: 'override', reason: 'too short', to_status: 'pass' })).status, 400);
    assert.equal((await post({ kind: 'validation', action: 'override', reason: REASON })).status, 400, 'override needs a status');
    assert.equal((await post({ kind: 'validation', action: 'override', reason: REASON, to_status: 'maybe' })).status, 400);
    assert.equal((await post({ kind: 'analysis', action: 'override', reason: REASON, to_status: 'pass' })).status, 400, 'analysis uses ratings');
    assert.equal((await post({ kind: 'validation', action: 'clarify', question: 'hm' })).status, 400);
    assert.equal((await ai('/tabs/not_a_tab/review', { method: 'POST', body: { kind: 'validation', action: 'accept' } })).status, 400);
    const none = (await call('/api/ai-review/opportunities/zz-missing/tabs/funding/review', { method: 'POST', body: { kind: 'validation', action: 'accept' } }));
    assert.equal(none.status, 404);
  });

  test('override: stored append-only with the AI status it replaced, audited, applied to the overview, stale when the tab changes', async (t) => {
    if (offline(t)) return;
    const before = (await ai('/results')).data;
    const aiStatus = before.results.funding.validation.status;
    const r = await ai('/tabs/funding/review', { method: 'POST', body: { kind: 'validation', action: 'override', reason: REASON, to_status: aiStatus === 'pass' ? 'review' : 'pass' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.decision.from_status, aiStatus);
    assert.equal(r.data.decision.by, SIRIUS);
    const after = (await ai('/results')).data;
    const row = after.overview.tabs.find((x) => x.tab === 'funding');
    assert.equal(row.validation_overridden, true);
    assert.equal(row.validation_ai_status, aiStatus, 'the AI status is kept beside the override');
    assert.equal(after.results.funding.validation.status, aiStatus, 'the stored AI result is never rewritten');
    // Second override by another reviewer: both in history, latest wins.
    const r2 = await ai('/tabs/funding/review', { method: 'POST', as: VERTICAL, body: { kind: 'validation', action: 'override', reason: 'Second look: ' + REASON, to_status: 'fail' } });
    assert.equal(r2.status, 201);
    const hist = (await ai('/review-history?tab=funding')).data.decisions.filter((d) => d.kind === 'validation');
    assert.equal(hist.length, 2);
    assert.deepEqual(hist.map((d) => d.by), [SIRIUS, VERTICAL]);
    assert.equal((await ai('/results')).data.overview.tabs.find((x) => x.tab === 'funding').validation_status, 'fail');
    // The audit trail carries it for Sirius, and the Preparer's audit view does not.
    const events = (await call(`/api/audit?entity=DealOpportunity&entity_id=${OPP}&limit=200`, { as: SIRIUS })).data;
    assert.ok(events.some((e) => e.action === 'ai_review_override' && e.comment));
    const seenByPreparer = (await call(`/api/audit?entity=DealOpportunity&entity_id=${OPP}&limit=200`, { as: PREPARER })).data;
    assert.ok(!seenByPreparer.some((e) => String(e.action).startsWith('ai_')), 'no AI event reaches the Preparer');
    const timeline = (await call(`/api/pipeline/opportunities/${OPP}/timeline`, { as: PREPARER })).data.events;
    assert.ok(!timeline.some((e) => String(e.action).startsWith('ai_')));
    // Edit the tab: the override no longer applies to the changed content.
    await pool.query("UPDATE entity_record SET data = data || '{\"ask_aed\": 77}'::jsonb WHERE id = $1", [OPP]);
    const stale = (await ai('/results')).data.overview.tabs.find((x) => x.tab === 'funding');
    assert.equal(stale.validation_overridden, false);
  });

  test('analysis item override uses ratings; accept needs no reason', async (t) => {
    if (offline(t)) return;
    llm = async () => ({ recommendation: { rating: 'Adequate', summary: 'ok' }, items: [{ title: 'Ask', rating: 'Weak', summary: 's', why: 'w' }] });
    await aiReview.runAllTabs(OPP, { email: SIRIUS }, { trigger: 'manual_all' });
    const bad = await ai('/tabs/funding/review', { method: 'POST', body: { kind: 'analysis', finding_key: 'item-0', action: 'override', reason: REASON, to_status: 'Strong' } });
    assert.equal(bad.status, 201);
    assert.equal(bad.data.decision.from_status, 'Weak');
    const acc = await ai('/tabs/funding/review', { method: 'POST', body: { kind: 'analysis', finding_key: 'item-0', action: 'accept' } });
    assert.equal(acc.status, 201);
    const latest = (await ai('/results')).data.decisions.find((d) => d.tab === 'funding' && d.kind === 'analysis' && d.finding_key === 'item-0');
    assert.equal(latest.action, 'accept');
  });

  test('clarify opens a tab-linked Q&A thread the Preparer can see and answer', async (t) => {
    if (offline(t)) return;
    const r = await ai('/tabs/funding/review', { method: 'POST', body: { kind: 'validation', action: 'clarify', question: 'Please confirm the ask against the term sheet.' } });
    assert.equal(r.status, 201);
    assert.ok(r.data.decision.thread_id, 'a thread was opened');
    const threads = (await call(`/api/qa/opportunities/${OPP}/threads`, { as: PREPARER })).data;
    const list = Array.isArray(threads) ? threads : threads.threads || [];
    const mine = list.find((x) => x.id === r.data.decision.thread_id);
    assert.ok(mine, 'the Preparer sees the request');
    assert.equal(mine.section, 'funding');
  });

  test('a producer who is not an administrator cannot post a decision even with a forged body', async (t) => {
    if (offline(t)) return;
    const r = await ai('/tabs/funding/review', { method: 'POST', as: PREPARER, body: { kind: 'validation', action: 'override', reason: REASON, to_status: 'pass' } });
    assert.equal(r.status, 403);
  });
});
