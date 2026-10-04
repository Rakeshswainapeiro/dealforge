# W3-09 - Overall quality score (SCO-01)

## What this delivers

Every screened opportunity now carries a single advisory 0-100% quality score
that rolls up the whole pre-screening picture: eligibility and completeness,
Gate 1 hard filters, Gate 1 soft filters, return hurdles, strategic alignment
and the Gate 2 scorecard. Each component keeps its own 0-100 sub-score and
weight, so a reviewer can see not just the headline number but which lens is
holding the deal back. When a component has no data (for example no scorecard
captured yet) its weight is redistributed across the available components and
the gap is named, so the score never silently punishes a deal for information
nobody has entered.

The weights and the three band thresholds (Strong / Moderate / Weak) are a
versioned configuration. The shipped default is 15/15/10/20/15/25 summing to
100, with Strong at 75 and Moderate at 50. Saving edits mints the next revision
(QS-01.N) on top of the AppSettings record, so calibration changes are traceable
the same way the scorecard is.

The score is advisory only. The panel states it in plain text and the disclaimer
below it repeats it: the system never rejects an opportunity on its own; a
person takes the screening decision after reviewing the checks.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | Quality score breakdown | analyst_quality_score_breakdown.png | The "Overall quality score (advisory)" card on the screening panel: the headline "67.7% - Moderate" band badge, and the six component rows with their weights and sub-scores (Eligibility 100, hard filters 56, soft filters 53.4, hurdles 80, alignment 40, scorecard no data), plus the SCO-01.1 advisory line. |
| Admin (Local Admin) | Quality Score config tab | admin_quality_config_admin.png | The Settings > Quality Score tab: the six component weights with a live "Total 100%" badge, the three band minimums (Strong 75, Moderate 50, Weak 0), the revision badge "SCO-01.1 (rev 1)" and the Save as new revision action. |

## How it works

1. GET /api/gate/quality-score-config returns the effective configuration plus
   its validation report and the shipped defaults (any authenticated reader).
2. PUT /api/gate/quality-score-config requires the admin / configurator role
   (canConfigure). buildQualityScoreConfig validates the payload (the six known
   component keys present and unique, weights summing to 100, band minimums in
   0-100 with exactly one at 0), mints revision + 1 and persists it. An invalid
   payload is refused with a 400 and the list of errors.
3. loadQualityScoreConfig resolves the stored record for the panel and the
   fields endpoint; a missing or invalid record falls back to the shipped
   defaults, so the panel never depends on a row.
4. evaluateQualityScore scores each component 0-100, applies the configured
   weights, redistributes weight away from components with no data, and maps the
   total to a band. It returns the component breakdown, the available and
   unavailable lists, the score, the band and the message.
5. The screening panel embeds the result as screening.quality_score; the
   Screening Board renders it as the quality-score card directly above the
   disclaimer.

## Validation

- node --test server/tests/qualityScore.test.js - 9 pass (default shape,
  invalid weight total / duplicate keys / band minimums refused, revision
  minting, resolve fallback, weighted scoring with redistribution, banding).
- BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js - 49 pass.
  The SCO-01 case proves the panel exposes the advisory score with its component
  breakdown and that a deal-lead gets 403 on the config while an admin save
  advances the revision.
- npm run build and eslint clean on the touched files.

## Notes

The config editor follows the existing Scorecard Config / Feature Visibility
pattern in Settings, so W8-03 (unified admin config) can fold them into one
surface later. Evidence captured against the demo stack at http://localhost:34010
from the mvp seed profile.

