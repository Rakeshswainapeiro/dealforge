// ---------------------------------------------------------------------------
// Better Auth tenant / user migration (multi-tenant RBAC + sessions).
//
// Better Auth is the identity layer (users, sessions, memberships, orgs-as-
// tenants). The existing Sirius organisation tree and seeded cast live in the
// Postgres tables (organization, app_user, membership). On boot we mirror those
// rows into the Better Auth tables so every seeded user can sign in with a
// default password and each organisation becomes a Better Auth "tenant".
//
// Mapping (Better Auth column names are quoted/camelCase in Postgres):
//   organization  -> auth_org   (id = org id, slug = slugified name)
//   app_user      -> user       (id = user id, name = full_name)
//   membership    -> auth_member(organizationId = org id, userId = user id,
//                                role = memberships.roles)
//   credential    -> account    (providerId='credential', scrypt password hash)
//
// Fully idempotent: re-running only inserts what is missing. The default
// password is overrideable via DEFAULT_USER_PASSWORD (deployment config) and
// defaults to 'DealForge!2026' for local/dev so the seeded cast can actually
// sign in.
// ---------------------------------------------------------------------------

import { pool } from './db.js';
import { hashPassword, verifyPassword } from '@better-auth/utils/password';
import { writeAudit } from './audit.js';

// Reasonable default documented for local/dev. Override for any real deployment.
export function defaultUserPassword() {
  return process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';
}

function slugify(name) {
  return String(name || 'org')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'org';
}

// Ensure a unique slug within auth_org by appending a short suffix when taken.
async function uniqueOrgSlug(base, taken) {
  let slug = base;
  let i = 2;
  while (taken.has(slug)) {
    slug = base.slice(0, 34) + '-' + i;
    i += 1;
  }
  taken.add(slug);
  return slug;
}

async function orgExists(id) {
  const { rows } = await pool.query('SELECT id FROM auth_org WHERE id = $1', [id]);
  return rows.length > 0;
}

async function userExists(id) {
  const { rows } = await pool.query('SELECT id FROM \"user\" WHERE id = $1', [id]);
  return rows.length > 0;
}

async function memberExists(organizationId, userId) {
  const { rows } = await pool.query(
    'SELECT id FROM auth_member WHERE \"organizationId\" = $1 AND \"userId\" = $2',
    [organizationId, userId]
  );
  return rows.length > 0;
}

// Returns { orgs, users, accounts, members } describing rows created/ensured.
export async function seedAuthTenants() {
  const counts = { orgs: 0, users: 0, accounts: 0, members: 0 };

  // -- Orgs (tenants): mirror every node in the Sirius organisation tree. --//
  const { rows: orgs } = await pool.query('SELECT id, name FROM organization ORDER BY level, name');
  const { rows: existingOrgs } = await pool.query('SELECT id, slug FROM auth_org');
  const taken = new Set(existingOrgs.map((o) => o.slug));
  for (const org of orgs) {
    if (await orgExists(org.id)) continue;
    const slug = await uniqueOrgSlug(slugify(org.name), taken);
    await pool.query(
      'INSERT INTO auth_org (id, name, slug, \"createdAt\") VALUES ($1,$2,$3, now())',
      [org.id, org.name, slug]
    );
    counts.orgs += 1;
  }

  // -- Users: mirror every app_user with a credential account (default pw). --//
  const { rows: users } = await pool.query('SELECT id, email, full_name FROM app_user');
  const defaultPw = defaultUserPassword();
  for (const u of users) {
    const exists = await userExists(u.id);
    if (!exists) {
      await pool.query(
        'INSERT INTO \"user\" (id, name, email, \"emailVerified\", role, \"createdAt\", \"updatedAt\") VALUES ($1,$2,$3,true,$4,now(),now())',
        [u.id, u.full_name, u.email, 'admin']
      );
      counts.users += 1;
    }
    // Ensure a credential account + default password (idempotent: set only if absent).
    const { rows: accts } = await pool.query(
      'SELECT id, password FROM account WHERE \"userId\" = $1 AND \"providerId\" = $2 LIMIT 1',
      [u.id, 'credential']
    );
    if (accts.length === 0) {
      const hashed = await hashPassword(defaultPw);
      await pool.query(
        'INSERT INTO account (id, \"accountId\", \"providerId\", \"userId\", password, \"createdAt\", \"updatedAt\") VALUES ($1,$2,$3,$4,$5,now(),now())',
        [u.id + '-cred', u.id, 'credential', u.id, hashed]
      );
      counts.accounts += 1;
    } else if (accts[0].password == null) {
      // Backfill a previously passwordless account.
      const hashed = await hashPassword(defaultPw);
      await pool.query('UPDATE account SET password = $2, \"updatedAt\" = now() WHERE id = $1', [accts[0].id, hashed]);
      counts.accounts += 1;
    }
  }

  // -- Memberships: link each user to their org tenant with their roles. --//
  const { rows: memberships } = await pool.query(
    `SELECT m.user_id, m.org_id, m.roles, m.can_sign
       FROM membership m
       JOIN app_user u ON u.id = m.user_id
      WHERE m.roles IS NOT NULL AND array_length(m.roles, 1) > 0
      ORDER BY m.is_primary DESC`
  );
  for (const m of memberships) {
    if (await memberExists(m.org_id, m.user_id)) continue;
    // Better Auth stores a single primary role per membership; store the first
    // role and keep the full set on the caller's side (app_user.membership).
    const role = Array.isArray(m.roles) && m.roles.length ? m.roles[0] : 'member';
    await pool.query(
      'INSERT INTO auth_member (id, \"organizationId\", \"userId\", role, \"createdAt\") VALUES ($1,$2,$3,$4,now())',
      [m.user_id + ':' + m.org_id, m.org_id, m.user_id, role]
    );
    counts.members += 1;
  }

  if (counts.orgs + counts.users + counts.accounts + counts.members > 0) {
    await writeAudit({
      entity: 'auth',
      action: 'seed_better_auth',
      actor: { id: 'system', email: 'system' },
      after: { ...counts, default_user_password_set: true },
      comment: 'Mirrored Sirius org tree + seeded cast into Better Auth tenants/sessions',
    });
  }

  return counts;
}

// Verify a supplied password against the seeded credential account for an email.
export async function verifySeededPassword(email, password) {
  const { rows } = await pool.query(
    'SELECT a.password FROM account a JOIN \"user\" u ON u.id = a."userId" WHERE u.email = $1 AND a."providerId" = $2 LIMIT 1',
    [email, 'credential']
  );
  if (!rows[0]?.password) return false;
  return verifyPassword(rows[0].password, password);
}

export default seedAuthTenants;
