// ---------------------------------------------------------------------------
// Memo evidence → document list configuration (REQ-SUB-01..04, REQ-MEMO-01).
//
// Automated memo generation (REQ-MEMO-01) populates a fixed Investment Memo
// template. Each section of that template is only as strong as the evidence
// behind it, so this module works backwards from the expected memo output
// (Requirements Mapping §3.1–§3.4, and the seven sections the memo generator
// prompts for) to the documents a submission must carry.
//
// Two tiers are produced:
//   - gate documents   : the minimum set enforced by document_requirement
//                        (REQ-DOCGATE-01). Only these block submission.
//   - section evidence : the fuller catalogue mapped to memo sections. These
//                        are collected to populate the memo and to satisfy the
//                        §3.3 qualifying-gate checklist, but they do not, by
//                        themselves, block the document gate.
//
// Keeping the gate tier minimal preserves the MVP rule that a submission is
// blocked only by business plan, financials and cap table (E4.1).
// ---------------------------------------------------------------------------

import { ADVERSE_MEDIA_DOC_REQUIREMENTS } from './adverseMedia.js';

// The memo's running order. Mirrors Requirements Mapping §3.2 (the six
// Opportunity Overview sections) plus the header key-facts block (§3.1).
export const MEMO_SECTIONS = [
  { key: 'header', label: 'Key facts (header)' },
  { key: 'executive_summary', label: 'Executive summary' },
  { key: 'company_overview', label: 'Opportunity overview' },
  { key: 'strategic_rationale', label: 'Rationale & strategic fit' },
  { key: 'financial_analysis', label: 'Financials & returns vs hurdles' },
  { key: 'synergies', label: 'Synergy opportunities' },
  { key: 'funding', label: 'Funding & key asks' },
  { key: 'risk_assessment', label: 'Risks & compliance' },
  { key: 'recommendation', label: 'Recommendation & next steps' },
];

// The evidence catalogue: one entry per artefact a memo section draws on.
//   key        — the document_requirement key used by the upload route
//   label      — human label shown in the gate and memo
//   sections   — memo sections this artefact feeds
//   gate       — true when it is part of the enforced minimum set (E4.1)
//   gateRef    — which §3.3 qualifying gate it evidences
//   sort_order — upload ordering
export const MEMO_DOCUMENT_LIST = [
  // --- enforced minimum set (REQ-DOCGATE-01) ------------------------------
  {
    key: 'business_plan',
    label: 'Business plan',
    description: 'Full business plan: the story, what/where/deal shape and status.',
    sections: ['executive_summary', 'company_overview', 'strategic_rationale'],
    gate: true, gateRef: 2, sort_order: 10,
  },
  {
    key: 'financials',
    label: 'Financials (historicals + projections)',
    description: 'Three years audited plus three-to-five year projections (AED mn).',
    sections: ['financial_analysis'],
    gate: true, gateRef: 5, sort_order: 20,
  },
  {
    key: 'cap_table',
    label: 'Ownership / cap table',
    description: 'Current ownership and capital structure, including target stake.',
    sections: ['header', 'company_overview', 'financial_analysis'],
    gate: true, gateRef: 4, sort_order: 30,
  },

  // --- section evidence (populates the memo, feeds the gate checklist) ----
  {
    key: 'returns_model',
    label: 'Returns model (IRR / ROIC / payback)',
    description: 'Linked three-statement model driving base/upside/downside returns.',
    sections: ['financial_analysis', 'executive_summary'],
    gate: false, gateRef: 5, sort_order: 40,
  },
  {
    key: 'valuation_basis',
    label: 'Entry valuation & comparables',
    description: 'Entry valuation, basis and the comparable-transaction set.',
    sections: ['financial_analysis', 'strategic_rationale'],
    gate: false, gateRef: 5, sort_order: 50,
  },
  {
    key: 'market_data',
    label: 'Market data & competitive landscape',
    description: 'Market sizing, growth and competitor positioning for the sector.',
    sections: ['company_overview', 'strategic_rationale'],
    gate: false, gateRef: 4, sort_order: 60,
  },
  {
    key: 'synergy_case',
    label: 'Synergy case (revenue / cost / strategic)',
    description: 'Quantified synergies with the operating-company sign-off where claimed.',
    sections: ['synergies'],
    gate: false, gateRef: 4, sort_order: 70,
  },
  {
    key: 'accretion_statement',
    label: 'Accretion Statement',
    description: 'AED and bps added to the subsidiary, plus the Sirius-portfolio rationale.',
    sections: ['executive_summary', 'strategic_rationale'],
    gate: false, gateRef: 3, sort_order: 80,
  },
  {
    key: 'funding_plan',
    label: 'Funding plan (sources vs uses)',
    description: 'Named, secured sources per the funding hierarchy, with status flags.',
    sections: ['funding'],
    gate: false, gateRef: 6, sort_order: 90,
  },
  {
    key: 'budget_confirmation',
    label: 'Budget line / variance justification',
    description: 'Evidence the deal is in the approved budget or carries a variance memo.',
    sections: ['funding'],
    gate: false, gateRef: 7, sort_order: 100,
  },
  {
    key: 'risk_register',
    label: 'Risk register (with named owners)',
    description: 'Five to eight risks by category, each with likelihood, impact and owner.',
    sections: ['risk_assessment'],
    gate: false, gateRef: 8, sort_order: 110,
  },
  {
    key: 'compliance_screen',
    label: 'Compliance screen',
    description: 'Legal/regulatory, related-party and ESG/reputational, each Clear or Open.',
    sections: ['risk_assessment'],
    gate: false, gateRef: 9, sort_order: 120,
  },
  {
    key: 'execution_plan',
    label: 'Execution plan (100-day)',
    description: 'First-100-day plan with an accountable owner and decision-by date.',
    sections: ['recommendation', 'funding'],
    gate: false, gateRef: 10, sort_order: 130,
  },
  {
    key: 'gate_checklist',
    label: 'Qualifying-gate checklist (CEO & CFO signed)',
    description: 'The ten qualifying gates answered YES/NO with evidence, then signed.',
    sections: ['executive_summary', 'recommendation'],
    gate: false, gateRef: 1, sort_order: 140,
  },
  {
    key: 'due_diligence_report',
    label: 'Diligence report & red-flag log',
    description: 'Gate 3 diligence output plus the red-flag log (Sirius-side, if reached).',
    sections: ['risk_assessment', 'recommendation'],
    gate: false, gateRef: null, sort_order: 150,
  },
];

// Only the enforced minimum set, shaped for document_requirement seeding.
export function gateDocumentRequirements() {
  return MEMO_DOCUMENT_LIST
    .filter((d) => d.gate)
    .map((d) => ({ key: d.key, label: d.label, description: d.description, sort_order: d.sort_order }));
}

// The full catalogue shaped for document_requirement upserts (gate entries
// required, evidence entries optional-by-default so they never block a submit).
export function fullDocumentRequirements() {
  return [...MEMO_DOCUMENT_LIST, ...ADVERSE_MEDIA_DOC_REQUIREMENTS].map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    sort_order: d.sort_order,
    required: Boolean(d.gate),
  }));
}

// Document keys that feed a memo section, in upload order.
export function documentsForSection(sectionKey) {
  return MEMO_DOCUMENT_LIST
    .filter((d) => d.sections.includes(sectionKey))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d) => d.key);
}

// Memo sections still missing evidence, given the requirement keys present.
export function missingMemoEvidence(presentKeys = []) {
  const present = new Set(presentKeys);
  return MEMO_SECTIONS
    .map((s) => ({
      ...s,
      missing: documentsForSection(s.key).filter((k) => !present.has(k)),
    }))
    .filter((s) => s.missing.length > 0);
}

export default {
  MEMO_SECTIONS,
  MEMO_DOCUMENT_LIST,
  gateDocumentRequirements,
  fullDocumentRequirements,
  documentsForSection,
  missingMemoEvidence,
};
