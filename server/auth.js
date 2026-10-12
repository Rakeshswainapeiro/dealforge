import { betterAuth } from 'better-auth';
import { organization, admin, twoFactor } from 'better-auth/plugins';
import { sso } from '@better-auth/sso';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { PostgresDialect } from 'kysely';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { AUTH_POLICY_KEY, AUTH_POLICY_MESSAGES } from './config/authPolicyData.js';
import {
  resolveAuthPolicy, defaultAuthPolicy, providersFromEnv, mergeProviders,
  isLocalDomainAllowed,
} from './config/authPolicy.js';

export const AUTH_BASE_PATH = '/api/auth';

export function authSecret() {
  return process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || 'dealforge-local-dev-secret-change-me-4d1f8c9e0b2a';
}

export function authBaseURL() {
  return (process.env.PUBLIC_BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');
}

// Origins allowed to start a session (Better Auth CSRF protection). Covers the
// public base URL, the Vite dev server proxy, and direct localhost calls, and
// is extendable at deploy time via AUTH_TRUSTED_ORIGINS (comma-separated).
export function authTrustedOrigins() {
  const port = process.env.PORT || '3001';
  const defaults = [
    authBaseURL(),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:34000',
    'http://127.0.0.1:34000',
    'http://localhost:' + port,
    'http://127.0.0.1:' + port,
  ];
  const extra = String(process.env.AUTH_TRUSTED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return Array.from(new Set([...defaults, ...extra]));
}

// Better Auth ships its own limiter (strict rules on sign-in, enabled in
// production by default). The app-wide limiter honours RATE_LIMIT_DISABLED, so
// the auth layer follows the same switch to keep local integration runs
// deterministic. Deployments can also tune it with AUTH_RATE_LIMIT_MAX /
// AUTH_RATE_LIMIT_WINDOW (seconds); when neither is set the library default
// applies unchanged.
export function authRateLimit() {
  if (process.env.RATE_LIMIT_DISABLED === '1' || process.env.AUTH_RATE_LIMIT_DISABLED === '1') {
    return { enabled: false };
  }
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX || 0);
  const window = Number(process.env.AUTH_RATE_LIMIT_WINDOW || 0);
  if (max > 0 || window > 0) {
    return {
      enabled: true,
      ...(window > 0 ? { window } : {}),
      ...(max > 0 ? { max } : {}),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Authentication policy (W8-01 / BRD PLT-04).
//
// The effective policy is the shipped default overlaid with a runtime override
// an administrator saves in AppSettings (setting_key = 'auth_policy_config')
// and any deployment-time SSO providers read from the environment. Reads fall
// back to the default so an unconfigured deployment behaves exactly as before.
// Cached for a few seconds so the sign-in hook does not read settings on every
// request; invalidated on a policy write.
// ---------------------------------------------------------------------------
const AUTH_POLICY_CACHE_MS = 10000;
let authPolicyCache = { at: 0, config: null };

export function invalidateAuthPolicyCache() {
  authPolicyCache = { at: 0, config: null };
}

export async function loadAuthPolicy() {
  const now = Date.now();
  if (authPolicyCache.config && now - authPolicyCache.at < AUTH_POLICY_CACHE_MS) {
    return authPolicyCache.config;
  }
  let config = defaultAuthPolicy();
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [AUTH_POLICY_KEY]
    );
    if (rows[0]?.setting_value) config = resolveAuthPolicy(rows[0].setting_value);
  } catch {
    config = defaultAuthPolicy();
  }
  // Deployment-time providers extend (and are overridable in) the stored set.
  const envProviders = providersFromEnv(process.env);
  if (envProviders.length) config = { ...config, providers: mergeProviders(config.providers, envProviders) };
  authPolicyCache = { at: now, config };
  return config;
}

// Where a provider entry goes in the config at boot/registration time. Given
// the resolved policy, the app's providers are mirrored into Better Auth's
// ssoProvider table so the SSO plugin can resolve a domain to an IdP.
export async function syncSsoProviders(config) {
  const providers = (config?.providers || []).filter((p) => p.enabled && (p.kind === 'oidc' || p.kind === 'saml'));
  for (const p of providers) {
    try {
      const issuer = p.issuer || p.discovery_url;
      if (!issuer) continue;
      const { rows: existing } = await pool.query(
        'SELECT id FROM "ssoProvider" WHERE "providerId" = $1 LIMIT 1',
        [p.provider_id]
      );
      if (existing[0]) continue;
      const oidcConfig = p.kind === 'oidc' ? JSON.stringify({
        issuer,
        clientId: p.client_id || '',
        clientSecret: p.client_secret || '',
        discoveryEndpoint: p.discovery_url || (issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration'),
        ...(p.skip_discovery ? {
          skipDiscovery: true,
          authorizationEndpoint: p.authorization_endpoint,
          tokenEndpoint: p.token_endpoint,
          jwksEndpoint: p.jwks_endpoint,
          userInfoEndpoint: p.user_info_endpoint,
        } : {}),
        pkce: true,
        scopes: p.scopes || ['openid', 'email', 'profile'],
      }) : null;
      const samlConfig = p.kind === 'saml' ? JSON.stringify({
        issuer,
        entryPoint: p.entry_point || null,
        cert: p.cert || null,
        callbackUrl: p.callback_url || (authBaseURL() + AUTH_BASE_PATH + '/sso/callback/' + p.provider_id),
      }) : null;
      await pool.query(
        'INSERT INTO "ssoProvider" (id, issuer, "providerId", domain, "oidcConfig", "samlConfig", "organizationId", "userId") ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("providerId") DO NOTHING',
        ['sso-' + p.provider_id, issuer, p.provider_id, p.domain, oidcConfig, samlConfig, p.org_id || null, null]
      );
    } catch (err) {
      console.warn('[auth] SSO provider sync skipped for ' + p.provider_id + ':', err?.message || err);
    }
  }
  return providers.length;
}

// Bootstrap the SSO plugin from the environment at import time (pure, sync,
// no DB read) so a deployment can register an IdP without a settings write.
export function ssoBootstrapProviders() {
  return providersFromEnv(process.env).map((p) => ({
    domain: p.domain,
    providerId: p.provider_id,
    ...(p.kind === 'oidc' ? {
      oidcConfig: {
        issuer: p.issuer,
        clientId: p.client_id,
        clientSecret: p.client_secret,
        discoveryEndpoint: p.discovery_url || (String(p.issuer || '').replace(/\/+$/, '') + '/.well-known/openid-configuration'),
        pkce: true,
      },
    } : {}),
    ...(p.kind === 'saml' ? {
      samlConfig: { entryPoint: p.entry_point, cert: p.cert, callbackUrl: p.callback_url },
    } : {}),
  }));
}

export const auth = betterAuth({
  database: new PostgresDialect({ pool }),
  baseURL: authBaseURL(),
  secret: authSecret(),
  basePath: AUTH_BASE_PATH,
  trustedOrigins: authTrustedOrigins(),
  // Accounts are created by admins/seeds or SSO, never by public self-registration.
  emailAndPassword: { enabled: true, disableSignUp: true },
  // Everyone signs in through one Microsoft (Entra) tenant whose admins control email
  // addresses, so a first SSO sign-in may attach to the existing account with the same
  // verified email. Only this provider is trusted for that.
  // SSO linking rules (Better Auth's SSO plugin ignores `trustedProviders`; it trusts a
  // provider only via domain verification, see the sso() options below).
  // Accounts are created only by admins/seeds (public sign-up is disabled), so an
  // existing account does not need a separately verified email before a first SSO
  // sign-in attaches to it.
  account: {
    accountLinking: { enabled: true, requireLocalEmailVerified: false },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  ...(authRateLimit() ? { rateLimit: authRateLimit() } : {}),
  advanced: { database: { validateSchema: false } },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      try {
        const policy = await loadAuthPolicy();
        // Local-domain allowlist (PLT-04 "local accounts for approved
        // externals"): when enforcement is on, only approved domains may use a
        // password. Off by default, so existing behaviour is untouched.
        if (ctx.path === '/sign-in/email' || ctx.path === '/sign-up/email') {
          if (policy.enforce_local_domain_allowlist) {
            const email = ctx.body?.email;
            if (email && !isLocalDomainAllowed(email, policy)) {
              throw new APIError('FORBIDDEN', { message: AUTH_POLICY_MESSAGES.local_domain_denied });
            }
          }
        }
      } catch (err) {
        if (err instanceof APIError) throw err;
        // A policy read must never take the identity layer down.
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      try {
        const path = ctx.path || '';
        if (path === '/sign-in/email' || path === '/sign-in/sso' || path === '/sso/callback' || path.startsWith('/sso/callback/')) {
          const newSession = ctx.context?.newSession;
          const user = newSession?.user;
          const method = path.includes('sso') ? 'sso' : 'email';
          if (user) {
            // The twoFactor plugin's own after-hook runs after this one, so a
            // user with a second factor still has a session here: the session
            // is torn down once MFA is pending. Record the challenge now and
            // the completed sign-in is recorded on the verify endpoint below.
            const pending = Boolean(user.twoFactorEnabled);
            await writeAudit({
              entity: 'auth',
              entityId: user.id || null,
              action: pending ? 'sign_in_mfa_challenge' : 'sign_in',
              actor: { id: user.id || null, email: user.email || null },
              orgId: null,
              after: { method, two_factor_enabled: Boolean(user.twoFactorEnabled), path },
            });
          } else if (path === '/sign-in/email') {
            // No session and no user: the credentials were rejected. Either the
            // email was unknown or the password was wrong; the attempt is
            // recorded so failed logins are auditable (PLT-04 accept criteria).
            const email = ctx.body?.email || null;
            await writeAudit({
              entity: 'auth',
              action: 'sign_in_failed',
              actor: email ? { id: null, email } : null,
              after: { method: 'email', path, reason: 'invalid_credentials' },
            });
          }
        }
        if (path === '/two-factor/verify-totp' || path === '/two-factor/verify-backup-code') {
          const user = ctx.context?.newSession?.user;
          if (user) {
            await writeAudit({
              entity: 'auth',
              entityId: user.id || null,
              action: 'sign_in',
              actor: { id: user.id || null, email: user.email || null },
              orgId: null,
              after: { method: path.endsWith('totp') ? 'totp' : 'backup_code', path },
            });
          }
        }
      } catch (err) {
        console.warn('[auth] sign-in audit failed:', err?.message || err);
      }
    }),
  },
  plugins: [
    organization({
      schema: {
        organization: { modelName: 'auth_org' },
        member: { modelName: 'auth_member' },
        invitation: { modelName: 'auth_invitation' },
        team: { modelName: 'auth_team' },
        teamMember: { modelName: 'auth_team_member' },
        organizationRole: { modelName: 'auth_org_role' },
      },
    }),
    // New users (sign-up or first SSO login) must never be admins. Admin is granted explicitly.
    admin({ defaultRole: 'user' }),
    twoFactor({ issuer: 'DealForge', twoFactorTable: 'twoFactor' }),
    // Providers configured in code/env are treated as domain-verified, so a first
    // sign-in links to the existing account when the email domain is in the provider's
    // domain list. Providers added at runtime must prove domain ownership via DNS first.
    sso({ defaultSSO: ssoBootstrapProviders(), domainVerification: { enabled: true } }),
  ],
});

export const authHandler = toNodeHandler(auth);

export function toAuthHeaders(req) {
  return fromNodeHeaders(req.headers || {});
}

// Resolve the current Better Auth session (user + session) from a request's
// cookie or Bearer header. Returns null when no valid session is presented.
export async function sessionUser(req) {
  try {
    const session = await auth.api.getSession({ headers: toAuthHeaders(req) });
    return session || null;
  } catch (err) {
    return null;
  }
}

export async function sessionEmail(req) {
  const session = await sessionUser(req);
  return session?.user?.email || null;
}

export default auth;
