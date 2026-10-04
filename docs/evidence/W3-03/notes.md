# W3-03 - Gate 1 soft filters (SCR-04)

**Personas:** Preparer (subsidiary deal lead), Investment Analyst (Sirius CIO),
Independent Reviewer. The soft filters are captured on the form by the preparer,
read as scored items on the screening panel by the analyst, and confirmed or
adjusted with a rationale by the reviewer.

**Feature covered:** The three soft filters are **scored**, not used to kill a deal.
The platform proposes a 1-5 score for each with a rationale, and a reviewer with
write access to the owning org confirms or adjusts every score with a written
rationale (minimum 10 characters). Unlike the hard filters, a soft filter never
becomes a fail: the scores roll up into a Strong / Moderate / Weak outcome that
informs the screening decision but does not decline on its own (SCR-04; the
SCR-09 advisory stance holds).

| # | Soft filter | Proposal source | Scale |
| --- | --- | --- | --- |
| 1 | Adjacency to portfolio companies | theme sector match + portfolio note | 1-5 |
| 2 | Alignment with UAE national priorities | UAE priority-sector list + geography | 1-5 |
| 3 | Management openness to an active investor | recorded management stance | 1-5 |

The evaluator is pure: the theme, portfolio and national-priority inputs are passed
in, so the capture form, the screening gate, the memo read and the tests read one
source of truth (REQ-RULE-10). Version tag: SF-01.1. Outcome bands: Strong at an
average of 4 and above, Moderate at 3 and above, Weak below 3.

## Shots

| File | What it shows |
| --- | --- |
| preparer_soft_filters_form.png | The "6b. Gate 1 soft filters" card on the capture form: the three scored filters with their proposed 1-5 scores and rationale, the Strong outcome badge, the management-openness select and note inputs, plus the adjacency and national-priority notes and the scale legend. |
| analyst_soft_filters_scored_not_declined.png | Industrial Logistics Adjacency on the analyst board: the three soft filters shown as a scored section with proposed scores and rationales and a Moderate outcome - no recommended decline is raised by the soft filters. |
| reviewer_soft_filters_review_adjust.png | The reviewer's soft-filter review: per-filter 1-5 score buttons and rationale boxes; the reviewer has adjusted management openness down to 2 and recorded the reason. The Record scores action is enabled once every rationale meets the minimum length. |

## How it works

1. "server/config/softFilters.js" defines the three items, the field map, the
   messages, the UAE priority sectors and "evaluateSoftFilters(data, { theme,
   portfolio, nationalPriorities })". It proposes a score per item and returns the
   per-item scores and rationale, the proposed and effective averages, the outcome
   band, the recorded review and the awaiting-review flag. "buildSoftFilterReview"
   validates a confirm/adjust decision and requires all three scores and a rationale
   of at least 10 characters each.
2. "server/config/intakeConfig.js" adds the four non-required soft-filter fields to
   the risks section; the documented 14-key required minimum is unchanged, so a
   missing note is a proposal rather than a silent pass.
3. "server/gate.js" attaches "soft_filters" to "evaluateGate", serves the config
   block from "/api/gate/fields", and exposes "POST
   /opportunities/:id/soft-filter-review" (write-org check, the decision persisted
   on the opportunity and audited) and "GET
   /opportunities/:id/soft-filter-review/history".
4. "server/config/screeningPanel.js" reads the gate's soft-filter block and returns
   it as a riding-along section, so the six BRD checks are unchanged and the soft
   filters are visible without becoming a pass/fail check.
5. "src/pages/SubmitOpportunity.jsx" renders the "6b. Gate 1 soft filters" card;
   "src/pages/ScreeningBoard.jsx" renders the reviewer confirm/adjust control with
   the per-filter score buttons and rationale boxes.

## Reproduce

    # 1. Demo stack
    docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build

    # 2. Capture the shots
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W3-03

    # 3. Unit + integration tests
    BASE_URL=http://localhost:34099 node --test server/tests/softFilters.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/screeningPanel.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js
