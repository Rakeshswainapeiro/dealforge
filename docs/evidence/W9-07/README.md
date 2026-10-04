# W9-07 — Usability UAT run sheet (NFR-07)

NFR-07 asks a pilot to complete a submission **unaided**, with no help from the
delivery team. That proof is a recorded human session, so this folder holds the
run sheet and the session template, and `scripts/usability_uat.mjs` scores the
recorded sessions against the gate in `server/config/usability.js`.

## Gate

- At least **3** pilot sessions.
- At least **80%** of pilots complete every gate task unaided.
- **No critical** usability issue.
- Mean **SUS >= 68**.

Gate tasks (scored): `capture`, `documents`, `draft`, `sign`, `status`.
Warm-up tasks (not scored): `login`, `self_screen`.

## Run sheet

1. Stand up the demo stack (`docker compose -p dealforge-demo -f docker-compose.demo.yml up -d`).
2. Give the pilot a seat and a one-line goal: *"Submit a real opportunity end to end."* Do not guide.
3. Record each task's outcome and whether you had to step in (assisted = true).
4. After the session, the pilot completes the 10-question SUS.
5. Save the session into `sessions.json` (copy `sessions.example.json`).
6. Score: `node scripts/usability_uat.mjs`. Fix any critical issue before re-running.

## Session template

```json
{
  "pilots": [
    {
      "pilot": "pilot-1",
      "sus": 78,
      "tasks": [
        { "id": "login",       "success": true, "assisted": false },
        { "id": "self_screen", "success": true, "assisted": false },
        { "id": "capture",     "success": true, "assisted": false },
        { "id": "documents",   "success": true, "assisted": false },
        { "id": "draft",       "success": true, "assisted": false },
        { "id": "sign",        "success": true, "assisted": false },
        { "id": "status",      "success": true, "assisted": false }
      ],
      "issues": []
    }
  ]
}
```

## Status

Not yet run — awaiting pilot availability (Sirius/finstreet subsidiary user).
Tracked as an open release dependency; the row is **Blocked**, not Done.
