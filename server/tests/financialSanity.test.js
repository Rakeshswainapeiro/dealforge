// ---------------------------------------------------------------------------
// Tab 4 (Financials and returns) plausibility checks. Synthetic data only.
// Advisory: the checks warn, they never fail, and they change no return,
// hurdle or verdict. No database, no network, no model.
//
//   node --test server/tests/financialSanity.test.js
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinancialModel, sanityChecks, resolveEngineConfig, checkIntegrity, FINANCIAL_ENGINE_DEFAULTS } from '../config/financialEngine.js';
import { buildComparison } from '../config/comparison.js';

const P = ['fy3a', 'fy2a', 'fy1a', 'y1p', 'y2p', 'y3p', 'y4p', 'y5p'];
const row = (a) => Object.fromEntries(P.map((p, i) => [p, a[i] ?? null]));
const byId = (m, id) => (m.sanity ? m.sanity.checks : m.checks).find((c) => c.id === id);

// A steady, plausible business. Same shape as the engine's own fixtures.
const steady = () => ({
  revenue: row([300, 340, 390, 450, 520, 600, 680, 760]),
  ebitda: row([60, 70, 80, 95, 112, 130, 148, 165]),
  net_income: row([35, 41, 47, 56, 66, 77, 88, 98]),
  capex: row([15, 16, 18, 20, 22, 24, 26, 28]),
  net_debt: row([null, null, null, 150, 120, 90, 60, 30]),
});
const dataFor = (matrix, extra = {}) => ({ total_commitment_aed: 500, exit_multiple: 8, entry_valuation_basis: 'enterprise', financials: matrix, ...extra });
const thresholds = { equity_irr_min: 20, roic_wacc_spread: 5, payback_max_years: 3.5, concentration_max_pct: 35, leverage_max: 3 };
const WACC = { effective_wacc: 10 };

// A scenario shaped like the engine's own: flows[0] is the outlay; the last flow carries the terminal value.
const scen = (tv, fcf = 10, label = 'Base') => ({ complete: true, label, terminal_value: tv, flows: [-100, fcf, fcf, fcf, fcf, fcf + tv] });

describe('tab 4 - terminal value concentration (present value, 75% warning)', () => {
  test('exactly 75% passes; just above warns (undiscounted fallback, labelled)', () => {
    const at = sanityChecks({ scenarios: { base: scen(150) } });
    assert.equal(byId(at, 'tv_concentration').status, 'pass');
    assert.match(byId(at, 'tv_concentration').detail, /undiscounted/);
    assert.equal(byId(at, 'tv_concentration').evidence[0].tv_share_pct, 75);
    assert.equal(byId(sanityChecks({ scenarios: { base: scen(151) } }), 'tv_concentration').status, 'warn');
  });
  test('the share is measured on present values at the effective WACC', () => {
    const tv = 200; const r = 0.10;
    const flows = [-100, 10, 10, 10, 10, 10 + tv];
    const pvIn = flows.slice(1).reduce((a, f, i) => a + f / (1 + r) ** (i + 1), 0);
    const expected = Math.round(((tv / (1 + r) ** 5) / pvIn) * 1000) / 10;
    const c = byId(sanityChecks({ scenarios: { base: scen(tv) }, wacc: WACC }), 'tv_concentration');
    assert.equal(c.evidence[0].tv_share_pct, expected);
    assert.match(c.detail, /present value at 10% WACC/);
  });
  test('the thresholds WACC is used when no resolved WACC is passed', () => {
    const c = byId(sanityChecks({ scenarios: { base: scen(200) }, thresholds: { wacc_pct: 10 } }), 'tv_concentration');
    assert.match(c.detail, /10% WACC/);
  });
  test('a low terminal value passes; any scenario over the level warns and is named', () => {
    assert.equal(byId(sanityChecks({ scenarios: { base: scen(20) }, wacc: WACC }), 'tv_concentration').status, 'pass');
    const w = byId(sanityChecks({ scenarios: { base: scen(20), downside: scen(400, 10, 'Downside') }, wacc: WACC }), 'tv_concentration');
    assert.equal(w.status, 'warn');
    assert.match(w.detail, /Downside/);
  });
  test('no scenario, an incomplete scenario or no exit multiple is not_checkable', () => {
    assert.equal(byId(sanityChecks({ scenarios: {} }), 'tv_concentration').status, 'not_checkable');
    assert.equal(byId(sanityChecks({ scenarios: { base: { complete: false, flows: null, terminal_value: null } } }), 'tv_concentration').status, 'not_checkable');
  });
  test('the warning level is configurable', () => {
    const cfg = resolveEngineConfig({ sanity: { tv_share_warn_pct: 50 } });
    assert.equal(byId(sanityChecks({ scenarios: { base: scen(150) }, config: cfg }), 'tv_concentration').status, 'warn');
  });
});

describe('tab 4 - unrealistic growth', () => {
  test('steady growth passes', () => assert.equal(byId(sanityChecks({ matrix: steady() }), 'growth_realism').status, 'pass'));
  test('a year above 100% warns and is named', () => {
    const m = steady(); m.revenue = row([300, 340, 390, 450, 1125, 1300, 1400, 1500]); // Y2P +150%
    const c = byId(sanityChecks({ matrix: m }), 'growth_realism');
    assert.equal(c.status, 'warn');
    assert.match(c.detail, /Y2P \(150%\)/);
  });
  test('exactly 100% does not warn', () => {
    const m = steady(); m.revenue = row([300, 340, 390, 450, 900, 1000, 1100, 1200]);
    assert.equal(byId(sanityChecks({ matrix: m }), 'growth_realism').status, 'pass');
  });
  test('no projected revenue is not_checkable', () => assert.equal(byId(sanityChecks({ matrix: {} }), 'growth_realism').status, 'not_checkable'));
});

describe('tab 4 - hockey-stick projections', () => {
  test('a steady build passes', () => assert.equal(byId(sanityChecks({ matrix: steady() }), 'hockey_stick').status, 'pass'));
  test('projected CAGR far above history warns', () => {
    const m = steady(); m.revenue = row([300, 306, 312, 330, 400, 520, 700, 950]); // history ~2%, projection ~25%
    const c = byId(sanityChecks({ matrix: m }), 'hockey_stick');
    assert.equal(c.status, 'warn');
    assert.match(c.detail, /CAGR/);
  });
  test('growth that lands in Y4 and Y5 warns', () => {
    const m = steady(); m.revenue = row([300, 320, 340, 350, 355, 360, 600, 900]);
    assert.match(byId(sanityChecks({ matrix: m }), 'hockey_stick').detail, /lands in Y4 and Y5/);
  });
  test('margin gaining more than 10 points warns', () => {
    const m = steady(); m.ebitda = row([60, 70, 80, 95, 130, 190, 250, 330]); // ~21% -> ~43%
    assert.match(byId(sanityChecks({ matrix: m }), 'hockey_stick').detail, /margin rises/);
  });
  test('missing the last actual or Y5 is not_checkable', () => {
    assert.equal(byId(sanityChecks({ matrix: { revenue: row([null, null, null, 100, 110]) } }), 'hockey_stick').status, 'not_checkable');
  });
});

describe('tab 4 - cash conversion', () => {
  test('a normal capex load passes', () => assert.equal(byId(sanityChecks({ matrix: steady() }), 'cash_conversion').status, 'pass'));
  test('conversion below 60% warns and says what the grid measures', () => {
    const m = steady(); m.capex = row([15, 16, 18, 80, 90, 100, 110, 120]);
    const c = byId(sanityChecks({ matrix: m }), 'cash_conversion');
    assert.equal(c.status, 'warn');
    assert.match(c.detail, /EBITDA less capex/);
  });
  test('cash flow above EBITDA warns', () => {
    const m = steady(); m.capex = row([15, 16, 18, -20, -20, -20, -20, -20]); // negative capex
    assert.match(byId(sanityChecks({ matrix: m }), 'cash_conversion').detail, /above EBITDA/);
  });
  test('an uploaded operating cash flow line is used in preference', () => {
    const lines = [{ label: 'Operating cash flow', statement: 'cash_flow', values: row([null, null, null, 30, 30, 30, 30, 30]) }];
    const c = byId(sanityChecks({ matrix: steady(), lines }), 'cash_conversion');
    assert.equal(c.status, 'warn');
    assert.match(c.detail, /operating cash flow \/ EBITDA/);
  });
  test('no positive EBITDA is not_checkable', () => assert.equal(byId(sanityChecks({ matrix: { ebitda: row([]) } }), 'cash_conversion').status, 'not_checkable'));
});

describe('tab 4 - model integrity additions', () => {
  test('stated growth that disagrees with revenue warns; agreeing growth passes', () => {
    const m = steady(); m.growth = row([null, null, null, 15.4, 15.6, 15.4, 13.3, 11.8]);
    assert.equal(byId(sanityChecks({ matrix: m }), 'stated_growth_tie').status, 'pass');
    m.growth.y3p = 40;
    const c = byId(sanityChecks({ matrix: m }), 'stated_growth_tie');
    assert.equal(c.status, 'warn');
    assert.match(c.detail, /Y3P/);
  });
  test('stated net debt / EBITDA that disagrees warns', () => {
    const m = steady(); m.net_debt_ebitda = row([null, null, null, 1.58, 1.07, 0.69, 0.41, 0.18]);
    assert.equal(byId(sanityChecks({ matrix: m }), 'stated_leverage_tie').status, 'pass');
    m.net_debt_ebitda.y1p = 3;
    assert.equal(byId(sanityChecks({ matrix: m }), 'stated_leverage_tie').status, 'warn');
  });
  test('entry value / last actual EBITDA against the stated entry multiple', () => {
    const ok = sanityChecks({ matrix: steady(), data: { entry_valuation_aed: 640, entry_multiple: 8 } });
    assert.equal(byId(ok, 'entry_multiple_tie').status, 'pass');
    const bad = sanityChecks({ matrix: steady(), data: { entry_valuation_aed: 640, entry_multiple: 14 } });
    assert.equal(byId(bad, 'entry_multiple_tie').status, 'warn');
  });
  test('an exit multiple more than twice the entry multiple warns; exactly twice does not', () => {
    assert.equal(byId(sanityChecks({ data: { entry_multiple: 5, exit_multiple: 11 } }), 'multiple_expansion').status, 'warn');
    assert.equal(byId(sanityChecks({ data: { entry_multiple: 5, exit_multiple: 10 } }), 'multiple_expansion').status, 'pass');
  });
  test('checks that lack their inputs are simply absent, not failed', () => {
    const r = sanityChecks({ matrix: steady() });
    for (const id of ['stated_growth_tie', 'stated_leverage_tie', 'entry_multiple_tie', 'multiple_expansion']) assert.equal(byId(r, id), undefined, id);
  });
});

describe('tab 4 - informational ROIC proxy note', () => {
  const model = (extra = {}, lines = []) => computeFinancialModel({ data: dataFor(steady(), extra), lines, thresholds, wacc: WACC });
  test('net income proxy with net debt above zero gives an info note and changes nothing', () => {
    const m = model();
    assert.equal(m.scenarios.base.roic_basis, 'net_income_proxy');
    const c = byId(m, 'roic_proxy');
    assert.equal(c.status, 'info');
    assert.match(c.detail, /No calculation has been changed/);
  });
  test('no note when an EBIT line is supplied', () => {
    const lines = [{ label: 'EBIT', statement: 'income_statement', values: row([null, null, null, 80, 95, 110, 125, 140]) }];
    const m = model({}, lines);
    assert.notEqual(m.scenarios.base.roic_basis, 'net_income_proxy');
    assert.equal(byId(m, 'roic_proxy'), undefined);
  });
  test('no note when there is no net debt', () => {
    const d = dataFor(steady()); d.financials.net_debt = row([]);
    assert.equal(byId(computeFinancialModel({ data: d, thresholds, wacc: WACC }), 'roic_proxy'), undefined);
  });
});

describe('tab 4 - the existing calculations are untouched', () => {
  // Pinned from the engine before the sanity block existed, on this same synthetic fixture.
  const m = computeFinancialModel({ data: dataFor(steady(), { return_irr_base: 18, return_roic_base: 12, return_payback_years: 4.2, return_moic_base: 2.0 }), thresholds, wacc: WACC });
  test('flows, IRR, MOIC, payback and ROIC are exactly as before', () => {
    assert.deepEqual(m.scenarios.base.flows, [-500, 75, 90, 106, 122, 1457]);
    assert.equal(m.scenarios.base.terminal_value, 1320);
    assert.equal(m.scenarios.base.equity_irr, 35.6);
    assert.equal(m.scenarios.base.moic, 3.7);
    assert.equal(m.scenarios.base.payback_years, 4.1);
    assert.equal(m.scenarios.base.roic, 15.4);
    assert.equal(m.scenarios.base.roic_basis, 'net_income_proxy');
    assert.equal(m.scenarios.upside.equity_irr, 39.2);
    assert.equal(m.scenarios.downside.equity_irr, 23.1);
    assert.equal(m.scenarios.downside.moic, 2.47);
  });
  test('typed-versus-calculated comparison is unchanged', () => {
    const irr = m.vs_submitted.find((r) => r.metric === 'equity_irr' && r.scenario === 'base');
    assert.deepEqual([irr.submitted, irr.calculated, irr.material], [18, 35.6, true]);
  });
  test('integrity is unchanged and sanity warnings never reach it', () => {
    assert.deepEqual(m.integrity.checks.map((c) => [c.id, c.status]), [['bs_balance', 'not_checkable'], ['pl_consistency', 'pass'], ['cf_sums', 'not_checkable']]);
    assert.equal(m.integrity.failed, 0);
    const warned = computeFinancialModel({ data: dataFor({ ...steady(), revenue: row([300, 340, 390, 450, 1125, 1300, 1400, 1500]) }), thresholds, wacc: WACC });
    assert.ok(warned.sanity.warnings > 0);
    assert.equal(warned.integrity.failed, 0);
  });
  test('the model carries a sanity block; statuses are only pass, warn, info or not_checkable', () => {
    assert.ok(Array.isArray(m.sanity.checks));
    for (const c of m.sanity.checks) assert.ok(['pass', 'warn', 'info', 'not_checkable'].includes(c.status), c.id);
    assert.equal(m.sanity.warnings, m.sanity.checks.filter((c) => c.status === 'warn').length);
  });
  test('without a commitment the model still returns, with grid-only sanity checks', () => {
    const n = computeFinancialModel({ data: { financials: steady() }, thresholds });
    assert.equal(n.calculated, false);
    assert.ok(n.sanity.checks.length > 0);
    assert.equal(byId(n, 'tv_concentration').status, 'not_checkable');
  });
  test('config: defaults, overrides and a legacy stored config with no sanity block', () => {
    assert.equal(resolveEngineConfig().sanity.tv_share_warn_pct, 75);
    assert.equal(resolveEngineConfig({ sanity: { tv_share_warn_pct: 60 } }).sanity.tv_share_warn_pct, 60);
    const legacy = resolveEngineConfig({ tax_rate_pct: 9, roic_period: 'y3p' });
    assert.deepEqual(legacy.sanity, FINANCIAL_ENGINE_DEFAULTS.sanity);
    assert.ok(resolveEngineConfig().needs_sirius_confirmation.includes('sanity'));
  });
  test('a hand-built legacy config with no sanity block does not throw', () => {
    const cfg = resolveEngineConfig(); delete cfg.sanity;
    assert.doesNotThrow(() => sanityChecks({ matrix: steady(), config: cfg }));
  });
  test('integrity is callable on its own exactly as before', () => {
    assert.equal(checkIntegrity({ lines: [], matrix: {} }).ok, false);
  });
});

describe('tab 4 - warnings reach the evidence comparison', () => {
  const warnedModel = () => computeFinancialModel({ data: dataFor({ ...steady(), revenue: row([300, 340, 390, 450, 1125, 1300, 1400, 1500]) }), thresholds, wacc: WACC });
  test('a warning becomes a medium risk item; an integrity warning a low discrepancy; info a low item', () => {
    const m = warnedModel();
    const c = buildComparison({ data: dataFor(steady()), extractions: [], financials: m });
    const items = c.by_tab.financials.filter((i) => /Projected growth/.test(i.statement));
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'risk');
    assert.equal(items[0].severity, 'medium');
    const info = buildComparison({ data: {}, extractions: [], financials: computeFinancialModel({ data: dataFor(steady()), thresholds, wacc: WACC }) });
    const note = info.by_tab.financials.find((i) => /ROIC basis/.test(i.statement));
    assert.equal(note.severity, 'low');
  });
  test('passing and not_checkable checks add no items', () => {
    const m = computeFinancialModel({ data: dataFor(steady()), thresholds, wacc: WACC });
    const c = buildComparison({ data: {}, extractions: [], financials: m });
    const fin = c.by_tab.financials;
    assert.ok(fin.every((i) => !/Terminal value share|Projections are not back-loaded|Cash conversion/.test(i.statement)));
  });
  test('a legacy stored result with no sanity block still renders', () => {
    const m = warnedModel(); delete m.sanity;
    assert.doesNotThrow(() => buildComparison({ data: {}, extractions: [], financials: m }));
  });
});
