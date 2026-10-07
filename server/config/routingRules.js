// ---------------------------------------------------------------------------
// Owner assignment and reviewer routing (BRD v2 WF-02, WF-03). Pure: no
// database, no Express.
//
// When an opportunity reaches Screening Review it gets a named Sirius
// Investment Team owner and a reviewer list, chosen by the first rule whose
// conditions match the deal (entity, sector, ticket size, flags). A rule names
// either a person (owner_email) or a role (owner_role); for a role the loader
// picks the active holder with the fewest open opportunities. The rules are an
// AppSettings record (setting_key = 'routing_rules') edited by an administrator
// without a release; the shipped default is role-based so it works with any
// set of named users.
// ---------------------------------------------------------------------------

export const ROUTING_CONFIG_KEY = 'routing_rules';
export const ROUTING_VERSION_PREFIX = 'RTR-01';
export const ROUTING_DEFAULT_REVISION = 1;

// Flags a rule can route on, derived from the record.
export const ROUTING_FLAGS = Object.freeze([
  { key: 'related_party', label: 'Related-party flag' },
  { key: 'below_floor', label: 'Below-floor exception' },
  { key: 'compressed_timeline', label: 'Banker-led / compressed timeline' },
  { key: 'cross_border', label: 'Cross-border' },
]);
const FLAG_KEYS = ROUTING_FLAGS.map((f) => f.key);

// Roles a rule may name as owner or reviewers: the Sirius investment team and
// the independent reviewer (never a subsidiary role).
export const ROUTABLE_ROLES = Object.freeze([
  'sirius_deal_lead', 'sirius_vertical_head', 'cio', 'leadership', 'cluster_head', 'independent_reviewer',
]);

export function defaultRoutingConfig() {
  return {
    version: ROUTING_VERSION_PREFIX + '.' + ROUTING_DEFAULT_REVISION,
    revision: ROUTING_DEFAULT_REVISION,
    fallback_owner_role: 'sirius_deal_lead',
    rules: [
      {
        key: 'related_party', label: 'Related-party deals',
        when: { flags: ['related_party'] },
        owner_role: 'sirius_deal_lead', reviewer_roles: ['independent_reviewer', 'sirius_vertical_head'],
      },
      {
        key: 'committee', label: 'Committee-scale tickets (AED 250mn and above)',
        when: { min_aed: 250 },
        owner_role: 'sirius_vertical_head', reviewer_roles: ['cio'],
      },
      {
        key: 'standard', label: 'Everything else',
        when: {},
        owner_role: 'sirius_deal_lead', reviewer_roles: ['sirius_vertical_head'],
      },
    ],
  };
}

const lower = (v) => String(v || '').trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function normalizeRule(rule, i) {
  const r = rule && typeof rule === 'object' ? rule : {};
  const when = r.when && typeof r.when === 'object' ? r.when : {};
  return {
    key: String(r.key || 'rule_' + (i + 1)).trim(),
    label: String(r.label || r.key || 'Rule ' + (i + 1)).trim(),
    when: {
      org_ids: list(when.org_ids),
      sectors: list(when.sectors).map(lower),
      min_aed: num(when.min_aed),
      max_aed: num(when.max_aed),
      flags: list(when.flags).map(lower),
    },
    owner_email: r.owner_email ? lower(r.owner_email) : null,
    owner_role: r.owner_role ? String(r.owner_role).trim() : null,
    reviewer_emails: list(r.reviewer_emails).map(lower),
    reviewer_roles: list(r.reviewer_roles),
  };
}

export function resolveRoutingConfig(raw) {
  let cfg = raw;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
  const base = defaultRoutingConfig();
  if (!cfg || typeof cfg !== 'object') return { ...base, rules: base.rules.map(normalizeRule) };
  const revision = Number.isInteger(cfg.revision) && cfg.revision > 0 ? cfg.revision : base.revision;
  return {
    version: ROUTING_VERSION_PREFIX + '.' + revision,
    revision,
    fallback_owner_role: cfg.fallback_owner_role || base.fallback_owner_role,
    fallback_owner_email: cfg.fallback_owner_email ? lower(cfg.fallback_owner_email) : null,
    rules: (Array.isArray(cfg.rules) ? cfg.rules : base.rules).map(normalizeRule),
    updated_by: cfg.updated_by || null,
    updated_at: cfg.updated_at || null,
  };
}

export function validateRoutingConfig(raw) {
  const cfg = resolveRoutingConfig(raw);
  const errors = [];
  const keys = new Set();
  if (!cfg.rules.length) errors.push('At least one routing rule is required');
  cfg.rules.forEach((r, i) => {
    const at = 'Rule ' + (i + 1) + ' (' + r.key + ')';
    if (keys.has(r.key)) errors.push(at + ': duplicate key');
    keys.add(r.key);
    if (!r.owner_email && !r.owner_role) errors.push(at + ': name an owner email or an owner role');
    if (r.owner_role && !ROUTABLE_ROLES.includes(r.owner_role)) errors.push(at + ': owner role "' + r.owner_role + '" is not a Sirius reviewer role');
    for (const role of r.reviewer_roles) if (!ROUTABLE_ROLES.includes(role)) errors.push(at + ': reviewer role "' + role + '" is not a Sirius reviewer role');
    for (const f of r.when.flags) if (!FLAG_KEYS.includes(f)) errors.push(at + ': unknown flag "' + f + '"');
    if (r.when.min_aed != null && r.when.max_aed != null && r.when.min_aed > r.when.max_aed) errors.push(at + ': min_aed is above max_aed');
  });
  if (cfg.fallback_owner_role && !ROUTABLE_ROLES.includes(cfg.fallback_owner_role)) errors.push('Fallback owner role is not a Sirius reviewer role');
  return { ok: errors.length === 0, errors };
}

export function buildRoutingConfig(input, { actor, base } = {}) {
  const prior = resolveRoutingConfig(base);
  const next = resolveRoutingConfig({ ...prior, ...(input || {}), revision: prior.revision + 1 });
  const { ok, errors } = validateRoutingConfig(next);
  if (!ok) { const e = new Error('Invalid routing rules: ' + errors.join('; ')); e.status = 400; e.data = { errors }; throw e; }
  return { ...next, updated_by: actor?.email || null, updated_at: new Date().toISOString() };
}

// The routing flags a record raises.
export function routingFlagsFor(data = {}) {
  const yes = (v) => v === true || lower(v) === 'yes' || lower(v) === 'true';
  const flags = [];
  if (yes(data.related_party_auto_flag) || yes(data.related_party) || yes(data.related_party_flag)) flags.push('related_party');
  if (yes(data.below_floor_exception) || data.below_floor_tag) flags.push('below_floor');
  if (yes(data.compressed_timeline)) flags.push('compressed_timeline');
  if (yes(data.cross_border) || yes(data.is_cross_border)) flags.push('cross_border');
  return flags;
}

export function ruleMatches(rule, { ownerOrgId, data = {}, flags = routingFlagsFor(data) }) {
  const w = rule.when || {};
  if (w.org_ids?.length && !w.org_ids.includes(ownerOrgId)) return false;
  if (w.sectors?.length && !w.sectors.includes(lower(data.sector))) return false;
  const amount = num(data.total_commitment_aed);
  if (w.min_aed != null && (amount == null || amount < w.min_aed)) return false;
  if (w.max_aed != null && (amount == null || amount > w.max_aed)) return false;
  if (w.flags?.length && !w.flags.some((f) => flags.includes(f))) return false;
  return true;
}

/**
 * The first matching rule for a record, or a synthetic fallback rule.
 * Returns { rule, flags }.
 */
export function selectRoute(config, { ownerOrgId, data }) {
  const cfg = resolveRoutingConfig(config);
  const flags = routingFlagsFor(data);
  const rule = cfg.rules.find((r) => ruleMatches(r, { ownerOrgId, data, flags }));
  if (rule) return { rule, flags };
  return {
    rule: { key: 'fallback', label: 'Fallback owner', when: {}, owner_email: cfg.fallback_owner_email || null,
      owner_role: cfg.fallback_owner_role, reviewer_emails: [], reviewer_roles: [] },
    flags,
  };
}

/**
 * Pick the owner among candidates [{ email, full_name, open_count }]: the one
 * with the fewest open opportunities, then by email for a stable result.
 */
export function pickLeastLoaded(candidates) {
  const sorted = [...(candidates || [])].sort((a, b) => (a.open_count - b.open_count) || a.email.localeCompare(b.email));
  return sorted[0] || null;
}

export function diffRoutingConfig(before, after) {
  const a = resolveRoutingConfig(before);
  const b = resolveRoutingConfig(after);
  const changes = [];
  if (a.fallback_owner_role !== b.fallback_owner_role) changes.push({ field: 'fallback_owner_role', before: a.fallback_owner_role, after: b.fallback_owner_role });
  const keys = new Set([...a.rules.map((r) => r.key), ...b.rules.map((r) => r.key)]);
  for (const key of keys) {
    const x = a.rules.find((r) => r.key === key);
    const y = b.rules.find((r) => r.key === key);
    if (!x) changes.push({ rule: key, change: 'added' });
    else if (!y) changes.push({ rule: key, change: 'removed' });
    else if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ rule: key, change: 'edited' });
  }
  if (a.rules.map((r) => r.key).join() !== b.rules.map((r) => r.key).join()) changes.push({ field: 'order' });
  return changes;
}

export default {
  ROUTING_CONFIG_KEY, ROUTING_FLAGS, ROUTABLE_ROLES, defaultRoutingConfig, resolveRoutingConfig, validateRoutingConfig,
  buildRoutingConfig, routingFlagsFor, ruleMatches, selectRoute, pickLeastLoaded, diffRoutingConfig,
};
