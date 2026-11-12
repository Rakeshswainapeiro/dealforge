// ---------------------------------------------------------------------------
// Tab 3 (Rationale and fit) rubric, Phase 4. Pure: no database, no network, no
// model.
//
//   node --test server/tests/aiRubricRationale.test.js
//
// Covers: the three new rationale checks (and that nothing the existing rules
// already check is repeated), the cross-tab fields that reach this tab only while
// its rubric is on, the buy_vs_build_reasoned AI check and its normalisation, the
// paraphrased analysis guidance and its attribution, the rubric version in the
// hash, and that every other tab is unaffected.
// ---------------------------------------------------------------------------
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../config/aiReview.js';
import {
  RUBRIC_ENV_VAR, RUBRIC_GUIDANCE, RUBRIC_GUIDANCE_MAX_CHARS, RUBRIC_EXTRA_KEYS, RUBRIC_SOURCES, RUBRIC_TOLERANCES,
  rubricGuidance, rubricExtraKeys, _setRubricStateForTesting, _resetRubricStateForTesting,
} from '../config/aiRubrics.js';
import { FIXTURE_DATA, FIXTURE_DOCS, FIXTURE_GATE, snapshotTab } from './helpers/aiRubricFixture.js';
import GOLDEN from './helpers/aiRubricGolden.js';

const { runDeterministicChecks, aiCheckSpecs, normaliseValidation, buildAnalysisPrompt, buildValidationPrompt, buildTabContext, allowedSources, hashTabInputs } = review;

const NEW_KEYS = ['rat_comparables_for_buy', 'rat_rationale_evidenced', 'rat_valuation_basis'];
const byKey = (checks, key) => checks.find((c) => c.key === key);
const run = (data, gate = FIXTURE_GATE) => runDeterministicChecks('rationale', { data, gate });
const STATUSES = ['pass', 'review', 'fail'];

let savedEnv;
beforeEach(() => { savedEnv = process.env[RUBRIC_ENV_VAR]; delete process.env[RUBRIC_ENV_VAR]; _resetRubricStateForTesting(); });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[RUBRIC_ENV_VAR]; else process.env[RUBRIC_ENV_VAR] = savedEnv;
  _resetRubricStateForTesting();
});

// ---------------------------------------------------------------- the checks

describe('rationale rubric - a purchase is anchored on comparables (rat_comparables_for_buy)', () => {
  const comps = (d) => byKey(run(d), 'rat_comparables_for_buy');

  test('a purchase that names comparable transactions passes', () => {
    assert.equal(comps({ build_buy_partner: 'buy', comparable_transactions: 'Two 2024 precedents.' }).status, 'pass');
  });
  test('a purchase with none is review', () => {
    const c = comps({ build_buy_partner: 'buy' });
    assert.equal(c.status, 'review');
    assert.match(c.detail, /no comparable transactions/);
    assert.equal(comps({ build_buy_partner: 'buy', comparable_transactions: '   ' }).status, 'review');
  });
  test('build and partner are not purchases, so the check is not raised', () => {
    assert.equal(comps({ build_buy_partner: 'build' }), undefined);
    assert.equal(comps({ build_buy_partner: 'partner' }), undefined);
  });
  test('an unstated choice is review - it is not known whether comparables are needed', () => {
    assert.equal(comps({}).status, 'review');
    assert.match(comps({}).detail, /not stated on the Opportunity overview/);
    assert.equal(comps({ build_buy_partner: '  ' }).status, 'review');
  });
});

describe('rationale rubric - the strategic reason is evidenced (rat_rationale_evidenced)', () => {
  const ev = (d) => byKey(run(d), 'rat_rationale_evidenced');

  test('the strategy link plus supporting evidence passes; either kind of evidence is enough', () => {
    assert.equal(ev({ strategy_link: 'Digital pillar.', rationale_evidence: 'Board paper.' }).status, 'pass');
    assert.equal(ev({ strategy_link: 'Digital pillar.', market_data_evidence: 'Market study.' }).status, 'pass');
  });
  test('a missing strategy link is review and named', () => {
    const c = ev({ rationale_evidence: 'Board paper.' });
    assert.equal(c.status, 'review');
    assert.match(c.detail, /link to Sirius strategy/);
    assert.doesNotMatch(c.detail, /supporting evidence/);
  });
  test('missing evidence is review and named', () => {
    const c = ev({ strategy_link: 'Digital pillar.' });
    assert.equal(c.status, 'review');
    assert.match(c.detail, /supporting evidence or market data/);
  });
  test('both missing names both; blank text counts as missing', () => {
    const c = ev({ strategy_link: '  ', rationale_evidence: '' });
    assert.equal(c.status, 'review');
    assert.match(c.detail, /link to Sirius strategy and any supporting evidence/);
  });
  test('the required why-now and why-us narratives are NOT re-checked here (the checklist already does)', () => {
    const c = ev({ strategy_link: 'x', rationale_evidence: 'y' });
    assert.equal(c.status, 'pass');
    assert.ok(!/why now|why us/i.test(c.detail));
  });
});

describe('rationale rubric - the price is not built on projections alone (rat_valuation_basis)', () => {
  const val = (m) => byKey(run(m === undefined ? {} : { entry_valuation_method: m }), 'rat_valuation_basis');

  test('observed prices and delivered results pass', () => {
    for (const m of ['trading_comps', 'precedent_transactions', 'asset_based']) assert.equal(val(m).status, 'pass', m);
  });
  test('a valuation built on a projection method is review, never fail', () => {
    const c = val('dcf');
    assert.equal(c.status, 'review');
    assert.match(c.detail, /DCF/);
    assert.match(c.detail, /projections/);
  });
  test('"other" says nothing about the basis, so it is review', () => {
    assert.equal(val('other').status, 'review');
    assert.match(val('other').detail, /without saying what it is/);
  });
  test('no method stated is review', () => {
    assert.equal(val(undefined).status, 'review');
    assert.equal(val('').status, 'review');
    assert.match(val(undefined).detail, /Financials tab/);
  });
  test('which methods count as projection-based comes from the configuration', () => {
    assert.deepEqual([...RUBRIC_TOLERANCES.rationale.projection_based_valuation_methods], ['dcf']);
    assert.deepEqual([...RUBRIC_TOLERANCES.rationale.unspecified_valuation_methods], ['other']);
  });
});

describe('rationale rubric - scope and missing data', () => {
  test('only these three checks are added: the checklist and mandate-fit checks are kept and not repeated', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const base = run(FIXTURE_DATA).map((c) => c.key);
    delete process.env[RUBRIC_ENV_VAR];
    const on = run(FIXTURE_DATA).map((c) => c.key);
    assert.deepEqual(on.filter((k) => !base.includes(k)), NEW_KEYS);
    for (const k of base) assert.ok(on.includes(k), 'existing check kept: ' + k);
    assert.ok(on.includes('checklist') && on.includes('mandate_rules'));
  });
  test('the new checks come after the existing ones', () => {
    const keys = run(FIXTURE_DATA).map((c) => c.key);
    assert.ok(keys.indexOf('mandate_rules') < keys.indexOf('rat_comparables_for_buy'));
    assert.deepEqual(keys.slice(-3), NEW_KEYS);
  });
  test('a blank Rationale tab raises only review results from the rubric checks', () => {
    const out = run({});
    for (const k of ['rat_comparables_for_buy', 'rat_rationale_evidenced', 'rat_valuation_basis']) assert.equal(byKey(out, k).status, 'review', k);
  });
  test('every rubric result is a rule result; none of them can fail, whatever the input', () => {
    const inputs = [{}, FIXTURE_DATA, { build_buy_partner: 'buy' }, { entry_valuation_method: 'dcf' }, { strategy_link: 'x' },
      { build_buy_partner: 'partner', entry_valuation_method: 'other', comparable_transactions: 'x' }];
    for (const d of inputs) {
      for (const k of NEW_KEYS) {
        const c = byKey(run(d), k);
        if (!c) continue;
        assert.equal(c.source, 'rules');
        assert.ok(['pass', 'review'].includes(c.status), `${k} ${c.status}`);
        assert.ok(c.title && c.detail);
      }
    }
  });
  test('they are switched off with the rubric', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const keys = run(FIXTURE_DATA).map((c) => c.key);
    for (const k of NEW_KEYS) assert.ok(!keys.includes(k), k);
  });
  test('Opportunity overview, which shares the mandate check, gets none of them', () => {
    const keys = runDeterministicChecks('opportunity_overview', { data: FIXTURE_DATA, gate: FIXTURE_GATE }).map((c) => c.key);
    for (const k of NEW_KEYS) assert.ok(!keys.includes(k), k);
  });
  test('the sound fixture is judged sound by the checks it should satisfy', () => {
    const out = run({ ...FIXTURE_DATA, rationale_evidence: 'Board paper.' });
    for (const k of NEW_KEYS) assert.equal(byKey(out, k).status, 'pass', k);
  });
});

// -------------------------------------------- cross-tab fields, only while on

describe('rationale rubric - fields from other tabs reach this tab only while its rubric is on', () => {
  test('on: the build/buy/partner choice, the cost of not doing it and the valuation method are in the context', () => {
    const ctx = buildTabContext('rationale', FIXTURE_DATA);
    for (const k of RUBRIC_EXTRA_KEYS.rationale) assert.ok(k in ctx.structured || FIXTURE_DATA[k] === undefined, k);
    assert.equal(ctx.structured.build_buy_partner, 'buy');
    assert.equal(ctx.structured.entry_valuation_method, 'precedent_transactions');
    assert.equal(ctx.structured.cost_of_not_doing, FIXTURE_DATA.cost_of_not_doing);
  });
  test('off: the context is exactly the tab\'s own, as before', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const ctx = buildTabContext('rationale', FIXTURE_DATA);
    assert.deepEqual(ctx.structured, {});
    assert.deepEqual(rubricExtraKeys('rationale'), []);
  });
  test('no other tab gets them', () => {
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'rationale')) {
      // Opportunity overview has its own (opportunity_type); nothing from Rationale's list leaks to it
      assert.deepEqual(rubricExtraKeys(t), t === 'opportunity_overview' ? ['opportunity_type'] : [], t);
    }
    assert.ok(!('entry_valuation_method' in buildTabContext('funding', FIXTURE_DATA).structured));
    assert.ok(!('cost_of_not_doing' in buildTabContext('financials', FIXTURE_DATA).structured));
  });
  test('they can be cited as sources only while the rubric is on', () => {
    assert.ok(allowedSources({ tabKey: 'rationale' }).includes('build_buy_partner'));
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.ok(!allowedSources({ tabKey: 'rationale' }).includes('build_buy_partner'));
  });
  test('the prompt shows them to the model', () => {
    const p = buildValidationPrompt({ tabKey: 'rationale', data: FIXTURE_DATA, documents: FIXTURE_DOCS });
    assert.match(p, /build_buy_partner: "?buy/);
    assert.match(p, /entry_valuation_method/);
  });
  test('the extra keys are read-only inputs: they are not Rationale fields', () => {
    const own = new Set(review.tabFields('rationale').map((f) => f.key));
    for (const k of RUBRIC_EXTRA_KEYS.rationale) assert.ok(!own.has(k), k);
  });
});

// ------------------------------------------------------- the AI validation check

describe('rationale rubric - buy_vs_build_reasoned (AI validation)', () => {
  const docs = [{ original_name: 'market.pdf', requirement_key: 'market_data' }];
  const answer = (status) => ({ checks: [
    { key: 'right_document', status: 'pass', detail: 'ok' },
    { key: 'intent_fit', status: 'pass', detail: 'ok' },
    { key: 'consistency', status: 'pass', detail: 'ok' },
    { key: 'buy_vs_build_reasoned', status, detail: 'The case for buying is made.' },
  ] });
  const get = (out) => byKey(out, 'buy_vs_build_reasoned');
  const written = { data: { narrative_why_now: 'The window is open.' } };

  test('Rationale is asked for it, after its existing three; no other tab is', () => {
    assert.deepEqual(aiCheckSpecs('rationale').map((s) => s.key), ['right_document', 'intent_fit', 'consistency', 'buy_vs_build_reasoned']);
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'rationale')) {
      assert.ok(!aiCheckSpecs(t).some((s) => s.key === 'buy_vs_build_reasoned'), t);
    }
  });
  test('it is not asked for when the rubric is off', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(aiCheckSpecs('rationale').map((s) => s.key), ['right_document', 'intent_fit', 'consistency']);
  });
  test('the prompt asks for it, scoped to the material provided', () => {
    const p = buildValidationPrompt({ tabKey: 'rationale', data: FIXTURE_DATA, documents: FIXTURE_DOCS });
    assert.match(p, /key "buy_vs_build_reasoned"/);
    assert.match(p, /use status "review"/);
  });
  test('a pass with a written rationale stands', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'rationale', [], [], written)).status, 'pass');
  });
  test('a pass with only a document, or only text, stands', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'rationale', docs, [], { data: {} })).status, 'pass');
    assert.equal(get(normaliseValidation(answer('pass'), 'rationale', [], [], { data: { cost_of_not_doing: 'A rival buys it.' } })).status, 'pass');
  });
  test('a pass with nothing written and no document is forced to review', () => {
    const c = get(normaliseValidation(answer('pass'), 'rationale', [], [], { data: { narrative_why_now: '   ' } }));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /No rationale is written/);
  });
  test('a failed rule check stops it passing', () => {
    const c = get(normaliseValidation(answer('pass'), 'rationale', docs, [{ status: 'fail', title: 'Something failed' }], written));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /Something failed/);
  });
  test('a skipped answer is review; a fail or review is kept; an unrequested key is dropped', () => {
    assert.equal(get(normaliseValidation({ checks: [] }, 'rationale', docs, [], written)).status, 'review');
    assert.equal(get(normaliseValidation(answer('fail'), 'rationale', docs, [], written)).status, 'fail');
    assert.equal(get(normaliseValidation(answer('review'), 'rationale', docs, [], written)).status, 'review');
    assert.ok(!normaliseValidation({ checks: [{ key: 'invented', status: 'pass', detail: 'x' }] }, 'rationale', docs, [], written).some((c) => c.key === 'invented'));
  });
  test('the context argument is optional, and the other tabs\' checks are untouched by it', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'rationale', docs, [])).status, 'pass');
    const fund = normaliseValidation({ checks: [{ key: 'funding_plan_holds', status: 'pass', detail: 'ok' }] }, 'funding', [], [], { data: {} });
    assert.equal(byKey(fund, 'funding_plan_holds').status, 'review');
  });
  test('it stays advisory: every result is an AI-sourced pass, review or fail', () => {
    const out = normaliseValidation(answer('pass'), 'rationale', docs, [], written);
    assert.ok(out.every((c) => c.source === 'ai' && STATUSES.includes(c.status)));
  });
});

// ------------------------------------------------------------ analysis guidance

describe('rationale rubric - paraphrased analysis guidance', () => {
  const analysis = (tab, over = {}) => buildAnalysisPrompt({ tabKey: tab, data: FIXTURE_DATA, documents: FIXTURE_DOCS, ...over });

  test('the Rationale analysis prompt carries the guidance after the research focus and before the instructions to produce', () => {
    const p = analysis('rationale');
    const g = RUBRIC_GUIDANCE.rationale;
    assert.ok(p.includes(g));
    assert.ok(p.indexOf('Research focus for this tab only') < p.indexOf(g));
    assert.ok(p.indexOf(g) < p.indexOf('Produce: a recommendation'));
  });
  test('no other tab carries the Rationale guidance; the tabs without a rubric carry none', () => {
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'rationale')) assert.ok(!analysis(t).includes(RUBRIC_GUIDANCE.rationale), t);
    for (const t of ['executive_summary', 'risks', 'documents']) {
      assert.ok(!analysis(t).includes('Reviewer guidance for this tab'), t);
    }
  });
  test('Financials and Funding still carry only their own guidance', () => {
    assert.ok(analysis('financials').includes(RUBRIC_GUIDANCE.financials) && !analysis('financials').includes(RUBRIC_GUIDANCE.rationale));
    assert.ok(analysis('funding').includes(RUBRIC_GUIDANCE.funding) && !analysis('funding').includes(RUBRIC_GUIDANCE.rationale));
  });
  test('the guidance sits outside the data fences', () => {
    const p = analysis('rationale');
    assert.ok(p.indexOf(RUBRIC_GUIDANCE.rationale) < p.indexOf('<data name='));
  });
  test('it is switched off with the rubric', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(rubricGuidance('rationale'), '');
    assert.ok(!analysis('rationale').includes('Reviewer guidance for this tab'));
  });
  test('it survives prompt truncation however long the submission is', () => {
    const p = analysis('rationale', { data: { ...FIXTURE_DATA, narrative_what: 'long text '.repeat(6000) } });
    assert.ok(p.includes(RUBRIC_GUIDANCE.rationale));
  });
  test('it asks for evidence, not figures, and forbids bringing in outside multiples or prices', () => {
    assert.match(RUBRIC_GUIDANCE.rationale, /not a source of figures/);
    assert.match(RUBRIC_GUIDANCE.rationale, /Not enough evidence/);
    assert.match(RUBRIC_GUIDANCE.rationale, /Do not bring in multiples or prices of your own/);
    assert.match(RUBRIC_GUIDANCE.rationale, /Do not quote benchmark figures from outside the material/);
  });
  test('it defers to the existing rules for the mandate fit', () => {
    assert.match(RUBRIC_GUIDANCE.rationale, /Take the mandate results from the rule-based results/);
  });
  test('it contains no numeric thresholds of its own', () => {
    assert.equal(/\d\s*%|\d+\s*x\b|\bbps\b|\b\d{2,}\b|\$/i.test(RUBRIC_GUIDANCE.rationale.replace(/^\d\.\s/gm, '')), false);
  });
  test('it fits the budget the prompt allows', () => {
    assert.ok(RUBRIC_GUIDANCE.rationale.length <= RUBRIC_GUIDANCE_MAX_CHARS);
  });
  test('it is a paraphrase of the acquiring side only: none of the source\'s distinctive terms, prices or sell-side material appear', () => {
    const lower = RUBRIC_GUIDANCE.rationale.toLowerCase();
    for (const term of ['acqui-hire', 'earnout', 'earn-out', 'lockup', 'loi', 'term sheet', 'data room', 'being acquired', 'illustrative',
      'arr', 'saas', 'rep & warranties', 'escrow', 'indemnification', 'sec index', 'aventis', 'software equity']) {
      assert.ok(!new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower), term);
    }
  });
  test('its source is recorded with the licence, commit, copyright and an attribution line', () => {
    const src = RUBRIC_SOURCES.rationale;
    assert.equal(src.origin, 'third_party');
    assert.equal(src.status, 'active');
    assert.equal(src.repo, 'alirezarezvani/claude-skills');
    assert.equal(src.path, 'c-level-advisor/skills/ma-playbook/SKILL.md');
    assert.equal(src.license, 'MIT');
    assert.match(src.commit, /^[0-9a-f]{40}$/);
    assert.equal(src.copyright, 'Copyright (c) 2025 Alireza Rezvani');
    assert.match(src.attribution, /Alireza Rezvani/);
    assert.match(src.attribution, /paraphrased/);
  });
});

// --------------------------------------------------------- staleness and scope

describe('rationale rubric - version, staleness and other tabs', () => {
  const H = (tab, data = FIXTURE_DATA) => hashTabInputs(tab, data, FIXTURE_DOCS);

  test('raising the Rationale version stales Rationale and nothing else', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    _setRubricStateForTesting({ versions: { rationale: 3 } });
    assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), ['rationale']);
  });
  test('raising another live tab\'s version leaves Rationale fresh', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    for (const other of ['financials', 'funding']) {
      _setRubricStateForTesting({ versions: { [other]: 3 } });
      assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), [other], other);
    }
  });
  test('editing a field of Rationale stales Rationale and no other tab', () => {
    const edited = { ...FIXTURE_DATA, strategy_link: 'A different link.' };
    assert.notEqual(H('rationale', edited), H('rationale'));
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'rationale' && x !== 'executive_summary')) assert.equal(H(t, edited), H(t), t);
  });
  test('editing the build/buy/partner choice on the Opportunity overview also stales Rationale, which reads it', () => {
    const edited = { ...FIXTURE_DATA, build_buy_partner: 'partner' };
    assert.notEqual(H('rationale', edited), H('rationale'));
    assert.notEqual(H('opportunity_overview', edited), H('opportunity_overview')); // its own field
    for (const t of ['funding', 'financials', 'risks', 'documents']) assert.equal(H(t, edited), H(t), t);
  });
  test('editing the valuation method on Financials also stales Rationale, which reads it', () => {
    const edited = { ...FIXTURE_DATA, entry_valuation_method: 'dcf' };
    assert.notEqual(H('rationale', edited), H('rationale'));
    assert.notEqual(H('financials', edited), H('financials')); // its own field
    assert.equal(H('opportunity_overview', edited), H('opportunity_overview'));
  });
  test('with the rubric off, those cross-tab edits do not touch Rationale (as before)', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(H('rationale', { ...FIXTURE_DATA, build_buy_partner: 'partner' }), H('rationale'));
    assert.equal(H('rationale', { ...FIXTURE_DATA, entry_valuation_method: 'dcf' }), H('rationale'));
  });
  test('Rationale is independent of Financials and Funding: switching either off leaves it exactly as it was', () => {
    const rat = snapshotTab(review, 'rationale');
    for (const list of ['rationale', 'rationale,financials', 'rationale,funding']) {
      process.env[RUBRIC_ENV_VAR] = list;
      assert.deepEqual(snapshotTab(review, 'rationale'), rat, list);
    }
    process.env[RUBRIC_ENV_VAR] = 'financials,funding';
    assert.deepEqual(snapshotTab(review, 'financials'), (() => { delete process.env[RUBRIC_ENV_VAR]; return snapshotTab(review, 'financials'); })());
  });
  test('Tabs 1, 6 and 7 are byte-identical to their pre-rubric fingerprints', () => {
    for (const t of ['executive_summary', 'risks', 'documents']) {
      assert.deepEqual(snapshotTab(review, t), GOLDEN[t], t);
    }
  });
  test('with the rubric off, Rationale is byte-identical to its pre-rubric fingerprint', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(snapshotTab(review, 'rationale'), GOLDEN.rationale);
  });
  test('the CHECK_INPUTS map names the fields behind every new check', () => {
    for (const k of [...NEW_KEYS, 'buy_vs_build_reasoned']) assert.ok(review.CHECK_INPUTS[k]?.length > 0, k);
    assert.deepEqual(review.checkedAgainst('rat_comparables_for_buy', { build_buy_partner: 'buy' }).map((x) => x.value), ['Buy']);
  });
});
