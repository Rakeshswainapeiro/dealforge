import crypto from 'node:crypto';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { descendantIds } from './org.js';
import { sessionUser } from './auth.js';
import { isUserActive, accessBlockReason } from './config/userAdmin.js';
import { headerIdentityEnabled } from './config/identityPolicy.js';

// ---------------------------------------------------------------------------
// Users & memberships (E2.2 / REQ-RBAC-01).
//
// One person can hold several memberships (roles in different orgs). The
// 'active' membership for a request is chosen by the x-org-id header, falling
// back to the primary membership.
// ---------------------------------------------------------------------------

export function newId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function upsertUser({ id, email, full_name, is_active = true, phone = null, seeded = false }) {
  const userId = id || newId('user');
  const { rows } = await pool.query(
    `INSERT INTO app_user (id, email, full_name, is_active, phone, data_seed, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (email) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       is_active = EXCLUDED.is_active,
       phone = COALESCE(EXCLUDED.phone, app_user.phone),
       -- Seed provenance is sticky: once the seed has stamped a row it stays
       -- marked even after an admin edits the profile through the console.
       data_seed = app_user.data_seed OR EXCLUDED.data_seed,
       updated_at = now()
     RETURNING *`,
    [userId, email, full_name, is_active, phone, seeded]
  );
  return rows[0];
}

export async function upsertMembership({ id, user_id, org_id, roles = [], groups = [], can_sign = false, is_primary = false }) {
  const mid = id || newId('mem');
  const { rows } = await pool.query(
    `INSERT INTO membership (id, user_id, org_id, roles, groups, can_sign, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       roles = EXCLUDED.roles,
       groups = EXCLUDED.groups,
       can_sign = EXCLUDED.can_sign,
       is_primary = EXCLUDED.is_primary
     RETURNING *`,
    [mid, user_id, org_id, roles, groups, can_sign, is_primary]
  );
  return rows[0];
}

export async function getUserWithMemberships(userId) {
  const { rows: users } = await pool.query(
    'SELECT u.*, a.banned AS auth_banned, a."banReason" AS auth_ban_reason ' +
    'FROM app_user u LEFT JOIN "user" a ON a.id = u.id WHERE u.id = $1',
    [userId]
  );
  if (!users[0]) return null;
  const { rows: memberships } = await pool.query(
    `SELECT m.*, o.name AS org_name, o.type AS org_type, o.path AS org_path
       FROM membership m JOIN organization o ON o.id = m.org_id
      WHERE m.user_id = $1 ORDER BY m.is_primary DESC, o.level`,
    [userId]
  );
  return { ...users[0], memberships };
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM app_user WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.*, COALESCE(json_agg(json_build_object(
        'id', m.id, 'org_id', m.org_id, 'org_name', o.name, 'roles', m.roles,
        'groups', m.groups, 'can_sign', m.can_sign, 'is_primary', m.is_primary)
      ) FILTER (WHERE m.id IS NOT NULL), '[]') AS memberships
       FROM app_user u
       LEFT JOIN membership m ON m.user_id = u.id
       LEFT JOIN organization o ON o.id = m.org_id
      GROUP BY u.id ORDER BY u.full_name`
  );
  return rows;
}

export async function listMemberships({ orgId } = {}) {
  const params = [];
  let where = '';
  if (orgId) { params.push(orgId); where = 'WHERE m.org_id = $1'; }
  const { rows } = await pool.query(
    `SELECT m.*, u.full_name, u.email, o.name AS org_name, o.type AS org_type
       FROM membership m
       JOIN app_user u ON u.id = m.user_id
       JOIN organization o ON o.id = m.org_id
       ${where} ORDER BY o.level, u.full_name`,
    params
  );
  return rows;
}

export async function grantedOrgIds(userId) {
  const { rows } = await pool.query('SELECT org_id FROM access_grant WHERE user_id = $1', [userId]);
  return rows.map((r) => r.org_id);
}

// Resolve the acting identity for a request (BRD PLT-02 / NFR-02):
//   1. a Better Auth session (cookie or Bearer token) - the real identity layer
//   2. x-user-id / x-user-email headers - ONLY when headerIdentityEnabled()
//      (AUTH_ALLOW_HEADER_IDENTITY=1 outside production; local test suite)
// Returns null when no user can be resolved. There is deliberately no default
// user: an anonymous request is anonymous, and callers answer 401.
export async function resolveActor(req) {
  // Prefer a live Better Auth session when one is presented (real identity).
  const session = await sessionUser(req).catch(() => null);
  if (session?.user?.email) {
    const byEmail = await getUserByEmail(session.user.email);
    if (byEmail) {
      // Bind the actor to the session user. The x-org-id header may still pick
      // a specific membership among that user's own memberships.
      const { actor, blocked } = await buildActor(byEmail.id, req);
      if (actor) return actor;
      // A presented session for a known account that is deactivated, banned or
      // has no membership must NOT fall through to the header/default fallback
      // (which would otherwise resolve an inactive user as the default admin).
      if (blocked) return null;
    }
  }

  // No session. Header identity is a dev/test-only convenience and is ignored
  // unless explicitly enabled; it can never be enabled in production.
  if (!headerIdentityEnabled(process.env)) return null;
  const headerId = req.get('x-user-id');
  const email = req.get('x-user-email');
  let userId = headerId;
  if (!userId && email) {
    const u = await getUserByEmail(email);
    userId = u?.id;
  }
  if (!userId) return null;
  const { actor } = await buildActor(userId, req);
  return actor;
}

// Build the actor for a user. Returns { actor, blocked }: `blocked` is true when
// the account exists but must not act (inactive/banned/no membership), which
// callers use to stop an identity fallback from resurrecting access.
async function buildActor(userId, req) {
  const user = await getUserWithMemberships(userId);
  if (!user) return { actor: null, blocked: false };
  // Deactivation is immediate (PLT-05): a non-active account (app flag or the
  // Better Auth ban) resolves to no actor, so every guard that requires one
  // refuses the request on the very next call rather than at the next sign-in.
  // Only the header/dev fallback is filtered here; a live session is refused
  // inside auth.js by the same predicate.
  if (!isUserActive(user, { banned: user.auth_banned })) return { actor: null, blocked: true };
  const requestedOrg = req.get('x-org-id');
  const membership =
    user.memberships.find((m) => m.org_id === requestedOrg) ||
    user.memberships.find((m) => m.is_primary) ||
    user.memberships[0] ||
    null;
  if (!membership) return { actor: null, blocked: true };
  const [descendants, grants] = await Promise.all([
    descendantIds(membership.org_id),
    grantedOrgIds(user.id),
  ]);
  return { blocked: false, actor: {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    org_id: membership.org_id,
    org_name: membership.org_name,
    roles: membership.roles || [],
    groups: membership.groups || [],
    can_sign: membership.can_sign,
    membership,
    memberships: user.memberships,
    descendant_ids: descendants,
    granted_org_ids: grants,
  } };
}

export async function logAuthChange(actor, action, before, after) {
  await writeAudit({ entity: 'membership', action, actor, before, after });
}
