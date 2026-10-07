// ---------------------------------------------------------------------------
// i18n / localisation vocabulary (W8-02 / BRD PLT-06).
//
// The MVP ships English and is Arabic-ready. This file is the single source of
// truth for the locales the platform exposes, their direction, and the chrome
// and shared vocabulary each locale authors. Page-level Arabic copy is authored
// incrementally, so a missing key falls back to English and then to the key.
// ---------------------------------------------------------------------------

export const I18N_VERSION = 'PLT-06.1';
export const I18N_KEY = 'i18n_config';

// UI text direction. Arabic renders right-to-left; every other locale is LTR.
export const DIRECTIONS = ['ltr', 'rtl'];

// The locales available to the language switcher, in display order.
export const LOCALES = [
  { code: 'en', label: 'English', native_label: 'English', dir: 'ltr', default: true },
  { code: 'ar', label: 'Arabic', native_label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', dir: 'rtl', default: false },
];

export const DEFAULT_LOCALE = 'en';

// The screen the RTL acceptance criterion is demonstrated on. Kept as data so
// the demo target and its test target cannot drift apart.
export const RTL_DEMO_SCREEN = { route: '/Dashboard', name: 'Dashboard', label_key: 'dashboard.title' };

// The key set every locale table is validated against: the application chrome
// and the shared deal-flow vocabulary. A locale may omit page-level copy, but a
// gap in this core set is reported by the completeness check.
export const CORE_KEYS = [
  'app.name',
  'app.tagline',
  'nav.dashboard',
  'nav.companies',
  'nav.groupStructure',
  'nav.scenarios',
  'nav.simulator',
  'nav.marketAnalysis',
  'nav.analytics',
  'nav.recommendations',
  'nav.dealPipeline',
  'nav.submitOpportunity',
  'nav.screeningBoard',
  'nav.reporting',
  'nav.pipelineDashboard',
  'nav.pipelineMetrics',
  'nav.opportunityRoute',
  'nav.qanda',
  'nav.myWork',
  'nav.investmentThemes',
  'nav.crm',
  'nav.dueDiligence',
  'nav.settings',
  'nav.superAdmin',
  'user.organization',
  'user.department',
  'user.groups',
  'user.logout',
  'lang.label',
  'common.cancel',
  'common.save',
  'common.close',
  'common.confirm',
  'status.draft',
  'status.submission',
  'status.screening',
  'status.refinement',
  'status.approval',
  'status.returned',
  'status.declined',
  'dashboard.title',
  'dashboard.subtitle',
  'dashboard.addCompany',
  'dashboard.newScenario',
  'dashboard.totalCompanies',
  'dashboard.activeScenarios',
  'dashboard.universeMarketCap',
  'dashboard.avgPremium',
  'dashboard.recentScenarios',
  'dashboard.noScenarios',
  'dashboard.quickStats',
  'dashboard.totalEnterpriseValue',
  'dashboard.avgEvRevenue',
  'dashboard.topSectors',
];

export const I18N_MESSAGES = {
  locale_unknown: 'Unknown locale code',
  locale_no_table: 'That locale has no authored table yet',
};

// Keys the shared config module surfaces for the settings screen: the locale
// list plus the RTL demo target. Kept here so the vocabulary and the API agree.
export function i18nVocabulary() {
  return {
    version: I18N_VERSION,
    key: I18N_KEY,
    default_locale: DEFAULT_LOCALE,
    directions: DIRECTIONS,
    locales: LOCALES,
    rtl_demo_screen: RTL_DEMO_SCREEN,
    core_keys: CORE_KEYS,
  };
}
