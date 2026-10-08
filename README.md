# DealForge

Developed by InfiniaTechLabs. Private repository: [InfiniaTechLabs/dealforge](https://github.com/InfiniaTechLabs/dealforge).

M&A analysis and investment-screening platform. Runs entirely on your own
machine or infrastructure with Docker — no third-party app backend required.

## Architecture

| Concern | Implementation |
| --- | --- |
| Entity data (Companies, Scenarios, Contacts, …) | **Postgres** via the server API; browser **localStorage** as offline/dev fallback |
| Auth | **Better Auth** sessions (email/password) with multi-tenant RBAC + ABAC; Better Auth organization = tenant |
| AI / integrations (LLM, file upload, email, SMS, images) | Local **Node/Express** API proxying an OpenAI-compatible provider |
| Object storage (documents, evidence, generated images) | **ObjectIO / S3** when `S3_ENDPOINT` is set, local disk otherwise |
| Data room / secure sharing | External **Coneshare** service over its REST API (optional) |
| Backend persistence | **Postgres** (uploads + integration audit logs) |

Feature code talks to a single client facade, `src/api/client.js`, with
`api.entities` / `api.auth` / `api.integrations.Core` / `api.appLogs`. All
components import it from `@/api/client`, so the persistence layer can move
without touching feature code.

## Authentication & access control

DealForge uses **Better Auth** for identity. Every seeded application user is
migrated into a Better Auth account with a founding credential, so the users
that already exist (e.g. `admin@dealforge.local`) can sign in with
`DEFAULT_USER_PASSWORD` (default `DealForge!2026`). Sessions are cookie-based and last 7
days; the SPA gates every route behind a live session and shows the login screen
otherwise.

- **Tenant** — a Better Auth **organization** is the tenant. The existing Sirius
  org tree (`organization` / `app_user` / `membership`) remains the RBAC source of
  truth and is mirrored into Better Auth (org/member/user/account) on boot,
  idempotently.
- **RBAC** — roles come from the Sirius membership records (a user can hold
  several), enforced server-side.
- **ABAC** — attribute-based policies live in `abac_policy` and are evaluated on
  read paths. Policies match actor/resource attributes (organisation,
  geography/region, sector/industry, commitment size, related-party and flag
  attributes) and are managed through `GET/POST/DELETE /api/abac/policies` and
  previewed with `GET /api/abac/check`. Administrators and cross-org readers
  (`sirius_deal_lead`, `sirius_vertical_head`, `leadership`, `cio`, `ic_member`, `board_member`,
  `group_compliance`) short-circuit to allow.

Key endpoints: `/api/auth/*` (Better Auth: sign-in, sign-out, get-session,
organization, admin), `/api/org/*` (memberships, users, access grants) and
 `/api/abac/*` (policies). Set `BETTER_AUTH_SECRET` in production.

### Super-admin console

The **Super Admin** page (`/SuperAdmin`, admin role only, nav: *Super Admin*)
is the operator surface for identity and tenancy. It is backed by
`/api/admin/*` (`server/admin.js`), which requires a live Better Auth session
**and** the `admin` role on every route. Test-only header identity is not
honoured here unless both `AUTH_ALLOW_HEADER_IDENTITY=1` and
`ADMIN_ALLOW_HEADER_AUTH=1` are set (local tooling only; refused in production).

- **Overview** — user / tenant / membership / grant counts, role distribution
  and a recent-activity feed.
- **Users** — search, create (app user + Better Auth identity + first org
  mapping), edit profile, set/reset password (revokes sessions), ban/unban
  (revokes sessions) and soft-deactivate.
- **Tenancy Map** — every user × organisation assignment rendered by
  organisation or by user, with role badges, primary flag and cross-org grant
  flags.
- **Access Grants** — grant and revoke cross-organisation exceptions
  (`read`/`write`/`sign`) with a reason.
- **Audit** — the identity/RBAC slice of the immutable audit trail.

Every mutation is written to `audit_event`. The console is togglable as the
`SuperAdmin` page key (part of the *Admin Tools* feature group).

## Feature flags (deployment-time module control)

The app ships many modules; a deployment may not want all of them. Pages can be
switched on or off as **groups**, either at deployment time or at runtime by an
administrator (Settings). Resolution order (later wins):

1. built-in defaults (`server/config/featureFlags.js` — everything on)
2. runtime overrides persisted in AppSettings (`feature_flags`), admin-editable
3. `FEATURE_FLAGS` env var (deployment-time, highest precedence)

`FEATURE_FLAGS` is a comma-separated list of page keys: a bare key forces that
page on, a `-pageKey` forces it off, and listing any bare key makes the list
authoritative (only listed pages stay on), so prefer the admin screen for
switching a single page on. Curated groups (Deal Pipeline, Reporting,
Organisation & Themes, Admin Tools, Later phase) let an admin flip a whole area
at once in **Settings > Feature Visibility**. The client reads `/api/features`
and hides disabled routes and menu entries.

### Phase 1 screen scope

Screens follow DealForge_Phase1_BRD_v2. Later-phase screens are in the code but
**off by default**: Due Diligence (WF-09, Phase 2) and Portfolios (DSH-05,
Phase 4). Screens from the generic M&A application with no Phase 1 requirement
(Companies, Scenarios, Merger Simulator, Market Analysis, Analytics,
Recommendations, Deal Pipeline, CRM, legacy User Management) were removed. The
Dashboard is out of the menu and is kept only as the PLT-06 RTL demonstration
screen. `server/tests/phase1Scope.test.js` guards this scope and keeps the
server and browser feature defaults identical.

## Run with Docker (recommended)

```bash
git clone https://github.com/InfiniaTechLabs/dealforge.git
cd dealforge
cp .env.example .env      # then set OPENAI_API_KEY (and OPENAI_BASE_URL for non-OpenAI)
docker compose up --build
```

Open <http://localhost:3001>.

- `app` — Express server + built SPA, and the integration API
- `db` — Postgres 16 (uploads metadata + LLM/email/SMS/image logs)
- Uploaded files persist in the `uploads` Docker volume
- Postgres data persists in the `pgdata` Docker volume

AI features require `OPENAI_BASE_URL` + `OPENAI_API_KEY`. Point `OPENAI_BASE_URL`
at any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, Groq, Together,
LM Studio, Ollama at `http://host.docker.internal:11434/v1`, …). Without it, the
UI still works; AI calls return a clear "backend not configured" error.

## Object storage (ObjectIO / S3)

Uploads and generated images are stored on the **local filesystem by default**.
Set `S3_ENDPOINT` (plus access keys) to store them in **ObjectIO** — or any
S3-compatible service (MinIO, Cloudflare R2, AWS S3), since ObjectIO exposes a
wire-compatible S3 API and DealForge uses the S3 SDK.

The server creates the bucket on startup if it is missing. Files are served
through `/api/files/<key>` — a single authenticated choke point that streams
from the object store (range requests supported; `?download=1` forces a
download). Uploads return that app-relative URL, so frontend and AI extraction
keep working unchanged.

To run ObjectIO locally alongside DealForge:

```bash
# 1. start ObjectIO and read the admin keys it prints on first boot
docker compose -f docker-compose.yml -f docker-compose.objectio.yml up -d objectio
docker compose -f docker-compose.yml -f docker-compose.objectio.yml logs objectio \
  | grep -E "Admin (access|secret) key"

# 2. put them in .env, then start the stack
#    S3_ENDPOINT=http://objectio:9000
#    S3_ACCESS_KEY_ID=AKIA...
#    S3_SECRET_ACCESS_KEY=...
docker compose -f docker-compose.yml -f docker-compose.objectio.yml up -d
```

Prefer running ObjectIO on the host? Grab the `objectio-aio` binary and run
`objectio-aio --data ~/objectio-data --auth`, then point a Dockerised DealForge
at `S3_ENDPOINT=http://host.docker.internal:9000`.

Direct-to-storage presigned URLs are available for large uploads:
`POST /api/integrations/presign-upload` and `POST /api/integrations/presign-download`.

## Data room (Coneshare)

DealForge integrates an external data room **as a service over its REST API** —
it never forks or re-implements Coneshare (see
`docs/DealForge_Storage_and_Dataroom_Reuse_Analysis.md`). Set `CONESHARE_BASE_URL`
and `CONESHARE_API_KEY` to enable it. DealForge owns the investment workflow,
gates and entities; Coneshare owns secure rooms, share links, NDA, watermarking,
page analytics and viewer Q&A.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/dataroom/health` | Connectivity + data-room count |
| `GET /api/dataroom/datarooms` | List rooms |
| `POST /api/dataroom/datarooms` | Create a room |
| `POST /api/dataroom/share-links` | Create a secure share link |
| `GET /api/dataroom/datarooms/:id/visits` | Room engagement analytics |

## Local development (no Docker)

```bash
# 1. Postgres (or point DATABASE_URL at an existing instance)
docker compose up -d db

# 2. Backend API on :3001
cd server && npm install && DATABASE_URL=postgres://dealforge:dealforge@localhost:5432/dealforge npm run dev

# 3. Frontend on :5173 (proxies /api and /uploads to :3001)
npm install
npm run dev
```

## Access control: deny by default

Every `/api` route requires a signed-in user (Better Auth session) except a
short public list in `server/config/identityPolicy.js`: `/api/health`,
`/api/auth/*`, `GET /api/memo-verification/verify` (QR scans) and
`GET /api/i18n`. Anonymous requests get `401`. Local uploads under `/uploads`
also require a session. In production the server refuses to start with a
missing or default `BETTER_AUTH_SECRET`, a non-https `PUBLIC_BASE_URL`, or any
test-only switch enabled.

## Running the server tests

The integration tests run against a live server and act as seeded users via
the `x-user-id` header, which is only honoured when explicitly enabled:

```bash
# terminal 1 - API with test identity enabled
cd server
AUTH_ALLOW_HEADER_IDENTITY=1 RATE_LIMIT_DISABLED=1 npm run dev

# terminal 2 - repo root
BASE_URL=http://localhost:3001 RATE_LIMIT_DISABLED=1 \
DATABASE_URL=postgres://dealforge:dealforge@localhost:34001/dealforge \
  node --test --test-concurrency=1 server/tests/*.test.js
```

`DATABASE_URL` lets `authDenyByDefault.test.js` start an isolated server with
header identity off to prove impersonation is refused; without it that part
is skipped.

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production frontend build
- `npm run lint` — ESLint
- `npm run server` — run the API server once built in `server/`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Session signing secret (required in production; `openssl rand -base64 32`) |
| `DEFAULT_USER_PASSWORD` | Password seeded for migrated app users so they can sign in (default `DealForge!2026`) |
| `AUTH_TRUSTED_ORIGINS` | Extra browser origins allowed to start a session (comma-separated) |
| `CORS_ALLOWED_ORIGINS` | Extra browser origins allowed by CORS (comma-separated); `PUBLIC_BASE_URL` is always allowed |
| `AUTH_ALLOW_HEADER_IDENTITY` | **Local testing only.** `1` lets tests act as users via `x-user-id` / `x-user-email`; refused in production. Default `0`: no session means 401 |
| `NODE_ENV` | `production` (image default) enables strict startup checks: real secret, https `PUBLIC_BASE_URL`, no test switches, no sample data, MFA enforced, data residency. See `docs/PRODUCTION.md`. Local compose files set `development` |
| `FEATURE_FLAGS` | Deployment-time feature/menu visibility (comma list of page keys; `-pageKey` disables) |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL, e.g. `https://api.openai.com/v1` |
| `OPENAI_API_KEY` | Provider API key |
| `OPENAI_MODEL` | Model name (default `gpt-4o-mini`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Email through the designated SMTP relay; without `SMTP_HOST` email is logged only |
| `TRUST_PROXY` | Proxy hops trusted for the client address (default 1 in production, loopback otherwise) |
| `DB_MIGRATE_ON_BOOT` | `0` when the app runs as the least-privilege role; run `npm --prefix server run migrate` as the owner instead |
| `RESIDENCY_SIGNOFF` | `1` only after Sirius IT signs off a processor that is not pinned to an approved region |
| `PUBLIC_BASE_URL` | Public URL used to build absolute upload links |
| `UPLOAD_DIR` | Where uploaded files are stored when object storage is off (default `./uploads`) |
| `S3_ENDPOINT` | ObjectIO/S3 endpoint (e.g. `http://objectio:9000`); empty = local disk |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials (ObjectIO admin keys) |
| `S3_BUCKET` | Bucket name (default `dealforge`, auto-created if missing) |
| `S3_REGION` / `S3_PREFIX` / `S3_FORCE_PATH_STYLE` / `S3_PUBLIC_BASE_URL` | S3 tuning |
| `CONESHARE_BASE_URL` / `CONESHARE_API_KEY` | External data-room service (optional) |
| `CONESHARE_API_PATH` | Coneshare API prefix (default `/api/v1`) |

## Entity data

Entity data lives in the browser, so it is per-browser and cleared by clearing
site data. Shapes are defined in `src/entities/*.json` for reference. To seed or
export data, use the in-app UI; there is no server-side entity database.

### Sample data

**Settings → Sample Data → Load Sample Data** seeds a realistic demo dataset
(Companies, Scenarios, Simulations, Deal Opportunities, Contacts, Acquirer
Profiles, Portfolios/Holdings, Due Diligence Checklists, Users, App Settings)
into localStorage. **Clear All Data** empties every store. The dataset is
defined in `src/data/sampleData.js` and can be seeded programmatically with
`api._local.seed(SAMPLE_DATA)`.
