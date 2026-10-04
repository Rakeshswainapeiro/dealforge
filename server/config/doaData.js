// ---------------------------------------------------------------------------
// Delegation of Authority vocabulary (W6-02 / BRD WF-08, REQ-GATE-05).
//
// Source of truth: the Phase-1 BRD, Workflow - "Delegation of Authority
// routing" with accept criterion "RACI enforced at Gate 1", and the Sirius
// Filtering Protocol RACI (REQ-GATE-05): Deal Lead, Vertical Head, CIO, IC and
// Board, with the approving party stepping up as the ticket size grows.
//
// A ticket band is a slice of the total commitment in AED mn, and each band
// names the responsibility (R / A / C / I) every DoA party holds for the Gate-1
// decision, plus the roles that may actually take that decision. The matrix
// lives in configuration so the Investment Committee can retune a band without
// a deploy; the pipeline, the screening board and the memo read one source.
//
// This module is vocabulary only. The pure resolution / validation functions
// live in doa.js and the HTTP route in server/doa.js.
// ---------------------------------------------------------------------------

export const DOA_CONFIG_KEY = 'doa_config';
export const DOA_VERSION = 'DOA-01.1';
export const DOA_VERSION_PREFIX = 'DOA-01.';
export const DOA_DEFAULT_REVISION = 1;
export const DOA_OWNER = 'Sirius Investment Committee';

// The Gate the matrix governs. Only Gate 1 ships in Phase 1 (WF-09 defers the
// remaining gates), so the engine and the UI speak in terms of this gate.
export const DOA_GATE = 'gate_1';
export const DOA_GATE_LABEL = 'Gate 1 (Initial screening decision)';

// Responsibility codes, RACI order.
export const DOA_RESPONSIBILITY_CODES = ['R', 'A', 'C', 'I'];

// The DoA parties named by the protocol, in escalating seniority order. Each
// party maps onto the platform roles that hold that seat so a deal's decision
// rights can be traced to a real membership.
export const DOA_PARTIES = [
  { key: 'deal_lead', label: 'Deal Lead', roles: ['sirius_deal_lead', 'subsidiary_deal_lead'], order: 1 },
  { key: 'vertical_head', label: 'Vertical Head', roles: ['sirius_vertical_head', 'cluster_head'], order: 2 },
  { key: 'cio', label: 'CIO', roles: ['cio'], order: 3 },
  { key: 'ic', label: 'Investment Committee', roles: ['ic_member'], order: 4 },
  { key: 'board', label: 'Board', roles: ['board_member'], order: 5 },
];

export const DOA_PARTY_KEYS = DOA_PARTIES.map((p) => p.key);

// The shipped Gate-1 matrix. The bands step the accountable party up the house:
// the Vertical Head carries a standard ticket, the CIO an elevated one, the IC
// a committee-scale one and the Board anything above the board threshold.
// `decision_roles` is the practical enforcement set - the platform roles that
// may take the Gate-1 decision for that band (everything holding R or A, plus
// the deal lead who drives it).
export const DOA_TIERS = [
  {
    key: 'standard', label: 'Standard', gate: DOA_GATE,
    min_aed: 0, max_aed: 200,
    responsibilities: { deal_lead: 'R', vertical_head: 'A', cio: 'I', ic: '-', board: '-' },
    decision_roles: ['sirius_deal_lead', 'sirius_vertical_head'],
    description: 'A standard ticket; the Vertical Head is accountable and the Deal Lead drives.',
  },
  {
    key: 'elevated', label: 'Elevated', gate: DOA_GATE,
    min_aed: 200, max_aed: 400,
    responsibilities: { deal_lead: 'R', vertical_head: 'C', cio: 'A', ic: 'I', board: '-' },
    decision_roles: ['sirius_deal_lead', 'sirius_vertical_head', 'cio'],
    description: 'An elevated ticket; the CIO is accountable, the Vertical Head consulted.',
  },
  {
    key: 'committee', label: 'Investment Committee', gate: DOA_GATE,
    min_aed: 400, max_aed: 750,
    responsibilities: { deal_lead: 'R', vertical_head: 'C', cio: 'R', ic: 'A', board: 'I' },
    decision_roles: ['cio', 'ic_member'],
    description: 'A committee-scale ticket; the IC is accountable, the CIO responsible.',
  },
  {
    key: 'board', label: 'Board', gate: DOA_GATE,
    min_aed: 750, max_aed: null,
    responsibilities: { deal_lead: 'C', vertical_head: 'C', cio: 'R', ic: 'C', board: 'A' },
    decision_roles: ['board_member'],
    description: 'Above the board threshold; the Board is accountable.',
  },
];

// The band used when the ticket size is not captured. It never escalates on a
// guess: the standard decision set applies and the resolution is marked
// `unknown_size` so the board shows the gap rather than a false authority.
export const DOA_UNSPECIFIED_TIER = {
  key: 'unspecified', label: 'Size not captured', gate: DOA_GATE,
  min_aed: null, max_aed: null,
  responsibilities: { deal_lead: 'R', vertical_head: 'A', cio: 'I', ic: '-', board: '-' },
  decision_roles: ['sirius_deal_lead', 'sirius_vertical_head'],
  description: 'The ticket size is not captured, so the standard decision set applies.',
};

export const DOA_MESSAGES = {
  config_invalid: 'The Delegation of Authority configuration is invalid.',
  band_invalid: 'Each ticket band needs a key, a label and a valid range.',
  band_overlap: 'Ticket bands must not overlap.',
  decision_roles_required: 'Each band must name at least one role that may take the Gate-1 decision.',
  outside_authority: 'Your role is not delegated to take the Gate-1 decision for this ticket size.',
  disclaimer:
    'The Delegation of Authority matrix is maintained by the Investment Committee. ' +
    'The Gate-1 decision is reserved to the roles the band names; anyone else is refused.',
};

// Look up a party definition by key.
export function findDoaParty(key) {
  return DOA_PARTIES.find((p) => p.key === key) || null;
}

// Every platform role that appears in any band, for the admin editor and docs.
export function doaRoleUniverse() {
  const set = new Set();
  for (const t of DOA_TIERS) for (const r of t.decision_roles || []) set.add(r);
  return [...set];
}
