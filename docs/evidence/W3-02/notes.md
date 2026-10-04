# W3-02 - Gate 1 hard filters (SCR-03)

**Personas:** Preparer (subsidiary deal lead), Investment Analyst (Sirius CIO),
Independent Reviewer. The filters are captured on the form by the preparer, read on
the screening panel by the analyst, and confirmed or overridden by the reviewer.

**Feature covered:** Before a submission reaches the screening decision, the platform
evaluates five Standing hard filters and raises a **Recommended decline** with the
reason when any fails. The system never rejects on its own: a reviewer with write
access to the owning org confirms the decline or overrides it, and a written reason
is required for either. A failed filter is a hard block on the screening decision
(the check reports Fail), while an unconfirmed manual confirmation is a flag.

| # | Filter | Source | Verdict vocabulary |
| --- | --- | --- | --- |
| 1 | Designated vertical | theme sector (or a reasoned exception on the record) | Pass / Fail |
| 2 | Check size within the deployment band | theme band + entity commitment floor | Pass / Fail / Flag |
| 3 | No sanctions / export-control / reputational exposure | manual confirmation + note | Pass / Fail / Flag |
| 4 | ADGM / DIFC-compatible structuring | manual confirmation + note | Pass / Fail / Flag |
| 5 | No un-mitigable portfolio conflict | manual verdict + named reviewer | Pass / Fail / Flag |

The evaluator is pure: thresholds, the effective theme and every message are passed
in, so the capture form, the screening gate, the memo read and the tests read one
source of truth (REQ-RULE-10). Version tag: HF-01.1.

## Shots

| File | What it shows |
| --- | --- |
| preparer_hard_filters_form.png | The "6a. Gate 1 hard filters" card on the capture form: the five filters with live verdicts (designated vertical and check size derived, the two compliance confirmations and the portfolio conflict manual) plus the six confirmation inputs, and the Proceed outcome badge on a clean deal. |
| analyst_hard_filters_recommended_decline.png | Industrial Logistics Adjacency: the designated-vertical filter fails against the Finstreet mandate, the hard-filters check reads Fail, and the recommendation is Recommended decline with the reason and per-filter evidence chips. |
| reviewer_hard_filters_review_override.png | The reviewer's confirm/override control on the recommended decline: mandatory written reason, the two decision buttons and the Record decision action. The decision is audited and flips the effective outcome only on an explicit override. |

## How it works

1. "server/config/hardFilters.js" defines the five items, the field map, the
   messages and "evaluateHardFilters(data, { theme, thresholds })". It returns each
   item's status (pass / fail / flag / not_evaluated), the failed and pending lists,
   the recommended outcome and reason, the recorded review, the effective outcome
   and the awaiting-review flag. "buildHardFilterReview" validates a confirm/override
   decision and requires a written reason (minimum 10 characters).
2. "server/config/intakeConfig.js" adds the six non-required hard-filter fields to
   the risks section; the documented 14-key required minimum is unchanged, so an
   unconfirmed filter is a flag rather than a silent pass.
3. "server/gate.js" resolves the effective theme for the owning org, attaches
   "hard_filters" to "evaluateGate", serves the config block from "/api/gate/fields",
   and exposes "POST /opportunities/:id/hard-filter-review" (write-org check, 409 if
   nothing failed, the decision persisted on the opportunity and audited) and
   "GET /opportunities/:id/hard-filter-review/history".
4. "server/config/screeningPanel.js" reads the gate's hard-filter block so the panel
   check reports Fail on a failed filter, Flag on a flagged manual confirmation and
   Pass otherwise.
5. "src/pages/SubmitOpportunity.jsx" renders the "6a. Gate 1 hard filters" card;
   "src/pages/ScreeningBoard.jsx" renders the reviewer confirm/override control on a
   recommended decline.

## Reproduce

    # 1. Demo stack
    docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build

    # 2. Capture the shots
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W3-02

    # 3. Unit + integration tests
    BASE_URL=http://localhost:34099 node --test server/tests/hardFilters.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/screeningPanel.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js
