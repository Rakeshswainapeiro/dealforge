# W1-12 — MVP sample mapping (deterministic fixtures)

**Personas:** admin, preparer, analyst
**Feature covered:** the deterministic fixture set derived from the Sirius org tree
and the nature-of-business map, visible along the real persona journeys.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| `admin_sample_inventory.png` | admin | The live seed inventory after loading the `mvp` profile: 10 sample opportunities, 19 submission documents, 12 pipeline transitions, 16 route participants, 20 notifications. |
| `preparer_intake_fixtures.png` | preparer (Infinia Deal Lead) | The intake list shows the fixtures in their loaded states — Screening, Draft, Submitted badges — not a blank form. |
| `analyst_screening_fixtures.png` | analyst (Sirius CIO) | Screening Board carries the theme-aligned, conflict and related-party cases: Submission 1 / Screening 4 / Refinement 1, with the exact fixture names. |
| `preparer_fixture_state_refinement.png` | preparer (Finstreet Deal Lead) | The Finstreet-owned fixture sits in **Refinement**, proving the loader walked real transitions and not only drafts. |

## How it works

`server/config/mvpSeed.js` declares the 14 fixtures and the persona cast;
`server/mvpSeed.js` inserts each opportunity and then walks the real
pipeline-transition, submission-route, document, related-party and notification
paths so the sample data exercises production code. The mapping is documented in
`docs/sample-data/MVP_Sample_Data_Map.md`. One command loads it:
`node seedCli.js --profile=mvp`.

Fixture states as loaded: draft 4, screening 4, submission 1, refinement 1.

## Reproduce

```
docker compose -f docker-compose.demo.yml up --build   # SEED_PROFILE=mvp
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-12
```

## Tests

`server/tests/seedCleanup.test.js` and `server/tests/m6.test.js` (10 pass).

## Commit

`e5eda59 feat(seed): MVP sample fixtures and profile-driven loader (W1-12)`
