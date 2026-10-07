// M5 integration tests — approval path (E9) and sibling-privacy hardening (E2).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingGateDefaults } from '../config/qualifyingGates.js';
import { attestationDefaults } from '../config/attestations.js';
import { withAttestationSigning } from './support/attestationSigning.js';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/[/]+$/, '');
const SIRIUS = 'org-sirius-international-holding-limited';
const FINSTREET = 'org-finstreet-limited';

let online = false;

async function rawApi(path, { method = 'GET', body, user, form } = {}) {
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
const api = withAttestationSigning(rawApi);

const FULL_FIELDS = {
  ...qualifyingGateDefaults(),
  attestations: attestationDefaults(),
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

// Walk the standard route up to (but not including) the leadership stage.
async function routedToLeadership(fields = FULL_FIELDS) {
  const opp = await makeOpportunity('user-deal-lead', fields);
  await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
  await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-deal-lead', body: {} });
  await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-cfo', body: { action: 'sign' } });
  await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-sirius-deal-lead', body: {} });
  await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-sirius-deal-lead', body: {} });
  return opp;
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) { console.warn('[m5.test] server unreachable at ' + BASE); return; }
  // Idempotent: ensure the sibling-org user exists for the privacy tests.
  await api('/api/org/users', {
    method: 'POST', user: 'user-admin',
    body: { id: 'user-finstreet-lead', email: 'deal.lead@finstreet.local', full_name: 'Finstreet Deal Lead' },
  });
  await api('/api/org/memberships', {
    method: 'POST', user: 'user-admin',
    body: { id: 'mem-finstreet-lead', user_id: 'user-finstreet-lead', org_id: FINSTREET, roles: ['subsidiary_deal_lead'], is_primary: true },
  });
});

describe('approval path stages (E9.1/E9.2/E9.3)', () => {
  test('the default route adds refinement, leadership and IC stages', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/workflows?org_id=' + SIRIUS, { user: 'user-admin' });
    assert.equal(status, 200);
    const wf = data.workflows.find((w) => w.is_default) || data.workflows[0];
    const keys = wf.stages.map((s) => s.stage_key);
    for (const key of ['refinement', 'leadership_approve', 'ic_approve']) {
      assert.ok(keys.includes(key), 'expected stage ' + key);
    }
    const ordered = wf.stages.map((s) => s.sort_order);
    assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
    const ic = wf.stages.find((s) => s.stage_key === 'ic_approve');
    assert.equal(ic.requires_rationale, true, 'the IC stage must require a rationale');
    const leadership = wf.stages.find((s) => s.stage_key === 'leadership_approve');
    assert.ok((leadership.roles || []).includes('leadership'), 'leadership role must own the leadership stage');
  });

  test('Fahad and AJ hold the leadership role', async (t) => {
    if (!online) return t.skip('server offline');
    for (const user of ['user-fahad', 'user-aj']) {
      const { data } = await api('/api/org/me', { user });
      assert.ok((data.roles || []).includes('leadership'), user + ' must hold the leadership role');
    }
  });

  test('leadership approves onto the IC stage, and Fahad or AJ may act', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await routedToLeadership();
    const { data: map } = await api('/api/workflows/signature-map/' + opp.id, { user: 'user-deal-lead' });
    assert.equal(map.current_stage, 'leadership_approve');
    const leadership = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-fahad', body: { comment: 'Leadership endorses.' },
    });
    assert.equal(leadership.status, 200);
    assert.equal(leadership.data.next_stage, 'ic_approve');
    assert.equal(leadership.data.decision, 'approve');

    const opp2 = await routedToLeadership();
    const aj = await api('/api/workflows/route/' + opp2.id + '/act', {
      method: 'POST', user: 'user-aj', body: { comment: 'Approved.' },
    });
    assert.equal(aj.status, 200);
    assert.equal(aj.data.next_stage, 'ic_approve');
  });

  test('a reviewer who lacks the leadership role cannot approve it', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await routedToLeadership();
    const denied = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-sirius-deal-lead', body: {},
    });
    assert.equal(denied.status, 403);
  });

  test('the IC stage rejects completion without a rationale', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await routedToLeadership();
    await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-fahad', body: { comment: 'Endorsed.' },
    });
    const missing = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-ic', body: {},
    });
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.data.missing, ['rationale']);
    const decided = await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-ic', body: { reason_code: 'returns_above_hurdle', comment: 'Approved: within mandate and priced well.' },
    });
    assert.equal(decided.status, 200);
    assert.equal(decided.data.decision, 'approve');
    assert.equal(decided.data.route_status, 'complete');
  });

  test('the rationale and decision are recorded on the event log', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await routedToLeadership();
    await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user: 'user-fahad', body: { comment: 'OK.' } });
    await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-ic', body: { reason_code: 'returns_above_hurdle', comment: 'Cleared by IC.' },
    });
    const { data: events } = await api('/api/workflows/route/' + opp.id + '/events', { user: 'user-deal-lead' });
    const ic = events.find((e) => e.stage_key === 'ic_approve');
    assert.ok(ic, 'expected an IC event');
    assert.equal(ic.decision, 'approve');
    assert.equal(ic.comment, 'Cleared by IC.');
  });

  test('the approval route (Phase 2) never moves the Gate-1 lifecycle (WF-01)', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity();
    await api('/api/workflows/apply/' + opp.id, { method: 'POST', user: 'user-deal-lead' });
    const steps = [
      ['user-deal-lead', {}], ['user-cfo', { action: 'sign' }], ['user-sirius-deal-lead', {}],
      ['user-sirius-deal-lead', {}], ['user-fahad', { comment: 'Approved.' }],
    ];
    for (const [user, body] of steps) {
      await api('/api/workflows/route/' + opp.id + '/act', { method: 'POST', user, body });
      const after = await api('/api/entities/DealOpportunity/' + opp.id, { user: 'user-deal-lead' });
      assert.equal(after.data.status, 'draft', 'only the screening workflow changes the state');
    }
  });
});

describe('email + SMS notifications (E9.4)', () => {
  test('a decision records in-app, email and SMS channel rows', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await routedToLeadership();
    await api('/api/workflows/route/' + opp.id + '/act', {
      method: 'POST', user: 'user-fahad', body: { comment: 'Leadership approves.' },
    });
    const { data } = await api('/api/notifications?all=1&channels=all&limit=200', { user: 'user-admin' });
    const rows = data.items.filter((n) => n.entity_id === opp.id);
    const channels = new Set(rows.map((n) => n.channel));
    assert.ok(channels.has('in_app'), 'expected an in-app row');
    assert.ok(channels.has('email'), 'expected an email row');
    assert.ok(channels.has('sms'), 'expected an sms row');
    const email = rows.find((n) => n.channel === 'email');
    assert.ok(email.status, 'an email row must record a delivery status');
    assert.ok(email.attempted_at, 'an email row must record the attempt time');
    const sms = rows.find((n) => n.channel === 'sms');
    assert.ok(sms.phone, 'an sms row must record the target number');
  });

  test('only an admin may read every inbox', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/notifications?all=1', { user: 'user-deal-lead' });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/notifications?all=1', { user: 'user-admin' });
    assert.equal(allowed.status, 200);
  });
});

describe('related-party flag (E9.5)', () => {
  test('an affiliate referral channel is detected as related', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity('user-deal-lead', { ...FULL_FIELDS, sourcing_channel: 'ihc_affiliate_referral' });
    const { status, data } = await api('/api/related-party/opportunities/' + opp.id, { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.equal(data.flagged, true);
    assert.ok(String(data.detection.detection_basis).includes('ihc_affiliate_referral'));
    assert.equal(data.flagged, data.detection.flagged);
  });

  test('a flagged deal requires a disclosure before it is recorded', async (t) => {
    if (!online) return t.skip('server offline');
    const opp = await makeOpportunity('user-deal-lead', { ...FULL_FIELDS, sourcing_channel: 'ihc_affiliate_referral' });
    const blocked = await api('/api/related-party/opportunities/' + opp.id, {
      method: 'PUT', user: 'user-deal-lead', body: {},
    });
    assert.equal(blocked.status, 422);
    assert.deepEqual(blocked.data.missing, ['disclosure']);
    const saved = await api('/api/related-party/opportunities/' + opp.id, {
      method: 'PUT', user: 'user-deal-lead',
      body: {
        disclosure: 'Sourced via an IHC affiliate; pricing benchmarked externally.',
        independent_reviewer_email: 'reviewer@sirius.local',
        arm_length_basis: 'market_benchmarking',
        arm_length_note: 'Benchmarked against comparable third-party transactions.',
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.flagged, true);
    assert.equal(saved.data.review.independent_reviewer_email, 'reviewer@sirius.local');
    assert.equal(saved.data.review.independent_reviewer_name, 'Independent Reviewer');
  });

  test('the sourcing-channel list exposes the five gate channels', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/related-party/channels', { user: 'user-deal-lead' });
    assert.equal(data.channels.length, 5);
    assert.ok(data.flagged_channels.includes('ihc_affiliate_referral'));
  });
});

describe('sibling-privacy hardening (E2.4/E2.6)', () => {
  let oppId;
  let threadId;

  before(async () => {
    if (!online) return;
    const opp = await makeOpportunity();
    oppId = opp.id;
    await api('/api/workflows/apply/' + oppId, { method: 'POST', user: 'user-deal-lead' });
    const { data: thread } = await api('/api/qa/opportunities/' + oppId + '/threads', {
      method: 'POST', user: 'user-deal-lead', body: { subject: 'Private', body: 'Body' },
    });
    threadId = thread.id;
  });

  test('a sibling cannot read a thread audit trail', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/qa/threads/' + threadId + '/audit', { user: 'user-finstreet-lead' });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/qa/threads/' + threadId + '/audit', { user: 'user-deal-lead' });
    assert.equal(allowed.status, 200);
  });

  test('a sibling cannot read another org pipeline transitions', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/pipeline/opportunities/' + oppId + '/transitions', { user: 'user-finstreet-lead' });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/pipeline/opportunities/' + oppId + '/transitions', { user: 'user-deal-lead' });
    assert.equal(allowed.status, 200);
  });

  test('a sibling cannot read another org route events', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/workflows/route/' + oppId + '/events', { user: 'user-finstreet-lead' });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/workflows/route/' + oppId + '/events', { user: 'user-deal-lead' });
    assert.equal(allowed.status, 200);
  });

  test('a sibling cannot read another org related-party review', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/related-party/opportunities/' + oppId, { user: 'user-finstreet-lead' });
    assert.equal(denied.status, 403);
  });

  test('a sibling cannot be added as a Q&A participant on another org thread', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/qa/opportunities/' + oppId + '/threads', {
      method: 'POST', user: 'user-deal-lead',
      body: { subject: 'Cross-org', body: 'Body', participants: ['deal.lead@finstreet.local'] },
    });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/qa/opportunities/' + oppId + '/threads', {
      method: 'POST', user: 'user-deal-lead',
      body: { subject: 'In-org', body: 'Body', participants: ['cfo@infinia.local'] },
    });
    assert.equal(allowed.status, 200);
  });
});
