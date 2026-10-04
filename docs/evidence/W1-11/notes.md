# W1-11 — Clean all sample / demo data

**Persona:** admin (Local Admin, `admin@dealforge.local`)
**Feature covered:** the operator surface for the sample-data profile — resolved
profile, clean/load/reload controls, and the live seed inventory.

## Shots

| File | What it proves |
|------|----------------|
| `admin_sample_data_console.png` | Super Admin → **Sample Data** shows the resolved profile `mvp`, the environment (`SEED_PROFILE · SEED_DEMO_DATA · SEED_CLEAN`) and the Clean / Load / Reload controls that implement REQ-SEED-02. |
| `admin_seed_audit_trail.png` | Super Admin → **Audit** shows the `seed_better_auth` events written when the loader mirrored the Sirius org tree and cast, i.e. seeding is audited. |

## How it works

`server/seedRun.js` resolves a profile (`base` | `mvp` | `off`, `server/seedProfiles.js`)
and calls `server/seedCleanup.js` (`cleanSeedData`) when `SEED_CLEAN=1`. Cleanup is
scoped to rows tagged `seed: true` / `seed_profile`, so the Sirius org subtree and the
protected cast survive. The same engine is reachable from boot, from the CLI
(`server/seedCli.js --profile=off --clean`) and from `GET/POST /api/admin/seed`,
which backs the **Sample Data** tab.

## Reproduce

```
cd server
DATABASE_URL=postgres://dealforge:dealforge@localhost:34001/dealforge \
  node seedCli.js --profile=mvp --clean --force
# run again: removes 0 rows (idempotent)
DATABASE_URL=postgres://dealforge:dealforge@localhost:34001/dealforge \
  node seedCli.js --profile=off --clean --force   # leaves zero seed rows
```

Screenshots: `BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-11`

## Tests

`server/tests/seedCleanup.test.js` (5 pass, opt-in `SEED_TEST=1`) and
`server/tests/seedProfiles.test.js` (7 pass).

## Commit

`57cda82 feat(seed): sample-data cleanup engine and seed tagging (W1-11)`
