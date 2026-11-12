// ---------------------------------------------------------------------------
// Tab 5 (Funding and key asks) rubric, Phase 3. Pure: no database, no network,
// no model.
//
//   node --test server/tests/aiRubricFunding.test.js
//
// Covers: the three new funding checks (and that nothing the existing rules
// already check is repeated), the funding_plan_holds AI check and its
// normalisation, the original analysis guidance, the rubric version in the hash,
// and that every other tab, including Tab 4, is unaffected.
// ---------------------------------------------------------------------------
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../config/aiReview.js';
import {
  RUBRIC_ENV_VAR, RUBRIC_GUIDANCE, RUBRIC_GUIDANCE_MAX_CHARS, RUBRIC_TOLERANCES, RUBRIC_SOURCES,
  rubricGuidance, _setRubricStateForTesting, _resetRubricStateForTesting,
} from '../config/aiRubrics.js';
import { evaluateSourcesUses } from '../config/sourcesUses.js';
import { FIXTURE_DATA, FIXTURE_DOCS, FIXTURE_GATE, snapshotTab } from './helpers/aiRubricFixture.js';
import GOLDEN from './helpers/aiRubricGolden.js';

const { runDeterministicChecks, aiCheckSpecs, normaliseValidation, buildAnalysisPrompt, buildValidationPrompt, hashTabInputs } = review;

const NEW_KEYS = ['fund_indicative_share', 'fund_contingency', 'fund_status_consistent'];
const byKey = (checks, key) => checks.find((c) => c.key === key);
const run = (data) => runDeterministicChecks('funding', { data, gate: FIXTURE_GATE });
const STATUSES = ['pass', 'review', 'fail'];

const plan = (sources, uses = [{ key: 'purchase_price', aed: 140 }, { key: 'contingency', aed: 10 }]) => ({ funding_plan: { sources, uses } });
const src = (key, aed, status) => ({ key, aed, ...(status === undefined ? {} : { status }) });

let savedEnv;
beforeEach(() => { savedEnv = process.env[RUBRIC_ENV_VAR]; delete process.env[RUBRIC_ENV_VAR]; _resetRubricStateForTesting(); });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[RUBRIC_ENV_VAR]; else process.env[RUBRIC_ENV_VAR] = savedEnv;
  _resetRubricStateForTesting();
});

// ---------------------------------------------------------------- the checks

describe('funding rubric - how firm the other funding is (fund_indicative_share)', () => {
  const share = (d) => byKey(run(d), 'fund_indicative_share');

  test('secured and committed funding passes', () => {
    const c = share(plan([src('subsidiary_debt', 90, 'secured'), src('partner_co_investor', 20, 'committed'), src('sirius_capital', 60, 'indicative')]));
    assert.equal(c.status, 'pass');
  });
  test('Sirius\'s own ask is not counted, whatever its status', () => {
    assert.equal(share(plan([src('subsidiary_debt', 90, 'secured'), src('sirius_capital', 60, 'indicative')])).status, 'pass');
  });
  test('more than the configured share still only indicative is review', () => {
    const limit = RUBRIC_TOLERANCES.funding.indicative_share_review_pct;
    const c = share(plan([src('subsidiary_debt', 90, 'indicative'), src('partner_co_investor', 10, 'committed'), src('sirius_capital', 60, 'committed')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, new RegExp(`limit is ${limit}%`));
    assert.match(c.detail, /90% of the funding other than Sirius capital/);
  });
  test('exactly at the limit is not over it', () => {
    assert.equal(share(plan([src('subsidiary_debt', 50, 'indicative'), src('partner_co_investor', 50, 'secured'), src('sirius_capital', 60, 'committed')])).status, 'pass');
  });
  test('a source with no status stated is unconfirmed and is named', () => {
    const c = share(plan([src('subsidiary_debt', 90), src('sirius_capital', 60, 'committed')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /Subsidiary debt/);
    assert.match(c.detail, /no status/i);
  });
  test('a small unstated source within the limit is still review (a status is missing)', () => {
    const c = share(plan([src('subsidiary_debt', 90, 'secured'), src('partner_co_investor', 5), src('sirius_capital', 60, 'committed')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /no funding status stated/);
  });
  test('funding that is only Sirius capital is review, not pass', () => {
    const c = share(plan([src('sirius_capital', 150, 'committed')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /rests entirely on the ask/);
  });
  test('an uncaptured plan is review', () => {
    assert.equal(share({}).status, 'review');
    assert.match(share({}).detail, /not captured/);
    assert.equal(share({ funding_plan: { sources: [], uses: [] } }).status, 'review');
  });
  test('the numbers come from the existing sources-and-uses evaluation', () => {
    const d = plan([src('subsidiary_debt', 90, 'indicative'), src('partner_co_investor', 10, 'secured'), src('sirius_capital', 60, 'committed')]);
    const su = evaluateSourcesUses(d);
    const unconfirmed = su.sources.filter((s) => s.present && s.key !== 'sirius_capital' && s.status === 'indicative').reduce((a, s) => a + s.aed, 0);
    assert.match(share(d).detail, new RegExp(`AED ${unconfirmed} of 100 mn`));
  });
});

describe('funding rubric - a contingency (fund_contingency)', () => {
  const cont = (d) => byKey(run(d), 'fund_contingency');

  test('a contingency line above zero passes', () => {
    const c = cont(plan([src('sirius_capital', 150, 'committed')], [{ key: 'purchase_price', aed: 140 }, { key: 'contingency', aed: 10 }]));
    assert.equal(c.status, 'pass');
    assert.match(c.detail, /AED 10 mn/);
  });
  test('no contingency row, or a zero one, is review', () => {
    assert.equal(cont(plan([src('sirius_capital', 150)], [{ key: 'purchase_price', aed: 150 }])).status, 'review');
    assert.equal(cont(plan([src('sirius_capital', 150)], [{ key: 'purchase_price', aed: 150 }, { key: 'contingency', aed: 0 }])).status, 'review');
  });
  test('an uncaptured plan is review', () => {
    assert.equal(cont({}).status, 'review');
  });
  test('the minimum is read from the configuration', () => {
    assert.equal(RUBRIC_TOLERANCES.funding.contingency_min_aed, 0);
  });
});

describe('funding rubric - overall status matches the sources (fund_status_consistent)', () => {
  const cons = (d) => byKey(run(d), 'fund_status_consistent');
  const withClaim = (claim, sources) => ({ ...plan(sources), funding_sources_status: claim });

  test('no claim, nothing to compare, so the check is not raised', () => {
    assert.equal(cons(plan([src('subsidiary_debt', 90, 'secured'), src('sirius_capital', 60, 'committed')])), undefined);
    assert.equal(cons({}), undefined);
  });
  test('a claim no firmer than the weakest source passes', () => {
    assert.equal(cons(withClaim('committed', [src('subsidiary_debt', 90, 'secured'), src('partner_co_investor', 20, 'committed'), src('sirius_capital', 60, 'indicative')])).status, 'pass');
    assert.equal(cons(withClaim('indicative', [src('subsidiary_debt', 90, 'committed'), src('sirius_capital', 60, 'committed')])).status, 'pass');
  });
  test('a claim firmer than a source is review and names the source', () => {
    const c = cons(withClaim('secured', [src('subsidiary_debt', 90, 'committed'), src('sirius_capital', 60, 'committed')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /stated as secured, but Subsidiary debt is committed/);
  });
  test('a source with no status cannot back a claim', () => {
    const c = cons(withClaim('indicative', [src('subsidiary_debt', 90), src('sirius_capital', 60, 'committed')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /not given a status/);
  });
  test('Sirius\'s own ask is not compared (it is the request, not funding already in place)', () => {
    assert.equal(cons(withClaim('secured', [src('subsidiary_debt', 90, 'secured'), src('sirius_capital', 60, 'indicative')])).status, 'pass');
  });
  test('a claim with no plan, or no source besides Sirius, is review; an unknown value is review', () => {
    assert.equal(cons({ funding_sources_status: 'secured' }).status, 'review');
    assert.equal(cons(withClaim('secured', [src('sirius_capital', 150, 'committed')])).status, 'review');
    assert.equal(cons(withClaim('bogus', [src('subsidiary_debt', 90, 'secured')])).status, 'review');
  });
});

describe('funding rubric - scope and missing data', () => {
  test('only these three checks are added: nothing the existing rules already check is repeated', () => {
    const base = (() => { process.env[RUBRIC_ENV_VAR] = 'none'; const r = run(FIXTURE_DATA).map((c) => c.key); delete process.env[RUBRIC_ENV_VAR]; return r; })();
    const on = run({ ...FIXTURE_DATA, funding_sources_status: 'committed' }).map((c) => c.key);
    assert.deepEqual(on.filter((k) => !base.includes(k)), NEW_KEYS);
    for (const k of base) assert.ok(on.includes(k), 'existing check kept: ' + k);
    for (const dup of ['sources_uses', 'commitment_split', 'ask_within_total', 'funding_hierarchy', 'budget_variance', 'fund_debt_vs_ebitda']) {
      assert.ok(!NEW_KEYS.includes(dup), dup);
    }
  });
  test('the new checks come after the existing ones', () => {
    const keys = run({ ...FIXTURE_DATA, funding_sources_status: 'committed' }).map((c) => c.key);
    assert.ok(keys.indexOf('checklist') < keys.indexOf('fund_indicative_share'));
    assert.deepEqual(keys.slice(-3), NEW_KEYS);
  });
  test('a blank Funding tab raises only review results from the rubric checks', () => {
    const out = run({});
    for (const k of ['fund_indicative_share', 'fund_contingency']) assert.equal(byKey(out, k).status, 'review', k);
  });
  test('every rubric result is a rule result with a valid status, title and detail', () => {
    const out = run({ ...FIXTURE_DATA, funding_sources_status: 'committed' });
    for (const k of NEW_KEYS) {
      const c = byKey(out, k);
      assert.ok(c, k);
      assert.equal(c.source, 'rules');
      assert.ok(STATUSES.includes(c.status));
      assert.ok(c.title && c.detail);
    }
  });
  test('they are switched off with the rubric', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const keys = run({ ...FIXTURE_DATA, funding_sources_status: 'committed' }).map((c) => c.key);
    for (const k of NEW_KEYS) assert.ok(!keys.includes(k), k);
  });
  test('the fixed fixture plan is judged sound by the checks it should satisfy', () => {
    const out = run({ ...FIXTURE_DATA, funding_sources_status: 'secured' });
    assert.equal(byKey(out, 'fund_indicative_share').status, 'pass');
    assert.equal(byKey(out, 'fund_contingency').status, 'pass');
    assert.equal(byKey(out, 'fund_status_consistent').status, 'pass');
  });
});

// ------------------------------------------------------- the AI validation check

describe('funding rubric - funding_plan_holds (AI validation)', () => {
  const docs = [{ original_name: 'funding.pdf', requirement_key: 'funding_plan' }];
  const answer = (status) => ({ checks: [
    { key: 'right_document', status: 'pass', detail: 'ok' },
    { key: 'consistency', status: 'pass', detail: 'ok' },
    { key: 'funding_plan_holds', status, detail: 'The plan is spread across two sources.' },
  ] });
  const get = (out) => byKey(out, 'funding_plan_holds');
  const withPlan = { data: plan([src('subsidiary_debt', 90, 'secured'), src('sirius_capital', 60, 'committed')]) };

  test('Funding is asked for it, after the existing two; no other tab is', () => {
    assert.deepEqual(aiCheckSpecs('funding').map((s) => s.key), ['right_document', 'consistency', 'funding_plan_holds']);
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'funding')) {
      assert.ok(!aiCheckSpecs(t).some((s) => s.key === 'funding_plan_holds'), t);
    }
  });
  test('it is not asked for when the rubric is off', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(aiCheckSpecs('funding').map((s) => s.key), ['right_document', 'consistency']);
  });
  test('the prompt asks for it, scoped to the material provided', () => {
    const p = buildValidationPrompt({ tabKey: 'funding', data: FIXTURE_DATA, documents: FIXTURE_DOCS });
    assert.match(p, /key "funding_plan_holds"/);
    assert.match(p, /use status "review"/);
  });
  test('a pass with a plan captured stands', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'funding', docs, [], withPlan)).status, 'pass');
  });
  test('a pass with a document but no plan stands (there is evidence to judge from)', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'funding', docs, [], { data: {} })).status, 'pass');
  });
  test('a pass with neither a plan nor a document is forced to review', () => {
    const c = get(normaliseValidation(answer('pass'), 'funding', [], [], { data: {} }));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /No funding plan is captured and no funding document is attached/);
  });
  test('a failed rule check stops it passing', () => {
    const c = get(normaliseValidation(answer('pass'), 'funding', docs, [{ status: 'fail', title: 'Sources equal uses' }], withPlan));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /Sources equal uses/);
  });
  test('a skipped answer is review; a fail or review from the model is kept; an unrequested key is dropped', () => {
    assert.equal(get(normaliseValidation({ checks: [] }, 'funding', docs, [], withPlan)).status, 'review');
    assert.equal(get(normaliseValidation(answer('fail'), 'funding', docs, [], withPlan)).status, 'fail');
    assert.equal(get(normaliseValidation(answer('review'), 'funding', docs, [], withPlan)).status, 'review');
    assert.ok(!normaliseValidation({ checks: [{ key: 'invented', status: 'pass', detail: 'x' }] }, 'funding', docs, [], withPlan).some((c) => c.key === 'invented'));
  });
  test('the context argument is optional, and the Tab 4 check is untouched by it', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'funding', docs, [])).status, 'pass');
    const fin = normaliseValidation({ checks: [{ key: 'assumptions_reasonable', status: 'pass', detail: 'ok' }] }, 'financials', [], [], { data: {} });
    assert.equal(byKey(fin, 'assumptions_reasonable').status, 'review');
  });
  test('it stays advisory: every result is an AI-sourced pass, review or fail', () => {
    const out = normaliseValidation(answer('pass'), 'funding', docs, [], withPlan);
    assert.ok(out.every((c) => c.source === 'ai' && STATUSES.includes(c.status)));
  });
});

// ------------------------------------------------------------ analysis guidance

describe('funding rubric - original analysis guidance', () => {
  const analysis = (tab, over = {}) => buildAnalysisPrompt({ tabKey: tab, data: FIXTURE_DATA, documents: FIXTURE_DOCS, ...over });

  test('the Funding analysis prompt carries the guidance after the research focus and before the instructions to produce', () => {
    const p = analysis('funding');
    const g = RUBRIC_GUIDANCE.funding;
    assert.ok(p.includes(g));
    assert.ok(p.indexOf('Research focus for this tab only') < p.indexOf(g));
    assert.ok(p.indexOf(g) < p.indexOf('Produce: a recommendation'));
  });
  test('no other tab carries the Funding guidance, and the tabs without a rubric carry none', () => {
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'funding')) assert.ok(!analysis(t).includes(RUBRIC_GUIDANCE.funding), t);
    for (const t of ['executive_summary', 'risks', 'documents']) {
      assert.ok(!analysis(t).includes('Reviewer guidance for this tab'), t);
    }
  });
  test('the Financials prompt still carries only its own guidance', () => {
    assert.ok(analysis('financials').includes(RUBRIC_GUIDANCE.financials));
    assert.ok(!analysis('financials').includes(RUBRIC_GUIDANCE.funding));
  });
  test('the guidance sits outside the data fences', () => {
    const p = analysis('funding');
    assert.ok(p.indexOf(RUBRIC_GUIDANCE.funding) < p.indexOf('<data name='));
  });
  test('it is switched off with the rubric', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(rubricGuidance('funding'), '');
    assert.ok(!analysis('funding').includes('Reviewer guidance for this tab'));
  });
  test('it survives prompt truncation however long the submission is', () => {
    const p = analysis('funding', { data: { ...FIXTURE_DATA, narrative_what: 'long text '.repeat(6000) } });
    assert.ok(p.includes(RUBRIC_GUIDANCE.funding));
  });
  test('it asks for evidence, not figures', () => {
    assert.match(RUBRIC_GUIDANCE.funding, /not a source of figures/);
    assert.match(RUBRIC_GUIDANCE.funding, /Not enough evidence/);
    assert.match(RUBRIC_GUIDANCE.funding, /Do not quote benchmark figures from outside the material/);
  });
  test('it defers to the existing rules for the funding order and sources equal uses', () => {
    assert.match(RUBRIC_GUIDANCE.funding, /do not recalculate them/);
  });
  test('it contains no numeric thresholds of its own', () => {
    assert.equal(/\d\s*%|\d+\s*x\b|\bbps\b|\b\d{2,}\b/i.test(RUBRIC_GUIDANCE.funding.replace(/^\d\.\s/gm, '')), false);
  });
  test('it fits the budget the prompt allows', () => {
    assert.ok(RUBRIC_GUIDANCE.funding.length <= RUBRIC_GUIDANCE_MAX_CHARS);
  });
  test('clean room: original wording, the reviewed skill is recorded as reviewed (not used), no text echoed', () => {
    assert.equal(RUBRIC_SOURCES.funding.origin, 'original');
    assert.equal(RUBRIC_SOURCES.funding.repo, null);
    assert.ok(RUBRIC_SOURCES.funding.reviewed);
    const lower = RUBRIC_GUIDANCE.funding.toLowerCase();
    for (const phrase of ['liquidity is king', 'safety before yield', 'forecast aggressively', 'hedge conservatively', 'relationships matter', 'standardization',
      'treasurer', 'ctp', 'cash conversion cycle', 'dso', 'commercial paper', 'revolver', 'term debt', 'internal cash', 'capital preservation', 'segregation of duties']) {
      assert.ok(!lower.includes(phrase), phrase);
    }
  });
});

// --------------------------------------------------------- staleness and scope

describe('funding rubric - version, staleness and other tabs', () => {
  const H = (tab) => hashTabInputs(tab, FIXTURE_DATA, FIXTURE_DOCS);

  test('raising the Funding version stales Funding and nothing else', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    _setRubricStateForTesting({ versions: { funding: 3 } });
    assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), ['funding']);
  });
  test('raising the Financials version leaves Funding fresh, and the reverse', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    _setRubricStateForTesting({ versions: { financials: 3 } });
    assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), ['financials']);
    _setRubricStateForTesting({ versions: { funding: 3 } });
    assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), ['funding']);
  });
  test('editing a Funding field stales Funding and no other tab', () => {
    const edited = { ...FIXTURE_DATA, ask_aed: 61 };
    assert.notEqual(hashTabInputs('funding', edited, FIXTURE_DOCS), H('funding'));
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'funding' && x !== 'executive_summary')) {
      assert.equal(hashTabInputs(t, edited, FIXTURE_DOCS), H(t), t);
    }
  });
  test('Funding and Financials are independent: switching one off leaves the other exactly as it was', () => {
    const both = { fin: snapshotTab(review, 'financials'), fun: snapshotTab(review, 'funding') };
    process.env[RUBRIC_ENV_VAR] = 'financials';
    assert.deepEqual(snapshotTab(review, 'financials'), both.fin);
    assert.notDeepEqual(snapshotTab(review, 'funding'), both.fun);
    process.env[RUBRIC_ENV_VAR] = 'funding';
    assert.deepEqual(snapshotTab(review, 'funding'), both.fun);
    assert.notDeepEqual(snapshotTab(review, 'financials'), both.fin);
  });
  test('Tabs 1, 6 and 7 are byte-identical to their pre-rubric fingerprints', () => {
    for (const t of ['executive_summary', 'risks', 'documents']) {
      assert.deepEqual(snapshotTab(review, t), GOLDEN[t], t);
    }
  });
  test('with the rubric off, Funding is byte-identical to its pre-rubric fingerprint', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(snapshotTab(review, 'funding'), GOLDEN.funding);
  });
  test('an engine result handed to Funding changes nothing (the engine is a Tab 4 input only)', () => {
    const engine = { sanity: { checks: [{ id: 'a', label: 'A', status: 'warn', detail: 'd' }] } };
    assert.deepEqual(
      runDeterministicChecks('funding', { data: FIXTURE_DATA, gate: FIXTURE_GATE, engine }),
      runDeterministicChecks('funding', { data: FIXTURE_DATA, gate: FIXTURE_GATE }));
  });
  test('the CHECK_INPUTS map names the fields behind every new check', () => {
    for (const k of [...NEW_KEYS, 'funding_plan_holds']) assert.ok(review.CHECK_INPUTS[k]?.length > 0, k);
    assert.deepEqual(review.checkedAgainst('fund_status_consistent', { funding_sources_status: 'secured' }).map((x) => x.value), ['Secured']);
  });
});
