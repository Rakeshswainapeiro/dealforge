// ---------------------------------------------------------------------------
// Backup / restore policy (W9-05 / BRD NFR-05).
//
// The availability NFR is a backup schedule plus a restore that actually
// reproduces the source. This module holds the backend-agnostic part: the
// targets and the gate a rehearsal must clear.
// scripts/backup_restore_rehearsal.mjs drives a real Postgres dump/restore and
// calls evaluateRehearsal with the measured numbers.
// ---------------------------------------------------------------------------

export const BACKUP_RESTORE_VERSION = 'NFR-05.1';

// RPO 24h (nightly backup), RTO 8h (restore into a verified database).
export const BACKUP_RESTORE_TARGETS = {
  rpo_hours: 24,
  rto_hours: 8,
  rto_seconds: 8 * 3600,
  // The tables whose counts must reconcile on restore.
  verified_tables: ['entity_record', 'audit_event'],
};

// A rehearsal passes when every verified table reproduces its source count
// exactly and the restore came in under the RTO target.
export function evaluateRehearsal({ sourceCounts = {}, restoredCounts = {}, restoreMs = 0 } = {}) {
  const tables = BACKUP_RESTORE_TARGETS.verified_tables;
  const missing = tables.filter((t) => sourceCounts[t] === undefined || restoredCounts[t] === undefined);
  const mismatched = tables.filter((t) => sourceCounts[t] !== restoredCounts[t]);
  const countsMatch = missing.length === 0 && mismatched.length === 0;
  const restoreSeconds = Math.round(restoreMs / 1000);
  const withinRto = restoreSeconds <= BACKUP_RESTORE_TARGETS.rto_seconds;
  return {
    counts_match: countsMatch,
    missing_tables: missing,
    mismatched_tables: mismatched,
    rto_seconds: restoreSeconds,
    within_rto: withinRto,
    pass: countsMatch && withinRto,
    policy: 'A scratch-database restore must reproduce every verified table count and finish within the RTO target.',
  };
}

export default { BACKUP_RESTORE_VERSION, BACKUP_RESTORE_TARGETS, evaluateRehearsal };

