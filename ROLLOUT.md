# DealForge MVP — Rollout & Fallback Plan (E12)

The MVP is released to a pilot subsidiary, then expanded across the first cluster.
The three stories behind this document are E12.1 (pilot onboarding & training),
E12.2 (fallback intake during transition) and E12.3 (cluster expansion and
production cutover). It follows release-plan §12 and the RACI in §14.

## 1. Pilot subsidiary onboarding & training (E12.1)

The pilot is chosen by Sirius (open decision 6). **Infinia Technologies Limited** is
the working candidate: it already carries the Technology theme, seeded users and demo
data, and a full test suite exercises its journeys end to end.

### 1.1 Readiness checklist

- [ ] Sirius confirms the pilot subsidiary and names the deal lead, CFO and CEO participants.
- [ ] Participants seeded as `subsidiary_deal_lead`, `subsidiary_cfo` (can_sign) and `subsidiary_ceo` (can_sign).
- [ ] Investment theme for the pilot confirmed and approved (`PUT /api/themes` as admin) — open decision 2.
- [ ] Minimum-document set confirmed for the pilot (`/api/gate/requirements`) — open decision 3.
- [ ] Screening SLA per state confirmed (`/api/pipeline/states`) — open decision 5.
- [ ] Portal URL reachable from the subsidiary network; HTTPS enforced at the edge.
- [ ] Named support channel published (see §4).

### 1.2 Training

Two short, role-specific sessions, each recorded and linked from the support channel:

1. **Subsidiary session (deal lead, CFO, CEO)** — capture an opportunity, attach the
   mandatory documents, understand the 'what is needed to submit' checklist, the
   theme flag and exception path, the signature step, and where to answer a Sirius
   clarification in-thread. The one-page submission guide accompanies this session.
2. **Sirius session (deal leads, vertical heads, leadership, IC)** — the screening
   board, awaiting-my-review, refinement → leadership → IC, Approve/Return with a
   rationale, and reading the audit trail. The one-page screening guide accompanies it.

### 1.3 Dry run

Run the UAT pack against the pilot's configuration (see `UAT.md`) with the named
participants present, then run **one real opportunity** end to end with the deal lead
driving and engineering observing. The demo records (`demo: true`) are removed once
the real item is live:

```sh
# identify demo records
curl -s "$BASE_URL/api/entities/DealOpportunity?filter=%7B%22demo%22%3Atrue%7D" -H 'x-user-id: user-admin'
# then delete each returned id as its owning user / an admin
```

## 2. Fallback intake during transition (E12.2)

During transition, WhatsApp and email remain available **only as a bridge**. The rule
from plan §12 is absolute: *every fallback item is entered into the portal by the deal
lead so the audit trail stays complete.* The portal is the record; the message app is
only the doorbell.

### 2.1 Operating rules

| Step | Owner | Rule |
|------|-------|------|
| Idea arrives on WhatsApp/email | Deal lead | Acknowledge, then immediately capture it in DealForge as a draft opportunity with the **sourcing channel** set to the origin (e.g. `proprietary`, affiliate referral). |
| Response to Sirius | Deal lead | Route questions and answers into the in-portal Q&A thread; do not answer in email. |
| Weekly reconciliation | Sirius deal lead | Reconcile the fallback inbox against the portal queue; anything not on the board is flagged and back-entered with the original date noted in the comment. |
| Track leak | Product owner | Any item that reaches a screening decision without a portal record is a metric breach (`0%` tolerance, plan §13 metric 1) and is logged as a defect. |

### 2.2 What the fallback must never do

- Never let an idea reach a screening or approval decision outside the portal.
- Never hold the only copy of a required document outside DealForge.
- Never let a clarification thread live in email once the item is in screening.

### 2.3 Exit

Fallback intake is retired once the pilot has completed one full cycle in-portal and
the weekly reconciliation reports zero unlogged items for two consecutive weeks. The
endpoint `/api/related-party/channels` records the sourcing channel on each record, so
the reconciliation has a field to check against.

## 3. First-cluster expansion & production cutover (E12.3)

### 3.1 Cluster onboarding

- [ ] Sirius confirms the first cluster and its subsidiary sequence (open decision 6).
- [ ] Themes approved per subsidiary; the group theme inherited where none is defined.
- [ ] Users and memberships seeded per subsidiary; signatories flagged `can_sign`.
- [ ] Demo data seeded for a short walkthrough, then removed ahead of real use.
- [ ] Review queue consolidated at the cluster head; rollups verified (`/api/pipeline/rollup`).

### 3.2 Production cutover runbook

Environment and hosting follow the deploy artefacts in the repo (`docker-compose.yml`,
`Dockerfile`, `deploy/`). Before cutover:

- [ ] `NODE_ENV=production`, `SEED_DEMO_DATA` unset, secrets injected from the environment (never committed).
- [ ] `DATABASE_URL` points at the production Postgres; TLS required.
- [ ] `S3_*` (ObjectIO) configured for documents; bucket created; per-org prefixes in use.
- [ ] DNS and HTTPS terminated at the edge; `PUBLIC_BASE_URL` set to the public origin.
- [ ] `NOTIFY_BASE_URL` reachable so email/SMS delivery is attempted and logged.
- [ ] Backups scheduled and **rehearsed** per `RUNBOOK.md` (Postgres `pg_dump`/`pg_restore` + uploads volume, or S3 sync).
- [ ] Rate limits and upload ceiling reviewed for the production load (see `server/security.js`).
- [ ] `BASE_URL=$PRODUCTION_URL npm run test:server` green against the production stack.
- [ ] Rollback path confirmed: previous image tag retained; restore-from-backup rehearsed (see `RUNBOOK.md`).

### 3.3 Cutover sequence

1. Freeze fallback intake for the cutover window; freeze writes, take a labelled backup.
2. Deploy the release image; run the health check and the server suite against production.
3. Repoint DNS/HTTPS to the new stack; verify the portal loads and sign-in resolves an actor.
4. Announce to the cluster; run the first real submission with the cluster head watching.
5. Monitor the board and the audit trail for the first week; weekly triage per §4.

## 4. Support & comms (plan §12)

- **Support channel:** a named mailbox/Teams channel owned by engineering; weekly triage
  with the Sirius product owner; defect SLAs by severity (Sev-1 same day, Sev-2 next
  business day, Sev-3 next iteration).
- **Comms:** a short 'why the portal' note to subsidiary CEOs/CFOs, a one-page
  submission guide (subsidiary), and a one-page screening guide (Sirius).
- **Metrics:** tracked against the targets in plan §13; cross-subsidiary visibility and
  audit coverage are zero-tolerance.

## 5. Open decisions carried into rollout (plan §16)

These remain placeholders until Sirius confirms; each blocks a specific checklist item
above and is tracked in `TODO.md`.

| # | Decision | Blocks |
|---|----------|--------|
| 2 | Investment theme per pilot subsidiary | §1.1 theme confirmation |
| 3 | Minimum-document list for the gate | §1.1 document confirmation |
| 5 | Screening SLA per state | §1.1 SLA confirmation |
| 6 | Pilot subsidiary and rollout sequence | §1.1, §3.1 |
| 7 | Language scope (EN assumed; AR chrome authored) | Training materials |
| 8 | Sirius product owner and UAT participants | `UAT.md` sign-off |

