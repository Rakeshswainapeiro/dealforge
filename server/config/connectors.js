// ---------------------------------------------------------------------------
// Connector registry, maturity governance and tool launchpad rules
// (BRD v2 INTG-07, INTG-11, INTG-12, EXP-03, ACC-01, ACC-02, ACC-04). Pure.
//
// DealForge does not replace the specialist tools Sirius licenses; it connects
// to them. Each tool is a connector record that an administrator configures
// without a release: enabled or not, refresh cadence, how its fields map onto
// the evidence store, the maturity of each capability, and how to launch it
// with the opportunity in context. Shipped switched off: no data flows until an
// administrator enables a connector and its API access is provisioned.
// ---------------------------------------------------------------------------

export const CONNECTORS_CONFIG_KEY = 'connectors_config';
export const CONNECTORS_VERSION_PREFIX = 'CON-01';

// INTG-12: L0 reference ... L4 agentic. L3 and above never write to the record
// without a person confirming, and always carry provenance.
export const MATURITY_LEVELS = Object.freeze([
  { key: 'L0', label: 'L0 Reference', description: 'Link out only; nothing comes back.' },
  { key: 'L1', label: 'L1 Assisted', description: 'A person copies a value back with its source.' },
  { key: 'L2', label: 'L2 Integrated', description: 'Values are pulled by API or file and tagged with provenance.' },
  { key: 'L3', label: 'L3 Automated', description: 'The tool proposes values; a person confirms before they count.' },
  { key: 'L4', label: 'L4 Agentic', description: 'The tool acts on its own; every result needs human confirmation.' },
]);
export const MATURITY_KEYS = MATURITY_LEVELS.map((m) => m.key);
export const CONFIRMATION_FROM = 'L3';

export const CATEGORIES = Object.freeze([
  { key: 'screening', label: 'Target screening' },
  { key: 'market_intelligence', label: 'Market intelligence' },
  { key: 'diligence', label: 'Due diligence' },
  { key: 'crm', label: 'Pipeline & CRM' },
]);
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const CADENCES = Object.freeze(['manual', 'daily', 'weekly', 'monthly']);
export const METHODS = Object.freeze(['manual', 'api', 'file', 'ai']);

// The evidence fields an external value may land on (INTG-07). A field map can
// only target these, so a connector can never overwrite the subsidiary's figures.
export const EVIDENCE_FIELDS = Object.freeze([
  { key: 'revenue_aed_mn', label: 'Revenue (AED mn)', type: 'number' },
  { key: 'ebitda_aed_mn', label: 'EBITDA (AED mn)', type: 'number' },
  { key: 'employees', label: 'Employees', type: 'number' },
  { key: 'founded_year', label: 'Founded', type: 'number' },
  { key: 'ownership', label: 'Ownership', type: 'text' },
  { key: 'headquarters', label: 'Headquarters', type: 'text' },
  { key: 'valuation_aed_mn', label: 'Valuation (AED mn)', type: 'number' },
  { key: 'comparable_multiple', label: 'Comparable EV/EBITDA', type: 'number' },
  { key: 'funding_raised_aed_mn', label: 'Funding raised (AED mn)', type: 'number' },
  { key: 'adverse_media', label: 'Adverse media', type: 'text' },
  { key: 'sanctions_hit', label: 'Sanctions / PEP hit', type: 'text' },
  { key: 'contract_red_flags', label: 'Contract red flags', type: 'text' },
  { key: 'market_size_aed_mn', label: 'Market size (AED mn)', type: 'number' },
  { key: 'relationship_path', label: 'Relationship path', type: 'text' },
  { key: 'note', label: 'Research note', type: 'text' },
]);
const FIELD_KEYS = EVIDENCE_FIELDS.map((f) => f.key);

const cap = (key, label, maturity) => ({ key, label, maturity });
const tool = (key, label, category, launchUrl, capabilities, extra = {}) => ({
  key, label, vendor: label, category, enabled: false, refresh_cadence: 'manual',
  launch_url: launchUrl, deep_link_template: null, sso_app_id: null, field_map: [], capabilities, ...extra,
});

// The tool stack recommended to Sirius (four stages, fifteen tools).
export function defaultConnectors() {
  return [
    tool('grata', 'Grata', 'screening', 'https://search.grata.com', [cap('company_search', 'Private company search', 'L1'), cap('comps', 'Comparables', 'L1')],
      { deep_link_template: 'https://search.grata.com/search?query={target_name}',
        field_map: [{ source: 'employee_count', target: 'employees' }, { source: 'year_founded', target: 'founded_year' }, { source: 'ownership_type', target: 'ownership' }, { source: 'hq_location', target: 'headquarters' }] }),
    tool('pitchbook', 'PitchBook', 'screening', 'https://my.pitchbook.com', [cap('deal_comps', 'Deal comps', 'L1'), cap('investor_data', 'Investor data', 'L1')],
      { field_map: [{ source: 'last_valuation', target: 'valuation_aed_mn' }, { source: 'total_raised', target: 'funding_raised_aed_mn' }, { source: 'ev_ebitda', target: 'comparable_multiple' }] }),
    tool('sourceco', 'SourceCo', 'screening', 'https://app.sourceco.com', [cap('off_market', 'Off-market origination', 'L0')]),
    tool('cb_insights', 'CB Insights', 'screening', 'https://app.cbinsights.com', [cap('mosaic', 'Mosaic score', 'L1')]),
    tool('perplexity', 'Perplexity Pro', 'market_intelligence', 'https://www.perplexity.ai', [cap('deep_research', 'Deep research', 'L3')],
      { deep_link_template: 'https://www.perplexity.ai/search?q={target_name}%20{sector}%20GCC' }),
    tool('claude', 'Claude', 'market_intelligence', 'https://claude.ai', [cap('synthesis', 'Research synthesis', 'L3')]),
    tool('bloomberg_sparks', 'Bloomberg Sparks', 'market_intelligence', 'https://www.bloomberg.com/professional', [cap('signals', 'Ownership & distress signals', 'L2')],
      { field_map: [{ source: 'adverse_news', target: 'adverse_media' }] }),
    tool('zoominfo', 'ZoomInfo', 'market_intelligence', 'https://app.zoominfo.com', [cap('firmographics', 'Firmographics', 'L2')],
      { field_map: [{ source: 'revenue', target: 'revenue_aed_mn' }, { source: 'employees', target: 'employees' }] }),
    tool('kira', 'Kira Systems', 'diligence', 'https://app.kirasystems.com', [cap('clause_extraction', 'Clause extraction', 'L3')],
      { field_map: [{ source: 'red_flags', target: 'contract_red_flags' }] }),
    tool('datasite', 'Datasite', 'diligence', 'https://app.datasite.com', [cap('vdr', 'Virtual data room', 'L0'), cap('doc_classification', 'Document classification', 'L3')]),
    tool('harvey', 'Harvey AI', 'diligence', 'https://app.harvey.ai', [cap('legal_review', 'Legal review', 'L4')]),
    tool('dili', 'Dili', 'diligence', 'https://app.dili.ai', [cap('financial_normalisation', 'Financial normalisation', 'L3')],
      { field_map: [{ source: 'normalised_ebitda', target: 'ebitda_aed_mn' }] }),
    tool('dealcloud', 'DealCloud', 'crm', 'https://app.dealcloud.com', [cap('pipeline_sync', 'Pipeline sync', 'L2')]),
    tool('affinity', 'Affinity', 'crm', 'https://app.affinity.co', [cap('relationship_graph', 'Relationship graph', 'L1')],
      { field_map: [{ source: 'warm_intro_path', target: 'relationship_path' }] }),
    tool('clay', 'Clay', 'crm', 'https://app.clay.com', [cap('enrichment', 'Data enrichment', 'L3')]),
  ];
}

export function defaultConnectorsConfig() {
  return { version: CONNECTORS_VERSION_PREFIX + '.1', revision: 1, sso_launch_template: null, connectors: defaultConnectors() };
}

const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);

function normalizeConnector(c, i) {
  const r = c && typeof c === 'object' ? c : {};
  return {
    key: String(r.key || 'tool_' + (i + 1)).trim(),
    label: String(r.label || r.key || 'Tool ' + (i + 1)).trim(),
    vendor: str(r.vendor) || String(r.label || ''),
    category: CATEGORY_KEYS.includes(r.category) ? r.category : 'screening',
    enabled: r.enabled === true,
    refresh_cadence: CADENCES.includes(r.refresh_cadence) ? r.refresh_cadence : 'manual',
    launch_url: str(r.launch_url),
    deep_link_template: str(r.deep_link_template),
    sso_app_id: str(r.sso_app_id),
    field_map: (Array.isArray(r.field_map) ? r.field_map : [])
      .map((m) => ({ source: String(m?.source || '').trim(), target: String(m?.target || '').trim() }))
      .filter((m) => m.source && m.target),
    capabilities: (Array.isArray(r.capabilities) ? r.capabilities : []).map((x, j) => ({
      key: String(x?.key || 'cap_' + (j + 1)).trim(),
      label: String(x?.label || x?.key || 'Capability').trim(),
      maturity: MATURITY_KEYS.includes(x?.maturity) ? x.maturity : 'L0',
    })),
  };
}

export function resolveConnectorsConfig(raw) {
  let cfg = raw;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
  const base = defaultConnectorsConfig();
  if (!cfg || typeof cfg !== 'object') return base;
  const revision = Number.isInteger(cfg.revision) && cfg.revision > 0 ? cfg.revision : 1;
  return {
    version: CONNECTORS_VERSION_PREFIX + '.' + revision,
    revision,
    sso_launch_template: str(cfg.sso_launch_template),
    connectors: (Array.isArray(cfg.connectors) ? cfg.connectors : base.connectors).map(normalizeConnector),
    updated_by: cfg.updated_by || null,
    updated_at: cfg.updated_at || null,
  };
}

const httpsOnly = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

export function validateConnectorsConfig(raw) {
  const cfg = resolveConnectorsConfig(raw);
  const errors = [];
  const keys = new Set();
  for (const c of cfg.connectors) {
    if (!/^[a-z0-9_]{2,40}$/.test(c.key)) errors.push(c.key + ': key must be 2-40 lower-case letters, digits or _');
    if (keys.has(c.key)) errors.push(c.key + ': duplicate key');
    keys.add(c.key);
    if (c.launch_url && !httpsOnly(c.launch_url)) errors.push(c.key + ': launch URL must be https');
    if (c.deep_link_template && !httpsOnly(c.deep_link_template.replace(/\{[a-z_]+\}/g, 'x'))) errors.push(c.key + ': deep link must be https');
    for (const m of c.field_map) if (!FIELD_KEYS.includes(m.target)) errors.push(c.key + ': unknown evidence field "' + m.target + '"');
  }
  if (cfg.sso_launch_template && !httpsOnly(cfg.sso_launch_template.replace(/\{[a-z_]+\}/g, 'x'))) errors.push('SSO launch template must be https');
  return { ok: errors.length === 0, errors };
}

export function buildConnectorsConfig(input, { actor, base } = {}) {
  const prior = resolveConnectorsConfig(base);
  const next = resolveConnectorsConfig({ ...prior, ...(input || {}), revision: prior.revision + 1 });
  const { ok, errors } = validateConnectorsConfig(next);
  if (!ok) { const e = new Error('Invalid connector configuration: ' + errors.join('; ')); e.status = 400; e.data = { errors }; throw e; }
  return { ...next, updated_by: actor?.email || null, updated_at: new Date().toISOString() };
}

export function diffConnectorsConfig(before, after) {
  const a = resolveConnectorsConfig(before);
  const b = resolveConnectorsConfig(after);
  const changes = [];
  for (const c of b.connectors) {
    const old = a.connectors.find((x) => x.key === c.key);
    if (!old) { changes.push({ connector: c.key, change: 'added' }); continue; }
    for (const f of ['enabled', 'refresh_cadence', 'launch_url', 'deep_link_template', 'sso_app_id']) {
      if (old[f] !== c[f]) changes.push({ connector: c.key, field: f, before: old[f], after: c[f] });
    }
    if (JSON.stringify(old.field_map) !== JSON.stringify(c.field_map)) changes.push({ connector: c.key, field: 'field_map' });
    if (JSON.stringify(old.capabilities) !== JSON.stringify(c.capabilities)) changes.push({ connector: c.key, field: 'capabilities' });
  }
  for (const c of a.connectors) if (!b.connectors.some((x) => x.key === c.key)) changes.push({ connector: c.key, change: 'removed' });
  return changes;
}

/** The highest maturity a connector has (drives the confirmation rule). */
export function connectorMaturity(connector) {
  const levels = (connector?.capabilities || []).map((c) => MATURITY_KEYS.indexOf(c.maturity));
  return MATURITY_KEYS[Math.max(0, ...levels)] || 'L0';
}

/** INTG-12: does a value from this source/method need a person to confirm it? */
export function needsConfirmation({ maturity = 'L0', method = 'manual' } = {}) {
  return method === 'ai' || MATURITY_KEYS.indexOf(maturity) >= MATURITY_KEYS.indexOf(CONFIRMATION_FROM);
}

/**
 * Normalise a payload from a tool into evidence items through its field map
 * (INTG-11). Unmapped source fields are reported, never stored.
 */
export function mapPayload(connector, payload = {}) {
  const items = [];
  const unmapped = [];
  for (const [source, value] of Object.entries(payload || {})) {
    const m = (connector?.field_map || []).find((x) => x.source === source);
    if (!m) { unmapped.push(source); continue; }
    if (value === undefined || value === null || value === '') continue;
    items.push({ field: m.target, value, source_field: source });
  }
  return { items, unmapped };
}

/** Validate one evidence value (INTG-07): field, value type, method, confidence. */
export function validateEvidence(input = {}) {
  const errors = [];
  const field = EVIDENCE_FIELDS.find((f) => f.key === input.field);
  if (!field) errors.push('Unknown evidence field: ' + (input.field || '(none)'));
  if (input.value === undefined || input.value === null || String(input.value).trim() === '') errors.push('A value is required');
  else if (field?.type === 'number' && !Number.isFinite(Number(input.value))) errors.push(field.label + ' must be a number');
  if (!str(input.source)) errors.push('A source is required');
  if (input.method && !METHODS.includes(input.method)) errors.push('Unknown method: ' + input.method);
  if (input.confidence !== undefined && input.confidence !== null && input.confidence !== '') {
    const c = Number(input.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) errors.push('Confidence must be between 0 and 1');
  }
  if (input.retrieved_at && Number.isNaN(new Date(input.retrieved_at).getTime())) errors.push('retrieved_at is not a date');
  return { ok: errors.length === 0, errors, field };
}

/**
 * The launch URL for a tool, with the opportunity in context (EXP-03). When an
 * identity-provider launch template and the tool's SSO app id are configured,
 * the user goes through single sign-on (ACC-01); otherwise straight to the
 * tool, which applies its own sign-in and entitlements (ACC-04).
 */
export function launchUrlFor(connector, { opportunity = null, ssoTemplate = null } = {}) {
  const ctx = {
    target_name: opportunity?.target_name || opportunity?.opportunity_name || '',
    sector: opportunity?.sector || '',
    geography: opportunity?.geography || '',
  };
  const fill = (tpl) => tpl.replace(/\{([a-z_]+)\}/g, (_, k) => encodeURIComponent(ctx[k] || ''));
  const direct = opportunity && connector.deep_link_template ? fill(connector.deep_link_template) : connector.launch_url;
  if (!direct) return null;
  if (ssoTemplate && connector.sso_app_id) {
    return ssoTemplate.replace('{app_id}', encodeURIComponent(connector.sso_app_id)).replace('{redirect}', encodeURIComponent(direct));
  }
  return direct;
}

// ACC-02: a seat unused for this long is dormant.
export const DORMANT_AFTER_DAYS = 90;
export function seatStatus(entitlement, now = new Date()) {
  if (!entitlement || entitlement.revoked_at) return 'revoked';
  const last = entitlement.last_launched_at || entitlement.granted_at;
  if (!last) return 'active';
  return (now.getTime() - new Date(last).getTime()) / 86400000 > DORMANT_AFTER_DAYS ? 'dormant' : 'active';
}

export default {
  CONNECTORS_CONFIG_KEY, MATURITY_LEVELS, CATEGORIES, EVIDENCE_FIELDS, defaultConnectorsConfig, resolveConnectorsConfig,
  validateConnectorsConfig, buildConnectorsConfig, diffConnectorsConfig, connectorMaturity, needsConfirmation, mapPayload,
  validateEvidence, launchUrlFor, seatStatus,
};
