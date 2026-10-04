# DealForge — MVP sample data map

This is the delivered state for backlog tasks **W1-11** (clean sample data) and **W1-12** (MVP sample mapping). It defines the deterministic, representative data the MVP demo and UAT run on, and the single command that loads it. It replaced the previous ad-hoc demo set in `server/demoData.js` (generic "Demonstration Opportunity" rows, now removed) with fixtures derived from real Sirius subsidiary data and the nature-of-business map.

## Principles

Every fixture is derived from a source in the repository, not hand-invented: the Sirius organisation tree (`src/data/siriusOrgTree.js`, auto-generated from the Q2 2026 subsidiary register), the nature-of-business map (`server/config/natureOfBusiness.js`), and the intake model (`server/config/intakeConfig.js`). Every record carries a `seed` marker and a `seed_manifest` audit event so the whole set can be wiped and re-loaded idempotently (W1-11). Each persona journey in `docs/UAT_Validation_DealForge.docx` maps to exactly one named fixture below, so a screenshot taken for a journey always points at the same record.

### Clean slate (2026-09-27)

Both databases now hold Sirius-only data. The fictional ad-hoc set that used to
live in `src/data/sampleData.js` (NovaCloud Systems, Apex Semiconductor,
MedVantage Health and the ~78 records around them) has been deleted, along with
the `api._local` "Sample Data" tab in Settings that loaded it. Entity data now
comes only from the server seed profiles below. The development stack
(`dealforge-db-1`, port 34001) and the UAT demo stack (`dealforge-demo`, port
34010) were both dropped to zero and re-seeded with `SEED_PROFILE=mvp`: the
Sirius org subtree (150 organisations), the seeded cast (13 users), the app
configuration, and the 24 MVP fixtures in the table below. A full load is
`node server/seedCli.js --profile=mvp` (the `server/seed.js` comment in the CLI
header is stale; the entry point is `server/seedCli.js`).

## Tenancy and identity

Better Auth organisation is the tenant (commit `58984d2`). The seed creates three organisations from the Sirius tree — Sirius International Holding Limited (platform), Infinia Technologies Limited (pilot subsidiary) and Finstreet Limited (second subsidiary) — and one membership per persona with the role that persona's journey exercises. Default password for every seeded user is `DealForge!2026`; the admin account is `admin@dealforge.local`.

| Persona (role) | User | Tenant | Roles |
|---|---|---|---|
| Subsidiary preparer | `deal.lead@infinia.local` | Infinia | `subsidiary_deal_lead` |
| Subsidiary CFO | `cfo@infinia.local` | Infinia | `subsidiary_cfo` (can sign) |
| Subsidiary CEO | `ceo@infinia.local` | Infinia | `subsidiary_ceo` (can sign) |
| Sirius deal lead | `deal.lead@sirius.local` | Sirius | `sirius_deal_lead` |
| Vertical Head | `vertical.head@sirius.local` | Sirius | `sirius_vertical_head` |
| Cluster Head | `cluster.head@sirius.local` | Sirius | `cluster_head`, `opco_signatory` |
| CIO | `cio@sirius.local` | Sirius | `cio` |
| Independent Reviewer | `reviewer@sirius.local` | Sirius | `independent_reviewer` |
| Leadership / IC | `fahad@sirius.local`, `ic.member@sirius.local` | Sirius | `leadership`, `ic_member` |
| System Admin | `admin@dealforge.local` | Sirius | `admin` |

## Fixtures

Each row is a fully-worked opportunity with the six-section Opportunity Overview populated from `intakeConfig.js`, so the same record exercises the form, the completeness gate, the screening panel and the memo. Sector and geography are taken from the target subsidiary's registered activities and country rather than being typed in.

| Fixture | Persona journey | Target entity (source) | Sector / geography (derived) | State | Purpose |
|---|---|---|---|---|---|
| `seed-inf-vision` | Subsidiary preparer — happy path | A Sirius healthcare-imaging subsidiary (tree `principal_activities`) | Healthcare / UAE, GCC | Draft complete → submitted | Every section filled; memo generates; UAT pass case |
| `seed-inf-blocked-docs` | Subsidiary preparer — blocked | Same as above | Healthcare / UAE | Draft | Missing financials + cap table; reproduces DOC-03 block |
| `seed-out-of-appetite` | Subsidiary preparer — stopped | n/a | n/a | Self-screen stop | Outside-appetite type; reproduces INT-02 stop message |
| `seed-below-floor` | Subsidiary preparer — exception | Infinia bolt-on candidate | Technology / UAE | Draft with exception | Below AED 10mn with synergy + IRR 35% exception; INT-03 |
| `seed-below-floor-incomplete` | Subsidiary preparer — exception blocked | Infinia bolt-on candidate | Financial Services / UAE | Draft, submit blocked | Below AED 10mn with the exception chosen but no synergy statement and IRR 31%; the submit route refuses it (INT-03) |
| `seed-greenfield` | Subsidiary preparer — greenfield | New venture under Infinia | Energy / UAE | Draft | Concept stage with a named, secured funding source; clears the INT-10 extra tests (Concept needs only the concept note) |
| `seed-greenfield-unfunded` | Subsidiary preparer — greenfield blocked | New venture under Infinia | Energy / UAE | Draft, submit blocked | Feasibility stage with unsecured (indicative) funding and no secured source; the submit route refuses it with the greenfield message (INT-10) |
| `seed-related-party` | Independent Reviewer — sign-off | IHC-affiliated referral | Financial Services / UAE | Awaiting sign-off | Sourcing channel `ihc_affiliate_referral`; auto related-party flag; WF-06 |
| `seed-banker-led` | Subsidiary preparer — sourcing side-effect | Infinia bolt-on candidate | Technology / UAE | Draft | Sourcing channel `banker_advisor`; compressed-timeline indicator auto-set; INT-05 |
| `seed-withdraw-demo` | Subsidiary preparer — withdraw | Cedar Point Industrial Services LLC | Industrials / UAE | Submitted (withdrawable) | A live submission kept aside so the withdraw-with-reason flow can be demonstrated and captured; the withdrawn item stays in history with its reason (INT-13) |
| `seed-in-screening` | Investment Analyst — screen/score | Infinia target | Technology / UAE | In screening | Gate 1 filters + scorecard inputs present |
| `seed-duplicate-finstreet` | Investment Analyst — duplicate warning | Finstreet target | Technology / UAE | In screening | Same target (`Emircom Cloud Services`) as `seed-in-screening` from a sibling subsidiary; drives the Investment-Team duplicate warning with link/dismiss while keeping subsidiary isolation (INT-12) |
| `seed-theme-exception` | Analyst — theme exception | Subsidiary outside its derived theme | Industrials / Saudi Arabia | In screening | Alignment "Not aligned" with rationale; SCR-02 negative case |
| `seed-conflict` | Analyst — portfolio conflict | Competitor of a portfolio holding | Telecommunications / UAE | In screening | Concentration/conflict flag; SCR-07 |
| `seed-leadership` | Leadership/IC — route | Finstreet target | Financial Services / UAE | Awaiting leadership → IC | Stage routing; J5/J6 |
| `seed-qualifying-no` | Subsidiary preparer — qualifying gate blocked | Infinia bolt-on candidate | Industrials / UAE | Draft, submit blocked | AED 65mn, accretive gate answered No; the submit route refuses it with the qualifying-gate block message (INT-08) |
| `seed-attestation-missing` | Subsidiary preparer — attestation blocked | Infinia bolt-on candidate | Industrials / UAE | Draft, submit blocked | AED 95mn and otherwise complete, but neither the CEO nor the CFO attestation is recorded; the submit route refuses it with the attestation block message (INT-09) |

The portfolio register fixture (W4-01) is loaded from the same subsidiary tree with cluster, sector, geography and capability tags, so the conflict and synergy checks in screening have real data to work against.

## Structured load path

All fixtures load through one entry point — `seed({ profile: 'mvp' })` — instead of the current `seedDemoData` boolean. Profiles: `base` (orgs, users, memberships, roles — always safe), `mvp` (base plus the fixtures above and the portfolio register), `off` (nothing). `SEED_DEMO_DATA=false` maps to `off` and leaves zero seeded rows. Cleanup runs `seed --clean` first and removes every row carrying the `seed` marker plus its uploaded document bytes, so a re-run is idempotent.

## Evidence

Each fixture's acceptance screenshot lands under `docs/evidence/W1-12/` and per-journey screenshots under `docs/evidence/<TODO-ID>/`. See `docs/evidence/README.md` for the naming and capture convention.
