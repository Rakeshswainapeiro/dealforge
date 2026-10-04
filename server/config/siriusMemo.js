// ---------------------------------------------------------------------------
// Sirius Investment Memo template (REQ-MEMO-01).
//
// Source of truth: docs/Sirius_Investment_Framework_Subsidiaries_Final.pdf,
// "Part B · Submission Template" — the six-page Opportunity Overview
// (slides 6-11). This module maps an opportunity's structured data onto that
// exact page order, section titles and tables, so a generated memo mirrors the
// template the Sirius Investment Team expects to receive.
//
// Assembly is deterministic: every value is read from the opportunity record,
// the owning subsidiary and (where present) an optional enrichment block. Any
// field the template shows but the record does not carry is rendered as the
// same grey placeholder the template uses, so a partially populated submission
// still produces a complete, reviewable document.
//
// Pure functions only — no database, no network. See buildSiriusMemo().
// ---------------------------------------------------------------------------

import { OPPORTUNITY_FIELDS } from '../gate.js';
import { findSourcingChannel, COMPRESSED_TIMELINE_CHANNEL } from './sourcingChannel.js';
import { computeHurdles } from './hurdleTable.js';
import { resolveWacc } from './wacc.js';
import {
  FINANCIAL_PERIODS, FINANCIAL_PERIOD_KEYS, FINANCIAL_ROWS, deriveFinancials,
} from './financials.js';
import { returnsFromFlatFields } from './returnMetrics.js';
import { evaluateSourcesUses, SOURCE_ROWS, USE_ROWS } from './sourcesUses.js';
import { evaluateBudgetStatus } from './budgetStatus.js';
import { evaluateValuation, basisLabel, methodLabel } from './valuation.js';
import { evaluateCrossBorder } from './crossBorder.js';
import { evaluateCurrency } from './currency.js';

export const SIRIUS_CONFIDENTIALITY = 'Sirius International Holding Limited |Confidential';

// The six template tabs, in the template's running order.
export const MEMO_PAGE_TABS = [
  { number: 1, key: 'executive_summary', label: 'Executive summary' },
  { number: 2, key: 'overview', label: 'Opportunity overview' },
  { number: 3, key: 'rationale', label: 'Rationale & fit' },
  { number: 4, key: 'financials', label: 'Financials & returns' },
  { number: 5, key: 'funding', label: 'Funding & key asks' },
  { number: 6, key: 'risks', label: 'Risks & compliance' },
];

// Page titles exactly as printed on the slides.
export const MEMO_PAGE_TITLES = {
  executive_summary: 'Executive summary',
  overview: 'Detailed opportunity overview',
  rationale: 'Investment rationale & strategic fit',
  financials: 'Financials & returns vs. hurdles',
  funding: 'Key asks from Sirius & funding plan',
  risks: 'Risk register & compliance screen',
};

// Sub-captions (the italic line under each page title).
export const MEMO_PAGE_CAPTIONS = {
  executive_summary: 'One page that lets the Investment Team understand the opportunity and the decision sought.',
  overview: 'What this opportunity is, in brief — and why the subsidiary wants to pursue it.',
  rationale: 'Make the case with evidence — market data, customer or partner validation, comparable transactions.',
  financials: '3 years audited history plus 3-5 years projections (new ventures: projections only). Show each hurdle under base / upside / downside.',
  funding: 'Be specific about what you need from Sirius and how the opportunity is funded. Only secured sources count as funded.',
  risks: 'List the 5-8 risks that matter most. Every risk needs a mitigation and a named owner.',
};

// The FY-3 A ... Y5 P columns and the eight page-4 rows are shared config
// (server/config/financials.js) so the capture grid, the derived ratios and
// the memo table cannot drift. Re-exported here for existing importers.
export { FINANCIAL_PERIODS, FINANCIAL_PERIOD_KEYS, FINANCIAL_ROWS };

// The Sirius hurdles, with the template's wording (slide 3 / slide 9). The
// per-scenario Meets? verdicts are computed by the automatic hurdle test
// (W2-04 / FIN-04); `hurdle` is the descriptive fallback used when no entity
// thresholds are available to the pure memo builder.
export const RETURN_HURDLES = [
  { key: 'equity_irr', label: 'Equity IRR', basis: 'scenario', hurdle: '≥ 20% (greenfield ≥ 25%)' },
  { key: 'roic', label: 'ROIC', basis: 'scenario', hurdle: '≥ WACC + [5%]' },
  { key: 'payback', label: 'Payback period', basis: 'scenario', hurdle: '≤ 3.5 yrs' },
  { key: 'concentration', label: 'Single-deal concentration', basis: 'deal', hurdle: '≤ 35%' },
  { key: 'leverage', label: 'Net debt / EBITDA', basis: 'deal', hurdle: '≤ 3x' },
  // Captured "where relevant" (FIN-03); no hard threshold, so the hurdle cell
  // stays descriptive and Meets? remains Y / N until a multiple is agreed.
  { key: 'moic', label: 'MOIC', basis: 'scenario', hurdle: '≥ [2.0x] where relevant' },
];

export const SNAPSHOT_FIELDS = [
  { key: 'founded', label: 'Founded' },
  { key: 'hq', label: 'HQ / key locations' },
  { key: 'employees', label: 'Employees' },
  { key: 'revenue_last_fy', label: 'Revenue (last FY)' },
  { key: 'ebitda_last_fy', label: 'EBITDA (last FY)' },
  { key: 'ownership', label: 'Current ownership' },
];

// Sources and uses read from the shared FIN-06 configuration so the memo table
// and the capture/gate cannot drift (W2-06).
export const FUNDING_SOURCE_ROWS = SOURCE_ROWS.map((s) => ({ key: s.key, label: s.label }));
export const FUNDING_USE_ROWS = USE_ROWS.map((u) => ({ key: u.key, label: u.label }));

export const COMPLIANCE_ROWS = [
  { key: 'legal_regulatory', label: 'Legal & regulatory' },
  { key: 'related_party', label: 'Related-party' },
  { key: 'esg_reputational', label: 'ESG & reputational' },
];

// The template's grey placeholder. Kept verbatim so a generated memo is
// immediately recognisable against the source slides.
const PLACEHOLDER = '[ ]';

// The comparable set is printed with at least this many rows so a partially
// populated capture still shows the table shape (FIN-09: 3-5 names).
const COMPARABLE_MEMO_MIN = 3;

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// Render a value, falling back to the template placeholder when absent.
export function show(value, fallback = PLACEHOLDER) {
  if (isBlank(value)) return fallback;
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

// AED mn figures: render with thousands separators when numeric.
export function aed(value, fallback = PLACEHOLDER) {
  if (isBlank(value)) return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString('en-AE', { maximumFractionDigits: 2 });
}

// Normalise the "In approved budget?" field to the template's Yes / No phrasing.
export function yesNo(value, fallback = PLACEHOLDER) {
  if (isBlank(value)) return fallback;
  const v = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(v)) return 'Yes';
  if (['no', 'n', 'false', '0'].includes(v)) return 'No';
  return String(value).trim();
}

function humanise(value, fallback = PLACEHOLDER) {
  if (isBlank(value)) return fallback;
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function bulletise(value) {
  if (isBlank(value)) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(/\r?\n+/)
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

// The memo returns table reads a { metric: { base, upside, downside } } block.
// When the record carries no explicit block, build one from the flat FIN-03
// capture fields so captured returns reach the memo instead of placeholders.
function resolveReturns(data = {}) {
  if (!isBlank(data.returns)) return data.returns;
  return returnsFromFlatFields(data);
}

// ---------------------------------------------------------------------------
// Page builders
// ---------------------------------------------------------------------------

function executiveSummary({ data, subsidiaryName, alignment }) {
  // Key-facts block: one row per canonical opportunity header field, so the
  // memo and the submission gate read from the same source (gate.js).
  const headerValue = (key) => {
    switch (key) {
      case 'subsidiary': return show(subsidiaryName, '[Subsidiary name]');
      case 'opportunity_type': return humanise(data.opportunity_type);
      case 'target_name': return show(data.target_name);
      case 'sector_geography':
        return [data.sector, data.geography].filter(Boolean).join(' · ') || PLACEHOLDER;
      case 'total_commitment_aed': return aed(data.total_commitment_aed);
      case 'ask_aed': return aed(data.ask_aed);
      case 'funding_source': return show(data.funding_source);
      case 'in_approved_budget': return yesNo(data.in_approved_budget);
      case 'target_signing_close': return show(data.target_signing_close);
      case 'sourcing_channel': return humanise(data.sourcing_channel);
      default: return PLACEHOLDER;
    }
  };

  const keyFacts = [
    { label: 'Subsidiary', value: headerValue('subsidiary') },
    { label: 'Opportunity type', value: headerValue('opportunity_type') },
    { label: 'Target / counterparty', value: headerValue('target_name') },
    { label: 'Sector & geography', value: headerValue('sector_geography') },
    { label: 'Total commitment', value: headerValue('total_commitment_aed') },
    { label: 'Ask from Sirius', value: headerValue('ask_aed') },
    { label: 'Funding source', value: headerValue('funding_source') },
    { label: 'In approved budget?', value: headerValue('in_approved_budget') },
    { label: 'Target signing / close', value: headerValue('target_signing_close') },
    { label: 'Sourcing channel', value: headerValue('sourcing_channel') },
  ];

  const returns = resolveReturns(data);
  const base = returns.equity_irr?.base;
  const roic = returns.roic?.base;
  const payback = returns.payback?.base;
  const headlineReturns = (base != null || roic != null || payback != null)
    ? `Base-case IRR ${show(base, '[]')}% · ROIC ${show(roic, '[]')}% · payback ${show(payback, '[]')} yrs.`
    : 'Base-case IRR []% · ROIC []% · payback [] yrs.';

  const alignmentNote = alignment?.reasons?.length
    ? alignment.reasons.join(' ')
    : null;

  return [
    { type: 'fields', heading: 'Key facts', rows: keyFacts },
    { type: 'prose', heading: 'The opportunity', placeholder: 'What it is, in 2-3 lines: the business, the transaction and its size.', text: bulletise(data.narrative_what).join(' ') },
    { type: 'prose', heading: 'Why it matters', placeholder: 'Headline value to the subsidiary (earnings, margin, capability) and to the Sirius portfolio.', text: bulletise(data.narrative_why_us).join(' ') },
    {
      type: 'prose',
      heading: 'Headline returns & recommendation',
      placeholder: 'Base-case IRR __% · ROIC __% · payback __ yrs. Recommendation and decision sought from Sirius.',
      text: [headlineReturns, data.decision_sought ? `Decision sought: ${data.decision_sought}` : '', alignmentNote].filter(Boolean).join(' '),
    },
  ];
}

function overview({ data, subsidiaryName }) {
  const subsidiary = subsidiaryName || 'the subsidiary';
  const snapshot = data.company_snapshot || {};
  return [
    { type: 'bullets', heading: 'The opportunity in brief', items: [
      { label: 'What', text: show(data.narrative_what, 'The business, asset or project, and its products / services') },
      { label: 'Where', text: [data.geography, data.sector].filter(Boolean).join(' · ') || PLACEHOLDER },
      { label: 'Deal / project shape', text: [humanise(data.opportunity_type), data.target_name ? `stake / counterparty: ${data.target_name}` : null].filter(Boolean).join(' — ') },
      { label: 'Status', text: show(data.status ? String(data.status).replace(/_/g, ' ') : null, PLACEHOLDER) },
    ] },
    { type: 'bullets', heading: `Why ${subsidiary} wants to do this`, items: [
      { label: 'Strategic objective', text: show(data.narrative_why_us, 'Strategic objective it serves and the gap it fills') },
      { label: 'What it adds', text: show(data.narrative_what, 'Revenue, margin, capability, market access') },
      { label: 'Build vs buy', text: PLACEHOLDER },
      { label: 'Cost of not doing it', text: show(data.narrative_why_now, 'Competitive, market or capability risk') },
    ] },
    { type: 'table', heading: 'Target / project snapshot',
      note: 'For greenfield projects, give the planned figures.',
      columns: SNAPSHOT_FIELDS.map((f) => f.label),
      rows: [SNAPSHOT_FIELDS.map((f) => show(snapshot[f.key]))],
      compact: true },
  ];
}

function rationale({ data, alignment }) {
  const alignItems = alignment?.reasons?.length
    ? alignment.reasons
    : ["Link to Sirius strategy and the subsidiary's core mandate", 'Fit with defined sectors and geographies', 'Impact on portfolio concentration', 'Value created, not just volume'];
  return [
    { type: 'cards', heading: null, cards: [
      { title: 'Why this?', text: show(data.narrative_what, 'What makes this asset / project attractive — market position, quality of earnings, capability added.') },
      { title: 'Why now?', text: show(data.narrative_why_now, 'Timing drivers — market window, competitive dynamics, seller situation, regulatory change.') },
      { title: 'Why us?', text: show(data.narrative_why_us, 'Why the subsidiary is the right owner — synergies, right to win, what we bring that others cannot.') },
    ] },
    { type: 'bullets', heading: 'Strategic fit', items: alignItems.map((t) => ({ label: null, text: t })) },
    { type: 'bullets', heading: 'Value created at two levels', items: [
      { label: 'Subsidiary', text: show(data.value_to_subsidiary, 'Uplift to earnings, margin, capability or risk profile (quantify)') },
      { label: 'Sirius', text: show(data.value_to_sirius, 'Why it is accretive to the portfolio — synergies with other holdings, diversification, strategic optionality') },
    ] },
  ];
}

function financials({ data, alignment, homeCountry = null }) {
  const fin = data.financials || {};
  const returns = resolveReturns(data);

  // The automatic hurdle test (W2-04 / FIN-04): evaluate every hurdle per
  // scenario from the entity thresholds and the resolved WACC, so the printed
  // Meets? verdict can never disagree with the capture. Deal-level hurdles
  // (concentration, leverage) are constant across the three columns.
  const thresholds = alignment?.thresholds || {};
  const wacc = resolveWacc(data, { orgWacc: thresholds?.wacc_pct ?? null });
  const hurdles = computeHurdles({ data, returns, financials: fin, thresholds, wacc });
  const hurdleByKey = new Map(hurdles.rows.map((r) => [r.key, r]));
  const thresholdLabel = (h, row) => {
    if (!row || row.threshold === null) return h.hurdle;
    const symbol = row.comparator === 'gte' ? '≥ ' : '≤ ';
    return symbol + row.threshold + row.unit;
  };

  // Growth %, EBITDA margin % and free cash flow are derived from the captured
  // rows so the printed table can never disagree with its inputs (FIN-01).
  const derived = deriveFinancials(fin);
  const rows = FINANCIAL_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    kind: row.kind,
    values: FINANCIAL_PERIOD_KEYS.map((p) => show(derived[row.key]?.[p])),
  }));

  const hurdleRows = RETURN_HURDLES.map((h) => {
    const r = returns[h.key] || {};
    const row = hurdleByKey.get(h.key);
    const cell = (scenario) => {
      if (row) return show(row.scenarios[scenario]?.value);
      return show(r[scenario]);
    };
    // Prefer the computed per-scenario verdicts; fall back to an explicit
    // `meets` on the stored returns block when no threshold is available (a
    // pure memo build with no entity limits), then the template placeholder.
    const verdicts = row ? ['base', 'upside', 'downside'].map((s) => row.scenarios[s]?.meets) : [];
    let meets;
    if (verdicts.some((v) => v === false)) meets = 'N';
    else if (verdicts.every((v) => v === true)) meets = 'Y';
    else if (r.meets === true) meets = 'Y';
    else if (r.meets === false) meets = 'N';
    else meets = 'Y / N';
    return {
      label: h.label,
      hurdle: thresholdLabel(h, row),
      base: cell('base'),
      upside: cell('upside'),
      downside: cell('downside'),
      meets,
    };
  });

  // Entry valuation and exit (W2-08 / FIN-09): the structured entry figure and
  // the comparable set are printed as their own table, with the exit route,
  // timing and target multiple as notes beneath it.
  const valuation = evaluateValuation(data);
  // Reporting currency and FX (W2-10 / NFR-08): the page-4 matrix is labelled
  // with the deal's reporting currency and, for a USD deal, the rate recorded.
  const currency = evaluateCurrency(data);
  const entryBasis = basisLabel(valuation.entry.basis) || 'EV / equity value';
  const entryMethod = methodLabel(valuation.entry.method);
  const comparableRows = valuation.comparables.length
    ? valuation.comparables.map((c) => [c.name, show(c.metric), c.multiple === null ? PLACEHOLDER : c.multiple + 'x'])
    : [[PLACEHOLDER, PLACEHOLDER, PLACEHOLDER]];
  while (comparableRows.length < COMPARABLE_MEMO_MIN) {
    comparableRows.push([PLACEHOLDER, PLACEHOLDER, PLACEHOLDER]);
  }
  const valuationNotes = [
    `Entry valuation & basis: ${show(valuation.entry.amount === null ? null : valuation.entry.amount, '[EV / equity value, multiple, method]')}`
      + (valuation.entry.present || valuation.entry.amount !== null ? ` AED mn · ${entryBasis}` : '')
      + (valuation.entry.multiple === null ? '' : ` · ${valuation.entry.multiple}x`)
      + (entryMethod ? ` · ${entryMethod}` : ''),
    `Exit / value-realisation: ${show(valuation.exit.route, '[route]')}`
      + ` · ${show(valuation.exit.timing, '[timing]')}`
      + (valuation.exit.multiple === null ? '' : ` · ${valuation.exit.multiple}x`),
  ];

  return [
    { type: 'finTable', heading: 'Financials (' + currency.label + ')', unit_label: currency.label, periods: FINANCIAL_PERIODS, rows },
    { type: 'returnsTable', heading: null, rows: hurdleRows },
    { type: 'note', text: 'Reporting currency & units: '
      + currency.label
      + (currency.fx_required
        ? ' · FX rate ' + show(currency.fx_valid ? currency.fx_rate : null, '[AED per USD]') + ' AED/USD'
        : ' · AED base; no FX conversion applied')
      + '.' },
    { type: 'note', text: 'Hurdles vs. thresholds (policy v' + hurdles.version + '): '
      + hurdleRows.map((h) => h.label + ' ' + h.hurdle).join('; ') + '. Meets? is Y only when every captured case meets the hurdle.' },
    { type: 'prose', heading: 'Assumptions & scenarios',
      placeholder: 'Main revenue / margin drivers; one-offs in audited figures; drivers flexed in each case. Cross-border: FX, WHT, TP and repatriation impact on returns.',
      text: show(data.assumptions, 'Main revenue / margin drivers; one-offs in audited figures; drivers flexed in each case. Cross-border: FX, WHT, TP and repatriation impact on returns.') },
    { type: 'table', heading: 'Entry valuation & comparable set',
      columns: ['Comparable', 'Metric', 'Multiple'],
      rows: comparableRows,
      widths: [52, 30, 18],
      compact: true,
      testid: 'memo-valuation-table' },
    { type: 'note', text: valuationNotes[0] },
    { type: 'note', text: valuationNotes[1] },
    ...crossBorderSections(data, homeCountry),
  ];
}

// Cross-border considerations (W2-09 / FIN-08). Printed only when the target
// geography differs from the subsidiary's home country, mirroring the gate and
// the capture form: a same-country deal shows no block at all.
function crossBorderSections(data, homeCountry) {
  const crossBorder = evaluateCrossBorder(data, { homeCountry });
  if (!crossBorder.applies) return [];
  const rows = crossBorder.items.map((item) => [
    item.label,
    show(item.value, '[FX / WHT / TP / repatriation position]'),
  ]);
  return [
    { type: 'table', heading: 'Cross-border considerations',
      columns: ['Consideration', 'Position'],
      rows,
      widths: [34, 66],
      compact: true,
      testid: 'memo-cross-border' },
    { type: 'note', text: 'Cross-border deal (' + show(crossBorder.target_country) + ' target vs. '
      + show(crossBorder.home_country) + ' home): '
      + (crossBorder.complete
        ? 'FX exposure, withholding tax, transfer pricing and repatriation restrictions captured.'
        : 'FX exposure, withholding tax, transfer pricing and repatriation restrictions must be confirmed before approval.') },
  ];
}

function sourcingSideEffects(data) {
  const channel = findSourcingChannel(data.sourcing_channel);
  if (!channel) return null;
  const notes = [];
  if (channel.related_by_default) {
    notes.push('IHC / affiliate referral — related-party flag set automatically; independent reviewer sign-off required.');
  }
  if (channel.value === COMPRESSED_TIMELINE_CHANNEL) {
    notes.push('Banker / advisor-led — compressed-timeline indicator set.');
  }
  return notes.length ? notes.join(' ') : null;
}

function funding({ data }) {
  // The sources-and-uses table (W2-06 / FIN-06): the shared evaluator derives
  // the totals and the percentage of each source, so the memo prints the same
  // numbers the gate checked. Without a captured plan the table falls back to
  // the total commitment on both sides, matching the template placeholder.
  const plan = evaluateSourcesUses(data);

  const sourceRows = plan.sources.map((s) => ({
    label: s.label,
    aed: plan.captured ? aed(s.aed) : aed(data.total_commitment_aed),
    pct: plan.captured ? (s.pct === null ? PLACEHOLDER : s.pct + '%') : '100%',
    status: show(s.status),
  }));
  sourceRows.push({
    label: 'Total sources',
    aed: plan.captured ? aed(plan.total_sources) : aed(data.total_commitment_aed),
    pct: '100%',
    status: '',
    total: true,
  });

  const useRows = plan.uses.map((u) => ({
    label: u.label,
    aed: plan.captured ? aed(u.aed) : aed(data.total_commitment_aed),
  }));
  useRows.push({
    label: 'Total uses',
    aed: plan.captured ? aed(plan.total_uses) : aed(data.total_commitment_aed),
    total: true,
  });

  const fundingNotes = [];
  if (plan.captured) {
    fundingNotes.push(plan.balanced ? 'Sources equal uses.' : plan.message.split('. ')[0] + '.');
    if (plan.hierarchy.violation) fundingNotes.push(plan.hierarchy.message);
  }

  // Budget status (W2-07 / FIN-07): the memo prints the in/out-of-budget answer
  // with the line reference or variance justification, and states plainly when
  // the variance memo is mandatory but not yet attached.
  const budget = evaluateBudgetStatus(data);
  const budgetDetail = budget.off_budget
    ? show(budget.justification, 'variance justification pending.')
      + (budget.satisfied ? '' : ' — variance memo upload mandatory.')
    : show(budget.line_reference, 'budget line ref. or variance justification.');

  return [
    { type: 'keyAsks', heading: 'KEY ASKS FROM SIRIUS', cards: [
      { number: 1, title: 'Decision sought', text: show(data.decision_sought, 'e.g. Approval to proceed to signing / to feasibility') },
      { number: 2, title: 'Sirius capital / guarantee', text: `AED ${aed(data.ask_aed)} mn · form (equity, shareholder loan, guarantee) · timing` },
      { number: 3, title: 'Other support', text: show(data.other_support, 'Introductions, regulatory, banking, shared services, people') },
      { number: 4, title: 'Next steps & timeline', text: show(data.next_steps, 'Steps after approval and the date a decision is needed by') },
    ] },
    { type: 'fundingTables', heading: null, sourceRows, useRows },
    ...(fundingNotes.length ? [{ type: 'note', text: fundingNotes.join(' ') }] : []),
    { type: 'note', text: `Budget status: ${yesNo(data.in_approved_budget, PLACEHOLDER)} — ${budgetDetail}` },
    { type: 'note', text: `Guarantees & contingent commitments: ${show(data.guarantees, 'earn-outs, follow-on or phased funding, and their timing.')}` },
    ...(sourcingSideEffects(data) ? [{ type: 'note', text: 'Sourcing side-effects: ' + sourcingSideEffects(data) }] : []),
  ];
}

function risks({ data }) {
  const riskList = Array.isArray(data.risks) ? data.risks.slice(0, 8) : [];
  const rows = [];
  for (let i = 0; i < Math.max(riskList.length, 6); i += 1) {
    const r = riskList[i] || {};
    rows.push([
      String(i + 1),
      show(r.risk, i === 0 ? 'e.g. Loss of key customer' : PLACEHOLDER),
      show(r.category, i === 0 ? 'Operational / key-person / concentration / regulatory / financial' : PLACEHOLDER),
      show(r.likelihood, 'H / M / L'),
      show(r.impact, 'H / M / L'),
      show(r.mitigation),
      show(r.owner),
    ]);
  }

  const compliance = data.compliance || {};
  const complianceRows = COMPLIANCE_ROWS.map((c) => {
    const entry = compliance[c.key] || {};
    return [c.label, show(entry.status, 'Clear / Open'), show(entry.comment)];
  });
  // Surface the built-in related-party disclosure when no explicit screen is set.
  if (isBlank(compliance.related_party) && !isBlank(data.related_party_disclosure)) {
    complianceRows[1] = ['Related-party', 'Open', String(data.related_party_disclosure)];
  }

  return [
    { type: 'table', heading: null,
      columns: ['#', 'Risk', 'Category', 'Likelihood', 'Impact', 'Mitigation', 'Owner'],
      rows,
      widths: [4, 22, 16, 9, 8, 24, 17],
      compact: true },
    { type: 'table', heading: 'Compliance screen',
      columns: ['Compliance screen', 'Status', 'Comment'],
      rows: complianceRows,
      widths: [28, 14, 58],
      compact: true },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Canonical key-facts values for the header, reused by tests and the docx
// header line.
export function keyFacts({ data = {}, subsidiaryName } = {}) {
  return executiveSummary({ data, subsidiaryName, alignment: null })[0].rows;
}

export function envelopeSubsidiary(opportunity = {}) {
  return opportunity.subsidiary_name || opportunity.org_name || null;
}

// Build the full six-page memo document from an opportunity record.
//
//   opportunity : entity_record row ({ id, owner_org_id, data })
//   org         : owning organization row ({ id, name }) — the subsidiary
//   alignment   : optional evaluateAlignment() result
//   documents   : optional submission_document rows (recorded as evidence)
//
// Returns { title, header, confidentiality, generated_at, pages, evidence }.
export function buildSiriusMemo({ opportunity = {}, org = null, alignment = null, documents = [], generatedAt = new Date().toISOString() } = {}) {
  const data = opportunity.data || opportunity || {};
  const subsidiaryName = org?.name || opportunity.subsidiary_name || null;
  const opportunityName = data.opportunity_name || '(untitled opportunity)';

  const ctx = { data, subsidiaryName, alignment, homeCountry: org?.geography || null };
  const pages = [
    { number: 1, key: 'executive_summary', title: MEMO_PAGE_TITLES.executive_summary, caption: MEMO_PAGE_CAPTIONS.executive_summary, sections: executiveSummary(ctx) },
    { number: 2, key: 'overview', title: MEMO_PAGE_TITLES.overview, caption: MEMO_PAGE_CAPTIONS.overview, sections: overview(ctx) },
    { number: 3, key: 'rationale', title: MEMO_PAGE_TITLES.rationale, caption: MEMO_PAGE_CAPTIONS.rationale, sections: rationale(ctx) },
    { number: 4, key: 'financials', title: MEMO_PAGE_TITLES.financials, caption: MEMO_PAGE_CAPTIONS.financials, sections: financials(ctx) },
    { number: 5, key: 'funding', title: MEMO_PAGE_TITLES.funding, caption: MEMO_PAGE_CAPTIONS.funding, sections: funding(ctx) },
    { number: 6, key: 'risks', title: MEMO_PAGE_TITLES.risks, caption: MEMO_PAGE_CAPTIONS.risks, sections: risks(ctx) },
  ];

  const presentKeys = new Set((documents || []).map((d) => d.requirement_key || d.key).filter(Boolean));
  const evidence = (documents || []).map((d) => ({
    key: d.requirement_key || d.key,
    label: d.label || d.requirement_key || d.key,
    version: d.version ?? null,
    sha256: d.sha256 || null,
    present: true,
  }));

  return {
    title: MEMO_PAGE_TITLES.executive_summary,
    header: `${subsidiaryName || '[Subsidiary name]'} · ${opportunityName}`,
    subsidiary: subsidiaryName,
    opportunity_name: opportunityName,
    confidentiality: SIRIUS_CONFIDENTIALITY,
    generated_at: generatedAt,
    source: 'Sirius Investment Framework — Part B · Submission Template',
    pages,
    evidence: { present: Array.from(presentKeys), items: evidence },
  };
}

// Fields the template shows that the record does not carry — drives the
// "incomplete submission" hint in the UI without re-deriving template logic.
export function missingMemoFields(opportunity = {}) {
  const data = opportunity.data || opportunity || {};
  const missing = [];
  for (const field of OPPORTUNITY_FIELDS) {
    if (isBlank(data[field.key])) missing.push({ key: field.key, label: field.label, section: field.section });
  }
  if (isBlank(data.financials)) missing.push({ key: 'financials', label: 'Financials (FY-3 A … Y5 P)', section: 'financials' });
  if (Object.keys(resolveReturns(data)).length === 0) missing.push({ key: 'returns', label: 'Returns vs hurdles', section: 'financials' });
  if (isBlank(data.risks)) missing.push({ key: 'risks', label: 'Risk register', section: 'risks' });
  if (isBlank(data.compliance)) missing.push({ key: 'compliance', label: 'Compliance screen', section: 'risks' });
  if (isBlank(data.funding_plan)) missing.push({ key: 'funding_plan', label: 'Funding plan (sources vs uses)', section: 'funding' });
  return missing;
}

export default {
  buildSiriusMemo,
  keyFacts,
  missingMemoFields,
  MEMO_PAGE_TABS,
  MEMO_PAGE_TITLES,
  MEMO_PAGE_CAPTIONS,
  FINANCIAL_PERIODS,
  FINANCIAL_PERIOD_KEYS,
  FINANCIAL_ROWS,
  RETURN_HURDLES,
  SIRIUS_CONFIDENTIALITY,
};
