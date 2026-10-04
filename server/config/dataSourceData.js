// ---------------------------------------------------------------------------
// Data-point to source mapping vocabulary and shipped default (W5-04 / DOC-05).
//
// Source of truth: the Phase-1 BRD, Documents & Completeness - "Data-point to
// source mapping" with accept criterion "Mapping in config; reviewer opens
// linked source".
//
// Every value a memo prints can be traced back to the artefact or captured
// field it came from. This module holds the shipped mapping (one source per
// memo data point) and the vocabulary behind it, so an administrator can
// re-point a data point without a code change. The mapping is advisory
// provenance only: it never blocks a submission and never changes a value.
// ---------------------------------------------------------------------------

export const DATA_SOURCE_CONFIG_KEY = 'data_source_config';
export const DATA_SOURCE_VERSION = 'SRC-01.1';
export const DATA_SOURCE_DEFAULT_REVISION = 1;
export const DATA_SOURCE_VERSION_PREFIX = 'SRC-01.';

// The kind of artefact a data point is sourced from.
export const DATA_SOURCE_TYPES = [
  { key: 'field', label: 'Captured field (opportunity record)' },
  { key: 'document', label: 'Submission document' },
  { key: 'derived', label: 'Derived / computed' },
  { key: 'external', label: 'External or manual source' },
];

export const DATA_SOURCE_TYPE_KEYS = DATA_SOURCE_TYPES.map((t) => t.key);

// The memo pages a data point can belong to, in the memo's running order.
export const DATA_SOURCE_PAGES = [
  { key: 'executive_summary', label: 'Executive summary' },
  { key: 'overview', label: 'Detailed opportunity overview' },
  { key: 'rationale', label: 'Investment rationale & strategic fit' },
  { key: 'financials', label: 'Financials & returns vs. hurdles' },
  { key: 'funding', label: 'Key asks from Sirius & funding plan' },
  { key: 'risks', label: 'Risk register & compliance screen' },
];

// The shipped catalogue: every memo data point the mapping covers. `kind` and
// `ref` give the sensible default source (a captured field key or a submission
// document requirement key), so an administrator only edits the exceptions.
export const DATA_SOURCE_TARGETS = [
  { key: 'header_total_commitment', label: 'Total commitment (AED mn)', page: 'executive_summary', kind: 'field', ref: 'total_commitment_aed' },
  { key: 'header_ask', label: 'Ask from Sirius (AED mn)', page: 'executive_summary', kind: 'field', ref: 'ask_aed' },
  { key: 'header_opportunity_type', label: 'Opportunity type', page: 'executive_summary', kind: 'field', ref: 'opportunity_type' },
  { key: 'header_target', label: 'Target / counterparty', page: 'executive_summary', kind: 'field', ref: 'target_name' },
  { key: 'overview_what', label: 'The opportunity in brief', page: 'overview', kind: 'document', ref: 'business_plan' },
  { key: 'overview_where', label: 'Sector & geography', page: 'overview', kind: 'field', ref: 'geography' },
  { key: 'rationale_market', label: 'Market data & competitive landscape', page: 'rationale', kind: 'document', ref: 'market_data' },
  { key: 'rationale_synergy', label: 'Synergy case', page: 'rationale', kind: 'document', ref: 'synergy_case' },
  { key: 'financials_historicals', label: 'Financials (historicals + projections)', page: 'financials', kind: 'document', ref: 'financials' },
  { key: 'financials_returns', label: 'Returns vs. hurdles', page: 'financials', kind: 'document', ref: 'returns_model' },
  { key: 'financials_valuation', label: 'Entry valuation & comparables', page: 'financials', kind: 'document', ref: 'valuation_basis' },
  { key: 'funding_source', label: 'Funding source', page: 'funding', kind: 'field', ref: 'funding_source' },
  { key: 'funding_plan', label: 'Funding plan (sources vs uses)', page: 'funding', kind: 'document', ref: 'funding_plan' },
  { key: 'funding_budget', label: 'Budget line / variance justification', page: 'funding', kind: 'document', ref: 'budget_confirmation' },
  { key: 'risks_register', label: 'Risk register', page: 'risks', kind: 'document', ref: 'risk_register' },
  { key: 'risks_compliance', label: 'Compliance screen', page: 'risks', kind: 'document', ref: 'compliance_screen' },
];

export const DATA_SOURCE_TARGET_KEYS = DATA_SOURCE_TARGETS.map((t) => t.key);

// The shipped links: one per data point, pointing at its default source. A note
// gives the reviewer plain-language provenance.
function defaultLinks() {
  return DATA_SOURCE_TARGETS.map((t) => ({
    target: t.key,
    target_label: t.label,
    page: t.page,
    source_type: t.kind,
    source_ref: t.ref,
    note: t.kind === 'document'
      ? 'Taken from the uploaded ' + t.ref.replace(/_/g, ' ') + ' on the record.'
      : 'Captured directly on the opportunity record.',
  }));
}

export const DATA_SOURCE_DEFAULT = {
  version: DATA_SOURCE_VERSION,
  revision: DATA_SOURCE_DEFAULT_REVISION,
  source: 'default',
  links: defaultLinks(),
  updated_by: null,
  updated_at: null,
};

export const DATA_SOURCE_MESSAGES = {
  config_invalid: 'The data-source mapping is invalid.',
  unknown_target: 'Unknown data point.',
  unknown_type: 'Unknown source type.',
  disclaimer:
    'The data-point source mapping is provenance only. It shows where each memo value came from and lets a reviewer open the linked source; it never changes a value or blocks a submission.',
};

export default {
  DATA_SOURCE_CONFIG_KEY, DATA_SOURCE_VERSION, DATA_SOURCE_DEFAULT_REVISION,
  DATA_SOURCE_VERSION_PREFIX, DATA_SOURCE_TYPES, DATA_SOURCE_TYPE_KEYS,
  DATA_SOURCE_PAGES, DATA_SOURCE_TARGETS, DATA_SOURCE_TARGET_KEYS,
  DATA_SOURCE_DEFAULT, DATA_SOURCE_MESSAGES,
};
