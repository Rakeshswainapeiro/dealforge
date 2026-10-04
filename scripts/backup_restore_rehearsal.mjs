#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Backup / restore rehearsal (W9-05 / BRD NFR-05).
//
// Rehearses the runbook against a running Postgres container and records the
// real result: a custom-format dump, a scratch-database restore and a row-count
// reconciliation of the two verifiable tables. It also measures the wall-clock
// restore time so the RTO claim has evidence behind it. RPO is a schedule
// property (nightly backup), recorded rather than measured here.
//
//   node scripts/backup_restore_rehearsal.mjs
//   node scripts/backup_restore_rehearsal.mjs --container dealforge-db-1 \
//     --out docs/evidence/W9-05/backup_restore_report.json
//
// Exit code is non-zero when the restored counts do not match the source, so
// the rehearsal can gate a release.
// ---------------------------------------------------------------------------
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_RESTORE_VERSION, BACKUP_RESTORE_TARGETS, evaluateRehearsal } from '../server/config/backupRestore.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const CONTAINER = arg('container', 'dealforge-db-1');
const DB = arg('db', 'dealforge');
const USER = arg('user', 'dealforge');
const SCRATCH = arg('scratch', 'dealforge_restore_test');
const OUT = arg('out', 'docs/evidence/W9-05/backup_restore_report.json');
const KEEP = process.argv.includes('--keep')

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const d = (cmd) => sh(`docker exec ${CONTAINER} ${cmd}`);
const psql = (db, sql) => d(`psql -U ${USER} -d ${db} -tAc "${sql}"`);

function main() {
  const started = Date.now();
  const report = {
    version: BACKUP_RESTORE_VERSION,
    rehearsed_at: new Date().toISOString(),
    container: CONTAINER,
    source_db: DB,
    scratch_db: SCRATCH,
  };

  // 1. Source counts and a journal-consistent custom-format dump.
  const sourceCounts = {
    entity_record: Number(psql(DB, 'select count(*) from entity_record;')),
    audit_event: Number(psql(DB, 'select count(*) from audit_event;')),
  };
  const dumpPath = `/tmp/dealforge_rehearsal.dump`;
  const dumpStart = Date.now();
  d(`pg_dump -U ${USER} -d ${DB} -Fc -f ${dumpPath}`);
  report.backup_ms = Date.now() - dumpStart;
  report.dump_bytes = Number(d(`stat -c %s ${dumpPath}`));
  report.source_counts = sourceCounts;

  // 2. Restore into a scratch database and time it.
  psql('postgres', `drop database if exists ${SCRATCH};`);
  psql('postgres', `create database ${SCRATCH};`);
  const restoreStart = Date.now();
  d(`pg_restore -U ${USER} -d ${SCRATCH} ${dumpPath}`);
  report.restore_ms = Date.now() - restoreStart;

  // 3. Reconcile the restored counts against the source.
  const restoredCounts = {
    entity_record: Number(psql(SCRATCH, 'select count(*) from entity_record;')),
    audit_event: Number(psql(SCRATCH, 'select count(*) from audit_event;')),
  };
  report.restored_counts = restoredCounts;
  report.match = Object.keys(sourceCounts).every((k) => sourceCounts[k] === restoredCounts[k]);

  // RTO is the time from starting a restore to a verified, queryable database.
  const gate = evaluateRehearsal({ sourceCounts, restoredCounts, restoreMs: report.restore_ms });
  report.rto_seconds = gate.rto_seconds;
  report.rto_target_seconds = BACKUP_RESTORE_TARGETS.rto_seconds;
  report.rpo_target_hours = BACKUP_RESTORE_TARGETS.rpo_hours;
  report.rpo_note = 'RPO is a schedule property (nightly pg_dump + uploads/object sync to off-host storage), not measured by this rehearsal.';
  report.verified = gate.pass;
  report.gate = { pass: gate.pass, policy: gate.policy, counts_match: gate.counts_match, within_rto: gate.within_rto };
  report.elapsed_ms = Date.now() - started;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  if (!KEEP) psql('postgres', `drop database if exists ${SCRATCH};`);

  console.log('DealForge backup/restore rehearsal (NFR-05)');
  console.log(`  backup            : ${report.backup_ms} ms, ${report.dump_bytes} bytes`);
  console.log(`  source counts     : ${JSON.stringify(sourceCounts)}`);
  console.log(`  restored counts   : ${JSON.stringify(restoredCounts)}`);
  console.log(`  restore           : ${report.restore_ms} ms (RTO ${report.rto_seconds}s, target <= ${report.rto_target_seconds}s)`);
  console.log(`  counts match      : ${report.match}`);
  console.log(`  report written to : ${OUT}`);
  if (!report.gate.pass) process.exit(1);
}

try { main(); } catch (err) {
  console.error('rehearsal failed:', err.message);
  process.exit(1);
}
