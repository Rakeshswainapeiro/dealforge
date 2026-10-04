// ---------------------------------------------------------------------------
// Feature flags (deployment-time / runtime configuration).
//
// The app ships many modules (pipelines, simulations, analytics, CRM, docs,
// etc.). Not every deployment wants every module, so pages can be switched on
// or off as groups, either at deployment time (environment) or at runtime by
// an administrator (AppSettings).
//
// Resolution order (later wins):
//   1. built-in defaults (FEATURE_GROUPS)
//   2. AppSettings feature_flags (runtime, admin-editable)
//   3. FEATURE_FLAGS env var (deployment-time, highest precedence)
//
// The FEATURE_FLAGS env var is a comma-separated list that either fully
// enables (pageKey) or fully disables (-pageKey) a page.
// ---------------------------------------------------------------------------

// Map of every routable page to its default-enabled state. Keeping defaults on
// preserves the historical behaviour unless a deployment opts out.
export const FEATURE_GROUPS = {
  Dashboard: true,
  Companies: true,
  GroupStructure: true,
  DealPipeline: true,
  ScreeningBoard: true,
  SubmitOpportunity: true,
  OpportunityRoute: true,
  Scenarios: true,
  MergerSimulator: true,
  MarketAnalysis: true,
  Analytics: true,
  DealRecommendations: true,
  ThemeAdmin: true,
  CRM: true,
  DueDiligence: true,
  Portfolios: true,
  QandA: true,
  UserManagement: true,
  SuperAdmin: true,
  Settings: true,
  Reporting: true,
  PipelineDashboard: true,
  PipelineMetrics: true,
  MemoPack: true,
  MemoVerification: true,
};

// Curated groups so administrators can flip whole feature areas at once instead
// of page by page. Each entry lists the page keys the group toggles.
export const FEATURE_GROUPS_META = [
  { key: 'data', label: 'Company & Org Data', pages: ['Companies', 'GroupStructure'] },
  { key: 'deal_pipeline', label: 'Deal Pipeline', pages: ['DealPipeline', 'ScreeningBoard', 'SubmitOpportunity', 'OpportunityRoute'] },
  { key: 'analytics', label: 'Analytics & AI', pages: ['Analytics', 'DealRecommendations', 'QandA', 'MarketAnalysis'] },
  { key: 'themes', label: 'Investment Themes', pages: ['ThemeAdmin'] },
  { key: 'simulation', label: 'Simulators & Scenarios', pages: ['Scenarios', 'MergerSimulator'] },
  { key: 'crm_diligence', label: 'CRM & Due Diligence', pages: ['CRM', 'DueDiligence'] },
  { key: 'portfolios', label: 'Portfolios', pages: ['Portfolios'] },
  { key: 'reporting', label: 'Reporting', pages: ['Reporting', 'PipelineDashboard', 'PipelineMetrics', 'MemoPack', 'MemoVerification'] },
  { key: 'admin_tools', label: 'Admin Tools', pages: ['UserManagement', 'SuperAdmin', 'Settings'] },
];

// Runtime settings entity key where administrator overrides are persisted.
export const FEATURE_SETTING_KEY = 'feature_flags';

export function parseEnvFeatures(envValue) {
  if (!envValue || typeof envValue !== 'string') return null;
  const parts = envValue.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const explicit = new Set(parts.filter((p) => !p.startsWith('-')).map((p) => (p[0] === '+' ? p.slice(1) : p)));
  const disabled = new Set(parts.filter((p) => p.startsWith('-')).map((p) => p.slice(1)));
  const hasExplicit = explicit.size > 0;

  return { explicit, disabled, hasExplicit };
}

export function resolveFeatureFlags({ defaults = FEATURE_GROUPS, runtime = {}, env = process.env.FEATURE_FLAGS } = {}) {
  const map = { ...defaults };
  if (runtime && typeof runtime === 'object') {
    for (const [key, value] of Object.entries(runtime)) {
      if (key in defaults || value === false) map[key] = Boolean(value);
    }
  }
  const parsed = parseEnvFeatures(env);
  if (parsed) {
    if (parsed.hasExplicit) {
      for (const key of Object.keys(map)) map[key] = parsed.explicit.has(key) && !parsed.disabled.has(key);
    } else {
      for (const key of parsed.disabled) map[key] = false;
    }
  }
  return map;
}

export function isFeatureEnabled(features, pageKey) {
  return features ? Boolean(features[pageKey]) : true;
}
