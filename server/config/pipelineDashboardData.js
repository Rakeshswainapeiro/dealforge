// ---------------------------------------------------------------------------
// Pipeline dashboard filters - vocabulary (W7-02 / BRD DSH-01).
//
// The Investment Team dashboard slices the pipeline by entity, cluster, sector,
// state, owner and date, then drills down into any cut. This module holds the
// filter dimensions and the cluster map; it contains no database access.
// ---------------------------------------------------------------------------

export const PIPELINE_DASHBOARD_KEY = 'pipeline_dashboard_config';
export const PIPELINE_DASHBOARD_VERSION = 'PDB-01.1';
export const PIPELINE_DASHBOARD_VERSION_PREFIX = 'PDB-01';
export const PIPELINE_DASHBOARD_DEFAULT_REVISION = 1;

// The filter dimensions exposed to the UI, in display order. Each carries the
// parameter name and whether multiple values may be selected.
export const FILTER_DIMENSIONS = [
  { key: 'entity', label: 'Entity', param: 'entity', multi: true, source: 'org' },
  { key: 'cluster', label: 'Cluster', param: 'cluster', multi: true, source: 'derived' },
  { key: 'sector', label: 'Sector', param: 'sector', multi: true, source: 'card' },
  { key: 'state', label: 'Stage', param: 'state', multi: true, source: 'card' },
  { key: 'owner', label: 'Owner', param: 'owner', multi: true, source: 'card' },
  { key: 'date', label: 'Updated', param: 'date', multi: false, source: 'card' },
];

export const FILTER_PARAMS = FILTER_DIMENSIONS.map((d) => d.param);

// The date presets the date filter offers.
export const DATE_PRESETS = [
  { key: 'any', label: 'Any time', days: null },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
];

// Sector -> cluster map (mirrors the portfolio register taxonomy so the two
// dashboards slice the same way).
export const CLUSTER_BY_SECTOR = {
  Technology: 'technology_digital',
  Telecommunications: 'technology_digital',
  'Financial Services': 'financial_services',
  Healthcare: 'healthcare_life_sciences',
  Energy: 'energy_utilities',
  Industrials: 'industrials_infrastructure',
  'Consumer Goods': 'consumer_retail',
  'Business Services': 'business_services',
  'Real Estate': 'real_estate',
  Holding: 'other',
};

export const CLUSTER_LABELS = {
  technology_digital: 'Technology & Digital',
  financial_services: 'Financial Services',
  healthcare_life_sciences: 'Healthcare & Life Sciences',
  energy_utilities: 'Energy & Utilities',
  industrials_infrastructure: 'Industrials & Infrastructure',
  consumer_retail: 'Consumer & Retail',
  business_services: 'Business Services',
  real_estate: 'Real Estate',
  other: 'Other',
};

// The fields a drill-down may group by.
export const DRILLDOWN_DIMENSIONS = ['entity', 'cluster', 'sector', 'state', 'owner'];

export const PIPELINE_DASHBOARD_MESSAGES = {
  disclaimer:
    'The pipeline dashboard reflects the live board; filters and drill-downs are applied over the actor\u2019s own organisation scope.',
  drilldown_note: 'Drill down groups the filtered pipeline by the chosen dimension.',
};
