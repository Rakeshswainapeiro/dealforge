# DealForge — Production configuration (Phase 1)

The server refuses to start in production (`NODE_ENV=production`) when any of
the rules below is broken. Outside production the same checks print warnings.

## Required settings

| Setting | Rule |
| --- | --- |
| `BETTER_AUTH_SECRET` | At least 32 characters, never a value published in this repository (`openssl rand -base64 32`). |
| `PUBLIC_BASE_URL` | The https address users open, e.g. `https://dealforge.sirius.ae`. |
| `SEED_PROFILE` | `base` (organisation tree, configuration, named cast) or `off`. `mvp` sample data is refused. |
| `DEFAULT_USER_PASSWORD` | Required unless `SEED_PROFILE=off`: a private value of at least 14 characters for the seeded cast's first sign-in. |
| `TRUST_PROXY` | Number of proxy hops in front of the app (default `1`). `true` is refused because it lets a client forge its address. |
| `AUTH_ALLOW_HEADER_IDENTITY`, `ADMIN_ALLOW_HEADER_AUTH`, `RATE_LIMIT_DISABLED`, `MFA_ENFORCE=0` | Test-only switches; refused. |

## Multi-factor authentication (PLT-04)

In production a second factor is always enforced for administrators, whatever
the stored policy says (`required_all` in Settings › Security extends it to
everyone). Users who sign in through the corporate identity provider (Entra ID
SSO) get their second factor there; the in-app authenticator applies to
password sign-ins. Sign-in and enrolment routes stay reachable so a user can
enrol before being let in.

## Data residency (NFR-01)

Every external processor must be pinned to an approved region (`me-central-1`,
`me-central-2`, `uae`, `ae`):

| Processor | Setting |
| --- | --- |
| Object storage | `S3_REGION` |
| AI model endpoint | `OPENAI_BASE_URL` with `DATA_RESIDENCY_REGION` |
| Email relay | `SMTP_HOST` with `DATA_RESIDENCY_REGION` |

If one cannot be pinned, Sirius IT signs off and the operator sets
`RESIDENCY_SIGNOFF=1`; otherwise the server will not start.

## Email (NTF-01)

`SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` for 465), `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM`. STARTTLS is required on 587. Without `SMTP_HOST`
mail is logged in `email_logs` and not sent. Settings › Email shows the relay
in use (no secrets) and sends an administrator test message.

## Database: least privilege (NFR-02)

Two roles: the owner holds the schema and runs migrations; the application role
reads and writes rows only and cannot change the schema or rewrite the audit
trail.

1. As a superuser, run `deploy/db/least_privilege.sql` (change the passwords).
2. As the owner: `DATABASE_URL=postgres://dealforge_owner:…/dealforge APP_DB_ROLE=dealforge_app npm --prefix server run migrate`
3. Run the application with `DATABASE_URL=postgres://dealforge_app:…/dealforge` and `DB_MIGRATE_ON_BOOT=0`.

Re-run step 2 on every release before starting the new version. With
`DB_MIGRATE_ON_BOOT=0` the server only checks that the schema is current.

## Container

The image runs as the unprivileged `node` user, installs server dependencies
from the lockfile, keeps uploads in `/app/uploads` (mount a volume) and has a
`HEALTHCHECK` on `/api/health`.

## Files and uploads (DOC-02)

Uploads must match their extension (PDF, Office, image signatures; text files
may not contain binary or HTML). Every stored file is served only to a user who
can see the record it belongs to, as a download with `nosniff` and a sandbox
policy. Stored documents are opened through `/api/gate/documents/:id/download`.

## Headers

Every response carries a Content-Security-Policy (scripts from the app only),
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Cross-Origin-Opener-Policy`, `Permissions-Policy`, and in production
`Strict-Transport-Security`.

## Dependency audit

`npm audit --omit=dev` in `server/` (the runtime image) reports no known
vulnerabilities. The remaining advisories in the root package are in the
Tailwind / PostCSS build chain, which runs only at build time and is not
shipped.
