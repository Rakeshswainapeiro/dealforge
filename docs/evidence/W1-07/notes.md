# W1-07 — Greenfield / new-venture extra tests

**Personas:** preparer (Infinia Deal Lead)
**Feature covered:** the extra tests a greenfield / new-venture entry must clear
before submission (INT-10) — a recorded stage (Concept, Feasibility or
Initiate), a quantified benefit, the why-this / why-now / why-us thesis, budget
status and a named, secured funding source. A greenfield without a secured
funding source is blocked, and a Concept-stage entry needs only the concept note
(max. 2 pages).

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_greenfield_tests_incomplete.png | preparer (Infinia Deal Lead) | A Feasibility-stage greenfield with unsecured funding shows the "Greenfield extra tests incomplete" card, listing the missing secured source and the block rule for that entry. |
| preparer_greenfield_tests_ready.png | preparer (Infinia Deal Lead) | A Concept-stage greenfield that names a secured funding source shows the "Greenfield extra tests cleared" card: "Stage: Concept. Funding source named and secured." with the Concept 2-page note rule. |
| preparer_greenfield_submit_blocked.png | preparer (Infinia Deal Lead) | Submitting the unsecured Feasibility entry is refused: the form shows the block card and a "Submission blocked" result rather than success. |

## How it works

server/config/greenfield.js declares GREENFIELD_TYPE, the three stages
(GREENFIELD_STAGES — Concept documents_required:false, Feasibility, Initiate),
the capture fields, the thesis and funding fields, SECURED_FUNDING_STATUS, the
messages and pure evaluateGreenfield(data) — null for a non-greenfield entry,
otherwise it requires a stage, a quantified benefit, the thesis, a budget status
and a named secured source, returning the open stops and documents_required.
server/gate.js calls it before the document loop so a Concept-stage entry waives
the required-document gate, returns greenfield from evaluateGate and
GET /api/gate/fields ({stages, concept_note_max_pages}), and the submit route
returns 422 GREENFIELD_NOT_READY with a submit_blocked audit (greenfield_stops)
until the extra tests clear. src/pages/SubmitOpportunity.jsx renders the two
cards (data-testid="greenfield-tests" and "greenfield-tests-ready").

Fixtures: seed-greenfield — a Concept-stage greenfield that clears the tests
(secured Sirius balance sheet, no document pack required); and
seed-greenfield-unfunded — a Feasibility-stage greenfield with unsecured
funding, blocked on submit.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-07

Tests: server/tests/greenfield.test.js (9 pass) and the W1-07 block in
server/tests/m2.test.js (4 pass). Commit: feat(intake): greenfield extra tests
(W1-07).

