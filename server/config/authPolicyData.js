// ---------------------------------------------------------------------------
// Authentication policy vocabulary (W8-01 / BRD PLT-04).
//
// Source of truth: the Phase-1 BRD, Platform - "SSO (OIDC/SAML) + MFA provider
// integration; local accounts for approved externals" with the accept criteria
// "SSO works for Sirius + pilot subsidiary; MFA enforced; failed logins logged".
//
// The group authentication policy controls three things, each of which is a
// deployment-time decision that an administrator can also retune at runtime:
//   1. How strongly MFA is enforced (off / optional / admins / everyone).
//   2. Which identity domains may hold a local (password) account - the
//      "approved externals" list; everyone else must arrive through SSO.
//   3. Which SSO providers (OIDC or SAML) are configured for the tenant.
//
// This module is vocabulary only; the pure resolution and validation functions
// live in config/authPolicy.js, the HTTP route in server/authPolicy.js, and the
// Better Auth wiring in server/auth.js.
// ---------------------------------------------------------------------------

export const AUTH_POLICY_KEY = 'auth_policy_config';
export const AUTH_POLICY_VERSION = 'PLT-04.1';
export const AUTH_POLICY_VERSION_PREFIX = 'PLT-04.';
export const AUTH_POLICY_DEFAULT_REVISION = 1;
export const AUTH_POLICY_OWNER = 'Platform / Group IT Security';

// How strongly multi-factor authentication is enforced at sign-in.
export const MFA_MODES = [
  { key: 'off', label: 'Off', description: 'MFA is not offered or enforced.' },
  { key: 'optional', label: 'Optional', description: 'Users may enrol an authenticator app.' },
  { key: 'required_admins', label: 'Required for administrators', description: 'Admins and super-admins must hold a second factor.' },
  { key: 'required_all', label: 'Required for everyone', description: 'Every user must hold a second factor.' },
];
export const MFA_MODE_KEYS = MFA_MODES.map((m) => m.key);

// Deployment default. Enforcing MFA for administrators is the conservative
// choice: it protects the highest-privilege accounts without locking every
// pilot user out of a first login before they have enrolled a factor.
export const DEFAULT_MFA_MODE = 'required_admins';

// Roles treated as administrator for the 'required_admins' mode.
export const MFA_ADMIN_ROLES = ['admin'];

// SSO provider kinds. The Better Auth SSO plugin speaks OIDC and SAML 2.0.
export const SSO_PROVIDER_KINDS = ['oidc', 'saml'];

// Environment variable naming convention for deployment-time providers:
//   SSO_PROVIDERS=corp,partner
//   SSO_CORP_KIND=oidc
//   SSO_CORP_LABEL=Sirius Corp
//   SSO_CORP_ISSUER=https://idp.example.com
//   SSO_CORP_CLIENT_ID=...   SSO_CORP_CLIENT_SECRET=...
//   SSO_CORP_DOMAIN=sirius.local
//   SSO_CORP_ORG_ID=org-sirius-international-holding-limited
export const SSO_ENV_LIST = 'SSO_PROVIDERS';
export const SSO_ENV_PREFIX = 'SSO_';

export const AUTH_POLICY_MESSAGES = {
  config_invalid: 'The authentication policy configuration is invalid.',
  invalid_mfa_mode: 'The MFA mode must be off, optional, required_admins or required_all.',
  invalid_provider_kind: 'An SSO provider kind must be oidc or saml.',
  mfa_required: 'Multi-factor authentication is required for your account. Enrol an authenticator app to continue.',
  sso_only: 'Local password sign-in is not permitted for this account; use single sign-on.',
  local_domain_denied: 'This email domain is not approved for a local account; use single sign-on.',
  failed_login: 'A sign-in attempt failed and has been recorded.',
  disclaimer:
    'Authentication is served by Better Auth. SSO providers are registered per tenant, administrator '
    + 'accounts can be required to hold a second factor, and only approved external domains may hold a local '
    + 'password account. Every failed sign-in is written to the immutable audit trail.',
};

export default {
  AUTH_POLICY_KEY, AUTH_POLICY_VERSION, AUTH_POLICY_VERSION_PREFIX,
  AUTH_POLICY_DEFAULT_REVISION, AUTH_POLICY_OWNER,
  MFA_MODES, MFA_MODE_KEYS, DEFAULT_MFA_MODE, MFA_ADMIN_ROLES,
  SSO_PROVIDER_KINDS, SSO_ENV_LIST, SSO_ENV_PREFIX, AUTH_POLICY_MESSAGES,
};
