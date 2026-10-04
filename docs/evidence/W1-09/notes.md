# W1-09 — Withdraw submission with reason

**Personas:** preparer (Infinia Deal Lead)
**Feature covered:** a preparer can withdraw their own opportunity before a screening decision, with a required reason (INT-13). Withdrawn records stay visible in history and on reports with the reason captured.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_withdraw_reason_dialog.png | preparer (Infinia Deal Lead) | The withdraw dialog requires a reason before it will submit — the action is blocked while the reason is empty. |
| preparer_withdrawn_in_history.png | preparer (Infinia Deal Lead) | After withdrawing, the opportunity is marked Withdrawn and the reason is retained in the transition history. |

## How it works

server/pipeline.js adds 'withdrawn' to PIPELINE_STATES and to the TRANSITIONS map
(submission and returned can move to withdrawn), with STATE_ACTION.withdrawn = 'fill'
and STATE_LABELS.withdrawn = 'Withdrawn'. transition() runs a withdraw branch first:
it requires canWriteOrg, rejects an empty comment with 400, then records
withdrawn_reason / withdrawn_at / withdrawn_by on the opportunity. opportunityToCard
now takes the actor and exposes returned_reason / declined_reason / withdrawn_reason plus
can_withdraw (true only in submission or returned where canWriteOrg holds). The screening
board gained a Withdrawn column, and myOpportunities excludes withdrawn from the open
count. src/pages/ScreeningBoard.jsx lists withdrawn in BOARD_STATES and STATE_META,
treats withdrawn as a comment-required state, and offers withdraw only where can_withdraw;
the comment Textarea carries data-testid="transition-comment" so capture can drive it.

Fixtures: seed-withdraw-demo — a live Infinia submission kept aside so the withdraw flow can
be demonstrated and captured without touching the happy-path fixture.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-09

Tests: the W1-09 block in server/tests/m3.test.js (4 pass). Commit: feat(intake):
withdraw with reason + duplicate detection (W1-09, W1-10).
