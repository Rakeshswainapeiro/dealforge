// Client-side feature/menu configuration helper.
//
// The effective feature map arrives from the server at
// /api/auth/public-settings (public) and /api/features (authenticated), and is
// merged with UI defaults below so the menu and routes keep working even when
// the backend is offline or the flags are not configured.

// Must mirror FEATURE_GROUPS in server/config/featureFlags.js (Phase 1 scope):
// later-phase pages stay hidden even when the server is unreachable.
export const CLIENT_FEATURE_DEFAULTS = {
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
  Dashboard: true,
  DueDiligence: false,
  Portfolios: false,
};

// Merge a server-provided map over the client defaults. Missing keys inherit
// the default (enabled).
export function normalizeFeatures(serverFeatures) {
  if (!serverFeatures || typeof serverFeatures !== 'object') return { ...CLIENT_FEATURE_DEFAULTS };
  const out = { ...CLIENT_FEATURE_DEFAULTS };
  for (const [key, value] of Object.entries(serverFeatures)) {
    if (key in out || value === false) out[key] = Boolean(value);
  }
  return out;
}

// Whether a given page key is enabled.
export function isPageEnabled(features, pageKey) {
  return features ? Boolean(features[pageKey]) : true;
}

// Evaluate a navigation item against the feature map. Items carry either an
// explicit page key or a list of page keys; an item is shown if at least one
// of its pages is enabled.
export function navItemEnabled(features, item) {
  const keys = item.pages || (item.page ? [item.page] : null);
  if (!keys || keys.length === 0) return true;
  return keys.some((k) => isPageEnabled(features, k));
}

// Filter a PAGES map down to enabled pages, preserving the original key order.
export function filterPages(PAGES, features) {
  const out = {};
  for (const [key, Page] of Object.entries(PAGES)) {
    if (isPageEnabled(features, key)) out[key] = Page;
  }
  return out;
}
