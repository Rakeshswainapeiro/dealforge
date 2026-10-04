# W9-05 — Backup / restore rehearsal (BRD NFR-05)

Requirement: **NFR-05** — backups in place (RPO 24h) and a rehearsed restore
within the RTO (8h).

## What was done

- **Reproducible rehearsal.** `scripts/backup_restore_rehearsal.mjs` drives a
  real Postgres cycle against the running container: a journal-consistent
  custom-format `pg_dump`, a restore into a scratch database, and a row-count
  reconciliation of the two verified tables (`entity_record`, `audit_event`).
  It measures backup and restore wall-clock time, writes a JSON report and
  **exits non-zero when the restored counts do not match the source or the
  restore exceeds the RTO**, so the rehearsal can gate a release.
- **Shared gate.** `server/config/backupRestore.js` holds the backend-agnostic
  policy (RPO 24h, RTO 8h, verified tables) and `evaluateRehearsal`, which the
  script calls with the measured numbers. The gate is unit-tested independently
  of any live container.
- **Runbook.** `RUNBOOK.md` documents what to back up (Postgres, uploads volume/
  object store, operator-managed `.env`), the rehearsed backup and restore
  commands, post-restore verification and the retention schedule.

## Rehearsal result (recorded)

| Metric | Value |
|---|---|
| backup time | 2547 ms |
| dump size | 39,148,107 bytes (~37 MB) |
| source `entity_record` | 16610 |
| restored `entity_record` | 16610 |
| source `audit_event` | 106098 |
| restored `audit_event` | 106098 |
| restore time | 4588 ms (RTO 5s vs 28800s target) |
| counts match | **yes** |
| gate | **pass** |

## Notes

- RPO is a schedule property (nightly `pg_dump` plus uploads/object sync to
  off-host storage), recorded in the runbook rather than measured here.
- The database is the metadata source of truth; the object store holds the
  bytes. A restore of the database alone leaves document hashes unverifiable,
  so the runbook backs up both.
- A failed rehearsal (count mismatch or over-RTO) is a release blocker.

## Evidence

- `docs/evidence/W9-05/backup_restore_report.json` — the measured rehearsal
  output from `scripts/backup_restore_rehearsal.mjs`.
- `RUNBOOK.md` — the backup/restore runbook the script follows.

## Tests

- `server/tests/backupRestore.test.js` — 5 pass: targets, a passing rehearsal,
  a count mismatch, a missing table and an over-RTO restore all gate correctly.
