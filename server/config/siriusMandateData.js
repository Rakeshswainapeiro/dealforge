// ---------------------------------------------------------------------------
// Sirius group mandate - hand-authored vocabulary and default content
// (W4-04 / BRD ENT-03).
//
// The group mandate is the Sirius-level investment mandate: the sectors in
// scope, the geography posture, the stage and instrument policy, the ticket
// band, the holding horizon, the governance stance and the anchor "1bn people
// into the digital economy by 2030" objective. It is versioned configuration
// held in an AppSettings record (setting_key = 'sirius_mandate_config'); an
// administrator can edit it and each save mints the next revision, so the
// mandate a screening was run against can always be reconstructed.
//
// The default content is grounded in the client brief
// (research/client/Sirius_Investment_Brief_2page.pdf): the seven operating
// clusters, the sectors in scope, and the 16+ markets / UAE and GCC core.
// ---------------------------------------------------------------------------

export const SIRIUS_MANDATE_VERSION = 'SM-01.1';
export const SIRIUS_MANDATE_CONFIG_KEY = 'sirius_mandate_config';
export const SIRIUS_MANDATE_DEFAULT_REVISION = 1;
export const SIRIUS_MANDATE_VERSION_PREFIX = 'SM-01.';

// The healthy / advisory statuses a mandate record may carry (a mandate is
// either in force for screening or retained as a historical revision).
export const SIRIUS_MANDATE_STATUSES = ['in_force', 'superseded'];

// The investment-vehicle instruments the mandate permits.
export const SIRIUS_MANDATE_INSTRUMENTS = [
  { key: 'majority_equity', label: 'Majority equity' },
  { key: 'significant_minority', label: 'Significant minority equity' },
  { key: 'structured_growth_capital', label: 'Structured growth capital' },
  { key: 'joint_venture', label: 'Joint venture' },
];
export const SIRIUS_MANDATE_INSTRUMENT_KEYS = SIRIUS_MANDATE_INSTRUMENTS.map((i) => i.key);

// The stage policy vocabulary.
export const SIRIUS_MANDATE_STAGES = [
  { key: 'revenue_platform_scaling', label: 'Revenue-generating platforms ready to scale' },
  { key: 'selective_early_stage', label: 'Selective earlier-stage where strategic to the ecosystem' },
];
export const SIRIUS_MANDATE_STAGE_KEYS = SIRIUS_MANDATE_STAGES.map((s) => s.key);

// The seven operating clusters named in the brief. The cluster keys line up
// with the portfolio register taxonomy (server/config/portfolioRegisterData.js)
// so a mandate sector can be traced to the cluster it sits in.
export const SIRIUS_MANDATE_CLUSTERS = [
  { key: 'technology_digital', label: 'AI & sovereign cloud', portfolio: ['SAIF', 'Coredge', 'Infinia'] },
  { key: 'financial_services', label: 'Digital payments & stablecoin', portfolio: ['Finstreet', 'DDSC'] },
  { key: 'business_services', label: 'Digital government & e-invoicing', portfolio: ['Oxinus'] },
  { key: 'business_services_rail', label: 'Business services & operating rail', portfolio: ['Derby Group'] },
  { key: 'energy_utilities', label: 'Energy digitalisation / EaaS', portfolio: ['Esyasoft'] },
  { key: 'industrials_infrastructure', label: 'Aviation & terminal intelligence', portfolio: ['Bayanat Engineering'] },
  { key: 'healthcare_life_sciences', label: 'Healthcare & life sciences', portfolio: ['CMC Holding', 'Sanimed', 'Atlas', 'Apeiro'] },
];

// The sectors in scope, verbatim from the brief's "Sectors in scope" row.
export const SIRIUS_MANDATE_SECTORS = [
  'Technology',
  'Financial Services',
  'Business Services',
  'Healthcare',
  'Energy',
  'Industrials',
  'Telecommunications',
];

// The geography posture from the brief: UAE and GCC core, live in 16+ markets,
// international where a platform can be exported via the IHC network.
export const SIRIUS_MANDATE_GEOGRAPHY = {
  core: ['UAE', 'GCC'],
  posture: 'UAE and GCC core; live in 16+ markets; international where a platform can be exported via the IHC network.',
  markets_served: 16,
};

// The anchor objective: one billion people brought into the digital economy by
// 2030. Every investment is tested against it.
export const SIRIUS_MANDATE_OBJECTIVE = {
  statement: 'One billion people brought into the digital economy by 2030.',
  people_by_2030: 1000000000,
  target_year: 2030,
  note: 'Every Sirius investment is tested against that objective - does it put more people, businesses and institutions onto digital infrastructure they can trust: payments, identity, healthcare, energy, mobility and AI?',
};

// The seven growth vectors named in the brief.
export const SIRIUS_MANDATE_GROWTH_VECTORS = [
  'Deepen sovereign AI and cloud',
  'Scale regulated digital finance',
  'Win national-scale rollouts',
  'Export the portfolio',
  'Integrate the healthcare value chain',
  'Industrialise the services rail',
  'Stay aligned to national priorities',
];

// The institutional readiness tests ("what we look for").
export const SIRIUS_MANDATE_LOOK_FORS = [
  'Platform economics - serves a market or a country, not one customer.',
  'Regulatory fit - operates inside regulated or sovereign environments.',
  'Exportability - travels across the markets we already serve.',
  'Ecosystem fit - worth more inside the group than outside it.',
  'Institutional readiness - governance we can scale, not rebuild.',
  'Management fit - teams who want an operating partner.',
];

// The ticket band. The brief marks the range as pending confirmation
// (open decision Q3); the shipped value is the AED 10m floor the rest of the
// engine already uses, with the ceiling left open.
export const SIRIUS_MANDATE_TICKET = {
  min_aed: 10,
  max_aed: null,
  unit: 'AED m',
  note: 'Ticket range pending client confirmation (open decision Q3).',
};

export const SIRIUS_MANDATE_HOLDING = {
  policy: 'Long-term, strategic - balance-sheet capital, not a fixed fund life.',
  confirmed: false,
  note: 'Holding horizon pending client confirmation.',
};

export const SIRIUS_MANDATE_GOVERNANCE =
  "IHC-aligned governance, compliance and reporting; board representation; aligned to UAE national priorities and 'We the UAE 2031'.";

export const SIRIUS_MANDATE_DISCLAIMER =
  'The group mandate is advisory reference data: it frames what is in scope for screening but never blocks an opportunity on its own. Items pending client confirmation are flagged and do not gate a submission.';

export default {
  SIRIUS_MANDATE_VERSION, SIRIUS_MANDATE_CONFIG_KEY, SIRIUS_MANDATE_DEFAULT_REVISION,
  SIRIUS_MANDATE_VERSION_PREFIX, SIRIUS_MANDATE_STATUSES, SIRIUS_MANDATE_INSTRUMENTS,
  SIRIUS_MANDATE_INSTRUMENT_KEYS, SIRIUS_MANDATE_STAGES, SIRIUS_MANDATE_STAGE_KEYS,
  SIRIUS_MANDATE_CLUSTERS, SIRIUS_MANDATE_SECTORS, SIRIUS_MANDATE_GEOGRAPHY,
  SIRIUS_MANDATE_OBJECTIVE, SIRIUS_MANDATE_GROWTH_VECTORS, SIRIUS_MANDATE_LOOK_FORS,
  SIRIUS_MANDATE_TICKET, SIRIUS_MANDATE_HOLDING, SIRIUS_MANDATE_GOVERNANCE,
  SIRIUS_MANDATE_DISCLAIMER,
};

