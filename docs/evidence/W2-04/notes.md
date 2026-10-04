# W2-04 — Automatic hurdle test per scenario (FIN-04)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** the automatic hurdle test. Every hurdle is evaluated per
captured case (base / upside / downside) rather than once for the deal, so the
memo's page-4 "Financials & returns vs. hurdles" table prints a Meets? verdict
that can never disagree with its inputs. The thresholds are read from the same
mandate_threshold configuration the rest of the engine uses, so an admin change
moves the verdicts with no code change; the ROIC hurdle is WACC (FIN-05) plus the
configured spread. Every evaluation is stamped with a policy revision
(FIN-04: "values versioned"). Misses are advisory — they flag, never block.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_hurdle_table_per_scenario.png | preparer (Infinia Deal Lead) | The 4e Automatic hurdle test on a going-concern fixture: Equity IRR, ROIC, payback, single-deal concentration and Net debt / EBITDA each carry a threshold and a per-scenario Y/N. Base and upside meet; the downside (IRR 13%, ROIC 9%, payback 4.2yrs) falls short and is flagged amber — the pass rate reads base 5/5, upside 5/5, downside 2/5, and the card is stamped Policy v1 (FIN-04: Meets/Does-not-meet per hurdle per scenario; values versioned). |
| preparer_hurdle_table_all_met.png | preparer (Infinia Deal Lead) | A case whose captured hurdles all clear their thresholds shows the green 'All hurdles met' state; the pass rate counts only captured hurdles (base 3/3), and the deal-level rows (concentration, leverage) stay constant across the scenarios (FIN-04 accept criterion). |
| analyst_memo_hurdle_table.png | analyst (Sirius CIO) | The computed verdicts flow into the generated Sirius Part B memo (page 4): six hurdle rows with the live printed thresholds (≥ 20%, ≥ 14%, ≤ 3.5yrs, ≤ 35%, ≤ 3x), per-scenario values, a derived Meets? column and the policy-version note under the table (FIN-04: values versioned; FIN-03: three scenarios). |

## How it works

server/config/hurdleTable.js is the pure source of truth. HURDLE_TABLE_VERSION
stamps every evaluation so an audit trail can tell which policy produced a given
set of verdicts. HURDLE_DEFAULTS ships the house numbers (equity IRR ≥ 20%,
greenfield ≥ 25%, ROIC ≥ WACC + 5%, payback ≤ 3.5yrs, concentration ≤ 35%,
leverage ≤ 3x); server/themes.js merges them into DEFAULT_THRESHOLDS so the table
and the rest of the engine share one set of numbers, each overridable per entity
through mandate_threshold. hurdleThresholds() resolves the finite thresholds,
computing ROIC as WACC + spread. computeHurdles() evaluates each hurdle per
scenario, marking concentration and leverage as deal-level (basis 'deal') so they
are evaluated once and reported against every column. A hurdle with a captured
value below its threshold raises an advisory {reason:'below_hurdle'} flag; a
hurdle with no threshold raises {reason:'no_threshold'} rather than silently
passing. Concentration is read from a structured percentage or the first
percentage in the impact rationale; leverage is the captured Net debt / EBITDA,
or the ratio derived from a captured Net debt line via deriveFinancials().

server/gate.js resolves the table on evaluateGate and attaches hurdle_table to
the gate result (with wacc.roic_hurdle and wacc.roic_vs_wacc rebuilt on the same
numbers so the WACC card stays consistent), and exposes the versioned row list on
GET /api/gate/fields. server/themes.js adds getHurdlePolicy(orgId) and
GET /api/themes/hurdles (org-scoped, permission-checked) so the admin screen and
the audit trail can show the policy the verdicts came from. server/config/
siriusMemo.js prints the live thresholds and the per-scenario verdicts in the
page-4 returns table and adds a "Hurdles vs. thresholds (policy v<N>)" note.
src/pages/SubmitOpportunity.jsx renders the advisory 4e card (data-testid
hurdle-table-card; hurdle-table-status, hurdle-row-<k>, hurdle-threshold-<k>,
hurdle-cell-<k>-<s>, hurdle-passrate-<s>, hurdle-table-version, hurdle-table-flag,
hurdle-table-ok).

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-04

Tests: server/tests/hurdleTable.test.js (12 pass) plus the memo hurdle cases in
server/tests/siriusMemo.test.js and the FIN-04 integration cases in
server/tests/m2.test.js (config exposed and versioned, per-scenario verdicts,
deal-level constants, below-hurdle advisory flag, org policy endpoint).

