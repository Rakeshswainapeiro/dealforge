# W2-03 — Return metrics under three scenarios (FIN-03)

**Personas:** preparer (Infinia Deal Lead), Investment Analyst
**Feature covered:** Equity IRR, ROIC and payback period are captured for base,
upside and downside cases, with MOIC where relevant. All three scenarios are
mandatory, and the downside case must be a survivable downside. The check is
advisory: it flags a missing downside or an open metric/scenario cell but never
blocks a draft or a submission.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_returns_three_scenarios.png | preparer (Infinia Deal Lead) | The 4c Returns across three scenarios card on a going-concern fixture: Equity IRR, ROIC, payback and MOIC all captured for base, upside and downside, the downside present, badge reads "All scenarios captured". |
| preparer_returns_downside_missing.png | preparer (Infinia Deal Lead) | A draft that captured only a base IRR: the card reads "Downside missing" and the amber flag names the mandatory downside as the gap. The draft is not blocked. |
| analyst_memo_returns_scenarios.png | Investment Analyst | The captured returns flow through to the generated Sirius Part B memo (page 4) returns table: base / upside / downside per metric plus the MOIC row, alongside the hurdle wording. |

## How it works

server/config/returnMetrics.js is the single source of truth for the scenario
set. RETURN_SCENARIOS declares base, upside and downside (all required, in the
order the memo prints them). RETURN_METRICS declares Equity IRR, ROIC and
payback as required across all three scenarios and MOIC as captured where
relevant (never blocking). Each metric names the flat capture fields it reads,
so the form, the gate and the memo agree on field names without duplicating
them. returnsFromFlatFields() maps the flat fields onto the scenario table the
memo reads, omitting a metric with no captured value so the template
placeholder is rendered rather than a fabricated number. evaluateReturnMetrics()
reports which scenario/metric pairs are still open, whether the mandatory
downside is present and the completeness message.

server/gate.js adds the capture fields to INTAKE_FIELDS in
server/config/intakeConfig.js (no field is marked required, so the documented
minimum set is unchanged), evaluates the returns on evaluateGate as
return_metrics, and exposes the scenario/metric configuration on GET
/api/gate/fields as returns. server/config/siriusMemo.js builds the returns
block from the flat fields when the record carries none (resolveReturns), so
captured returns reach the memo page-4 table instead of placeholders; RETURN_HURDLES
gains a MOIC row. src/pages/SubmitOpportunity.jsx renders the advisory 4c card
under the statement-model check (data-testid="returns-scenarios-card";
returns-scenarios-status, returns-scenario-head-<scenario>,
returns-row-<metric>, returns-cell-<metric>-<scenario>,
returns-scenarios-downside, returns-scenarios-moic,
returns-scenarios-flag / returns-scenarios-ok). The memo returns table is
wrapped as data-testid="memo-returns-table".

Fixtures: the going-concern fixture (seed-inf-vision) and the other full-pack
fixtures carry the complete three-scenario set including MOIC. The sub-floor
fixture (seed-below-floor) carries only a base IRR, so the advisory flag
("Downside missing") is demonstrable live.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-03

Tests: server/tests/returnMetrics.test.js (8 pass) and the FIN-03 integration
cases in server/tests/m2.test.js (config exposed, complete set complete,
downside-missing flagged), plus the memo flat-field case in
server/tests/siriusMemo.test.js.
