# W2-07 — Budget status (FIN-07)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** the preparer's budget-status confirmation. The preparer
states whether the opportunity sits in the approved budget. When the answer is
in-budget, a budget line reference is captured as an advisory hint (it never
blocks). When the answer is off-budget, the preparer must record a variance
justification and a variance-memo upload becomes mandatory before submission —
the same figures and the resulting status flow through to the generated Sirius
Part B memo.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_budget_status_in_budget.png | preparer (Infinia Deal Lead) | The 5b Budget status card on an in-budget fixture: the badge reads 'In approved budget', the line reference BUD-2027-04 / Technology Platform is shown, and the green 'Budget status confirmed' state carries no block (FIN-07 in-budget case: line reference or variance justification required). |
| preparer_budget_status_off_budget.png | preparer (Infinia Deal Lead) | An off-budget opportunity with the variance justification recorded but no variance memo: the badge reads 'Off-budget' and the red 'Budget status blocks submission' panel makes the variance-memo upload mandatory, listing the required 'Budget line / variance justification' document (FIN-07 accept criterion: if 'No', a variance memo upload becomes mandatory). |
| analyst_memo_budget_status.png | analyst (Sirius CIO) | The captured budget status flows into the generated Sirius Part B memo (section 5): the funding note reads 'Budget status: Yes — BUD-2027-04 / Technology Platform (approved FY27 capex plan)' under the funding tables (FIN-07). |

## How it works

server/config/budgetStatus.js is the pure source of truth. BUDGET_FIELDS maps
the four capture keys (in_approved_budget, budget_status, budget_line_reference,
variance_justification) and VARIANCE_MEMO_KEY names the document that becomes
mandatory when the answer is off-budget (budget_confirmation, already listed as
funding evidence in server/config/memoDocumentList.js). evaluateBudgetStatus()
normalises the yes/no answer case-insensitively into in_budget / off_budget and
returns the status, the line reference, the justification, whether the variance
memo is present, a satisfied flag, a stops list and a flags list. An unanswered
answer is a hard stop (budget_answer_required). An off-budget answer requires
both a recorded justification (variance_justification_required) and a present
variance memo (variance_memo_required); a missing line reference on an in-budget
answer is only an advisory flag (budget_line_missing) and never blocks. Because
the module is the single place the gate, the capture form and the Sirius memo
read, the status can never disagree between them.

server/gate.js resolves budget_status on evaluateGate, pushes the off-budget
variance memo into the missing list so the existing document gate blocks it, and
exposes the field names, the document key and the two statuses on
GET /api/gate/fields. The submit route refuses a submission whose budget status
is not satisfied with a 422 and a submit_blocked audit, after the greenfield and
sourcing-channel checks. server/config/siriusMemo.js builds the memo budget note
from the same evaluation — 'Budget status: Yes — <line reference>' or
'No — <justification>... variance memo upload mandatory'. src/pages/SubmitOpportunity.jsx
renders the 5b card (data-testid budget-status-card; budget-status-badge,
budget-line-reference, budget-variance, budget-variance-memo, budget-status-flag,
budget-status-line-flag, budget-status-ok) in the funding section under the
sources-and-uses card.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-07

Tests: server/tests/budgetStatus.test.js (8 pass) plus the FIN-07 integration
cases in server/tests/m2.test.js (config exposes the field names and memo key; an
in-budget answer satisfies the gate; an off-budget answer without justification
or memo is blocked and the variance memo appears in the missing list; an
off-budget answer is satisfied once the justification and memo are present).
