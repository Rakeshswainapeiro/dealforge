# W1-10 — Duplicate detection warning

**Personas:** analyst (Investment Team)
**Feature covered:** the system warns when a new opportunity looks like an existing one
(same target / counterparty or a similar name) across the group. The warning is shown to the
Investment Team only — never to the subsidiary — and the team can link or dismiss it (INT-12).

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| analyst_duplicate_warning.png | analyst (Investment Team) | The duplicate panel surfaces the sibling subsidiary's matching opportunity (`Emircom Cloud Services`) with Link and Dismiss actions. |
| analyst_duplicate_dismissed.png | analyst (Investment Team) | After dismissing, the match shows a Dismissed badge and the decision is retained. |

## How it works

server/config/duplicates.js holds the pure matcher — nameTokens / nameKey / compareOpportunities
/ findDuplicates with a stop-word list and DUPLICATE_MATCH_THRESHOLD = 2. A match is the same
target or counterparty name key, the same opportunity name key, or at least two shared
meaningful tokens; generic / stop-word-only names are excluded. server/duplicates.js exposes
the /api/duplicates router — GET /opportunities/:id for matches, and POST
/opportunities/:id/:matchId/link and /dismiss — all gated to isCrossOrgReader (Investment Team)
so a subsidiary gets 403. Decisions upsert into the duplicate_review table and write
duplicate_linked / duplicate_dismissed audit events. server/pipeline.js attaches a
duplicate_warning count to board cards for cross-org readers only. src/api/client.js exposes
the duplicates API, and src/pages/ScreeningBoard.jsx renders the duplicate panel with Link /
Dismiss buttons and Linked / Dismissed badges.

Fixtures: seed-duplicate-finstreet — a Finstreet screening case whose target (`Emircom Cloud
Services`) matches seed-in-screening, exercising the cross-subsidiary warning.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-10

Tests: server/tests/duplicates.test.js (8 pass) and the W1-10 block in server/tests/m3.test.js
(3 pass). Commit: feat(intake): withdraw with reason + duplicate detection (W1-09, W1-10).
