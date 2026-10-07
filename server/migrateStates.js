#!/usr/bin/env node
import 'dotenv/config';
import { initDb, pool } from './db.js';
import { writeAudit } from './audit.js';
import { LEGACY_STATE_MAP } from './config/workflowStates.js';
import { seedPipelineSla } from './pipeline.js';

// ---------------------------------------------------------------------------
// One-off migration of stored opportunity states to the BRD v2 lifecycle
// (WF-01).
//
//   node server/migrateStates.js              # dry run: list what would change
//   node server/migrateStates.js --apply      # rewrite legacy states
//   node server/migrateStates.js --rollback   # restore the original states
//
// The app already reads legacy names as their BRD v2 state, so running this is
// about clean data and reporting, not about correctness. Idempotent: a second
// --apply finds nothing to do. Every changed record keeps its original value in
// data.legacy_status and gets an audit row, so --rollback is exact. The SLA
// table is re-seeded to the BRD v2 states as part of --apply.
// ---------------------------------------------------------------------------

const LEGACY = Object.keys(LEGACY_STATE_MAP);

export async function planMigration(db = pool) {
  const { rows } = await db.query(
    "SELECT id, owner_org_id, data->>'status' AS status, data->>'opportunity_name' AS name FROM entity_record " +
      "WHERE entity = 'DealOpportunity' AND deleted = false AND data->>'status' = ANY($1) ORDER BY id",
    [LEGACY]
  );
  return rows.map((r) => ({ id: r.id, owner_org_id: r.owner_org_id, name: r.name, from: r.status, to: LEGACY_STATE_MAP[r.status] }));
}

export async function applyMigration(db = pool) {
  const plan = await planMigration(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const item of plan) {
      await client.query(
        "UPDATE entity_record SET data = data || jsonb_build_object('status', $2::text, 'legacy_status', $3::text), updated_date = now(), updated_by = 'migration' " +
          "WHERE entity = 'DealOpportunity' AND id = $1 AND data->>'status' = $3",
        [item.id, item.to, item.from]
      );
      await writeAudit({
        client, entity: 'DealOpportunity', entityId: item.id, action: 'state_migrated', orgId: item.owner_org_id,
        before: { status: item.from }, after: { status: item.to }, comment: 'BRD v2 WF-01 state migration',
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await seedPipelineSla();
  return plan;
}

export async function rollbackMigration(db = pool) {
  const { rows } = await db.query(
    "SELECT id, owner_org_id, data->>'status' AS status, data->>'legacy_status' AS legacy FROM entity_record " +
      "WHERE entity = 'DealOpportunity' AND deleted = false AND data ? 'legacy_status'"
  );
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        "UPDATE entity_record SET data = (data - 'legacy_status') || jsonb_build_object('status', $2::text), updated_date = now(), updated_by = 'migration' " +
          "WHERE entity = 'DealOpportunity' AND id = $1",
        [r.id, r.legacy]
      );
      await writeAudit({
        client, entity: 'DealOpportunity', entityId: r.id, action: 'state_migration_rolled_back', orgId: r.owner_org_id,
        before: { status: r.status }, after: { status: r.legacy }, comment: 'BRD v2 WF-01 state migration rolled back',
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return rows.map((r) => ({ id: r.id, from: r.status, to: r.legacy }));
}

async function main(argv) {
  const mode = argv.includes('--rollback') ? 'rollback' : argv.includes('--apply') ? 'apply' : 'dry-run';
  await initDb();
  const result = mode === 'apply' ? await applyMigration() : mode === 'rollback' ? await rollbackMigration() : await planMigration();
  for (const r of result) console.log(`${r.id}  ${r.from} -> ${r.to}${r.name ? '  (' + r.name + ')' : ''}`);
  console.log(`[migrate-states] ${mode}: ${result.length} record(s)${mode === 'dry-run' ? ' would change; run with --apply' : ' changed'}`);
}

if (process.argv[1] && process.argv[1].endsWith('migrateStates.js')) {
  main(process.argv.slice(2))
    .then(() => pool.end())
    .catch((err) => { console.error('[migrate-states] failed:', err.message); pool.end().finally(() => process.exit(1)); });
}
