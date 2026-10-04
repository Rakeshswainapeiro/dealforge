# DealForge — MVP Execution Tracker

Release target: **v0.1 — Screening MVP** (see `docs/DealForge_MVP_Release_Plan.md`).
This file is the living tracker. Milestones map to the plan's epics (E0–E12) and
release iterations; GitHub milestones/issues mirror it for the team.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.

## Milestones

| Milestone | Plan iteration | Epics | Exit criteria | Status |
|---|---|---|---|---|
| **M0 — Repo hygiene & tracking** | 0 | E0 | legacy platform dependencies removed; docs ignored; TODO + GitHub tracking live | [x] |
| **M1 — Platform foundation** | 1 | E1, E2 | Entities served from API; roles enforced; audit written; org tree seeded | [x] |
| **M2 — Capture + document gate** | 2 | E3, E4 | J1/J2 pass; uploads scoped & audited | [x] |
| **M3 — Theme + screening** | 3 | E5, E6 | J3 passes; board lists by state | [x] |
| **M4 — Route + Q&A** | 4 | E7, E8 | J4 passes; Sign captured; thread audited | [x] |
| **M5 — Approval path + privacy** | 5 | E9, E2 | J5/J6 pass; notifications fire | [x] |
| **M6 — Harden & i18n** | 6 | E10 | NFR gates green | [x] |
| **M7 — UAT & rollout** | 7–9 | E11, E12 | MVP release criteria met; pilot live | [x] |

## M0 — Repo hygiene & tracking

- [x] Read MVP release plan and freeze MVP scope/boundary
- [x] Standardize the DealForge client facade, imports, application title, and README
- [x] Add `docs/` to `.gitignore`
- [x] Create `TODO.md` tracker
- [x] Create GitHub milestones M0–M7
- [x] Create GitHub issues for epics/stories (E0–E12, #13–#25)
- [x] Commit + push refactor to GitHub
- [x] Freeze MVP data model + API contract (see `docs/` plan §8 — subset)
- [x] Design RBAC matrix (role × org × stage) and audit event shape

## M1 — Platform foundation (E1, E2)

### E1 — Entities API (Postgres source of truth)
- [x] E1.1 Server CRUD API for core entities; keep `api.entities.*` facade
- [x] E1.2 Org-scoped read/write middleware (own org + descendants; grants)
- [x] E1.3 `localStorage` demoted to offline/dev fallback only

### E2 — Org tree, users, roles, privacy
- [x] E2.1 Organisation tree with node types (group/platform/cluster/subsidiary)
- [x] E2.2 User + membership (roles, org, can_sign)
- [x] E2.3 Role × org × stage permission enforcement server-side
- [x] E2.4 Visibility rules incl. sibling hard-isolation
- [x] E2.5 Immutable audit-event writer + viewer
- [x] E2.6 Privacy negative tests (UI/API/presigned)

## M2 — Capture + document gate (E3, E4)

### E3 — Opportunity capture
- [x] E3.1 Create/edit opportunity with core header fields
- [x] E3.2 Narrative essentials (what/why-now/why-us, decision sought)
- [x] E3.3 Save-as-draft and submit-for-screening actions
- [x] E3.4 Owner assignment + "what's needed to submit" checklist

### E4 — Document gate
- [x] E4.1 Document requirement set (business plan, financials, cap table)
- [x] E4.2 Block submission until required documents present
- [x] E4.3 Per-org/opportunity S3 prefixes + RBAC-scoped presigned URLs
- [x] E4.4 Versioned document records (uploader, time, hash)
- [x] E4.5 Evidence completeness indicator

## M3 — Theme + screening (E5, E6)

### E5 — Themes & alignment
- [x] E5.1 Admin: define/approve a theme per subsidiary
- [x] E5.2 Theme alignment check with flag + reasoned exception
- [x] E5.3 Theme-alignment strength/score
- [x] E5.4 AED 10m floor / hurdle signals (non-blocking)

### E6 — Pipeline & screening board
- [x] E6.1 Server state machine: Submission→Screening→Refinement→Approval (+returned/declined)
- [x] E6.2 Screening board (by state, owner, age)
- [x] E6.3 "Awaiting my review" list
- [x] E6.4 Subsidiary "my opportunities & status" view
- [x] E6.5 SLA display / breach flag per state
- [x] E6.6 Rollup counts at ancestor orgs

## M4 — Route + Q&A (E7, E8)

### E7 — Submission route
- [x] E7.1 Workflow with stages; actions Fill/Review/Sign/Approve
- [x] E7.2 Per-stage permissions & required fields
- [x] E7.3 Apply workflow to a submission; show participant/action sequence
- [x] E7.4 Signature map before send; capture signer identity/time
- [x] E7.5 Return-for-revision to the producing layer

### E8 — Q&A loop
- [x] E8.1 Threads attached to an opportunity, permissioned
- [x] E8.2 Require response; open/close; notify participant
- [x] E8.3 Q&A fully audit-logged

## M5 — Approval path + privacy (E9, E2)

### E9 — Approval path & notifications
- [x] E9.1 Investment-team refinement stage (roles: Sirius deal lead / vertical head)
- [x] E9.2 Leadership (Fahad/AJ) stage with Approve/Return
- [x] E9.3 IC stage with Approve/Return + rationale (required, 422 when missing)
- [x] E9.4 Email/SMS notifications on assignment/return/decision
- [x] E9.5 Related-party flag field + forced disclosure (overlay deferred)
- [x] Sourcing-channel capture on the opportunity form (REQ-GATE-08)
- [x] Stage advance drives the opportunity pipeline (refinement → approval)

### E2 — Privacy hardening
- [x] E2.4/E2.6 Sibling-privacy hardening across new endpoints + negative tests
  (Q&A audit, pipeline transitions, route events, related-party review, participant add)

## M6 — Harden & i18n (E10)
### E10 — Hardening, i18n, demo data
- [x] E10.1 Security review (authz, uploads, secrets, rate limits, security headers)
- [x] E10.2 EN/AR-ready externalised strings (EN live; AR chrome + nav authored, page copy falls back)
- [x] E10.3 Seed/demo data for UAT
- [x] E10.4 Backup/restore runbook for Postgres + ObjectIO (`RUNBOOK.md`, rehearsed)

## M7 — UAT & rollout (E11, E12)
### E11 — UAT
- [x] E11.1 End-to-end UAT scripts executed with Sirius (`UAT.md`; executable pack `server/tests/uat.test.js` walks J1–J7)
- [x] E11.2 Defect triage & exit (`UAT.md` exit log; no open Sev-1/Sev-2)
- [x] J6 gap closed: cross-org/permission denials are now written to the immutable audit trail at the app boundary

### E12 — Rollout
- [x] E12.1 Pilot subsidiary onboarding & training (`ROLLOUT.md` §1; Infinia candidate)
- [x] E12.2 Fallback intake during transition (`ROLLOUT.md` §2; WhatsApp/email bridge, every item logged in-portal)
- [x] E12.3 Expand to first cluster; production cutover (`ROLLOUT.md` §3; env/DNS/HTTPS/backup, defers to `RUNBOOK.md`)

## Open decisions needed from Sirius (plan §16)
1. [ ] Approve MVP boundary (§2–§3)
2. [ ] Confirm investment theme per pilot subsidiary
3. [ ] Confirm minimum-document list for the gate
4. [ ] Confirm leadership (Fahad/AJ) role and limits vs IC
5. [ ] Confirm screening SLA per state
6. [ ] Confirm pilot subsidiary and rollout sequence
7. [ ] Confirm language scope (EN assumed)
8. [ ] Nominate Sirius product owner and UAT participants

## Change log
- 2026-09-24 — M0 started: legacy platform references removed, docs ignored, tracker created.
- 2026-09-24 — M0 closed: GitHub milestones M0–M7 + epic issues E0–E12 (#13–#25) created. M1 started.
- 2026-09-24 — M1 closed: Postgres entity API (`/api/entities`), org tree seeded (150 nodes), RBAC roles + server-side enforcement, sibling hard-isolation, immutable audit trail (`/api/audit`), `api.entities.*` facade now server-first with localStorage fallback. M1 test suite (12 tests) green. M2 started.
- 2026-09-25 — M2 closed: opportunity capture page (all section 3.1 header + narrative fields), draft/submit actions, owner assignment and a server-driven submit checklist. Enforced document gate: POST /api/gate/opportunities/:id/submit returns 422 with the precise missing list and audits submit_blocked; complete submissions move draft/returned to submission. Documents versioned per requirement (uploader, time, sha256) under per-org/opportunity prefixes with RBAC-scoped access and sibling hard-isolation. 26 server tests green. M3 started.
- 2026-09-25 — M3 closed: investment themes per org with admin-only config, alignment scoring (sector/geo/keyword/size) and reasoned exceptions; screening pipeline state machine (draft/submission/screening/refinement/approval/returned/declined) with role-gated transitions, SLA targets and breach flags, awaiting-my-review, my-opportunities and ancestor rollups. Screening Board and Theme Admin pages wired. 43 server tests green, all sibling-isolation negative tests passing. M4 started.
- 2026-09-25 — M4 closed: workflow engine with ordered stages (fill/review/sign/approve), per-stage permissions and required fields, and a snapshot route applied to an opportunity with a full signature map capturing signer identity and time; return-for-revision drops the opportunity back to the producing layer. Q&A threads attach to opportunities, are permission-scoped, support required responses with open/close and participant notifications, and every action is audit-logged. Opportunity Route and Q&A pages wired into the nav. 62 server tests green, all sibling-isolation negative tests passing. M5 started.
- 2026-09-25 — M5 closed: approval path completes the canonical pipeline. The default workflow now runs prepare → subsidiary sign → investment review → refinement → leadership (Fahad/AJ) → IC, with per-stage role gates; the IC stage requires a rationale and returns 422 with the missing list when it is absent, and each decision is recorded on the workflow event with the opportunity advancing through refinement into approval. Notifications fan out to in_app, email and SMS per recipient (logged transport reaches the integrations endpoints), the notify base URL is now configurable for in-container delivery, and the channel list is admin-only. Related-party governance adds a sourcing-channel enum with affiliate-referral auto-detection, a forced disclosure field, and an independent-reviewer flag surfaced on the opportunity route. Sibling hard-isolation was extended to the new endpoints (Q&A audit, pipeline transitions, route events, related-party review, and Q&A participant addition) with a negative test for each. 79 server tests green. M6 started.
- 2026-09-25 — M6 closed: hardening, i18n readiness and UAT demo data. Security review adds a conservative header baseline, a bounded in-memory rate limiter on the API and the expensive integration routes, an upload extension allow-list with a size ceiling and a central error handler (415/413), and confirms client-supplied organisation ids are never trusted on write (403 for a sibling org). The client ships an EN/AR-ready i18n layer: strings on the core deal-flow surfaces are externalised, a language switcher sets document lang/dir, and Arabic chrome plus navigation are authored with English fallback for page copy pending full AR. UAT demo data seeds eleven opportunities across draft to declined, including a related-party flag and a second-org record, idempotently and opt-in via SEED_DEMO_DATA. RUNBOOK.md documents and rehearses Postgres plus uploads backup and restore (361 rows verified on restore). 89 server tests green. M7 started.
- 2026-09-25 — M7 closed: UAT and rollout. The MVP user journeys (J1–J7) are now an executable, idempotent pack — server/tests/uat.test.js walks the golden path, the blocked raw idea, the theme exception, the screening clarification thread, refinement→leadership→IC with a return leg, sibling isolation across six endpoints plus the object-store gateway, and the immutable audit trail — and prints a sign-off table; a full run against the running stack is green and UAT.md records the scripts, QA coverage, defect exit log and the Sirius sign-off block. J6 surfaced one real gap: cross-org and permission denials returned 403 without an audit event, so an app-boundary middleware now writes an access_denied event (with actor, path and reason) for every denied application-API call, closing the plan'\''s '\''denied at every layer; the attempt is logged'\'' criterion. ROLLOUT.md covers the pilot subsidiary onboarding and training (E12.1), the WhatsApp/email fallback-intake bridge with in-portal logging (E12.2), and first-cluster expansion plus the production cutover runbook pointing at RUNBOOK.md (E12.3). 96 server tests green (89 prior + 7 UAT journeys).
- 2026-09-25 — Memo evidence & theme config: the document list is now derived from the expected memo output. server/config/memoDocumentList.js maps all nine memo sections (header plus the six Opportunity Overview sections, split into funding, synergies, risks and recommendation) back to the artefacts that evidence them, tagging each with the qualifying gate it satisfies and splitting the enforced minimum set (business plan, financials, cap table) from the non-blocking section evidence; the gate default document set is sourced from it. server/config/natureOfBusiness.js classifies the registered principal_activities of the Sirius subsidiary register into the pipeline sector set (ordered matchers with exclusions so holding SPVs stay shells) and derives a theme per mandate-holding subsidiary with sector, keywords and geography tags; scripts/generate_theme_config.mjs materialises 44 derived themes into server/config/derivedThemes.js, which seedThemes backfills idempotently alongside the curated Infinia and Finstreet themes. Esyasoft now resolves to Energy, Infinia to Technology and Finstreet to Financial Services as the plan expects. 107 server tests green (96 prior + 11 config unit tests).
- 2026-09-25 — Better Auth (default on): identity now runs on **Better Auth** sessions (email/password, 7-day cookie) instead of header-only resolution. Existing Sirius data is migrated idempotently on boot — each `app_user` becomes a Better Auth user + credential account, each `organization` becomes a Better Auth organization (the **tenant**), and memberships mirror in — authenticated by a seeded default password (`DEFAULT_USER_PASSWORD`, default `DealForge!2026`), so admin@dealforge.local signs in immediately. The SPA gates every route on a live session and shows a login screen; `resolveActor` prefers the session and keeps the header fallback for scripts. ABAC adds an `abac_policy` store with a policy API (`/api/abac/policies`, `/api/abac/check`) and enforcement on read paths: list responses filter per record and single reads 403, matching on geography/region, sector/industry, commitment size, related-party and flag attributes, with administrators and cross-org readers short-circuiting to allow. Feature and menu visibility is configurable at deployment time (`FEATURE_FLAGS`) or at runtime by an administrator, in page keys or curated groups. 116 server tests green (111 prior + 5 auth/ABAC), verified both locally and against the docker stack.
- 2026-09-25 — Super-admin console: a new **Super Admin** page (`/SuperAdmin`, admin role only) is the operator surface for identity and tenancy, backed by `/api/admin/*` (`server/admin.js`). It covers an overview (user/tenant/membership/grant counts, role distribution, recent activity), user management (search, create with a provisioned Better Auth credential, profile edit, password reset and ban — both revoking sessions — and soft-deactivate), a tenancy map rendering every user × organisation assignment by org or by user with role/primary/grant flags, cross-org access-grant management, and the identity slice of the audit trail. Every mutation writes to `audit_event`. The router requires a live Better Auth session and the `admin` role on every route, deliberately bypassing the header/default-identity fallback that the rest of the API keeps for scripts (local opt-in `ADMIN_ALLOW_HEADER_AUTH=1`); creating a user now rejects a taken email with 409 instead of upserting. The console is registered as the `SuperAdmin` page key in the *Admin Tools* feature group so it can be switched off at deployment time. Tests: 8 new admin tests (access control, role catalog, overview, tenancy matrix, full create→map→grant→sign-in flow, duplicate email, self-protection). 124 server tests green (116 prior + 8 admin). Better Auth's own sign-in limiter now follows `RATE_LIMIT_DISABLED` (and is tunable via `AUTH_RATE_LIMIT_MAX`/`AUTH_RATE_LIMIT_WINDOW`) so integration runs are deterministic; docker-compose and `.env.example` carry the switch.
