// M4 integration tests — submission route (E7) and Q&A loop (E8).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/[/]+$/, '');
const SIRIUS = 'org-sirius-international-holding-limited';
const INFINIA = 'org-infinia-technologies-limited';

let online = false;

async function api(path, { method = 'GET', body, user, form } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (!form) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const FULL_FIELDS = {
  opportunity_name: 'Infinia Digital Platform',
  opportunity_type: 'Acquisition',
  target_name: 'DigitalCo LLC',
  sector: 'Technology',
  geography: 'UAE',
  total_commitment_aed: 150,
  ask_aed: 60,
  funding_source: 'Balance sheet',
  in_approved_budget: 'yes',
  target_signing_close: '2027-06',
  sourcing_channel: 'proprietary',
  narrative_what: 'Acquire a SaaS platform with recurring revenue.',
  narrative_why_now: 'Consolidation window is open.',
  narrative_why_us: 'We operate the adjacent software stack.',
  decision_sought: 'Approval to proceed to diligence.',
  business_plan: 'Business plan attached.',
};

async function makeOpportunity(user = 'user-deal-lead', fields = FULL_FIELDS) {
  const { data } = await api('/api/entities/DealOpportunity', {
    method: 'POST', user, body: { status: 'draft', ...fields },
  });
  return data;
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[m4.test] server unreachable at ' + BASE);
});

describe('workflow templates (E7.1/E7.2)', () => {
  test('a standard active route is seeded and lists its stages', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/workflows?org_id=' + SIRIUS, { user: 'user-admin' });
    assert.equal(status, 200);
    assert.ok(data.workflows.length >= 1, 'expected at least one workflow');
    const wf = data.workflows.find((w) => w.is_default) || data.workflows[0];
    assert.equal(wf.status, 'active');
    assert.ok(Array.isArray(wf.stages) && wf.stages.length >= 4, 'expected ordered stages');
    const actions = new Set(wf.stages.map((s) => s.action));
    for (const action of ['fill', 'review', 'sign', 'approve']) {
      assert.ok(actions.has(action), 'missing stage action ' + action);
    }
  });

  test('stages carry roles, required fields and a signature flag', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/workflows?org_id=' + SIRIUS, { user: 'user-admin' });
    const wf = data.workflows[0];
    const signStage = wf.stages.find((s) => s.requires_signature);
    assert.ok(signStage, 'expected a stage that requires a signature');
    assert.ok((signStage.roles || []).length > 0, 'signature stage must name roles');
    const fieldStage = wf.stages.find((s) => (s.required_fields || []).length > 0);
    assert.ok(fieldStage, 'expected a stage with required fields');
  });

  test('only admins may create or edit a workflow', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/workflows', {
      method: 'POST', user: 'user-deal-lead',
      body: { org_id: INFINIA, name: 'Deal lead route', stages: [{ name: 'X', action: 'fill' }] },
    });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/workflows', {
      method: 'POST', user: 'user-admin',
      body: {
        org_id: INFINIA, name: 'Infinia fast route', status: 'draft',
        stages: [
          { stage_key: 'prep', name: 'Prepare', action: 'fill', roles: ['subsidiary_deal_lead'], required_fields: ['decision_sought'] },
          { stage_key: 'sign', name: 'Sign', action: 'sign', roles: ['subsidiary_ceo'], requires_signature: true },
        ],
      },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.stages.length, 2);
  });

  test('an unknown stage action is rejected', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/workflows', {
      method: 'POST', user: 'user-admin',
      body: { org_id: INFINIA, name: 'Bad route', stages: [{ name: 'Nope', action: 'explode' }] },
    });
    assert.equal(status, 400);
  });
});

describe('applying a route (E7.3)', () => {
  test('applying a workflow snapshots stages and resolves participants', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    const { status, data } = await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.route_id);
    assert.ok(data.stages >= 4);
    assert.ok(data.participants > 0, 'expected resolved participants');

    const { data: bundle } = await api('/api/workflows/route/' + opp.id, { user: 'user-deal-lead' });
    assert.equal(bundle.route.opportunity_id, opp.id);
    assert.equal(bundle.route.current_stage, bundle.stages[0].stage_key);
    assert.equal(bundle.participants.length, data.participants);
  });

  test('the signature map orders participants per stage before send', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    const { status, data } = await api('/api/workflows/signature-map/' + opp.id, { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.stages.length >= 4);
    const ordered = data.stages.map((s) => s.sort_order);
    assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b), 'stages must be ordered');
    const signStage = data.stages.find((s) => s.requires_signature);
    assert.ok(signStage, 'expected a signing stage on the map');
    assert.ok(signStage.signing_order.length > 0, 'signing stage must list signers');
    assert.ok(signStage.signing_order[0].status === 'pending');
  });

  test('applying a route notifies the signatories', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    const { data } = await api('/api/notifications?all=1&limit=200', { user: 'user-admin' });
    assert.ok(data.items.some((n) => n.kind === 'route_applied' && n.entity_id === opp.id), 'expected a route_applied notification');
  });

  test('a sibling cannot read another org route or signature map', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    const route = await api('/api/workflows/route/' + opp.id, { user: 'user-finstreet-lead' });
    assert.equal(route.status, 403);
    const map = await api('/api/workflows/signature-map/' + opp.id, { user: 'user-finstreet-lead' });
    assert.equal(map.status, 403);
  });
});

describe('acting on stages (E7.4/E7.5)', () => {
  test('the producing layer completes fill, then a signatory signs', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    const fill = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-deal-lead', body: { comment: 'Ready for sign-off' },
    });
    assert.equal(fill.status, 200);
    assert.equal(fill.data.next_stage, 'subsidiary_sign');
    const sign = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-cfo', body: { action: 'sign' },
    });
    assert.equal(sign.status, 200);
    assert.equal(sign.data.next_stage, 'investment_review');
    const { data: map } = await api('/api/workflows/signature-map/' + opp.id, { user: 'user-deal-lead' });
    const signed = map.stages.find((s) => s.stage_key === 'subsidiary_sign');
    assert.equal(signed.status, 'complete');
    assert.ok(signed.signing_order.some((p) => p.status === 'signed' && p.signed_at));
  });

  test('a stage cannot be advanced out of order or by the wrong role', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    // Skipping straight to a later stage is rejected.
    const skip = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-cio', body: { stage_key: 'investment_review' },
    });
    assert.equal(skip.status, 409);
    // Acting on the current stage without the role is rejected.
    const wrongRole = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-cio', body: { action: 'act' },
    });
    assert.equal(wrongRole.status, 403);
  });

  test('required fields block a stage with a precise 422', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity('user-deal-lead', { ...FULL_FIELDS, decision_sought: '' });
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    const { status, data } = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-deal-lead', body: {},
    });
    assert.equal(status, 422);
    assert.ok(data.missing.includes('decision_sought'));
  });

  test('returning a stage sends the submission back to the producing layer', async (t) => {
    if (!online) return t.skip('server offline');
    // Start from a submitted opportunity so the pipeline can move to screening.
    const opp = await makeOpportunity('user-deal-lead', { ...FULL_FIELDS, status: 'submission' });
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-deal-lead', body: {} });
    // Move the pipeline to screening so the reviewer can return it.
    await api('/api/pipeline/opportunities/' + opp.id + '/transition', { method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' } });
    const returned = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { action: 'return', reason_code: 'incomplete_financials', comment: 'Needs funding detail' },
    });
    assert.equal(returned.status, 200);
    assert.equal(returned.data.route_status, 'returned');
    const { data: opps } = await api('/api/entities/DealOpportunity/' + opp.id, { user: 'user-deal-lead' });
    assert.equal(opps.status, 'returned');
    const { data: events } = await api('/api/workflows/route/' + opp.id + '/events', { user: 'user-deal-lead' });
    assert.ok(events.some((e) => e.action === 'return' && e.comment === 'Needs funding detail'));
  });

  test('every stage action is written to the immutable audit log', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-deal-lead', body: {} });
    const { data: audit } = await api('/api/audit?entity=DealOpportunity&entity_id=' + opp.id, { user: 'user-deal-lead' });
    const actions = (audit.items || audit).map((a) => a.action);
    assert.ok(actions.includes('route_applied'), 'expected route_applied in the audit log');
    assert.ok(actions.includes('route_act'), 'expected route_act in the audit log');
  });
});

describe('Q&A loop (E8)', () => {
  test('a thread is attached to an opportunity and permissioned to participants', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    const { status, data } = await api('/api/qa/opportunities/' + opp.id + '/threads', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { subject: 'Clarify funding', body: 'Where does the funding come from?', participants: ['deal.lead@infinia.local'] },
    });
    assert.equal(status, 200);
    assert.equal(data.status, 'open');
    assert.equal(data.raised_by, 'deal.lead@sirius.local');
    const { data: threads } = await api('/api/qa/opportunities/' + opp.id + '/threads', { user: 'user-deal-lead' });
    assert.ok(threads.threads.some((x) => x.id === data.id));
  });

  test('a sibling cannot read another org thread', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    const { data: thread } = await api('/api/qa/opportunities/' + opp.id + '/threads', {
      method: 'POST', user: 'user-deal-lead', body: { subject: 'S', body: 'B' },
    });
    const read = await api('/api/qa/threads/' + thread.id, { user: 'user-finstreet-lead' });
    assert.equal(read.status, 403);
    const list = await api('/api/qa/opportunities/' + opp.id + '/threads', { user: 'user-finstreet-lead' });
    assert.equal(list.status, 403);
    const post = await api('/api/qa/threads/' + thread.id + '/messages', {
      method: 'POST', user: 'user-finstreet-lead', body: { body: 'intruding' },
    });
    assert.equal(post.status, 403);
  });

  test('a thread can require a response and records when it arrives', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    const { data: thread } = await api('/api/qa/opportunities/' + opp.id + '/threads', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { subject: 'Need the model', body: 'Please share the financial model.', requires_response: true, participants: ['deal.lead@infinia.local'] },
    });
    assert.equal(thread.awaiting_response, true);
    const { data: reply } = await api('/api/qa/threads/' + thread.id + '/messages', {
      method: 'POST', user: 'user-deal-lead', body: { body: 'Attached as v2.', is_response: true },
    });
    assert.equal(reply.is_response, true);
    const { data: detail } = await api('/api/qa/threads/' + thread.id, { user: 'user-deal-lead' });
    assert.equal(detail.response_received, true);
    assert.equal(detail.awaiting_response, false);
    const { data: list } = await api('/api/qa/my-threads', { user: 'user-sirius-deal-lead' });
    const mine = list.items.find((x) => x.id === thread.id);
    assert.ok(mine);
    assert.equal(mine.awaiting_response, false);
  });

  test('an invalid message is rejected and a closed thread refuses replies', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    const { data: thread } = await api('/api/qa/opportunities/' + opp.id + '/threads', {
      method: 'POST', user: 'user-deal-lead', body: { subject: 'S', body: 'B' },
    });
    const empty = await api('/api/qa/threads/' + thread.id + '/messages', {
      method: 'POST', user: 'user-deal-lead', body: { body: '   ' },
    });
    assert.equal(empty.status, 400);
    const closed = await api('/api/qa/threads/' + thread.id + '/close', { method: 'POST', user: 'user-deal-lead', body: {} });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.status, 'closed');
    const late = await api('/api/qa/threads/' + thread.id + '/messages', {
      method: 'POST', user: 'user-deal-lead', body: { body: 'too late' },
    });
    assert.equal(late.status, 409);
    const reopened = await api('/api/qa/threads/' + thread.id + '/reopen', { method: 'POST', user: 'user-deal-lead', body: {} });
    assert.equal(reopened.data.status, 'open');
  });

  test('opening a thread notifies the other participants', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/qa/opportunities/' + opp.id + '/threads', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { subject: 'Notify check', body: 'Ping.', participants: ['deal.lead@infinia.local'] },
    });
    const { data } = await api('/api/notifications?limit=100', { user: 'user-deal-lead' });
    assert.ok(data.items.some((n) => n.kind === 'qa_thread' && n.subject.includes('Notify check')));
  });

  test('Q&A is fully audit-logged (open, message, response, close)', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    const { data: thread } = await api('/api/qa/opportunities/' + opp.id + '/threads', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { subject: 'Audit me', body: 'Body', requires_response: true, participants: ['deal.lead@infinia.local'] },
    });
    await api('/api/qa/threads/' + thread.id + '/messages', { method: 'POST', user: 'user-deal-lead', body: { body: 'Answer', is_response: true } });
    await api('/api/qa/threads/' + thread.id + '/close', { method: 'POST', user: 'user-sirius-deal-lead', body: { comment: 'Resolved' } });
    const { data: audit } = await api('/api/qa/threads/' + thread.id + '/audit', { user: 'user-sirius-deal-lead' });
    const actions = audit.map((a) => a.action);
    for (const expected of ['thread_open', 'thread_response', 'thread_close']) {
      assert.ok(actions.includes(expected), 'expected audit action ' + expected);
    }
  });
});
