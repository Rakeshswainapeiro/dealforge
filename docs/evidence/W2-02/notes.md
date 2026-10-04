# W2-02 — Three-statement model upload and check (FIN-02)

**Personas:** preparer (Infinia Deal Lead), Investment Analyst
**Feature covered:** a linked three-statement model (P&L, balance sheet, cash
flow) is a mandatory part of the financials upload. On upload the system parses
the model, confirms all three statements are present and checks that the balance
sheet balances (assets = liabilities + equity) in each period. A non-template or
unbalanced model is still accepted, but flagged for manual review — the flags are
advisory and never block a submission.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_statement_model_balanced.png | preparer (Infinia Deal Lead) | The 4b Three-statement model check on a going-concern fixture: P&L, balance sheet and cash flow all present, the balance sheet balanced in every period, the model recognised as the Sirius template, and the card reads "Three-statement model accepted". |
| preparer_statement_model_greenfield.png | preparer (Infinia Deal Lead) | A new venture's projections-only model still balances and counts as complete, so FIN-01's blank audited actuals and FIN-02's presence check agree. |
| preparer_statement_model_flagged_unbalanced.png | preparer (Infinia Deal Lead) | The advisory flag in action: an in-review submission whose balance sheet does not balance (one period out) is accepted but flagged for manual review with the reason named. Nothing is rejected. |

## How it works

server/config/statementModel.js is a dependency-free parser and checker. It
declares the three statements (THREE_STATEMENTS with the line-item markers that
identify each one), the balance-sheet totals the equality check reads
(BALANCE_SHEET_TOTALS) and the tolerance (BALANCE_TOLERANCE_PCT, default 0.5% of
total assets, env-configurable). parseStatementModel() reads the canonical Sirius
template as CSV / TSV, an equivalent JSON form, or anything else it can parse —
it never throws; an unreadable or unsupported file is reported as parsed:false so
the caller can flag it. evaluateStatementModel() turns the stored summary into
the gate result: attached, complete, template, per-statement presence, the balance
result and flagged_for_review. The check rides on the mandatory financials
document requirement (REQ-DOCGATE-01) rather than adding a fourth blocking gate,
so the mandatory-upload rule is unchanged and the three-statement flags stay
advisory.

server/gate.js parses the uploaded financials file (POST
/api/gate/opportunities/:id/documents, requirement_key=financials), persists the
summary as statement_model on the opportunity, writes a statement_model_parsed
audit event, and exposes the evaluation on evaluateGate / the status route plus
the statement config on GET /api/gate/fields. A parse error never fails the
upload. src/pages/SubmitOpportunity.jsx renders the advisory 4b card under the
financial summary (data-testid="statement-model-card"; per-statement
statement-model-<key>, statement-model-status, statement-model-balance,
statement-model-format, statement-model-flag / statement-model-ok).

Fixtures: every fixture that carries the financials pack also carries the
three-statement model — the canonical balanced Sirius template for going-concern
deals (seed-inf-vision), the projections-only balanced variant for new ventures
(seed-greenfield-unfunded), and a deliberately unbalanced variant on
seed-in-screening so the advisory flag is demonstrable live.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-02

Tests: server/tests/statementModel.test.js (13 pass) and the FIN-02 integration
cases in server/tests/m2.test.js (template accepted + complete, unbalanced
accepted but flagged, non-template accepted but flagged, parse audited).
