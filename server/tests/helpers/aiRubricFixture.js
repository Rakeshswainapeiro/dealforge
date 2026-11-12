// A fixed opportunity and a "snapshot" of everything the per-tab AI review derives
// from it: the stale-result hash, the validation and analysis prompts, the model
// check specs and the rule-based checks. Used to prove that a change to the review
// pipeline leaves a tab's output byte-for-byte unchanged.
//
// Pure: it takes the review module as an argument and touches no database or network.
import crypto from 'node:crypto';

export const FIXTURE_DATA = {
  opportunity_name: 'Project Fixture',
  opportunity_type: 'strategic_acquisition',
  target_name: 'FixtureCo LLC',
  sector: 'Technology',
  geography: 'UAE',
  total_commitment_aed: 150,
  ask_aed: 60,
  sirius_capital_aed: 60,
  funding_source: 'Balance sheet',
  narrative_what: 'Acquire a SaaS platform with recurring revenue. IRR 31%.',
  narrative_why_now: 'Consolidation window is open.',
  narrative_why_us: 'We operate the adjacent software stack.',
  decision_sought: 'Approval to proceed to diligence.',
  exec_summary_headline_value: 'IRR 31%, payback 3.2 years',
  strategic_objective: 'Scale the software portfolio.',
  build_buy_partner: 'buy',
  cost_of_not_doing: 'Competitor acquires the platform.',
  snapshot_revenue_last_fy_aed: 80,
  snapshot_ebitda_last_fy_aed: 20,
  snapshot_employees: 140,
  comparable_transactions: 'Two 2024 precedents at 7-8x EBITDA.',
  strategy_link: 'Fits the digital pillar.',
  return_irr_base: 31, return_irr_upside: 38, return_irr_downside: 19,
  return_roic_base: 22, return_payback_years: 3.2,
  entry_valuation_aed: 140, entry_multiple: 7, exit_multiple: 7,
  entry_valuation_method: 'precedent_transactions',
  funding_plan: {
    sources: [{ key: 'sirius_capital', aed: 60, status: 'committed' }, { key: 'subsidiary_debt', aed: 90, status: 'secured' }],
    uses: [{ key: 'purchase_price', aed: 140 }, { key: 'contingency', aed: 10 }],
  },
  risk_register: [{ risk: 'Key person', owner: 'CEO', likelihood: 'M', impact: 'H', mitigation: 'Retention plan' }],
};

export const FIXTURE_DOCS = [
  { id: 'd1', requirement_key: 'business_plan', original_name: 'plan.pdf', mimetype: 'application/pdf', version: 1, sha256: 'a'.repeat(64), is_current: true },
  { id: 'd2', requirement_key: 'financials', original_name: 'model.xlsx', mimetype: 'application/xlsx', version: 2, sha256: 'b'.repeat(64), is_current: true },
  { id: 'd3', requirement_key: 'funding_plan', original_name: 'funding.pdf', mimetype: 'application/pdf', version: 1, sha256: 'c'.repeat(64), is_current: true },
  { id: 'd4', requirement_key: 'risk_register', original_name: 'risks.pdf', mimetype: 'application/pdf', version: 1, sha256: 'd'.repeat(64), is_current: true },
];

export const FIXTURE_SNIPPETS = { d1: 'Revenue AED 80 mn, EBITDA AED 20 mn.', d2: 'Model: IRR 31%.' };
export const FIXTURE_PASSAGES = [{ document_name: 'Sirius Strategy 2026', index: 1, text: 'Grow the digital portfolio.' }];
export const FIXTURE_MANDATE = { sectors: ['Technology'], geographies: ['UAE'] };
export const FIXTURE_THEME = { sector: 'Technology', description: 'Digital', keywords: ['saas'], geographies: ['UAE'] };
export const FIXTURE_GATE = {
  missing: [],
  sources_uses: { captured: true, total_sources: 150, total_uses: 150, balanced: true },
  financials: { complete: true, missing: [] },
  return_metrics: { complete: true, downside_present: true },
  mandate_fit: { sector_in_mandate: true, geography_in_core: true, size_in_ticket: true },
};

const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

/** Everything the review derives for one tab, reduced to short fingerprints. */
export function snapshotTab(review, tab) {
  const common = {
    tabKey: tab, data: FIXTURE_DATA, documents: FIXTURE_DOCS, snippets: FIXTURE_SNIPPETS,
    mandate: FIXTURE_MANDATE, theme: FIXTURE_THEME, passages: FIXTURE_PASSAGES,
  };
  const ruleChecks = review.runDeterministicChecks(tab, { data: FIXTURE_DATA, gate: FIXTURE_GATE });
  return {
    hash: review.hashTabInputs(tab, FIXTURE_DATA, FIXTURE_DOCS),
    validation_prompt: sha(review.buildValidationPrompt({ ...common, ruleChecks })),
    analysis_prompt: sha(review.buildAnalysisPrompt({ ...common, ruleChecks })),
    qa_prompt: sha(review.buildQaPrompt({ ...common, ruleChecks, question: 'What is the biggest risk?' })),
    specs: sha(review.aiCheckSpecs(tab)),
    checks: sha(ruleChecks),
  };
}
