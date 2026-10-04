# DealForge — Existing Systems / Integration Review (W9-08 / BRD INTG-02)

Status: **drafted; awaiting Sirius discovery workshop sign-off.** This document
inventories every external system the DealForge MVP actually talks to, read
directly from the code rather than from memory, so the integration points can be
agreed with Sirius IT before go-live. The "Discussed / agreed" column stays
open until that workshop happens; that is why INTG-02 is `Process`, not `Built`.

## Method

Every entry below was found by reading the running server code (the env vars it
consumes and the modules that issue the outbound call). Integration points are
grouped by direction: **outbound** (DealForge calls them), **inbound** (they
call DealForge) and **platform** (infrastructure the deployment needs).

| # | System | Role | Direction | Config | Module | Current state |
|---|---|---|---|---|---|---|
| 1 | Postgres | Primary datastore (metadata, audit) | platform | `DATABASE_URL`, `PGSSLMODE`, `PGCONNECT_TIMEOUT` | `server/db.js` | In use; sovereign-region instance required (NFR-01) |
| 2 | Object storage (S3) | Document bytes / evidence files | platform | `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL` | `server/storage.js` | Falls back to local filesystem when `S3_ENDPOINT` is unset |
| 3 | AI model (OpenAI-compatible) | Extraction / deal analysis | outbound | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | `server/integrations.js` | Unconfigured by default; refuses until set (AI governance W9-01) |
| 4 | Email transport (Resend) | Notification delivery (email) | outbound | `NOTIFY_BASE_URL`, `NOTIFY_DELIVERY` | `server/notify.js`, `server/integrations.js` | Log-only until a key is present (`/send-email`) |
| 5 | SMS gateway | Notification delivery (SMS) | outbound | `NOTIFY_DELIVERY` (+ provider TBD) | `server/integrations.js` (`/send-sms`) | Log-only; no provider wired — **open** |
| 6 | Data-room (ConeShare) | Linked data room for an opportunity | outbound | `CONESHARE_BASE_URL`, `CONESHARE_API_KEY`, `CONESHARE_API_PATH`, `CONESHARE_TIMEOUT_MS` | `server/dataroom.js` | Disabled until configured; link-only mode available |
| 7 | Antivirus scanner | Upload virus scan | outbound | `DOCUMENT_SCAN_COMMAND` | `server/config/documentPolicy.js` | Builtin signature scan (EICAR); external command optional — **engine TBD** |
| 8 | Identity provider (SSO) | OIDC/SAML login, MFA | outbound | `AUTH0_*`, `OKTA_*`, `KEYCLOAK_*`, `MS_*` and other provider vars | `server/auth.js`, `server/config/authPolicy.js` | Better Auth configured; provider to be chosen with Sirius — **open** |

## Notes by area

**Storage.** `server/storage.js` selects object storage when `S3_ENDPOINT` is
set and otherwise writes to the local disk (`UPLOAD_DIR`). The demo stack runs
in local mode; production must point `S3_REGION` at an approved UAE region to
satisfy NFR-01.

**AI.** The model endpoint is configurable (`OPENAI_BASE_URL`) so a self-hosted
in-boundary model can replace a hosted one. The AI governance layer (W9-01)
refuses an unapproved provider before the outbound call and logs a redacted row,
so this integration is already gated.

**Notifications.** The durable record is a database row per recipient per
channel; email transport uses Resend when a key is present and SMS is logged
only. The SMS provider is the one notification channel with no concrete backend
— it must be chosen (e.g. a UAE aggregator) and agreed with Sirius.

**Data room.** ConeShare is modelled as a link-only integration: the opportunity
record stores a URL validated by policy, and the deeper API path is optional and
disabled unless configured.

**Antivirus.** `server/config/documentPolicy.js` ships a dependency-free builtin
scanner (EICAR test string plus embedded-executable heuristics) and can shell
out to an operator-configured command. The external engine identity is an open
item for the security review.

**Identity / SSO.** Better Auth is the auth layer and supports OIDC and SAML
providers with an MFA plugin. The provider choice (Auth0 / Okta / Keycloak /
Entra ID) and the tenant mapping are to be agreed with Sirius IT; the platform
is provider-agnostic today.

## Open items for the Sirius discovery workshop

1. Choose the SMS gateway and confirm it is UAE-hosted (NFR-01).
2. Choose the SSO provider and confirm the tenant/domain mapping.
3. Confirm the object-storage region and bucket policy (NFR-01).
4. Confirm the antivirus engine and whether it runs in-boundary.
5. Confirm whether ConeShare is in scope for the pilot or link-only.

Once Sirius signs these off, this document is marked agreed and INTG-02 moves
from `Process` to `Built`.
