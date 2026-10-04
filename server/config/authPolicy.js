// ---------------------------------------------------------------------------
// Authentication policy - pure functions (W8-01 / BRD PLT-04).
//
// No database, no network, no side effects. The route in server/authPolicy.js
// persists the resolved document in AppSettings; server/auth.js consumes the
// same helpers to wire Better Auth (MFA plugin, SSO providers, sign-in gates).
// Keeping the decision logic here means the enforcement path and the admin UI
// agree by construction.
// ---------------------------------------------------------------------------

import {
  AUTH_POLICY_VERSION, AUTH_POLICY_DEFAULT_REVISION, AUTH_POLICY_OWNER,
  MFA_MODE_KEYS, DEFAULT_MFA_MODE, MFA_ADMIN_ROLES,
  SSO_PROVIDER_KINDS, AUTH_POLICY_MESSAGES,
} from './authPolicyData.js';

export {
  AUTH_POLICY_KEY, AUTH_POLICY_VERSION, AUTH_POLICY_VERSION_PREFIX,
  AUTH_POLICY_DEFAULT_REVISION, AUTH_POLICY_OWNER,
  MFA_MODES, MFA_MODE_KEYS, DEFAULT_MFA_MODE, MFA_ADMIN_ROLES,
  SSO_PROVIDER_KINDS, SSO_ENV_LIST, SSO_ENV_PREFIX, AUTH_POLICY_MESSAGES,
} from './authPolicyData.js';

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v) {
  return v == null ? '' : String(v).trim();
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Normalise one provider entry to a stable shape. A provider is registered
// against a tenant (org id) and a domain, and carries the OIDC/SAML settings
// Better Auth needs to start a flow. Secrets are never returned by the read
// surface (see redactProvider).
export function normalizeProvider(raw = {}) {
  const kind = cleanString(raw.kind || raw.type).toLowerCase();
  return {
    id: cleanString(raw.id) || cleanString(raw.provider_id),
    provider_id: cleanString(raw.provider_id || raw.id),
    kind: SSO_PROVIDER_KINDS.includes(kind) ? kind : '',
    label: cleanString(raw.label) || cleanString(raw.provider_id || raw.id),
    issuer: cleanString(raw.issuer),
    domain: cleanString(raw.domain).toLowerCase(),
    org_id: cleanString(raw.org_id) || null,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    // OIDC
    discovery_url: cleanString(raw.discovery_url) || null,
    client_id: cleanString(raw.client_id) || null,
    client_secret: cleanString(raw.client_secret) || null,
    scopes: Array.isArray(raw.scopes) ? raw.scopes.map(cleanString).filter(Boolean) : null,
    // Explicit endpoints for an internal IdP that does not publish OIDC
    // discovery; when skip_discovery is set these replace the discovery fetch.
    skip_discovery: Boolean(raw.skip_discovery),
    authorization_endpoint: cleanString(raw.authorization_endpoint) || null,
    token_endpoint: cleanString(raw.token_endpoint) || null,
    jwks_endpoint: cleanString(raw.jwks_endpoint) || null,
    user_info_endpoint: cleanString(raw.user_info_endpoint) || null,
    // SAML
    entry_point: cleanString(raw.entry_point) || null,
    cert: cleanString(raw.cert) || null,
    callback_url: cleanString(raw.callback_url) || null,
    // Provenance: 'env' (deployment-time) or 'runtime' (admin AppSettings).
    source: raw.source === 'env' ? 'env' : 'runtime',
  };
}

// Validate one provider. Returns an array of { field, message } errors.
export function validateProvider(provider = {}) {
  const p = normalizeProvider(provider);
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  if (!p.provider_id) push('provider_id', 'A provider id is required.');
  if (!SSO_PROVIDER_KINDS.includes(p.kind)) push('kind', AUTH_POLICY_MESSAGES.invalid_provider_kind);
  if (!p.domain) push('domain', 'An email domain is required to route sign-ins to the provider.');
  if (p.kind === 'oidc') {
    if (!p.issuer && !p.discovery_url) push('issuer', 'An OIDC provider needs an issuer or a discovery URL.');
    if (!p.client_id) push('client_id', 'An OIDC provider needs a client id.');
    if (!p.client_secret) push('client_secret', 'An OIDC provider needs a client secret.');
    if (p.skip_discovery) {
      if (!p.authorization_endpoint) push('authorization_endpoint', 'A provider without discovery needs an authorization endpoint.');
      if (!p.token_endpoint) push('token_endpoint', 'A provider without discovery needs a token endpoint.');
      if (!p.jwks_endpoint) push('jwks_endpoint', 'A provider without discovery needs a JWKS endpoint.');
    }
  }
  if (p.kind === 'saml') {
    if (!p.entry_point) push('entry_point', 'A SAML provider needs an IdP entry point (SSO URL).');
    if (!p.cert) push('cert', 'A SAML provider needs an IdP signing certificate.');
  }
  return errors;
}

export function validateProviders(providers = []) {
  const errors = [];
  const seen = new Set();
  (Array.isArray(providers) ? providers : []).forEach((raw, i) => {
    const p = normalizeProvider(raw);
    for (const e of validateProvider(p)) errors.push({ field: `providers[${i}].${e.field}`, message: e.message });
    const key = p.provider_id.toLowerCase();
    if (key && seen.has(key)) errors.push({ field: `providers[${i}].provider_id`, message: `Duplicate provider id: ${p.provider_id}` });
    seen.add(key);
  });
  return errors;
}

// Read deployment-time providers from the environment. Reads SSO_PROVIDERS (a
// comma list of ids) then the SSO_<ID>_* keys for each. Returns [] when none
// are configured, so an unconfigured deployment behaves exactly as before.
export function providersFromEnv(env = process.env) {
  const list = cleanString(env.SSO_PROVIDERS);
  if (!list) return [];
  const out = [];
  for (const rawId of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    const upper = rawId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
    const get = (suffix) => cleanString(env[`SSO_${upper}_${suffix}`]);
    const kind = get('KIND').toLowerCase() || 'oidc';
    out.push(normalizeProvider({
      id: rawId,
      provider_id: get('PROVIDER_ID') || rawId,
      kind,
      label: get('LABEL') || get('PROVIDER_ID') || rawId,
      issuer: get('ISSUER'),
      domain: get('DOMAIN'),
      org_id: get('ORG_ID') || null,
      enabled: get('ENABLED') !== '0',
      discovery_url: get('DISCOVERY_URL') || null,
      client_id: get('CLIENT_ID') || null,
      client_secret: get('CLIENT_SECRET') || null,
      scopes: get('SCOPES') ? get('SCOPES').split(/[ ,]+/).filter(Boolean) : null,
      entry_point: get('ENTRY_POINT') || null,
      cert: get('CERT') || null,
      source: 'env',
    }));
  }
  return out;
}

// Merge runtime (admin) providers over env providers. A runtime entry with the
// same provider_id overrides the env one, so an admin can retune a deployment
// provider without a redeploy; env-only providers remain.
export function mergeProviders(runtime = [], env = []) {
  const byId = new Map();
  for (const p of env.map(normalizeProvider)) byId.set(p.provider_id.toLowerCase(), p);
  for (const p of runtime.map(normalizeProvider)) byId.set(p.provider_id.toLowerCase(), p);
  return Array.from(byId.values());
}

// Strip secrets before a read surface (the admin console or any API) returns a
// provider so a client secret / signing cert never leaves the server.
export function redactProvider(provider = {}) {
  const p = normalizeProvider(provider);
  return {
    id: p.id,
    provider_id: p.provider_id,
    kind: p.kind,
    label: p.label,
    issuer: p.issuer,
    domain: p.domain,
    org_id: p.org_id,
    enabled: p.enabled,
    discovery_url: p.discovery_url,
    client_id: p.client_id,
    has_client_secret: Boolean(p.client_secret),
    skip_discovery: p.skip_discovery,
    authorization_endpoint: p.authorization_endpoint,
    token_endpoint: p.token_endpoint,
    entry_point: p.entry_point,
    has_cert: Boolean(p.cert),
    callback_url: p.callback_url,
    source: p.source,
  };
}

// ---------------------------------------------------------------------------
// Policy document
// ---------------------------------------------------------------------------

export function defaultAuthPolicy() {
  return {
    version: AUTH_POLICY_VERSION,
    revision: AUTH_POLICY_DEFAULT_REVISION,
    source: 'default',
    owner: AUTH_POLICY_OWNER,
    mfa_mode: DEFAULT_MFA_MODE,
    // Domains permitted to hold a local (password) account. Everything else is
    // expected to arrive through SSO. '*@sirius.local' style patterns are not
    // used; entries are bare domains.
    local_account_domains: ['sirius.local', 'infinia.local', 'dealforge.local'],
    // When true, a user whose email domain is not in the list above cannot use
    // email+password and must use SSO.
    enforce_local_domain_allowlist: false,
    // When true, an authenticated session whose role is covered by mfa_mode but
    // which has not enrolled a second factor is refused access to protected app
    // routes (403 with error 'mfa_required'). Default false: the policy is
    // advertised and surfaced in the UI, and enforcement is switched on
    // deliberately once the pilot cast has enrolled a factor. This keeps a
    // deployment from locking administrators out of their first login.
    enforce_mfa: false,
    providers: [],
    updated_by: null,
    updated_at: null,
    at: null,
  };
}

function normDomains(list, base) {
  if (!Array.isArray(list)) return base;
  const seen = new Set();
  const out = [];
  for (const d of list) {
    const v = cleanString(d).toLowerCase().replace(/^@/, '');
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

function normConfig(raw, base = defaultAuthPolicy()) {
  const mfaMode = cleanString(raw.mfa_mode).toLowerCase();
  return {
    version: base.version,
    revision: Number.isInteger(raw.revision) ? raw.revision : base.revision,
    source: raw.source || base.source,
    owner: cleanString(raw.owner) || base.owner,
    mfa_mode: MFA_MODE_KEYS.includes(mfaMode) ? mfaMode : base.mfa_mode,
    local_account_domains: normDomains(raw.local_account_domains, base.local_account_domains),
    enforce_local_domain_allowlist: raw.enforce_local_domain_allowlist === undefined
      ? base.enforce_local_domain_allowlist : Boolean(raw.enforce_local_domain_allowlist),
    enforce_mfa: raw.enforce_mfa === undefined ? base.enforce_mfa : Boolean(raw.enforce_mfa),
    providers: Array.isArray(raw.providers) ? raw.providers.map(normalizeProvider) : base.providers,
    updated_by: raw.updated_by ?? base.updated_by,
    updated_at: raw.updated_at ?? base.updated_at,
    at: raw.at ?? base.at,
  };
}

export function resolveAuthPolicy(config = null) {
  const raw = coerce(config);
  if (!isPlainObject(raw)) return defaultAuthPolicy();
  return normConfig(raw, defaultAuthPolicy());
}

export function validateAuthPolicy(config = {}) {
  const c = resolveAuthPolicy(config);
  const errors = [];
  if (!MFA_MODE_KEYS.includes(c.mfa_mode)) errors.push({ field: 'mfa_mode', message: AUTH_POLICY_MESSAGES.invalid_mfa_mode });
  for (const e of validateProviders(c.providers)) errors.push(e);
  return { ok: errors.length === 0, errors };
}

export function diffAuthPolicy(before = {}, after = {}) {
  const a = resolveAuthPolicy(before);
  const b = resolveAuthPolicy(after);
  const changes = [];
  const push = (field, from, to) => { if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field, before: from, after: to }); };
  push('mfa_mode', a.mfa_mode, b.mfa_mode);
  push('enforce_mfa', a.enforce_mfa, b.enforce_mfa);
  push('local_account_domains', a.local_account_domains, b.local_account_domains);
  push('enforce_local_domain_allowlist', a.enforce_local_domain_allowlist, b.enforce_local_domain_allowlist);
  push('provider_ids', a.providers.map((p) => p.provider_id), b.providers.map((p) => p.provider_id));
  push('provider_domains', a.providers.map((p) => p.domain), b.providers.map((p) => p.domain));
  return changes;
}

export function buildAuthPolicy(body = {}, { actor = null, base = defaultAuthPolicy(), at = null } = {}) {
  const current = resolveAuthPolicy(base);
  const merged = normConfig({ ...current, ...(isPlainObject(body) ? body : {}) }, current);
  merged.revision = current.revision + 1;
  merged.source = 'configured';
  merged.updated_by = actor?.email || merged.updated_by || null;
  merged.updated_at = at || new Date().toISOString();
  merged.at = merged.updated_at;
  // Preserve a stored secret when the incoming provider omits it (the read
  // surface redacts secrets, so a round-tripped provider has none).
  merged.providers = merged.providers.map((p) => {
    const prior = current.providers.find((q) => q.provider_id.toLowerCase() === p.provider_id.toLowerCase());
    if (!prior) return p;
    return {
      ...p,
      client_secret: p.client_secret || prior.client_secret,
      cert: p.cert || prior.cert,
      source: p.source || prior.source,
    };
  });
  return merged;
}

// ---------------------------------------------------------------------------
// Enforcement helpers (shared by server/auth.js)
// ---------------------------------------------------------------------------

// Whether MFA must be held by a user with the given roles under this policy.
export function mfaRequiredForRoles(roles = [], config = defaultAuthPolicy()) {
  const c = resolveAuthPolicy(config);
  if (c.mfa_mode === 'off') return false;
  if (c.mfa_mode === 'optional') return false;
  if (c.mfa_mode === 'required_all') return true;
  if (c.mfa_mode === 'required_admins') return roles.some((r) => MFA_ADMIN_ROLES.includes(r));
  return false;
}

// Whether an email domain may hold a local (password) account.
export function isLocalDomainAllowed(email = '', config = defaultAuthPolicy()) {
  const c = resolveAuthPolicy(config);
  if (!c.enforce_local_domain_allowlist) return true;
  const domain = cleanString(email).toLowerCase().split('@')[1] || '';
  if (!domain) return false;
  return c.local_account_domains.includes(domain);
}

// The tenant (org id) an email should be routed to, based on the first enabled
// provider whose domain matches. Returns null when no provider matches.
export function providerForDomain(email = '', providers = []) {
  const domain = cleanString(email).toLowerCase().split('@')[1] || '';
  if (!domain) return null;
  return providers.find((p) => p.enabled && p.domain && p.domain === domain) || null;
}

// Whether an already-authenticated session satisfies the MFA requirement.
// Enforcement is opt-in (enforce_mfa), so by default a session is always
// satisfied and existing behaviour is untouched. When enforcement is on, a
// session whose roles require a second factor but which has not enrolled one is
// refused access to protected routes (see server/index.js).
export function sessionMfaSatisfied({ roles = [], hasMfa = false } = {}, config = defaultAuthPolicy()) {
  const c = resolveAuthPolicy(config);
  if (!c.enforce_mfa) return true;
  if (!mfaRequiredForRoles(roles, c)) return true;
  return Boolean(hasMfa);
}

export default {
  normalizeProvider, validateProvider, validateProviders, providersFromEnv,
  mergeProviders, redactProvider, defaultAuthPolicy, resolveAuthPolicy,
  validateAuthPolicy, diffAuthPolicy, buildAuthPolicy, mfaRequiredForRoles,
  isLocalDomainAllowed, providerForDomain, sessionMfaSatisfied,
};
