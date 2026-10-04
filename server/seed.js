import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { upsertUser, upsertMembership, newId } from './users.js';
import {
  SEEDED_USERS, SEEDED_MEMBERSHIPS, SIRIUS_ORG_ID as SIRIUS, INFINIA_ORG_ID as INFINIA,
} from './config/seededUsers.js';

// ---------------------------------------------------------------------------
// Seed users & memberships (E2.2, E10.3).
//
// A small cast that spans the org layers so RBAC and privacy can be exercised:
// a subsidiary deal lead + CEO/CFO (Infinia), a cluster head (Sirius), the
// Sirius investment team, leadership (Fahad/AJ), an IC member, and an admin.
// Idempotent: re-running updates in place by stable ids. The cast itself lives
// in config/seededUsers.js so the same publish list drives cleanup (W1-11).
//
// Every app_user written here is stamped `data_seed = true` so the cleanup pass
// can tell the shipped cast from accounts an operator creates in the console.
// ---------------------------------------------------------------------------

const USERS = SEEDED_USERS;
const MEMBERSHIPS = SEEDED_MEMBERSHIPS;

export async function seedUsersAndMemberships({ force = false } = {}) {
  const { rows: existing } = await pool.query('SELECT count(*)::int AS n FROM app_user');
  const skipped = existing[0].n > 0 && !force;
  // Upserts are idempotent by stable id/email, so re-running backfills new
  // columns (phone) and role additions (leadership) without duplicating rows.
  const idByEmail = new Map();
  for (const u of USERS) {
    const saved = await upsertUser({ ...u, seeded: true });
    idByEmail.set(String(u.email).toLowerCase(), saved.id);
  }
  // Memberships name the user by email so the membership stays stable even if
  // the person row has to be recreated; resolve to the real id at seed time.
  for (const m of MEMBERSHIPS) {
    const userId = idByEmail.get(String(m.user_email).toLowerCase());
    if (!userId) continue;
    await upsertMembership({
      id: m.id,
      user_id: userId,
      org_id: m.org_id,
      roles: m.roles || [],
      groups: m.groups || [],
      can_sign: !!m.can_sign,
      is_primary: !!m.is_primary,
    });
  }
  if (skipped) return { skipped: true, users: USERS.length, memberships: MEMBERSHIPS.length };
  await writeAudit({
    entity: 'seed',
    action: 'seed_users',
    actor: { id: 'system', email: 'system' },
    after: { users: USERS.length, memberships: MEMBERSHIPS.length },
  });
  return { skipped: false, users: USERS.length, memberships: MEMBERSHIPS.length };
}

export const SEED_ORG_IDS = { SIRIUS, INFINIA };
export { newId };
