import express from 'express';
import { pool } from './db.js';
import { resolveActor, listUsers, upsertUser, upsertMembership, newId, getUserByEmail } from './users.js';
import { sessionUser } from './auth.js';
import { listOrganizations, getOrganization } from './org.js';
import { writeAudit } from './audit.js';
import { hashPassword } from '@better-auth/utils/password';
import { ROLES, ROLE_LABELS, CROSS_ORG_READ_ROLES, ADMIN_ROLES, ACTION_ROLES } from './rbac.js';
import { defaultUserPassword } from './authMigrate.js';
import { runSeed, seedStatus } from './seedRun.js';
import { SEED_PROFILES } from './seedProfiles.js';
import {
  USER_ADMIN_VERSION, USER_ADMIN_POLICY, USER_ADMIN_ACTIONS, USER_ADMIN_MESSAGES,
  USER_STATUSES, describeUserStatus, shouldRevokeSessions,
} from './config/userAdmin.js';

// ---------------------------------------------------------------------------
// Super-admin console API (RBAC + tenancy management).
//
// Operator surface for the identity layer: manages app users (app_user), their
// tenant mappings (membership -> org), the Better Auth identity rows that back
// sign-in (user / account / auth_member) and cross-org access grants. Every
// route is gated to the admin role (the super admin) and every mutation is
// written to the immutable audit trail.
//
// Tenancy model:
//   organization  (Sirius tree)   = app-side org / business unit
//   auth_org      (Better Auth)   = the tenant, kept in lock-step with the above
//   membership    (roles per org) = RBAC assignment, the source of truth
//   auth_member   (Better Auth)   = the same assignment in the identity layer
// ---------------------------------------------------------------------------
export const adminRouter = express.Router();

adminRouter.use(async (req, res, next) => {
  try {
    // The admin console requires a real Better Auth session. For local tooling
    // only, ADMIN_ALLOW_HEADER_AUTH=1 together with AUTH_ALLOW_HEADER_IDENTITY=1
    // lets header identity through; both are refused in production at startup.
    const session = await sessionUser(req).catch(() => null);
    req.hasSession = Boolean(session?.user?.email);
    if (!req.hasSession && process.env.ADMIN_ALLOW_HEADER_AUTH !== '1') {
      return res.status(401).json({ error: 'A Better Auth session is required to access the admin console' });
    }
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

export function isSuperAdmin(actor) {
  return (actor?.roles || []).includes('admin');
}

function requireSuperAdmin(req, res) {
  if (!isSuperAdmin(req.actor)) {
    res.status(403).json({ error: 'Super-admin (admin) role required' });
    return false;
  }
  return true;
}

function sendErr(res, err) { res.status(500).json({ error: err.message }); }

// Make sure a Better Auth identity + credential account exists for an app user.
// Used on create and on any re-sync so the console can heal drift.
async function ensureAuthIdentity(user, { password } = {}) {
  const { rows: existingUser } = await pool.query('SELECT id FROM "user" WHERE id = $1', [user.id]);
  if (existingUser.length === 0) {
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt") VALUES ($1,$2,$3,true,$4,now(),now())',
      [user.id, user.full_name, user.email, 'admin']
    );
  } else {
    await pool.query(
      'UPDATE "user" SET name = $2, email = $3, "updatedAt" = now() WHERE id = $1',
      [user.id, user.full_name, user.email]
    );
  }

  const pw = password || defaultUserPassword();
  const { rows: accts } = await pool.query(
    'SELECT id FROM account WHERE "userId" = $1 AND "providerId" = $2 LIMIT 1',
    [user.id, 'credential']
  );
  const hashed = await hashPassword(pw);
  if (accts.length === 0) {
    await pool.query(
      'INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,now(),now())',
      [user.id + '-cred', user.id, 'credential', user.id, hashed]
    );
  } else if (password) {
    await pool.query('UPDATE account SET password = $2, "updatedAt" = now() WHERE id = $1', [accts[0].id, hashed]);
  }
}

// Attach the current auth-side state (banned, has credential, active sessions)
// to a set of app users, in one query rather than N.
async function decorateUsers(users) {
  if (!users.length) return [];
  const ids = users.map((u) => u.id);
  const { rows: authRows } = await pool.query(
    'SELECT u.id, u.banned, u."banReason", ' +
    '       (a.id IS NOT NULL) AS has_credential, ' +
    '       COALESCE(s.n, 0)::int AS active_sessions ' +
    '  FROM "user" u ' +
    '  LEFT JOIN account a ON a."userId" = u.id AND a."providerId" = ' + "'credential'" + ' ' +
    '  LEFT JOIN (SELECT "userId", count(*)::int AS n FROM session WHERE "expiresAt" > now() GROUP BY "userId") s ON s."userId" = u.id ' +
    ' WHERE u.id = ANY($1)',
    [ids]
  );
  const byId = new Map(authRows.map((r) => [r.id, r]));
  return users.map((u) => ({
    ...u,
    banned: Boolean(byId.get(u.id)?.banned),
    ban_reason: byId.get(u.id)?.banReason || null,
    has_credential: Boolean(byId.get(u.id)?.has_credential),
    active_sessions: byId.get(u.id)?.active_sessions || 0,
    // Lifecycle status (PLT-05): one derived key for the console badge.
    ...describeUserStatus(u, { banned: Boolean(byId.get(u.id)?.banned) }),
  }));
}

// Revoke every live session for a user when the lifecycle policy says the
// action ends access (PLT-05). Returns the number of sessions removed so the
// route can report and audit it.
async function revokeSessions(userId, action) {
  if (!shouldRevokeSessions(action, USER_ADMIN_POLICY)) return 0;
  const { rowCount } = await pool.query('DELETE FROM session WHERE "userId" = $1', [userId]);
  return rowCount || 0;
}

// ---------------------------------------------------------------------------
// Role catalog (drives the console role pickers).
// ---------------------------------------------------------------------------
adminRouter.get('/roles', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  res.json({
    roles: ROLES.map((r) => ({
      key: r,
      label: ROLE_LABELS[r] || r,
      cross_org: CROSS_ORG_READ_ROLES.includes(r),
      admin: ADMIN_ROLES.includes(r),
      actions: Object.entries(ACTION_ROLES).filter(([, rs]) => rs.includes(r)).map(([a]) => a),
    })),
    cross_org_roles: CROSS_ORG_READ_ROLES,
    admin_roles: ADMIN_ROLES,
  });
});

// The user-administration lifecycle policy (PLT-05): the status vocabulary, the
// named audited actions and the revoke-on-close effects the routes honour.
adminRouter.get('/user-admin/policy', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  res.json({
    version: USER_ADMIN_VERSION,
    policy: USER_ADMIN_POLICY,
    statuses: USER_STATUSES,
    actions: USER_ADMIN_ACTIONS,
    scope_note: USER_ADMIN_MESSAGES.scope_note,
  });
});

// ---------------------------------------------------------------------------
// Overview (stat cards + recent activity).
// ---------------------------------------------------------------------------
adminRouter.get('/overview', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const [users, orgs, memberships, grants, sessions, policies, tenants] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM app_user'),
      pool.query('SELECT count(*)::int AS n FROM organization'),
      pool.query('SELECT count(*)::int AS n FROM membership'),
      pool.query('SELECT count(*)::int AS n FROM access_grant'),
      pool.query('SELECT count(*)::int AS n FROM session WHERE "expiresAt" > now()'),
      pool.query("SELECT count(*)::int AS n FROM abac_policy WHERE status = 'active'").catch(() => ({ rows: [{ n: 0 }] })),
      pool.query('SELECT count(*)::int AS n FROM auth_org').catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    const { rows: roleDist } = await pool.query(
      'SELECT role, count(*)::int AS n FROM (SELECT unnest(roles) AS role FROM membership) t GROUP BY role ORDER BY n DESC'
    );
    const { rows: recent } = await pool.query(
      'SELECT id, entity, entity_id, action, actor_email, org_id, comment, ts FROM audit_event ORDER BY ts DESC LIMIT 12'
    );
    res.json({
      counts: {
        users: users.rows[0].n,
        organizations: orgs.rows[0].n,
        memberships: memberships.rows[0].n,
        access_grants: grants.rows[0].n,
        active_sessions: sessions.rows[0].n,
        abac_policies: policies.rows[0].n,
        auth_tenants: tenants.rows[0].n,
      },
      role_distribution: roleDist,
      recent_activity: recent,
    });
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Users.
// ---------------------------------------------------------------------------
adminRouter.get('/users', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const users = await listUsers();
    const decorated = await decorateUsers(users);
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const filtered = q
      ? decorated.filter((u) => (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      : decorated;
    res.json({ users: filtered, total: decorated.length });
  } catch (err) { sendErr(res, err); }
});

adminRouter.get('/users/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows } = await pool.query('SELECT * FROM app_user WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const [decorated] = await decorateUsers(rows);
    const { rows: grants } = await pool.query(
      'SELECT g.*, o.name AS org_name FROM access_grant g LEFT JOIN organization o ON o.id = g.org_id WHERE g.user_id = $1',
      [req.params.id]
    );
    res.json({ ...decorated, access_grants: grants });
  } catch (err) { sendErr(res, err); }
});

adminRouter.post('/users', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { email, full_name, phone, password, org_id, roles = [], groups = [], can_sign = false, is_primary = true } = req.body || {};
    if (!email || !full_name) return res.status(400).json({ error: 'email and full_name are required' });
    if (roles.length && !org_id) return res.status(400).json({ error: 'org_id is required when assigning roles' });
    // Creating is not upserting: a taken email is a conflict, so the operator
    // is sent to the existing user instead of silently resurrecting it.
    const existing = await getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'A user with that email already exists', user_id: existing.id });
    const user = await upsertUser({ email, full_name, phone });
    await ensureAuthIdentity(user, { password });
    if (org_id) {
      const mem = await upsertMembership({ id: newId('mem'), user_id: user.id, org_id, roles, groups, can_sign, is_primary });
      await mirrorMembershipToAuth(mem);
      await writeAudit({ entity: 'membership', entityId: mem.id, action: 'create', actor: req.actor, orgId: org_id, after: mem });
    }
    await writeAudit({ entity: 'app_user', entityId: user.id, action: 'create', actor: req.actor, after: user });
    const [decorated] = await decorateUsers([user]);
    res.status(201).json(decorated);
  } catch (err) {
    if (String(err.message || '').includes('duplicate key')) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    sendErr(res, err);
  }
});

adminRouter.patch('/users/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows: before } = await pool.query('SELECT * FROM app_user WHERE id = $1', [req.params.id]);
    if (!before[0]) return res.status(404).json({ error: 'User not found' });
    const b = req.body || {};
    const { rows } = await pool.query(
      'UPDATE app_user SET full_name = COALESCE($2, full_name), email = COALESCE($3, email), ' +
      '  phone = COALESCE($4, phone), is_active = COALESCE($5, is_active), updated_at = now() ' +
      'WHERE id = $1 RETURNING *',
      [req.params.id, b.full_name ?? null, b.email ?? null, b.phone ?? null, typeof b.is_active === 'boolean' ? b.is_active : null]
    );
    await pool.query('UPDATE "user" SET name = $2, email = $3, "updatedAt" = now() WHERE id = $1', [rows[0].id, rows[0].full_name, rows[0].email]);
    // A profile edit that also flips the active flag is a lifecycle change, so
    // it revokes like deactivate/reactivate rather than slipping through.
    let revoked = 0;
    if (typeof b.is_active === 'boolean' && b.is_active !== before[0].is_active) {
      revoked = await revokeSessions(rows[0].id, b.is_active ? 'reactivate' : 'deactivate');
    }
    await writeAudit({
      entity: 'app_user', entityId: rows[0].id, action: 'update', actor: req.actor, before: before[0], after: rows[0],
      comment: revoked ? revoked + ' session(s) revoked' : null,
    });
    const [decorated] = await decorateUsers(rows);
    res.json(decorated);
  } catch (err) { sendErr(res, err); }
});

adminRouter.post('/users/:id/password', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const { rows } = await pool.query('SELECT * FROM app_user WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await ensureAuthIdentity(rows[0], { password: String(password) });
    const revoked = await revokeSessions(rows[0].id, 'set_password');
    await writeAudit({
      entity: 'app_user', entityId: rows[0].id, action: 'set_password', actor: req.actor,
      comment: 'Password reset by super admin; ' + revoked + " session(s) revoked",
    });
    res.json({ ok: true, revoked_sessions: revoked });
  } catch (err) { sendErr(res, err); }
});

adminRouter.post('/users/:id/ban', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const banned = req.body?.banned !== false;
    const reason = req.body?.reason || null;
    const { rows } = await pool.query(
      'UPDATE "user" SET banned = $2, "banReason" = $3, "updatedAt" = now() WHERE id = $1 RETURNING id, banned, "banReason"',
      [req.params.id, banned, banned ? reason : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const revoked = banned ? await revokeSessions(req.params.id, 'ban') : 0;
    await writeAudit({
      entity: 'app_user', entityId: req.params.id, action: banned ? 'ban' : 'unban', actor: req.actor,
      comment: [reason, banned ? revoked + ' session(s) revoked' : null].filter(Boolean).join('; ') || null,
    });
    res.json({ ...rows[0], revoked_sessions: revoked });
  } catch (err) { sendErr(res, err); }
});

adminRouter.delete('/users/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    if (req.params.id === req.actor.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    const { rows } = await pool.query('UPDATE app_user SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const revoked = await revokeSessions(req.params.id, 'deactivate');
    await writeAudit({
      entity: 'app_user', entityId: rows[0].id, action: 'deactivate', actor: req.actor, after: rows[0],
      comment: 'Deactivated; ' + revoked + ' session(s) revoked',
    });
    res.json({ ...rows[0], revoked_sessions: revoked });
  } catch (err) { sendErr(res, err); }
});

// Reactivate a deactivated account. Restoring access is not the same as
// restoring a session: the operator must sign in again, so reactivation never
// re-issues identity. Audited like every other lifecycle change.
adminRouter.post('/users/:id/reactivate', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows: before } = await pool.query('SELECT * FROM app_user WHERE id = $1', [req.params.id]);
    if (!before[0]) return res.status(404).json({ error: 'User not found' });
    const { rows } = await pool.query('UPDATE app_user SET is_active = true, updated_at = now() WHERE id = $1 RETURNING *', [req.params.id]);
    await writeAudit({ entity: 'app_user', entityId: rows[0].id, action: 'reactivate', actor: req.actor, before: before[0], after: rows[0] });
    const [decorated] = await decorateUsers(rows);
    res.json(decorated);
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Tenants (organizations) and their membership mappings.
// ---------------------------------------------------------------------------
adminRouter.get('/organizations', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const orgs = await listOrganizations({ type: req.query.type });
    const { rows: counts } = await pool.query('SELECT org_id, count(*)::int AS n FROM membership GROUP BY org_id');
    const byOrg = new Map(counts.map((c) => [c.org_id, c.n]));
    const { rows: tenantRows } = await pool.query('SELECT id, slug FROM auth_org').catch(() => ({ rows: [] }));
    const tenantByOrg = new Map(tenantRows.map((t) => [t.id, t.slug]));
    res.json(orgs.map((o) => ({
      ...o,
      member_count: byOrg.get(o.id) || 0,
      tenant_slug: tenantByOrg.get(o.id) || null,
      is_tenant: tenantByOrg.has(o.id),
    })));
  } catch (err) { sendErr(res, err); }
});

adminRouter.get('/organizations/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const org = await getOrganization(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    const { rows: members } = await pool.query(
      'SELECT m.*, u.full_name, u.email FROM membership m JOIN app_user u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY u.full_name',
      [req.params.id]
    );
    const { rows: descendants } = await pool.query(
      'SELECT id, name, type FROM organization WHERE path LIKE ((SELECT path FROM organization WHERE id = $1) || ' + "'/%'" + ') ORDER BY level, name',
      [req.params.id]
    );
    res.json({ ...org, members, descendants });
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Membership (user -> org mapping with RBAC roles).
// ---------------------------------------------------------------------------
adminRouter.get('/memberships', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const params = [];
    let where = '';
    if (req.query.org_id) { params.push(req.query.org_id); where = 'WHERE m.org_id = $1'; }
    const { rows } = await pool.query(
      'SELECT m.*, u.full_name, u.email, o.name AS org_name, o.type AS org_type FROM membership m ' +
      'JOIN app_user u ON u.id = m.user_id JOIN organization o ON o.id = m.org_id ' + where + ' ORDER BY o.level, u.full_name',
      params
    );
    res.json(rows);
  } catch (err) { sendErr(res, err); }
});

// Mirror a membership into Better Auth (single primary role) + ensure tenant.
async function mirrorMembershipToAuth(mem) {
  try {
    const { rows: org } = await pool.query('SELECT id, name FROM organization WHERE id = $1', [mem.org_id]);
    if (org[0]) {
      const { rows: existing } = await pool.query('SELECT id FROM auth_org WHERE id = $1', [mem.org_id]);
      if (existing.length === 0) {
        const base = String(org[0].name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('org-' + mem.org_id);
        await pool.query(
          'INSERT INTO auth_org (id, name, slug, "createdAt") VALUES ($1,$2,$3,now()) ON CONFLICT (id) DO NOTHING',
          [mem.org_id, org[0].name, base + '-' + Math.random().toString(36).slice(2, 6)]
        ).catch(() => {});
      }
    }
    const role = Array.isArray(mem.roles) && mem.roles.length ? mem.roles[0] : 'member';
    const { rows: existingMember } = await pool.query(
      'SELECT id FROM auth_member WHERE "organizationId" = $1 AND "userId" = $2',
      [mem.org_id, mem.user_id]
    );
    if (existingMember.length === 0) {
      await pool.query(
        'INSERT INTO auth_member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,$4,now())',
        [mem.id, mem.org_id, mem.user_id, role]
      );
    } else {
      await pool.query('UPDATE auth_member SET role = $2 WHERE id = $1', [existingMember[0].id, role]);
    }
  } catch (err) {
    console.error('[admin] mirrorMembershipToAuth failed:', err.message);
  }
}

adminRouter.post('/memberships', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { user_id, org_id, roles = [], groups = [], can_sign = false, is_primary = false } = req.body || {};
    if (!user_id || !org_id) return res.status(400).json({ error: 'user_id and org_id are required' });
    const mem = await upsertMembership({ id: newId('mem'), user_id, org_id, roles, groups, can_sign, is_primary });
    if (is_primary) {
      await pool.query('UPDATE membership SET is_primary = false WHERE user_id = $1 AND id <> $2', [user_id, mem.id]);
    }
    await mirrorMembershipToAuth(mem);
    await writeAudit({ entity: 'membership', entityId: mem.id, action: 'create', actor: req.actor, orgId: org_id, after: mem });
    res.status(201).json(mem);
  } catch (err) { sendErr(res, err); }
});

adminRouter.patch('/memberships/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows: before } = await pool.query('SELECT * FROM membership WHERE id = $1', [req.params.id]);
    if (!before[0]) return res.status(404).json({ error: 'Membership not found' });
    const b = req.body || {};
    const { rows } = await pool.query(
      'UPDATE membership SET roles = COALESCE($2, roles), groups = COALESCE($3, groups), ' +
      '  can_sign = COALESCE($4, can_sign), is_primary = COALESCE($5, is_primary) WHERE id = $1 RETURNING *',
      [req.params.id, b.roles ?? null, b.groups ?? null,
       typeof b.can_sign === 'boolean' ? b.can_sign : null,
       typeof b.is_primary === 'boolean' ? b.is_primary : null]
    );
    if (b.is_primary === true) {
      await pool.query('UPDATE membership SET is_primary = false WHERE user_id = $1 AND id <> $2', [rows[0].user_id, rows[0].id]);
    }
    await mirrorMembershipToAuth(rows[0]);
    await writeAudit({ entity: 'membership', entityId: rows[0].id, action: 'update', actor: req.actor, orgId: rows[0].org_id, before: before[0], after: rows[0] });
    res.json(rows[0]);
  } catch (err) { sendErr(res, err); }
});

adminRouter.delete('/memberships/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows } = await pool.query('DELETE FROM membership WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Membership not found' });
    await pool.query('DELETE FROM auth_member WHERE "organizationId" = $1 AND "userId" = $2', [rows[0].org_id, rows[0].user_id]).catch(() => {});
    await writeAudit({ entity: 'membership', entityId: rows[0].id, action: 'delete', actor: req.actor, orgId: rows[0].org_id, before: rows[0] });
    res.json(rows[0]);
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Cross-org access grants (explicit, audited tenancy exceptions).
// ---------------------------------------------------------------------------
adminRouter.get('/access-grants', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows } = await pool.query(
      'SELECT g.*, u.full_name, u.email, o.name AS org_name FROM access_grant g ' +
      'JOIN app_user u ON u.id = g.user_id LEFT JOIN organization o ON o.id = g.org_id ORDER BY u.full_name, o.name'
    );
    res.json(rows);
  } catch (err) { sendErr(res, err); }
});

adminRouter.post('/access-grants', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { user_id, org_id, scope = 'read', reason } = req.body || {};
    if (!user_id || !org_id) return res.status(400).json({ error: 'user_id and org_id are required' });
    const { rows } = await pool.query(
      'INSERT INTO access_grant (id, user_id, org_id, scope, reason) VALUES ($1,$2,$3,$4,$5) ' +
      'ON CONFLICT (user_id, org_id, scope) DO UPDATE SET reason = EXCLUDED.reason RETURNING *',
      [newId('grant'), user_id, org_id, scope, reason || null]
    );
    await writeAudit({ entity: 'access_grant', entityId: rows[0].id, action: 'create', actor: req.actor, orgId: org_id, after: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) { sendErr(res, err); }
});

adminRouter.delete('/access-grants/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { rows } = await pool.query('DELETE FROM access_grant WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Grant not found' });
    await writeAudit({ entity: 'access_grant', entityId: rows[0].id, action: 'delete', actor: req.actor, orgId: rows[0].org_id, before: rows[0] });
    res.json(rows[0]);
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Tenancy matrix - every user x org assignment in one payload so the console
// can render the RBAC/tenancy map without N+M round trips.
// ---------------------------------------------------------------------------
adminRouter.get('/tenancy-matrix', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const users = await listUsers();
    const orgs = await listOrganizations();
    const { rows: grants } = await pool.query('SELECT user_id, org_id, scope FROM access_grant');
    const grantSet = new Set(grants.map((g) => g.user_id + '|' + g.org_id));
    res.json({
      orgs: orgs.map((o) => ({ id: o.id, name: o.name, type: o.type, level: o.level, parent_id: o.parent_id })),
      users: users.map((u) => ({
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        assignments: (u.memberships || []).map((m) => ({
          membership_id: m.id,
          org_id: m.org_id,
          org_name: m.org_name,
          roles: m.roles || [],
          is_primary: m.is_primary,
          has_grant: grantSet.has(u.id + '|' + m.org_id),
        })),
      })),
    });
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Audit - recent identity/RBAC events for the console activity feed.
// ---------------------------------------------------------------------------
adminRouter.get('/audit', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const entities = ['app_user', 'membership', 'access_grant', 'auth', 'abac_policy', 'access_control'];
    const { rows } = await pool.query(
      'SELECT id, entity, entity_id, action, actor_email, org_id, role, comment, ts FROM audit_event ' +
      'WHERE entity = ANY($1) ORDER BY ts DESC LIMIT $2',
      [entities, limit]
    );
    res.json(rows);
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Sample-data seed control (W1-11 / W1-12). Lets an operator inspect what seed
// data is present and clean or load a profile without shelling into the box.
// Super-admin only; every run is audited by runSeed().
// ---------------------------------------------------------------------------
adminRouter.get('/seed', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try { res.json(await seedStatus()); } catch (err) { sendErr(res, err); }
});

adminRouter.post('/seed', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { action, profile, force } = req.body || {};
    if (!['clean', 'load', 'reload'].includes(action)) {
      return res.status(400).json({ error: "action must be one of 'clean', 'load', 'reload'" });
    }
    if (profile != null && !SEED_PROFILES.includes(profile)) {
      return res.status(400).json({ error: 'profile must be one of ' + SEED_PROFILES.join(', ') });
    }
    // Sample data never goes into production, and a production database is
    // never cleaned from the console (NFR-02).
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Seed operations are disabled in production' });
    }
    // 'reload' = clean then load the requested (or currently resolved) profile.
    const result = await runSeed({
      profile: action === 'clean' ? 'off' : profile,
      clean: action !== 'load',
      force: Boolean(force) || action !== 'load',
    });
    await writeAudit({
      entity: 'seed',
      action: 'admin_seed_' + action,
      actor: req.actor,
      orgId: req.actor.org_id,
      after: { action, profile: result.profile },
    });
    res.json({ ok: true, ...result });
  } catch (err) { sendErr(res, err); }
});

export default adminRouter;
