#!/usr/bin/env node
// Apply the database schema (idempotent) as the schema owner, then grant the
// application role what it needs (NFR-02 least privilege).
//
//   DATABASE_URL=postgres://dealforge_owner:...@host/dealforge \
//   APP_DB_ROLE=dealforge_app  node server/migrate.js
//
// The application itself then runs with DATABASE_URL pointing at the app role
// and DB_MIGRATE_ON_BOOT=0. Without APP_DB_ROLE only the schema is applied.
import 'dotenv/config';
import { initDb, pool } from './db.js';

const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

async function main() {
  await initDb({ attempts: 3, migrate: true });
  const role = process.env.APP_DB_ROLE;
  if (role) {
    if (!ROLE.test(role)) throw new Error('APP_DB_ROLE must be a plain role name');
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    // The audit trail is append-only for the application (AUD-01).
    await pool.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM ${role}`);
    await pool.query(`REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${role}`);
    console.log(`[migrate] granted least-privilege access to ${role}`);
  }
  console.log('[migrate] done');
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('[migrate] failed:', err.message); pool.end().finally(() => process.exit(1)); });
