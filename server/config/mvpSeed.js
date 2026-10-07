// ---------------------------------------------------------------------------
// MVP sample-data fixtures (W1-12).
//
// The deterministic sample set the MVP demo and UAT run on. Every fixture is
// derived from a repository source rather than hand-invented:
//   * the owning organisation is a real node of the Sirius subtree
//     (src/data/siriusOrgTree.js),
//   * sector and geography come from that target's registered nature of
//     business via server/config/natureOfBusiness.js,
//   * the six-section capture model and its required/enrichment split come from
//     server/config/intakeConfig.js,
//   * the enforced document set comes from server/config/memoDocumentList.js.
//
// The loader in server/mvpSeed.js turns each spec below into a record by
// walking the real pipeline / route / document APIs, so every fixture carries
// the same audit trail a person would produce. Fixtures are keyed by a stable
// id ('seed-...') and marked `seed: true` so cleanup (W1-11) can wipe and
// reload them idempotently.
//
// See docs/sample-data/MVP_Sample_Data_Map.md for the mapping to personas.
// ---------------------------------------------------------------------------

import { gateDocumentRequirements } from './memoDocumentList.js';
import { QUALIFYING_GATES, gateAnswerKey } from './qualifyingGates.js';
import { attestationDefaults } from './attestations.js';
import {
  statementTemplateRows, statementTemplateCsv, parseStatementModel,
} from './statementModel.js';

// Every seeded opportunity answers YES to all ten qualifying gates (W1-05 /
// INT-08); the evidence fields are already set in fullFields below. Only the
// gate_<key> answers are merged, so a fixture's own header fields are never
// clobbered by the defaults.
const GATE_ANSWER_DEFAULTS = Object.fromEntries(QUALIFYING_GATES.map((g) => [gateAnswerKey(g.key), 'yes']));

export const SIRIUS_ORG_ID = 'org-sirius-international-holding-limited';
export const INFINIA_ORG_ID = 'org-infinia-technologies-limited';
export const FINSTREET_ORG_ID = 'org-finstreet-limited';

export const SEED_PROVENANCE = 'mvp_seed';

// --- documents ------------------------------------------------------------
// The enforced minimum set, taken from the memo evidence catalogue so the
// fixtures, the gate and the generated memo stay in step (REQ-DOCGATE-01).
export const REQUIRED_DOCS = gateDocumentRequirements().filter((d) => ['business_plan', 'financials', 'cap_table'].includes(d.key)).map((d) => d.key);
export const DOC_LABELS = Object.fromEntries(gateDocumentRequirements().map((d) => [d.key, d.label]));

// --- personas -------------------------------------------------------------
// Personas the sample data provisions on top of the shipped cast
// (config/seededUsers.js). All are stamped data_seed = true so cleanup removes
// them and never the shipped admin/leadership cast.
export const MVP_PERSONAS = [
  {
    id: 'user-finstreet-lead',
    email: 'deal.lead@finstreet.local',
    full_name: 'Finstreet Deal Lead',
    phone: '+971500000021',
    memberships: [{ id: 'mem-finstreet-lead', org_id: FINSTREET_ORG_ID, roles: ['subsidiary_deal_lead'], is_primary: true }],
  },
];

// A new-venture financial matrix: audited actuals blank, projections only
// (FIN-01 — "new ventures may leave actuals blank"). Y1 growth is omitted
// because there is no prior-year revenue base to measure it against.
export function greenfieldFinancials() {
  const p = { y1p: 0, y2p: 0, y3p: 0, y4p: 0, y5p: 0 };
  return {
    revenue:    { ...p, y1p: 20, y2p: 46, y3p: 82, y4p: 128, y5p: 180 },
    ebitda:     { ...p, y1p: 2,  y2p: 8,  y3p: 17, y4p: 30,  y5p: 46 },
    net_income: { ...p, y1p: -1, y2p: 3,  y3p: 9,  y4p: 18,  y5p: 30 },
    capex:      { ...p, y1p: 12, y2p: 14, y3p: 16, y4p: 15,  y5p: 14 },
    net_debt:   { ...p, y1p: 18, y2p: 22, y3p: 24, y4p: 22,  y5p: 18 },
  };
}

// --- three-statement models (FIN-02) -------------------------------------
// The demo carries the linked P&L / balance sheet / cash flow model a preparer
// uploads, in three shapes: the complete Sirius template (balanced), a
// projections-only balanced variant for new ventures, and an unbalanced
// variant that demonstrates the advisory flag. Each is built through the real
// parser so the stored summary is exactly what an upload produces, and so the
// three-statement card renders from genuine capture data.
function modelFromRows(rows) {
  const csv = statementTemplateCsv(rows);
  return parseStatementModel({
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'sirius-three-statement-model.csv',
    mimetype: 'text/csv',
  });
}

// A new venture has no audited history: the actual columns are blank and only
// the projections carry values (FIN-01). The projection columns still balance
// (assets = liabilities + equity), so the model counts as complete.
export function greenfieldStatementModel() {
  const rows = statementTemplateRows().map((r) => {
    const values = { ...r.values };
    for (const k of ['fy3a', 'fy2a', 'fy1a']) values[k] = null;
    return { ...r, values };
  });
  return modelFromRows(rows);
}

// The Sirius template with a deliberately unbalanced projection year, so the
// gate raises the advisory flag exactly as the BRD accept criterion expects
// for a model that does not balance. Nothing is rejected; an analyst reviews.
export function unbalancedStatementModel() {
  const rows = statementTemplateRows().map((r) => (r.label === 'Total liabilities'
    ? { ...r, values: { ...r.values, y1p: Number(r.values.y1p || 0) + 18 } }
    : r));
  return modelFromRows(rows);
}

// --- canonical six-section capture values ---------------------------------
// A complete, realistic Opportunity Overview. Fixtures override the keys that
// give them their distinct purpose; everything else stays filled so the memo
// and the completeness indicator show a finished submission.
export function fullFields(overrides = {}) {
  return {
    // §3.1 header
    opportunity_name: 'Seed Opportunity',
    opportunity_type: 'strategic_acquisition',
    target_name: 'Seed Target LLC',
    sector: 'Technology',
    geography: 'UAE',
    total_commitment_aed: 120,
    ask_aed: 60,
    funding_source: 'Sirius balance sheet + operating cash flow',
    in_approved_budget: 'yes',
    target_signing_close: '2027-06',
    sourcing_channel: 'proprietary',
    related_party_disclosure: 'No affiliate involvement.',

    // §3.2.1 executive summary
    narrative_what: 'Acquire a profitable platform with recurring revenue and a defensible customer base.',
    decision_sought: 'Approval to proceed to diligence and to reserve capital for the acquisition.',
    exec_summary_recommendation: 'Proceed: the target is accretive, strategically aligned and deliverable inside the current mandate.',
    exec_summary_headline_value: 'Adds AED 18mn of net earnings and ~120bps to the subsidiary\u2019s return on capital.',

    // §3.2.2 opportunity overview
    snapshot_founded: '2014',
    snapshot_hq: 'Abu Dhabi, United Arab Emirates',
    snapshot_employees: 240,
    snapshot_revenue_last_fy_aed: 185,
    snapshot_ebitda_last_fy_aed: 32,
    snapshot_current_ownership: 'Founder-led, 70% founder / 30% institutional',
    strategic_objective: 'Establish a scaled, cash-generative platform in the core vertical.',
    build_buy_partner: 'buy',
    cost_of_not_doing: 'Competitors consolidate the segment first and the entry multiple rises materially.',

    // §3.2.3 rationale & strategic fit
    narrative_why_now: 'The consolidation window is open and valuation multiples have softened from their peak.',
    narrative_why_us: 'We already operate the adjacent technology stack and can integrate the target within two quarters.',
    rationale_evidence: 'Target has grown revenue at 22% CAGR over three years with 84% gross retention.',
    market_data_evidence: 'Independent market study sizes the addressable segment at AED 2.4bn growing at 11% annually.',
    comparable_transactions: 'Three regional comparables traded at 6.5\u20138.0x EV/EBITDA over the last 18 months.',
    strategy_link: 'Directly advances the Sirius objective of building recurring-revenue technology platforms.',
    concentration_impact: 'Post-deal concentration in the vertical rises from 18% to 24%, inside the 35% ceiling.',

    // §3.2.4 financials & returns vs hurdles
    financials_summary_attached: 'yes',
    // §3.2.4a Part B page-4 financial summary (W2-01 / FIN-01). Eight-row AED mn
    // matrix: revenue, EBITDA, net income and capex are captured; growth %,
    // EBITDA margin %, free cash flow and net debt / EBITDA are derived.
    financials: {
      revenue:       { fy3a: 92,  fy2a: 108, fy1a: 128, y1p: 148, y2p: 171, y3p: 197, y4p: 227, y5p: 261 },
      ebitda:        { fy3a: 14,  fy2a: 18,  fy1a: 23,  y1p: 29,  y2p: 36,  y3p: 44,  y4p: 53,  y5p: 64 },
      net_income:    { fy3a: 6,   fy2a: 9,   fy1a: 12,  y1p: 16,  y2p: 21,  y3p: 27,  y4p: 34,  y5p: 42 },
      capex:         { fy3a: 5,   fy2a: 6,   fy1a: 7,   y1p: 9,   y2p: 10,  y3p: 12,  y4p: 14,  y5p: 16 },
      net_debt:      { fy3a: 30,  fy2a: 34,  fy1a: 36,  y1p: 40,  y2p: 44,  y3p: 48,  y4p: 50,  y5p: 52 },
    },
    statements_3_attached: 'yes',
    return_irr_base: 26,
    return_irr_upside: 34,
    return_irr_downside: 13,
    return_roic_base: 19,
    return_roic_upside: 24,
    return_roic_downside: 9,
    return_payback_years: 3.1,
    return_payback_upside: 2.6,
    return_payback_downside: 4.2,
    return_moic_base: 2.4,
    return_moic_upside: 3.2,
    return_moic_downside: 1.5,
    entry_valuation_aed: 210,
    entry_multiple: 6.6,
    entry_valuation_basis: 'ev',
    entry_valuation_method: 'trading_comps',
    // The comparable set (W2-08 / FIN-09) — a 3-5 name list the memo prints as
    // a table.
    valuation_comparables: [
      { name: 'Regional platform A', metric: 'EV/EBITDA', multiple: 6.2 },
      { name: 'Regional platform B', metric: 'EV/EBITDA', multiple: 6.8 },
      { name: 'Global consolidator C', metric: 'EV/EBITDA', multiple: 7.4 },
    ],
    exit_route: 'Strategic sale to a regional or global consolidator',
    exit_timing: 'Year 5',
    exit_multiple: 7.5,

    // §3.2.5 funding & key asks
    sirius_capital_aed: 60,
    funding_sources_status: 'secured',
    budget_status: 'in_budget',
    budget_line_reference: 'BUD-2027-04 / Technology Platform (approved FY27 capex plan)',
    decision_by_date: '2026-12-15',
    next_steps: 'Complete confirmatory diligence, agree the SPA, and close within two quarters.',

    // §3.2.6 risks & compliance
    risk_register: '1. Customer concentration (owner: Deal Lead). 2. Key-person retention (owner: HR). 3. Integration execution (owner: COO). 4. FX exposure (owner: CFO). 5. Regulatory change (owner: Compliance).',
    compliance_legal: 'clear',
    compliance_related_party: 'clear',
    compliance_esg: 'clear',

    // §3.3 accretion statement
    accretion_net_earnings_aed: 18,
    accretion_bps: 120,
    sirius_accretion_rationale: 'Accretive to the Sirius portfolio by adding durable recurring earnings in a priority vertical and improving group return on capital.',

    // §Qualifying gates (W1-05 / INT-08): every fixture answers YES with the
    // evidence fields above so a finished submission reads as "all ten ready".
    ...GATE_ANSWER_DEFAULTS,

    // §Attestations (W1-06 / INT-09): a complete submission carries both the
    // CEO and CFO attestations, each with person, timestamp and IP.
    attestations: attestationDefaults(),

    ...overrides,
  };
}

// --- fixtures -------------------------------------------------------------
// state is the pipeline state the loader walks to. `documents` lists the
// requirement keys present. `route` applies the org workflow. `relatedParty`
// records the affiliate flag. `persona` is the UAT journey the fixture serves.
export const MVP_FIXTURES = [
  {
    key: 'seed-inf-vision',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: [...REQUIRED_DOCS, 'adverse_media_evidence'],
    fields: {
      opportunity_name: 'Vision Care Imaging Platform',
      target_name: 'MedScan Imaging Systems LLC',
      sector: 'Technology',
      geography: 'UAE',
      total_commitment_aed: 145,
      ask_aed: 70,
      entry_valuation_aed: 240,
      entry_multiple: 6.6,
      entry_valuation_basis: 'ev',
      entry_valuation_method: 'trading_comps',
      // The comparable set (W2-08 / FIN-09): three regional imaging comparables
      // the memo prints as a table.
      valuation_comparables: [
        { name: 'Al Noor Diagnostics', metric: 'EV/EBITDA', multiple: 6.4 },
        { name: 'Gulf Imaging Holdings', metric: 'EV/EBITDA', multiple: 6.9 },
        { name: 'MedCare Group', metric: 'EV/EBITDA', multiple: 7.2 },
      ],
      exit_route: 'Strategic sale to a regional healthcare platform',
      exit_timing: 'Year 5',
      exit_multiple: 7.5,
      // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08): a
      // clear verdict with its screening source, supporting note and the
      // uploaded evidence, so the panel shows a satisfied confirmation.
      adverse_media_confirmation: 'clear',
      adverse_media_source: 'Dow Jones Risk & Compliance',
      adverse_media_note: 'Screened the target and its beneficial owners against sanctions, PEP and adverse-media lists; no matches returned.',
      adverse_media_evidence_reference: 'DJR-2026-009812',
      adverse_media_reviewed_by: 'deal.lead@infinia.local',
      // Funding sources and uses (W2-06 / FIN-06): a reconciled plan that
      // exhausts the cheaper sources (accruals, subsidiary debt) before the
      // Sirius ask, so no hierarchy warning fires. Total sources = uses = 145.
      funding_plan: {
        sources: [
          { key: 'subsidiary_accruals', aed: 35, status: 'secured' },
          { key: 'subsidiary_debt', aed: 40, status: 'secured' },
          { key: 'sirius_capital', aed: 70, status: 'committed' },
        ],
        uses: [
          { key: 'purchase_price', aed: 115 },
          { key: 'transaction_costs', aed: 12 },
          { key: 'working_capital', aed: 12 },
          { key: 'contingency', aed: 6 },
        ],
      },
    },
    note: 'Happy path: every section filled, all required documents present, memo generates.',
  },
  {
    key: 'seed-cross-border',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // A cross-border deal (W2-09 / FIN-08): the target is in India while the
    // owning Infinia subsidiary is registered in the UAE, so the four
    // cross-border considerations are captured here and printed in the memo.
    fields: {
      opportunity_name: 'India Diagnostics Expansion',
      target_name: 'Bharat Imaging Networks Pvt Ltd',
      sector: 'Healthcare',
      geography: 'Republic of India',
      total_commitment_aed: 165,
      ask_aed: 80,
      cross_border_fx: 'Revenue is INR-denominated with a USD-linked equipment cost base; the INR/USD exposure is partially hedged with rolling forward cover.',
      cross_border_wht: 'Dividends carry 10% withholding tax under the UAE-India treaty; interest and royalties are treaty-relieved.',
      cross_border_transfer_pricing: 'An intercompany management fee is charged at arm\u2019s length; a transfer-pricing study is on file with the tax adviser.',
      cross_border_repatriation: 'Capital and dividends are freely repatriable after tax clearance; no exchange-control restriction on exit proceeds.',
      entry_valuation_aed: 260,
      entry_multiple: 7.1,
      entry_valuation_basis: 'ev',
      entry_valuation_method: 'precedent_transactions',
      valuation_comparables: [
        { name: 'Bharat Diagnostics Ltd', metric: 'EV/EBITDA', multiple: 7.0 },
        { name: 'South Asia Imaging Co', metric: 'EV/EBITDA', multiple: 7.3 },
        { name: 'MedCare Group', metric: 'EV/EBITDA', multiple: 7.0 },
      ],
      exit_route: 'Strategic sale to a pan-Asia healthcare platform',
      exit_timing: 'Year 5',
      exit_multiple: 8.0,
      funding_plan: {
        sources: [
          { key: 'subsidiary_accruals', aed: 45, status: 'secured' },
          { key: 'subsidiary_debt', aed: 40, status: 'secured' },
          { key: 'sirius_capital', aed: 80, status: 'committed' },
        ],
        uses: [
          { key: 'purchase_price', aed: 135 },
          { key: 'transaction_costs', aed: 14 },
          { key: 'working_capital', aed: 10 },
          { key: 'contingency', aed: 6 },
        ],
      },
    },
    note: 'Cross-border deal (India target, UAE home): the four considerations are captured and print in the memo (FIN-08).',
  },
  {
    key: 'seed-fx-usd',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // A deal reported in USD (W2-10 / NFR-08): the Sirius base is AED, so the
    // preparer records the FX rate used (AED per USD). Every figure in the
    // page-4 matrix and the memo is labelled in USD mn and is reproducible
    // against the AED base at the recorded rate.
    fields: fullFields({
      opportunity_name: 'US Water Infrastructure Platform',
      target_name: 'Meridian Water Holdings Inc',
      sector: 'Utilities',
      geography: 'United States',
      reporting_currency: 'USD',
      fx_rate_usd_aed: 3.6725,
    }),
    note: 'USD-reported deal with the FX rate recorded (AED per USD), so the currency / FX card reads complete and the memo labels the figures USD mn (NFR-08).',
  },
  {
    key: 'seed-fx-missing',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: REQUIRED_DOCS,
    // A USD-reported deal with no FX rate captured (W2-10 / NFR-08): the
    // advisory flag fires and asks for the rate, but the draft is never
    // blocked — matching the financials workstream pattern.
    fields: fullFields({
      opportunity_name: 'US Cold-chain Logistics Bolt-on',
      target_name: 'PolarLink Logistics LLC',
      sector: 'Industrials',
      geography: 'United States',
      reporting_currency: 'USD',
      fx_rate_usd_aed: '',
    }),
    note: 'USD-reported deal with the FX rate not yet recorded: the advisory flag asks for the AED per USD rate and never blocks the draft (NFR-08).',
  },
  {
    key: 'seed-withdraw-demo',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // A live submission kept aside so the withdraw flow can be demonstrated
    // and captured without disturbing the happy-path fixture (INT-13).
    fields: fullFields({
      opportunity_name: 'Withdraw Demo Opportunity',
      target_name: 'Cedar Point Industrial Services LLC',
      sector: 'Industrials',
      total_commitment_aed: 110,
      ask_aed: 50,
    }),
    note: 'Live submission used to demonstrate withdraw-with-reason; the withdrawn item is retained in history (INT-13).',
  },
  {
    key: 'seed-inf-blocked-docs',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: ['business_plan'],
    fields: { opportunity_name: 'Data Hosting Bolt-on (documents pending)', target_name: 'Gulf Data Hosting FZ-LLC' },
    note: 'Blocked at the document gate: financials and ownership / cap table are missing.',
  },
  {
    key: 'seed-out-of-appetite',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: [],
    selfScreenStop: true,
    fields: {
      opportunity_name: 'Opportunistic Minority Punt',
      target_name: 'Unrelated Listed Co',
      opportunity_type: 'passive_punt',
      sector: 'Industrials',
      geography: 'UAE',
      total_commitment_aed: 25,
    },
    note: 'Self-screen stop: outside-appetite type; the form halts before submission.',
  },
  {
    key: 'seed-below-floor',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: [],
    fields: {
      opportunity_name: 'Small Bolt-on with Portfolio Synergy',
      target_name: 'Niche Payments Bridge LLC',
      sector: 'Technology',
      geography: 'UAE',
      total_commitment_aed: 6,
      ask_aed: 3,
      return_irr_base: 35,
      // A small sub-floor ticket that captured only a base IRR: the remaining
      // scenario cells are deliberately blank so the advisory FIN-03 flag
      // (mandatory downside missing) is demonstrable in the demo.
      return_irr_upside: '',
      return_irr_downside: '',
      return_roic_base: '',
      return_roic_upside: '',
      return_roic_downside: '',
      return_payback_years: '',
      return_payback_upside: '',
      return_payback_downside: '',
      return_moic_base: '',
      return_moic_upside: '',
      return_moic_downside: '',
      below_floor_synergy_case: 'Share of a common payments rail removes AED 4mn of run-rate cost.',
      below_floor_exception: true,
      // Entry valuation (W2-08 / FIN-09): a partial capture — an amount and a
      // multiple but no EV/equity basis or method, and only two comparables.
      // The card shows the advisory flags (incomplete capture), never a block.
      entry_valuation_aed: 18,
      entry_multiple: 5.0,
      valuation_comparables: [
        { name: 'Regional payments peer', metric: 'EV/EBITDA', multiple: 5.2 },
        { name: 'Fintech bolt-on comp', metric: 'EV/EBITDA', multiple: 4.8 },
      ],
      // Funding sources and uses (W2-06 / FIN-06): Sirius capital is secured
      // while the cheaper subsidiary debt is still only indicative, so the
      // advisory funding-hierarchy warning fires (Sirius drawn ahead of a
      // cheaper source). The plan still reconciles at 6 = 6.
      funding_plan: {
        sources: [
          { key: 'subsidiary_debt', aed: 3, status: 'indicative' },
          { key: 'sirius_capital', aed: 3, status: 'secured' },
        ],
        uses: [
          { key: 'purchase_price', aed: 5 },
          { key: 'transaction_costs', aed: 1 },
        ],
      },
    },
    note: 'Below the AED 10mn floor; carries a portfolio-synergy + IRR 35% exception. Also captures only a base IRR, so the advisory FIN-03 flag (mandatory downside missing) is visible.',
  },
  {
    key: 'seed-below-floor-incomplete',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: REQUIRED_DOCS,
    // A complete draft whose only remaining blocker is the exception route: the
    // gate is otherwise satisfied, so a submit reaches the below-floor check and
    // is refused there (INT-03).
    fields: fullFields({
      opportunity_name: 'Sub-floor Ticket (exception incomplete)',
      target_name: 'Micro Lending Pilot LLC',
      sector: 'Financial Services',
      total_commitment_aed: 4,
      ask_aed: 2,
      return_irr_base: 31,
      below_floor_exception: true,
    }),
    note: 'Below the AED 10mn floor with the exception chosen but the synergy statement missing and IRR below the 35% bar; the submit route blocks it (INT-03).',
  },
  {
    key: 'seed-qualifying-no',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: REQUIRED_DOCS,
    // A complete draft whose only remaining blocker is the qualifying-gate
    // checklist: every gate is ready except "Accretive", answered NO, so the
    // submit route refuses it with the not-ready message (INT-08).
    fields: fullFields({
      opportunity_name: 'Bolt-on (not accretive)',
      target_name: 'Marginal Margin Services LLC',
      sector: 'Industrials',
      total_commitment_aed: 65,
      ask_aed: 30,
      gate_accretive: 'no',
    }),
    note: 'Qualifying-gate block: the "Accretive" gate is answered NO while every other gate is ready; submission is refused (INT-08).',
  },
  {
    key: 'seed-attestation-missing',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: REQUIRED_DOCS,
    // A complete draft whose only remaining blocker is the CEO + CFO
    // attestation gate: every other gate is satisfied but neither attestation
    // is recorded, so the submit route refuses it (INT-09).
    fields: fullFields({
      opportunity_name: 'Complete Draft Awaiting CEO/CFO Sign-off',
      target_name: 'Gulf Industrial Controls LLC',
      sector: 'Industrials',
      total_commitment_aed: 95,
      ask_aed: 45,
      attestations: {},
    }),
    note: 'Attestation block: the draft is otherwise complete but neither the CEO nor the CFO attestation is recorded; submission is refused (INT-09).',
  },
  {
    key: 'seed-greenfield',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: [],
    // Concept-stage greenfield that clears the extra tests: the full document
    // pack is waived at Concept (the two-page concept note is enough), and the
    // funding is named and secured, so this one may be submitted (INT-10).
    fields: fullFields({
      opportunity_name: 'Greenfield Smart-Energy Venture',
      target_name: 'Infinia Energy Services (newco)',
      opportunity_type: 'greenfield',
      sector: 'Energy',
      geography: 'UAE',
      funding_source: 'Sirius balance sheet',
      greenfield_stage: 'concept',
      greenfield_benefit: 'Adds a new recurring-revenue energy-services platform before competitors consolidate the segment.',
      greenfield_secured_funding_source: 'Sirius balance sheet',
      funding_sources_status: 'secured',
      budget_status: 'in_budget',
      total_commitment_aed: 90,
      return_irr_base: 28,
      in_approved_budget: 'yes',
      // A new venture has no audited history: the actuals are blank and only
      // the projections carry values (FIN-01 "new ventures may leave actuals
      // blank").
      financials: greenfieldFinancials(),
    }),
    note: 'Concept-stage greenfield that clears the extra tests: no full document pack required at Concept, funding named and secured (INT-10 positive case).',
  },
  {
    key: 'seed-greenfield-unfunded',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: REQUIRED_DOCS,
    // A Feasibility-stage greenfield whose only blocker is the unsecured
    // funding: every other test and gate is satisfied, but the funding is
    // indicative and no secured source is named, so the submit route refuses it
    // with the greenfield message (INT-10 block).
    fields: fullFields({
      opportunity_name: 'Greenfield Sustainable Fuels Venture',
      target_name: 'Infinia Biofuels (newco)',
      opportunity_type: 'greenfield',
      sector: 'Energy',
      geography: 'UAE',
      funding_source: 'Sponsor equity, not yet secured',
      greenfield_stage: 'feasibility',
      greenfield_benefit: 'Opens a new sustainable-fuels line with visible regional demand.',
      greenfield_secured_funding_source: '',
      funding_sources_status: 'indicative',
      budget_status: 'variance_justified',
      total_commitment_aed: 120,
      return_irr_base: 30,
      in_approved_budget: 'no',
      variance_justification: 'Not in the FY27 approved budget; strategic reforecast submitted to the CFO for the sustainable-fuels mandate.',
    }),
    note: 'Feasibility-stage greenfield with unsecured funding; the submit route refuses it (INT-10 block).',
  },
  {
    key: 'seed-related-party',
    persona: 'reviewer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    relatedParty: true,
    fields: {
      opportunity_name: 'Affiliate Referral \u2014 Digital Assets Custody',
      target_name: 'Group Affiliate Custody SPV',
      sector: 'Financial Services',
      geography: 'UAE',
      sourcing_channel: 'ihc_affiliate_referral',
      related_party_disclosure: 'Referred by an IHC affiliate; an independent reviewer must sign off before decision.',
      arm_length_basis: 'independent_fairness_opinion',
      arm_length_note: 'Independent fairness opinion obtained and an open-market process run before referral.',
    },
    note: 'Sourcing channel ihc_affiliate_referral auto-flags a related-party review (WF-06).',
  },
  {
    key: 'seed-banker-led',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'draft',
    documents: ['business_plan'],
    fields: {
      opportunity_name: 'Accelerated Data Centre Platform',
      target_name: 'GulfEdge Data Centres LLC',
      sector: 'Technology',
      geography: 'UAE',
      sourcing_channel: 'banker_advisor',
      related_party_disclosure: 'No affiliate involvement.',
    },
    note: 'Sourcing channel banker_advisor sets the compressed-timeline indicator (INT-05); draft awaiting the full document pack.',
  },
  {
    key: 'seed-in-screening',
    persona: 'analyst',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    fields: { opportunity_name: 'Cloud Platforms Consolidation', target_name: 'Emircom Cloud Services' },
    note: 'In screening: gate-1 filters and the scorecard inputs are present.',
  },
  {
    key: 'seed-duplicate-finstreet',
    persona: 'analyst',
    org: FINSTREET_ORG_ID,
    ownerEmail: 'deal.lead@finstreet.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // The same target as seed-in-screening, but raised by a sibling subsidiary.
    // The Investment Team sees a duplicate warning and can link or dismiss it;
    // neither subsidiary ever sees the other's record (INT-12).
    fields: {
      opportunity_name: 'Cloud Consolidation (Finstreet view)',
      target_name: 'Emircom Cloud Services',
      sector: 'Technology',
      geography: 'UAE',
      total_commitment_aed: 140,
    },
    note: 'Cross-subsidiary duplicate of seed-in-screening (same target); drives the Investment-Team duplicate warning with link/dismiss (INT-12).',
  },
  {
    key: 'seed-theme-exception',
    persona: 'analyst',
    org: FINSTREET_ORG_ID,
    ownerEmail: 'deal.lead@finstreet.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    fields: {
      opportunity_name: 'Industrial Logistics Adjacency',
      target_name: 'Riyadh Industrial Logistics Co',
      sector: 'Industrials',
      geography: 'Saudi Arabia',
      total_commitment_aed: 160,
      // A per-opportunity WACC override WITH a reason (W2-05 / FIN-05): the
      // demo shows a defensible deal-specific cost of capital over the entity
      // default.
      wacc_override_pct: 11,
      wacc_override_reason: 'Saudi country-risk premium and SAR funding cost above the UAE entity default.',
    },
    note: 'Off-theme for the owning subsidiary: alignment is "Not aligned" and requires a reasoned exception (SCR-02 negative).',
  },
  {
    key: 'seed-conflict',
    persona: 'analyst',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    fields: {
      opportunity_name: 'Telecom Fibre Roll-up',
      target_name: 'Coastal Fibre Networks LLC',
      sector: 'Telecommunications',
      geography: 'UAE',
      total_commitment_aed: 200,
      concentration_impact: 'Flags a portfolio conflict: the target competes with an existing holding.',
      // A per-opportunity WACC override WITHOUT a reason (W2-05 / FIN-05): the
      // advisory card flags the missing reason rather than applying it silently.
      wacc_override_pct: 10.5,
    },
    note: 'Concentration / portfolio-conflict flag (SCR-07).',
  },
  {
    key: 'seed-leadership',
    persona: 'leadership',
    org: FINSTREET_ORG_ID,
    ownerEmail: 'deal.lead@finstreet.local',
    state: 'proceed_to_gate2',
    documents: REQUIRED_DOCS,
    route: true,
    fields: {
      opportunity_name: 'Payments Platform Expansion',
      target_name: 'GulfPay Holdings',
      sector: 'Financial Services',
      geography: 'UAE',
      total_commitment_aed: 180,
      ask_aed: 90,
      build_buy_partner: 'buy',
    },
    note: 'Proceeded to Gate 2 at the Gate-1 screening decision; the Phase 2 sign-off route is applied for reference.',
  },
  {
    key: 'seed-info-requested',
    persona: 'preparer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'information_requested',
    documents: REQUIRED_DOCS,
    fields: {
      opportunity_name: 'Regional Logistics Software',
      target_name: 'RouteGrid Technologies LLC',
      sector: 'Technology',
      geography: 'UAE',
      total_commitment_aed: 110,
      ask_aed: 55,
    },
    note: 'Sirius has requested information; the subsidiary owes a response (WF-01 / WF-04).',
  },
  {
    key: 'seed-on-hold',
    persona: 'reviewer',
    org: FINSTREET_ORG_ID,
    ownerEmail: 'deal.lead@finstreet.local',
    state: 'on_hold',
    documents: REQUIRED_DOCS,
    fields: {
      opportunity_name: 'Cross-border Remittance Rails',
      target_name: 'Corridor Pay FZ-LLC',
      sector: 'Financial Services',
      geography: 'UAE',
      total_commitment_aed: 140,
      ask_aed: 70,
    },
    note: 'Screening decision deferred: on hold awaiting the counterparty process (WF-01).',
  },
  {
    key: 'seed-declined',
    persona: 'reviewer',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'declined',
    documents: REQUIRED_DOCS,
    fields: {
      opportunity_name: 'Legacy Print Services Carve-out',
      target_name: 'Desert Print Holdings LLC',
      sector: 'Business Services',
      geography: 'UAE',
      total_commitment_aed: 95,
      ask_aed: 45,
    },
    note: 'Declined at Gate 1 with a recorded reason: returns below the hurdle (WF-05).',
  },
  {
    key: 'seed-disqualifier',
    persona: 'analyst',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // Two automatic disqualifiers are present on the record (W3-04 / SCR-05):
    // a sanctions / PEP exposure without mitigation and an undisclosed related
    // party found after Gate 1. The screening board raises both as named flags
    // that a reviewer clears with a named reviewer and a reason.
    fields: {
      opportunity_name: 'Legacy Metals Restructuring',
      target_name: 'Gulf Alloy Industries LLC',
      sector: 'Industrials',
      geography: 'UAE',
      total_commitment_aed: 130,
      disqualifier_sanctions_pep: 'yes',
      disqualifier_sanctions_pep_note: 'A beneficial owner appears on a PEP list; mitigation is not yet documented.',
      disqualifier_undisclosed_related_party: 'yes',
      disqualifier_undisclosed_related_party_note: 'A related party surfaced in diligence that was not on the original disclosure.',
      disqualifier_minority_protections: 'no',
      disqualifier_valuation_premium_pct: 18,
      disqualifier_licence_transferable: 'no',
    },
    note: 'Two automatic disqualifier flags (SCR-05): sanctions / PEP exposure and an undisclosed related party; both need a named reviewer to clear.',
  },
  {
    key: 'seed-scorecard',
    persona: 'analyst',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // The Gate 2 weighted scorecard (W3-05 / SCO-02): seven 1-5 criteria with
    // weights summing to 100%. This fixture is scored across the criteria so
    // the weighted total and the pass-bar outcome are visible on the board.
    fields: {
      opportunity_name: 'Regional Cold-chain Platform',
      target_name: 'Emirates Cold Chain Holdings LLC',
      sector: 'Industrials',
      geography: 'UAE',
      total_commitment_aed: 240,
      scorecard: {
        scores: {
          revenue_scale: 4, growth_rate: 5, entry_valuation: 3, ownership_control: 4,
          capital_structure: 4, path_to_liquidity: 4, unit_economics: 5,
        },
        notes: {
          growth_rate: 'Growth sustained above 25% YoY for two periods.',
          entry_valuation: 'Within the defensible 3-5 name comp range.',
        },
        by: 'analyst@sirius.local',
        at: '2026-01-01T00:00:00.000Z',
        version: 'SC-01.1',
      },
    },
    note: 'Gate 2 scorecard scored (SCO-02): weighted total above the 3.5 pass bar.',
  },
  {
    key: 'seed-scorecard-below',
    persona: 'analyst',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // A below-bar Gate 2 scorecard (W3-05 / SCO-02): the weighted total sits
    // under the 3.5 pass bar, so the board requires an explicit CIO override
    // memo (a named CIO and a written reason) before the deal can proceed.
    fields: {
      opportunity_name: 'Mature Packaging Roll-up',
      target_name: 'Gulf Packaging Industries LLC',
      sector: 'Industrials',
      geography: 'UAE',
      total_commitment_aed: 190,
      scorecard: {
        scores: {
          revenue_scale: 3, growth_rate: 2, entry_valuation: 3, ownership_control: 3,
          capital_structure: 3, path_to_liquidity: 2, unit_economics: 3,
        },
        notes: { growth_rate: 'Mature asset growing below the sector norm.', path_to_liquidity: 'No evidenced exit route inside the horizon yet.' },
        by: 'analyst@sirius.local',
        at: '2026-01-02T00:00:00.000Z',
        version: 'SC-01.1',
      },
    },
    note: 'Gate 2 scorecard below the 3.5 pass bar (SCO-02): a CIO override memo is required to proceed.',
  },
  {
    key: 'seed-scorecard-lens-floor',
    persona: 'analyst',
    org: INFINIA_ORG_ID,
    ownerEmail: 'deal.lead@infinia.local',
    state: 'screening_review',
    documents: REQUIRED_DOCS,
    // A two-lens floor case (W3-06 / SCO-04): the strategic lens is strong
    // (5.0) so the weighted total clears the 3.5 pass bar, but the financial
    // lens sits at 2.0 - below the 3.0 floor - so the deal cannot proceed
    // without the explicit CIO override memo. A strong strategic case cannot
    // mask a weak financial one.
    fields: {
      opportunity_name: 'Digital Health Growth Platform',
      target_name: 'Gulf Digital Health Holdings LLC',
      sector: 'Healthcare',
      geography: 'UAE',
      total_commitment_aed: 210,
      scorecard: {
        scores: {
          revenue_scale: 5, growth_rate: 5, entry_valuation: 2, ownership_control: 5,
          capital_structure: 2, path_to_liquidity: 5, unit_economics: 2,
        },
        notes: {
          growth_rate: 'Best-in-class growth, top decile for the sector.',
          entry_valuation: 'Entry sits above the defensible comp range.',
          unit_economics: 'Payback beyond sector benchmark with no evidenced path yet.',
        },
        by: 'analyst@sirius.local',
        at: '2026-01-03T00:00:00.000Z',
        version: 'SC-01.2',
      },
    },
    note: 'Two-lens floor (SCO-04): the strategic lens clears 5.0 but the financial lens is below the 3.0 floor, so a CIO override memo is required despite a 3.65 weighted total.',
  },
];

export default {
  SIRIUS_ORG_ID, INFINIA_ORG_ID, FINSTREET_ORG_ID, SEED_PROVENANCE,
  REQUIRED_DOCS, DOC_LABELS, MVP_PERSONAS, MVP_FIXTURES, fullFields,
};
