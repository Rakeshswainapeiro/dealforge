# Known test gaps (as of the Reviewer Workspace work)

## `server/tests/aiGovernanceApi.test.js`: 5 of 7 subtests fail (pre-existing)

- **Not caused by the Reviewer Workspace.** The same 5 fail with that work stashed.
- **Why it fails:** the suite is a live-HTTP test. It targets `BASE_URL`, default `http://localhost:34000` (the Docker app),
  and signs in with `ADMIN_EMAIL` (default `admin@dealforge.local`) and `DEFAULT_USER_PASSWORD` (default `DealForge!2026`).
  Against the dev stack the sign-ins are not accepted, so the calls return a different status than the suite expects
  (200 expected in two subtests, 403 in two, 400 in one).
- **Passing:** the 2 subtests that need no sign-in.
- **To run it properly:** start the stack on `:34000` with these credentials seeded and run
  `BASE_URL=http://localhost:34000 node --test server/tests/aiGovernanceApi.test.js`.
  A passing run is needed before treating the AI-governance API as verified.

## Live-HTTP suites not yet run: `m3`, `m4`, `m5`, `m6`, `uat`

- They need a server started with `AUTH_ALLOW_HEADER_IDENTITY=1`. This was not started against the shared dev database.
- **Pending:** run them against a disposable database or a CI environment with that flag, then record the result here.

## Full list of live-HTTP suites (21 files, all pending a suitable environment)

These files target a running server (`BASE_URL`, default `http://localhost:34000`) and were not run against the shared dev database:
`admin`, `adminConfigApi`, `aiGovernanceApi`, `auth`, `authDenyByDefault`, `bulkImportApi`, `dataroomLinkApi`, `features`, `i18nApi`,
`identityPolicy`, `m1`, `m2`, `m3`, `m4`, `m5`, `m6`, `memoVerification`, `residency`, `seedCleanup`, `uat`, `userAdminApi`
(all under `server/tests/`). The other suites, 938 tests, run in-process and pass.

## Schema note

- `qa_thread.section` is added by `server/db.js` (`ADD COLUMN IF NOT EXISTS`). Where the app runs with `DB_MIGRATE_ON_BOOT=0`,
  run `npm run migrate` as the schema-owner role on each environment.
