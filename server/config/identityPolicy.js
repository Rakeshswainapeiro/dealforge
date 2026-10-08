// Identity & request-access policy (BRD PLT-02 entity isolation, PLT-04 SSO,
// NFR-02 security).
//
// Pure functions only (no database, no Express) so every rule here is unit
// tested in isolation. server/index.js and server/users.js wire them in.
//
// Why this exists: the API used to resolve any request without a session as
// the default admin, and accepted x-user-id / x-user-email headers from anyone.
// The platform is now deny-by-default: a request is anonymous unless it carries
// a valid Better Auth session, and only the routes listed below are public.

// Routes reachable without a session. Keep this list short and justify each
// entry: everything else under /api requires an authenticated user.
export const PUBLIC_API_ROUTES = Object.freeze([
  // Liveness/health probes used by Docker and the load balancer.
  { method: 'GET', path: '/api/health' },
  // Better Auth's own endpoints (sign-in, sign-out, get-session, SSO callback)
  // and the login page's public settings. Better Auth protects these itself.
  { method: '*', path: '/api/auth' },
  { method: '*', prefix: '/api/auth/' },
  // OUT-03: a memo's QR code is scanned by a phone with no session. The verify
  // endpoint only reveals valid / version / hash, never memo content.
  { method: 'GET', path: '/api/memo-verification/verify' },
  // PLT-06: UI label dictionaries; no business data.
  { method: 'GET', path: '/api/i18n' },
  { method: 'GET', path: '/api/i18n/locales' },
]);

function normalisePath(path) {
  const p = String(path || '').split('?')[0];
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

function methodMatches(ruleMethod, method) {
  if (ruleMethod === '*') return true;
  const m = String(method || '').toUpperCase();
  // HEAD is a body-less GET; treat it the same so probes behave consistently.
  return ruleMethod === m || (ruleMethod === 'GET' && m === 'HEAD');
}

// True when the request may proceed without an authenticated user.
export function isPublicApiRoute(method, path, routes = PUBLIC_API_ROUTES) {
  const p = normalisePath(path);
  return routes.some((r) => {
    if (!methodMatches(r.method, method)) return false;
    if (r.path) return p === r.path;
    return p.startsWith(r.prefix);
  });
}

// Header identity (x-user-id / x-user-email) exists only so the local
// integration suite and dev scripts can act as seeded users without a browser
// session. It is off unless explicitly enabled, and it can never be enabled in
// production (startupConfigErrors refuses to boot if someone tries).
export function headerIdentityEnabled(env = {}) {
  return env.AUTH_ALLOW_HEADER_IDENTITY === '1' && env.NODE_ENV !== 'production';
}

// Secrets that have been published in this repository at some point. A
// deployment using one of them has a forgeable session cookie.
export const KNOWN_DEFAULT_SECRETS = Object.freeze([
  'dealforge-local-dev-secret-change-me-4d1f8c9e0b2a',
  'dealforge-demo-secret-4d1f8c9e0b2a',
  'change-me-generate-with-openssl-rand-base64-32',
]);

export const MIN_SECRET_LENGTH = 32;

// Configuration problems that must stop a production server from starting.
// Returns [] when the configuration is acceptable. Outside production only
// the secret is checked, and callers treat the result as a warning.
export function startupConfigErrors(env = {}) {
  const errors = [];
  const secret = env.BETTER_AUTH_SECRET || env.AUTH_SECRET || '';
  if (!secret) {
    errors.push('BETTER_AUTH_SECRET is not set');
  } else if (KNOWN_DEFAULT_SECRETS.includes(secret)) {
    errors.push('BETTER_AUTH_SECRET is a published default value; generate a new one (openssl rand -base64 32)');
  } else if (secret.length < MIN_SECRET_LENGTH) {
    errors.push(`BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (env.NODE_ENV !== 'production') return errors;

  if (env.AUTH_ALLOW_HEADER_IDENTITY === '1') {
    errors.push('AUTH_ALLOW_HEADER_IDENTITY=1 is not allowed in production');
  }
  if (env.ADMIN_ALLOW_HEADER_AUTH === '1') {
    errors.push('ADMIN_ALLOW_HEADER_AUTH=1 is not allowed in production');
  }
  if (env.RATE_LIMIT_DISABLED === '1' || env.AUTH_RATE_LIMIT_DISABLED === '1') {
    errors.push('Rate limiting cannot be disabled in production');
  }
  if (!env.PUBLIC_BASE_URL || !/^https:\/\//.test(env.PUBLIC_BASE_URL)) {
    errors.push('PUBLIC_BASE_URL must be set to an https:// URL in production');
  }
  // Sample data and the seeded cast's shared password never reach production.
  const profile = String(env.SEED_PROFILE || '').trim().toLowerCase();
  if (profile === 'mvp' || env.SEED_DEMO_DATA === '1' || env.SEED_DEMO_DATA === 'true') {
    errors.push('SEED_PROFILE=mvp (sample opportunities and personas) is not allowed in production; use base or off');
  }
  if (profile !== 'off') {
    const pw = env.DEFAULT_USER_PASSWORD || '';
    if (!pw || PUBLISHED_PASSWORDS.includes(pw) || pw.length < 14) {
      errors.push('DEFAULT_USER_PASSWORD must be set to a private value of at least 14 characters (or SEED_PROFILE=off) in production');
    }
  }
  if (env.MFA_ENFORCE === '0') {
    errors.push('MFA_ENFORCE=0 is not allowed in production (PLT-04)');
  }
  if (env.TRUST_PROXY === 'true') {
    errors.push('TRUST_PROXY=true trusts any X-Forwarded-For; set the number of proxy hops (e.g. 1)');
  }
  return errors;
}

// The seeded cast's password published in the README and the test suite.
export const PUBLISHED_PASSWORDS = Object.freeze(['DealForge!2026']);

/**
 * Which proxies to trust for the client address (rate limits, audit IPs).
 * TRUST_PROXY: a hop count, 'loopback', a CIDR list, or 'false'. Default: one
 * hop (the load balancer) in production, loopback elsewhere. Never "true",
 * which lets any client forge its address.
 */
export function trustProxySetting(env = {}) {
  const v = String(env.TRUST_PROXY ?? '').trim();
  if (v === 'false' || v === '0') return false;
  if (/^\d+$/.test(v)) return Number(v);
  if (v && v !== 'true') return v;
  return env.NODE_ENV === 'production' ? 1 : 'loopback';
}

/**
 * The MFA policy actually enforced (PLT-04). In production a second factor is
 * always enforced for at least administrators, whatever the stored policy says;
 * elsewhere the stored policy applies as configured.
 */
export function effectiveMfaPolicy(policy = {}, env = {}) {
  if (env.NODE_ENV !== 'production') return policy;
  const mode = ['required_admins', 'required_all'].includes(policy.mfa_mode) ? policy.mfa_mode : 'required_admins';
  return { ...policy, mfa_mode: mode, enforce_mfa: true };
}

function splitOrigins(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const DEV_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:34000',
  'http://127.0.0.1:34000',
]);

// Browser origins allowed to call the API cross-origin with credentials.
// Production: only PUBLIC_BASE_URL plus CORS_ALLOWED_ORIGINS. Other
// environments also allow the local dev ports.
export function allowedCorsOrigins(env = {}) {
  const list = [...splitOrigins(env.PUBLIC_BASE_URL), ...splitOrigins(env.CORS_ALLOWED_ORIGINS)];
  if (env.NODE_ENV !== 'production') list.push(...DEV_ORIGINS);
  return Array.from(new Set(list));
}

// A request with no Origin header is same-origin or non-browser (curl, health
// probes, server-to-server). CORS does not apply to it; authentication still does.
export function isCorsOriginAllowed(origin, allowed) {
  if (!origin) return true;
  return allowed.includes(String(origin).replace(/\/+$/, ''));
}
