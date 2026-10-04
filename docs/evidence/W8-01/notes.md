# W8-01 - SSO (OIDC/SAML) + MFA with local accounts for externals (BRD PLT-04)

## What this delivers

Enterprise sign-in for Sirius staff, a second factor for privileged accounts,
and a governed escape hatch for external counterparties who have no corporate
identity provider.

- `server/config/authPolicyData.js` - vocabulary: MFA modes
  (off / optional / required for admins / required for all), provider kinds
  (OIDC, SAML), the `SSO_PROVIDERS` env var and the `SSO_` env prefix, and the
  audit actions.
- `server/config/authPolicy.js` - pure policy math: provider normalisation and
  validation, env-provider merge, secret redaction, effective-policy resolution,
  validation, diffing, and the MFA / local-domain / session predicates
  (`mfaRequiredForRoles`, `isLocalDomainAllowed`, `providerForDomain`,
  `sessionMfaSatisfied`).
- `server/authPolicy.js` - router at `/api/auth-policy`: read the effective
  policy, list providers, read policy history from the audit trail, and
  (admin-only, via `canConfigure`) save the policy and register / remove SSO
  providers. Every write is audited and persists to `AppSettings`.
- `server/auth.js` - Better Auth wired with the two-factor and SSO plugins, a
  before-hook that gates email/password sign-in against the local-domain
  allowlist, and after-hooks that audit sign-in, the MFA challenge, failed
  credentials and TOTP verification.
- `server/index.js` - an app-wide MFA-enforcement middleware: when
  `enforce_mfa` is on, an authenticated session whose roles require MFA but has
  no enrolled second factor is refused protected API routes (403
  `mfa_required`).
- `src/pages/SuperAdmin.jsx` - the **Security & SSO** tab: MFA mode, the
  enforcement switch, the signed-in viewer's own standing, the local-account
  domain allowlist and the SSO provider registry with an add / remove form.
- `src/pages/Login.jsx` - a "Sign in with SSO" entry point that resolves a work
  email to its registered provider and hands the browser to the IdP.

Providers can be configured at deploy time through `SSO_PROVIDERS` and
`SSO_*` environment variables, or at runtime by an administrator on the
Security tab; the effective policy merges both, with per-tenant overrides.

## How the acceptance criteria are met

- **SSO for staff** - registering an OIDC provider for a work domain makes
  `POST /api/auth/sign-in/sso` resolve that domain and return the IdP
  authorization URL; the Login screen exposes the same flow in the UI. Providers
  may skip OIDC discovery and declare explicit endpoints, so internal IdPs work
  without public discovery documents.
- **MFA for privileged accounts** - the default mode is *required for
  administrators*; an admin without a factor is flagged in the console and, once
  enforcement is switched on, blocked from protected routes. TOTP enrolment,
  verification and backup codes come from Better Auth's two-factor plugin.
- **Local accounts for externals** - the domain allowlist lets approved
  external domains hold password accounts while the enforcement switch refuses
  any unlisted domain at sign-in; this keeps counterparty access governed rather
  than open.
- **Audited** - policy changes, provider registration/removal, successful and
  failed sign-ins, and MFA challenges all land in the immutable audit trail, and
  the console surfaces the policy history.

## Evidence

1. `admin_auth_policy_mfa.png` - the Security & SSO tab: MFA mode (*required for
   administrators*), the enforcement switch, the viewer's own MFA standing and
   the local-account domain allowlist.
2. `admin_sso_provider_registry.png` - the SSO provider registry and the add
   form (provider id, domain, OIDC/SAML kind, issuer URL, client id / secret).
3. `admin_login_sso_button.png` - the sign-in screen with the "Sign in with SSO"
   button beside the password form.
