// ---------------------------------------------------------------------------
// Portfolio conflict / concentration and synergy analysis
// (W3-10 / BRD SCR-07, W3-11 / BRD SCR-06).
//
// Source of truth: the Phase-1 BRD, "Automated initial screening". The screen
// must, against the portfolio register:
//
//   * identify synergies with existing portfolio companies (SCR-06) - the top
//     matches listed with the company and a rationale, each marked "requires
//     operating-company sign-off"; and
//   * flag portfolio conflict and show single-deal / sector concentration where
//     data exists (SCR-07) - a conflict flag naming the affected portfolio
//     company, and the post-deal concentration percentage against the ceiling.
//
// Both read the versioned portfolio register (W4-01 / ENT-04) - the cluster,
// sector, geography and capability tags - so the analysis never re-derives what
// the register already records. The analysis is advisory (SCR-09): it surfaces
// matches and a concentration figure for the reviewer; it never rejects a deal.
//
// Pure functions only - the register and the thresholds are passed in.
// ---------------------------------------------------------------------------

export const PORTFOLIO_ANALYSIS_VERSION = 'PA-01.1';

// The single-sector concentration ceiling (SCR-07). The post-deal share of the
// portfolio in the target's sector is measured against it; where the register
// carries capital figures the share is by capital, otherwise by company count.
export const CONCENTRATION_MAX_SECTOR_PCT = 35;

// The maximum number of synergies surfaced (SCR-06 "top synergies").
export const SYNERGY_MAX_RESULTS = 5;

// A synergy is only a claim until the operating company that would deliver it
// signs off (SCR-06). Every synergy row carries this marker verbatim.
export const SYNERGY_SIGNOFF_MARKER = 'requires operating-company sign-off';

export const SYNERGY_KINDS = [
  { key: 'same_sector', label: 'Same sector', weight: 3 },
  { key: 'shared_geography', label: 'Shared geography', weight: 2 },
  { key: 'shared_capability', label: 'Shared capability', weight: 2 },
  { key: 'related_party', label: 'Related party', weight: 1 },
];

// The conflict signals the analysis can raise, most severe first.
export const CONFLICT_KINDS = [
  { key: 'name_overlap', label: 'Named target already in the portfolio', severity: 'high' },
  { key: 'sector_geography_overlap', label: 'Direct sector + geography overlap', severity: 'high' },
  { key: 'capability_overlap', label: 'Overlapping capability', severity: 'medium' },
  { key: 'related_party', label: 'Declared related party', severity: 'medium' },
];

// Thresholds passed in from configuration; the defaults here are the shipped
// values so a caller gets a defensible analysis without a config record.
export const PORTFOLIO_ANALYSIS_DEFAULTS = {
  concentration_max_sector_pct: CONCENTRATION_MAX_SECTOR_PCT,
  synergy_max_results: SYNERGY_MAX_RESULTS,
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const num = (v) => (v === '' || v === undefined || v === null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

function toArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

// Is this a cross-border / cross-sector target? The analysis only cares about
// the target's own sector and geography tags.
function target(data = {}) {
  return {
    name: blank(data.target_name) ? null : String(data.target_name).trim(),
    sector: blank(data.sector) ? null : String(data.sector).trim(),
    geography: blank(data.geography) ? null : String(data.geography).trim(),
    capabilities: toArray(data.capabilities),
    related_party: blank(data.related_party) ? null : String(data.related_party).trim(),
  };
}

function registerGeography(c) {
  const gs = (c.geographies || []).map((g) => norm(g));
  if (c.geography) gs.push(norm(c.geography));
  return gs.filter(Boolean);
}

// --- synergy (SCR-06) -----------------------------------------------------

// Score one register company against the target and return the synergy, or
// null when there is no overlap to claim.
function synergyFor(c, t) {
  const kinds = [];
  const reasons = [];
  if (t.sector && norm(c.sector) === norm(t.sector)) {
    kinds.push('same_sector');
    reasons.push('operates in the same sector (' + c.sector + ')');
  }
  const gs = registerGeography(c);
  if (t.geography && gs.includes(norm(t.geography))) {
    kinds.push('shared_geography');
    reasons.push('shares the ' + t.geography + ' geography');
  }
  const overlap = (t.capabilities || []).filter((k) => (c.capabilities || []).some((x) => norm(x) === norm(k)));
  if (overlap.length) {
    kinds.push('shared_capability');
    reasons.push('overlapping capability: ' + overlap.join(', '));
  }
  if (t.related_party && norm(c.name) === norm(t.related_party)) {
    kinds.push('related_party');
    reasons.push('declared related party ' + t.related_party);
  }
  if (kinds.length === 0) return null;
  const weight = kinds.reduce((s, k) => s + (SYNERGY_KINDS.find((x) => x.key === k)?.weight || 0), 0);
  const strength = weight >= 5 ? 'high' : (weight >= 3 ? 'medium' : 'low');
  return {
    company_id: c.id,
    company: c.name,
    cluster: c.cluster,
    sector: c.sector,
    geography: c.geography,
    kinds,
    capability_overlap: overlap,
    weight,
    strength,
    rationale: c.name + ' ' + reasons.join('; ') + '.',
    signoff: SYNERGY_SIGNOFF_MARKER,
    requires_operating_company_signoff: true,
  };
}

// The top synergies against the register, strongest first (SCR-06). Each entry
// names the company, gives a rationale and is marked as requiring the operating
// company's sign-off; the list is capped at the configured count.
export function evaluatePortfolioSynergy(data = {}, { portfolio = null, thresholds = null } = {}) {
  const cfg = { ...PORTFOLIO_ANALYSIS_DEFAULTS, ...(thresholds || {}) };
  const holdings = Array.isArray(portfolio) ? portfolio : [];
  const t = target(data);
  const rows = [];
  for (const c of holdings) {
    const s = synergyFor(c, t);
    if (s) rows.push(s);
  }
  rows.sort((a, b) => b.weight - a.weight || String(a.company).localeCompare(String(b.company)));
  const top = rows.slice(0, cfg.synergy_max_results);
  return {
    version: PORTFOLIO_ANALYSIS_VERSION,
    portfolio_size: holdings.length,
    target: { name: t.name, sector: t.sector, geography: t.geography, capabilities: t.capabilities },
    synergies: top,
    synergy_count: top.length,
    total_matches: rows.length,
    signoff_marker: SYNERGY_SIGNOFF_MARKER,
    message: top.length
      ? top.length + ' portfolio synergy match(es) identified; every claim ' + SYNERGY_SIGNOFF_MARKER + '.'
      : "No portfolio company shares the target's sector, geography or capabilities.",
  };
}

// --- conflict & concentration (SCR-07) -----------------------------------

// A direct conflict is a named-target match, a same-sector-and-geography
// overlap, an overlapping capability or a declared related party. Each flag
// names the affected portfolio company.
function conflictFor(c, t) {
  const kinds = [];
  const reasons = [];
  if (t.name && norm(c.name) === norm(t.name)) {
    kinds.push('name_overlap');
    reasons.push('the target name matches portfolio company ' + c.name);
  }
  const gs = registerGeography(c);
  if (t.sector && norm(c.sector) === norm(t.sector) && t.geography && gs.includes(norm(t.geography))) {
    kinds.push('sector_geography_overlap');
    reasons.push('both operate in ' + c.sector + ' in ' + (c.geography || t.geography));
  }
  const overlap = (t.capabilities || []).filter((k) => (c.capabilities || []).some((x) => norm(x) === norm(k)));
  if (overlap.length) {
    kinds.push('capability_overlap');
    reasons.push('overlapping capability: ' + overlap.join(', '));
  }
  if (t.related_party && norm(c.name) === norm(t.related_party)) {
    kinds.push('related_party');
    reasons.push('declared related party ' + t.related_party);
  }
  if (kinds.length === 0) return null;
  const severity = kinds.some((k) => (CONFLICT_KINDS.find((x) => x.key === k)?.severity === 'high')) ? 'high' : 'medium';
  return {
    company_id: c.id,
    company: c.name,
    cluster: c.cluster,
    sector: c.sector,
    geography: c.geography,
    kinds,
    capability_overlap: overlap,
    severity,
    reason: reasons.join('; ') + '.',
    // Only a target that IS a portfolio company (name overlap) is an
    // un-mitigable conflict; a same-sector-and-geography overlap is a material
    // flag the reviewer weighs, not an automatic conflict (a strategic investor
    // often buys in its own sectors on purpose).
    unmitigable: kinds.includes('name_overlap'),
  };
}

// Post-deal concentration in the target's sector: the matching register
// companies plus the deal itself over the whole portfolio. Measured by capital
// when the register carries figures, otherwise by company count so the figure
// is always available (SCR-07 "concentration % where data exists").
export function evaluatePortfolioConcentration(data = {}, { portfolio = null, thresholds = null } = {}) {
  const cfg = { ...PORTFOLIO_ANALYSIS_DEFAULTS, ...(thresholds || {}) };
  const holdings = Array.isArray(portfolio) ? portfolio : [];
  const t = target(data);
  const ceiling = cfg.concentration_max_sector_pct;

  if (!t.sector) {
    return {
      sector: null, basis: null, max_pct: ceiling, share_pct: null, post_deal_pct: null,
      breach: false, message: 'The target sector is not captured, so concentration cannot be measured.',
    };
  }

  const matchCount = holdings.filter((c) => norm(c.sector) === norm(t.sector)).length;

  const capitalOf = (c) => num(c.capital_aed);
  const withCapital = holdings.filter((c) => capitalOf(c) !== null);
  const dealCapital = num(data.total_commitment_aed) ?? num(data.ask_aed);
  const byCapital = withCapital.length > 0 && dealCapital !== null;

  let basis; let total; let inSector; let share;
  if (byCapital) {
    basis = 'capital';
    total = withCapital.reduce((s, c) => s + capitalOf(c), 0) + dealCapital;
    inSector = withCapital.filter((c) => norm(c.sector) === norm(t.sector)).reduce((s, c) => s + capitalOf(c), 0) + dealCapital;
  } else {
    basis = 'count';
    total = holdings.length + 1;
    inSector = matchCount + 1;
  }
  share = total > 0 ? Math.round((inSector / total) * 1000) / 10 : null;
  const breach = share !== null && share > ceiling;

  return {
    sector: t.sector,
    basis,
    max_pct: ceiling,
    portfolio_size: holdings.length,
    sector_holdings: matchCount,
    share_pct: share,
    post_deal_pct: share,
    breach,
    message: breach
      ? 'Post-deal ' + t.sector + ' concentration ' + share + '% exceeds the ' + ceiling + '% ceiling.'
      : 'Post-deal ' + t.sector + ' concentration ' + share + '% is within the ' + ceiling + '% ceiling.',
  };
}

// The whole SCR-07 picture: the concentration figure plus the conflict flags,
// each naming the affected company, and an advisory headline. Never blocks.
export function evaluatePortfolioConflict(data = {}, { portfolio = null, thresholds = null } = {}) {
  const holdings = Array.isArray(portfolio) ? portfolio : [];
  const t = target(data);
  const flags = [];
  for (const c of holdings) {
    const f = conflictFor(c, t);
    if (f) flags.push(f);
  }
  flags.sort((a, b) => (a.severity === b.severity ? 0 : (a.severity === 'high' ? -1 : 1)));

  const concentration = evaluatePortfolioConcentration(data, { portfolio, thresholds });
  const highFlags = flags.filter((f) => f.severity === 'high');
  const unmitigable = flags.filter((f) => f.unmitigable);

  const concPart = concentration.post_deal_pct !== null
    ? 'post-deal ' + (t.sector || 'sector') + ' concentration ' + concentration.post_deal_pct + '% (ceiling ' + concentration.max_pct + '%)'
    : null;
  let message;
  if (flags.length) {
    const bits = [flags.length + ' portfolio overlap(s)', concPart].filter(Boolean).join('; ');
    message = 'Portfolio overlap detected: ' + bits + '. Advisory - the reviewer confirms whether any overlap is un-mitigable.';
  } else if (concPart) {
    message = 'No overlap between the target and the portfolio register was detected. ' + concPart.charAt(0).toUpperCase() + concPart.slice(1) + '.';
  } else {
    message = 'No overlap between the target and the portfolio register was detected.';
  }

  return {
    version: PORTFOLIO_ANALYSIS_VERSION,
    target: { name: t.name, sector: t.sector, geography: t.geography },
    portfolio_size: holdings.length,
    flags,
    flag_count: flags.length,
    high_severity_count: highFlags.length,
    unmitigable_count: unmitigable.length,
    concentration,
    message,
  };
}

export default {
  PORTFOLIO_ANALYSIS_VERSION, CONCENTRATION_MAX_SECTOR_PCT, SYNERGY_MAX_RESULTS,
  SYNERGY_SIGNOFF_MARKER, SYNERGY_KINDS, CONFLICT_KINDS, PORTFOLIO_ANALYSIS_DEFAULTS,
  evaluatePortfolioSynergy, evaluatePortfolioConcentration, evaluatePortfolioConflict,
};
