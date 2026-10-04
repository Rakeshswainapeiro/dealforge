// ---------------------------------------------------------------------------
// Portfolio register (W4-01 / BRD ENT-04, REQ-ENT-04).
//
// The single source of truth for the existing portfolio companies used by the
// advisory synergy (W3-11 / SCR-06) and conflict/concentration (W3-10 / SCR-07)
// checks. It is versioned configuration held in an AppSettings record
// (setting_key = 'portfolio_register_config'): the shipped register is the
// fifteen BRD-named companies with cluster, sector, geography and capability
// tags derived from the Sirius subsidiary register, and an administrator can
// load a template or edit records, each save minting the next revision.
//
// This module is pure: it derives nothing from the database and holds the
// validation, the resolution, the diff and the CSV template. The derived rows
// live in generatedPortfolioRegister.js.
// ---------------------------------------------------------------------------

import {
  PORTFOLIO_REGISTER_VERSION, PORTFOLIO_REGISTER_CONFIG_KEY, PORTFOLIO_REGISTER_DEFAULT_REVISION,
  PORTFOLIO_CLUSTERS, PORTFOLIO_CLUSTER_KEYS, PORTFOLIO_CAPABILITY_VOCABULARY, PORTFOLIO_STATUSES,
  PORTFOLIO_REGISTER_DISCLAIMER,
} from './portfolioRegisterData.js';
import { GENERATED_PORTFOLIO_COMPANIES } from './generatedPortfolioRegister.js';

export {
  PORTFOLIO_REGISTER_VERSION, PORTFOLIO_REGISTER_CONFIG_KEY, PORTFOLIO_REGISTER_DEFAULT_REVISION,
  PORTFOLIO_CLUSTERS, PORTFOLIO_CLUSTER_KEYS, PORTFOLIO_CAPABILITY_VOCABULARY, PORTFOLIO_STATUSES,
  PORTFOLIO_REGISTER_DISCLAIMER,
};

export const PORTFOLIO_REGISTER_VERSION_PREFIX = 'PR-01.';

export const PORTFOLIO_REGISTER_MESSAGES = {
  name_required: 'Every register record needs a name.',
  name_duplicate: 'Register record names must be unique.',
  cluster_invalid: 'cluster must be one of: ' + PORTFOLIO_CLUSTER_KEYS.join(', ') + '.',
  sector_required: 'Every register record needs a sector.',
  status_invalid: 'status must be one of: ' + PORTFOLIO_STATUSES.join(', ') + '.',
  companies_required: 'The register must carry at least one company.',
  not_object: 'The register payload must be an object with a companies array.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

// A stable, URL-safe id for a company name ('Esyasoft' -> 'pf-esyasoft').
export function portfolioCompanyId(name) {
  const slug = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'pf-' + (slug || 'company');
}

function toStrArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

// Turn one generated/loaded row into a full register record.
function toCompany(row = {}, { base = null } = {}) {
  const name = String(row.name || row.company || '').trim();
  const id = row.id || portfolioCompanyId(name);
  const existing = base?.companies?.find((c) => c.id === id);
  const geographies = toStrArray(row.geographies || row.geography);
  return {
    id,
    name,
    legal_name: blank(row.legal_name) ? null : String(row.legal_name).trim(),
    org_id: blank(row.org_id) ? null : String(row.org_id).trim(),
    cluster: blank(row.cluster) ? 'other' : String(row.cluster).trim(),
    sector: blank(row.sector) ? null : String(row.sector).trim(),
    geography: geographies[0] || (blank(row.geography) ? null : String(row.geography).trim()) || null,
    geographies: geographies.length ? geographies : (blank(row.geography) ? [] : [String(row.geography).trim()]),
    capabilities: toStrArray(row.capabilities),
    status: PORTFOLIO_STATUSES.includes(norm(row.status)) ? norm(row.status) : 'active',
    principal_activities: blank(row.principal_activities) ? null : String(row.principal_activities).trim(),
    note: blank(row.note) ? null : String(row.note).trim(),
    source: row.source || existing?.source || 'register',
    source_doc: blank(row.source_doc) ? (existing?.source_doc || null) : String(row.source_doc).trim(),
  };
}

// The shipped register: the BRD list with derived tags.
export function defaultPortfolioRegister() {
  return {
    version: PORTFOLIO_REGISTER_VERSION,
    revision: PORTFOLIO_REGISTER_DEFAULT_REVISION,
    clusters: PORTFOLIO_CLUSTERS,
    capability_vocabulary: PORTFOLIO_CAPABILITY_VOCABULARY,
    disclaimer: PORTFOLIO_REGISTER_DISCLAIMER,
    companies: GENERATED_PORTFOLIO_COMPANIES.map((r) => toCompany(r)),
  };
}

export function validatePortfolioRegister(input, { base = null } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || !Array.isArray(input.companies)) {
    return { ok: false, errors: [PORTFOLIO_REGISTER_MESSAGES.not_object], config: base || defaultPortfolioRegister() };
  }
  if (input.companies.length === 0) errors.push(PORTFOLIO_REGISTER_MESSAGES.companies_required);
  const seen = new Set();
  const companies = [];
  for (const row of input.companies) {
    const c = toCompany(row, { base });
    if (blank(c.name)) { errors.push(PORTFOLIO_REGISTER_MESSAGES.name_required); continue; }
    const key = norm(c.name);
    if (seen.has(key)) { errors.push(PORTFOLIO_REGISTER_MESSAGES.name_duplicate + ' (' + c.name + ')'); continue; }
    seen.add(key);
    if (!PORTFOLIO_CLUSTER_KEYS.includes(c.cluster)) errors.push(c.name + ': ' + PORTFOLIO_REGISTER_MESSAGES.cluster_invalid);
    if (blank(c.sector)) errors.push(c.name + ': ' + PORTFOLIO_REGISTER_MESSAGES.sector_required);
    if (!PORTFOLIO_STATUSES.includes(c.status)) errors.push(c.name + ': ' + PORTFOLIO_REGISTER_MESSAGES.status_invalid);
    companies.push(c);
  }
  const config = {
    version: base?.version || PORTFOLIO_REGISTER_VERSION,
    revision: base?.revision ?? PORTFOLIO_REGISTER_DEFAULT_REVISION,
    clusters: base?.clusters || PORTFOLIO_CLUSTERS,
    capability_vocabulary: base?.capability_vocabulary || PORTFOLIO_CAPABILITY_VOCABULARY,
    disclaimer: base?.disclaimer || PORTFOLIO_REGISTER_DISCLAIMER,
    companies,
  };
  return { ok: errors.length === 0, errors, config };
}

// Resolve a stored record, falling back to the shipped register when absent or
// invalid, so a consumer never depends on the row.
export function resolvePortfolioRegister(stored) {
  if (blank(stored)) return defaultPortfolioRegister();
  let parsed = stored;
  if (typeof stored === 'string') {
    try { parsed = JSON.parse(stored); } catch { return defaultPortfolioRegister(); }
  }
  // Carry the stored revision / version / vocabulary through validation so a
  // resolved register keeps the revision it was saved under.
  const res = validatePortfolioRegister(parsed, { base: parsed });
  return res.ok ? res.config : defaultPortfolioRegister();
}

// Name the field-level changes between two register revisions for the audit.
export function diffPortfolioRegister(base, next) {
  const changes = { added: [], removed: [], edited: [] };
  const baseMap = new Map((base?.companies || []).map((c) => [c.id, c]));
  const nextMap = new Map((next?.companies || []).map((c) => [c.id, c]));
  for (const [id, c] of nextMap) {
    if (!baseMap.has(id)) { changes.added.push(c.name); continue; }
    const before = baseMap.get(id);
    const fields = ['name', 'cluster', 'sector', 'geography', 'status'];
    const changed = fields.filter((f) => String(before[f] ?? '') !== String(c[f] ?? ''));
    if (JSON.stringify(before.capabilities || []) !== JSON.stringify(c.capabilities || [])) changed.push('capabilities');
    if (changed.length) changes.edited.push({ name: c.name, fields: changed });
  }
  for (const [id, c] of baseMap) if (!nextMap.has(id)) changes.removed.push(c.name);
  return changes;
}

// Validate and mint the next revision of the register. Throws a 400-shaped
// error with the error list when the payload is invalid.
export function buildPortfolioRegister(body, { actor = null, at = null, base = null } = {}) {
  const current = base || defaultPortfolioRegister();
  const res = validatePortfolioRegister(body, { base: current });
  if (!res.ok) {
    const e = new Error('Invalid portfolio register: ' + res.errors.join(' '));
    e.status = 400;
    e.errors = res.errors;
    throw e;
  }
  const revision = (current.revision || PORTFOLIO_REGISTER_DEFAULT_REVISION) + 1;
  return {
    ...res.config,
    revision,
    version: PORTFOLIO_REGISTER_VERSION_PREFIX + revision,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
}

// --- template load --------------------------------------------------------
// The register is loadable from a template (BRD ENT-04). A CSV header plus one
// row per company; comma-separated capabilities inside a quoted field.

export const PORTFOLIO_REGISTER_CSV_COLUMNS =
  ['name', 'legal_name', 'cluster', 'sector', 'geography', 'capabilities', 'status', 'note'];

export function portfolioRegisterTemplateCsv() {
  const header = PORTFOLIO_REGISTER_CSV_COLUMNS.join(',');
  const rows = GENERATED_PORTFOLIO_COMPANIES.map((c) => [
    c.name, c.legal_name || '', c.cluster, c.sector, (c.geographies || [])[0] || '',
    (c.capabilities || []).join('|'), c.status || 'active', c.note || '',
  ].map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v)).join(','));
  return [header, ...rows].join('\n');
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Parse a CSV register template into the payload validatePortfolioRegister
// accepts. Capability cells may be '|' or ';' separated.
export function parsePortfolioRegisterCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { companies: [] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const companies = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    companies.push({
      name: row.name,
      legal_name: row.legal_name || null,
      cluster: row.cluster || 'other',
      sector: row.sector || null,
      geographies: row.geography ? [row.geography] : [],
      capabilities: (row.capabilities || '').split(/[|;]/).map((s) => s.trim()).filter(Boolean),
      status: row.status || 'active',
      note: row.note || null,
      source: 'template_load',
    });
  }
  return { companies };
}

// --- equity analysis helpers (used by W3-10 conflict / W3-11 synergy) -----
// Sector-level adjacency: the register companies that share a sector with the
// target, most-specific first.
export function registerMatchesSector(companies = [], sector) {
  if (blank(sector)) return [];
  return companies.filter((c) => norm(c.sector) === norm(sector));
}

export function registerMatchesGeography(companies = [], geography) {
  if (blank(geography)) return [];
  const g = norm(geography);
  return companies.filter((c) => (c.geographies || []).some((x) => norm(x) === g) || norm(c.geography) === g);
}

export function registerCapabilityOverlap(companies = [], capabilities = []) {
  const want = new Set(capabilities.map(norm));
  if (want.size === 0) return [];
  return companies.filter((c) => (c.capabilities || []).some((k) => want.has(norm(k))));
}

export default {
  PORTFOLIO_REGISTER_VERSION, PORTFOLIO_REGISTER_CONFIG_KEY, PORTFOLIO_REGISTER_DEFAULT_REVISION,
  PORTFOLIO_REGISTER_VERSION_PREFIX, PORTFOLIO_CLUSTERS, PORTFOLIO_CLUSTER_KEYS,
  PORTFOLIO_CAPABILITY_VOCABULARY, PORTFOLIO_STATUSES, PORTFOLIO_REGISTER_DISCLAIMER,
  PORTFOLIO_REGISTER_MESSAGES, PORTFOLIO_REGISTER_CSV_COLUMNS,
  portfolioCompanyId, defaultPortfolioRegister, validatePortfolioRegister, resolvePortfolioRegister,
  diffPortfolioRegister, buildPortfolioRegister, portfolioRegisterTemplateCsv,
  parsePortfolioRegisterCsv, registerMatchesSector, registerMatchesGeography, registerCapabilityOverlap,
};
