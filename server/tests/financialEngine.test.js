import { test } from 'node:test';
import assert from 'node:assert/strict';
import { irr, moic, payback, checkIntegrity, computeFinancialModel, resolveEngineConfig, validateEngineConfig, findLine } from '../config/financialEngine.js';
import { parseStatementLines, statementTemplateCsv } from '../config/statementModel.js';

test('IRR, MOIC and payback match hand calculations', () => {
  assert.equal(Math.round(irr([-100, 0, 0, 0, 0, 161.051]) * 100) / 100, 10);
  assert.equal(irr([100, 10]), null, 'no outflow: no IRR');
  assert.equal(irr([-100, -5]), null, 'no inflow: no IRR');
  assert.equal(moic([-100, 40, 40, 70]), 1.5);
  assert.equal(payback([-100, 40, 40, 40]), 2.5);
  assert.equal(payback([-100, 10, 10]), null);
});

const grid = (rows) => Object.fromEntries(['revenue', 'ebitda', 'capex', 'net_income', 'net_debt'].map((k) => [k, rows[k] || {}]));
const data = () => ({
  total_commitment_aed: 100, exit_multiple: 8, opportunity_type: 'acquisition',
  financials: grid({
    revenue: { fy1a: 100, y1p: 110, y2p: 121, y3p: 133, y4p: 146, y5p: 161 },
    ebitda: { fy1a: 20, y1p: 22, y2p: 25, y3p: 28, y4p: 31, y5p: 35 },
    capex: { y1p: 5, y2p: 5, y3p: 5, y4p: 5, y5p: 5 },
    net_income: { y1p: 12, y2p: 14, y3p: 16, y4p: 18, y5p: 20 },
  }),
});
const thresholds = { equity_irr_min: 20, greenfield_irr_min: 25, roic_wacc_spread: 5, wacc_pct: 10, payback_max_years: 3.5, leverage_max: 3 };

test('the engine calculates the three scenarios from the submitted grid', () => {
  const m = computeFinancialModel({ data: data(), thresholds });
  assert.equal(m.calculated, true);
  const b = m.scenarios.base;
  // flows: -100, 17, 20, 23, 26, 30 + 8*35=280 -> 310
  assert.deepEqual(b.flows, [-100, 17, 20, 23, 26, 310]);
  assert.equal(b.terminal_value, 280);
  assert.ok(b.equity_irr > 30 && b.equity_irr < 40, 'IRR ' + b.equity_irr);
  assert.equal(b.moic, 3.96);
  assert.ok(b.payback_years > 3 && b.payback_years < 5);
  assert.ok(m.scenarios.upside.equity_irr > b.equity_irr);
  assert.ok(m.scenarios.downside.equity_irr < b.equity_irr);
  assert.equal(m.scenarios.downside.exit_multiple_delta, -1);
  assert.ok(m.assumptions.length >= 3);
  assert.equal(m.hurdles.rows.find((r) => r.key === 'equity_irr').scenarios.base.meets, true);
});

test('nothing is invented: a missing exit multiple or commitment gives null, with the reason', () => {
  const d = data(); delete d.exit_multiple;
  const m = computeFinancialModel({ data: d, thresholds });
  assert.equal(m.scenarios.base.equity_irr, null);
  assert.ok(m.missing.some((x) => /exit multiple/.test(x)));
  const n = computeFinancialModel({ data: { financials: data().financials }, thresholds });
  assert.equal(n.calculated, false);
  assert.ok(n.missing.some((x) => /commitment/.test(x)));
});

test('the downside is judged survivable only if EBITDA stays positive and cash does not run out', () => {
  const d = data(); d.financials.ebitda = { y1p: 6, y2p: 7, y3p: 8, y4p: 9, y5p: 10 }; d.financials.capex = { y1p: 5, y2p: 5, y3p: 5, y4p: 5, y5p: 5 };
  const m = computeFinancialModel({ data: d, thresholds, config: resolveEngineConfig({ scenarios: { downside: { ebitda_pct: -90 } } }) });
  assert.equal(m.survivable_downside.cumulative_fcf_positive, false);
  assert.equal(m.survivable_downside.survivable, false);
  const ok = computeFinancialModel({ data: data(), thresholds });
  assert.equal(ok.survivable_downside.survivable, true);
});

test('typed returns are compared with the calculated base case', () => {
  const d = data(); d.return_irr_base = 20;
  const m = computeFinancialModel({ data: d, thresholds });
  const row = m.vs_submitted.find((r) => r.metric === 'equity_irr' && r.scenario === 'base');
  assert.equal(row.material, true);
  assert.equal(row.like_for_like, true);
});

test('configurable hurdles drive the verdict', () => {
  const strict = computeFinancialModel({ data: data(), thresholds: { ...thresholds, equity_irr_min: 60 } });
  assert.equal(strict.hurdles.rows.find((r) => r.key === 'equity_irr').scenarios.base.meets, false);
});

test('integrity: the Sirius template model balances and ties out', () => {
  const lines = parseStatementLines({ buffer: Buffer.from(statementTemplateCsv()), filename: 'm.csv' });
  assert.ok(lines.length > 0);
  const r = checkIntegrity({ lines, matrix: {} });
  assert.equal(r.checks.find((c) => c.id === 'bs_balance').status, 'pass');
  assert.equal(r.failed, 0);
  assert.ok(findLine(lines, 'revenue'));
});

test('integrity: an unbalanced balance sheet, broken cash flow and net income above EBITDA are all caught', () => {
  const P = { fy1a: 1 };
  const lines = [
    { statement: 'balance_sheet', label: 'Total assets', values: { fy1a: 200, y1p: 220 } },
    { statement: 'balance_sheet', label: 'Total liabilities', values: { fy1a: 120, y1p: 120 } },
    { statement: 'balance_sheet', label: 'Total equity', values: { fy1a: 80, y1p: 70 } },
    { statement: 'cash_flow_statement', label: 'Operating cash flow', values: { fy1a: 20 } },
    { statement: 'cash_flow_statement', label: 'Investing cash flow', values: { fy1a: -10 } },
    { statement: 'cash_flow_statement', label: 'Financing cash flow', values: { fy1a: -5 } },
    { statement: 'cash_flow_statement', label: 'Net cash flow', values: { fy1a: 9 } },
    { statement: 'profit_and_loss', label: 'EBITDA', values: { fy1a: 10 } },
    { statement: 'profit_and_loss', label: 'Net income', values: { fy1a: 15 } },
  ];
  void P;
  const r = checkIntegrity({ lines, matrix: {} });
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
  assert.equal(by.bs_balance, 'fail');
  assert.equal(by.cf_sums, 'fail');
  assert.equal(by.pl_consistency, 'fail');
  assert.equal(r.ok, false);
});

test('integrity says "not checkable" instead of passing when the lines are absent', () => {
  const r = checkIntegrity({ lines: [], matrix: {} });
  assert.ok(r.checks.every((c) => c.status === 'not_checkable'));
  assert.equal(r.ok, false);
});

test('engine config: validation and overrides', () => {
  assert.equal(validateEngineConfig({ scenarios: { downside: { ebitda_pct: -30 } }, tax_rate_pct: 9, roic_period: 'y3p' }).ok, true);
  assert.equal(validateEngineConfig({ scenarios: { base: { ebitda_pct: 5 } } }).ok, false);
  assert.equal(validateEngineConfig({ tax_rate_pct: 200 }).ok, false);
  const c = resolveEngineConfig({ scenarios: { base: { ebitda_pct: 50 }, downside: { ebitda_pct: -40 } } });
  assert.equal(c.scenarios.base.ebitda_pct, 0, 'the base case is always as submitted');
  assert.equal(c.scenarios.downside.ebitda_pct, -40);
});
