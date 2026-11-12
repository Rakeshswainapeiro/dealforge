// ---------------------------------------------------------------------------
// Tab 2 (Opportunity overview) rubric, Phase 5. Pure: no database, no network,
// no model.
//
//   node --test server/tests/aiRubricOverview.test.js
//
// Decision D2 governs this tab: only existing fields and attached documents are
// evidence; customer concentration, retention and churn are never inferred and are
// reported as "Not enough evidence"; no new fields, UI or schema. Covers: the four
// new checks on existing fields, the rules in code that make "Not enough evidence"
// impossible to override, the paraphrased guidance and its attribution, the rubric
// version in the hash, and that every other tab is unaffected.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../config/aiReview.js';
import {
  RUBRIC_ENV_VAR, RUBRIC_GUIDANCE, RUBRIC_GUIDANCE_MAX_CHARS, RUBRIC_SOURCES, RUBRIC_TOLERANCES, RUBRIC_EXTRA_KEYS,
  rubricGuidance, rubricExtraKeys, _setRubricStateForTesting, _resetRubricStateForTesting,
} from '../config/aiRubrics.js';
import { FIXTURE_DATA, FIXTURE_DOCS, FIXTURE_GATE, snapshotTab } from './helpers/aiRubricFixture.js';
import GOLDEN from './helpers/aiRubricGolden.js';

const { runDeterministicChecks, aiCheckSpecs, normaliseValidation, normaliseAnalysis, buildAnalysisPrompt, buildValidationPrompt, buildTabContext, hashTabInputs } = review;

const NEW_KEYS = ['ov_snapshot_present', 'ov_ebitda_vs_revenue', 'ov_employees_valid', 'ov_build_buy_reasoned'];
const byKey = (checks, key) => checks.find((c) => c.key === key);
const run = (data) => runDeterministicChecks('opportunity_overview', { data, gate: FIXTURE_GATE });
const STATUSES = ['pass', 'review', 'fail'];
const NEE = /^Not enough evidence/;

let savedEnv;
beforeEach(() => { savedEnv = process.env[RUBRIC_ENV_VAR]; delete process.env[RUBRIC_ENV_VAR]; _resetRubricStateForTesting(); });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[RUBRIC_ENV_VAR]; else process.env[RUBRIC_ENV_VAR] = savedEnv;
  _resetRubricStateForTesting();
});

// ---------------------------------------------------------------- the checks

describe('overview rubric - the snapshot is given for a purchase (ov_snapshot_present)', () => {
  const snap = (d) => byKey(run(d), 'ov_snapshot_present');
  const buy = { opportunity_type: 'strategic_acquisition' };

  test('revenue and EBITDA both given passes', () => {
    assert.equal(snap({ ...buy, snapshot_revenue_last_fy_aed: 80, snapshot_ebitda_last_fy_aed: 20 }).status, 'pass');
  });
  test('a missing figure is review and named; a zero is a figure', () => {
    const a = snap({ ...buy, snapshot_revenue_last_fy_aed: 80 });
    assert.equal(a.status, 'review');
    assert.match(a.detail, /EBITDA is not given/);
    assert.match(snap({ ...buy, snapshot_ebitda_last_fy_aed: 5 }).detail, /revenue is not given/);
    assert.match(snap(buy).detail, /revenue and EBITDA are not given/);
    assert.equal(snap({ ...buy, snapshot_revenue_last_fy_aed: 0, snapshot_ebitda_last_fy_aed: 0 }).status, 'pass');
  });
  test('every purchase-like type in the configuration is held to it', () => {
    for (const t of RUBRIC_TOLERANCES.overview.snapshot_expected_types) assert.equal(snap({ opportunity_type: t }).status, 'review', t);
  });
  test('other types have no operating target to describe, so the check is not raised', () => {
    for (const t of ['organic_expansion', 'greenfield', 'jv_partnership', 'structured_financial', 'technology_ip', 'passive_punt', 'related_party_governance']) {
      assert.equal(snap({ opportunity_type: t }), undefined, t);
    }
  });
  test('an unstated type is review - it is not known whether the figures are expected', () => {
    assert.equal(snap({}).status, 'review');
    assert.match(snap({}).detail, /type is not stated/);
  });
});

describe('overview rubric - EBITDA is consistent with revenue (ov_ebitda_vs_revenue)', () => {
  const eb = (rev, ebitda) => byKey(run({ snapshot_revenue_last_fy_aed: rev, snapshot_ebitda_last_fy_aed: ebitda }), 'ov_ebitda_vs_revenue');

  test('a normal margin passes', () => {
    const c = eb(80, 20);
    assert.equal(c.status, 'pass');
    assert.match(c.detail, /25%/);
  });
  test('EBITDA above revenue fails', () => {
    const c = eb(80, 95);
    assert.equal(c.status, 'fail');
    assert.match(c.detail, /larger than revenue/);
  });
  test('EBITDA equal to revenue is not above it', () => {
    assert.equal(eb(80, 80).status, 'pass');
  });
  test('negative revenue fails; zero revenue with EBITDA fails; both zero is review', () => {
    assert.equal(eb(-5, -6).status, 'fail');
    assert.equal(eb(0, 3).status, 'fail');
    assert.equal(eb(0, 0).status, 'review');
  });
  test('a margin far below the range is review, not fail, and the range comes from the configuration', () => {
    const { ebitda_margin_min_pct: lo } = RUBRIC_TOLERANCES.overview;
    assert.equal(eb(100, lo).status, 'pass'); // exactly at the limit
    const c = eb(100, lo - 50);
    assert.equal(c.status, 'review');
    assert.match(c.detail, /check the figures and units/);
  });
  test('a missing figure is left to ov_snapshot_present, so this check is not raised', () => {
    assert.equal(eb(undefined, 20), undefined);
    assert.equal(eb(80, undefined), undefined);
    assert.equal(eb(null, null), undefined);
  });
});

describe('overview rubric - the headcount is sensible (ov_employees_valid)', () => {
  const emp = (n) => byKey(run(n === undefined ? {} : { snapshot_employees: n }), 'ov_employees_valid');

  test('a whole number above zero passes', () => {
    assert.equal(emp(140).status, 'pass');
  });
  test('negative fails; zero or fractional is review', () => {
    assert.equal(emp(-3).status, 'fail');
    assert.equal(emp(0).status, 'review');
    const f = emp(12.5);
    assert.equal(f.status, 'review');
    assert.match(f.detail, /full-time equivalents/);
  });
  test('blank or non-numeric is review', () => {
    assert.equal(emp(undefined).status, 'review');
    assert.equal(emp('').status, 'review');
    assert.equal(emp('about 100').status, 'review');
    assert.match(emp('about 100').detail, /not a number/);
  });
});

describe('overview rubric - a purchase says what happens if it is not done (ov_build_buy_reasoned)', () => {
  const bb = (d) => byKey(run(d), 'ov_build_buy_reasoned');

  test('a purchase with the cost of not doing it stated passes', () => {
    assert.equal(bb({ build_buy_partner: 'buy', cost_of_not_doing: 'A rival acquires it.' }).status, 'pass');
  });
  test('a purchase without it is review', () => {
    assert.equal(bb({ build_buy_partner: 'buy' }).status, 'review');
    assert.equal(bb({ build_buy_partner: 'buy', cost_of_not_doing: '  ' }).status, 'review');
  });
  test('an unstated choice is review; build and partner do not raise it', () => {
    assert.equal(bb({}).status, 'review');
    assert.equal(bb({ build_buy_partner: 'build' }), undefined);
    assert.equal(bb({ build_buy_partner: 'partner' }), undefined);
  });
});

describe('overview rubric - scope and missing data', () => {
  test('only these four checks are added; the checklist and the shared mandate-fit check are kept and not repeated', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const base = run(FIXTURE_DATA).map((c) => c.key);
    delete process.env[RUBRIC_ENV_VAR];
    const on = run(FIXTURE_DATA).map((c) => c.key);
    assert.deepEqual(on.filter((k) => !base.includes(k)).sort(), NEW_KEYS.filter((k) => on.includes(k)).sort());
    for (const k of base) assert.ok(on.includes(k), 'existing check kept: ' + k);
    assert.ok(on.includes('checklist') && on.includes('mandate_rules'));
  });
  test('the new checks come after the existing ones', () => {
    const keys = run(FIXTURE_DATA).map((c) => c.key);
    assert.ok(keys.indexOf('mandate_rules') < keys.indexOf('ov_snapshot_present'));
  });
  test('a blank tab raises review, never pass, from the rubric checks (and omits the ones with nothing to compare)', () => {
    const out = run({});
    for (const k of ['ov_snapshot_present', 'ov_employees_valid', 'ov_build_buy_reasoned']) assert.equal(byKey(out, k).status, 'review', k);
    assert.equal(byKey(out, 'ov_ebitda_vs_revenue'), undefined);
  });
  test('every rubric result is a rule result with a valid status, title and detail', () => {
    for (const d of [{}, FIXTURE_DATA, { opportunity_type: 'bolt_on', snapshot_revenue_last_fy_aed: 5, snapshot_ebitda_last_fy_aed: 9, snapshot_employees: -1, build_buy_partner: 'buy' }]) {
      for (const c of run(d).filter((x) => NEW_KEYS.includes(x.key))) {
        assert.equal(c.source, 'rules');
        assert.ok(STATUSES.includes(c.status));
        assert.ok(c.title && c.detail);
      }
    }
  });
  test('they are switched off with the rubric, and no other tab gets them', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const off = run(FIXTURE_DATA).map((c) => c.key);
    for (const k of NEW_KEYS) assert.ok(!off.includes(k), k);
    delete process.env[RUBRIC_ENV_VAR];
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'opportunity_overview')) {
      const keys = runDeterministicChecks(t, { data: FIXTURE_DATA, gate: FIXTURE_GATE }).map((c) => c.key);
      for (const k of NEW_KEYS) assert.ok(!keys.includes(k), `${t} ${k}`);
    }
  });
  test('the snapshot figures are never inferred: customer, retention and churn are not checked in code at all', () => {
    const keys = run(FIXTURE_DATA).map((c) => c.key).join(' ');
    assert.doesNotMatch(keys, /concentration|retention|churn|nrr|recurring/i);
  });
  test('the sound fixture passes the checks it should satisfy', () => {
    const out = run(FIXTURE_DATA);
    for (const k of NEW_KEYS) assert.equal(byKey(out, k).status, 'pass', k);
  });
});

// -------------------------------------------- the opportunity type, only while on

describe('overview rubric - the opportunity type reaches this tab only while its rubric is on', () => {
  test('on: it is in the context; off: it is not, and the context is exactly the tab\'s own', () => {
    assert.equal(buildTabContext('opportunity_overview', FIXTURE_DATA).structured.opportunity_type, 'strategic_acquisition');
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(buildTabContext('opportunity_overview', FIXTURE_DATA).structured, {});
    assert.deepEqual(rubricExtraKeys('opportunity_overview'), []);
  });
  test('it is a header field, not an Opportunity overview field', () => {
    const own = new Set(review.tabFields('opportunity_overview').map((f) => f.key));
    for (const k of RUBRIC_EXTRA_KEYS.opportunity_overview) assert.ok(!own.has(k), k);
  });
  test('Rationale\'s extra fields are untouched by it', () => {
    assert.deepEqual(rubricExtraKeys('rationale'), [...RUBRIC_EXTRA_KEYS.rationale]);
  });
});

// ----------------------------------- D2: "Not enough evidence", enforced in code

describe('overview rubric - D2: Not enough evidence cannot be overridden by the model (validation)', () => {
  const answer = (key, status) => ({ checks: [
    { key: 'right_document', status: 'pass', detail: 'ok' },
    { key: 'intent_fit', status: 'pass', detail: 'ok' },
    { key: 'consistency', status: 'pass', detail: 'ok' },
    { key: 'claims_evidenced', status: key === 'claims_evidenced' ? status : 'review', detail: 'The plan supports it.' },
    { key: 'dd_red_flags', status: key === 'dd_red_flags' ? status : 'review', detail: 'No warning signs found.' },
  ] });
  const docs = [{ original_name: 'plan.pdf', requirement_key: 'business_plan' }];
  const rich = { d1: 'Top five customers account for 38% of revenue. Customer retention was 91% last year; 70% of revenue is recurring on 3-year contracts.' };
  const get = (out, key) => byKey(out, key);
  const val = (key, status, documents, context) => get(normaliseValidation(answer(key, status), 'opportunity_overview', documents, [], context), key);

  test('the tab is asked for both checks, after its existing three; no other tab is', () => {
    assert.deepEqual(aiCheckSpecs('opportunity_overview').map((s) => s.key), ['right_document', 'intent_fit', 'consistency', 'claims_evidenced', 'dd_red_flags']);
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'opportunity_overview')) {
      assert.ok(!aiCheckSpecs(t).some((s) => ['claims_evidenced', 'dd_red_flags'].includes(s.key)), t);
    }
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(aiCheckSpecs('opportunity_overview').map((s) => s.key), ['right_document', 'intent_fit', 'consistency']);
  });
  test('the prompt tells the model to say "Not enough evidence" and use review when the documents lack the data', () => {
    const p = buildValidationPrompt({ tabKey: 'opportunity_overview', data: FIXTURE_DATA, documents: FIXTURE_DOCS });
    assert.match(p, /key "claims_evidenced"/);
    assert.match(p, /key "dd_red_flags"/);
    assert.match(p, /begin the detail with "Not enough evidence"/);
  });
  for (const key of ['claims_evidenced', 'dd_red_flags']) {
    test(`${key}: a pass with no document attached is forced to review, starting "Not enough evidence"`, () => {
      const c = val(key, 'pass', [], { data: {}, snippets: {} });
      assert.equal(c.status, 'review');
      assert.match(c.detail, NEE);
      assert.match(c.detail, /no document is attached/);
    });
    test(`${key}: a pass when the attached documents could not be read is forced to review`, () => {
      const c = val(key, 'pass', docs, { data: {}, snippets: { d1: null, d2: '   ' } });
      assert.equal(c.status, 'review');
      assert.match(c.detail, NEE);
      assert.match(c.detail, /could not be read/);
    });
    test(`${key}: a failed rule check stops a pass`, () => {
      const c = val(key, 'pass', docs, { data: {}, snippets: rich });
      assert.equal(c.status, 'pass'); // baseline: with evidence and no failure it stands
      const blocked = normaliseValidation(answer(key, 'pass'), 'opportunity_overview', docs, [{ status: 'fail', title: 'EBITDA is consistent with revenue' }], { data: {}, snippets: rich });
      assert.equal(get(blocked, key).status, 'review');
      assert.match(get(blocked, key).detail, /EBITDA is consistent with revenue/);
    });
    test(`${key}: a model "review" or "fail" is kept, even with no evidence`, () => {
      assert.equal(val(key, 'review', [], { data: {}, snippets: {} }).status, 'review');
      assert.equal(val(key, 'fail', [], { data: {}, snippets: {} }).status, 'fail');
    });
    test(`${key}: a skipped answer is review`, () => {
      assert.equal(get(normaliseValidation({ checks: [] }, 'opportunity_overview', docs, [], { data: {}, snippets: rich }), key).status, 'review');
    });
  }

  test('claims_evidenced: any readable document is enough for a pass to stand (no commercial-data gate)', () => {
    assert.equal(val('claims_evidenced', 'pass', docs, { data: {}, snippets: { d1: 'A short company profile with no figures.' } }).status, 'pass');
  });
  test('dd_red_flags: "no warning signs" stands only when the documents hold commercial data to test', () => {
    assert.equal(val('dd_red_flags', 'pass', docs, { data: {}, snippets: rich }).status, 'pass');
    const none = val('dd_red_flags', 'pass', docs, { data: {}, snippets: { d1: 'A short company profile with no figures.' } });
    assert.equal(none.status, 'review');
    assert.match(none.detail, NEE);
    assert.match(none.detail, /customer, retention, contract or recurring-revenue figures/);
  });
  test('dd_red_flags: a subject without a number, or a number without a subject, is not commercial data', () => {
    assert.equal(val('dd_red_flags', 'pass', docs, { data: {}, snippets: { d1: 'Our customers love us and renew every year.' } }).status, 'review');
    assert.equal(val('dd_red_flags', 'pass', docs, { data: {}, snippets: { d1: 'Founded in 2009 with 140 staff in Dubai.' } }).status, 'review');
  });
  test('without snippets in the context, a pass cannot be confirmed for dd_red_flags, while claims_evidenced relies on the attached documents', () => {
    assert.equal(val('dd_red_flags', 'pass', docs, { data: {} }).status, 'review');
    assert.equal(val('dd_red_flags', 'pass', docs, undefined).status, 'review');
    assert.equal(val('claims_evidenced', 'pass', docs, { data: {} }).status, 'pass');
    assert.equal(val('claims_evidenced', 'pass', [], { data: {} }).status, 'review');
  });
  test('the rules apply to this tab only', () => {
    const other = normaliseValidation({ checks: [{ key: 'consistency', status: 'pass', detail: 'ok' }] }, 'risks', [], [], { data: {}, snippets: {} });
    assert.equal(byKey(other, 'consistency').status, 'pass');
    const fin = normaliseValidation({ checks: [{ key: 'assumptions_reasonable', status: 'pass', detail: 'ok' }] }, 'financials', docs, [], { data: {}, snippets: {} });
    assert.equal(byKey(fin, 'assumptions_reasonable').status, 'pass');
  });
  test('results stay AI-sourced pass, review or fail', () => {
    const out = normaliseValidation(answer('dd_red_flags', 'pass'), 'opportunity_overview', docs, [], { data: {}, snippets: rich });
    assert.ok(out.every((c) => c.source === 'ai' && STATUSES.includes(c.status)));
  });
  test('the validation run hands the document text to normalisation (checked in the source, as it needs a database to run)', () => {
    const src = fs.readFileSync(new URL('../aiReview.js', import.meta.url), 'utf8');
    assert.match(src, /normaliseValidation\(raw, tab, tabDocuments\(tab, documents\), ruleChecks, \{ data, snippets: material\.snippets \}\)/);
  });
});

describe('overview rubric - D2: Not enough evidence in the analysis', () => {
  const raw = (rating = 'Strong') => ({
    recommendation: { rating, summary: 'Looks good.' },
    items: [
      { title: 'Customers', rating: 'Strong', summary: 'Diverse base.', why: 'The plan says so.', sources: ['Revenue last FY (AED mn)'] },
      { title: 'Moat', rating: 'Adequate', summary: 'Some.', why: 'Stated.', sources: [] },
      { title: 'Market', rating: 'Not enough evidence', summary: 'None given.', why: 'No data.', sources: [] },
    ],
    low_confidence: [{ label: 'Founder claim', note: 'Only the founder says so.', level: 'Medium' }],
  });
  const norm = (r, snippets, tabKey = 'opportunity_overview') => normaliseAnalysis(r, { tabKey, documents: [], passages: [], data: FIXTURE_DATA, snippets });
  const none = { d1: null };
  const rich = { d1: 'Top five customers account for 38% of revenue; retention was 91%.' };

  test('with no document text, nothing is rated Strong, the overall is capped, and the output says Not enough evidence', () => {
    const out = norm(raw(), none);
    assert.ok(out.items.every((i) => i.rating !== 'Strong'));
    assert.equal(out.items[0].rating, 'Adequate');
    assert.equal(out.recommendation.rating, 'Adequate');
    assert.equal(out.low_confidence[0].label, 'Commercial evidence');
    assert.match(out.low_confidence[0].note, NEE);
    assert.equal(out.low_confidence[0].level, 'Low');
    assert.equal(out.low_confidence[1].label, 'Founder claim');
  });
  test('the model\'s own "Not enough evidence" ratings are kept', () => {
    assert.equal(norm(raw(), none).items[2].rating, 'Not enough evidence');
  });
  test('documents that hold commercial data lift the cap: the model\'s ratings stand and no note is added', () => {
    const out = norm(raw(), rich);
    assert.equal(out.items[0].rating, 'Strong');
    assert.equal(out.low_confidence.some((l) => l.label === 'Commercial evidence'), false);
  });
  test('readable documents with no commercial data still count as no evidence', () => {
    const out = norm(raw(), { d1: 'A profile of the company with no figures at all.' });
    assert.equal(out.items[0].rating, 'Adequate');
    assert.equal(out.low_confidence[0].label, 'Commercial evidence');
  });
  test('the list never exceeds its limit, and the note comes first', () => {
    const r = raw();
    r.low_confidence = Array.from({ length: 9 }, (_, i) => ({ label: 'L' + i, note: 'n', level: 'Low' }));
    const out = norm(r, none);
    assert.equal(out.low_confidence.length, 6);
    assert.equal(out.low_confidence[0].label, 'Commercial evidence');
  });
  test('it applies only while the rubric is on', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const out = norm(raw(), none);
    assert.equal(out.items[0].rating, 'Strong');
    assert.equal(out.low_confidence.some((l) => l.label === 'Commercial evidence'), false);
  });
  test('it applies only when the caller supplied the document text', () => {
    const out = normaliseAnalysis(raw(), { tabKey: 'opportunity_overview', documents: [], passages: [], data: FIXTURE_DATA });
    assert.equal(out.items[0].rating, 'Strong');
  });
  test('it never touches another tab', () => {
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'opportunity_overview')) {
      const withRubric = norm(raw(), none, t);
      process.env[RUBRIC_ENV_VAR] = 'none';
      const without = norm(raw(), none, t);
      delete process.env[RUBRIC_ENV_VAR];
      assert.deepEqual(withRubric, without, t); // identical whether the rubric is on or off
      assert.equal(withRubric.low_confidence.some((l) => l.label === 'Commercial evidence'), false, t);
    }
  });
});

// ------------------------------------------------------------ analysis guidance

describe('overview rubric - paraphrased analysis guidance', () => {
  const analysis = (tab, over = {}) => buildAnalysisPrompt({ tabKey: tab, data: FIXTURE_DATA, documents: FIXTURE_DOCS, ...over });
  const g = () => RUBRIC_GUIDANCE.opportunity_overview;

  test('the Opportunity overview analysis prompt carries the guidance after the research focus and before the instructions to produce', () => {
    const p = analysis('opportunity_overview');
    assert.ok(p.includes(g()));
    assert.ok(p.indexOf('Research focus for this tab only') < p.indexOf(g()));
    assert.ok(p.indexOf(g()) < p.indexOf('Produce: a recommendation'));
  });
  test('no other tab carries it; the tabs without a rubric carry no guidance at all; the other rubric tabs keep their own', () => {
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'opportunity_overview')) assert.ok(!analysis(t).includes(g()), t);
    for (const t of ['executive_summary', 'risks', 'documents']) assert.ok(!analysis(t).includes('Reviewer guidance for this tab'), t);
    for (const t of ['rationale', 'financials', 'funding']) assert.ok(analysis(t).includes(RUBRIC_GUIDANCE[t]), t);
  });
  test('the guidance sits outside the data fences, survives truncation, and is switched off with the rubric', () => {
    const p = analysis('opportunity_overview');
    assert.ok(p.indexOf(g()) < p.indexOf('<data name='));
    assert.ok(analysis('opportunity_overview', { data: { ...FIXTURE_DATA, narrative_what: 'long text '.repeat(6000) } }).includes(g()));
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(rubricGuidance('opportunity_overview'), '');
    assert.ok(!analysis('opportunity_overview').includes('Reviewer guidance for this tab'));
  });
  test('it enforces D2 in its own words: judge from the material only, Not enough evidence, never infer a figure', () => {
    assert.match(g(), /not a source of figures/);
    assert.match(g(), /Judge only from the fields and the attached documents/);
    assert.match(g(), /Not enough evidence/);
    assert.match(g(), /Never infer a figure/);
    assert.match(g(), /Do not quote benchmark figures from outside the material/);
  });
  test('it names no numeric thresholds of its own', () => {
    assert.equal(/\d\s*%|\d+\s*x\b|\bbps\b|\b\d{2,}\b|\$/i.test(g().replace(/^\d\.\s/gm, '')), false);
  });
  test('it fits the budget the prompt allows', () => {
    assert.ok(g().length <= RUBRIC_GUIDANCE_MAX_CHARS, String(g().length));
  });
  test('it is a paraphrase: none of the source\'s thresholds, deliverables or distinctive terms appear', () => {
    const lower = g().toLowerCase();
    for (const term of ['nrr', 'cohort', 'pareto', '2x2', 'glassdoor', 'a/b/c/f', 'walk away', 'proceed with conditions', 'cim', 'dealbreaker',
      'arr', 'nps', 'sales cycle', 'quota', 'risk matrix', 'scorecard', 'reference checks', 'investment recommendation']) {
      assert.ok(!new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`).test(lower), term);
    }
  });
  test('its source is recorded with licence, commit, copyright and an attribution line', () => {
    const src = RUBRIC_SOURCES.opportunity_overview;
    assert.equal(src.origin, 'third_party');
    assert.equal(src.status, 'active');
    assert.equal(src.repo, 'gcamilo/management-consulting');
    assert.equal(src.path, 'variants/due-diligence.md');
    assert.equal(src.license, 'MIT');
    assert.match(src.commit, /^[0-9a-f]{40}$/);
    assert.match(src.copyright, /^Copyright \(c\) 2026/);
    assert.match(src.attribution, /gcamilo\/management-consulting/);
    assert.match(src.attribution, /paraphrased/);
    assert.match(src.note, /Not enough evidence/);
  });
});

// --------------------------------------------------------- staleness and scope

describe('overview rubric - version, staleness and other tabs', () => {
  const H = (tab, data = FIXTURE_DATA) => hashTabInputs(tab, data, FIXTURE_DOCS);

  test('raising the Opportunity overview version stales it and nothing else', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    _setRubricStateForTesting({ versions: { opportunity_overview: 3 } });
    assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), ['opportunity_overview']);
  });
  test('raising another rubric tab\'s version leaves it fresh', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    for (const other of ['rationale', 'financials', 'funding']) {
      _setRubricStateForTesting({ versions: { [other]: 3 } });
      assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), [other], other);
    }
  });
  test('editing one of its own fields stales it and no other tab', () => {
    const edited = { ...FIXTURE_DATA, snapshot_employees: 150 };
    assert.notEqual(H('opportunity_overview', edited), H('opportunity_overview'));
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'opportunity_overview' && x !== 'executive_summary')) assert.equal(H(t, edited), H(t), t);
  });
  test('editing the opportunity type also stales it while on (it reads it), and not when off', () => {
    const edited = { ...FIXTURE_DATA, opportunity_type: 'bolt_on' };
    assert.notEqual(H('opportunity_overview', edited), H('opportunity_overview'));
    for (const t of ['rationale', 'financials', 'funding', 'risks', 'documents']) assert.equal(H(t, edited), H(t), t);
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(H('opportunity_overview', edited), H('opportunity_overview'));
  });
  test('the four rubric tabs are independent: switching any one off leaves the other three exactly as they were', () => {
    const all = Object.fromEntries(['opportunity_overview', 'rationale', 'financials', 'funding'].map((t) => [t, snapshotTab(review, t)]));
    for (const off of Object.keys(all)) {
      process.env[RUBRIC_ENV_VAR] = Object.keys(all).filter((t) => t !== off).join(',');
      for (const t of Object.keys(all).filter((x) => x !== off)) assert.deepEqual(snapshotTab(review, t), all[t], `${t} with ${off} off`);
      assert.deepEqual(snapshotTab(review, off), GOLDEN[off], `${off} is back to its pre-rubric fingerprint`);
    }
  });
  test('Tabs 1, 6 and 7 are byte-identical to their pre-rubric fingerprints', () => {
    for (const t of ['executive_summary', 'risks', 'documents']) assert.deepEqual(snapshotTab(review, t), GOLDEN[t], t);
  });
  test('with every rubric off, all seven tabs are byte-identical to their pre-rubric fingerprints', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    for (const t of review.AI_TAB_KEYS) assert.deepEqual(snapshotTab(review, t), GOLDEN[t], t);
  });
  test('the CHECK_INPUTS map names the fields behind every new check', () => {
    for (const k of [...NEW_KEYS, 'claims_evidenced', 'dd_red_flags']) assert.ok(review.CHECK_INPUTS[k]?.length > 0, k);
    assert.deepEqual(review.checkedAgainst('ov_employees_valid', { snapshot_employees: 140 }).map((x) => x.value), ['140']);
  });
  test('no field, schema or UI definition is added: the intake model is unchanged', () => {
    assert.equal(review.tabFields('opportunity_overview').length, 9);
    assert.equal(review.AI_TABS.find((t) => t.key === 'opportunity_overview').extra.length, 0);
  });
});
