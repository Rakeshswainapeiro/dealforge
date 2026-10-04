# W9-08 — Existing systems review (BRD INTG-02)

Requirement: **INTG-02** — the existing-systems / integration review is written
up and the integration points are agreed before build.

## What was done

`docs/Existing_Systems_Review.md` inventories every external system the MVP
actually calls, read from the running code (the env vars each module consumes
and the module that issues the call) rather than from memory:

| # | System | Direction | Module | State |
|---|---|---|---|---|
| 1 | Postgres | platform | `server/db.js` | in use |
| 2 | Object storage (S3) | platform | `server/storage.js` | local fallback |
| 3 | AI model (OpenAI-compatible) | outbound | `server/integrations.js` | gated (W9-01) |
| 4 | Email (Resend) | outbound | `server/notify.js` | log-only |
| 5 | SMS gateway | outbound | `server/integrations.js` | **open** |
| 6 | Data room (ConeShare) | outbound | `server/dataroom.js` | disabled/link-only |
| 7 | Antivirus scanner | outbound | `server/config/documentPolicy.js` | engine **open** |
| 8 | Identity provider (SSO) | outbound | `server/auth.js`, `server/config/authPolicy.js` | provider **open** |

The document ends with five open items for the Sirius discovery workshop
(SMS gateway, SSO provider, storage region, AV engine, ConeShare scope).

## Why this row is Blocked

The write-up is complete, but INTG-02 also asks for the integration points to be
**agreed**. That agreement is a Sirius IT workshop, external to this repo. The
row is recorded as **Blocked** on that workshop; INTG-02 stays `Process`. No
agreement is claimed that has not happened.

## Evidence

- `docs/Existing_Systems_Review.md` — the review itself.
- This note.
