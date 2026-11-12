// ---------------------------------------------------------------------------
// Financial calculation engine (Phase 1: IRR, ROIC, MOIC, payback; base, upside
// and survivable-downside scenarios; P&L / balance sheet / cash flow integrity;
// Sirius hurdles).
//
// Pure: no database, no network. Every figure is calculated from what the
// Preparer submitted (the Financials grid, the commitment and the exit multiple,
// plus the uploaded three-statement model where one was supplied). Nothing is
// defaulted: a figure that cannot be calculated is null and `missing` says what
// would be needed. Every number carries the assumptions it rests on.
//
// What the calculation is, stated plainly:
//   * Deal-level, 100% basis. Cash out = total commitment at the start. Cash in =
//     the projected free cash flow of Y1-Y5 plus a terminal value at the end of
//     Y5 (exit multiple x Y5 EBITDA, less Y5 net debt when the entry value is an
//     equity value). It does not model Sirius's stake, fees, or the financing
//     structure, so it is an approximation of Equity IRR, labelled as such.
//   * Upside and downside are Sirius-configured sensitivities of the Preparer's
//     base case (EBITDA flex, exit multiple change), not the Preparer's own
//     scenarios. The Preparer's own typed scenario figures are compared with the
//     calculated ones and any difference is reported.
// The hurdle comparison reuses computeHurdles() from hurdleTable.js, so hurdles
// stay in the one configurable place (mandate thresholds).
// ---------------------------------------------------------------------------

import { FINANCIAL_PERIOD_KEYS, PROJECTION_PERIOD_KEYS, deriveFinancials } from './financials.js';
import { computeHurdles } from './hurdleTable.js';

export const FINANCIAL_ENGINE_VERSION = 1;
export const FINANCIAL_ENGINE_SETTING_KEY = 'financial_engine';

// Sirius-configurable assumptions. Stored overrides (AppSettings) are merged over
// these. The flexes are starting points awaiting Sirius confirmation.
export const FINANCIAL_ENGINE_DEFAULTS = {
  scenarios: {
    base: { label: 'Base', ebitda_pct: 0, exit_multiple_delta: 0 },
    upside: { label: 'Upside', ebitda_pct: 10, exit_multiple_delta: 0 },
    downside: { label: 'Downside', ebitda_pct: -25, exit_multiple_delta: -1 },
  },
  tax_rate_pct: 9,            // UAE corporate tax; used for NOPAT when EBIT is known
  roic_period: 'y3p',         // the year whose ROIC is the headline
  tolerances: { irr_pp: 2, moic_x: 0.2, payback_years: 0.5, roic_pp: 2, balance_pct: 0.5, tie_pct: 1 },
  // Plausibility warnings. Advisory only: they never change a return, a hurdle or a
  // verdict. Every value is a proposed starting point awaiting Sirius confirmation.
  sanity: {
    tv_share_warn_pct: 75,          // terminal value's share of the present value of inflows
    growth_flag_pct: 100,           // a projected year growing faster than this
    hockey_cagr_ratio: 2,           // projected revenue CAGR at least this many times the historical CAGR ...
    hockey_min_cagr_pct: 10,        // ... and at least this high
    hockey_backload_pct: 60,        // share of the Y0-Y5 increase that lands in Y4 and Y5
    hockey_margin_pp: 10,           // EBITDA margin gained over the projection
    cash_conversion_min_pct: 60,    // projected cash flow as a share of EBITDA
    multiple_expansion_ratio: 2,    // exit multiple more than this many times the entry multiple
    entry_multiple_tie_pct: 20,     // entry value / last actual EBITDA against the stated entry multiple
    stated_ratio_tie_pct: 1,        // stated growth (pp) and net debt / EBITDA (x) against the calculation
  },
  needs_sirius_confirmation: ['scenarios', 'tax_rate_pct', 'roic_period', 'sanity'],
};

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/[,\s]/g, '') : v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');

export function resolveEngineConfig(stored = null) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const scenarios = {};
  for (const k of ['base', 'upside', 'downside']) {
    const d = FINANCIAL_ENGINE_DEFAULTS.scenarios[k]; const o = s.scenarios?.[k] || {};
    scenarios[k] = { label: d.label, ebitda_pct: num(o.ebitda_pct) ?? d.ebitda_pct, exit_multiple_delta: num(o.exit_multiple_delta) ?? d.exit_multiple_delta };
  }
  scenarios.base = { ...scenarios.base, ebitda_pct: 0, exit_multiple_delta: 0 }; // base is always as submitted
  return {
    scenarios,
    tax_rate_pct: num(s.tax_rate_pct) ?? FINANCIAL_ENGINE_DEFAULTS.tax_rate_pct,
    roic_period: PROJECTION_PERIOD_KEYS.includes(s.roic_period) ? s.roic_period : FINANCIAL_ENGINE_DEFAULTS.roic_period,
    tolerances: { ...FINANCIAL_ENGINE_DEFAULTS.tolerances, ...(s.tolerances || {}) },
    sanity: Object.fromEntries(Object.entries(FINANCIAL_ENGINE_DEFAULTS.sanity).map(([k, d]) => [k, num(s.sanity?.[k]) ?? d])),
    source: stored ? 'stored' : 'default',
    needs_sirius_confirmation: stored ? [] : FINANCIAL_ENGINE_DEFAULTS.needs_sirius_confirmation,
  };
}

export function validateEngineConfig(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['config must be an object'] };
  for (const k of Object.keys(input.scenarios || {})) {
    if (!['upside', 'downside'].includes(k)) { errors.push(`scenario ${k} is not configurable (only upside and downside)`); continue; }
    const e = num(input.scenarios[k]?.ebitda_pct); const m = num(input.scenarios[k]?.exit_multiple_delta);
    if (input.scenarios[k]?.ebitda_pct !== undefined && (e === null || e < -100 || e > 100)) errors.push(`${k}.ebitda_pct must be between -100 and 100`);
    if (input.scenarios[k]?.exit_multiple_delta !== undefined && (m === null || m < -20 || m > 20)) errors.push(`${k}.exit_multiple_delta must be between -20 and 20`);
  }
  if (input.tax_rate_pct !== undefined && !(num(input.tax_rate_pct) >= 0 && num(input.tax_rate_pct) <= 60)) errors.push('tax_rate_pct must be between 0 and 60');
  if (input.roic_period !== undefined && !PROJECTION_PERIOD_KEYS.includes(input.roic_period)) errors.push('roic_period must be one of ' + PROJECTION_PERIOD_KEYS.join(', '));
  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------ the maths

/** IRR by bisection on [-99%, 1000%]; null when the flows do not change sign. */
export function irr(flows) {
  const f = flows.map((x) => (num(x) === null ? 0 : Number(x)));
  if (!f.some((x) => x < 0) || !f.some((x) => x > 0)) return null;
  const npv = (r) => f.reduce((a, c, i) => a + c / (1 + r) ** i, 0);
  let lo = -0.99; let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}

/** Total cash returned over cash invested. flows[0] is the (negative) investment. */
export function moic(flows) {
  const out = -flows.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  const inn = flows.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  return out > 0 ? inn / out : null;
}

/** Years to recover the investment, interpolated inside the year; null if never. */
export function payback(flows) {
  let cum = 0;
  for (let i = 0; i < flows.length; i += 1) {
    const prev = cum; cum += flows[i];
    if (i > 0 && cum >= 0 && prev < 0) return i - 1 + (-prev / flows[i]);
  }
  return null;
}

// ------------------------------------------------------- statement lines

const ALIASES = {
  revenue: ['revenue', 'totalrevenue', 'sales', 'netsales', 'turnover'],
  ebitda: ['ebitda'],
  ebit: ['ebit', 'operatingincome', 'operatingprofit', 'profitfromoperations'],
  depreciation: ['depreciationandamortisation', 'depreciationandamortization', 'depreciation', 'da'],
  net_income: ['netincome', 'netprofit', 'profitaftertax', 'profitfortheyear'],
  cogs: ['costofsales', 'costofgoodssold', 'cogs', 'costofrevenue'],
  gross_profit: ['grossprofit'],
  opex: ['operatingexpenses', 'opex'],
  total_assets: ['totalassets'],
  total_liabilities: ['totalliabilities'],
  total_equity: ['totalequity', 'totalshareholdersequity', 'shareholdersequity'],
  cash: ['cashandcashequivalents', 'cash', 'closingcash', 'cashatendofperiod'],
  op_cf: ['operatingcashflow', 'netcashfromoperatingactivities', 'cashflowfromoperations'],
  inv_cf: ['investingcashflow', 'netcashfrominvestingactivities', 'cashflowfrominvesting'],
  fin_cf: ['financingcashflow', 'netcashfromfinancingactivities', 'cashflowfromfinancing'],
  net_cf: ['netcashflow', 'netchangeincash', 'netincreaseincash'],
  opening_cash: ['openingcash', 'cashatbeginningofperiod'],
  closing_cash: ['closingcash', 'cashatendofperiod'],
  cf_net_income: ['netincomecf', 'profitbeforeworkingcapital'],
};

export function findLine(lines, key, statement = null) {
  const wanted = ALIASES[key] || [norm(key)];
  const hit = (lines || []).find((l) => (!statement || l.statement === statement || !l.statement) && wanted.includes(norm(l.label)));
  return hit ? hit.values || {} : null;
}

// ------------------------------------------------------------ integrity

function check(id, label, status, detail, evidence = null) { return { id, label, status, detail, evidence }; }

function within(a, b, pct, floor = 0.5) {
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= Math.max(floor / 10, (pct / 100) * base);
}

/**
 * Integrity of the three statements and of the Financials grid. `lines` is the
 * statement-line list of the uploaded model (may be empty); `matrix` is the
 * Preparer's grid. Checks that cannot be made say so (`not_checkable`) rather
 * than pass silently.
 */
export function checkIntegrity({ lines = [], matrix = {}, config = resolveEngineConfig() } = {}) {
  const tol = config.tolerances;
  const out = [];
  const derived = deriveFinancials(matrix || {});
  const periods = FINANCIAL_PERIOD_KEYS;

  // Balance sheet: assets = liabilities + equity.
  const A = findLine(lines, 'total_assets'); const L = findLine(lines, 'total_liabilities'); const E = findLine(lines, 'total_equity');
  if (A && L && E) {
    const bad = [];
    let n = 0;
    for (const p of periods) {
      const a = num(A[p]); const l = num(L[p]); const e = num(E[p]);
      if (a === null || l === null || e === null) continue;
      n += 1;
      if (Math.abs(a - (l + e)) > (tol.balance_pct / 100) * Math.max(Math.abs(a), 1)) bad.push({ period: p, assets: a, liabilities_plus_equity: round(l + e) });
    }
    out.push(n === 0 ? check('bs_balance', 'Balance sheet balances', 'not_checkable', 'No period has all three totals.')
      : check('bs_balance', 'Balance sheet balances', bad.length ? 'fail' : 'pass',
        bad.length ? `Assets differ from liabilities plus equity in ${bad.length} period(s).` : `Assets equal liabilities plus equity in all ${n} period(s).`, bad.length ? bad : null));
  } else out.push(check('bs_balance', 'Balance sheet balances', 'not_checkable', 'The model has no balance sheet totals (total assets, total liabilities, total equity).'));

  // P&L: EBITDA margin and growth stated in the grid agree with the amounts; net income cannot exceed EBITDA.
  const revenue = findLine(lines, 'revenue') || Object.fromEntries(periods.map((p) => [p, num(matrix?.revenue?.[p])]));
  const ebitda = findLine(lines, 'ebitda') || Object.fromEntries(periods.map((p) => [p, num(matrix?.ebitda?.[p])]));
  const ni = findLine(lines, 'net_income') || Object.fromEntries(periods.map((p) => [p, num(matrix?.net_income?.[p])]));
  const plBad = []; let plN = 0;
  for (const p of periods) {
    const r = num(revenue[p]); const e = num(ebitda[p]); const n = num(ni[p]);
    if (r !== null && e !== null) { plN += 1; if (r > 0 && e > r) plBad.push({ period: p, issue: 'EBITDA exceeds revenue', revenue: r, ebitda: e }); }
    if (e !== null && n !== null) plN += 1;
    if (e !== null && n !== null && n > e + 0.5) plBad.push({ period: p, issue: 'Net income exceeds EBITDA', ebitda: e, net_income: n });
    const stated = num(matrix?.ebitda_margin?.[p]);
    if (stated !== null && r && e !== null && Math.abs(stated - (e / r) * 100) > 1) plBad.push({ period: p, issue: 'Stated EBITDA margin disagrees with EBITDA / revenue', stated, calculated: round((e / r) * 100, 1) });
  }
  const gp = findLine(lines, 'gross_profit'); const cogs = findLine(lines, 'cogs');
  if (gp && cogs) for (const p of periods) {
    const r = num(revenue[p]); const g = num(gp[p]); const c = num(cogs[p]);
    if (r !== null && g !== null && c !== null && !within(r - Math.abs(c), g, tol.tie_pct)) plBad.push({ period: p, issue: 'Revenue less cost of sales does not equal gross profit', revenue: r, cost_of_sales: c, gross_profit: g });
  }
  out.push(plN === 0 ? check('pl_consistency', 'P&L is internally consistent', 'not_checkable', 'No period has revenue, EBITDA and net income to compare.')
    : check('pl_consistency', 'P&L is internally consistent', plBad.length ? 'fail' : 'pass', plBad.length ? `${plBad.length} inconsistency(ies) found.` : 'Revenue, EBITDA, margin and net income agree.', plBad.length ? plBad : null));

  // Cash flow: operating + investing + financing = net; opening + net = closing.
  const O = findLine(lines, 'op_cf'); const I = findLine(lines, 'inv_cf'); const F = findLine(lines, 'fin_cf'); const N = findLine(lines, 'net_cf');
  if (O && I && F && N) {
    const bad = []; let n = 0;
    for (const p of periods) {
      const o = num(O[p]); const i = num(I[p]); const f = num(F[p]); const t = num(N[p]);
      if ([o, i, f, t].some((x) => x === null)) continue;
      n += 1; if (!within(o + i + f, t, tol.tie_pct)) bad.push({ period: p, sum_of_activities: round(o + i + f), net_cash_flow: t });
    }
    out.push(n ? check('cf_sums', 'Cash flow activities sum to net cash flow', bad.length ? 'fail' : 'pass', bad.length ? `Activities do not sum to the net cash flow in ${bad.length} period(s).` : `Operating, investing and financing sum to the net cash flow in all ${n} period(s).`, bad.length ? bad : null)
      : check('cf_sums', 'Cash flow activities sum to net cash flow', 'not_checkable', 'No period has all four cash-flow lines.'));
  } else out.push(check('cf_sums', 'Cash flow activities sum to net cash flow', 'not_checkable', 'The model lacks operating, investing, financing and net cash flow lines.'));

  const OC = findLine(lines, 'opening_cash'); const CC = findLine(lines, 'closing_cash');
  if (OC && CC && N) {
    const bad = []; let n = 0;
    for (const p of periods) {
      const o = num(OC[p]); const c = num(CC[p]); const t = num(N[p]);
      if ([o, c, t].some((x) => x === null)) continue;
      n += 1; if (!within(o + t, c, tol.tie_pct)) bad.push({ period: p, opening_plus_net: round(o + t), closing: c });
    }
    out.push(n ? check('cf_cash_roll', 'Opening cash plus net cash flow equals closing cash', bad.length ? 'fail' : 'pass', bad.length ? `The cash roll-forward breaks in ${bad.length} period(s).` : 'Cash rolls forward in every period.', bad.length ? bad : null)
      : check('cf_cash_roll', 'Opening cash plus net cash flow equals closing cash', 'not_checkable', 'No period has opening, closing and net cash.'));
  }

  // Cross-statement: net cash flow ties to the balance-sheet cash movement.
  const C = findLine(lines, 'cash', 'balance_sheet');
  if (C && N) {
    const bad = []; let n = 0;
    for (let k = 1; k < periods.length; k += 1) {
      const p = periods[k]; const q = periods[k - 1];
      const c1 = num(C[p]); const c0 = num(C[q]); const t = num(N[p]);
      if ([c1, c0, t].some((x) => x === null)) continue;
      n += 1; if (!within(c1 - c0, t, tol.tie_pct)) bad.push({ period: p, balance_sheet_cash_movement: round(c1 - c0), net_cash_flow: t });
    }
    if (n) out.push(check('xs_cash', 'Balance-sheet cash movement equals net cash flow', bad.length ? 'fail' : 'pass', bad.length ? `Cash on the balance sheet does not move by the net cash flow in ${bad.length} period(s).` : 'Cash on the balance sheet moves by the net cash flow.', bad.length ? bad : null));
  }

  // Cross-source: the model's headline lines against the Financials grid.
  if (lines.length) {
    const bad = []; let n = 0;
    for (const [key, mine] of [['revenue', revenue], ['ebitda', ebitda], ['net_income', ni]]) {
      if (!findLine(lines, key)) continue;
      for (const p of periods) {
        const g = num(matrix?.[key]?.[p]); const m = num(mine[p]);
        if (g === null || m === null) continue;
        n += 1; if (!within(g, m, tol.tie_pct)) bad.push({ period: p, line: key, financials_grid: g, uploaded_model: m });
      }
    }
    out.push(n ? check('model_vs_grid', 'Uploaded model agrees with the Financials grid', bad.length ? 'fail' : 'pass', bad.length ? `${bad.length} figure(s) differ between the uploaded model and the grid.` : 'Revenue, EBITDA and net income match the grid.', bad.length ? bad : null)
      : check('model_vs_grid', 'Uploaded model agrees with the Financials grid', 'not_checkable', 'The grid and the model share no populated period.'));
  }

  // FCF in the grid equals EBITDA - capex where both are given.
  const fcfBad = [];
  for (const p of periods) {
    const given = num(matrix?.free_cash_flow?.[p]); const e = num(matrix?.ebitda?.[p]); const c = num(matrix?.capex?.[p]);
    if (given !== null && e !== null && c !== null && !within(given, e - c, tol.tie_pct)) fcfBad.push({ period: p, stated: given, ebitda_less_capex: round(e - c) });
  }
  if (fcfBad.length) out.push(check('fcf_tie', 'Free cash flow equals EBITDA less capex', 'fail', `Stated free cash flow differs from EBITDA less capex in ${fcfBad.length} period(s).`, fcfBad));

  const failed = out.filter((c) => c.status === 'fail').length;
  const checked = out.filter((c) => c.status !== 'not_checkable').length;
  void derived;
  return { checks: out, failed, checked, not_checkable: out.length - checked, ok: failed === 0 && checked > 0 };
}

// ------------------------------------------------------------ sanity checks

function sanityCheck(id, group, label, status, detail, evidence = null) { return { id, group, label, status, detail, evidence }; }

const pctChange = (a, b) => (a === null || b === null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100);
const cagr = (a, b, years) => (a === null || b === null || a <= 0 || b <= 0 || years <= 0 ? null : (Math.pow(b / a, 1 / years) - 1) * 100);

/**
 * Plausibility checks on the submitted projections and the calculated scenarios.
 * Advisory: statuses are 'pass', 'warn', 'info' or 'not_checkable', never 'fail',
 * so nothing here touches `integrity`, the hurdles or any verdict. A check that
 * cannot be made says so. `scenarios` is the calculated scenario block (may be {});
 * `wacc` is the resolved WACC block (effective_wacc, in %), or null.
 */
export function sanityChecks({ data = {}, lines = [], matrix = {}, scenarios = {}, wacc = null, thresholds = {}, config = resolveEngineConfig() } = {}) {
  const cfg = config.sanity || FINANCIAL_ENGINE_DEFAULTS.sanity;
  const out = [];
  const d = deriveFinancials(matrix || {});
  const P = FINANCIAL_PERIOD_KEYS;
  const proj = PROJECTION_PERIOD_KEYS;
  const rev = Object.fromEntries(P.map((p) => [p, num(d.revenue?.[p])]));
  const ebitda = Object.fromEntries(P.map((p) => [p, num(d.ebitda?.[p])]));
  const prevOf = (p) => P[P.indexOf(p) - 1];

  // 1. Terminal value concentration: its present value as a share of the present value of all inflows.
  const rate = num(wacc?.effective_wacc) ?? num(thresholds?.wacc_pct);
  const tvRows = [];
  for (const [key, sc] of Object.entries(scenarios || {})) {
    if (!sc?.complete || !Array.isArray(sc.flows) || sc.terminal_value === null || sc.terminal_value === undefined) continue;
    const r = rate === null ? 0 : rate / 100;
    const pvIn = sc.flows.reduce((a, f, i) => (i === 0 ? a : a + f / (1 + r) ** i), 0);
    const pvTv = sc.terminal_value / (1 + r) ** (sc.flows.length - 1);
    if (!(pvIn > 0)) continue;
    tvRows.push({ scenario: key, label: sc.label, tv_share_pct: round((pvTv / pvIn) * 100, 1) });
  }
  if (!tvRows.length) {
    out.push(sanityCheck('tv_concentration', 'returns', 'Terminal value share of value', 'not_checkable', 'No scenario has both projected cash flows and an exit multiple, so the terminal value share could not be measured.'));
  } else {
    const over = tvRows.filter((r) => r.tv_share_pct > cfg.tv_share_warn_pct);
    const basis = rate === null ? 'undiscounted (no WACC available)' : `present value at ${rate}% WACC`;
    out.push(sanityCheck('tv_concentration', 'returns', 'Terminal value share of value', over.length ? 'warn' : 'pass',
      over.length
        ? `The terminal value is ${over.map((r) => `${r.tv_share_pct}% (${r.label})`).join(', ')} of the value of inflows (${basis}), above the ${cfg.tv_share_warn_pct}% warning level. The return depends mostly on the exit assumption.`
        : `The terminal value is at most ${Math.max(...tvRows.map((r) => r.tv_share_pct))}% of the value of inflows (${basis}), within the ${cfg.tv_share_warn_pct}% warning level.`,
      tvRows));
  }

  // 2. Unrealistic growth: a projected year growing faster than the flag level.
  const growth = proj.map((p) => ({ period: p, growth_pct: round(pctChange(rev[prevOf(p)], rev[p]), 1) })).filter((g) => g.growth_pct !== null);
  if (!growth.length) out.push(sanityCheck('growth_realism', 'projections', 'Projected growth is plausible', 'not_checkable', 'Revenue is not captured for consecutive periods, so projected growth could not be measured.'));
  else {
    const hot = growth.filter((g) => g.growth_pct > cfg.growth_flag_pct);
    out.push(sanityCheck('growth_realism', 'projections', 'Projected growth is plausible', hot.length ? 'warn' : 'pass',
      hot.length ? `Revenue grows faster than ${cfg.growth_flag_pct}% in ${hot.map((g) => `${g.period.toUpperCase()} (${g.growth_pct}%)`).join(', ')}.` : `No projected year grows faster than ${cfg.growth_flag_pct}%.`, growth));
  }

  // 3. Hockey-stick: growth or margin that arrives late.
  const actuals = ['fy3a', 'fy2a', 'fy1a'].filter((p) => rev[p] !== null && rev[p] > 0);
  const histCagr = actuals.length >= 2 ? cagr(rev[actuals[0]], rev[actuals[actuals.length - 1]], P.indexOf(actuals[actuals.length - 1]) - P.indexOf(actuals[0])) : null;
  const projCagr = rev.fy1a !== null && rev.y5p !== null ? cagr(rev.fy1a, rev.y5p, 5) : null;
  const reasons = [];
  if (projCagr !== null && histCagr !== null && histCagr > 0 && projCagr >= cfg.hockey_min_cagr_pct && projCagr >= cfg.hockey_cagr_ratio * histCagr) {
    reasons.push(`projected revenue CAGR ${round(projCagr, 1)}% is ${round(projCagr / histCagr, 1)}x the historical ${round(histCagr, 1)}%`);
  }
  const backload = (series, name) => {
    if (series.fy1a === null || series.y3p === null || series.y5p === null || series.y5p <= series.fy1a || series.y3p === null) return;
    const total = series.y5p - series.fy1a; const late = series.y5p - series.y3p;
    if (total > 0 && (late / total) * 100 > cfg.hockey_backload_pct) reasons.push(`${round((late / total) * 100, 0)}% of the ${name} increase lands in Y4 and Y5`);
  };
  backload(rev, 'revenue'); backload(ebitda, 'EBITDA');
  if (rev.fy1a && ebitda.fy1a !== null && rev.y5p && ebitda.y5p !== null) {
    const gain = (ebitda.y5p / rev.y5p - ebitda.fy1a / rev.fy1a) * 100;
    if (gain > cfg.hockey_margin_pp) reasons.push(`EBITDA margin rises ${round(gain, 1)} points over the projection`);
  }
  const hockeyCheckable = projCagr !== null || (rev.y3p !== null && rev.y5p !== null && rev.fy1a !== null);
  if (!hockeyCheckable) out.push(sanityCheck('hockey_stick', 'projections', 'Projections are not back-loaded', 'not_checkable', 'The last actual year and Y5 are not both captured, so back-loading could not be measured.'));
  else out.push(sanityCheck('hockey_stick', 'projections', 'Projections are not back-loaded', reasons.length ? 'warn' : 'pass',
    reasons.length ? `The projections look back-loaded: ${reasons.join('; ')}.` : 'Growth and margin build steadily; nothing looks back-loaded.',
    { historical_cagr_pct: round(histCagr, 1), projected_cagr_pct: round(projCagr, 1) }));

  // 4. Cash conversion: projected cash flow as a share of EBITDA.
  const opcf = findLine(lines, 'op_cf');
  const fcf = d.free_cash_flow || {};
  const conv = [];
  for (const p of proj) {
    const e = ebitda[p]; const c = opcf ? num(opcf[p]) : num(fcf[p]);
    if (e !== null && e > 0 && c !== null) conv.push({ period: p, conversion_pct: round((c / e) * 100, 0) });
  }
  const convBasis = opcf ? 'operating cash flow / EBITDA' : 'free cash flow / EBITDA (free cash flow in the grid is EBITDA less capex, so this reflects capex intensity, not tax or working capital)';
  if (!conv.length) out.push(sanityCheck('cash_conversion', 'cash', 'Cash conversion', 'not_checkable', 'No projected year has positive EBITDA and a cash flow figure.'));
  else {
    const low = conv.filter((c) => c.conversion_pct < cfg.cash_conversion_min_pct);
    const over = conv.filter((c) => c.conversion_pct > 100);
    const bad = [...low, ...over];
    out.push(sanityCheck('cash_conversion', 'cash', 'Cash conversion', bad.length ? 'warn' : 'pass',
      bad.length
        ? `${[...low.map((c) => `${c.period.toUpperCase()} ${c.conversion_pct}% (below ${cfg.cash_conversion_min_pct}%)`), ...over.map((c) => `${c.period.toUpperCase()} ${c.conversion_pct}% (cash flow above EBITDA)`)].join(', ')}; basis: ${convBasis}.`
        : `Cash conversion is between ${cfg.cash_conversion_min_pct}% and 100% in every projected year; basis: ${convBasis}.`, conv));
  }

  // 5. Model integrity additions (the existing statement checks stay in `integrity`).
  const statedGrowth = matrix?.growth && typeof matrix.growth === 'object' ? matrix.growth : null;
  if (statedGrowth) {
    const bad = []; let n = 0;
    for (const p of P) {
      const stated = num(statedGrowth[p]); const calc = pctChange(rev[prevOf(p)], rev[p]);
      if (stated === null || calc === null) continue;
      n += 1; if (Math.abs(stated - calc) > cfg.stated_ratio_tie_pct) bad.push({ period: p, stated, calculated: round(calc, 1) });
    }
    if (n) out.push(sanityCheck('stated_growth_tie', 'integrity', 'Stated growth agrees with revenue', bad.length ? 'warn' : 'pass',
      bad.length ? `Stated growth differs from the revenue figures in ${bad.map((b) => `${b.period.toUpperCase()} (stated ${b.stated}%, calculated ${b.calculated}%)`).join(', ')}.` : 'Stated growth agrees with the revenue figures.', bad.length ? bad : null));
  }
  const statedLev = matrix?.net_debt_ebitda && typeof matrix.net_debt_ebitda === 'object' ? matrix.net_debt_ebitda : null;
  const nd = matrix?.net_debt && typeof matrix.net_debt === 'object' ? matrix.net_debt : null;
  if (statedLev && nd) {
    const bad = []; let n = 0;
    for (const p of P) {
      const stated = num(statedLev[p]); const debt = num(nd[p]); const e = ebitda[p];
      if (stated === null || debt === null || !e) continue;
      n += 1; const calc = debt / e; if (Math.abs(stated - calc) > Math.max(0.1, cfg.stated_ratio_tie_pct / 10)) bad.push({ period: p, stated, calculated: round(calc, 2) });
    }
    if (n) out.push(sanityCheck('stated_leverage_tie', 'integrity', 'Stated net debt / EBITDA agrees with net debt and EBITDA', bad.length ? 'warn' : 'pass',
      bad.length ? `Stated net debt / EBITDA differs from net debt over EBITDA in ${bad.map((b) => `${b.period.toUpperCase()} (stated ${b.stated}x, calculated ${b.calculated}x)`).join(', ')}.` : 'Stated net debt / EBITDA agrees with net debt and EBITDA.', bad.length ? bad : null));
  }
  const entryValue = num(data.entry_valuation_aed); const entryMultiple = num(data.entry_multiple);
  if (entryValue !== null && entryMultiple !== null && ebitda.fy1a) {
    const implied = entryValue / ebitda.fy1a;
    const diffPct = Math.abs(implied - entryMultiple) / Math.max(Math.abs(entryMultiple), 0.01) * 100;
    out.push(sanityCheck('entry_multiple_tie', 'integrity', 'Entry multiple agrees with entry value and EBITDA', diffPct > cfg.entry_multiple_tie_pct ? 'warn' : 'pass',
      diffPct > cfg.entry_multiple_tie_pct
        ? `Entry value of ${entryValue} over last actual EBITDA of ${ebitda.fy1a} is ${round(implied, 1)}x, but the stated entry multiple is ${entryMultiple}x. If the entry value is an equity value, the difference may be net debt.`
        : `Entry value over last actual EBITDA is ${round(implied, 1)}x, close to the stated ${entryMultiple}x.`, { implied_multiple: round(implied, 2), stated_multiple: entryMultiple }));
  }
  const exitMultiple = num(data.exit_multiple);
  if (exitMultiple !== null && entryMultiple !== null && entryMultiple > 0) {
    const expands = exitMultiple > cfg.multiple_expansion_ratio * entryMultiple;
    out.push(sanityCheck('multiple_expansion', 'integrity', 'Exit multiple is not far above the entry multiple', expands ? 'warn' : 'pass',
      expands ? `The exit multiple of ${exitMultiple}x is more than ${cfg.multiple_expansion_ratio}x the entry multiple of ${entryMultiple}x.` : `The exit multiple of ${exitMultiple}x is within ${cfg.multiple_expansion_ratio}x of the entry multiple of ${entryMultiple}x.`));
  }

  // 6. Informational: ROIC on a net-income proxy understates a levered business (net income is after interest).
  const base = scenarios?.base;
  const ndRoic = num(matrix?.net_debt?.[config.roic_period]);
  if (base?.roic_basis === 'net_income_proxy' && ndRoic !== null && ndRoic > 0) {
    out.push(sanityCheck('roic_proxy', 'returns', 'ROIC basis', 'info',
      `ROIC for ${config.roic_period.toUpperCase()} uses net income as a proxy for after-tax operating profit because no EBIT or depreciation line was supplied. Net debt is ${ndRoic}, so interest has already been deducted and the ROIC shown is likely understated. Supply EBIT or depreciation for a like-for-like figure. No calculation has been changed.`));
  }

  const warnings = out.filter((c) => c.status === 'warn').length;
  const notCheckable = out.filter((c) => c.status === 'not_checkable').length;
  return { version: 1, checks: out, warnings, informational: out.filter((c) => c.status === 'info').length, not_checkable: notCheckable, checked: out.length - notCheckable };
}

// ------------------------------------------------------------ the model

function scenarioFlows({ matrix, investment, exitMultiple, equityBasis, flex }) {
  const d = deriveFinancials(matrix || {});
  const years = PROJECTION_PERIOD_KEYS;
  const missing = [];
  const flows = [-investment];
  const ebitdaY = []; const fcfY = [];
  for (const p of years) {
    const e = num(d.ebitda[p]); const f = num(d.free_cash_flow[p]);
    if (e === null || f === null) { missing.push(`EBITDA/free cash flow for ${p.toUpperCase()}`); flows.push(0); ebitdaY.push(null); fcfY.push(null); continue; }
    const e2 = e * (1 + flex.ebitda_pct / 100);
    const f2 = f + (e2 - e);
    ebitdaY.push(e2); fcfY.push(f2); flows.push(f2);
  }
  const eLast = ebitdaY[ebitdaY.length - 1];
  let terminal = null; const notes = [];
  if (exitMultiple === null) missing.push('exit multiple');
  else if (eLast === null) missing.push('Y5 EBITDA');
  else {
    const mult = Math.max(0, exitMultiple + flex.exit_multiple_delta);
    let tv = mult * eLast;
    if (equityBasis) {
      const nd = num(d.net_debt?.y5p);
      if (nd !== null) tv -= nd; else notes.push('Entry value is an equity value but Y5 net debt is not captured; terminal value is not reduced by debt.');
    }
    terminal = tv; flows[flows.length - 1] += tv;
  }
  return { flows, ebitdaY, fcfY, terminal, missing, notes };
}

/**
 * Calculate returns for base / upside / downside and evaluate the hurdles.
 * `data` is the opportunity data; `lines` the uploaded model's statement lines.
 */
export function computeFinancialModel({ data = {}, lines = [], thresholds = {}, wacc = null, config = resolveEngineConfig() } = {}) {
  const matrix = data.financials && typeof data.financials === 'object' ? data.financials : {};
  const investment = num(data.total_commitment_aed) ?? num(data.ask_aed);
  const investmentField = num(data.total_commitment_aed) !== null ? 'total_commitment_aed' : (num(data.ask_aed) !== null ? 'ask_aed' : null);
  const exitMultiple = num(data.exit_multiple);
  const equityBasis = String(data.entry_valuation_basis || '').toLowerCase().includes('equity');
  const assumptions = [
    'Deal-level, 100% basis: cash out is the total commitment at the start; cash in is the projected free cash flow of Y1-Y5 plus a terminal value at the end of Y5. Sirius\'s stake, fees and the financing structure are not modelled, so IRR is an approximation of Equity IRR.',
    `Terminal value = exit multiple x Y5 EBITDA${equityBasis ? ', less Y5 net debt (entry value is an equity value)' : ''}.`,
    `Upside and downside are Sirius sensitivities of the submitted base case (${config.scenarios.upside.ebitda_pct >= 0 ? '+' : ''}${config.scenarios.upside.ebitda_pct}% / ${config.scenarios.downside.ebitda_pct}% EBITDA; exit multiple ${config.scenarios.downside.exit_multiple_delta >= 0 ? '+' : ''}${config.scenarios.downside.exit_multiple_delta}x in the downside), not the Preparer's own scenarios.`,
    `ROIC = NOPAT / total commitment in ${config.roic_period.toUpperCase()}; NOPAT = EBIT x (1 - ${config.tax_rate_pct}% tax) where EBIT is in the model, else EBITDA less depreciation, else net income (flagged as a proxy).`,
  ];
  const baseMissing = [];
  if (investment === null) baseMissing.push('total commitment (or Sirius ask)');
  const integrity = checkIntegrity({ lines, matrix, config });
  const out = {
    version: FINANCIAL_ENGINE_VERSION, calculated: false, basis: 'deal_level_100pct', unit: 'AED mn',
    investment: { value: investment, field: investmentField }, exit_multiple: exitMultiple, assumptions,
    config: { scenarios: config.scenarios, tax_rate_pct: config.tax_rate_pct, roic_period: config.roic_period, source: config.source, needs_sirius_confirmation: config.needs_sirius_confirmation },
    scenarios: {}, integrity, missing: baseMissing, hurdles: null, survivable_downside: null, vs_submitted: [],
  };
  if (investment === null || investment <= 0) {
    out.missing = [...new Set([...baseMissing, ...(investment !== null ? ['a positive total commitment'] : [])])];
    out.sanity = sanityChecks({ data, lines, matrix, scenarios: {}, wacc, thresholds, config });
    return out;
  }

  const ebitLine = findLine(lines, 'ebit'); const daLine = findLine(lines, 'depreciation'); const niLine = findLine(lines, 'net_income');
  for (const key of ['base', 'upside', 'downside']) {
    const flex = config.scenarios[key];
    const s = scenarioFlows({ matrix, investment, exitMultiple, equityBasis, flex });
    const complete = s.missing.length === 0;
    const flows = complete ? s.flows : null;
    // ROIC for the headline period
    const idx = PROJECTION_PERIOD_KEYS.indexOf(config.roic_period);
    const d = deriveFinancials(matrix);
    const baseE = num(d.ebitda[config.roic_period]);
    let nopat = null; let roicBasis = null;
    if (baseE !== null) {
      const delta = (s.ebitdaY[idx] ?? baseE) - baseE;
      const ebit = num(ebitLine?.[config.roic_period]);
      const da = num(daLine?.[config.roic_period]);
      if (ebit !== null) { nopat = (ebit + delta) * (1 - config.tax_rate_pct / 100); roicBasis = 'ebit'; }
      else if (da !== null) { nopat = (baseE - Math.abs(da) + delta) * (1 - config.tax_rate_pct / 100); roicBasis = 'ebitda_less_depreciation'; }
      else {
        const ni = num(niLine?.[config.roic_period] ?? matrix?.net_income?.[config.roic_period]);
        if (ni !== null) { nopat = ni + delta * (1 - config.tax_rate_pct / 100); roicBasis = 'net_income_proxy'; }
      }
    }
    const roic = nopat !== null ? (nopat / investment) * 100 : null;
    const survivable = key === 'downside' ? (() => {
      const negE = s.ebitdaY.some((x) => x !== null && x <= 0);
      const cumFcf = s.fcfY.every((x) => x !== null) ? s.fcfY.reduce((a, b) => a + b, 0) : null;
      return { ebitda_positive_every_year: s.ebitdaY.every((x) => x !== null) ? !negE : null, cumulative_fcf: round(cumFcf), cumulative_fcf_positive: cumFcf === null ? null : cumFcf >= 0 };
    })() : null;
    out.scenarios[key] = {
      key, label: flex.label, ebitda_flex_pct: flex.ebitda_pct, exit_multiple_delta: flex.exit_multiple_delta,
      complete, missing: s.missing, notes: s.notes,
      flows: flows ? flows.map((x) => round(x)) : null, terminal_value: round(s.terminal),
      equity_irr: flows ? round(irr(flows), 1) : null,
      moic: flows ? round(moic(flows), 2) : null,
      payback_years: flows ? round(payback(flows), 1) : null,
      payback_note: flows && payback(flows) === null ? 'The investment is not recovered within the 5-year projection from free cash flow alone.' : null,
      roic: round(roic, 1), roic_basis: roicBasis, roic_period: config.roic_period,
    };
    if (survivable) out.survivable_downside = survivable;
    if (!complete) out.missing.push(...s.missing.map((m) => `${flex.label}: ${m}`));
  }
  out.missing = [...new Set(out.missing)];
  out.calculated = Object.values(out.scenarios).some((s) => s.complete);

  // Survivable downside also needs the leverage to stay inside the Sirius limit.
  if (out.survivable_downside && out.scenarios.downside.complete) {
    const lev = num(thresholds.leverage_max); const nd = num(deriveFinancials(matrix).net_debt?.y1p);
    const dE = (() => { const e = num(deriveFinancials(matrix).ebitda.y1p); return e === null ? null : e * (1 + config.scenarios.downside.ebitda_pct / 100); })();
    out.survivable_downside.leverage_y1 = nd !== null && dE ? round(nd / dE, 2) : null;
    out.survivable_downside.leverage_limit = lev;
    out.survivable_downside.leverage_within_limit = out.survivable_downside.leverage_y1 !== null && lev !== null ? out.survivable_downside.leverage_y1 <= lev : null;
    const s = out.survivable_downside;
    s.survivable = s.ebitda_positive_every_year === false || s.cumulative_fcf_positive === false || s.leverage_within_limit === false ? false
      : (s.ebitda_positive_every_year === true && s.cumulative_fcf_positive === true && s.leverage_within_limit !== false ? true : null);
  }

  // The hurdle comparison runs on the calculated table, in the configurable engine.
  const table = { equity_irr: {}, roic: {}, payback: {}, moic: {} };
  for (const [k, s] of Object.entries(out.scenarios)) {
    table.equity_irr[k] = s.equity_irr; table.roic[k] = s.roic; table.payback[k] = s.payback_years; table.moic[k] = s.moic;
  }
  out.hurdles = computeHurdles({ data, returns: table, financials: matrix, thresholds, wacc });

  // Against the Preparer's own typed figures.
  const typed = {
    equity_irr: { base: 'return_irr_base', upside: 'return_irr_upside', downside: 'return_irr_downside', tol: config.tolerances.irr_pp, unit: '%' },
    roic: { base: 'return_roic_base', upside: 'return_roic_upside', downside: 'return_roic_downside', tol: config.tolerances.roic_pp, unit: '%' },
    payback: { base: 'return_payback_years', upside: 'return_payback_upside', downside: 'return_payback_downside', tol: config.tolerances.payback_years, unit: 'yrs' },
    moic: { base: 'return_moic_base', upside: 'return_moic_upside', downside: 'return_moic_downside', tol: config.tolerances.moic_x, unit: 'x' },
  };
  for (const [metric, m] of Object.entries(typed)) {
    for (const sc of ['base', 'upside', 'downside']) {
      const submitted = num(data[m[sc]]);
      const calc = table[metric][sc];
      if (submitted === null || calc === null) continue;
      const diff = round(calc - submitted, 2);
      out.vs_submitted.push({ metric, scenario: sc, submitted, calculated: calc, difference: diff, unit: m.unit, material: Math.abs(diff) > m.tol, tolerance: m.tol,
        // Upside/downside here are Sirius sensitivities, so only the base case is a like-for-like comparison.
        like_for_like: sc === 'base' });
    }
  }
  out.sanity = sanityChecks({ data, lines, matrix, scenarios: out.scenarios, wacc, thresholds, config });
  return out;
}

export default { FINANCIAL_ENGINE_VERSION, FINANCIAL_ENGINE_DEFAULTS, resolveEngineConfig, validateEngineConfig, irr, moic, payback, checkIntegrity, sanityChecks, computeFinancialModel, findLine };
