// ---------------------------------------------------------------------------
// Portfolio register - hand-authored vocabulary and BRD source list (W4-01 /
// ENT-04).
//
// The BRD names fifteen existing portfolio companies. Each is matched to its
// record in the Sirius subsidiary register so its sector, geography and
// capability tags come from the registered nature of business; two names
// (ADI Chain, DDSC) sit outside the Sirius subtree and carry an explicit BRD
// source. This module holds the things that are configuration rather than
// derivation: the cluster taxonomy, the sector -> cluster map, the capability
// vocabulary and the BRD source list itself.
//
// The derived register rows live in generatedPortfolioRegister.js (regenerate
// with node scripts/generate_portfolio_register.mjs).
// ---------------------------------------------------------------------------

export const PORTFOLIO_REGISTER_VERSION = 'PR-01.1';
export const PORTFOLIO_REGISTER_CONFIG_KEY = 'portfolio_register_config';
export const PORTFOLIO_REGISTER_DEFAULT_REVISION = 1;

// Cluster taxonomy (BRD ENT-04 / DSH-01 "by cluster"). Order is presentation
// order in the register.
export const PORTFOLIO_CLUSTERS = [
  { key: 'technology_digital', label: 'Technology & Digital' },
  { key: 'financial_services', label: 'Financial Services' },
  { key: 'healthcare_life_sciences', label: 'Healthcare & Life Sciences' },
  { key: 'energy_utilities', label: 'Energy & Utilities' },
  { key: 'industrials_infrastructure', label: 'Industrials & Infrastructure' },
  { key: 'consumer_retail', label: 'Consumer & Retail' },
  { key: 'business_services', label: 'Business Services' },
  { key: 'real_estate', label: 'Real Estate' },
  { key: 'other', label: 'Other' },
];

export const PORTFOLIO_CLUSTER_KEYS = PORTFOLIO_CLUSTERS.map((c) => c.key);

// The sector set used by the pipeline (server/config/natureOfBusiness.js).
export const PORTFOLIO_CLUSTER_BY_SECTOR = {
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

// Capability tags - the controlled vocabulary a register record's capabilities
// are drawn from (BRD ENT-04 "capability tags"). Free text is allowed but these
// are the ones the importer recognises verbatim.
export const PORTFOLIO_CAPABILITY_VOCABULARY = [
  'ai', 'analytics', 'asset management', 'clearing', 'cloud', 'consultancy',
  'custody', 'data', 'digital', 'efficiency', 'engineering', 'equipment',
  'facilities management', 'healthcare', 'infrastructure', 'insurance',
  'investment', 'it services', 'logistics', 'manufacturing', 'marketplace',
  'mobility', 'payments', 'platform', 'research', 'saas', 'software',
  'trading', 'treasury', 'utilities',
];

export const PORTFOLIO_STATUSES = ['active', 'exited', 'watchlist'];

// The fifteen portfolio companies named in BRD ENT-04, in BRD order. 'pattern'
// locates the entity in the Sirius subsidiary register; the derived sector,
// geography and capabilities come from that entity's registered nature of
// business.
export const BRD_PORTFOLIO_NAMES = [
  { name: 'Esyasoft', pattern: 'Esyasoft Holding Ltd' },
  { name: 'ADI Chain', pattern: null },
  { name: 'Judan', pattern: null },
  { name: 'SAIF', pattern: 'Saif Limited' },
  { name: 'Coredge', pattern: 'Coredge.IO Limited' },
  { name: 'Infinia', pattern: 'Infinia Technologies Limited' },
  { name: 'Finstreet', pattern: 'Finstreet Limited' },
  { name: 'DDSC', pattern: null },
  { name: 'Oxinus', pattern: 'Oxinus Holding Limited' },
  { name: 'Derby', pattern: 'Derby Group Holding Ltd' },
  { name: 'Bayanat', pattern: 'Bay Engineering Group Ltd' },
  { name: 'CMC', pattern: 'CMC Holding LLC' },
  { name: 'Sanimed', pattern: 'Sanimed International Lab and Management LLC' },
  { name: 'Atlas', pattern: 'Atlas Medical LLC' },
  { name: 'Apeiro', pattern: 'APEIRO Limited' },
];

// The two names with no Sirius-subtree record: carried with the BRD as their
// source (the client's confirmation of their tags is open decision Q6).
export const BRD_ONLY_PORTFOLIO = [
  {
    name: 'Judan',
    cluster: 'financial_services',
    sector: 'Financial Services',
    geography: 'United Arab Emirates',
    geographies: ['UAE', 'GCC'],
    capabilities: ['investment', 'asset management', 'holding'],
    principal_activities: 'Financial holding and special-purpose investment vehicle (BRD-named portfolio company; no Sirius-subtree record).',
    note: 'Tags pending client confirmation (BRD ENT-04 / open decision Q6).',
  },
  {
    name: 'ADI Chain',
    cluster: 'technology_digital',
    sector: 'Technology',
    geography: 'United Arab Emirates',
    geographies: ['UAE', 'GCC'],
    capabilities: ['blockchain', 'platform', 'digital'],
    principal_activities: 'Distributed ledger and digital asset platform (BRD-named portfolio company; no Sirius-subtree record).',
    note: 'Tags pending client confirmation (BRD ENT-04 / open decision Q6).',
  },
  {
    name: 'DDSC',
    cluster: 'business_services',
    sector: 'Business Services',
    geography: 'United Arab Emirates',
    geographies: ['UAE', 'GCC'],
    capabilities: ['consultancy', 'digital'],
    principal_activities: 'Digital and business services (BRD-named portfolio company; no Sirius-subtree record).',
    note: 'Tags pending client confirmation (BRD ENT-04 / open decision Q6).',
  },
];

export const PORTFOLIO_REGISTER_DISCLAIMER =
  'The portfolio register is reference data for advisory synergy and conflict checks; it never blocks an opportunity.';

export default {
  PORTFOLIO_REGISTER_VERSION, PORTFOLIO_REGISTER_CONFIG_KEY, PORTFOLIO_REGISTER_DEFAULT_REVISION,
  PORTFOLIO_CLUSTERS, PORTFOLIO_CLUSTER_KEYS, PORTFOLIO_CLUSTER_BY_SECTOR,
  PORTFOLIO_CAPABILITY_VOCABULARY, PORTFOLIO_STATUSES,
  BRD_PORTFOLIO_NAMES, BRD_ONLY_PORTFOLIO, PORTFOLIO_REGISTER_DISCLAIMER,
};
