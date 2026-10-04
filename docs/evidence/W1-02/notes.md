# W1-02 — Below-floor exception route (synergy statement + IRR >= 35%)

**Persona:** preparer (Infinia Deal Lead, `deal.lead@infinia.local`)
**Feature covered:** the INT-03 exception path for a ticket under the AED 10mn
floor. A sub-floor opportunity may proceed only when the preparer asserts a
portfolio synergy **and** a base-case IRR of at least 35%. Such a case is tagged
"Below-floor exception" and escalated to Sirius; it cannot be closed at
subsidiary level.

## Shots

| File | What it proves |
|------|----------------|
| `preparer_below_floor_tagged.png` | The seeded fixture **Small Bolt-on with Portfolio Synergy** (AED 6mn, IRR 35%, synergy statement present) shows *"Tagged as a below-floor exception and escalated to Sirius; the case cannot be closed at subsidiary level."* |
| `preparer_below_floor_route_incomplete.png` | **Sub-floor Ticket (exception incomplete)** (AED 4mn, IRR 31%, no synergy statement) shows the amber route-incomplete alert listing both missing items: the synergy statement and a base-case IRR of at least 35%. |
| `preparer_below_floor_submit_blocked.png` | Submitting that incomplete case returns **422** and the form shows *"Submission blocked: the below-floor exception route needs a synergy statement and an IRR of at least 35%."* The ticket stays at subsidiary level. |

## How it works

`server/config/belowFloor.js` owns the tag, the two required fields, the stop
messages, the escalation target and the pure `evaluateBelowFloor` decision.
`server/config/selfScreen.js` folds that decision into the pre-form result, and
`server/gate.js` folds it into the gate payload and enforces it in the submit
route:

- `GET /api/gate/status/:id` returns `gate.below_floor` (null when the ticket is
  at or above the floor).
- `POST /opportunities/:id/submit` returns **422** and audits a `submit_blocked`
  event (`below_floor_stops`) when the route applies but is not satisfied.
- On success it stamps `below_floor_exception`, `below_floor_tag`,
  `below_floor_escalated` and `below_floor_escalated_at` on the record, writes a
  `pipeline_transition` comment, and records a `below_floor_escalation`
  notification to `deal.lead@sirius.local` (Sirius investment-team review).

The form (`src/pages/SubmitOpportunity.jsx`) renders the amber
`below-floor-route` alert while the route is incomplete and the teal
`below-floor-tagged` alert once it is satisfied.

## Reproduce

```
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-02
```

The demo stack must be rebuilt after the fixture change (the loader is keyed by
a stable id and the demo DB is otherwise stale):

```
docker compose -p dealforge-demo -f docker-compose.demo.yml down -v
docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build
```

## Tests

`server/tests/belowFloor.test.js` (6 pass) covers the pure evaluator: not
below the floor, exception required, synergy required, IRR floor, the qualifying
case and the boundary at exactly 35%. `server/tests/m2.test.js` covers the
route end to end — no-exception block, incomplete-exception block (422 with
stops), and the qualifying case that submits, is tagged and escalated.

