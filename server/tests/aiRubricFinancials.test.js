// ---------------------------------------------------------------------------
// Tab 4 (Financials and returns) rubric, Phase 2. Pure: no database, no network,
// no model.
//
//   node --test server/tests/aiRubricFinancials.test.js
//
// Covers: the four new deterministic checks, the reuse of the financial engine's
// own plausibility results (nothing recalculated), the assumptions_reasonable AI
// check and its normalisation, the original analysis guidance, the rubric version
// in the hash, and that no other tab changes.
// ---------------------------------------------------------------------------
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../config/aiReview.js';
import {
  RUBRIC_ENV_VAR, RUBRIC_GUIDANCE, RUBRIC_GUIDANCE_MAX_CHARS, RUBRIC_TOLERANCES, RUBRIC_SOURCES,
  rubricGuidance, _setRubricStateForTesting, _resetRubricStateForTesting,
} from '../config/aiRubrics.js';
import { computeFinancialModel } from '../config/financialEngine.js';
import { FIXTURE_DATA, FIXTURE_DOCS, FIXTURE_GATE, snapshotTab } from './helpers/aiRubricFixture.js';

const { runDeterministicChecks, aiCheckSpecs, normaliseValidation, buildAnalysisPrompt, buildValidationPrompt, hashTabInputs, overallStatus } = review;

const byKey = (checks, key) => checks.find((c) => c.key === key);
const run = (data, engine) => runDeterministicChecks('financials', { data, gate: FIXTURE_GATE, engine });
const STATUSES = ['pass', 'review', 'fail'];

let savedEnv;
beforeEach(() => { savedEnv = process.env[RUBRIC_ENV_VAR]; delete process.env[RUBRIC_ENV_VAR]; _resetRubricStateForTesting(); });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[RUBRIC_ENV_VAR]; else process.env[RUBRIC_ENV_VAR] = savedEnv;
  _resetRubricStateForTesting();
});

// ---------------------------------------------------------------- the checks

describe('financials rubric - scenario ordering (fin_scenario_order)', () => {
  const order = (d) => byKey(run(d), 'fin_scenario_order');

  test('downside <= base <= upside passes', () => {
    const c = order({ return_irr_downside: 12, return_irr_base: 20, return_irr_upside: 28 });
    assert.equal(c.status, 'pass');
  });
  test('a downside that beats the base fails, naming the measure', () => {
    const c = order({ return_irr_downside: 25, return_irr_base: 20, return_irr_upside: 28 });
    assert.equal(c.status, 'fail');
    assert.match(c.detail, /IRR: downside 25 is better than base 20/);
  });
  test('payback runs the other way: a shorter downside payback fails', () => {
    assert.equal(order({ return_payback_upside: 2, return_payback_years: 3, return_payback_downside: 4 }).status, 'pass');
    const c = order({ return_payback_upside: 2, return_payback_years: 3, return_payback_downside: 2.5 });
    assert.equal(c.status, 'fail');
    assert.match(c.detail, /Payback/);
  });
  test('an upside below the base fails; equal values are in order', () => {
    assert.equal(order({ return_moic_base: 2.5, return_moic_upside: 2.0 }).status, 'fail');
    assert.equal(order({ return_moic_base: 2.5, return_moic_upside: 2.5 }).status, 'pass');
  });
  test('fewer than two scenarios for every measure is review, never pass', () => {
    assert.equal(order({}).status, 'review');
    assert.equal(order({ return_irr_base: 20, return_roic_base: 15 }).status, 'review');
  });
});

describe('financials rubric - IRR and MOIC consistency (fin_returns_math)', () => {
  const math = (d) => byKey(run(d), 'fin_returns_math');

  test('agreeing figures with a plausible implied holding period pass', () => {
    // 2.0x at 20% IRR implies about 3.8 years.
    assert.equal(math({ return_irr_base: 20, return_moic_base: 2.0 }).status, 'pass');
  });
  test('a positive IRR with a multiple below 1x fails, and so does the reverse', () => {
    const a = math({ return_irr_base: 15, return_moic_base: 0.8 });
    assert.equal(a.status, 'fail');
    assert.match(a.detail, /base: IRR 15% but MOIC 0\.8x/);
    assert.equal(math({ return_irr_downside: -5, return_moic_downside: 1.4 }).status, 'fail');
  });
  test('an implied holding period outside the configured range is review, not fail', () => {
    // 1.05x at 80% IRR implies well under half a year.
    const short = math({ return_irr_base: 80, return_moic_base: 1.05 });
    assert.equal(short.status, 'review');
    assert.match(short.detail, new RegExp(`between ${RUBRIC_TOLERANCES.returns.implied_hold_years_min} and ${RUBRIC_TOLERANCES.returns.implied_hold_years_max}`));
    // 9x at 5% IRR implies about 45 years.
    assert.equal(math({ return_irr_base: 5, return_moic_base: 9 }).status, 'review');
  });
  test('only scenarios with both figures are compared; none is review', () => {
    assert.equal(math({ return_irr_base: 20 }).status, 'review');
    assert.equal(math({ return_moic_base: 2 }).status, 'review');
    assert.equal(math({}).status, 'review');
  });
  test('impossible inputs are skipped, not treated as agreement', () => {
    assert.equal(math({ return_irr_base: -100, return_moic_base: 0 }).status, 'review');
  });
  test('the holding-period range comes from the configuration', () => {
    assert.ok(RUBRIC_TOLERANCES.returns.implied_hold_years_min < RUBRIC_TOLERANCES.returns.implied_hold_years_max);
  });
});

describe('financials rubric - accretion sign (fin_accretion_sign)', () => {
  const sign = (d) => byKey(run(d), 'fin_accretion_sign');

  test('both positive, both negative, or a zero pass', () => {
    assert.equal(sign({ accretion_net_earnings_aed: 18, accretion_bps: 120 }).status, 'pass');
    assert.equal(sign({ accretion_net_earnings_aed: -3, accretion_bps: -40 }).status, 'pass');
    assert.equal(sign({ accretion_net_earnings_aed: 0, accretion_bps: 15 }).status, 'pass');
  });
  test('opposite signs fail', () => {
    assert.equal(sign({ accretion_net_earnings_aed: 18, accretion_bps: -120 }).status, 'fail');
    assert.equal(sign({ accretion_net_earnings_aed: -18, accretion_bps: 120 }).status, 'fail');
  });
  test('either figure missing is review, and says which', () => {
    const a = sign({ accretion_bps: 120 });
    assert.equal(a.status, 'review');
    assert.match(a.detail, /Net earnings added/);
    assert.match(sign({ accretion_net_earnings_aed: 5 }).detail, /Return added/);
    assert.match(sign({}).detail, /Neither/);
    assert.equal(sign({}).status, 'review');
  });
});

describe('financials rubric - USD/AED peg (fin_fx_peg)', () => {
  const peg = (d) => byKey(run(d), 'fin_fx_peg');
  const { peg_aed_per_usd: PEG, peg_tolerance_pct: TOL } = RUBRIC_TOLERANCES.fx;

  test('a rate at, or just within tolerance of, the peg passes', () => {
    assert.equal(peg({ reporting_currency: 'USD', fx_rate_usd_aed: PEG }).status, 'pass');
    assert.equal(peg({ reporting_currency: 'USD', fx_rate_usd_aed: PEG * (1 + (TOL - 0.1) / 100) }).status, 'pass');
  });
  test('a rate beyond the tolerance is review, naming the deviation', () => {
    const c = peg({ reporting_currency: 'USD', fx_rate_usd_aed: 3.9 });
    assert.equal(c.status, 'review');
    assert.match(c.detail, /from the 3\.6725 peg/);
    assert.equal(peg({ reporting_currency: 'USD', fx_rate_usd_aed: 3.4 }).status, 'review');
  });
  test('USD reporting with no rate, or an unusable rate, is review', () => {
    assert.equal(peg({ reporting_currency: 'USD' }).status, 'review');
    assert.equal(peg({ reporting_currency: 'USD', fx_rate_usd_aed: 0 }).status, 'review');
    assert.equal(peg({ reporting_currency: 'USD', fx_rate_usd_aed: -3.67 }).status, 'review');
  });
  test('an AED deal with no rate has nothing to check, so the check is not raised', () => {
    assert.equal(peg({ reporting_currency: 'AED' }), undefined);
    assert.equal(peg({}), undefined);
  });
  test('a rate recorded on an AED deal is still checked', () => {
    assert.equal(peg({ reporting_currency: 'AED', fx_rate_usd_aed: 4.5 }).status, 'review');
  });
});

// ------------------------------------------------- the financial engine, reused

describe('financials rubric - the financial engine\'s own results (financial_sanity)', () => {
  const sanityOf = (checks) => ({ sanity: { checks } });
  const item = (id, status, detail = 'detail') => ({ id, label: 'Label ' + id, status, detail });
  const fs = (engine) => byKey(run({}, engine), 'financial_sanity');

  test('a missing engine result, or an engine error, is review - never pass', () => {
    assert.equal(fs(undefined).status, 'review');
    assert.equal(fs({ error: 'boom' }).status, 'review');
    assert.equal(fs({}).status, 'review');
    assert.match(fs(undefined).detail, /could not be run/);
  });
  test('every engine check passing is the only way to pass', () => {
    assert.equal(fs(sanityOf([item('a', 'pass'), item('b', 'pass')])).status, 'pass');
  });
  test('a warning is review and carries the engine\'s own wording', () => {
    const c = fs(sanityOf([item('a', 'pass'), item('multiple_expansion', 'warn', 'Exit multiple is 3x the entry.')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /1 warning/);
    assert.match(c.detail, /Exit multiple is 3x the entry/);
  });
  test('a check the engine could not make for lack of data is review, not pass', () => {
    const c = fs(sanityOf([item('a', 'pass'), item('b', 'not_checkable')]));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /1 of 2 check\(s\) could not be made/);
  });
  test('informational results are ignored; an engine with only those is review', () => {
    assert.equal(fs(sanityOf([item('a', 'pass'), item('roic_proxy', 'info')])).status, 'pass');
    assert.equal(fs(sanityOf([item('roic_proxy', 'info')])).status, 'review');
    assert.equal(fs(sanityOf([])).status, 'review');
  });
  test('a long list of warnings stays within the detail limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => item('w' + i, 'warn', 'x'.repeat(80)));
    assert.ok(fs(sanityOf(many)).detail.length <= 400);
  });

  test('it summarises the REAL engine output without recalculating anything', () => {
    const P = ['fy3a', 'fy2a', 'fy1a', 'y1p', 'y2p', 'y3p', 'y4p', 'y5p'];
    const row = (a) => Object.fromEntries(P.map((p, i) => [p, a[i] ?? null]));
    const data = {
      total_commitment_aed: 500, exit_multiple: 8, entry_valuation_basis: 'enterprise',
      financials: {
        revenue: row([300, 340, 390, 450, 520, 600, 680, 760]),
        ebitda: row([60, 70, 80, 95, 112, 130, 148, 165]),
        net_income: row([35, 41, 47, 56, 66, 77, 88, 98]),
        capex: row([15, 16, 18, 20, 22, 24, 26, 28]),
        net_debt: row([null, null, null, 150, 120, 90, 60, 30]),
      },
    };
    const model = computeFinancialModel({ data, lines: [], thresholds: {}, wacc: { effective_wacc: 10 } });
    assert.ok(Array.isArray(model.sanity.checks) && model.sanity.checks.length > 0);
    const c = fs(model);
    assert.ok(STATUSES.includes(c.status));
    // The summary agrees with the engine's own counts.
    const warns = model.sanity.checks.filter((x) => x.status === 'warn').length;
    const unmade = model.sanity.checks.filter((x) => x.status === 'not_checkable').length;
    assert.equal(c.status === 'pass', warns === 0 && unmade === 0);
    if (warns) assert.match(c.detail, new RegExp(`${warns} warning`));
  });
});

describe('financials rubric - missing data is never an automatic pass', () => {
  test('a blank Financials tab raises only review results from the rubric checks', () => {
    const rubricKeys = ['financial_sanity', 'fin_scenario_order', 'fin_returns_math', 'fin_accretion_sign'];
    const out = run({}, undefined);
    for (const k of rubricKeys) assert.equal(byKey(out, k).status, 'review', k);
    assert.equal(byKey(out, 'fin_fx_peg'), undefined);
  });
  test('every rubric result is a rule result with a valid status and a detail', () => {
    const out = run(FIXTURE_DATA, undefined);
    for (const k of ['financial_sanity', 'fin_scenario_order', 'fin_returns_math', 'fin_accretion_sign']) {
      const c = byKey(out, k);
      assert.ok(c, k);
      assert.equal(c.source, 'rules');
      assert.ok(STATUSES.includes(c.status));
      assert.ok(c.detail && c.title);
    }
  });
  test('the new checks are appended after the existing ones', () => {
    const base = runDeterministicChecks('financials', { data: FIXTURE_DATA, gate: FIXTURE_GATE });
    const keys = base.map((c) => c.key);
    assert.ok(keys.indexOf('checklist') < keys.indexOf('financial_sanity'));
    process.env[RUBRIC_ENV_VAR] = 'none';
    const off = runDeterministicChecks('financials', { data: FIXTURE_DATA, gate: FIXTURE_GATE });
    assert.deepEqual(keys.slice(0, off.length), off.map((c) => c.key));
  });
});

// ------------------------------------------------------- the AI validation check

describe('financials rubric - assumptions_reasonable (AI validation)', () => {
  const docs = [{ original_name: 'model.xlsx', requirement_key: 'financials' }];
  const answer = (status) => ({ checks: [
    { key: 'right_document', status: 'pass', detail: 'ok' },
    { key: 'consistency', status: 'pass', detail: 'ok' },
    { key: 'assumptions_reasonable', status, detail: 'Growth is supported by the plan.' },
  ] });
  const get = (out) => byKey(out, 'assumptions_reasonable');

  test('Financials is asked for it, after the existing two; no other tab is', () => {
    assert.deepEqual(aiCheckSpecs('financials').map((s) => s.key), ['right_document', 'consistency', 'assumptions_reasonable']);
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'financials')) {
      assert.ok(!aiCheckSpecs(t).some((s) => s.key === 'assumptions_reasonable'), t);
    }
  });
  test('it is not asked for when the rubric is off', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.deepEqual(aiCheckSpecs('financials').map((s) => s.key), ['right_document', 'consistency']);
  });
  test('the prompt asks for it, scoped to the material provided', () => {
    const p = buildValidationPrompt({ tabKey: 'financials', data: FIXTURE_DATA, documents: FIXTURE_DOCS });
    assert.match(p, /key "assumptions_reasonable"/);
    assert.match(p, /use status "review"/);
  });
  test('a pass with a document attached stands', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'financials', docs, [], { data: {} })).status, 'pass');
  });
  test('a pass with no document and no financials grid is forced to review', () => {
    const c = get(normaliseValidation(answer('pass'), 'financials', [], [], { data: {} }));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /No financial document or financials grid/);
  });
  test('a captured financials grid is enough evidence without a document', () => {
    const c = get(normaliseValidation(answer('pass'), 'financials', [], [], { data: { financials: { revenue: { y1p: 10 } } } }));
    assert.equal(c.status, 'pass');
  });
  test('a failed rule check stops it passing', () => {
    const c = get(normaliseValidation(answer('pass'), 'financials', docs, [{ status: 'fail', title: 'Scenarios are in order' }], { data: {} }));
    assert.equal(c.status, 'review');
    assert.match(c.detail, /Scenarios are in order/);
  });
  test('a skipped answer is review; an unrequested key is dropped; a review or fail from the model is kept', () => {
    assert.equal(get(normaliseValidation({ checks: [] }, 'financials', docs, [], { data: {} })).status, 'review');
    assert.equal(get(normaliseValidation(answer('fail'), 'financials', docs, [], { data: {} })).status, 'fail');
    assert.equal(get(normaliseValidation(answer('review'), 'financials', docs, [], { data: {} })).status, 'review');
    assert.ok(!normaliseValidation({ checks: [{ key: 'invented', status: 'pass', detail: 'x' }] }, 'financials', docs).some((c) => c.key === 'invented'));
  });
  test('the context argument is optional (other callers are unchanged)', () => {
    assert.equal(get(normaliseValidation(answer('pass'), 'financials', docs, [])).status, 'pass');
  });
  test('it stays advisory: the worst-status rule is unchanged and nothing here blocks', () => {
    assert.equal(overallStatus([{ status: 'pass' }, { status: 'review' }]), 'review');
    const out = normaliseValidation(answer('pass'), 'financials', docs, [], { data: {} });
    assert.ok(out.every((c) => c.source === 'ai' && STATUSES.includes(c.status)));
  });
});

// ------------------------------------------------------------ analysis guidance

describe('financials rubric - original analysis guidance', () => {
  const analysis = (tab, over = {}) => buildAnalysisPrompt({ tabKey: tab, data: FIXTURE_DATA, documents: FIXTURE_DOCS, ...over });

  test('the Financials analysis prompt carries the guidance, after the research focus and before the instructions to produce', () => {
    const p = analysis('financials');
    const g = RUBRIC_GUIDANCE.financials;
    assert.ok(p.includes(g));
    assert.ok(p.indexOf('Research focus for this tab only') < p.indexOf(g));
    assert.ok(p.indexOf(g) < p.indexOf('Produce: a recommendation'));
  });
  test('no other tab\'s analysis prompt carries the Financials guidance', () => {
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'financials')) {
      assert.ok(!analysis(t).includes(RUBRIC_GUIDANCE.financials), t);
    }
    // and the tabs without a rubric carry no reviewer guidance at all
    for (const t of ['executive_summary', 'risks', 'documents']) {
      assert.ok(!analysis(t).includes('Reviewer guidance for this tab'), t);
    }
  });
  test('the guidance is outside the data fences, so it is not treated as submitted material', () => {
    const p = analysis('financials');
    const at = p.indexOf(RUBRIC_GUIDANCE.financials);
    assert.ok(at < p.indexOf('<data name='));
  });
  test('it is switched off with the rubric', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(rubricGuidance('financials'), '');
    assert.ok(!analysis('financials').includes('Reviewer guidance for this tab'));
  });
  test('it survives prompt truncation however long the submission is', () => {
    const p = analysis('financials', { data: { ...FIXTURE_DATA, narrative_what: 'long text '.repeat(6000) } });
    assert.ok(p.includes(RUBRIC_GUIDANCE.financials));
  });
  test('it asks for evidence, not figures: no outside benchmark may be quoted', () => {
    assert.match(RUBRIC_GUIDANCE.financials, /not a source of figures/);
    assert.match(RUBRIC_GUIDANCE.financials, /Not enough evidence/);
    assert.match(RUBRIC_GUIDANCE.financials, /Do not quote benchmark figures from outside the material/);
  });
  test('it contains no numeric thresholds of its own', () => {
    assert.equal(/\d\s*%|\d+\s*x\b|\bbps\b/i.test(RUBRIC_GUIDANCE.financials.replace(/^\d\.\s/gm, '')), false);
  });
  test('it fits the budget the prompt allows', () => {
    assert.ok(RUBRIC_GUIDANCE.financials.length <= RUBRIC_GUIDANCE_MAX_CHARS);
  });
  test('clean room: it records no third-party source and echoes no third-party wording', () => {
    assert.equal(RUBRIC_SOURCES.financials.origin, 'original');
    assert.equal(RUBRIC_SOURCES.financials.repo, null);
    const lower = RUBRIC_GUIDANCE.financials.toLowerCase();
    for (const phrase of ['terminal growth', 'bull', 'dscr', 'materiality', 'forecast accuracy', 'rolling forecast', 'wacc inputs', 'peg ratio', 'lead the executive summary', 'sensitivity tables', 'standard library']) {
      assert.ok(!lower.includes(phrase), phrase);
    }
  });
});

// --------------------------------------------------------- staleness and scope

describe('financials rubric - version, staleness and other tabs', () => {
  const H = (tab) => hashTabInputs(tab, FIXTURE_DATA, FIXTURE_DOCS);

  test('results stored before any rubric existed are stale for the four rubric tabs only', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    delete process.env[RUBRIC_ENV_VAR];
    const stale = review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t)));
    assert.deepEqual(stale, ['opportunity_overview', 'rationale', 'financials', 'funding']);
  });
  test('raising the Financials version stales Financials and nothing else', () => {
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: H(t) }]));
    _setRubricStateForTesting({ versions: { financials: 3 } });
    assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], H(t))), ['financials']);
  });
  test('editing a Financials field still stales Financials and no other tab', () => {
    const edited = { ...FIXTURE_DATA, return_irr_base: 40 };
    assert.notEqual(hashTabInputs('financials', edited, FIXTURE_DOCS), H('financials'));
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'financials' && x !== 'executive_summary')) {
      assert.equal(hashTabInputs(t, edited, FIXTURE_DOCS), H(t), t);
    }
  });
  test('Tabs 1, 6 and 7 are byte-identical to their pre-rubric fingerprints', async () => {
    const { default: golden } = await import('./helpers/aiRubricGolden.js');
    for (const t of ['executive_summary', 'risks', 'documents']) {
      assert.deepEqual(snapshotTab(review, t), golden[t], t);
    }
  });
  test('an engine result handed to any other tab changes nothing', () => {
    const engine = { sanity: { checks: [{ id: 'a', label: 'A', status: 'warn', detail: 'd' }] } };
    for (const t of review.AI_TAB_KEYS.filter((x) => x !== 'financials')) {
      assert.deepEqual(
        runDeterministicChecks(t, { data: FIXTURE_DATA, gate: FIXTURE_GATE, engine }),
        runDeterministicChecks(t, { data: FIXTURE_DATA, gate: FIXTURE_GATE }), t);
    }
  });
  test('with the rubric off, Financials is byte-identical to its pre-rubric fingerprint', async () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    const { default: golden } = await import('./helpers/aiRubricGolden.js');
    assert.deepEqual(snapshotTab(review, 'financials'), golden.financials);
  });
  test('the CHECK_INPUTS map names the fields behind every new check', () => {
    for (const k of ['fin_scenario_order', 'fin_returns_math', 'fin_accretion_sign', 'fin_fx_peg', 'financial_sanity', 'assumptions_reasonable']) {
      assert.ok(review.CHECK_INPUTS[k]?.length > 0, k);
    }
    assert.deepEqual(review.checkedAgainst('fin_accretion_sign', { accretion_bps: 120 }).map((x) => x.value), ['120']);
  });
});
