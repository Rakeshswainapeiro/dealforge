// ---------------------------------------------------------------------------
// Unified admin configuration vocabulary (W8-03 / BRD ADM-01).
//
// Source of truth: the Phase-1 BRD, Administration - a single governed place
// where an administrator can see and retune every tunable that shapes a
// screening: hurdle rates, thresholds, scorecard weights, document checklists,
// routing / delegation-of-authority, SLAs, decision reason codes and picklists.
//
// Historically each of those is an independent AppSettings-backed configuration
// area with its own router, revision counter and audit action. Rather than
// replace those stores (and risk breaking live screens), W8-03 layers a single
// registry over them: it lists every area, where it is edited, whether it is
// versioned and audited, and exposes each area's revision history drawn from
// the immutable audit trail.
//
// Acceptance: "Admin edits versioned + audited; applies only to new screenings."
// ---------------------------------------------------------------------------

export const ADMIN_CONFIG_VERSION = 'ADM-01.1';
export const ADMIN_CONFIG_KEY = 'admin_config';
export const ADMIN_CONFIG_OWNER = 'Platform / Group Investment Office';

// Shown on every area so the semantics are unambiguous: a published change is a
// new baseline and never silently rewrites a screening already in flight.
export const NEW_WORK_SCOPE_NOTE =
  'Configuration changes are versioned and audited, and take effect for new '
  + 'screenings only. Work already in progress keeps the version it was screened '
  + 'against, so an in-flight case is never silently re-scored.';

// The topical groups the registry organises areas into.
export const CONFIG_GROUPS = [
  { key: 'scoring', label: 'Scoring & Weights', description: 'Scorecards, weights and evidence-quality scoring.' },
  { key: 'mandate', label: 'Mandate & Hurdles', description: 'Investment mandate, hurdle rates and strategy themes.' },
  { key: 'gate', label: 'Gates & Evidence', description: 'Qualifying gates, checklists, sufficiency and reason codes.' },
  { key: 'routing', label: 'Routing & Authority', description: 'Delegation of authority and approval routing.' },
  { key: 'lifecycle', label: 'Pipeline & SLA', description: 'Pipeline stages, metrics, SLAs and notification cadence.' },
  { key: 'governance', label: 'Governance & Audit', description: 'Audit chain, comment visibility, related-party and auth policy.' },
  { key: 'outputs', label: 'Outputs & Reporting', description: 'Reporting, templates, presentations and portfolio register.' },
];
export const CONFIG_GROUP_KEYS = CONFIG_GROUPS.map((g) => g.key);

// Every configurable area: where it is stored, edited, audited and implemented.
//   domain    - stable identifier used in URLs (/api/admin-config/:domain)
//   key       - AppSettings setting_key, or null when the area is not a single
//               JSON setting (e.g. a table or a corpus)
//   action    - audit_event.action written when the area changes
//   route     - the API route an administrator edits the area through
//   code      - the module that resolves / persists the area
//   versioned - whether the area carries an explicit revision counter
//   audited   - whether every change is written to the immutable audit trail
export const CONFIG_DOMAINS = [
  { domain: 'scorecard', label: 'Scorecard & Weights', group: 'scoring', key: 'scorecard_config', action: 'scorecard_config_updated', route: '/api/gate/scorecard-config', code: 'server/config/scorecard.js', versioned: true, audited: true },
  { domain: 'quality_score', label: 'Evidence Quality Score', group: 'scoring', key: 'quality_score_config', action: 'quality_score_config_updated', route: '/api/gate/quality-score-config', code: 'server/config/qualityScore.js', versioned: true, audited: true },
  { domain: 'sirius_mandate', label: 'Sirius Investment Mandate', group: 'mandate', key: 'sirius_mandate_config', action: 'sirius_mandate_updated', route: '/api/mandate', code: 'server/config/siriusMandate.js', versioned: true, audited: true },
  { domain: 'hurdles', label: 'Hurdle Rates & Thresholds', group: 'mandate', key: null, action: 'update', route: '/api/themes/hurdle-policy', code: 'server/themes.js', versioned: false, audited: true },
  { domain: 'strategy', label: 'Strategy Themes Corpus', group: 'mandate', key: null, action: 'strategy_index_updated', route: '/api/strategy', code: 'server/strategy.js', versioned: true, audited: true },
  { domain: 'checklist', label: 'Document Checklist', group: 'gate', key: 'document_checklist_config', action: 'document_checklist_updated', route: '/api/checklist', code: 'server/config/documentChecklist.js', versioned: true, audited: true },
  { domain: 'document_policy', label: 'Document Policy', group: 'gate', key: 'document_policy_config', action: 'document_policy_updated', route: '/api/document-policy', code: 'server/config/documentPolicy.js', versioned: true, audited: true },
  { domain: 'sufficiency', label: 'Evidence Sufficiency', group: 'gate', key: 'sufficiency_config', action: 'sufficiency_config_updated', route: '/api/sufficiency', code: 'server/config/sufficiency.js', versioned: true, audited: true },
  { domain: 'decision_reasons', label: 'Decision Reason Codes', group: 'gate', key: 'decision_reason_config', action: 'decision_reason_config_updated', route: '/api/decision-reasons', code: 'server/config/decisionReasons.js', versioned: true, audited: true },
  { domain: 'doa', label: 'Delegation of Authority', group: 'routing', key: 'doa_config', action: 'doa_config_updated', route: '/api/doa', code: 'server/config/doa.js', versioned: true, audited: true },
  { domain: 'pipeline_dashboard', label: 'Pipeline Dashboard Layout', group: 'lifecycle', key: 'pipeline_dashboard_config', action: 'pipeline_dashboard_config_updated', route: '/api/pipeline-dashboard', code: 'server/config/pipelineDashboard.js', versioned: true, audited: true },
  { domain: 'pipeline_metrics', label: 'Pipeline Metrics & SLA', group: 'lifecycle', key: 'pipeline_metrics_config', action: 'pipeline_metrics_config_updated', route: '/api/pipeline-metrics', code: 'server/config/pipelineMetrics.js', versioned: true, audited: true },
  { domain: 'notification_frequency', label: 'Notification Frequency', group: 'lifecycle', key: 'notification_frequency_config', action: 'notification_frequency_config_updated', route: '/api/notification-frequency', code: 'server/config/notificationFrequency.js', versioned: true, audited: true },
  { domain: 'audit_chain', label: 'Audit Chain', group: 'governance', key: 'audit_chain_config', action: 'audit_chain_config_updated', route: '/api/audit-chain', code: 'server/config/auditChain.js', versioned: true, audited: true },
  { domain: 'comment_visibility', label: 'Comment Visibility', group: 'governance', key: 'comment_visibility_config', action: 'comment_visibility_config_updated', route: '/api/comment-visibility', code: 'server/config/commentVisibility.js', versioned: true, audited: true },
  { domain: 'related_party', label: 'Related-Party Rules', group: 'governance', key: 'related_party_config', action: 'related_party_config_updated', route: '/api/related-party', code: 'server/config/relatedParty.js', versioned: true, audited: true },
  { domain: 'auth_policy', label: 'Authentication Policy (MFA / SSO)', group: 'governance', key: 'auth_policy_config', action: 'auth_policy_config_updated', route: '/api/auth-policy', code: 'server/config/authPolicy.js', versioned: true, audited: true },
  { domain: 'feature_flags', label: 'Feature Flags & Modules', group: 'governance', key: 'feature_flags', action: 'update', route: '/api/features', code: 'server/config/featureFlags.js', versioned: false, audited: true },
  { domain: 'data_sources', label: 'Data Sources', group: 'governance', key: 'data_source_config', action: 'data_source_config_updated', route: '/api/data-sources', code: 'server/config/dataSource.js', versioned: true, audited: true },
  { domain: 'reporting', label: 'Reporting Settings', group: 'outputs', key: 'reporting_config', action: 'reporting_config_updated', route: '/api/reporting', code: 'server/config/reporting.js', versioned: true, audited: true },
  { domain: 'presentation', label: 'Presentation Sessions', group: 'outputs', key: 'presentation_session_config', action: 'presentation_config_updated', route: '/api/presentations', code: 'server/config/presentationSessions.js', versioned: true, audited: true },
  { domain: 'templates', label: 'Template Library', group: 'outputs', key: 'template_library_config', action: 'template_library_updated', route: '/api/templates', code: 'server/config/templateLibrary.js', versioned: true, audited: true },
  { domain: 'portfolio_register', label: 'Portfolio Register', group: 'outputs', key: 'portfolio_register_config', action: 'portfolio_register_updated', route: '/api/portfolio-register', code: 'server/config/portfolioRegister.js', versioned: true, audited: true },
];
export const CONFIG_DOMAIN_KEYS = CONFIG_DOMAINS.map((d) => d.domain);

export const ADMIN_CONFIG_MESSAGES = {
  domain_unknown: 'No configuration area with that identifier.',
  admin_required: 'Administrator role required to view or edit the configuration registry.',
  scope_note: NEW_WORK_SCOPE_NOTE,
  disclaimer:
    'Every tunable that shapes a screening is registered here with the route that edits it, '
    + 'whether it is versioned, and its change history from the immutable audit trail. '
    + 'Published changes are versioned and audited and apply to new screenings only.',
};

export default {
  ADMIN_CONFIG_VERSION, ADMIN_CONFIG_KEY, ADMIN_CONFIG_OWNER,
  NEW_WORK_SCOPE_NOTE, CONFIG_GROUPS, CONFIG_GROUP_KEYS,
  CONFIG_DOMAINS, CONFIG_DOMAIN_KEYS, ADMIN_CONFIG_MESSAGES,
};
