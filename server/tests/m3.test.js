// M3 integration tests — themes & screening pipeline (E5/E6).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingGateDefaults } from '../config/qualifyingGates.js';
import { attestationDefaults } from '../config/attestations.js';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/[/]+$/, '');
const SIRIUS = 'org-sirius-international-holding-limited';
const INFINIA = 'org-infinia-technologies-limited';
const FINSTREET = 'org-finstreet-limited';

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

function uploadForm(requirementKey, name = 'doc.txt') {
  const form = new FormData();
  form.append('requirement_key', requirementKey);
  form.append('file', new Blob(['content-' + requirementKey], { type: 'text/plain' }), name);
  return form;
}

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
};

async function makeSubmitted(user = 'user-deal-lead', fields = FULL_FIELDS) {
  const { data: draft } = await api('/api/entities/DealOpportunity', {
    method: 'POST', user, body: { status: 'draft', ...fields },
  });
  for (const key of ['business_plan', 'financials', 'cap_table']) {
    await api('/api/gate/opportunities/' + draft.id + '/documents', { method: 'POST', user, form: uploadForm(key) });
  }
  const { data: submit } = await api('/api/gate/opportunities/' + draft.id + '/submit', { method: 'POST', user });
  return { draft, submit };
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[m3.test] server unreachable at ' + BASE);
});


describe('withdraw submission with reason (W1-09 / INT-13)', () => {
  test('the preparer can withdraw a submission with a reason, retained in history', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-deal-lead', body: { state: 'withdrawn', reason_code: 'budget_pulled', comment: 'Budget pulled for this quarter' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.state, 'withdrawn');
    assert.equal(res.data.reason_code, 'budget_pulled');
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'withdrawn');
    assert.equal(after.data.withdrawn_reason, 'Budget pulled for this quarter');
    assert.equal(after.data.decision_reason, 'budget_pulled');
    assert.equal(after.data.decision_reason_label, 'Budget pulled');
    assert.ok(after.data.withdrawn_at, 'withdrawal is timestamped');
    const history = await api('/api/pipeline/opportunities/' + draft.id + '/transitions', { user: 'user-deal-lead' });
    const row = history.data.find((h) => h.to_state === 'withdrawn');
    assert.ok(row, 'the withdrawal is retained in the transition history');
    assert.equal(row.comment, 'Budget pulled for this quarter');
  });

  test('a reason is mandatory to withdraw', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-deal-lead', body: { state: 'withdrawn' },
    });
    assert.equal(res.status, 400);
    const after = await api('/api/entities/DealOpportunity/' + draft.id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'submission', 'the item is unchanged without a reason');
  });

  test('a sibling subsidiary cannot withdraw another org item', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-finstreet-lead', body: { state: 'withdrawn', reason_code: 'budget_pulled', comment: 'not mine' },
    });
    assert.equal(res.status, 403);
  });

  test('a withdrawn item leaves the open count but stays on the board in its own column', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-deal-lead', body: { state: 'withdrawn', reason_code: 'duplicate_opportunity', comment: 'Duplicated elsewhere' },
    });
    const { data } = await api('/api/pipeline/board', { user: 'user-cio' });
    const col = data.columns.find((c) => c.state === 'withdrawn');
    assert.ok(col, 'the board exposes a withdrawn column');
    const card = col.items.find((i) => i.id === draft.id);
    assert.ok(card, 'the withdrawn item remains visible in history');
    assert.equal(card.withdrawn_reason, 'Duplicated elsewhere');
  });
});

describe('duplicate detection (W1-10 / INT-12)', () => {
  test('the Investment Team sees a cross-group duplicate warning; the subsidiary does not', async (t) => {
    if (!online) return t.skip('server offline');
    const a = await makeSubmitted('user-deal-lead', { ...FULL_FIELDS, target_name: 'Nimbus Quantum Analytics LLC', opportunity_name: 'Quantum Analytics Buy' });
    const b = await makeSubmitted('user-finstreet-lead', { ...FULL_FIELDS, target_name: 'Nimbus Quantum Analytics', opportunity_name: 'Finstreet Quantum Play' });
    const team = await api('/api/duplicates/opportunities/' + a.draft.id, { user: 'user-cio' });
    assert.equal(team.status, 200, JSON.stringify(team.data));
    assert.ok(team.data.matches.some((m) => m.opportunity_id === b.draft.id), 'the sibling item matches');
    const denied = await api('/api/duplicates/opportunities/' + a.draft.id, { user: 'user-deal-lead' });
    assert.equal(denied.status, 403, 'the preparer never sees the group-wide match');
  });

  test('the Investment Team can dismiss a warning and it drops from the list', async (t) => {
    if (!online) return t.skip('server offline');
    const a = await makeSubmitted('user-deal-lead', { ...FULL_FIELDS, target_name: 'Vertex Hydroponics Systems LLC', opportunity_name: 'Hydroponics Buy' });
    const b = await makeSubmitted('user-finstreet-lead', { ...FULL_FIELDS, target_name: 'Vertex Hydroponics Systems', opportunity_name: 'Finstreet Hydroponics Play' });
    const link = await api('/api/duplicates/opportunities/' + a.draft.id + '/' + b.draft.id + '/dismiss', {
      method: 'POST', user: 'user-cio', body: { reason: 'Different targets, name coincidence' },
    });
    assert.equal(link.status, 200, JSON.stringify(link.data));
    const after = await api('/api/duplicates/opportunities/' + a.draft.id, { user: 'user-cio' });
    const match = after.data.matches.find((m) => m.opportunity_id === b.draft.id);
    assert.equal(match.review.status, 'dismissed');
    const liveMatches = after.data.matches.filter((m) => m.review?.status !== 'dismissed');
    assert.equal(after.data.count, liveMatches.length, 'the count reflects only live warnings');
    assert.ok(!liveMatches.some((m) => m.opportunity_id === b.draft.id), 'the dismissed pair no longer counts as a warning');
  });

  test('the Investment Team can link a duplicate as the same target', async (t) => {
    if (!online) return t.skip('server offline');
    const a = await makeSubmitted('user-deal-lead', { ...FULL_FIELDS, target_name: 'Orion Pelagic Logistics LLC', opportunity_name: 'Pelagic Buy' });
    const b = await makeSubmitted('user-finstreet-lead', { ...FULL_FIELDS, target_name: 'Orion Pelagic Logistics', opportunity_name: 'Finstreet Pelagic Play' });
    const res = await api('/api/duplicates/opportunities/' + a.draft.id + '/' + b.draft.id + '/link', {
      method: 'POST', user: 'user-cio',
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.status, 'linked');
  });
});


describe('investment themes (E5)', () => {
  test('an approved theme is seeded for the pilot subsidiary', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/themes?org_id=' + INFINIA, { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.theme, 'expected a theme');
    assert.equal(data.theme.status, 'approved');
    assert.equal(data.theme.sector, 'Technology');
    assert.ok(Array.isArray(data.theme.keywords) && data.theme.keywords.length > 0);
  });

  test('mandate thresholds expose the AED floor and hurdles', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/themes?org_id=' + INFINIA, { user: 'user-deal-lead' });
    assert.equal(data.thresholds.floor_aed, 10);
    assert.equal(data.thresholds.equity_irr_min, 20);
  });

  test('only admins may define or approve a theme', async (t) => {
    if (!online) return t.skip('server offline');
    const denied = await api('/api/themes', {
      method: 'PUT', user: 'user-deal-lead',
      body: { org_id: INFINIA, sector: 'Energy', status: 'approved' },
    });
    assert.equal(denied.status, 403);
    const allowed = await api('/api/themes', {
      method: 'PUT', user: 'user-admin',
      body: { org_id: FINSTREET, sector: 'Financial Services', keywords: ['payments'], status: 'approved' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.status, 'approved');
  });

  test('a sibling cannot read another org theme', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/themes?org_id=' + INFINIA, { user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });
});

describe('theme alignment (J3)', () => {
  test('an in-theme submission is aligned and scored', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status, data } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.equal(data.alignment.has_theme, true);
    assert.equal(data.alignment.aligned, true);
    assert.ok(data.alignment.score >= 40, 'score should reflect alignment');
  });

  test('an out-of-theme submission is flagged with a reasoned-exception path', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead', {
      ...FULL_FIELDS,
      opportunity_name: 'Hotel Portfolio Acquisition',
      opportunity_type: 'Acquisition',
      target_name: 'ResortCo',
      sector: 'Hospitality',
      geography: 'Qatar',
      narrative_what: 'Buy a hotel portfolio.',
      narrative_why_now: 'Tourism spend keeps growing.',
      narrative_why_us: 'We already own resorts.',
      decision_sought: 'Approve diligence.',
    });
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-deal-lead' });
    assert.equal(data.alignment.aligned, false);
    assert.ok(data.alignment.reasons.length > 0);

    const short = await api('/api/themes/exceptions/' + draft.id, { method: 'POST', user: 'user-deal-lead', body: { reason: 'too short' } });
    assert.equal(short.status, 400);

    const recorded = await api('/api/themes/exceptions/' + draft.id, {
      method: 'POST', user: 'user-deal-lead',
      body: { reason: 'Portfolio synergy with the existing hospitality arm and IRR above 35%.' },
    });
    assert.equal(recorded.status, 200);
    const { data: history } = await api('/api/themes/exceptions/' + draft.id + '/history', { user: 'user-deal-lead' });
    assert.ok(history.some((h) => h.action === 'theme_exception'));
  });

  test('the AED floor surfaces as a non-blocking signal', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead', { ...FULL_FIELDS, total_commitment_aed: 5 });
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-deal-lead' });
    assert.ok(data.alignment.signals.some((s) => s.type === 'floor'));
  });

  test('a sibling cannot read alignment for another org opportunity', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });
});

// W3-13 - per-dimension theme alignment with a cited strategy passage (BRD SCR-02).
describe('theme alignment per-dimension citations (W3-13 / SCR-02)', () => {
  test('alignment returns a graded verdict for each theme dimension', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status, data } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const { dimensions, dimension_summary } = data.alignment;
    assert.ok(Array.isArray(dimensions) && dimensions.length >= 3, 'expected per-dimension verdicts');
    for (const d of dimensions) {
      assert.ok(['aligned', 'partly', 'not_aligned'].includes(d.verdict), 'verdict is graded for ' + d.key);
      assert.ok(typeof d.rationale === 'string' && d.rationale.length > 0, 'rationale present for ' + d.key);
    }
    assert.deepEqual(Object.keys(dimension_summary).sort(), ['aligned', 'cited', 'not_aligned', 'partly']);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('an in-theme deal cites the entity strategy document on matched dimensions', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-deal-lead' });
    const dims = data.alignment.dimensions;
    const sector = dims.find((d) => d.key === 'sector');
    assert.equal(sector.verdict, 'aligned');
    const cited = dims.filter((d) => d.citation);
    assert.ok(cited.length >= 2, 'matched dimensions carry a strategy citation');
    assert.ok(cited.every((d) => d.citation.document_name && d.citation.text), 'citations name a document and quote a passage');
    assert.ok(cited.some((d) => /Infinia/.test(d.citation.document_name)), 'the Infinia strategy document is cited');
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('an off-theme deal grades the mismatched dimensions as not aligned', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead', {
      ...FULL_FIELDS,
      opportunity_name: 'Hotels on the Corniche',
      target_name: 'DohaResorts LLC',
      sector: 'Hospitality',
      geography: 'Qatar',
      narrative_what: 'Buy a hotel portfolio.',
      narrative_why_now: 'Tourism spend keeps growing.',
      narrative_why_us: 'We already own resorts.',
      decision_sought: 'Approve diligence.',
    });
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/alignment', { user: 'user-deal-lead' });
    const sector = data.alignment.dimensions.find((d) => d.key === 'sector');
    assert.equal(sector.verdict, 'partly', 'a differing sector with a value present is partly aligned');
    assert.ok(['not_aligned', 'partly'].includes(data.alignment.dimensions.find((d) => d.key === 'keywords').verdict));
    assert.equal(data.alignment.aligned, false);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('the screening panel alignment check quotes the source passage', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    const check = data.screening.checks.find((c) => c.key === 'alignment');
    assert.ok(check, 'alignment check present');
    assert.match(check.rationale, /Source: .+Strategy/);
    assert.ok(check.evidence_refs.some((r) => r.type === 'strategy_citation'), 'citations surface as evidence refs');
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('pipeline state machine (E6.1)', () => {
  test('walks submission -> screening -> refinement -> approval with audit', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const toScreening = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' },
    });
    assert.equal(toScreening.status, 200);
    assert.equal(toScreening.data.state, 'screening');
    const toRefinement = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-vertical-head', body: { state: 'refinement' },
    });
    assert.equal(toRefinement.data.state, 'refinement');
    const toApproval = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-cio', body: { state: 'approval' },
    });
    assert.equal(toApproval.data.state, 'approval');

    const { data: history } = await api('/api/pipeline/opportunities/' + draft.id + '/transitions', { user: 'user-sirius-deal-lead' });
    const states = history.map((h) => h.to_state);
    assert.ok(states.includes('screening') && states.includes('refinement') && states.includes('approval'));
  });

  test('rejects an invalid transition', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status } = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-cio', body: { state: 'approval' },
    });
    assert.equal(status, 409);
  });

  test('a deal lead cannot push an item past screening', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status } = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-deal-lead', body: { state: 'screening' },
    });
    assert.equal(status, 403);
  });

  test('returned items can be revised and resubmitted', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'returned', reason_code: 'incomplete_financials', comment: 'Add funding detail' },
    });
    const resubmit = await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-deal-lead', body: { state: 'submission' },
    });
    assert.equal(resubmit.status, 200);
    assert.equal(resubmit.data.state, 'submission');
  });
});

describe('screening board (E6.2/6.3/6.4/6.6)', () => {
  test('lists submitted items by state with age and SLA target', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status, data } = await api('/api/pipeline/board', { user: 'user-cio' });
    assert.equal(status, 200);
    const submission = data.columns.find((c) => c.state === 'submission');
    const card = submission.items.find((i) => i.id === draft.id);
    assert.ok(card, 'expected the new item on the board');
    assert.equal(typeof card.age_days, 'number');
    assert.equal(card.sla_days, 3);
    assert.equal(card.sla_breached, false);
  });

  test('a sibling subsidiary does not see another org items on the board', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { data } = await api('/api/pipeline/board', { user: 'user-finstreet-lead' });
    const all = data.columns.flatMap((c) => c.items);
    assert.ok(!all.some((i) => i.id === draft.id), 'sibling must not see the Infinia item');
  });

  test('awaiting-my-review is role-aware', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    await api('/api/pipeline/opportunities/' + draft.id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' },
    });
    const { data } = await api('/api/pipeline/awaiting-my-review', { user: 'user-sirius-deal-lead' });
    assert.ok(data.items.some((i) => i.id === draft.id));
    const lead = await api('/api/pipeline/awaiting-my-review', { user: 'user-deal-lead' });
    assert.ok(!lead.data.items.some((i) => i.id === draft.id), 'the producing layer is not a reviewer');
  });

  test('the subsidiary sees its own opportunities and status', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { data } = await api('/api/pipeline/my-opportunities', { user: 'user-deal-lead' });
    assert.equal(data.org_id, INFINIA);
    assert.ok(data.items.some((i) => i.id === draft.id));
    assert.ok(data.by_state.submission >= 1);
  });

  test('rollup counts descendants at an ancestor org', async (t) => {
    if (!online) return t.skip('server offline');
    await makeSubmitted('user-deal-lead');
    const { status, data } = await api('/api/pipeline/rollup?org_id=' + SIRIUS, { user: 'user-cio' });
    assert.equal(status, 200);
    assert.ok(data.descendants >= 150);
    assert.ok((data.by_org[INFINIA]?.submission || 0) >= 1, 'expected the Infinia submission in the rollup');
  });
});


describe('single screening panel (W3-01 / SCR-01)', () => {
  test('the panel composes the initial screen with a result, rationale and evidence per check', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-cio' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.opportunity_id, draft.id);
    const panel = res.data.screening;
    assert.equal(panel.check_count, 6);
    assert.deepEqual(panel.checks.map((c) => c.key), ['eligibility', 'hard_filters', 'hurdle_tests', 'alignment', 'synergy_conflict', 'completeness']);
    for (const c of panel.checks) {
      assert.ok(['pass', 'flag', 'fail', 'not_applicable'].includes(c.result), c.key);
      assert.ok(c.rationale && c.rationale.length > 0, c.key + ' rationale');
      assert.ok(Array.isArray(c.evidence_refs), c.key + ' evidence');
    }
    assert.ok(panel.disclaimer.toLowerCase().includes('never rejects'), 'SCR-09: advisory, never an automatic rejection');
    assert.ok(['pass', 'review', 'stop'].includes(panel.summary.recommended));
  });

  test('a submitted opportunity is complete and its completeness check reflects the gate', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-cio' });
    const byKey = Object.fromEntries(data.screening.checks.map((c) => [c.key, c]));
    // Required fields and documents are satisfied, so completeness is never a
    // fail; a non-template statement model may still add an advisory note.
    assert.notEqual(byKey.completeness.result, 'fail', byKey.completeness.rationale);
    assert.deepEqual(byKey.completeness.detail.missing_fields, []);
    assert.deepEqual(byKey.completeness.detail.missing_documents, []);
    assert.equal(byKey.eligibility.result, 'pass', byKey.eligibility.rationale);
    assert.equal(data.screening.complete, true);
    assert.equal(data.screening.summary.blocking.length, 0);
  });

  test('a stopped self-screen fails the eligibility check', async (t) => {
    if (!online) return t.skip('server offline');
    const { data: draft } = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', ...FULL_FIELDS, total_commitment_aed: 4 },
    });
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-cio' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const el = res.data.screening.checks.find((c) => c.key === 'eligibility');
    assert.equal(el.result, 'fail');
    assert.equal(res.data.screening.summary.recommended, 'stop');
  });

  test('a sibling subsidiary cannot read another org screening panel', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-finstreet-lead' });
    assert.equal(res.status, 403);
  });

  test('a missing opportunity is a 404', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/pipeline/opportunities/does-not-exist/screening', { user: 'user-cio' });
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Overall pre-screening quality score (W3-09 / SCO-01)
// ---------------------------------------------------------------------------
describe('overall quality score (W3-09 / SCO-01)', () => {
  test('the panel exposes an advisory 0-100 quality score with a component breakdown', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { data } = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-cio' });
    const q = data.screening.quality_score;
    assert.ok(q, 'quality_score present');
    assert.equal(q.advisory, true);
    assert.equal(q.max_score, 100);
    assert.deepEqual(q.components.map((c) => c.key), ['eligibility', 'hard_filters', 'soft_filters', 'hurdles', 'alignment', 'scorecard']);
    for (const c of q.components) assert.ok(c.weight >= 0 && (c.available ? c.score >= 0 && c.score <= 100 : true), c.key);
    // A submitted deal has at least the eligibility signal, so a score exists.
    assert.ok(q.score == null || (q.score >= 0 && q.score <= 100), 'score in range');
  });

  test('the config endpoint serves the weights and bands; a non-admin cannot change them', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/gate/quality-score-config', { user: 'user-deal-lead' });
    assert.equal(before.data.valid, true);
    assert.equal(before.data.config.components.reduce((s, c) => s + c.weight, 0), 100);
    assert.ok(before.data.config.bands.some((b) => b.min === 0));

    const forbidden = await api('/api/gate/quality-score-config', {
      method: 'PUT', user: 'user-deal-lead', body: { components: before.data.config.components, bands: before.data.config.bands },
    });
    assert.equal(forbidden.status, 403);

    const saved = await api('/api/gate/quality-score-config', {
      method: 'PUT', user: 'user-admin', body: { components: before.data.config.components, bands: before.data.config.bands },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.config.revision, before.data.config.revision + 1);
  });
});


describe('Gate 1 hard filters (W3-02 / SCR-03)', () => {
  test('the gate exposes the five hard filters with the recommended outcome', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const hf = res.data.gate.hard_filters;
    assert.equal(hf.item_count, 5);
    assert.deepEqual(hf.items.map((i) => i.key),
      ['designated_vertical', 'check_size', 'sanctions_export', 'structuring', 'portfolio_conflict']);
    for (const item of hf.items) assert.ok(['pass', 'fail', 'flag', 'not_evaluated'].includes(item.status), item.key);
    assert.ok(['proceed', 'recommended_decline'].includes(hf.recommended_outcome));
    // The clean fixture is in-theme and inside the band, so the vertical and
    // size filters pass; the manual confirmations are simply unconfirmed.
    const byKey = Object.fromEntries(hf.items.map((i) => [i.key, i]));
    assert.equal(byKey.designated_vertical.status, 'pass', byKey.designated_vertical.rationale);
    assert.equal(byKey.check_size.status, 'pass', byKey.check_size.rationale);
  });

  test('the fields endpoint serves the hard-filter configuration', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.ok(data.hard_filters, 'hard_filters config');
    assert.equal(data.hard_filters.items.length, 5);
    assert.deepEqual(data.hard_filters.decisions.map((d) => d.value), ['confirmed', 'overridden']);
    assert.equal(data.hard_filters.reason_min, 10);
  });

  test('a failed filter recommends decline and a reviewer override needs a reason', async (t) => {
    if (!online) return t.skip('server offline');
    // An off-theme sector with no reasoned exception fails the vertical filter.
    const { data: draft } = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', ...FULL_FIELDS, sector: 'Industrials', opportunity_name: 'Off-theme probe' },
    });
    const status = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(status.data.gate.hard_filters.recommended_outcome, 'recommended_decline');
    assert.ok(status.data.gate.hard_filters.failed.some((f) => f.key === 'designated_vertical'));

    // A too-short reason is refused.
    const short = await api('/api/gate/opportunities/' + draft.id + '/hard-filter-review', {
      method: 'POST', user: 'user-cio', body: { decision: 'overridden', reason: 'no' },
    });
    assert.equal(short.status, 400);

    // An override with a written reason is recorded and flips the effective outcome.
    const over = await api('/api/gate/opportunities/' + draft.id + '/hard-filter-review', {
      method: 'POST', user: 'user-cio',
      body: { decision: 'overridden', reason: 'The vertical exception was approved by the investment committee.' },
    });
    assert.equal(over.status, 200, JSON.stringify(over.data));
    assert.equal(over.data.review.decision, 'overridden');
    assert.equal(over.data.hard_filters.effective_outcome, 'overridden');

    const after = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(after.data.gate.hard_filters.review.decision, 'overridden');
    assert.equal(after.data.gate.hard_filters.awaiting_review, false);
  });

  test('a reviewer with no write access to the org cannot decide, and a clean deal has nothing to review', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    // A sibling subsidiary lead cannot write Infinia's opportunity.
    const forbidden = await api('/api/gate/opportunities/' + draft.id + '/hard-filter-review', {
      method: 'POST', user: 'user-finstreet-lead',
      body: { decision: 'confirmed', reason: 'Not my deal to decide at all.' },
    });
    assert.equal(forbidden.status, 403);
    // The clean submission has no failed filter, so there is nothing to confirm.
    const none = await api('/api/gate/opportunities/' + draft.id + '/hard-filter-review', {
      method: 'POST', user: 'user-cio',
      body: { decision: 'confirmed', reason: 'Nothing to confirm on a clean deal.' },
    });
    assert.equal(none.status, 409);
  });
});

describe('Gate 1 soft filters (W3-03 / SCR-04)', () => {
  const sfScores = { portfolio_adjacency: 4, national_priorities: 4, management_openness: 3 };
  const sfRationales = {
    portfolio_adjacency: 'Direct adjacency to the technology holdings.',
    national_priorities: 'UAE priority sector and national agenda.',
    management_openness: 'Management is neutral pending the terms.',
  };

  test('the gate exposes the three scored soft filters with proposed scores', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const sf = res.data.gate.soft_filters;
    assert.equal(sf.item_count, 3);
    assert.deepEqual(sf.items.map((i) => i.key), ['portfolio_adjacency', 'national_priorities', 'management_openness']);
    for (const item of sf.items) {
      assert.ok(item.proposed_score >= 1 && item.proposed_score <= 5, item.key);
      assert.ok(['strong', 'moderate', 'weak'].includes(sf.outcome));
    }
    assert.equal(sf.awaiting_review, true);
    assert.equal(sf.confirmed, false);
  });

  test('the fields endpoint serves the soft-filter configuration', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.ok(data.soft_filters, 'soft_filters config');
    assert.equal(data.soft_filters.items.length, 3);
    assert.deepEqual(data.soft_filters.scale.map((s) => s.value), [1, 2, 3, 4, 5]);
    assert.deepEqual(data.soft_filters.decisions.map((d) => d.value), ['confirmed', 'adjusted']);
    assert.equal(data.soft_filters.reason_min, 10);
  });

  test('a reviewer confirms or adjusts the scored set and a short rationale is refused', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');

    // A short rationale on any filter is refused.
    const short = await api('/api/gate/opportunities/' + draft.id + '/soft-filter-review', {
      method: 'POST', user: 'user-cio',
      body: { decision: 'confirmed', scores: sfScores, rationales: { ...sfRationales, management_openness: 'no' } },
    });
    assert.equal(short.status, 400);

    // An out-of-range score is refused.
    const bad = await api('/api/gate/opportunities/' + draft.id + '/soft-filter-review', {
      method: 'POST', user: 'user-cio',
      body: { decision: 'confirmed', scores: { ...sfScores, national_priorities: 9 }, rationales: sfRationales },
    });
    assert.equal(bad.status, 400);

    // A fully reasoned decision is recorded and the scores become the effective set.
    const ok = await api('/api/gate/opportunities/' + draft.id + '/soft-filter-review', {
      method: 'POST', user: 'user-cio',
      body: { decision: 'adjusted', scores: sfScores, rationales: sfRationales },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.review.decision, 'adjusted');
    assert.equal(ok.data.soft_filters.confirmed, true);
    assert.equal(ok.data.soft_filters.awaiting_review, false);
    const byKey = Object.fromEntries(ok.data.soft_filters.items.map((i) => [i.key, i]));
    assert.equal(byKey.management_openness.score, 3);

    // The decision is on the audit trail and survives a re-read.
    const history = await api('/api/gate/opportunities/' + draft.id + '/soft-filter-review/history', { user: 'user-cio' });
    assert.equal(history.status, 200);
    assert.ok(history.data.some((e) => String(e.action).startsWith('soft_filter_')));
    const after = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(after.data.gate.soft_filters.confirmed, true);
  });

  test('a sibling with no write access cannot decide the soft filters', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const forbidden = await api('/api/gate/opportunities/' + draft.id + '/soft-filter-review', {
      method: 'POST', user: 'user-finstreet-lead',
      body: { decision: 'confirmed', scores: sfScores, rationales: sfRationales },
    });
    assert.equal(forbidden.status, 403);
  });
});

describe('Automatic disqualifier flags (W3-04 / SCR-05)', () => {
  test('the gate exposes the five automatic disqualifiers', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const dq = res.data.gate.disqualifiers;
    assert.equal(dq.item_count, 5);
    assert.deepEqual(dq.items.map((i) => i.key), [
      'sanctions_pep', 'minority_protections', 'valuation_premium', 'undisclosed_related_party', 'licence_transfer',
    ]);
    assert.equal(typeof dq.has_open_flag, 'boolean');
  });

  test('the fields endpoint serves the disqualifier configuration', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.ok(data.disqualifiers, 'disqualifiers config');
    assert.equal(data.disqualifiers.items.length, 5);
    assert.equal(data.disqualifiers.reason_min, 10);
    assert.equal(data.disqualifiers.valuation_premium_min, 30);
    assert.equal(data.disqualifiers.valuation_premium_max, 40);
  });

  test('a present disqualifier raises a flag that a named reviewer clears with a reason', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead', { ...FULL_FIELDS, disqualifier_sanctions_pep: 'yes' });
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'PATCH', user: 'user-deal-lead', body: { disqualifier_sanctions_pep: 'yes' } });

    const before = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    const dq = before.data.gate.disqualifiers;
    assert.equal(dq.has_open_flag, true);
    assert.ok(dq.open_flags.some((f) => f.key === 'sanctions_pep'));

    // A short reason is refused; an unknown key is refused.
    const short = await api('/api/gate/opportunities/' + draft.id + '/disqualifier-review', {
      method: 'POST', user: 'user-cio', body: { key: 'sanctions_pep', reviewer: 'user-cio', reason: 'short' },
    });
    assert.equal(short.status, 400);
    const unknown = await api('/api/gate/opportunities/' + draft.id + '/disqualifier-review', {
      method: 'POST', user: 'user-cio', body: { key: 'minority_protections', reviewer: 'user-cio', reason: 'This flag is not raised for this opportunity.' },
    });
    assert.equal(unknown.status, 409);

    // A named reviewer with a reason clears the flag.
    const ok = await api('/api/gate/opportunities/' + draft.id + '/disqualifier-review', {
      method: 'POST', user: 'user-cio',
      body: { key: 'sanctions_pep', reviewer: 'reviewer@sirius.local', reason: 'Independent sanctions screening returned clear.' },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.disqualifiers.has_open_flag, false);
    assert.deepEqual(ok.data.disqualifiers.cleared, ['sanctions_pep']);

    // The clear is on the audit trail and survives a re-read.
    const history = await api('/api/gate/opportunities/' + draft.id + '/disqualifier-review/history', { user: 'user-cio' });
    assert.equal(history.status, 200);
    assert.ok(history.data.some((e) => String(e.action).startsWith('disqualifier_')));
    const after = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-cio' });
    assert.equal(after.data.gate.disqualifiers.has_open_flag, false);
  });

  test('a sibling with no write access cannot clear a disqualifier flag', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const forbidden = await api('/api/gate/opportunities/' + draft.id + '/disqualifier-review', {
      method: 'POST', user: 'user-finstreet-lead',
      body: { key: 'sanctions_pep', reviewer: 'reviewer@sirius.local', reason: 'Attempted clear from a sibling org.' },
    });
    assert.equal(forbidden.status, 403);
  });
});

// ---------------------------------------------------------------------------
// Gate 2 weighted scorecard (W3-05 / SCO-02, REQ-GATE-02)
// ---------------------------------------------------------------------------
describe('Gate 2 weighted scorecard (W3-05 / SCO-02)', () => {
  const ALL4 = {
    revenue_scale: 4, growth_rate: 4, entry_valuation: 4, ownership_control: 4,
    capital_structure: 4, path_to_liquidity: 4, unit_economics: 4,
  };
  const ALL3 = Object.fromEntries(Object.keys(ALL4).map((k) => [k, 3]));
  // Capturing a score away from the system proposal needs a written comment
  // (SCO-03, W3-07); a generic comment per key keeps these SCO-02 cases focused.
  const COMMENTS = Object.fromEntries(Object.keys(ALL4).map((k) => [k, 'Reviewer confirmed the score against the evidence on file.']));

  test('the fields endpoint serves the scorecard configuration with weights summing to 100', async (t) => {
    if (!online) return t.skip('server offline');
    const { data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.ok(data.scorecard, 'scorecard config');
    assert.equal(data.scorecard.items.length, 7);
    assert.equal(data.scorecard.pass_threshold, 3.5);
    assert.equal(data.scorecard.items.reduce((sum, i) => sum + i.weight, 0), 100);
  });

  test('an all-4 scorecard totals 4 and proceeds; a below-bar total requires a CIO override', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');

    const scored = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: ALL4, comments: COMMENTS },
    });
    assert.equal(scored.status, 200, JSON.stringify(scored.data));
    assert.equal(scored.data.scorecard.total, 4);
    assert.equal(scored.data.scorecard.outcome, 'proceed');

    const below = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: ALL3, comments: COMMENTS },
    });
    assert.equal(below.status, 200);
    assert.equal(below.data.scorecard.total, 3);
    assert.equal(below.data.scorecard.outcome, 'override_required');

    // A short reason is refused; a named CIO with a reason clears the bar.
    const short = await api('/api/gate/opportunities/' + draft.id + '/scorecard-override', {
      method: 'POST', user: 'user-cio', body: { by: 'cio@sirius.local', reason: 'short' },
    });
    assert.equal(short.status, 400);
    const ok = await api('/api/gate/opportunities/' + draft.id + '/scorecard-override', {
      method: 'POST', user: 'user-cio', body: { by: 'cio@sirius.local', reason: 'Strategic entry into a priority sector approved by the IC.' },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.scorecard.outcome, 'proceed_override');

    const history = await api('/api/gate/opportunities/' + draft.id + '/scorecard/history', { user: 'user-cio' });
    assert.equal(history.status, 200);
    assert.ok(history.data.some((e) => String(e.action).startsWith('scorecard_')));
  });

  test('the CIO override requires the CIO role', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: ALL3, comments: COMMENTS },
    });
    const forbidden = await api('/api/gate/opportunities/' + draft.id + '/scorecard-override', {
      method: 'POST', user: 'user-deal-lead', body: { by: 'deal.lead@infinia.local', reason: 'A deal lead cannot file the CIO override memo.' },
    });
    assert.equal(forbidden.status, 403);
  });

  test('the two-lens floor blocks a strong-strategic weak-financial deal that clears the total bar (SCO-04)', async (t) => {
    if (!online) return t.skip('server offline');
    const config = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(config.data.scorecard.lens_floor, 3.0);
    assert.deepEqual(config.data.scorecard.lenses.map((l) => l.key), ['strategic', 'financial']);

    const { draft } = await makeSubmitted('user-deal-lead');
    // Strategic 5.0 (weight 55), financial 2.0 (weight 45): total 3.65 clears
    // the 3.5 bar, but the financial lens sits below the 3.0 floor.
    const scores = {
      revenue_scale: 5, growth_rate: 5, ownership_control: 5, path_to_liquidity: 5,
      entry_valuation: 2, capital_structure: 2, unit_economics: 2,
    };
    const scored = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores, comments: COMMENTS },
    });
    assert.equal(scored.status, 200, JSON.stringify(scored.data));
    assert.equal(scored.data.scorecard.total, 3.65);
    assert.equal(scored.data.scorecard.below_lens_floor, true);
    assert.deepEqual(scored.data.scorecard.lenses_below_floor, ['financial']);
    assert.equal(scored.data.scorecard.outcome, 'override_required');

    // A memo can still be filed for a below-lens-floor deal even though the
    // weighted total clears the pass bar.
    const override = await api('/api/gate/opportunities/' + draft.id + '/scorecard-override', {
      method: 'POST', user: 'user-cio', body: { by: 'cio@sirius.local', reason: 'Strategic platform entry; financial case to be de-risked post-close.' },
    });
    assert.equal(override.status, 200, JSON.stringify(override.data));
    assert.equal(override.data.scorecard.outcome, 'proceed_override');
  });

  test('a score is proposed per criterion and an adjustment needs a comment (SCO-03)', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    // The proposal set is exposed before any capture, and nothing counts yet.
    const before = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    const pre = before.data.scorecard || before.data.screening?.scorecard;
    assert.equal(pre.complete, false);
    assert.equal(pre.awaiting_review, true);
    assert.ok(pre.items.every((i) => i.proposed_score >= 1 && i.proposed_score <= 5), 'every criterion has a proposal');
    const scaleProposal = pre.items.find((i) => i.key === 'revenue_scale').proposed_score;

    // A capture matching every proposal is accepted with no comments.
    const proposed = Object.fromEntries(pre.items.map((i) => [i.key, i.proposed_score]));
    const confirmed = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: proposed },
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.scorecard.complete, true);
    assert.deepEqual(confirmed.data.scorecard.capture.adjusted, []);

    // An adjustment away from the proposal without a comment is refused.
    const adjusted = { ...proposed };
    adjusted.revenue_scale = scaleProposal === 5 ? 3 : 5;
    const rejected = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: adjusted },
    });
    assert.equal(rejected.status, 400);

    // The same adjustment with a written comment is accepted and stored.
    const comments = { revenue_scale: 'Scale is strong but below the top decile in this cycle.' };
    const ok = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: adjusted, comments },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data.scorecard.capture.adjusted, ['revenue_scale']);
    const item = ok.data.scorecard.items.find((i) => i.key === 'revenue_scale');
    assert.equal(item.proposed_score, scaleProposal);
    assert.equal(item.has_review, true);
    assert.equal(item.adjusted, true);
  });

  test('an admin recalibrates the scorecard under a new revision; history keeps its version (SCO-05)', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/gate/scorecard-config', { user: 'user-deal-lead' });
    const base = before.data.config;
    assert.equal(before.data.valid, true);

    // A captured scorecard stamps the revision in force when it was scored.
    const { draft } = await makeSubmitted('user-deal-lead');
    const captured = await api('/api/gate/opportunities/' + draft.id + '/scorecard', {
      method: 'POST', user: 'user-deal-lead', body: { scores: ALL4, comments: COMMENTS },
    });
    assert.equal(captured.data.scorecard.capture.version, base.version);

    // A non-admin cannot publish a recalibration.
    const forbidden = await api('/api/gate/scorecard-config', {
      method: 'PUT', user: 'user-deal-lead', body: { pass_threshold: 4.2 },
    });
    assert.equal(forbidden.status, 403);

    // The admin publishes a higher pass bar; the revision advances.
    const newBar = base.pass_threshold === 4.3 ? 4.1 : 4.3;
    const saved = await api('/api/gate/scorecard-config', {
      method: 'PUT', user: 'user-admin', body: { pass_threshold: newBar },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.equal(saved.data.config.version, 'SC-01.' + saved.data.config.revision);
    assert.equal(saved.data.config.pass_threshold, newBar);
    assert.ok(saved.data.changes.some((c) => c.field === 'pass_threshold' && c.to === newBar));

    // The effective configuration now serves the new bar.
    const after = await api('/api/gate/scorecard-config', { user: 'user-deal-lead' });
    assert.equal(after.data.config.pass_threshold, newBar);

    // The earlier capture keeps the revision it was scored under (the audit
    // event records the version), while the gate now evaluates under the new
    // bar; the stored history is not rewritten by the recalibration.
    const reread = await api('/api/gate/opportunities/' + draft.id + '/scorecard/history', { user: 'user-cio' });
    assert.ok(Array.isArray(reread.data));
    const scored = reread.data.find((e) => e.action === 'scorecard_scored');
    assert.equal(scored.after.version, base.version);
    const opp = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(opp.data.screening.scorecard.pass_threshold, newBar);

    // Restore the shipped bar so later suites see the default calibration.
    const defaults = before.data.defaults;
    const restored = await api('/api/gate/scorecard-config', {
      method: 'PUT', user: 'user-admin',
      body: { pass_threshold: defaults.pass_threshold, lens_floor: defaults.lens_floor, criteria: defaults.criteria, lenses: defaults.lenses },
    });
    assert.equal(restored.data.config.pass_threshold, defaults.pass_threshold);
  });
});

// ---------------------------------------------------------------------------
// W4-01 - portfolio register (BRD ENT-04). The register is versioned config
// behind the advisory synergy / conflict checks; reads are open to any reader,
// writes need the admin role and mint a revision, and the template loads.
// ---------------------------------------------------------------------------
describe('portfolio register (W4-01)', () => {
  test('any reader can load the register with the fifteen companies and a template', async () => {
    const reg = await api('/api/portfolio-register', { user: 'user-deal-lead' });
    assert.equal(reg.status, 200);
    assert.equal(reg.data.valid, true);
    assert.equal(reg.data.config.companies.length, 15);
    for (const c of reg.data.config.companies) {
      assert.ok(c.sector && c.geography && c.cluster);
    }
    const csv = await fetch(BASE + '/api/portfolio-register/template.csv', { headers: { 'x-user-id': 'user-deal-lead' } });
    assert.equal(csv.status, 200);
    const body = await csv.text();
    assert.ok(body.startsWith('name,legal_name,cluster,sector'));
    assert.equal(body.trim().split('\n').length, 16);
  });

  test('a non-admin cannot change the register', async () => {
    const res = await api('/api/portfolio-register', {
      method: 'PUT', user: 'user-deal-lead',
      body: { companies: [{ name: 'X', cluster: 'other', sector: 'Holding' }] },
    });
    assert.equal(res.status, 403);
  });

  test('an admin edit mints the next revision and the match endpoint reflects the tags', async () => {
    const before = await api('/api/portfolio-register', { user: 'user-admin' });
    const base = before.data.config;

    const edited = base.companies.map((c) => ({ ...c }));
    edited[0] = { ...edited[0], cluster: 'other' };
    const saved = await api('/api/portfolio-register', {
      method: 'PUT', user: 'user-admin', body: { companies: edited },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.equal(saved.data.config.version, 'PR-01.' + saved.data.config.revision);
    assert.ok(saved.data.changes.edited.some((e) => e.fields.includes('cluster')));

    const after = await api('/api/portfolio-register', { user: 'user-deal-lead' });
    assert.equal(after.data.config.revision, base.revision + 1);

    const matches = await api('/api/portfolio-register/matches?sector=Energy', { user: 'user-deal-lead' });
    assert.equal(matches.status, 200);
    assert.ok(Array.isArray(matches.data.sector));

    // Restore the shipped register so later suites see the default tags.
    const restored = await api('/api/portfolio-register', {
      method: 'PUT', user: 'user-admin', body: { companies: before.data.defaults.companies },
    });
    assert.equal(restored.status, 200);
  });

  test('the CSV template imports', async () => {
    const before = await api('/api/portfolio-register', { user: 'user-admin' });
    const csv = await (await fetch(BASE + '/api/portfolio-register/template.csv', { headers: { 'x-user-id': 'user-deal-lead' } })).text();
    const res = await api('/api/portfolio-register/import', { method: 'POST', user: 'user-admin', body: { csv } });
    assert.equal(res.status, 200);
    assert.equal(res.data.imported, 15);
    const restored = await api('/api/portfolio-register', {
      method: 'PUT', user: 'user-admin', body: { companies: before.data.defaults.companies },
    });
    assert.equal(restored.status, 200);
  });
});


// ---------------------------------------------------------------------------
// W3-10 / W3-11 - portfolio conflict & concentration and synergy against the
// register (BRD SCR-07 / SCR-06). The screening panel now names the affected
// portfolio company for each overlap and carries the post-deal concentration;
// every synergy is marked as requiring the operating company's sign-off.
// ---------------------------------------------------------------------------
describe('portfolio conflict & synergy (W3-10 / W3-11)', () => {
  test('the register-grounded analysis is served on the gate fields', async () => {
    const res = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    const pa = res.data.portfolio_analysis;
    assert.ok(pa, 'portfolio_analysis config present');
    assert.equal(pa.concentration_max_sector_pct, 35);
    assert.ok(pa.synergy_max_results >= 1);
    assert.equal(pa.signoff_marker, 'requires operating-company sign-off');
  });

  test('the screening panel names the overlapping company, the concentration and the synergies', async () => {
    // A Technology / UAE target (the default full-field draft) overlaps the
    // Technology companies in the register.
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', ...FULL_FIELDS, opportunity_name: 'W3-10 overlap probe' },
    });
    const draft = created.data;
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', { method: 'POST', user: 'user-deal-lead', form: uploadForm(key) });
    }
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    const s = res.data.screening;

    const check = (s.checks || []).find((c) => c.key === 'synergy_conflict');
    assert.ok(check, 'synergy & conflict check present');
    assert.equal(check.advisory, false, 'the check is no longer a placeholder');
    assert.ok(['pass', 'flag', 'fail'].includes(check.result));
    assert.ok(check.detail.conflict_flag_count >= 1, 'a Technology target overlaps the register');
    assert.ok(check.detail.conflict_companies.length >= 1);
    assert.ok(check.detail.conflict_companies.every((c) => c.company));
    assert.ok(check.detail.concentration.post_deal_pct !== null);
    assert.equal(check.detail.synergy_signoff_marker, 'requires operating-company sign-off');
    assert.ok(check.detail.synergies.length >= 1);
    assert.ok(check.detail.synergies.every((x) => x.signoff === 'requires operating-company sign-off'));
    assert.ok(check.evidence_refs.some((e) => e.type === 'conflict_match'));
    assert.ok(check.evidence_refs.some((e) => e.type === 'synergy'));

    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('an unrelated-sector target shows no portfolio overlap but still reports concentration', async () => {
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: {
        ...FULL_FIELDS, status: 'draft', opportunity_name: 'W3-10 unrelated probe',
        sector: 'Real Estate', geography: 'KSA', target_name: 'Coastal Wind Holdings',
        capabilities: ['property management'],
      },
    });
    const draft = created.data;
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', { method: 'POST', user: 'user-deal-lead', form: uploadForm(key) });
    }
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    const check = (res.data.screening.checks || []).find((c) => c.key === 'synergy_conflict');
    assert.equal(check.detail.conflict_flag_count, 0);
    assert.equal(check.detail.synergies.length, 0);
    assert.ok(check.detail.concentration.post_deal_pct !== null);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

// ---------------------------------------------------------------------------
// Sanctions / adverse-media manual confirmation (W3-12 / BRD SCR-08). The
// verdict, the screening source, the supporting note and the evidence held on
// the record; a clear verdict is only satisfied with its note and evidence.
// ---------------------------------------------------------------------------
describe('sanctions / adverse-media confirmation (SCR-08)', () => {
  test('the gate config exposes the confirmation fields and the evidence key', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const am = data.adverse_media;
    assert.ok(am, 'adverse_media config present');
    assert.equal(am.evidence_doc_key, 'adverse_media_evidence');
    assert.ok(am.notes_min >= 1);
    assert.equal(am.fields.confirmation, 'adverse_media_confirmation');
  });

  test('the evidence document is offered to upload without blocking submission', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/requirements', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const req = data.requirements.find((r) => r.key === 'adverse_media_evidence');
    assert.ok(req, 'the evidence requirement is seeded');
    assert.equal(Boolean(req.required), false, 'the evidence requirement never blocks a submit');
  });

  test('a clear confirmation with a note and evidence is satisfied on the panel', async (t) => {
    if (!online) return t.skip('server offline');
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: {
        ...FULL_FIELDS, status: 'draft', opportunity_name: 'W3-12 clear probe',
        adverse_media_confirmation: 'clear',
        adverse_media_source: 'Dow Jones Risk & Compliance',
        adverse_media_note: 'Screened the target and its owners; no matches returned.',
        adverse_media_reviewed_by: 'deal.lead@infinia.local',
      },
    });
    const draft = created.data;
    for (const key of ['business_plan', 'financials', 'cap_table', 'adverse_media_evidence']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', { method: 'POST', user: 'user-deal-lead', form: uploadForm(key) });
    }
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    const am = res.data.screening.adverse_media;
    assert.ok(am, 'the panel exposes the adverse-media block');
    assert.equal(am.status, 'clear');
    assert.equal(am.satisfied, true);
    assert.equal(am.evidence_on_record, true);
    assert.equal(am.evidence_present, true);
    assert.equal(am.flags.length, 0);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('a clear confirmation without evidence is flagged on the panel', async (t) => {
    if (!online) return t.skip('server offline');
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: {
        ...FULL_FIELDS, status: 'draft', opportunity_name: 'W3-12 no-evidence probe',
        adverse_media_confirmation: 'clear',
        adverse_media_note: 'Screened the target; no matches returned.',
      },
    });
    const draft = created.data;
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      await api('/api/gate/opportunities/' + draft.id + '/documents', { method: 'POST', user: 'user-deal-lead', form: uploadForm(key) });
    }
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    const am = res.data.screening.adverse_media;
    assert.equal(am.status, 'clear');
    assert.equal(am.satisfied, false);
    assert.ok(am.flags.some((f) => f.code === 'adverse_media_evidence_missing'));
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('an adverse finding is flagged and never rejects the opportunity', async (t) => {
    if (!online) return t.skip('server offline');
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { ...FULL_FIELDS, status: 'draft', opportunity_name: 'W3-12 adverse probe', adverse_media_confirmation: 'adverse' },
    });
    const draft = created.data;
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    const am = res.data.screening.adverse_media;
    assert.equal(am.status, 'adverse');
    assert.ok(am.flags.some((f) => f.code === 'adverse_media_exposure'));
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

// W4-02 - entity strategy library (BRD ENT-02). Strategy documents are
// uploaded against an entity and indexed into citable passages; the profile is
// versioned. Reads/writes are org-scoped, so a sibling entity is denied.
describe('strategy library (W4-02 / ENT-02)', () => {
  function strategyForm(text, name = 'strategy.txt') {
    const form = new FormData();
    form.append('file', new Blob([text], { type: 'text/plain' }), name);
    return form;
  }

  const DOC_TEXT = [
    'Infinia Technologies Limited investment strategy, 2026.',
    'Mandate: Infinia invests in technology platforms with recurring revenue across the United Arab Emirates.',
    'Target sectors: software, SaaS, digital platforms and data infrastructure.',
  ].join('\n');

  test('the indexer shape is exposed to any authenticated reader', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/strategy/config', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.version);
    assert.ok(data.formats.some((f) => f.ext === '.docx' && f.indexable));
    assert.ok(data.statuses.includes('indexed'));
  });

  test('uploading a document indexes it into searchable passages with a citation', async (t) => {
    if (!online) return t.skip('server offline');
    const form = strategyForm(DOC_TEXT, 'W4-02 tech strategy.txt');
    const upload = await api('/api/strategy/documents', { method: 'POST', user: 'user-deal-lead', form });
    assert.ok([200, 201].includes(upload.status), JSON.stringify(upload.data));
    const doc = upload.data;
    assert.equal(doc.status, 'indexed');
    assert.ok(doc.passage_count >= 2);

    const search = await api('/api/strategy/search?q=technology%20UAE', { user: 'user-deal-lead' });
    assert.equal(search.status, 200);
    assert.ok(search.data.citations.length >= 1);
    assert.ok(search.data.citations[0].text.toLowerCase().includes('technology'));

    await api('/api/strategy/documents/' + doc.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('publishing the profile mints a new version and records history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/strategy/profile?org_id=' + INFINIA, { user: 'user-deal-lead' });
    const priorVersion = before.data.current?.version || 0;

    const pub = await api('/api/strategy/profile', {
      method: 'POST', user: 'user-admin',
      body: { org_id: INFINIA, summary: 'W4-02 integration publish' },
    });
    assert.equal(pub.status, 201);
    assert.equal(pub.data.version, priorVersion + 1);

    const after = await api('/api/strategy/profile?org_id=' + INFINIA, { user: 'user-deal-lead' });
    assert.equal(after.data.current.version, priorVersion + 1);
    assert.ok(Array.isArray(after.data.history) && after.data.history.length >= 1);
  });

  test('a sibling entity cannot read another entity strategy library', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/strategy/documents?org_id=' + INFINIA, { user: 'user-finstreet-lead' });
    assert.equal(status, 403);
  });
});

// W4-03 - the strategy profile version recorded per screening (BRD ENT-01).
describe('strategy profile version per screening (W4-03 / ENT-01)', () => {
  test('the screening panel records the published profile version in force', async (t) => {
    if (!online) return t.skip('server offline');
    // Publish a fresh profile so a version definitely exists for this entity.
    const pub = await api('/api/strategy/profile', {
      method: 'POST', user: 'user-admin',
      body: { org_id: INFINIA, summary: 'W4-03 integration publish' },
    });
    assert.equal(pub.status, 201);
    const version = pub.data.version;

    const { draft } = await makeSubmitted('user-deal-lead');
    const res = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    assert.ok(res.data.screening.strategy_profile, 'panel carries the profile in force');
    assert.equal(res.data.screening.strategy_profile.version, version);
    assert.equal(res.data.screening.screening_record.strategy_profile_version, version);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('a new published version is reflected on the next screening', async (t) => {
    if (!online) return t.skip('server offline');
    const first = await api('/api/strategy/profile', {
      method: 'POST', user: 'user-admin', body: { org_id: INFINIA, summary: 'W4-03 v-a' },
    });
    const { draft } = await makeSubmitted('user-deal-lead');
    const before = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(before.data.screening.strategy_profile.version, first.data.version);

    const second = await api('/api/strategy/profile', {
      method: 'POST', user: 'user-admin', body: { org_id: INFINIA, summary: 'W4-03 v-b' },
    });
    assert.equal(second.data.version, first.data.version + 1);
    const after = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(after.data.screening.strategy_profile.version, second.data.version);
    assert.equal(after.data.screening.screening_record.strategy_profile_version, second.data.version);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('Sirius group mandate (W4-04 / ENT-03)', () => {
  test('a reader sees the effective mandate and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/mandate', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective mandate and default are both returned');
    assert.ok(data.config.sectors.length >= 5, 'the mandate ships sectors in scope');
    assert.equal(data.config.objective.target_year, 2030);
    assert.ok(data.vocabulary?.instruments?.length >= 1, 'the instrument vocabulary rides along');
  });

  test('a deal lead cannot change the mandate (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/mandate', {
      method: 'PUT', user: 'user-deal-lead',
      body: { sectors: ['Technology'], geography: { core: ['UAE'] } },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/mandate', { user: 'user-admin' });
    const base = before.data.config;
    const nextSectors = Array.from(new Set([...base.sectors, 'Space Systems']));
    const { status, data } = await api('/api/mandate', {
      method: 'PUT', user: 'user-admin',
      body: { sectors: nextSectors, geography: base.geography },
    });
    assert.equal(status, 200);
    assert.equal(data.config.revision, base.revision + 1);
    assert.ok(data.config.version.endsWith('.' + data.config.revision));
    assert.ok(data.changes.some((c) => c.field === 'sectors' && c.op === 'added' && c.value === 'Space Systems'));

    const after = await api('/api/mandate', { user: 'user-deal-lead' });
    assert.equal(after.data.config.revision, base.revision + 1);
    assert.ok(after.data.config.sectors.includes('Space Systems'));

    const history = await api('/api/mandate/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');
    assert.ok(history.data[0].after.changes.some((c) => c.value === 'Space Systems'));

    // Restore the shipped sectors so later runs start from the brief.
    await api('/api/mandate', {
      method: 'PUT', user: 'user-admin',
      body: { sectors: base.sectors, geography: base.geography },
    });
  });

  test('the screening panel carries the advisory mandate fit', async (t) => {
    if (!online) return t.skip('server offline');
    const { draft } = await makeSubmitted('user-deal-lead');
    const { status, data } = await api('/api/pipeline/opportunities/' + draft.id + '/screening', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const fit = data.screening.mandate_fit;
    assert.ok(fit, 'a mandate-fit section rides along');
    assert.equal(fit.sector_in_mandate, true);
    assert.equal(fit.geography_in_core, true);
    assert.equal(fit.in_scope, true);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('Document checklist (W5-01 / DOC-01)', () => {
  test('a reader sees the effective checklist and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/checklist', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective checklist and default are both returned');
    assert.equal(data.valid, true, 'the shipped default validates');
    const bp = data.config.items.find((i) => i.key === 'business_plan');
    assert.equal(bp.tier, 'mandatory');
    assert.equal(bp.enforce, true);
    assert.ok(data.config.items.length >= 14, 'one item per catalogue artefact');
  });

  test('a deal lead cannot change the checklist (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/checklist', {
      method: 'PUT', user: 'user-deal-lead',
      body: { items: [{ key: 'financials', tier: 'optional' }] },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/checklist', { user: 'user-admin' });
    const base = before.data.config;
    const items = base.items.map((i) => ({ key: i.key, label: i.label, description: i.description, tier: i.tier, enforce: i.enforce, rule: i.rule, sort_order: i.sort_order }));
    const market = items.find((i) => i.key === 'market_data');
    market.tier = 'conditional';
    market.rule = { cross_border: true };
    const { status, data } = await api('/api/checklist', { method: 'PUT', user: 'user-admin', body: { items } });
    assert.equal(status, 200);
    assert.equal(data.config.revision, base.revision + 1);
    assert.ok(data.config.version.endsWith('.' + data.config.revision));
    assert.ok(data.changes.some((c) => c.field === 'market_data' && (c.op === 'tier' || c.op === 'rule')), 'the item change is named');

    const after = await api('/api/checklist', { user: 'user-deal-lead' });
    assert.equal(after.data.config.revision, base.revision + 1);

    const history = await api('/api/checklist/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore the shipped checklist so later runs start from the brief.
    await api('/api/checklist', { method: 'PUT', user: 'user-admin', body: { items: base.items } });
  });

  test('the gate exposes the checklist vocabulary on /api/gate/fields', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/gate/fields', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const block = data.document_checklist;
    assert.ok(block, 'a document_checklist block rides along');
    assert.equal(block.version.startsWith('CL-01'), true);
    assert.ok(block.tiers.includes('mandatory') && block.tiers.includes('conditional'));
    assert.ok(block.rule_keys.includes('off_budget'));
    assert.ok(block.item_count >= 14);
  });

  test('the generated checklist blocks on business_plan when it is missing', async (t) => {
    if (!online) return t.skip('server offline');
    const { data: draft } = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead', body: { status: 'draft', ...FULL_FIELDS },
    });
    // No documents uploaded: business_plan, financials and cap_table are all due.
    const { status, data } = await api('/api/gate/opportunities/' + draft.id + '/status', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    const cl = data.gate?.document_checklist;
    assert.ok(cl, 'the gate returns the generated checklist');
    assert.ok(cl.blocking_keys.includes('business_plan'));
    assert.ok(cl.blocking_keys.includes('financials'));
    assert.equal(cl.complete, false);
    await api('/api/entities/DealOpportunity/' + draft.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});
