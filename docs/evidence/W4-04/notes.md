# W4-04 - Versioned, admin-editable Sirius group mandate (ENT-03)

## What this delivers

The Sirius group mandate is now versioned configuration an administrator can
edit from the app. It captures the sectors in scope, the geographic posture, the
stage and instrument policy, the ticket band, the holding horizon, the
governance stance and the anchor "one billion people into the digital economy by
2030" objective - all grounded in the client brief. Every save mints the next
revision (`SM-01.N`) and records an audit event naming the fields that changed,
so a screening's mandate can always be reconstructed. The mandate also feeds an
advisory fit block on the screening panel: whether a submission's sector and
geography sit inside the group mandate and whether the commitment sits in the
ticket band. The fit is reference data only - it never blocks a submission.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Admin | Group Mandate tab | admin_sirius_mandate_admin.png | The **Group Mandate** tab in Settings: the **SM-01.1** revision badge, **7 sectors**, the sector chips (Technology, Financial Services, Business Services, Healthcare, Energy, Industrials, Telecommunications), the core geographies (UAE, GCC) with the 16+ markets posture, the stage and instrument policy, and the objective and ticket card with the pending-confirmation flag. |

## How it works

1. server/config/siriusMandateData.js holds the hand-authored vocabulary and the
   shipped default mandate, grounded in the Sirius investment brief (the seven
   operating clusters, the sectors in scope, the UAE/GCC core and 16+ markets,
   the 1bn-people objective, the instrument and stage policy).
2. server/config/siriusMandate.js is the pure module: `defaultSiriusMandate()`,
   `validateSiriusMandate()`, `resolveSiriusMandate()` (fallback), the diff and
   `buildSiriusMandate()` (mints revision + 1 and the `SM-01.N` version), plus
   the advisory `mandateFit()` helper.
3. server/mandate.js is the API: it holds the mandate in an AppSettings record
   (setting_key = 'sirius_mandate_config'), exposes `GET /api/mandate` (effective
   mandate + defaults + vocabulary), `PUT /api/mandate` (admin-only, mints a
   revision, writes the audit event) and `GET /api/mandate/history`.
4. server/index.js mounts the router at /api/mandate; server/gate.js loads the
   mandate and adds the advisory `mandate_fit` block to `evaluateGate()` and to
   the `GET /api/gate/fields` config payload; server/config/screeningPanel.js
   carries `mandate_fit` through the panel.
5. src/api/client.js adds the mandate methods and src/pages/Settings.jsx adds the
   **Group Mandate** tab with the revision badge and admin-only editing.

## Validation

- node --test server/tests/siriusMandate.test.js - 18 pass, 6 suites (shipped
  shape, validation rules, resolve fallback, revision minting, diff, fit).
- BASE_URL=http://localhost:34099 node --test server/tests/*.test.js - 586 pass
  / 138 suites, including the four W4-04 integration cases: a reader sees the
  effective mandate + defaults, a deal lead gets 403 on PUT, an admin edit mints
  revision + 1 and is recorded in history, and the screening panel carries the
  advisory mandate fit.
- eslint clean on the touched files; npm run build passes.
- Demo verification: GET /api/mandate on the demo stack returns SM-01.1 with the
  seven sectors in scope.

## Notes

Default content is grounded in research/client/Sirius_Investment_Brief_2page.pdf.
The ticket band ceiling and the holding horizon are flagged as pending client
confirmation (open decision Q3) and never gate a submission. Evidence captured
against the demo stack at http://localhost:34010.
