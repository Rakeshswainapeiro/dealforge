# W3-05 - Gate 2 weighted scorecard (SCO-02)

**Personas:** Investment Analyst (Sirius CIO), CIO. The analyst scores the seven
Gate-2 criteria on the screening board; a below-bar weighted total needs the CIO
to file an explicit override memo before the deal can move to Gate 3.

**Feature covered:** The Gate 2 quantitative screen is the exact D4 scorecard:
seven criteria, each scored 1-5, each carrying a weight, with the weights summing
to 100%. The weighted total is computed on the same 1-5 scale. A total of 3.5 or
above proceeds; below 3.5 the opportunity cannot proceed without an explicit CIO
override memo (a named CIO and a written reason). The criteria, weights and the
pass bar are configuration, so the IC can recalibrate without a code change and
every assessment keeps the version it was scored under (SCO-05 feeds this).

| # | Criterion | Weight | Threshold |
| --- | --- | --- | --- |
| 1 | Revenue scale / trajectory | 15% | Minimum scale for stage, or a credible path within 24 months |
| 2 | Growth rate | 15% | 25%+ YoY growth-stage; sector-appropriate for mature |
| 3 | Entry valuation vs. comps | 20% | Within a defensible 3-5 name comp set |
| 4 | Target ownership / control | 10% | Minimum stake for board seat plus information rights |
| 5 | Capital structure | 10% | No debt/preference stack subordinating Sirius below acceptable recovery |
| 6 | Path to liquidity | 15% | Identifiable exit route within a 4-7 year horizon |
| 7 | Unit economics | 15% | Gross margin and payback consistent with sector benchmarks |

The evaluator is pure: the criteria and weights are read from configuration, so
the board, the gate, the memo and the tests read one source of truth
(REQ-RULE-10). Version tag: SC-01.1.

## Shots

| File | What it shows |
| --- | --- |
| analyst_scorecard_weighted_summary.png | Regional Cold-chain Platform on the analyst board: the seven criteria with their weights and thresholds, the score buttons, and the "Proceed (4.1/5)" outcome. Weights sum to 100% and the weighted total clears the 3.5 pass bar. |
| analyst_scorecard_criteria_scoring.png | Mature Packaging Roll-up: the analyst adjusting the growth-rate score to 3 with a note, the weighted total recomputing to 2.85/5 and the outcome flipping to "Below bar - override required". |
| analyst_scorecard_cioreview_below_bar.png | A below-bar total with the explicit CIO override memo control: the named CIO (cio@sirius.local) and the written reason, ready to file before the deal can proceed to Gate 3 (SCO-02 / REQ-GATE-02). |

## How it works

1. "server/config/scorecard.js" defines the seven D4 criteria with their weights,
   thresholds and 1-5 guide, the 3.5 pass bar, the scale and the messages, and
   "evaluateScorecard(data, { criteria })". It returns each criterion with its
   score, weight and weighted contribution, the weight validation, the weighted
   total, the pass/override outcome and the recorded override memo.
   "validateWeights" refuses a recalibrated weight set that does not total 100.
   "buildScorecard" validates a capture (every score a whole 1-5);
   "buildScorecardOverride" validates a CIO override memo (a named CIO and a
   reason of at least 10 characters).
2. "server/gate.js" attaches "scorecard" to "evaluateGate", serves the config
   block from "/api/gate/fields", and exposes "POST
   /opportunities/:id/scorecard" (write-org check, the capture stored on the
   opportunity as "data.scorecard" and audited as "scorecard_scored"),
   "POST /opportunities/:id/scorecard-override" (CIO/admin role check, 409 when
   the total already clears the bar, stored as "data.scorecard_override" and
   audited as "scorecard_override") and "GET
   /opportunities/:id/scorecard/history".
3. "server/config/screeningPanel.js" returns the scorecard block as a section
   that rides along, so the six Gate-1 BRD checks are unchanged.
4. "src/pages/ScreeningBoard.jsx" renders the Gate 2 weighted scorecard section
   with the per-criterion score buttons and notes, the recorded total and the CIO
   override memo control on a below-bar total.
5. The fixtures seed-scorecard (Regional Cold-chain Platform, above the bar) and
   seed-scorecard-below (Mature Packaging Roll-up, below the bar) make the scored
   and override states demonstrable.

## Reproduce

    # 1. Demo stack
    docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build
    docker compose -p dealforge-demo -f docker-compose.demo.yml exec -T app node server/seedCli.js --profile=mvp --clean --force

    # 2. Capture the shots
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W3-05

    # 3. Unit + integration tests
    BASE_URL=http://localhost:34099 node --test server/tests/scorecard.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/screeningPanel.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js
