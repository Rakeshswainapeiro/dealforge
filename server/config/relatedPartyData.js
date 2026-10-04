// ---------------------------------------------------------------------------
// Related-party / affiliate overlay vocabulary (W6-03 / BRD WF-06, REQ-RPT-01).
//
// Source of truth: the Phase-1 BRD, Workflow - "Related-party / affiliate
// overlay" with accept criteria "case cannot reach the Screening Decision
// without an independent sign-off" and "conflicted users are ineligible".
//
// The overlay is a governance gate layered on top of the related-party flag
// (E9.5): once a deal is flagged, it needs a written arm's-length basis and an
// independent reviewer's sign-off before the Gate-1 screening decision can be
// taken, and no one conflicted with the deal may give that sign-off or decide.
//
// The rule set lives in configuration so Group Compliance can tighten or relax
// it without a deploy. This module is vocabulary only; the pure resolution and
// governance functions live in config/relatedParty.js and the HTTP route in
// server/relatedParty.js.
// ---------------------------------------------------------------------------

export const RELATED_PARTY_CONFIG_KEY = 'related_party_config';
export const RELATED_PARTY_VERSION = 'RPT-01.1';
export const RELATED_PARTY_VERSION_PREFIX = 'RPT-01.';
export const RELATED_PARTY_DEFAULT_REVISION = 1;
export const RELATED_PARTY_OWNER = 'Group Compliance / Investment Committee';

// The overlay governs the Gate-1 screening decision, the same gate the
// Delegation of Authority matrix governs (WF-08). Only Gate 1 ships in Phase 1.
export const RELATED_PARTY_GATE = 'gate_1';
export const RELATED_PARTY_GATE_LABEL = 'Gate 1 (Initial screening decision)';

// The states the overlay moves a flagged deal through.
export const RELATED_PARTY_STATUSES = [
  'not_required',   // no affiliate signal, nothing to do
  'open',           // flagged, awaiting disclosure / documentation / sign-off
  'documented',     // arm's-length basis recorded, still awaiting sign-off
  'signed_off',     // an independent, non-conflicted reviewer has signed off
  'refused',        // the overlay blocks the screening decision
];

export const RELATED_PARTY_STATUS_LABELS = {
  not_required: 'Not required',
  open: 'Open',
  documented: 'Arm\'s-length documented',
  signed_off: 'Signed off',
  refused: 'Refused',
};

// The accepted arm's-length bases (REQ-RPT-01: the transaction must be shown to
// be on arm's-length terms). A reviewer picks one and cites the evidence.
export const ARM_LENGTH_BASES = [
  { key: 'third_party_valuation', label: 'Third-party valuation' },
  { key: 'independent_fairness_opinion', label: 'Independent fairness opinion' },
  { key: 'open_market_process', label: 'Open-market / competitive process' },
  { key: 'market_benchmarking', label: 'Market benchmarking of comparable terms' },
  { key: 'regulatory_approval', label: 'Regulatory / related-party committee approval' },
  { key: 'other', label: 'Other (describe in the note)' },
];

export const ARM_LENGTH_BASIS_KEYS = ARM_LENGTH_BASES.map((b) => b.key);

// Roles that may give the independent sign-off. The overlay refuses the sign-
// off to everyone else, so the independent-reviewer seat is real, not advisory.
export const DEFAULT_SIGNOFF_ROLES = ['independent_reviewer'];

export const RELATED_PARTY_MESSAGES = {
  config_invalid: 'The related-party overlay configuration is invalid.',
  disclosure_required: 'A related-party disclosure is required before the overlay can be cleared.',
  arm_length_required: 'An arm\'s-length basis and its evidence reference are required before an independent sign-off.',
  signoff_role_required: 'Only an independent reviewer may sign off a related-party deal.',
  signoff_conflicted: 'A person conflicted with this deal cannot give the independent sign-off.',
  signoff_missing: 'The deal cannot reach the Screening Decision without an independent sign-off.',
  decision_conflicted: 'A user conflicted with this related-party deal cannot take the Screening Decision.',
  not_flagged: 'This opportunity carries no related-party flag, so no sign-off is required.',
  signoff_minimum_roles: 'At least one role must be able to give the independent sign-off.',
  disclaimer:
    'The related-party overlay is maintained by Group Compliance. A flagged deal cannot reach the ' +
    'Screening Decision without a written arm\'s-length basis and an independent, non-conflicted sign-off.',
};

export default {
  RELATED_PARTY_CONFIG_KEY, RELATED_PARTY_VERSION, RELATED_PARTY_OWNER, RELATED_PARTY_GATE,
  RELATED_PARTY_STATUSES, ARM_LENGTH_BASES, DEFAULT_SIGNOFF_ROLES, RELATED_PARTY_MESSAGES,
};
