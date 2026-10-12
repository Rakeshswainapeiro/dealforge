# Security & platform backlog — DealForge

Found during the local platform setup (2026-10-12). Fixed items are listed for the record.

## Fixed

- Public sign-up was open and every new user received the Better Auth `admin` role (could impersonate users). Sign-up disabled; new users default to `user`; all existing users demoted.
- Docker ports were bound to all interfaces; now `127.0.0.1` only.
- Single sign-on via one "Sign in with Microsoft" button (local Keycloak stands in for Entra); password login kept as break-glass only.

## Open

| # | Item | Why it matters | Priority |
|---|---|---|---|
| 1 | Tests run against the dev database and give different results per run | No reliable safety net; tests pollute dev data | High |
| 2 | Account linking matches by email | Emails can change; production should link by Entra `oid` | High (before Entra) |
| 3 | Sign-in requests `offline_access`; long-lived refresh tokens stored per user | Unneeded sensitive credential at rest | Medium |
| 4 | SSO client secrets stored in plain text in `ssoProvider` | DB or backup read exposes the IdP secret; use env/vault or certificate credentials | Medium |
| 5 | `domainVerified` column added by hand | Fresh databases will lack it; add to the auth migration | Medium |
| 6 | App runs as database owner | Runtime should use `dealforge_app`; migrations as `dealforge_owner` | Medium |
| 7 | OpenAI, Resend, Coneshare send data outside the UAE | Data-residency decision needed from Sirius | High (before real data) |
| 8 | Password login available to all users | Restrict to the break-glass admin with MFA in production | High (before production) |
| 9 | `BETTER_AUTH_SECRET` was shared in chat | Rotate before any shared environment | Before sharing |