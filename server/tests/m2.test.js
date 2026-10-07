// ---------------------------------------------------------------------------
// M2 integration tests — capture + document gate (E3/E4, REQ-DOCGATE-01).
//
// Runs against a live DealForge server:
//   BASE_URL=http://localhost:34000 node --test server/tests/m2.test.js
//
// Skips (rather than fails) when the server is unreachable.
// ---------------------------------------------------------------------------
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingGateDefaults } from '../config/qualifyingGates.js';
import { attestationDefaults } from '../config/attestations.js';
import {
  statementTemplateCsv, statementTemplateRows,
} from '../config/statementModel.js';
import { WACC_OVERRIDE_REASON_MESSAGE } from '../config/wacc.js';
import { withAttestationSigning } from './support/attestationSigning.js';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');

let online = false;

async function rawApi(path, { method = 'GET', body, user, form } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (!form) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const api = withAttestationSigning(rawApi);

function uploadForm(requirementKey, name = 'doc.txt', content = 'hello') {
  const form = new FormData();
  form.append('requirement_key', requirementKey);
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  return form;
}

const FULL_FIELDS = {
  ...qualifyingGateDefaults(),
  attestations: attestationDefaults(),
  opportunity_name: 'Infinia Solar JV',
  opportunity_type: 'M&A',
  target_name: 'SolarCo LLC',
  sector: 'Energy',
  geography: 'UAE',
  total_commitment_aed: 120,
  ask_aed: 60,
  funding_source: 'Balance sheet',
  in_approved_budget: 'yes',
  target_signing_close: '2027-03',
  sourcing_channel: 'proprietary',
  narrative_what: 'Acquire a solar EPC platform.',
  narrative_why_now: 'Feed-in tariffs are opening.',
  narrative_why_us: 'We already operate the grid connection.',
  decision_sought: 'Approval to proceed to diligence.',
};

async function createDraft(user = 'user-deal-lead', extra = {}) {
  const { data } = await api('/api/entities/DealOpportunity', {
    method: 'POST', user, body: { status: 'draft', ...extra },
  });
  return data;
}

async function submitPayloadDraft(user = 'user-deal-lead') {
  const draft = await createDraft(user, FULL_FIELDS);
  for (const key of ['business_plan', 'financials', 'cap_table']) {
    await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user, form: uploadForm(key, key + '.txt', 'content-' + key),
    });
  }
  return draft;
}

before(async () => {
  try {
    const res = await fetch(BASE + '/api/health');
    online = res.ok;
  } catch {
    online = false;
  }
  if (!online) console.warn(`[m2.test] server not reachable at ${BASE} — tests will be skipped`);
  // Ensure a sibling-org user exists so the privacy tests are self-contained
  // (idempotent with the m1 suite).
  if (online) {
    await api('/api/org/users', {
      method: 'POST', user: 'user-admin',
      body: { id: 'user-finstreet-lead', email: 'deal.lead@finstreet.local', full_name: 'Finstreet Deal Lead' },
    });
    await api('/api/org/memberships', {
      method: 'POST', user: 'user-admin',
      body: { id: 'mem-finstreet-lead', user_id: 'user-finstreet-lead', org_id: 'org-finstreet-limited', roles: ['subsidiary_deal_lead'], is_primary: true },
    });
  }
});

describe('document requirement config', () => {
  test('exposes the default minimum-document set', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/requirements', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const keys = data.requirements.map((r) => r.key);
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      assert.ok(keys.includes(key), 'expected requirement ' + key);
    }
  });

  test('a non-admin cannot edit the requirement set', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/gate/requirements', {
      method: 'POST', user: 'user-deal-lead',
      body: { key: 'hack', label: 'Hack' },
    });
    assert.equal(status, 403);
  });
});

describe('document gate blocks an incomplete submission (J2)', () => {
  let draft;

  before(async () => {
    if (!online) return;
    draft = await createDraft('user-deal-lead', { opportunity_name: 'Raw idea' });
  });

  test('status reports field and document gaps', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.equal(data.gate.complete, false);
    const missingTypes = new Set(data.gate.missing.map((m) => m.type));
    assert.ok(missingTypes.has('field'));
    assert.ok(missingTypes.has('document'));
    assert.ok(data.gate.missing.some((m) => m.key === 'business_plan'));
  });

  test('submit is blocked with 422 and a precise missing list', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api(`/api/gate/opportunities/${draft.id}/submit`, {
      method: 'POST', user: 'user-deal-lead',
    });
    assert.equal(status, 422);
    assert.ok(Array.isArray(data.gate.missing) && data.gate.missing.length > 0);
  });

  test('the opportunity stays in draft after a blocked submit', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(data.status, 'draft');
  });

  test('the blocked attempt is audited', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api(`/api/audit?entity=DealOpportunity&entity_id=${draft.id}`, { user: 'user-admin' });
    assert.ok(data.some((e) => e.action === 'submit_blocked'));
  });
});

describe('complete submission passes the gate (J1)', () => {
  test('uploads, gate completeness and submission succeed', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await submitPayloadDraft('user-deal-lead');

    const before = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    assert.equal(before.data.gate.complete, true, 'gate should be complete after fields + docs');
    assert.equal(before.data.gate.completeness, 100);

    const submit = await api(`/api/gate/opportunities/${draft.id}/submit`, {
      method: 'POST', user: 'user-deal-lead',
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.data.state, 'screening_review');

    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'screening_review');
    assert.ok(after.data.submitted_at);
  });

  test('resubmitting a submitted opportunity is rejected (409)', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await submitPayloadDraft('user-deal-lead');
    await api(`/api/gate/opportunities/${draft.id}/submit`, { method: 'POST', user: 'user-deal-lead' });
    const again = await api(`/api/gate/opportunities/${draft.id}/submit`, { method: 'POST', user: 'user-deal-lead' });
    assert.equal(again.status, 409);
  });
});

describe('versioned documents (E4.4)', () => {
  test('re-uploading a requirement supersedes the previous version', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead');
    const first = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead', form: uploadForm('business_plan', 'v1.txt', 'one'),
    });
    assert.equal(first.data.version, 1);
    assert.ok(first.data.sha256);

    const second = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead', form: uploadForm('business_plan', 'v2.txt', 'two'),
    });
    assert.equal(second.data.version, 2);

    const list = await api(`/api/gate/opportunities/${draft.id}/documents`, { user: 'user-deal-lead' });
    const current = list.data.filter((d) => d.requirement_key === 'business_plan' && d.is_current);
    assert.equal(current.length, 1);
    assert.equal(current[0].version, 2);
  });
});

describe('document-gate privacy (sibling hard-isolation)', () => {
  let draft;
  let doc;
  before(async () => {
    if (!online) return;
    draft = await createDraft('user-deal-lead');
    const up = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead', form: uploadForm('business_plan', 'secret.txt', 'secret'),
    });
    doc = up.data;
  });

  test('a sibling cannot view another org opportunity documents (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/gate/opportunities/${draft.id}/documents`, { user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });

  test('a sibling cannot upload to another org opportunity (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-finstreet-lead', form: uploadForm('business_plan', 'evil.txt', 'evil') ,
    });
    assert.equal(status, 403);
  });

  test('a sibling cannot submit another org opportunity (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api(`/api/gate/opportunities/${draft.id}/submit`, {
      method: 'POST', user: 'user-finstreet-lead',
    });
    assert.equal(status, 403);
  });

  test('a sibling cannot delete another org document (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/gate/documents/' + doc.id, { method: 'DELETE', user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });

  test('the owner can still read its own documents', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api(`/api/gate/opportunities/${draft.id}/documents`, { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.some((d) => d.id === doc.id));
  });
});

describe('pre-form self-screen gate (W1-01 / INT-02)', () => {
  test('the self-screen endpoint reports the decision and stop reasons', async (t) => {
    if (!online) return t.skip('server offline');
    const stop = await api('/api/gate/self-screen', {
      method: 'POST', user: 'user-deal-lead',
      body: { opportunity_type: 'passive_punt', total_commitment_aed: 25, sector: 'Industrials', geography: 'UAE', in_approved_budget: 'yes', related_party: 'no' },
    });
    assert.equal(stop.status, 200);
    assert.equal(stop.data.decision, 'stop');
    assert.ok(stop.data.stops.some((s) => s.code === 'outside_appetite'));

    const pass = await api('/api/gate/self-screen', {
      method: 'POST', user: 'user-deal-lead',
      body: { opportunity_type: 'strategic_acquisition', total_commitment_aed: 120, sector: 'Technology', geography: 'UAE', in_approved_budget: 'yes', related_party: 'no' },
    });
    assert.equal(pass.data.decision, 'pass');
  });

  test('gate status surfaces the saved self-screen decision', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, opportunity_type: 'passive_punt' });
    const { data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    assert.equal(data.gate.self_screen.decision, 'stop');
    assert.equal(data.gate.self_screen.blocked, true);
  });

  test('an outside-appetite opportunity cannot be submitted even when complete', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, opportunity_type: 'passive_punt' });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api(`/api/gate/opportunities/${draft.id}/documents`, {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api(`/api/gate/opportunities/${draft.id}/submit`, { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    assert.match(res.data.error, /self-screen/i);
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'draft');
  });

  test('a below-floor case passes only with the exception route', async (t) => {
    if (!online) return t.skip('server offline');
    const stopped = await api('/api/gate/self-screen', {
      method: 'POST', user: 'user-deal-lead',
      body: { opportunity_type: 'bolt_on', total_commitment_aed: 6, sector: 'Technology', geography: 'UAE', in_approved_budget: 'yes', related_party: 'no' },
    });
    assert.equal(stopped.data.decision, 'stop');
    assert.ok(stopped.data.stops.some((s) => s.code === 'below_floor'));

    const excepted = await api('/api/gate/self-screen', {
      method: 'POST', user: 'user-deal-lead',
      body: { opportunity_type: 'bolt_on', total_commitment_aed: 6, sector: 'Technology', geography: 'UAE', in_approved_budget: 'yes', related_party: 'no', below_floor_exception: true },
    });
    assert.equal(excepted.data.decision, 'pass_with_flags');
    assert.ok(excepted.data.flags.some((f) => f.code === 'below_floor_exception'));
  });
});


describe('below-floor exception route (W1-02 / INT-03)', () => {
  test('a sub-floor draft without the exception cannot be submitted', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, total_commitment_aed: 6 });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    // With no exception chosen the pre-form self-screen halts first (W1-01) with
    // the below-floor reason; the exception route (W1-02) is the way past it.
    assert.ok(res.data.self_screen.stops.some((s) => s.code === 'below_floor'));
    assert.equal(res.data.gate.below_floor.applies, true);
    assert.equal(res.data.gate.below_floor.satisfied, false);
  });

  test('a sub-floor exception without the synergy and IRR is refused', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, total_commitment_aed: 6, below_floor_exception: true, return_irr_base: 30,
    });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    assert.ok(res.data.below_floor.stops.some((s) => s.code === 'synergy_required' || s.code === 'irr_required'));
  });

  test('a qualifying below-floor case submits, is tagged and escalated', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, total_commitment_aed: 6, below_floor_exception: true,
      below_floor_synergy_case: 'Shared payments rail removes AED 4mn of run-rate cost.', return_irr_base: 35,
    });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    assert.equal(res.data.state, 'screening_review');
    assert.equal(res.data.below_floor.satisfied, true);

    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.below_floor_exception, true);
    assert.equal(after.data.below_floor_tag, 'below_floor_exception');
    assert.equal(after.data.below_floor_escalated, true);
  });
});

describe('CEO + CFO attestation gate (W1-06 / INT-09)', () => {
  test('a complete draft without attestations is refused and stays draft', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, attestations: {} });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    assert.match(res.data.error, /CEO and CFO attestations/i);
    assert.deepEqual(res.data.attestations.missing, ['ceo', 'cfo']);
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'draft');
  });

  test('the CEO records one attestation with a timestamp and IP; the other still blocks', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, attestations: {} });
    const signed = await api('/api/gate/opportunities/' + draft.id + '/attestations/ceo', {
      method: 'POST', user: 'user-ceo',
    });
    assert.equal(signed.status, 201);
    assert.equal(signed.data.record.role, 'subsidiary_ceo');
    assert.ok(signed.data.record.at, 'a timestamp is captured');
    assert.ok(signed.data.record.ip, 'an IP is captured');
    assert.deepEqual(signed.data.attestations.missing, ['cfo']);

    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    assert.deepEqual(res.data.attestations.missing, ['cfo']);
  });

  test('a non-CEO may not record the CEO attestation', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, attestations: {} });
    const res = await api('/api/gate/opportunities/' + draft.id + '/attestations/ceo', {
      method: 'POST', user: 'user-deal-lead',
    });
    assert.equal(res.status, 403);
  });

  test('both attestations let a complete draft submit, each audited', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, attestations: {} });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    await api('/api/gate/opportunities/' + draft.id + '/attestations/ceo', { method: 'POST', user: 'user-ceo' });
    const cfo = await api('/api/gate/opportunities/' + draft.id + '/attestations/cfo', { method: 'POST', user: 'user-cfo' });
    assert.equal(cfo.status, 201);
    assert.equal(cfo.data.attestations.complete, true);

    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.state, 'screening_review');

    const audit = await api('/api/audit?entity=DealOpportunity&entity_id=' + draft.id, { user: 'user-admin' });
    assert.equal(audit.data.filter((e) => e.action === 'attestation_recorded').length, 2, 'each attestation is audited');
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.ok(after.data.attestations?.ceo, 'the CEO attestation is persisted');
    assert.ok(after.data.attestations?.cfo, 'the CFO attestation is persisted');
  });
});

describe('greenfield extra tests (W1-07 / INT-10)', () => {
  const GREENFIELD_BASE = {
    ...FULL_FIELDS,
    opportunity_type: 'greenfield',
    total_commitment_aed: 90,
    funding_source: 'Sirius balance sheet',
    greenfield_benefit: 'Opens a new recurring-revenue platform before the window closes.',
    greenfield_secured_funding_source: 'Sirius balance sheet',
    funding_sources_status: 'secured',
    budget_status: 'in_budget',
  };
  async function uploadRequiredDocs(id, user = 'user-deal-lead') {
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + id + '/documents', {
        method: 'POST', user, form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
  }

  test('a greenfield without a secured funding source is refused and stays draft', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...GREENFIELD_BASE,
      greenfield_stage: 'feasibility',
      greenfield_secured_funding_source: '',
      funding_sources_status: 'indicative',
    });
    await uploadRequiredDocs(draft.id);
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    assert.equal(res.data.greenfield.satisfied, false);
    const codes = res.data.greenfield.stops.map((s) => s.code);
    assert.ok(codes.includes('funding_not_secured'), 'names the unsecured funding');
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'draft');
  });

  test('a Concept-stage greenfield needs no full document pack and may submit', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...GREENFIELD_BASE, greenfield_stage: 'concept' });
    const status = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status.data.gate.greenfield.documents_required, false, 'Concept waives the full pack');
    assert.equal(status.data.gate.complete, true, 'no document gate at Concept');

    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.state, 'screening_review');
  });

  test('a Feasibility-stage greenfield does need the full document pack', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...GREENFIELD_BASE, greenfield_stage: 'feasibility' });
    const status = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status.data.gate.greenfield.documents_required, true, 'Feasibility requires the pack');
    assert.equal(status.data.gate.complete, false, 'missing documents still block');
  });

  test('a non-greenfield opportunity is unaffected by the greenfield tests', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, opportunity_type: 'strategic_acquisition' });
    const status = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status.data.gate.greenfield, null, 'the tests do not apply');
  });
});


describe('sourcing-channel side-effects (W1-08 / INT-05)', () => {
  test('the channel is mandatory: a draft without it is refused', async (t) => {
    if (!online) return t.skip('server offline');
    const noChannel = { ...FULL_FIELDS };
    delete noChannel.sourcing_channel;
    const draft = await createDraft('user-deal-lead', noChannel);
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 422);
    assert.equal(res.data.sourcing_channel.satisfied, false);
    assert.ok(res.data.sourcing_channel.stops.some((s) => s.code === 'sourcing_channel_required'));
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'draft');
  });

  test('an IHC / affiliate referral auto-sets the related-party flag', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, sourcing_channel: 'ihc_affiliate_referral' });
    const status = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status.data.gate.sourcing_channel.related_party_auto_flag, true);
    assert.ok(status.data.gate.sourcing_channel.tags.includes('related_party_flag'));
    assert.ok(status.data.gate.self_screen.flags.some((f) => f.code === 'related_party'));
  });

  test('a banker / advisor-led channel sets the compressed-timeline indicator', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, sourcing_channel: 'banker_advisor' });
    const status = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status.data.gate.sourcing_channel.compressed_timeline, true);
    assert.ok(status.data.gate.sourcing_channel.tags.includes('compressed_timeline'));
    assert.equal(status.data.gate.sourcing_channel.related_party_auto_flag, false);
  });

  test('a valid channel records its side-effect tags on submit', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, sourcing_channel: 'banker_advisor' });
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', {
        method: 'POST', user: 'user-deal-lead', form: uploadForm(key, key + '.txt', 'content-' + key),
      });
    }
    const res = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.ok(after.data.sourcing_tags.includes('compressed_timeline'));
    assert.equal(after.data.compressed_timeline, true);
  });

  test('/api/gate/fields exposes the channels and their side-effects', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const channels = data.sourcing_channels;
    assert.ok(Array.isArray(channels) && channels.length >= 5);
    const ihc = channels.find((c) => c.value === 'ihc_affiliate_referral');
    const banker = channels.find((c) => c.value === 'banker_advisor');
    assert.equal(ihc.related_by_default, true);
    assert.equal(banker.compressed_timeline, true);
  });
});

// ---------------------------------------------------------------------------
// Three-statement model upload + check (W2-02 / FIN-02). The linked P&L,
// balance sheet and cash flow ride on the mandatory financials pack. The check
// is advisory: a complete template is accepted and balanced; a non-template or
// unbalanced model is still accepted but flagged for manual review, never
// silently blocked.
// ---------------------------------------------------------------------------
describe('three-statement model check (FIN-02)', () => {
  test('the gate config exposes the three statements and the requirement key', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const cfg = data.statement_model;
    assert.ok(cfg, 'expected statement_model config on /api/gate/fields');
    assert.equal(cfg.requirement_key, 'financials');
    assert.deepEqual(cfg.statements.map((s) => s.key).sort(),
      ['balance_sheet', 'cash_flow_statement', 'profit_and_loss']);
  });

  test('uploading the Sirius template parses it and marks the model complete', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', FULL_FIELDS);
    const csv = statementTemplateCsv();
    const up = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead',
      form: uploadForm('financials', 'sirius-model.csv', csv),
    });
    assert.equal(up.status, 201, JSON.stringify(up.data));

    const status = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const sm = status.data.gate.statement_model;
    assert.equal(sm.attached, true);
    assert.equal(sm.complete, true);
    assert.equal(sm.template, true);
    assert.equal(sm.balance.balanced, true);
    assert.equal(sm.flagged_for_review, false);
    assert.deepEqual(Object.values(sm.statements), [true, true, true]);
  });

  test('an unbalanced balance sheet is accepted but flagged for review', async (t) => {
    if (!online) return t.skip('server offline');
    const rows = statementTemplateRows().map((r) => (r.statement === 'balance_sheet' && r.label === 'Total liabilities'
      ? { ...r, values: { ...r.values, y1p: Number(r.values.y1p || 0) + 25 } }
      : r));
    const draft = await createDraft('user-deal-lead', FULL_FIELDS);
    const up = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead',
      form: uploadForm('financials', 'model.csv', statementTemplateCsv(rows)),
    });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const status = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const sm = status.data.gate.statement_model;
    assert.equal(sm.attached, true);
    assert.equal(sm.accepted, true, 'an unbalanced model is still accepted');
    assert.equal(sm.balance.balanced, false);
    assert.ok(sm.balance.imbalances.length >= 1);
    assert.equal(sm.flagged_for_review, true);
  });

  test('a non-template financials file is accepted but flagged for review', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', FULL_FIELDS);
    const up = await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead',
      form: uploadForm('financials', 'financials.pdf', '%PDF-1.4 not a model'),
    });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const status = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const sm = status.data.gate.statement_model;
    assert.equal(sm.attached, true);
    assert.equal(sm.template, false);
    assert.equal(sm.complete, false);
    assert.equal(sm.flagged_for_review, true);
  });

  test('the parse is recorded on the opportunity audit trail', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', FULL_FIELDS);
    await api(`/api/gate/opportunities/${draft.id}/documents`, {
      method: 'POST', user: 'user-deal-lead',
      form: uploadForm('financials', 'sirius-model.csv', statementTemplateCsv()),
    });
    const { data } = await api(`/api/audit?entity=DealOpportunity&entity_id=${draft.id}`, { user: 'user-admin' });
    const evt = data.find((e) => e.action === 'statement_model_parsed');
    assert.ok(evt, 'expected a statement_model_parsed audit event');
    assert.equal(evt.after.template, true);
    assert.equal(evt.after.balanced, true);
  });
});

// ---------------------------------------------------------------------------
// Three-scenario return metrics (W2-03 / FIN-03). Equity IRR, ROIC and payback
// must be captured for base, upside and downside, with a survivable downside
// mandatory; MOIC is captured where relevant. The check is advisory: it flags
// open cells and a missing downside but never blocks submission.
// ---------------------------------------------------------------------------
const RETURN_FIELDS = {
  ...FULL_FIELDS,
  return_irr_base: 24, return_irr_upside: 31, return_irr_downside: 12,
  return_roic_base: 18, return_roic_upside: 23, return_roic_downside: 8,
  return_payback_years: 3.2, return_payback_upside: 2.7, return_payback_downside: 4.1,
  return_moic_base: 2.3, return_moic_upside: 3.1, return_moic_downside: 1.4,
};

describe('three-scenario return metrics (FIN-03)', () => {
  test('the gate config exposes the three scenarios and four metrics', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const cfg = data.returns;
    assert.ok(cfg, 'expected returns config on /api/gate/fields');
    assert.deepEqual(cfg.scenarios.map((s) => s.key), ['base', 'upside', 'downside']);
    assert.deepEqual(cfg.metrics.map((m) => m.key), ['equity_irr', 'roic', 'payback', 'moic']);
    assert.equal(cfg.metrics.find((m) => m.key === 'moic').required, false);
  });

  test('a complete three-scenario set is evaluated as complete', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', RETURN_FIELDS);
    const { data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const rm = data.gate.return_metrics;
    assert.equal(rm.complete, true);
    assert.equal(rm.missing_count, 0);
    assert.equal(rm.downside_present, true);
    assert.equal(rm.moic_relevant, true);
    assert.deepEqual(rm.table.equity_irr, { base: 24, upside: 31, downside: 12 });
  });

  test('a missing downside case is flagged but does not block status resolution', async (t) => {
    if (!online) return t.skip('server offline');
    const incomplete = { ...RETURN_FIELDS, return_irr_downside: '', return_roic_downside: '', return_payback_downside: '' };
    const draft = await createDraft('user-deal-lead', incomplete);
    const { data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const rm = data.gate.return_metrics;
    assert.equal(rm.downside_present, false);
    assert.equal(rm.complete, false);
    assert.ok(rm.missing.some((m) => m.scenario === 'downside'));
  });
});

// ---------------------------------------------------------------------------
// Entity WACC with per-opportunity override (W2-05 / FIN-05). Sirius sets the
// cost of capital once per entity; a preparer may override it for a single deal
// only with a reason. The check is advisory: a reasoned override applies, and a
// reasonless override is flagged rather than applied silently.
// ---------------------------------------------------------------------------
describe('entity WACC with override (FIN-05)', () => {
  test('the gate config exposes the WACC override fields and message', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.wacc, 'expected a wacc config on /api/gate/fields');
    assert.equal(data.wacc.override_field, 'wacc_override_pct');
    assert.equal(data.wacc.reason_field, 'wacc_override_reason');
    assert.equal(data.wacc.reason_message, WACC_OVERRIDE_REASON_MESSAGE);
  });

  test('an opportunity without an override inherits the entity default', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', FULL_FIELDS);
    const { data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const w = data.gate.wacc;
    assert.ok(w, 'expected wacc on the gate result');
    assert.equal(w.has_override, false);
    assert.equal(w.override_valid, true);
    assert.ok(['entity_default', 'system_default'].includes(w.source), w.source);
    assert.ok(Number.isFinite(w.effective_wacc));
  });

  test('a reasoned override applies and reports its source', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS,
      wacc_override_pct: 11.5,
      wacc_override_reason: 'Saudi country-risk premium above the UAE entity default.',
    });
    const { data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const w = data.gate.wacc;
    assert.equal(w.has_override, true);
    assert.equal(w.override_valid, true);
    assert.equal(w.source, 'opportunity_override');
    assert.equal(w.effective_wacc, 11.5);
    assert.equal(w.override_reason_present, true);
  });

  test('an override without a reason is flagged, never applied silently', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS,
      wacc_override_pct: 10.5,
    });
    const { data } = await api(`/api/gate/opportunities/${draft.id}/status`, { user: 'user-deal-lead' });
    const w = data.gate.wacc;
    assert.equal(w.has_override, true);
    assert.equal(w.override_reason_present, false);
    assert.equal(w.override_valid, false);
    assert.equal(w.message, WACC_OVERRIDE_REASON_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Automatic hurdle test per scenario (W2-04 / FIN-04). Every hurdle is
// evaluated against the captured cases, deal-level hurdles are constant across
// scenarios, the thresholds are exposed and versioned, and the org hurdle
// policy is readable through the API. Advisory only — never blocks.
// ---------------------------------------------------------------------------
describe('automatic hurdle table (FIN-04)', () => {
  const rowFor = (table, key) => (table.rows || []).find((r) => r.key === key);

  test('the gate config exposes a versioned hurdle table', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.hurdle_table, 'expected a hurdle_table config on /api/gate/fields');
    assert.ok(Number.isFinite(data.hurdle_table.version), 'expected a numeric policy version');
    assert.deepEqual(data.hurdle_table.rows.map((r) => r.key), ['equity_irr', 'roic', 'payback', 'concentration', 'leverage']);
  });

  test('each hurdle is judged per scenario and the IRRs can disagree', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', RETURN_FIELDS);
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const ht = data.gate.hurdle_table;
    assert.ok(ht, 'expected hurdle_table on the gate result');
    assert.ok(Number.isFinite(ht.version));
    const irr = rowFor(ht, 'equity_irr');
    assert.equal(irr.threshold, 20);
    assert.equal(irr.scenarios.base.meets, true);
    assert.equal(irr.scenarios.upside.meets, true);
    assert.equal(irr.scenarios.downside.meets, false);
    const roic = rowFor(ht, 'roic');
    assert.ok(roic.threshold >= 8, 'ROIC hurdle should be WACC + spread');
  });

  test('deal-level hurdles are constant across the three scenarios', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...RETURN_FIELDS, concentration_pct: 20 });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const conc = rowFor(data.gate.hurdle_table, 'concentration');
    assert.equal(conc.basis, 'deal');
    assert.deepEqual(conc.scenarios.base, conc.scenarios.downside);
    assert.equal(conc.scenarios.base.meets, true);
  });

  test('a below-hurdle case is flagged without blocking submission', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', RETURN_FIELDS);
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const ht = data.gate.hurdle_table;
    assert.equal(ht.any_below, true);
    assert.equal(ht.meets_all, false);
    assert.ok(ht.flags.some((f) => f.reason === 'below_hurdle'));
  });

  test('the org hurdle policy is readable and marks the ROIC spread', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/themes/hurdles', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(Number.isFinite(data.version));
    assert.ok(Number.isFinite(data.thresholds.roic));
    const roic = rowFor(data, 'roic');
    assert.equal(roic.threshold_kind, 'wacc_spread');
  });
});


// ---------------------------------------------------------------------------
// Funding sources and uses (W2-06 / FIN-06). Sources must equal uses and
// Sirius capital is drawn last — after cheaper sources. Advisory only.
// ---------------------------------------------------------------------------
describe('funding sources and uses (FIN-06)', () => {
  const SOURCES_USES_FIELDS = {
    ...FULL_FIELDS,
    sirius_capital_aed: 60,
  };

  test('the gate config exposes the source, use and status options', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const su = data.sources_uses;
    assert.ok(su, 'expected sources_uses on /api/gate/fields');
    assert.deepEqual(
      su.sources.map((s) => s.key),
      ['subsidiary_accruals', 'subsidiary_debt', 'partner_co_investor', 'sirius_capital']
    );
    assert.deepEqual(
      su.uses.map((u) => u.key),
      ['purchase_price', 'transaction_costs', 'working_capital', 'contingency']
    );
    assert.deepEqual(su.statuses.map((s) => s.value), ['secured', 'committed', 'indicative']);
    assert.ok(Number.isFinite(su.tolerance_pct));
  });

  test('a balanced plan reconciles with no imbalance flag', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...SOURCES_USES_FIELDS,
      funding_plan: {
        sources: [
          { key: 'subsidiary_accruals', aed: 40, status: 'secured' },
          { key: 'sirius_capital', aed: 60, status: 'committed' },
        ],
        uses: [
          { key: 'purchase_price', aed: 80 },
          { key: 'transaction_costs', aed: 20 },
        ],
      },
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const su = data.gate.sources_uses;
    assert.ok(su, 'expected sources_uses on the gate result');
    assert.equal(su.applies, true);
    assert.equal(su.balanced, true);
    assert.equal(su.total_sources, 100);
    assert.equal(su.total_uses, 100);
    assert.equal(su.sirius_ask_aed, 60);
    assert.ok(!su.flags.some((f) => f.reason === 'sources_not_uses'));
  });

  test('an imbalanced plan flags sources_not_uses without blocking', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...SOURCES_USES_FIELDS,
      funding_plan: {
        sources: [{ key: 'sirius_capital', aed: 60, status: 'secured' }],
        uses: [{ key: 'purchase_price', aed: 100 }],
      },
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const su = data.gate.sources_uses;
    assert.equal(su.balanced, false);
    assert.ok(su.flags.some((f) => f.reason === 'sources_not_uses'));
  });

  test('Sirius capital drawn ahead of cheaper indicators flags the hierarchy', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...SOURCES_USES_FIELDS,
      funding_plan: {
        sources: [
          { key: 'subsidiary_debt', aed: 40, status: 'indicative' },
          { key: 'sirius_capital', aed: 60, status: 'secured' },
        ],
        uses: [
          { key: 'purchase_price', aed: 80 },
          { key: 'transaction_costs', aed: 20 },
        ],
      },
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const su = data.gate.sources_uses;
    assert.equal(su.hierarchy.violation, true);
    assert.ok(su.flags.some((f) => f.reason === 'funding_hierarchy'));
    assert.equal(su.sirius_ask_aed, 60);
  });

  test('no hierarchy flag when cheaper sources are secured first', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...SOURCES_USES_FIELDS,
      funding_plan: {
        sources: [
          { key: 'subsidiary_accruals', aed: 20, status: 'secured' },
          { key: 'subsidiary_debt', aed: 20, status: 'secured' },
          { key: 'sirius_capital', aed: 60, status: 'committed' },
        ],
        uses: [
          { key: 'purchase_price', aed: 80 },
          { key: 'transaction_costs', aed: 20 },
        ],
      },
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const su = data.gate.sources_uses;
    assert.equal(su.hierarchy.violation, false);
    assert.ok(!su.flags.some((f) => f.reason === 'funding_hierarchy'));
  });
});


// ---------------------------------------------------------------------------
// Budget status (W2-07 / FIN-07). The preparer confirms whether the
// opportunity sits in the approved budget; an off-budget answer forces a
// variance justification and a variance-memo upload.
// ---------------------------------------------------------------------------
describe('budget status (FIN-07)', () => {
  test('the gate config exposes the budget-status fields and memo key', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const bs = data.budget_status;
    assert.ok(bs, 'expected budget_status on /api/gate/fields');
    assert.equal(bs.answer_field, 'in_approved_budget');
    assert.equal(bs.status_field, 'budget_status');
    assert.equal(bs.line_reference_field, 'budget_line_reference');
    assert.equal(bs.justification_field, 'variance_justification');
    assert.equal(bs.variance_memo_key, 'budget_confirmation');
    assert.deepEqual(bs.statuses.map((s) => s.value), ['in_budget', 'variance_justified']);
  });

  test('an in-budget answer satisfies the gate', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, in_approved_budget: 'yes', budget_line_reference: 'BUD-2027-04',
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const bs = data.gate.budget_status;
    assert.ok(bs, 'expected budget_status on the gate result');
    assert.equal(bs.applies, true);
    assert.equal(bs.in_budget, true);
    assert.equal(bs.satisfied, true);
    assert.equal(bs.stops.length, 0);
  });

  test('an off-budget answer without justification or memo is blocked', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, in_approved_budget: 'no',
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const bs = data.gate.budget_status;
    assert.equal(bs.in_budget, false);
    assert.equal(bs.satisfied, false);
    assert.ok(bs.stops.some((s) => s.code === 'variance_justification_required'));
    assert.ok(bs.stops.some((s) => s.code === 'variance_memo_required'));
    assert.ok(data.gate.missing.some((m) => m.key === 'budget_confirmation'),
      'the variance memo document should appear in the gate missing list');
  });

  test('an off-budget answer is satisfied with justification and memo', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, in_approved_budget: 'no',
      variance_justification: 'Not in the FY27 budget; strategic reforecast approved by CFO.',
    });
    await api('/api/gate/opportunities/' + draft.id + '/documents', {
      method: 'POST', user: 'user-deal-lead', form: uploadForm('budget_confirmation'),
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const bs = data.gate.budget_status;
    assert.equal(bs.in_budget, false);
    assert.equal(bs.variance_memo_present, true);
    assert.equal(bs.satisfied, true);
    assert.equal(bs.stops.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Entry valuation and exit (W2-08 / FIN-09). The entry valuation is captured as
// structured fields (EV / equity basis, amount, multiple, method), the
// comparable set allows 3-5 names, and the exit route / timing are recorded.
// Advisory — a partial capture raises flags, it never blocks.
// ---------------------------------------------------------------------------
describe('entry valuation and exit (FIN-09)', () => {
  const VALUATION_COMPLETE = {
    ...FULL_FIELDS,
    entry_valuation_basis: 'ev',
    entry_valuation_aed: 210,
    entry_multiple: 8.5,
    entry_valuation_method: 'trading_comps',
    exit_route: 'Strategic sale to a regional platform',
    exit_timing: 'FY30 (5-year hold)',
    exit_multiple: 9.5,
    valuation_comparables: [
      { name: 'Al Noor Diagnostics', metric: 'EV/EBITDA', multiple: 8.1 },
      { name: 'Gulf Imaging Holdings', metric: 'EV/EBITDA', multiple: 8.7 },
      { name: 'MedCare Group', metric: 'EV/EBITDA', multiple: 8.4 },
    ],
  };

  test('the gate config exposes the valuation fields and comparable bounds', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const v = data.valuation;
    assert.ok(v, 'expected valuation on /api/gate/fields');
    assert.equal(v.basis_field, 'entry_valuation_basis');
    assert.equal(v.amount_field, 'entry_valuation_aed');
    assert.equal(v.multiple_field, 'entry_multiple');
    assert.equal(v.method_field, 'entry_valuation_method');
    assert.equal(v.comparables_field, 'valuation_comparables');
    assert.equal(v.exit_route_field, 'exit_route');
    assert.equal(v.exit_timing_field, 'exit_timing');
    assert.equal(v.exit_multiple_field, 'exit_multiple');
    assert.equal(v.comparable_min, 3);
    assert.equal(v.comparable_max, 5);
    assert.deepEqual(v.basis.map((b) => b.value), ['ev', 'equity']);
    assert.ok(v.methods.map((m) => m.value).includes('trading_comps'));
  });

  test('a complete capture evaluates as complete with no flags', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', VALUATION_COMPLETE);
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const v = data.gate.valuation;
    assert.ok(v, 'expected valuation on the gate result');
    assert.equal(v.complete, true);
    assert.equal(v.comparable_count, 3);
    assert.deepEqual(v.flags, []);
  });

  test('a comparable set below the minimum is flagged, not blocked', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...VALUATION_COMPLETE,
      valuation_comparables: [
        { name: 'Al Noor Diagnostics', metric: 'EV/EBITDA', multiple: 8.1 },
      ],
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const v = data.gate.valuation;
    assert.ok(v, 'expected valuation on the gate result');
    assert.equal(v.comparable_count, 1);
    assert.ok(v.flags.some((f) => f.reason === 'comps_incomplete'));
    assert.equal(v.complete, false);
  });
});


// ---------------------------------------------------------------------------
// Cross-border considerations (W2-09 / FIN-08). The four fields appear only when
// the target geography names a different country from the owning subsidiary's
// home country; a missing consideration raises flags, never blocks.
// ---------------------------------------------------------------------------
describe('cross-border considerations (FIN-08)', () => {
  const CROSS_BORDER_COMPLETE = {
    ...FULL_FIELDS,
    geography: 'Republic of India',
    cross_border_fx: 'USD-linked revenue; 60% of cost base in INR; partial forward-cover hedge.',
    cross_border_wht: '10% withholding on dividends under the UAE-India treaty.',
    cross_border_transfer_pricing: 'Intercompany management fee at arm\u2019s length; transfer-pricing study on file.',
    cross_border_repatriation: 'Capital and dividends freely repatriable after tax clearance.',
  };

  test('the gate config exposes the cross-border fields and items', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const cb = data.cross_border;
    assert.ok(cb, 'expected cross_border on /api/gate/fields');
    assert.equal(cb.fields.fx, 'cross_border_fx');
    assert.equal(cb.fields.wht, 'cross_border_wht');
    assert.equal(cb.fields.transfer_pricing, 'cross_border_transfer_pricing');
    assert.equal(cb.fields.repatriation, 'cross_border_repatriation');
    assert.deepEqual(cb.items.map((i) => i.key), [
      'cross_border_fx', 'cross_border_wht', 'cross_border_transfer_pricing', 'cross_border_repatriation',
    ]);
  });

  test('a same-country deal does not apply cross-border', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', { ...FULL_FIELDS, geography: 'UAE' });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const cb = data.gate.cross_border;
    assert.ok(cb, 'expected cross_border on the gate result');
    assert.equal(cb.applies, false);
    assert.equal(cb.complete, true);
    assert.deepEqual(cb.flags, []);
  });

  test('a cross-border deal with all four captured is complete', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', CROSS_BORDER_COMPLETE);
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const cb = data.gate.cross_border;
    assert.ok(cb, 'expected cross_border on the gate result');
    assert.equal(cb.applies, true);
    assert.equal(cb.captured, 4);
    assert.equal(cb.complete, true);
    assert.deepEqual(cb.flags, []);
  });

  test('a cross-border deal missing considerations is flagged, not blocked', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...CROSS_BORDER_COMPLETE,
      cross_border_transfer_pricing: '',
      cross_border_repatriation: '',
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const cb = data.gate.cross_border;
    assert.ok(cb, 'expected cross_border on the gate result');
    assert.equal(cb.applies, true);
    assert.equal(cb.captured, 2);
    assert.equal(cb.complete, false);
    assert.ok(cb.flags.some((f) => f.reason === 'tp_missing'));
    assert.ok(cb.flags.some((f) => f.reason === 'repatriation_missing'));
  });
});

describe('reporting currency and FX (NFR-08)', () => {
  test('the gate config exposes the currency block', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const cur = data.currency;
    assert.ok(cur, 'expected currency on /api/gate/fields');
    assert.equal(cur.base_currency, 'AED');
    assert.equal(cur.currency_field, 'reporting_currency');
    assert.equal(cur.fx_rate_field, 'fx_rate_usd_aed');
    assert.deepEqual(cur.currencies.map((c) => c.value), ['AED', 'USD']);
  });

  test('a default deal reports in AED mn with no flags', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', FULL_FIELDS);
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const cur = data.gate.currency;
    assert.ok(cur, 'expected currency on the gate result');
    assert.equal(cur.currency, 'AED');
    assert.equal(cur.label, 'AED mn');
    assert.equal(cur.fx_required, false);
    assert.equal(cur.complete, true);
    assert.deepEqual(cur.flags, []);
  });

  test('a USD deal with a recorded rate is complete', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, reporting_currency: 'USD', fx_rate_usd_aed: 3.6725,
    });
    const { data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    const cur = data.gate.currency;
    assert.ok(cur, 'expected currency on the gate result');
    assert.equal(cur.currency, 'USD');
    assert.equal(cur.label, 'USD mn');
    assert.equal(cur.fx_required, true);
    assert.equal(cur.fx_rate, 3.6725);
    assert.equal(cur.complete, true);
    assert.deepEqual(cur.flags, []);
  });

  test('a USD deal without a rate is flagged but not blocked', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await createDraft('user-deal-lead', {
      ...FULL_FIELDS, reporting_currency: 'USD', fx_rate_usd_aed: '',
    });
    const { status, data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const cur = data.gate.currency;
    assert.ok(cur, 'expected currency on the gate result');
    assert.equal(cur.currency, 'USD');
    assert.equal(cur.complete, false);
    assert.ok(cur.flags.some((f) => f.reason === 'fx_rate_missing'));
  });
});
