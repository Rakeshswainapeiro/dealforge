# W3-04 - Automatic disqualifier flags (SCR-05)

**Personas:** Preparer (subsidiary deal lead), Investment Analyst (Sirius CIO),
Independent Reviewer. The disqualifier confirmations are captured on the form by
the preparer, read as a flagged section on the screening panel by the analyst, and
cleared only by a named reviewer with a written reason.

**Feature covered:** Five automatic disqualifiers are raised from the recorded
data and shown as prominent flags on the record and in the memo. A flag is never
cleared by the system on its own: clearing requires a named reviewer and a reason
of at least 10 characters, and the clear is persisted and audited. Unanswered
items are shown as **Not evaluated** rather than silently passing, so an absent
confirmation is visible on the record.

| # | Disqualifier | Signal | Threshold |
| --- | --- | --- | --- |
| 1 | Sanctions / PEP exposure without mitigation | confirmation recorded | any recorded exposure flags |
| 2 | No enforceable minority protections | confirmation recorded | absence of protections flags |
| 3 | Valuation more than 30-40% above the tightest comparable | comparable premium | flags above 35% |
| 4 | Undisclosed related party found after Gate 1 | related-party signal | disclosure blank while a party is present flags |
| 5 | Non-transferable licence | licence transferability | a non-transferable licence flags |

The evaluator is pure: the related-party signal is passed in, so the capture form,
the screening gate, the memo read and the tests read one source of truth
(REQ-RULE-10). Version tag: DQ-01.1.

## Shots

| File | What it shows |
| --- | --- |
| preparer_disqualifiers_form.png | The "6c. Automatic disqualifier flags" card on the capture form: the five items with their Not evaluated badges for the unanswered confirmations, the sanctions / PEP and related-party selects with notes, the minority-protections and licence-transferable selects, and the valuation-premium percentage input. |
| analyst_disqualifiers_flagged.png | Legacy Metals Restructuring on the analyst board: the disqualifier section with a "2 open flags" badge, sanctions / PEP and undisclosed related party flagged with a reason box and named-reviewer input, and the minority, valuation and licence items shown Clear. |
| reviewer_disqualifiers_clear.png | The reviewer's clear action: the sanctions / PEP flag with a written reason ("Independent sanctions screening returned clear; the PEP match was a false positive.") and the named reviewer (reviewer@sirius.local) entered, ready to clear against the still-flagged related-party item. |

## How it works

1. "server/config/disqualifiers.js" defines the five items, the field map, the
   messages and "evaluateDisqualifiers(data, { relatedParty })". It returns the
   per-item status (clear / flagged / not evaluated), the rationale, the flagged,
   open-flag and not-evaluated sets and a has-open-flag rollup.
   "buildDisqualifierReview" validates a clear decision and requires a named
   reviewer and a reason of at least 10 characters for every cleared flag.
2. "server/config/intakeConfig.js" adds the ten non-required disqualifier fields to
   the risks section; the documented 14-key required minimum is unchanged, so a
   missing confirmation is a Not evaluated item rather than a silent pass.
3. "server/gate.js" computes the related-party signal, attaches "disqualifiers" to
   "evaluateGate", serves the config block from "/api/gate/fields", and exposes
   "POST /opportunities/:id/disqualifier-review" (write-org check, a 409 for an
   unknown flag key, prior clears merged, and the clear persisted on the
   opportunity as "data.disqualifier_review" and audited as
   "disqualifier_cleared") and "GET
   /opportunities/:id/disqualifier-review/history".
4. "server/config/screeningPanel.js" reads the gate's disqualifier block and
   returns it as a riding-along section, so the six BRD checks are unchanged.
5. "src/pages/SubmitOpportunity.jsx" renders the "6c. Automatic disqualifier
   flags" card; "src/pages/ScreeningBoard.jsx" renders the reviewer clear control
   with the per-flag reason box and named-reviewer input.

## Reproduce

    # 1. Demo stack
    docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build

    # 2. Capture the shots
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W3-04

    # 3. Unit + integration tests
    BASE_URL=http://localhost:34099 node --test server/tests/disqualifiers.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/screeningPanel.test.js
    BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js
