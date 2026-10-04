// ---------------------------------------------------------------------------
// Unified admin configuration - pure registry logic (W8-03 / BRD ADM-01).
//
// The vocabulary lives in config/adminConfigData.js; this module turns it into
// the read shapes the API returns: a domain lookup, a group roll-up and the
// full registry payload. It is pure (no database access) so it is cheap to test
// and safe to import from the client-facing route layer.
// ---------------------------------------------------------------------------

import {
  ADMIN_CONFIG_VERSION, ADMIN_CONFIG_KEY, ADMIN_CONFIG_OWNER,
  NEW_WORK_SCOPE_NOTE, CONFIG_GROUPS, CONFIG_GROUP_KEYS,
  CONFIG_DOMAINS, CONFIG_DOMAIN_KEYS, ADMIN_CONFIG_MESSAGES,
} from './adminConfigData.js';

// Look up one registered area by its stable domain id (case-insensitive).
export function configDomain(domain) {
  const key = String(domain || '').trim().toLowerCase();
  return CONFIG_DOMAINS.find((d) => d.domain === key) || null;
}

// The areas belonging to one group, in registry order.
export function domainsByGroup(group) {
  return CONFIG_DOMAINS.filter((d) => d.group === group);
}

// Counts per group plus totals, for the registry header.
export function registrySummary(domains = CONFIG_DOMAINS) {
  const by_group = CONFIG_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    description: g.description,
    count: domains.filter((d) => d.group === g.key).length,
  }));
  return {
    total: domains.length,
    versioned: domains.filter((d) => d.versioned).length,
    audited: domains.filter((d) => d.audited).length,
    groups: by_group.length,
    by_group,
  };
}

// Every group annotated with the areas it contains - the primary read shape.
export function groupedDomains(domains = CONFIG_DOMAINS) {
  return CONFIG_GROUPS.map((g) => ({
    ...g,
    domains: domains.filter((d) => d.group === g.key),
  }));
}

// The registry payload returned by GET /api/admin-config.
export function buildAdminConfigPayload({ domains = CONFIG_DOMAINS } = {}) {
  return {
    version: ADMIN_CONFIG_VERSION,
    key: ADMIN_CONFIG_KEY,
    owner: ADMIN_CONFIG_OWNER,
    scope_note: NEW_WORK_SCOPE_NOTE,
    groups: groupedDomains(domains),
    summary: registrySummary(domains),
    domain_keys: CONFIG_DOMAIN_KEYS,
    group_keys: CONFIG_GROUP_KEYS,
    disclaimer: ADMIN_CONFIG_MESSAGES.disclaimer,
  };
}

export default {
  configDomain, domainsByGroup, registrySummary, groupedDomains,
  buildAdminConfigPayload,
};
