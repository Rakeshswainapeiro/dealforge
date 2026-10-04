# DealForge — Backup & Restore Runbook

Scope: the MVP deployment described in `docker-compose.yml` — a single
Postgres 16 instance and the uploads volume. ObjectIO (or any S3-compatible
store) is documented as the object-storage variant; the local-disk mode is the
default and is what the rehearsal below covers.

This runbook is required by the MVP release criteria (plan §10 item 6) and the
availability NFR (plan §9). Every command here was rehearsed against the running
compose stack.

The rehearsal is scripted and repeatable:

```sh
# Drives a real pg_dump + scratch-database restore and reconciles row counts.
# Exits non-zero when the counts do not match or the restore exceeds the RTO.
node scripts/backup_restore_rehearsal.mjs \
  --out docs/evidence/W9-05/backup_restore_report.json
```

The gate lives in `server/config/backupRestore.js` (RPO 24h, RTO 8h, verified
tables `entity_record` and `audit_event`) and is unit-tested in
`server/tests/backupRestore.test.js`. The commands below are the manual form of
the same rehearsal.

## 1. What to back up

| Component | Contents | Where it lives |
|---|---|---|
| Postgres | every entity record, membership, audit event, workflow, theme, document metadata | `pgdata` volume |
| Uploads | original document bytes (local-disk storage mode) | `uploads` volume |
| Object store | the same document bytes when `S3_ENDPOINT` is set | the configured bucket/prefix |
| Config | `.env` (secrets, endpoints) | operator-managed, never committed |

The database is the source of truth for metadata; the object store holds only
the bytes. A restore that brings back the database without the bytes yields
document records whose hashes can no longer be verified, so back up both.

## 2. Rehearsed backup

```sh
# Postgres — custom format, compressed, journal-consistent.
docker exec dealforge-db-1 pg_dump -U dealforge -d dealforge -Fc -f /tmp/dealforge.dump
docker cp dealforge-db-1:/tmp/dealforge.dump ./backup/dealforge-$(date +%Y%m%d-%H%M).dump

# Uploads volume (local-disk storage mode only).
docker run --rm -v dealforge_uploads:/data -v "$PWD/backup":/backup \
  alpine tar czf /backup/uploads-$(date +%Y%m%d-%H%M).tgz -C /data .
```

With object storage enabled, replace the uploads step with a bucket sync:

```sh
# Any S3-compatible client; ${S3_BUCKET}/${S3_PREFIX} come from .env.
aws --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$S3_BUCKET/$S3_PREFIX" ./backup/objects/
```

Rehearsal result: a 372 KB `-Fc` dump from the seeded database, and a 16 KB
tar of the uploads volume, both produced without stopping the application.

## 3. Rehearsed restore

Restore into a scratch database first. Never restore over the live database
without a fresh backup of the current state.

```sh
# 1. Create a scratch database.
docker exec dealforge-db-1 psql -U dealforge -d postgres -c "DROP DATABASE IF EXISTS dealforge_restore_test;"
docker exec dealforge-db-1 psql -U dealforge -d postgres -c "CREATE DATABASE dealforge_restore_test;"

# 2. Restore the dump into it.
docker cp ./backup/dealforge-YYYYMMDD-HHMM.dump dealforge-db-1:/tmp/restore.dump
docker exec dealforge-db-1 pg_restore -U dealforge -d dealforge_restore_test /tmp/restore.dump

# 3. Verify the restore before trusting it.
docker exec dealforge-db-1 psql -U dealforge -d dealforge_restore_test -tAc "select count(*) from entity_record;"
```

Rehearsal result: the scratch database returned **361** `entity_record` rows,
matching the source database exactly.

To promote a verified restore, stop the app, replace the live database, then
start it again:

```sh
docker compose stop app
docker exec dealforge-db-1 psql -U dealforge -d postgres -c "DROP DATABASE dealforge;"
docker exec dealforge-db-1 psql -U dealforge -d postgres -c "CREATE DATABASE dealforge;"
docker exec dealforge-db-1 pg_restore -U dealforge -d dealforge /tmp/restore.dump
docker compose start app
```

For the uploads volume, extract the archive back into the volume:

```sh
docker run --rm -v dealforge_uploads:/data -v "$PWD/backup":/backup \
  alpine sh -c "cd /data && tar xzf /backup/uploads-YYYYMMDD-HHMM.tgz"
```

## 4. Post-restore verification

1. Health: `curl -s http://localhost:34000/api/health` returns `{"status":"ok",...}`.
2. Counts: `entity_record` and `audit_event` row counts match the source.
3. Documents: open an opportunity in the screening board and download a
   document; the stored SHA-256 is recomputed and compared on read.
4. Authz: sign in as a subsidiary user and confirm a sibling organisation's
   records are still invisible (the sibling-isolation negative tests in
   `server/tests` cover the API side).

## 5. Schedule and retention

- Nightly `pg_dump` plus uploads/object sync to off-host storage.
- Retain 7 daily, 4 weekly and 3 monthly copies; keep one copy outside the
  primary region for the data-residency review (plan §9 compliance row).
- Rehearse a restore into a scratch database monthly and record the row counts.
- The health endpoint is the liveness probe; a failed restore rehearsal is a
  release blocker.
