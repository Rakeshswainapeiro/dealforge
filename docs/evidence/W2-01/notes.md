# W2-01 — Financial summary capture (FIN-01)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** the Part B page-4 financial summary — an eight-row AED mn
matrix spanning three audited actual years (FY-3 A to FY-1 A) and five
projection years (Y1 P to Y5 P). Revenue, EBITDA, net income and capex are
captured; growth %, EBITDA margin %, free cash flow and net debt / EBITDA are
derived automatically, and a new venture may leave the audited actuals blank.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_financial_summary_grid.png | preparer (Infinia Deal Lead) | The 4a Financial summary grid on a going-concern fixture: the Part B page-4 columns (FY-3 A … Y5 P) with captured Revenue / EBITDA / Net income / Capex and the derived Growth % / EBITDA margin % / Free cash flow rows already filled. |
| preparer_financial_greenfield_blank_actuals.png | preparer (Infinia Deal Lead) | A greenfield new venture leaves the three audited actual columns blank while the Y1–Y5 projections carry values; the derived rows show only where a base exists (Y1 growth blank, Y1 margin present). |
| analyst_memo_financial_summary.png | analyst (Sirius CIO) | The same matrix flows into the generated Sirius Part B memo (page 4, "Finances (AED mn)") in the target format, with Growth %, EBITDA margin %, Free cash flow and Net debt / EBITDA computed. |

## How it works

server/config/financials.js declares the fiscal periods (FINANCIAL_PERIODS:
FY-3 A, FY-2 A, FY-1 A, Y1 P … Y5 P), the eight rows (FINANCIAL_ROWS, each
tagged `input` or `derived`) and the pure deriveFinancials(data) engine. Growth %
is measured against the prior period's revenue (so FY-3 has no base and Y1 of a
new venture is blank), EBITDA margin % = EBITDA / revenue, free cash flow =
EBITDA − capex, and net debt / EBITDA uses the Net debt line (an explicitly
captured ratio always wins over the derivation). evaluateFinancials(data) returns
the per-row completeness used by the gate, and isNewVenture() suppresses the
audited-actual requirement for a greenfield opportunity.

server/config/siriusMemo.js builds the memo's finTable section from
deriveFinancials, so the captured grid and the memo table can never drift.
server/gate.js exposes the row/period config and the evaluation on
GET /api/gate/fields and evaluateGate, and src/pages/SubmitOpportunity.jsx
renders the editable grid (data-testid="financial-grid", inputs
fin-<row>-<period>, derived spans fin-derived-<row>-<period>) inside the
"financials" section group.

Fixtures: seed-inf-vision — a going-concern platform with all eight columns
populated; seed-greenfield — a Concept-stage new venture with a
projections-only matrix (greenfieldFinancials()).

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-01

Tests: server/tests/financials.test.js (12 pass) and the finTable assertions in
server/tests/siriusMemo.test.js.

