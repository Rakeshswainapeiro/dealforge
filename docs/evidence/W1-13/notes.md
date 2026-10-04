# W1-13 — Screenshot-evidence validation

**Persona:** admin
**Feature covered:** the structured evidence convention itself — every Done TODO
carries a screenshot at `docs/evidence/<TODO-ID>/<persona>_<feature>.png`.

## Shot

| File | What it proves |
|------|----------------|
| `admin_evidence_index.png` | A contact sheet generated from the on-disk tree: W1-03 (1 shot), W1-04 (1), W1-11 (2) and W1-12 (4), each filed under its journey persona. |

## How it works

`scripts/capture_evidence.mjs` drives real Chrome (via `playwright-core`, kept out of
the app dependency graph) against the demo stack, signs in as each journey persona's
seeded account, and writes one PNG per acceptance criterion to the structured path.
`scripts/generate_evidence_index.mjs` reads that tree back and renders this sheet.

The tracker rule: a row is only set to **Done** once its evidence folder holds the
matching shot; rows without evidence stay **In progress**. W1-03, W1-04, W1-11 and
W1-12 are promoted under the rule and are the rows currently carrying evidence.

## Reproduce

```
BASE=http://localhost:34010 node scripts/capture_evidence.mjs
node scripts/generate_evidence_index.mjs
```

## Notes

The demo database was missing the `abac_policy` table, which made every
`/api/entities/*` read return HTTP 500 until someone hit `/api/abac`. `initDb()`
now calls `ensureAbacSchema()` at boot (see `server/db.js`) so a fresh deployment
creates it up front; that is why the intake and screening shots show fixtures.
