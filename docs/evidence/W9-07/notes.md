# W9-07 — Usability UAT (BRD NFR-07)

Requirement: **NFR-07** — a pilot user completes a submission **unaided**, with
no support from the delivery team.

## What is deliverable in code

The proof of NFR-07 is a recorded human session, not a code artifact. What the
platform contributes is an objective, reproducible way to score those sessions:

- `server/config/usability.js` — the pilot task catalog (which tasks are the
  gate and which are warm-up), the acceptance thresholds (>=3 pilots, >=80%
  unaided, 0 critical issues, mean SUS >=68) and a pure scorer that decides
  whether a pilot completed every gate task with no assistance.
- `scripts/usability_uat.mjs` — reads recorded sessions
  (`docs/evidence/W9-07/sessions.json`), prints the verdict, and exits non-zero
  when recorded sessions miss the criteria so the release gate blocks.
- `server/tests/usability.test.js` — 8 tests covering the scorer and the gate
  (assistance, failure, too few pilots, a critical issue, a low SUS, a passing
  set).

## Why this row is Blocked

There is no pilot session recorded yet — the pilot (a Sirius/finstreet
subsidiary user) is not available in this environment. Running the harness with
no sessions reports the gate as **PENDING** and does not claim a pass:

```
Usability UAT (NFR-07): no pilot sessions recorded yet.
Gate PENDING — awaiting pilot session(s) at docs/evidence/W9-07/sessions.json
```

The platform already supports the unaided path the pilot will exercise: the
guided six-section form, the pre-form self-screen that seeds the header, and
save-as-draft, all covered by the existing W1 evidence. The remaining item is
the human UAT session itself.

## What completes it

Run the run sheet in `docs/evidence/W9-07/README.md`, save `sessions.json`, run
`node scripts/usability_uat.mjs`, and attach the PASS output. Until then NFR-07
stays **Partial** and this row **Blocked**.
