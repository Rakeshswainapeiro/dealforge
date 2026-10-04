# W4-03 - Versioned strategy profile recorded per screening (ENT-01)

## What this delivers

Every screening now records the strategy profile version that was in force when
the screen ran. The screening panel shows a **Strategy profile in force** card
naming the published version and the source documents behind it, and a
`screening_record` row holds the same version alongside the alignment score, the
indexed-document count and the panel version. When a new profile version is
published, the next screening records the new version, and the version change is
an audit event - so the retained screening record is self-explanatory and the
mandate that was applied can always be reconstructed.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Preparer (Infinia deal lead) | Strategy profile in force | preparer_strategy_profile_in_force.png | The screening panel for Vision Care Imaging Platform: the **Strategy profile in force** card with the **v1** badge and "1 source document(s) in force - 1 document(s) indexed", sitting directly above the mandate alignment score. |

## How it works

1. server/db.js adds the `screening_record` table (one row per opportunity,
   unique by opportunity_id) holding the strategy profile id and version, the
   indexed-document count, the alignment score, the panel version and the
   recommended outcome.
2. server/strategy.js adds `recordScreeningSnapshot(opportunityId, ...)` (upsert
   by opportunity, audited when the profile version changes) and
   `getScreeningSnapshot(opportunityId)`.
3. server/pipeline.js loads the latest published profile on the screening route
   (alongside the strategy corpus), records the snapshot, and returns both
   `screening.strategy_profile` (the version in force) and
   `screening.screening_record` (the retained record).
4. server/mvpSeed.js publishes an initial versioned profile per pilot entity
   idempotently, so the demo screening record has a version in force.
5. src/pages/ScreeningBoard.jsx renders the **Strategy profile in force** card
   (data-testid="strategy-profile-in-force", "strategy-profile-version").

## Validation

- BASE_URL=http://localhost:34099 npm run test:server - 560 pass / 130 suites,
  including the two W4-03 integration cases: the panel records the published
  profile version in force (panel and screening_record agree), and a newly
  published version is reflected on the next screening.
- npm run build and eslint clean on the touched files.
- Demo verification: after a rebuild, GET /api/strategy/profile shows version 1
  published for Infinia, and the Vision Care panel renders the in-force card.

## Notes

Fixtures: the seeded Infinia profile (published by system@dealforge.local over
the Infinia Technology Strategy 2026 document) backs the demo. Evidence captured
against the demo stack at http://localhost:34010 from the mvp seed profile.
