# W1-01 — Pre-form self-screen with stop messages

**Persona:** preparer (Infinia Deal Lead, `deal.lead@infinia.local`)
**Feature covered:** the six-question self-screen (type, commitment, sector,
geography, in-plan, related party) that runs before any drafting, halting
outside-appetite types and below-floor tickets with an explicit reason.

## Shots

| File | What it proves |
|------|----------------|
| `preparer_self_screen_stop.png` | An outside-appetite type ("Passive, non-strategic punt") stops with the reason *"Outside appetite: this opportunity type is not one Sirius invests in without a new mandate."* The capture form stays locked. |
| `preparer_self_screen_pass.png` | A clean in-appetite, above-floor case clears all six checks and opens the capture form. |

## How it works

`server/config/selfScreen.js` owns the questions, options, stop/flag codes and
messages. `evaluateSelfScreen` is pure and returns a decision: `stop` when a
hard rule fires, `pass_with_flags` when only advisory flags remain, else `pass`.

The server is the source of truth:

- `GET /api/gate/fields` serves `self_screen` (the ordered questions).
- `POST /api/gate/self-screen` returns the evaluation without persisting anything.
- `POST /opportunities/:id/submit` returns **422** and audits a
  `submit_blocked` event when the saved answers fail the screen.

Hard stops: outside-appetite type (REQ-RULE-04) and commitment below the
AED 10mn floor unless the below-floor exception is chosen (REQ-RULE-02, finished
in W1-02). Advisory flags: not-in-plan, related party, out-of-scope geography and
a sector/theme mismatch. Sourcing-channel referrals (`ihc_affiliate_referral`)
derive the related-party answer.

## Reproduce

```
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-01
```

## Tests

`server/tests/selfscreen.test.js` (12 pass) covers the questions, floor, decisions,
boundary and flags. `server/tests/m2.test.js` (18 pass) covers the endpoint, the
status surface and the blocked submit.
