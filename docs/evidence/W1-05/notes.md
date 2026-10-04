# W1-05 — Ten qualifying gates checklist (INT-08)

**Persona:** preparer (Infinia Deal Lead, `deal.lead@infinia.local`)
**Feature covered:** the BRD INT-08 qualifying-gates checklist. The ten gates —
**right size, eligible type, accretive, strategic fit, clears hurdles, funded,
budgeted, risk owned, clean governance, executable** — are shown as a checklist.
Each gate needs an explicit **Yes** plus its linked evidence (a captured field).
A **No** on any gate (or a Yes with the evidence missing) blocks submission with
the not-ready message: "Not ready: this opportunity is not ready to submit.
Every qualifying gate must be answered YES with its evidence linked."

## Shots

| File | What it proves |
|------|----------------|
| `preparer_qualifying_gates_all_ready.png` | The seeded fixture **Vision Care Imaging Platform** shows all ten gates answered **Yes** with each evidence field present; the card reads "All ten ready". |
| `preparer_qualifying_gate_no_blocked.png` | **Bolt-on (not accretive)** answers the *Accretive* gate **No**; the card flags "1 gate(s) blocking", shows the red **Not ready** alert with the INT-08 message, and the gate card explains "Answered NO: the opportunity is not ready on Accretive". |
| `preparer_qualifying_gate_submit_blocked.png` | Submitting that draft returns **422** and the form shows a **Submission blocked** toast with the not-ready message; the case cannot leave subsidiary level. |

## How it works

`server/config/qualifyingGates.js` is the single source for the ten gates, their
order, questions and evidence mapping, the answer field keys (`gate_<key>`) and
the pure `evaluateQualifyingGates(data)` decision. `server/gate.js` folds the
evaluation into every gate payload and enforces it in the submit route:

- `GET /api/gate/fields` returns `qualifying_gates` (number, key, label,
  question, answer_key, evidence) so the form renders the checklist from config.
- `GET /api/gate/status/:id` returns `gate.qualifying_gates` with per-gate
  `answer`, `evidence`, `ready` and `reason`, plus `complete`, `blocking` and
  `message`.
- `POST /opportunities/:id/submit` returns **422** with the not-ready message and
  audits a `submit_blocked` event (`qualifying_gates_blocking`) when any gate is
  not ready. Ordering: self-screen → document gate → below-floor route →
  qualifying gates, so the earlier, stricter blocks still win.

The form (`src/pages/SubmitOpportunity.jsx`) renders the `qualifying-gates` card
with a Yes/No control per gate (`gate-<key>`), the question, the evidence rows
with present/absent ticks, and a blocking summary. The submitted answer keys fly
with the payload because `allFields` merges the gate answer keys alongside the
six-section pack.

## Fixtures

Every seeded opportunity answers **Yes** to all ten gates (the evidence fields
are already in `fullFields()`). The negative fixture `seed-qualifying-no`
(**Bolt-on (not accretive)**) answers *Accretive* **No** so the block is
reproducible from a clean load.

## Reproduce

```
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-05
```

The demo stack must be rebuilt after the fixture change:

```
docker compose -p dealforge-demo -f docker-compose.demo.yml down -v
docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build
```

## Tests

`server/tests/qualifyingGates.test.js` (7 pass) covers the pure evaluator: the
ten gates in BRD order, all-Yes complete, a single No blocking with a reason, an
unanswered gate, a Yes with missing evidence, the three-field clean-governance
gate and the empty opportunity. `server/tests/m2.test.js` and the UAT suite
submit through the checklist end to end.
