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

// Map of every routable page to its default-enabled state (Phase 1 scope,
// DealForge_Phase1_BRD_v2). Later-phase pages ship switched OFF: their code is
// kept, but they are hidden from the menu and routes until an administrator
// enables them (Settings > Features) or FEATURE_FLAGS lists them.
export const FEATURE_GROUPS = {
  // Phase 1
  SubmitOpportunity: true,
  ScreeningBoard: true,
  OpportunityRoute: true,
  QandA: true,
  PipelineDashboard: true,
  PipelineMetrics: true,
  Reporting: true,
  GroupStructure: true,
  ThemeAdmin: true,
  SuperAdmin: true,
  Settings: true,
  MemoPack: true,
  MemoVerification: true,
  // Not in the menu; routable only as the PLT-06 RTL demonstration screen
  // (config/i18nData.js RTL_DEMO_SCREEN) until that demo moves to a Phase 1 page.
  Dashboard: true,
  // Later phase - off by default
  DueDiligence: false, // Gate 3 diligence tracking - BRD WF-09, Phase 2
  Portfolios: false, // post-investment tracking - BRD DSH-05, Phase 4
};

// Curated groups so administrators can flip whole feature areas at once instead
// of page by page. Each entry lists the page keys the group toggles.
export const FEATURE_GROUPS_META = [
  { key: 'deal_pipeline', label: 'Deal Pipeline', pages: ['SubmitOpportunity', 'ScreeningBoard', 'OpportunityRoute', 'QandA'] },
  { key: 'reporting', label: 'Reporting', pages: ['PipelineDashboard', 'PipelineMetrics', 'Reporting', 'MemoPack', 'MemoVerification'] },
  { key: 'data', label: 'Organisation & Themes', pages: ['GroupStructure', 'ThemeAdmin'] },
  { key: 'admin_tools', label: 'Admin Tools', pages: ['SuperAdmin', 'Settings'] },
  { key: 'later_phase', label: 'Later phase (off in Phase 1)', pages: ['DueDiligence', 'Portfolios'] },
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
