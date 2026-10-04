// ---------------------------------------------------------------------------
// Pipeline dashboard filters - pure logic (W7-02 / BRD DSH-01).
//
// No database, no network. Owns the filter parsing, the card matching against
// the filter set (entity / cluster / sector / state / owner / date) and the
// drill-down grouping + near-real-time summary. The route supplies the board
// cards; this module decides which survive a filter and how they regroup.
// ---------------------------------------------------------------------------

import {
  PIPELINE_DASHBOARD_KEY, PIPELINE_DASHBOARD_VERSION, PIPELINE_DASHBOARD_VERSION_PREFIX,
  PIPELINE_DASHBOARD_DEFAULT_REVISION, FILTER_DIMENSIONS, FILTER_PARAMS, DATE_PRESETS,
  CLUSTER_BY_SECTOR, CLUSTER_LABELS, DRILLDOWN_DIMENSIONS, PIPELINE_DASHBOARD_MESSAGES,
} from './pipelineDashboardData.js';

export {
  PIPELINE_DASHBOARD_KEY, PIPELINE_DASHBOARD_VERSION, PIPELINE_DASHBOARD_VERSION_PREFIX,
  PIPELINE_DASHBOARD_DEFAULT_REVISION, FILTER_DIMENSIONS, FILTER_PARAMS, DATE_PRESETS,
  CLUSTER_BY_SECTOR, CLUSTER_LABELS, DRILLDOWN_DIMENSIONS, PIPELINE_DASHBOARD_MESSAGES,
};

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function defaultPipelineDashboardConfig() {
  return {
    version: PIPELINE_DASHBOARD_VERSION,
    revision: PIPELINE_DASHBOARD_DEFAULT_REVISION,
    source: 'default',
    dimensions: FILTER_PARAMS.slice(),
    default_drilldown: 'state',
    updated_by: null,
    updated_at: null,
  };
}

export function resolvePipelineDashboardConfig(raw, { base = defaultPipelineDashboardConfig() } = {}) {
  const cfg = coerce(raw);
  if (!isPlainObject(cfg)) return base;
  const dims = Array.isArray(cfg.dimensions)
    ? cfg.dimensions.map((d) => String(d)).filter((d) => FILTER_PARAMS.includes(d))
    : base.dimensions;
  return {
    version: base.version,
    revision: Number.isInteger(cfg.revision) ? cfg.revision : base.revision,
    source: cfg.source || base.source,
    dimensions: dims.length ? dims : base.dimensions,
    default_drilldown: DRILLDOWN_DIMENSIONS.includes(cfg.default_drilldown) ? cfg.default_drilldown : base.default_drilldown,
    updated_by: cfg.updated_by || base.updated_by,
    updated_at: cfg.updated_at || base.updated_at,
  };
}

export function validatePipelineDashboardConfig(config) {
  const cfg = coerce(config);
  const errors = [];
  if (!isPlainObject(cfg)) return { ok: false, errors: ['configuration must be an object'] };
  if (!Array.isArray(cfg.dimensions) || cfg.dimensions.length === 0) errors.push('dimensions must be a non-empty list');
  else for (const d of cfg.dimensions) if (!FILTER_PARAMS.includes(d)) errors.push('unknown dimension: ' + d);
  return { ok: errors.length === 0, errors };
}

export function diffPipelineDashboardConfig(before, after) {
  const changes = [];
  const b = resolvePipelineDashboardConfig(before);
  const a = resolvePipelineDashboardConfig(after);
  if (JSON.stringify(b.dimensions) !== JSON.stringify(a.dimensions)) changes.push({ field: 'dimensions', before: b.dimensions, after: a.dimensions });
  if (b.default_drilldown !== a.default_drilldown) changes.push({ field: 'default_drilldown', before: b.default_drilldown, after: a.default_drilldown });
  return changes;
}

export function buildPipelineDashboardConfig(patch, { actor, base } = {}) {
  const current = resolvePipelineDashboardConfig(base);
  const merged = resolvePipelineDashboardConfig({ ...current, ...patch }, { base: current });
  return {
    ...merged,
    revision: (current.revision || 0) + 1,
    source: 'admin',
    updated_by: actor?.email || null,
    updated_at: new Date().toISOString(),
  };
}

// Cluster for a card, from its sector.
function clusterOf(card) {
  const key = CLUSTER_BY_SECTOR[card.sector];
  return key ? { key, label: CLUSTER_LABELS[key] || key } : null;
}

// Normalise the raw query into a filter object. Values may arrive as a comma
// list, a repeated param, or a single string.
export function parseFilters(query = {}) {
  const pick = (v) => {
    if (v == null) return null;
    const raw = Array.isArray(v) ? v : String(v).split(',');
    const vals = raw.map((x) => String(x).trim()).filter(Boolean);
    return vals.length ? vals : null;
  };
  return {
    entity: pick(query.entity),
    cluster: pick(query.cluster),
    sector: pick(query.sector),
    state: pick(query.state),
    owner: pick(query.owner),
    date: query.date && query.date !== 'any' ? String(query.date) : null,
  };
}

function withinDate(card, preset, now) {
  if (!preset || preset === 'any') return true;
  const found = DATE_PRESETS.find((p) => p.key === preset);
  if (!found || found.days == null) return true;
  const at = card.updated_date ? new Date(card.updated_date).getTime() : null;
  if (at == null || Number.isNaN(at)) return false;
  return at >= now.getTime() - found.days * 86_400_000;
}

// Apply the filter set to a list of board cards.
export function filterCards(cards, filters = {}, { now = new Date() } = {}) {
  const f = filters;
  const has = (arr) => Array.isArray(arr) && arr.length > 0;
  return (cards || []).filter((c) => {
    if (!c) return false;
    if (has(f.entity) && !f.entity.includes(c.owner_org_id)) return false;
    if (has(f.cluster)) { const cl = clusterOf(c); if (!cl || !f.cluster.includes(cl.key)) return false; }
    if (has(f.sector) && !f.sector.includes(c.sector)) return false;
    if (has(f.state) && !f.state.includes(c.state)) return false;
    if (has(f.owner) && !f.owner.includes(c.owner_email)) return false;
    if (!withinDate(c, f.date, now)) return false;
    return true;
  });
}

// The available filter options present in the current cards (so the UI only
// offers values that exist).
export function filterOptions(cards, { subsidiaryNames = {} } = {}) {
  const entities = new Map();
  const clusters = new Map();
  const sectors = new Set();
  const states = new Map();
  const owners = new Set();
  for (const c of cards || []) {
    if (c.owner_org_id) entities.set(c.owner_org_id, subsidiaryNames[c.owner_org_id] || c.owner_org_name || c.owner_org_id);
    const cl = clusterOf(c);
    if (cl) clusters.set(cl.key, cl.label);
    if (c.sector) sectors.add(c.sector);
    if (c.state) states.set(c.state, c.state_label || c.state);
    if (c.owner_email) owners.add(c.owner_email);
  }
  return {
    entity: [...entities].map(([value, label]) => ({ value, label })),
    cluster: [...clusters].map(([value, label]) => ({ value, label })),
    sector: [...sectors].sort().map((s) => ({ value: s, label: s })),
    state: [...states].map(([value, label]) => ({ value, label })),
    owner: [...owners].sort().map((o) => ({ value: o, label: o })),
    date: DATE_PRESETS,
  };
}

function dimensionOf(card, dim, subsidiaryNames) {
  switch (dim) {
    case 'entity': return { value: card.owner_org_id, label: subsidiaryNames[card.owner_org_id] || card.owner_org_name || card.owner_org_id };
    case 'cluster': { const cl = clusterOf(card); return cl ? { value: cl.key, label: cl.label } : { value: 'other', label: 'Other' }; }
    case 'sector': return { value: card.sector || 'unspecified', label: card.sector || 'Unspecified' };
    case 'state': return { value: card.state || 'unknown', label: card.state_label || card.state || 'Unknown' };
    case 'owner': return { value: card.owner_email || 'unassigned', label: card.owner_email || 'Unassigned' };
    default: return { value: 'all', label: 'All' };
  }
}

// Drill down the (already filtered) cards by one dimension.
export function drillDown(cards, dimension = 'state', { subsidiaryNames = {} } = {}) {
  const dim = DRILLDOWN_DIMENSIONS.includes(dimension) ? dimension : 'state';
  const groups = new Map();
  for (const c of cards || []) {
    const { value, label } = dimensionOf(c, dim, subsidiaryNames);
    if (!groups.has(value)) groups.set(value, { key: value, label, count: 0, items: [] });
    const g = groups.get(value);
    g.count += 1;
    g.items.push({ id: c.id, opportunity_name: c.opportunity_name, state: c.state, state_label: c.state_label, owner_email: c.owner_email });
  }
  return { dimension: dim, groups: [...groups.values()].sort((a, b) => b.count - a.count) };
}

// The near-real-time summary for the filtered set.
export function summarizePipeline(cards) {
  const by_state = {};
  let breaches = 0;
  for (const c of cards || []) {
    by_state[c.state] = (by_state[c.state] || 0) + 1;
    if (c.sla_breached) breaches += 1;
  }
  return { total: (cards || []).length, breaches, by_state };
}

export function activeFilterCount(filters = {}) {
  let n = 0;
  for (const p of FILTER_PARAMS) {
    const v = filters[p];
    if (Array.isArray(v) ? v.length : v) n += 1;
  }
  return n;
}
