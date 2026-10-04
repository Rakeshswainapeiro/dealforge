# W3-08 - Scorecard configuration admin (SCO-05)

## What this delivers

The Gate 2 scorecard is now a versioned configuration an administrator can
recalibrate at runtime: the seven criteria and their weights, the 1-5 pass bar,
the two lenses and the lens floor, all held in a single AppSettings record
(setting_key = 'scorecard_config'). Every save mints the next revision and a
matching version string (SC-01.N). Each opportunity keeps the revision it was
scored under, so a recalibration never silently rewrites a historical score:
the stored capture records the version, and the audit event for the recalibration
carries the field-level diff.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Admin (Local Admin) | Scorecard config editor | admin_scorecard_config_admin.png | The Scorecard Config tab with the pass bar (3.5), the lens floor (3), all seven criteria with editable weights and a live "Total 100%" badge, the two lenses, and the revision badge "SC-01.3 (rev 3)". |
| Admin (Local Admin) | Save as new revision | admin_scorecard_config_save_revision.png | After raising the pass bar to 3.6 and saving, the revision badge advances to "SC-01.4 (rev 4)" and the confirmation reads "Scorecard configuration saved under a new revision." The stored history keeps earlier captures at SC-01.3. |

## How it works

1. GET /api/gate/scorecard-config returns the effective configuration plus its
   validation report and the shipped defaults (any authenticated reader).
2. PUT /api/gate/scorecard-config requires the admin / configurator role
   (canConfigure). buildScorecardConfig validates the payload (keys present and
   unique, weights summing to 100, lenses referencing known criteria, the pass
   bar and lens floor within 1-5), mints revision + 1, and persists it. An
   invalid payload is refused with a 400 and the list of errors.
3. loadScorecardConfig resolves the stored record for the gate, the fields
   endpoint and the scorecard capture route; a missing or invalid record falls
   back to the shipped defaults, so the gate never depends on a row.
4. POST /opportunities/:id/scorecard stamps the capture with the version in
   force at capture time; the audit event records it, so the historical
   calibration is traceable even after a later revision.
5. The Settings > Scorecard Config tab shows the config for admins and
   read-only for everyone else; Save stays disabled unless the weights total 100.

## Validation

- node --test server/tests/scorecard.test.js - 31 pass (7 new SCO-05 cases:
  default shape, invalid weight total / unknown lens criterion / out-of-range
  pass bar refused, revision minting, resolve fallback, diff, custom criteria
  evaluation, version stamping).
- BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js - 47 pass.
  The SCO-05 case proves a deal-lead gets 403, an admin recalibration advances
  the revision and serves the new bar, and a capture made before the change
  keeps its original version.
- npm run build and eslint clean on the touched files.

## Notes

- The config editor follows the existing Feature Visibility pattern in Settings,
  so W8-03 (unified admin config) can fold them into one surface later.
- Evidence captured against the demo stack at http://localhost:34010 from the
  mvp seed profile.

