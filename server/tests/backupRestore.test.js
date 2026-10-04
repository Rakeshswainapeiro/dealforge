// Backup / restore rehearsal gate (W9-05 / BRD NFR-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRehearsal, BACKUP_RESTORE_TARGETS, BACKUP_RESTORE_VERSION,
} from '../config/backupRestore.js';

test('targets are RPO 24h / RTO 8h over the verified tables', () => {
  assert.equal(BACKUP_RESTORE_VERSION, 'NFR-05.1');
  assert.equal(BACKUP_RESTORE_TARGETS.rpo_hours, 24);
  assert.equal(BACKUP_RESTORE_TARGETS.rto_hours, 8);
  assert.equal(BACKUP_RESTORE_TARGETS.rto_seconds, 28800);
  assert.deepEqual(BACKUP_RESTORE_TARGETS.verified_tables, ['entity_record', 'audit_event']);
});

test('a restoring rehearsal with matching counts passes', () => {
  const g = evaluateRehearsal({
    sourceCounts: { entity_record: 16610, audit_event: 106098 },
    restoredCounts: { entity_record: 16610, audit_event: 106098 },
    restoreMs: 5000,
  });
  assert.equal(g.counts_match, true);
  assert.equal(g.within_rto, true);
  assert.equal(g.pass, true);
  assert.equal(g.rto_seconds, 5);
});

test('a mismatched count fails the gate even within RTO', () => {
  const g = evaluateRehearsal({
    sourceCounts: { entity_record: 100, audit_event: 200 },
    restoredCounts: { entity_record: 99, audit_event: 200 },
    restoreMs: 5000,
  });
  assert.equal(g.counts_match, false);
  assert.deepEqual(g.mismatched_tables, ['entity_record']);
  assert.equal(g.pass, false);
});

test('a missing verified table fails the gate', () => {
  const g = evaluateRehearsal({
    sourceCounts: { entity_record: 1 },
    restoredCounts: { entity_record: 1 },
    restoreMs: 10,
  });
  assert.equal(g.counts_match, false);
  assert.ok(g.missing_tables.includes('audit_event'));
  assert.equal(g.pass, false);
});

test('a restore slower than the RTO target fails the gate', () => {
  const g = evaluateRehearsal({
    sourceCounts: { entity_record: 1, audit_event: 1 },
    restoredCounts: { entity_record: 1, audit_event: 1 },
    restoreMs: (8 * 3600 + 1) * 1000,
  });
  assert.equal(g.counts_match, true);
  assert.equal(g.within_rto, false);
  assert.equal(g.pass, false);
});

