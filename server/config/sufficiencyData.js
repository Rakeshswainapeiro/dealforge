// ---------------------------------------------------------------------------
// Content sufficiency check vocabulary and shipped defaults (W5-03 / DOC-04).
//
// Source of truth: the Phase-1 BRD, Documents & Completeness - "Content
// sufficiency check (e.g. model missing cash flow, < 3y history, no downside)"
// with accept criterion "Flags to preparer pre-submit and reviewer post;
// override with reason".
//
// Every rule is advisory: a deficiency is raised as a flag with its observed and
// expected value and a plain reason, never as a hard block. A reviewer may
// override a flag with a written reason. The thresholds, the enabled set and the
// operator wording all live here so an administrator can change them without a
// code change (REQ-RULE-10).
// ---------------------------------------------------------------------------

export const SUFFICIENCY_CONFIG_KEY = 'sufficiency_config';
// The per-opportunity record of reviewer overrides, keyed by rule key. Stored on
// the opportunity data so it travels with the deal, like the scorecard override.
export const SUFFICIENCY_OVERRIDE_TAG = 'sufficiency_overrides';
export const SUFFICIENCY_VERSION = 'SUF-01.1';
export const SUFFICIENCY_DEFAULT_REVISION = 1;
export const SUFFICIENCY_VERSION_PREFIX = 'SUF-01.';

// Minimum length of a reviewer override reason, matching the scorecard override.
export const SUFFICIENCY_REASON_MIN = 10;

// The default number of years of actual financial history a complete submission
// is expected to carry (BRD DOC-04: "< 3y history").
export const SUFFICIENCY_MIN_HISTORY_YEARS = 3;

// The rule categories, mirroring the BRD examples and the artefact families.
export const SUFFICIENCY_CATEGORIES = [
  { key: 'financials', label: 'Financials' },
  { key: 'returns', label: 'Returns & scenarios' },
  { key: 'documents', label: 'Documents' },
];

// The shipped rule set. Each rule is advisory and names the module that
// produces the evidence, so the evaluator never re-derives a rule. `severity`
// is fixed at 'advisory' for the MVP; the field exists so a future release can
// mark a rule as a warning without a schema change.
export const SUFFICIENCY_RULES = [
  {
    key: 'cash_flow',
    label: 'Cash flow present',
    category: 'financials',
    severity: 'advisory',
    enabled: true,
    configurable: false,
    description: 'The three-statement model must carry a cash flow statement and a derivable free cash flow.',
    message: 'The model is missing a cash flow statement; add the linked cash flow so the returns can be traced to cash.',
  },
  {
    key: 'history_years',
    label: 'At least 3 years of history',
    category: 'financials',
    severity: 'advisory',
    enabled: true,
    configurable: true,
    threshold_key: 'min_history_years',
    description: 'Actual financial history should span at least the configured number of years.',
    message: 'Fewer years of actual history were captured than the policy expects; confirm the trading record or explain the short history.',
  },
  {
    key: 'downside_case',
    label: 'Downside scenario present',
    category: 'returns',
    severity: 'advisory',
    enabled: true,
    configurable: false,
    description: 'Base, upside and downside returns are required; the survivable downside must be present.',
    message: 'No downside case was captured; add the survivable downside scenario for Equity IRR, ROIC and payback.',
  },
  {
    key: 'model_attached',
    label: 'Three-statement model attached',
    category: 'documents',
    severity: 'advisory',
    enabled: true,
    configurable: false,
    description: 'The linked three-statement model should be attached to the submission.',
    message: 'The three-statement model was not attached; upload the linked P&L, balance sheet and cash flow.',
  },
  {
    key: 'risk_register',
    label: 'Risk register attached',
    category: 'documents',
    severity: 'advisory',
    enabled: true,
    configurable: false,
    description: 'A risk register should accompany the submission.',
    message: 'No risk register was attached; add one so the key risks and mitigations are on the record.',
  },
  {
    key: 'market_data',
    label: 'Market data attached',
    category: 'documents',
    severity: 'advisory',
    enabled: true,
    configurable: false,
    description: 'Market data should support the growth and valuation assumptions.',
    message: 'No market data was attached; add the supporting market evidence for the growth and valuation assumptions.',
  },
];

export const SUFFICIENCY_RULE_KEYS = SUFFICIENCY_RULES.map((r) => r.key);

// The BRD-mandated examples, called out so the UI can mark them.
export const SUFFICIENCY_BRD_EXAMPLES = ['cash_flow', 'history_years', 'downside_case'];

export const SUFFICIENCY_DEFAULT = {
  version: SUFFICIENCY_VERSION,
  revision: SUFFICIENCY_DEFAULT_REVISION,
  source: 'default',
  min_history_years: SUFFICIENCY_MIN_HISTORY_YEARS,
  rules: SUFFICIENCY_RULES.map((r) => ({
    key: r.key,
    label: r.label,
    category: r.category,
    severity: r.severity,
    enabled: r.enabled,
  })),
  updated_by: null,
  updated_at: null,
};

export const SUFFICIENCY_MESSAGES = {
  config_invalid: 'The sufficiency configuration is invalid.',
  unknown_rule: 'Unknown sufficiency rule.',
  reason_required:
    'A written reason of at least ' + SUFFICIENCY_REASON_MIN + ' characters is required to override a sufficiency flag.',
  all_sufficient: 'All content sufficiency checks passed. Nothing needs attention before review.',
  deficiencies:
    'The submission has content sufficiency flags. These are advisory: address them or record a reviewer override with a reason.',
  disclaimer:
    'The content sufficiency check is advisory. It flags thin content for a person to resolve or override with a reason; it never blocks a submission.',
};

export default {
  SUFFICIENCY_CONFIG_KEY, SUFFICIENCY_VERSION, SUFFICIENCY_DEFAULT_REVISION,
  SUFFICIENCY_VERSION_PREFIX, SUFFICIENCY_REASON_MIN, SUFFICIENCY_MIN_HISTORY_YEARS,
  SUFFICIENCY_CATEGORIES, SUFFICIENCY_RULES, SUFFICIENCY_RULE_KEYS,
  SUFFICIENCY_BRD_EXAMPLES, SUFFICIENCY_DEFAULT, SUFFICIENCY_MESSAGES,
};
