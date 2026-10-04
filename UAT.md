# DealForge MVP — UAT Script & Sign-off (E11)

This is the executable UAT pack for the MVP release. It maps the seven acceptance
journeys in the release plan (§4) to assertions that run against a live stack, so a
UAT session produces evidence rather than prose. The plan's release criterion §10.2
('J1–J7 pass in UAT with Sirius present') is satisfied only when the harness is green
**and** the sign-off block at the foot of this file is countersigned.

## Running the pack

Start the stack (`docker compose up -d --build`) and run:

```sh
BASE_URL=http://localhost:34000 node --test server/tests/uat.test.js
```

The suite walks J1–J7 against the API the SPA uses, asserts each acceptance point,
and prints a sign-off table:

```
  DealForge MVP - UAT sign-off script (plan §4, release criteria §10.2)
  --------------------------------------------------------------------------------------------------------
  J   Journey                                   Result   Evidence
  --------------------------------------------------------------------------------------------------------
  J1  Subsidiary submits a real opportunity     PASS     state=submission - CFO signature captured - ga
  ...
  --------------------------------------------------------------------------------------------------------
  J1-J7 all PASS - MVP release criteria §10.2 met
```

A red row is the defect ticket for triage; the journey identifier (J1–J7) is the key
used in the exit log below. The pack is idempotent and safe to re-run; it creates its
own records and does not mutate seeded demo data.

## Journey scripts

| # | Journey | Steps (as executed) | Expected result | Automated check |
|---|---------|---------------------|-----------------|-----------------|
| **J1** | Subsidiary submits a real opportunity | Deal lead creates an opportunity → uploads business plan, financials and cap table → gate reports complete → route applied → Prepare action → CEO/CFO **Sign** → submit | Opportunity in `submission`, gate complete, signature captured with signer identity and time, audited | `[J1]` |
| **J2** | Raw idea is blocked | Deal lead captures an idea with no documents and submits | `422` with a precise missing list; record stays `draft`; `submit_blocked` on the audit log | `[J2]` |
| **J3** | Theme alignment / exception | Deal lead submits a clearly off-theme item → alignment flags it → a token reason is rejected → a reasoned exception is recorded | Flagged `aligned=false` with reasons; token reason `400`; reasoned exception accepted and audited | `[J3]` |
| **J4** | Sirius screens and clarifies | Reviewer transitions the item to `screening` → opens a thread requiring a response → subsidiary is notified | Thread open, subsidiary notified, state remains `screening` until resolved | `[J4]` |
| **J5** | Refinement → leadership → IC | Reviewer completes refinement → leadership (Fahad/AJ) approves → IC is asked with no rationale (rejected) → IC approves with rationale → a separate item is returned for revision | Each decision advances/returns the state with actor and timestamp on the workflow events; IC demands a rationale; a return drops the item to `returned` | `[J5]` |
| **J6** | Sibling privacy holds | A Subsidiary-B user calls the opportunity, documents, alignment, threads, route-events and related-party endpoints for a Subsidiary-A item; the object-store gateway is probed when ObjectIO is wired | Denied (`403`) at every layer; each attempt written to the audit trail | `[J6]` |
| **J7** | Audit proves the trail | Admin opens the audit view for the J1 opportunity and attempts to tamper with a row | Every action (who/what/when) present; rows immutable | `[J7]` |

## Coverage against the QA strategy (plan §11)

| Layer | Where it is exercised |
|-------|-----------------------|
| Unit / integration | `server/tests/m1`–`m6` — RBAC, gate logic, themes, workflow state machine, Q&A, notifications, hardening |
| E2E (API) | `server/tests/uat.test.js` (this pack) — J1–J7 |
| Privacy (adversarial) | `m1`–`m6` negative tests plus the J6 probes in this pack |
| Audit | J2 (blocked submit), J7 (trail + immutability), and route/gate/theme assertions across the suite |
| Regression | The full server suite runs green on every merge: `BASE_URL=... npm run test:server` |

## Defect triage & exit log (E11.2)

Defects are classified Sev-1 (release-blocking: data loss, privacy breach, core journey
cannot complete), Sev-2 (journey completes but with a significant wrong behaviour),
Sev-3 (cosmetic or minor). The release gate is **no open Sev-1/Sev-2** (plan §10.8).

| ID | Sev | Journey | Description | Raised | Status | Fix / commit |
|----|-----|---------|-------------|--------|--------|--------------|
| — | — | — | No open Sev-1 or Sev-2 defects at sign-off. | — | — | — |

All Sev-3 items, if any, are recorded here with an owner and a target iteration; none
block the release.

## Pre-UAT checklist

- [ ] Stack built and healthy: `curl -s $BASE_URL/api/health` returns `status: ok`.
- [ ] Demo data present: `SEED_DEMO_DATA=1` on first boot, or accept a fresh seed.
- [ ] Sirius participants nominated (plan §16, open decision 8) and able to reach the portal.
- [ ] ObjectIO wired for the storage-layer privacy check in J6 (optional; the other layers run regardless).
- [ ] `BASE_URL=$BASE_URL npm run test:server` green immediately before the session.

## Sign-off

| Role | Name | Scope | Date | Signature |
|------|------|-------|------|-----------|
| Sirius product owner | _pending_ | J1–J7 accepted, release criteria §10 met | | |
| Sirius investment team | _pending_ | Screening / approval journeys accepted | | |
| Engineering | _pending_ | Harness executed, evidence attached | | |
| QA | _pending_ | Defect exit log clear | | |

> Per plan §14 (RACI), UAT scripts and sign-off are **A** (Sirius PO) with the
> investment team **R**. This document is the evidence artefact for that sign-off.

