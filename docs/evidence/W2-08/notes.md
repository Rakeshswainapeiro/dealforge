# W2-08 — Entry valuation and exit (FIN-09)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** the structured entry valuation and exit capture. The
preparer records the entry figure with its basis (EV or equity value), amount,
multiple and method; a comparable set of three to five names; and the exit /
value-realisation route, timing and target multiple. The captured valuation and
the comparable set flow through to the generated Sirius Part B memo as their own
table. Advisory only — a partial capture raises flags, it never blocks
submission.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_valuation_complete.png | preparer (Infinia Deal Lead) | The 4b Entry valuation & comparable set card on a complete fixture: the basis is Enterprise value (EV), the entry valuation and multiple are recorded, the method is Trading comparables, the three-name comparable set is populated, and the exit route, timing and target multiple are present. The badge reads 'Valuation complete' and the green state fires with no advisory flags (FIN-09: captured as structured fields; comps list allows 3-5 names). |
| preparer_valuation_incomplete_flag.png | preparer (Infinia Deal Lead) | A partial capture — an amount and multiple but no EV/equity basis or method, and only two comparables — reads 'Valuation incomplete' and raises the advisory 'Comparable set incomplete: capture between 3 and 5 comparable names' alert without blocking submission (FIN-09: a partial capture is flagged, never discarded). |
| analyst_memo_valuation_table.png | analyst (Sirius CIO) | The captured entry valuation and comparable set flow into the generated Sirius Part B memo (section 4): the 'Entry valuation & comparable set' table lists each comparable with its metric and multiple, followed by the entry basis note ('240 AED mn · Enterprise value (EV) · 6.6x · Trading comparables') and the exit note ('Strategic sale to a regional healthcare platform · Year 5 · 7.5x') (FIN-09). |

## How it works

server/config/valuation.js is the pure source of truth. VALUATION_FIELDS maps the
flat capture keys (entry_valuation_basis, entry_valuation_aed, entry_multiple,
entry_valuation_method, exit_route, exit_timing, exit_multiple) and the nested
comparables key (valuation_comparables); VALUATION_BASIS offers EV / equity value
and VALUATION_METHODS offers trading comparables, precedent transactions, DCF,
asset-based and other; COMPARABLE_MIN/MAX set the 3-5 name band. evaluateValuation()
normalises the comparables into ordered rows and returns the entry block (with
basis_valid / method_valid), the comparable count and whether it is inside the
band, the exit block, a captured flag, a complete flag, a flags list and a summary
message. A partial capture — a figure without its basis or method, fewer than
three or more than five comparables, or an exit route without timing — raises a
flag; nothing here discards the capture or blocks submission. Because the module
is the single place the gate, the capture form and the Sirius memo read, the
valuation can never disagree between them.

server/gate.js resolves valuation on evaluateGate and exposes the field names,
the basis / method options and the comparable bounds on GET /api/gate/fields.
server/config/siriusMemo.js builds the memo table from the same evaluation — a
'Entry valuation & comparable set' table (padded to at least three rows so a
partial capture still shows the shape) plus the entry-basis and exit notes.
src/pages/SubmitOpportunity.jsx renders the 4b card (data-testid valuation-card;
valuation-status, valuation-entry-basis, valuation-entry-amount,
valuation-entry-multiple, valuation-entry-method, valuation-comparable-row-<i>,
valuation-comparable-name-<i>, valuation-comparable-metric-<i>,
valuation-comparable-multiple-<i>, valuation-exit-route, valuation-exit-timing,
valuation-exit-multiple, valuation-flag, valuation-ok) in the financials section
under the automatic hurdle test; the seven flat keys are filtered out of the
generic section loop so they render once inside the card.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-08

Tests: server/tests/valuation.test.js (10 pass) plus the FIN-09 integration cases
in server/tests/m2.test.js (the gate config exposes the field names and the
comparable bounds; a complete capture evaluates as complete with no flags; a
comparable set below the minimum is flagged, not blocked).
