# W3-01 — Single screening panel (SCR-01)

**Personas:** Investment Analyst (Sirius CIO), Preparer (subsidiary deal lead) — the
panel is served to anyone who can view the opportunity; the shots are taken as the
Sirius CIO because screening is the review-side view.

**Feature covered:** On submission the platform runs the initial screen and shows
every result on one panel. The panel aggregates six checks, each with a result
(Pass / Flag / Fail / Pending), a rationale and evidence references:

| Check | Source module | Result vocabulary |
| --- | --- | --- |
| Eligibility | pre-form self-screen + below-floor exception (W1-01/W1-02) | Pass / Flag / Fail |
| Hard filters | standing exclusions + threshold filters (rule set lands in a later W3 slice) | Pending (advisory) |
| Hurdle tests | automatic per-scenario hurdle table (W2-04) | Pass / Flag / Pending |
| Strategic alignment | theme alignment score (E5) | Pass / Flag / Pending |
| Synergy & conflict | duplicates (INT-12) + related-party flag + declared conflict | Pass / Flag (advisory) |
| Completeness sufficiency | required fields, required documents, financial pack | Pass / Flag / Fail |

The panel carries a recommendation (proceed / review flags / blocking checks open)
and an explicit disclaimer: screening is advisory and the system never rejects an
opportunity on its own (SCR-09). The screen is composed server-side from the same
gate and alignment blocks the capture form and the memo read, so it cannot disagree
with them. The route is "GET /api/pipeline/opportunities/:id/screening".

## Shots

| File | What it shows |
| --- | --- |
| analyst_screening_panel_overview.png | Vision Care Imaging Platform: all six checks on one panel, the recommendation badge, per-check rationales and evidence chips, and the advisory disclaimer. |
| analyst_screening_panel_alignment_flag.png | Industrial Logistics Adjacency: the alignment check flags against the subsidiary mandate (score 10/100) while the other checks stay independent, so the whole screen reads on one view. |
| analyst_screening_panel_conflict_signals.png | Affiliate Referral — Digital Assets Custody: the synergy & conflict check surfaces the related-party signal as evidence, completeness passes, and the panel stays advisory. |

## How it works

1. "server/config/screeningPanel.js" defines the six-check vocabulary and
   "evaluateScreeningPanel({ gate, alignment, duplicates, conflict })". The pure
   evaluator composes each check from the already-computed blocks — no rule is
   re-derived — and returns the checks, a summary, completeness, flags and a message.
2. "server/pipeline.js" exposes the screening route. It loads the opportunity
   under the same org-visibility rule as every other pipeline route (404 if absent,
   403 for a sibling), then composes the gate, the alignment score and — for
   cross-org readers only — the duplicate-target matches.
3. "src/pages/ScreeningBoard.jsx" renders the panel at the top of the detail
   sheet, above the mandate alignment block, with a result badge per check and the
   evidence references as chips.
4. "src/api/client.js" adds "api.pipeline.screening(id)".

## Reproduce

    # 1. Demo stack
    docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build

    # 2. Capture the shots (as the Sirius CIO)
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W3-01

    # 3. Unit + integration tests
    BASE_URL=http://localhost:34099 node --test server/tests/screeningPanel.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js
