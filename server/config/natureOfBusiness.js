// ---------------------------------------------------------------------------
// Nature-of-business → investment theme configuration (REQ-THEME-01, E5).
//
// Themes are derived from the Sirius subsidiary register
// (src/data/siriusOrgTree.js), whose "principal_activities" field is the
// registered nature of business for each entity. Rather than hand-authoring one
// theme per subsidiary, this module maps that free-text registration onto the
// fixed sector set used by the pipeline, so every mandate-holding entity gets a
// defensible, data-derived theme (sector, keywords, geographies).
//
// The map is ordered: the first matching sector wins, so the most specific
// verticals (healthcare, financial services) are tested before the broad
// technology/services fallbacks. Order is configuration, not logic — reorder
// the array to change precedence.
// ---------------------------------------------------------------------------

// Sectors align with the pipeline enums used across the app (Gate 1 verticals,
// the MVP fixtures in config/mvpSeed.js, and the plan's Sector field).
export const SECTORS = [
  'Technology',
  'Financial Services',
  'Energy',
  'Healthcare',
  'Telecommunications',
  'Industrials',
  'Consumer Goods',
  'Real Estate',
  'Business Services',
  'Holding',
];

// Country → geography tags applied to a derived theme (REQ-RULE-01 scope).
export const GEOGRAPHY_TAGS = {
  'United Arab Emirates': ['UAE', 'GCC'],
  'Kingdom of Saudi Arabia': ['Saudi Arabia', 'GCC'],
  'State of Qatar': ['Qatar', 'GCC'],
  'Sultanate of Oman': ['Oman', 'GCC'],
  'Republic of India': ['India', 'South Asia'],
  'United Kingdom': ['UK', 'Europe'],
  'Republic of Kenya': ['Kenya', 'Africa'],
  'Republic of Zambia': ['Zambia', 'Africa'],
  'Republic of Uzbekistan': ['Uzbekistan', 'Central Asia'],
  'Republic of Azerbaijan': ['Azerbaijan', 'Caspian'],
  'United States of America': ['USA', 'North America'],
  'Republic of Romania': ['Romania', 'Europe'],
  'Kingdom of Bahrain': ['Bahrain', 'GCC'],
  'Republic of Egypt': ['Egypt', 'MENA'],
  'Arab Republic of Egypt': ['Egypt', 'MENA'],
  Gibraltar: ['Gibraltar', 'Europe'],
  Cyprus: ['Cyprus', 'Europe'],
  Greece: ['Greece', 'Europe'],
  Netherlands: ['Netherlands', 'Europe'],
  Indonesia: ['Indonesia', 'ASEAN'],
  'British Virgin Islands': ['BVI', 'Offshore'],
};

// Ordered sector matchers. "terms" are matched case-insensitively against the
// registered principal activities; "exclude" suppresses a match when the
// registration is dominated by a different vertical.
export const NATURE_OF_BUSINESS_MAP = [
  {
    sector: 'Healthcare',
    terms: [
      'dental', 'medical', 'pharmacy', 'pharmaceutical', 'home health', 'health care',
      'healthcare', 'health services', 'health insurance', 'hospital', 'clinic',
      'surgery', 'ambulance', 'medicinal', 'rehabilitation', 'medical spa',
    ],
  },
  {
    sector: 'Financial Services',
    terms: [
      'financial services', 'banking', 'payments', 'lending', 'fintech', 'custody',
      'investment fund', 'financing broker', 'debt collection', 'debts collection',
      'credit rating', 'claims settlement', 'trading facility', 'organised trading',
      'betting', 'insurance', 'collective investment', 'mortgage and commercial',
      'financing platform', 'financial advisors', 'overdues rescheduling',
    ],
  },
  {
    // Airport / rail / port infrastructure integrators, which the register
    // describes through the assets they supply and install rather than a
    // sector name. Kept ahead of Telecom so equipment trading lands here.
    sector: 'Industrials',
    terms: ['airport', 'airports', 'railways', 'road signs', 'ports equipment'],
  },
  {
    sector: 'Energy',
    terms: [
      'electricity', 'energy', 'solar', 'renewable', 'battery storage', 'ev charging',
      'electric vehicle', 'smart grid', 'smart utilities', 'metering infrastructure',
      'gaseous fuels', 'biofuel', 'windfarm', 'wind farm', 'power generating',
      'power infrastructure', 'water', 'utilities', 'sustainability solutions',
      'green mobility', 'recycling', 'recycled',
    ],
  },
  {
    sector: 'Telecommunications',
    terms: [
      'telecommunication', 'telecommunications', 'telecom', 'fibre optic',
      'fiber optic', 'communication systems', 'communication equipment',
      'radio equipment', 'sim trading',
    ],
  },
  {
    sector: 'Technology',
    terms: [
      'software', 'saas', 'paas', 'iaas', 'cloud', 'computer', 'data processing',
      'data hosting', 'information technology', 'it services', 'it consultancy',
      'artificial intelligence', ' ai ', 'ai and', 'robotics', 'cyber',
      'programming', 'digital', 'technology', 'platform', 'analytics', 'data center',
      'semiconductor', 'chips', 'internet content', 'smart technology',
    ],
  },
  {
    sector: 'Industrials',
    terms: [
      'engineering', 'manufacturing', 'construction', 'utility projects',
      'prefabricated', 'airport', 'airports', 'ports', 'railways', 'road signs',
      'facilities management', 'contracting', 'installation of', 'structural',
      'oil and gas', 'equipment', 'light trucks', 'pump stations', 'industrial',
    ],
  },
  {
    sector: 'Real Estate',
    terms: ['real estate', 'property management', 'residents’ property', 'residential property'],
    // The register describes holding SPVs as owning "real estate property and
    // intellectual property" alongside equity. Those are shells, not landlords,
    // so a holding-ownership registration must fall through to Holding.
    exclude: ['holding ownership', 'holding company', 'holding of equity'],
  },
  {
    sector: 'Business Services',
    terms: [
      'consultancy', 'management services', 'business support', 'marketing',
      'call centre', 'call centres', 'employment', 'labour supply', 'temporary employment',
      'cleaning', 'concierge', 'coupons', 'education', 'training', 'advisory',
      'management, operation', 'management consultancy',
    ],
  },
  {
    sector: 'Holding',
    terms: [
      'holding company', 'holding ownership', 'investment holding',
      'special purpose vehicle', 'activities of holding companies',
    ],
  },
];

// Terms too generic to surface as theme keywords once a sector is chosen.
const STOPWORDS = new Set([
  'and', 'of', 'the', 'for', 'other', 'related', 'activities', 'services',
  'service', 'including', 'management', 'company', 'companies', 'business',
  'solutions', 'solution', 'products', 'product', 'provision', 'providing',
  'development', 'operations', 'operation', 'projects', 'project',
]);

function haystack(activities) {
  return String(activities || '').toLowerCase();
}

// Classify a registered nature of business into a sector.
export function classifyNatureOfBusiness(activities) {
  const text = haystack(activities);
  const empty = !text.trim();
  for (const entry of NATURE_OF_BUSINESS_MAP) {
    if (entry.exclude && entry.exclude.some((t) => text.includes(t))) continue;
    const hits = entry.terms.filter((t) => text.includes(t));
    if (hits.length) return { sector: entry.sector, matched: hits };
  }
  return { sector: empty ? 'Holding' : 'Business Services', matched: [] };
}

// Pull the distinctive nouns out of the registration to use as theme keywords.
function keywordsFromActivities(activities, matched) {
  const words = String(activities || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const out = new Set(matched.map((m) => m.trim()).filter(Boolean));
  for (const w of words) {
    if (out.size >= 8) break;
    out.add(w);
  }
  return [...out].slice(0, 8);
}

// Build a theme object for a single organisation record.
export function deriveThemeForOrg(org) {
  if (!org || !org.id) return null;
  const { sector, matched } = classifyNatureOfBusiness(org.principal_activities);
  const geographies = GEOGRAPHY_TAGS[org.geography] || (org.geography ? [org.geography] : ['UAE', 'GCC']);
  return {
    org_id: org.id,
    sector,
    keywords: keywordsFromActivities(org.principal_activities, matched),
    geographies,
    opportunity_types: [],
    description: `${sector} mandate derived from the registered nature of business for ${org.name}.`,
    source: 'nature_of_business_map',
    status: 'approved',
  };
}

// Derive themes for every mandate-holding entity in the subtree: operating
// subsidiaries and intermediate holdings that carry a real registered activity.
// Pure shells (sector "Holding") are skipped so a wrap-up entity never imposes a
// placeholder mandate on its children. The root platform is never themed.
// Deeper entities inherit their nearest ancestor's theme and can be overridden
// per org in ThemeAdmin.
export function deriveThemesFromOrgs(orgs = [], { levels = [1, 2], types = ['subsidiary', 'holding'] } = {}) {
  const levelSet = new Set(levels);
  const typeSet = new Set(types);
  const themes = [];
  const seen = new Set();
  for (const org of orgs) {
    if (!org || org.level === 0) continue;
    if (!levelSet.has(org.level)) continue;
    if (!typeSet.has(org.type)) continue;
    const theme = deriveThemeForOrg(org);
    if (theme && theme.sector === 'Holding') continue;
    if (!theme || seen.has(theme.sector + '::' + theme.org_id)) continue;
    seen.add(theme.sector + '::' + theme.org_id);
    themes.push(theme);
  }
  return themes;
}

export default { NATURE_OF_BUSINESS_MAP, GEOGRAPHY_TAGS, SECTORS, classifyNatureOfBusiness, deriveThemeForOrg, deriveThemesFromOrgs };
