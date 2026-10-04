// UAT harness — the seven MVP user journeys (plan §4, release criteria §10.2, E11.1).
//
// Runs against a live stack (BASE_URL) and walks J1-J7 end to end using the
// same HTTP surface the SPA uses, then prints a sign-off table. Every step is
// an assertion, so a red run is the UAT evidence for defect triage (E11.2).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingGateDefaults } from '../config/qualifyingGates.js';
import { attestationDefaults } from '../config/attestations.js';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/[/]+$/, '');
const INFINIA = 'org-infinia-technologies-limited';
const FINSTREET = 'org-finstreet-limited';

let online = false;
const SCRIPT = [];
const ctx = {};

function record(id, title, status, evidence = '') {
  SCRIPT.push({ id, title, status, evidence });
}

async function api(path, { method = 'GET', body, user, form } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (!form) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: form || (body ? JSON.stringify(body) : undefined),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: res.status, data, headers: res.headers };
}

function uploadForm(requirementKey, name = 'uat-doc.txt') {
  const form = new FormData();
  form.append('requirement_key', requirementKey);
  form.append('file', new Blob(['uat ' + requirementKey], { type: 'text/plain' }), name);
  return form;
}

const FULL = {
  ...qualifyingGateDefaults(),
  attestations: attestationDefaults(),
  opportunity_name: 'UAT Digital Platform',
  opportunity_type: 'Acquisition',
  target_name: 'UAT Target LLC',
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
  // The investment-review stage requires this field on the record itself
  // (the business plan document is a separate gate requirement).
  business_plan: 'Business plan attached to the submission.',
};

async function createOpportunity(user = 'user-deal-lead', fields = FULL) {
  const { data } = await api('/api/entities/DealOpportunity', {
    method: 'POST', user, body: { status: 'draft', ...fields },
  });
  return data;
}

async function attachDocuments(id, user = 'user-deal-lead') {
  for (const key of ['business_plan', 'financials', 'cap_table']) {
    await api('/api/gate/opportunities/' + id + '/documents', { method: 'POST', user, form: uploadForm(key) });
  }
}

function act(id, user, body = {}) {
  return api('/api/workflows/route/' + id + '/act', { method: 'POST', user, body });
}

// Each journey records a sign-off row so a run reads as a UAT script sheet.
function journey(id, title, fn) {
  return async (t) => {
    if (!online) { record(id, title, 'BLOCKED', 'server offline'); return t.skip('server offline'); }
    try {
      const evidence = await fn(t);
      record(id, title, 'PASS', typeof evidence === 'string' ? evidence : '');
    } catch (err) {
      record(id, title, 'FAIL', err.message);
      throw err;
    }
  };
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) { console.warn('[uat.test] server unreachable at ' + BASE); return; }
  // Idempotent: ensure the sibling-org user exists so J6 is repeatable.
  await api('/api/org/users', {
    method: 'POST', user: 'user-admin',
    body: { id: 'user-finstreet-lead', email: 'deal.lead@finstreet.local', full_name: 'Finstreet Deal Lead' },
  });
  await api('/api/org/memberships', {
    method: 'POST', user: 'user-admin',
    body: { id: 'mem-finstreet-lead', user_id: 'user-finstreet-lead', org_id: FINSTREET, roles: ['subsidiary_deal_lead'], is_primary: true },
  });
});

after(() => {
  if (!SCRIPT.length) return;
  const line = '  ' + '-'.repeat(104);
  console.log('');
  console.log('  DealForge MVP - UAT sign-off script (plan §4, release criteria §10.2)');
  console.log(line);
  console.log('  ' + 'J'.padEnd(4) + 'Journey'.padEnd(42) + 'Result'.padEnd(9) + 'Evidence');
  console.log(line);
  for (const row of SCRIPT) {
    console.log('  ' + row.id.padEnd(4) + row.title.slice(0, 40).padEnd(42) + row.status.padEnd(9) + row.evidence.slice(0, 46));
  }
  console.log(line);
  const failed = SCRIPT.filter((r) => r.status === 'FAIL').length;
  const blocked = SCRIPT.filter((r) => r.status === 'BLOCKED').length;
  const summary = failed
    ? failed + ' journey(s) FAILED - raise defects and re-run after fixes'
    : blocked
      ? 'journeys BLOCKED (server offline)'
      : 'J1-J7 all PASS - MVP release criteria §10.2 met';
  console.log('  ' + summary);
  console.log('  Sign-off pending: Sirius product owner + investment team (plan §14 RACI).');
  console.log('');
});

describe('UAT golden path (J1-J5)', () => {
  test('[J1] a subsidiary submits a real opportunity end to end', journey(
    'J1', 'Subsidiary submits a real opportunity', async () => {
      const opp = await createOpportunity();
      assert.ok(opp && opp.id, 'opportunity was not created');
      ctx.oppId = opp.id;
      await attachDocuments(opp.id);
      const gate = await api('/api/gate/opportunities/' + opp.id + '/status', { user: 'user-deal-lead' });
      assert.equal(gate.status, 200);
      assert.equal(gate.data.gate.complete, true, 'the document gate must be satisfied');
      const applied = await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
      assert.equal(applied.status, 200);
      const prepare = await act(opp.id, 'user-deal-lead', {});
      assert.equal(prepare.status, 200, JSON.stringify(prepare.data));
      const sign = await act(opp.id, 'user-cfo', { action: 'sign' });
      assert.equal(sign.status, 200, JSON.stringify(sign.data));
      const afterSubmit = await api('/api/entities/DealOpportunity/' + opp.id, { user: 'user-deal-lead' });
      assert.equal(afterSubmit.data.status, 'submission', 'submission must land in Submission');
      const bundle = await api('/api/workflows/route/' + opp.id, { user: 'user-deal-lead' });
      const signStage = bundle.data.stages.find((s) => s.requires_signature);
      assert.equal(signStage.status, 'complete');
      assert.ok(bundle.data.participants.some((p) => p.signed_at), 'signature must be captured with a time');
      return 'state=submission - CFO signature captured - gate complete';
    }));

  test('[J2] a raw idea without the mandatory documents is blocked', journey(
    'J2', 'Raw idea blocked with a precise missing list', async () => {
      const opp = await createOpportunity('user-deal-lead', { opportunity_name: 'UAT raw idea' });
      assert.ok(opp && opp.id);
      const blocked = await api('/api/gate/opportunities/' + opp.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
      assert.equal(blocked.status, 422);
      assert.ok(Array.isArray(blocked.data.gate?.missing) && blocked.data.gate.missing.length > 0, 'a precise missing list is required');
      const afterBlock = await api('/api/entities/DealOpportunity/' + opp.id, { user: 'user-deal-lead' });
      assert.equal(afterBlock.data.status, 'draft', 'nothing enters the pipeline');
      const audit = await api('/api/audit?entity=DealOpportunity&entity_id=' + opp.id, { user: 'user-admin' });
      assert.ok(audit.data.some((e) => e.action === 'submit_blocked'), 'the block is audited');
      return blocked.data.gate.missing.length + ' item(s) missing - stayed draft - audited';
    }));

  test('[J3] an out-of-theme submission requires a reasoned exception', journey(
    'J3', 'Theme exception requires a reason', async () => {
      const opp = await createOpportunity('user-deal-lead', {
        ...FULL,
        opportunity_name: 'UAT hotel portfolio',
        target_name: 'ResortCo Hotels',
        sector: 'Hospitality',
        geography: 'Qatar',
        // Deliberately avoids the theme keywords so the submission is flagged.
        narrative_what: 'Buy a coastal hotel portfolio.',
        narrative_why_now: 'Tourism spend keeps growing in the region.',
        narrative_why_us: 'We already operate resorts in two markets.',
        decision_sought: 'Approve diligence on the hotel portfolio.',
        business_plan: 'Hotel portfolio plan attached.',
      });
      const align = await api('/api/pipeline/opportunities/' + opp.id + '/alignment', { user: 'user-deal-lead' });
      assert.equal(align.data.alignment.aligned, false, 'the submission must be flagged as misaligned');
      assert.ok(align.data.alignment.reasons.length > 0);
      const short = await api('/api/themes/exceptions/' + opp.id, {
        method: 'POST', user: 'user-deal-lead', body: { reason: 'too short' },
      });
      assert.equal(short.status, 400, 'a token reason must be rejected');
      const ok = await api('/api/themes/exceptions/' + opp.id, {
        method: 'POST', user: 'user-deal-lead',
        body: { reason: 'Hospitality synergy with the existing resort arm; IRR above the hurdle.' },
      });
      assert.equal(ok.status, 200);
      const history = await api('/api/themes/exceptions/' + opp.id + '/history', { user: 'user-deal-lead' });
      assert.ok(history.data.some((e) => e.action === 'theme_exception'), 'the exception is on the audit log');
      return 'flagged - reasoned exception recorded and audited';
    }));

  test('[J4] Sirius screens and clarifies in-thread', journey(
    'J4', 'Screening clarification in-thread', async () => {
      assert.ok(ctx.oppId, 'J1 must run first');
      const toScreen = await api('/api/pipeline/opportunities/' + ctx.oppId + '/transition', {
        method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' },
      });
      assert.equal(toScreen.status, 200, JSON.stringify(toScreen.data));
      assert.equal(toScreen.data.state, 'screening');
      const thread = await api('/api/qa/opportunities/' + ctx.oppId + '/threads', {
        method: 'POST', user: 'user-sirius-deal-lead',
        body: {
          subject: 'Clarify the synergy case',
          body: 'Please share the detailed synergy plan and refreshed financials.',
          requires_response: true,
          participants: ['deal.lead@infinia.local'],
        },
      });
      assert.equal(thread.status, 200, JSON.stringify(thread.data));
      ctx.threadId = thread.data.id;
      const state = await api('/api/entities/DealOpportunity/' + ctx.oppId, { user: 'user-deal-lead' });
      assert.equal(state.data.status, 'screening', 'the item stays in Screening until the thread resolves');
      const notes = await api('/api/notifications?all=1&channels=all&limit=300', { user: 'user-admin' });
      const notified = notes.data.items.find((n) => n.entity_id === ctx.oppId && n.recipient_email === 'deal.lead@infinia.local');
      assert.ok(notified, 'the subsidiary must be notified of the clarification');
      return 'thread open - subsidiary notified - state=screening';
    }));

  test('[J5] refinement to leadership to IC, with a return leg', journey(
    'J5', 'Refinement > leadership > IC (+return)', async () => {
      assert.ok(ctx.oppId, 'J1 must run first');
      await act(ctx.oppId, 'user-sirius-deal-lead', {});
      await act(ctx.oppId, 'user-sirius-deal-lead', {});
      const leadership = await act(ctx.oppId, 'user-fahad', { comment: 'Leadership approves; proceed to IC.' });
      assert.equal(leadership.status, 200, JSON.stringify(leadership.data));
      const afterLeadership = await api('/api/entities/DealOpportunity/' + ctx.oppId, { user: 'user-deal-lead' });
      assert.equal(afterLeadership.data.status, 'approval');
      const noRationale = await act(ctx.oppId, 'user-ic', {});
      assert.equal(noRationale.status, 422, 'the IC stage must demand a rationale');
      assert.ok(noRationale.data.missing.includes('rationale'));
      const ic = await act(ctx.oppId, 'user-ic', { reason_code: 'returns_above_hurdle', comment: 'IC approves with conditions.' });
      assert.equal(ic.status, 200, JSON.stringify(ic.data));
      assert.equal(ic.data.route_status, 'complete');
      const events = await api('/api/workflows/route/' + ctx.oppId + '/events', { user: 'user-deal-lead' });
      const stages = new Set(events.data.map((e) => e.stage_key));
      for (const s of ['investment_review', 'refinement', 'leadership_approve', 'ic_approve']) {
        assert.ok(stages.has(s), 'missing workflow event for ' + s);
      }
      assert.ok(events.data.every((e) => e.actor_email && e.created_at), 'every event carries an actor and a time');
      // Return-for-revision leg on a fresh opportunity. Extension of the journey.
      const back = await createOpportunity();
      await attachDocuments(back.id);
      await api('/api/workflows/apply/' + back.id, { method: 'POST', user: 'user-deal-lead' });
      await act(back.id, 'user-deal-lead', {});
      await act(back.id, 'user-cfo', { action: 'sign' });
      const ret = await act(back.id, 'user-sirius-deal-lead', { action: 'return', reason_code: 'unclear_synergy_case', comment: 'Clarify the funding plan.' });
      assert.equal(ret.status, 200, JSON.stringify(ret.data));
      const backState = await api('/api/entities/DealOpportunity/' + back.id, { user: 'user-deal-lead' });
      assert.equal(backState.data.status, 'returned', 'a return drops the item to the producing layer');
      return 'leadership+IC decisions logged - rationale enforced - return leg OK';
    }));
});

describe('UAT sibling privacy (J6)', () => {
  test('[J6] a sibling is denied at every layer and the attempt is logged', journey(
    'J6', 'Sibling denied at every layer, logged', async () => {
      assert.ok(ctx.oppId, 'J1 must run first');
      const sibling = 'user-finstreet-lead';
      const probes = await Promise.all([
        api('/api/entities/DealOpportunity/' + ctx.oppId, { user: sibling }),
        api('/api/gate/opportunities/' + ctx.oppId + '/documents', { user: sibling }),
        api('/api/pipeline/opportunities/' + ctx.oppId + '/alignment', { user: sibling }),
        api('/api/qa/opportunities/' + ctx.oppId + '/threads', { user: sibling }),
        api('/api/workflows/route/' + ctx.oppId + '/events', { user: sibling }),
        api('/api/related-party/opportunities/' + ctx.oppId, { user: sibling }),
      ]);
      probes.forEach((p, i) => assert.equal(p.status, 403, 'probe ' + (i + 1) + ' expected 403, got ' + p.status));
      // The object-store gateway enforces the same org scope when ObjectIO is wired.
      const health = await api('/api/health', {});
      let storageNote = 'ObjectIO not configured on this stack';
      if (health.data?.storage?.mode === 's3') {
        const file = await api('/api/files/org/' + INFINIA + '/uat-missing.pdf', { user: sibling });
        assert.equal(file.status, 403, 'the files gateway must deny a cross-org key');
        storageNote = 'object gateway denied too';
      }
      const trail = await api('/api/audit?entity=access_control&limit=300', { user: 'user-admin' });
      const logged = trail.data.filter((e) => e.action === 'access_denied' && e.actor_email === 'deal.lead@finstreet.local');
      assert.ok(logged.length >= 1, 'the denied attempt must be written to the audit trail');
      return probes.length + ' layers denied - ' + logged.length + ' denial event(s) audited - ' + storageNote;
    }));
});

describe('UAT audit trail (J7)', () => {
  test('[J7] the audit trail proves who/what/when for the golden path', journey(
    'J7', 'Audit proves the trail', async () => {
      assert.ok(ctx.oppId, 'J1 must run first');
      const trail = await api('/api/audit?entity=DealOpportunity&entity_id=' + ctx.oppId, { user: 'user-admin' });
      assert.equal(trail.status, 200);
      assert.ok(trail.data.length > 0, 'the opportunity must have an audit trail');
      const actions = new Set(trail.data.map((e) => e.action));
      for (const a of ['create', 'route_act']) assert.ok(actions.has(a), 'missing audit action ' + a);
      for (const e of trail.data) {
        assert.ok(e.actor_email, 'an audit row lacks an actor');
        assert.ok(e.ts, 'an audit row lacks a timestamp');
      }
      const mutate = await api('/api/entities/audit_event/' + trail.data[0].id, {
        method: 'PATCH', user: 'user-admin', body: { action: 'tampered' },
      });
      assert.ok(mutate.status >= 400, 'audit rows must not be mutable through the API');
      return trail.data.length + ' immutable events - actor+time on each';
    }));
});
