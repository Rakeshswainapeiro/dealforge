// ---------------------------------------------------------------------------
// Decision reason code vocabulary (W6-01 / BRD WF-05).
//
// Source of truth: the Phase-1 BRD, Workflow - "Decision reason codes" with
// accept criterion "Reason required; declines captured for comparables".
//
// Every terminal or revision-triggering decision (approve / return / decline /
// withdraw) must carry a reason. A reason is a code drawn from the maintained
// catalogue below plus optional free text, so declines can be grouped for
// comparables analysis without reading prose.
//
// This module is vocabulary only. The pure resolution / validation functions
// live in decisionReasons.js and the HTTP route in server/decisionReasons.js.
// ---------------------------------------------------------------------------

export const DECISION_REASON_CONFIG_KEY = 'decision_reason_config';
export const DECISION_REASON_VERSION = 'DRC-01.1';
export const DECISION_REASON_VERSION_PREFIX = 'DRC-01.';
export const DECISION_REASON_DEFAULT_REVISION = 1;

// Who maintains the catalogue by default.
export const DECISION_REASON_OWNER = 'Sirius Investment Team';

// The decision classes a reason can attach to. `decision_state` links a class
// to the pipeline state that raises it, so the board can show the right codes.
export const DECISION_CLASSES = [
  { key: 'approve', label: 'Approve', action: 'approve', decision_state: null,
    description: 'A gate or stage is being completed in favour of the opportunity.' },
  { key: 'return', label: 'Return for revision', action: 'return', decision_state: 'returned',
    description: 'The item goes back to its producing layer with instructions.' },
  { key: 'decline', label: 'Decline', action: 'decline', decision_state: 'declined',
    description: 'The opportunity is stopped. Declines are grouped for comparables.' },
  { key: 'withdraw', label: 'Withdraw', action: 'withdraw', decision_state: 'withdrawn',
    description: 'The owner pulls the item back before a screening decision.' },
];

export const DECISION_CLASS_KEYS = DECISION_CLASSES.map((c) => c.key);

// `counts_as_decline` marks the codes that feed decline comparables: a reviewer
// reading the pattern of lost deals sees them grouped by a stable key.
export const DECISION_REASONS = [
  // Approve ---------------------------------------------------------------
  { class: 'approve', id: 'strategic_fit', label: 'Strong strategic fit', counts_as_decline: false,
    description: 'The opportunity advances the group strategy.' },
  { class: 'approve', id: 'returns_above_hurdle', label: 'Returns above hurdle', counts_as_decline: false,
    description: 'Projected returns clear the mandate hurdle.' },
  { class: 'approve', id: 'synergy_capture', label: 'Credible synergies', counts_as_decline: false,
    description: 'Quantified synergies support the case.' },
  { class: 'approve', id: 'portfolio_balance', label: 'Improves portfolio balance', counts_as_decline: false,
    description: 'The deal balances sector or geography exposure.' },
  { class: 'approve', id: 'mandate_alignment', label: 'Aligned to mandate', counts_as_decline: false,
    description: 'Sits squarely inside an approved mandate.' },

  // Return ----------------------------------------------------------------
  { class: 'return', id: 'incomplete_financials', label: 'Financials incomplete', counts_as_decline: false,
    description: 'The three-statement model is missing or unsupported.' },
  { class: 'return', id: 'missing_market_evidence', label: 'Market evidence missing', counts_as_decline: false,
    description: 'The market case needs sourcing or a third-party view.' },
  { class: 'return', id: 'unclear_synergy_case', label: 'Synergy case unclear', counts_as_decline: false,
    description: 'The synergy thesis is asserted but not evidenced.' },
  { class: 'return', id: 'valuation_support_needed', label: 'Valuation support needed', counts_as_decline: false,
    description: 'The valuation range needs a defensible basis.' },
  { class: 'return', id: 'risk_mitigation_missing', label: 'Risk mitigation missing', counts_as_decline: false,
    description: 'Material risks have no named owner or mitigation.' },

  // Decline ---------------------------------------------------------------
  { class: 'decline', id: 'outside_mandate', label: 'Outside mandate', counts_as_decline: true,
    description: 'Does not fit any approved mandate.' },
  { class: 'decline', id: 'returns_below_hurdle', label: 'Returns below hurdle', counts_as_decline: true,
    description: 'Projected returns do not clear the hurdle.' },
  { class: 'decline', id: 'unacceptable_risk', label: 'Unacceptable risk', counts_as_decline: true,
    description: 'Residual risk exceeds appetite.' },
  { class: 'decline', id: 'no_strategic_fit', label: 'No strategic fit', counts_as_decline: true,
    description: 'No credible link to group strategy.' },
  { class: 'decline', id: 'capital_constraint', label: 'Capital constrained', counts_as_decline: true,
    description: 'Capital is committed elsewhere for the period.' },
  { class: 'decline', id: 'governance_concern', label: 'Governance concern', counts_as_decline: true,
    description: 'Governance or related-party issues are unresolved.' },

  // Withdraw --------------------------------------------------------------
  { class: 'withdraw', id: 'budget_pulled', label: 'Budget pulled', counts_as_decline: false,
    description: 'Funding for the initiative was withdrawn.' },
  { class: 'withdraw', id: 'superseded', label: 'Superseded', counts_as_decline: false,
    description: 'Replaced by a later or wider proposal.' },
  { class: 'withdraw', id: 'reprioritised', label: 'Internally reprioritised', counts_as_decline: false,
    description: 'Deprioritised against other internal work.' },
  { class: 'withdraw', id: 'data_quality', label: 'Data quality', counts_as_decline: false,
    description: 'Underlying data could not be relied upon.' },
  { class: 'withdraw', id: 'duplicate_opportunity', label: 'Duplicate opportunity', counts_as_decline: false,
    description: 'Already tracked under another record.' },
];

export const DECISION_REASON_MESSAGES = {
  reason_required: 'A reason code is required for this decision.',
  reason_text_required: 'Free-text detail is required for this reason code.',
  reason_code_invalid: 'Unknown reason code for this decision class.',
  config_invalid: 'The decision reason configuration is invalid.',
  disclaimer:
    'Reason codes are maintained by the Investment Team. Every decline, return or ' +
    'withdrawal is recorded with a code so patterns are comparable across mandates.',
};

// Look up a decision class definition by key.
export function findDecisionClass(key) {
  return DECISION_CLASSES.find((c) => c.key === key) || null;
}

// Look up the decision class that a pipeline state raises, if any.
export function decisionClassForState(state) {
  return DECISION_CLASSES.find((c) => c.decision_state === state) || null;
}

// The reason codes shipped for a class.
export function reasonsForClass(key) {
  return DECISION_REASONS.filter((r) => r.class === key);
}
