import express from 'express';
import { pool } from './db.js';
import { resolveActor, listUsers, listMemberships, upsertUser, upsertMembership, newId } from './users.js';
import { listOrganizations, organizationTree, getOrganization, descendantIds } from './org.js';
import { writeAudit } from './audit.js';
import { canViewOrg, isCrossOrgReader } from './rbac.js';

// ---------------------------------------------------------------------------
// Org + user + membership API (E2.1, E2.2).
// ---------------------------------------------------------------------------
export const orgRouter = express.Router();

orgRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

// Current identity — roles, org, can_sign, memberships.
orgRouter.get('/me', async (req, res) => {
  const a = req.actor;
  res.json({
    id: a.id,
    email: a.email,
    full_name: a.full_name,
    org_id: a.org_id,
    org_name: a.org_name,
    roles: a.roles,
    groups: a.groups,
    can_sign: a.can_sign,
    memberships: a.memberships,
  });
});

orgRouter.get('/organizations', async (req, res) => {
  try {
    if (req.query.tree === '1') return res.json(await organizationTree());
    res.json(await listOrganizations({ parentId: req.query.parent_id, type: req.query.type }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

orgRouter.get('/organizations/:id', async (req, res) => {
  try {
    const org = await getOrganization(req.params.id);
    if (!org) return res.status(404).json({ error: 'Not found' });
    if (!canViewOrg(req.actor.membership, org.id, {
      descendantIds: req.actor.descendant_ids,
      grantedOrgIds: req.actor.granted_org_ids,
    })) return res.status(403).json({ error: 'Not permitted to view this organisation' });
    res.json({ ...org, descendant_ids: await descendantIds(org.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

orgRouter.get('/users', async (req, res) => {
  try {
    if (!isCrossOrgReader(req.actor.membership) && !req.actor.roles.includes('cluster_head')) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    res.json(await listUsers());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

orgRouter.get('/memberships', async (req, res) => {
  try {
    res.json(await listMemberships({ orgId: req.query.org_id }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin-only writes.
function requireAdmin(req, res) {
  if (!req.actor.roles.includes('admin')) {
    res.status(403).json({ error: 'Admin role required' });
    return false;
  }
  return true;
}

orgRouter.post('/users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { email, full_name, id } = req.body || {};
    if (!email || !full_name) return res.status(400).json({ error: 'email and full_name are required' });
    const user = await upsertUser({ id, email, full_name });
    await writeAudit({ entity: 'app_user', entityId: user.id, action: 'create', actor: req.actor, after: user });
    res.status(201).json(await listUsers().then((u) => u.find((x) => x.id === user.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

orgRouter.post('/memberships', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { user_id, org_id, roles = [], groups = [], can_sign = false, is_primary = false } = req.body || {};
    if (!user_id || !org_id) return res.status(400).json({ error: 'user_id and org_id are required' });
    const mem = await upsertMembership({
      id: req.body.id || newId('mem'),
      user_id, org_id, roles, groups, can_sign, is_primary,
    });
    await writeAudit({ entity: 'membership', entityId: mem.id, action: 'create', actor: req.actor, orgId: org_id, after: mem });
    res.status(201).json(mem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

orgRouter.post('/access-grants', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { user_id, org_id, scope = 'read', reason } = req.body || {};
    if (!user_id || !org_id) return res.status(400).json({ error: 'user_id and org_id are required' });
    const { rows } = await pool.query(
      `INSERT INTO access_grant (id, user_id, org_id, scope, reason) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, org_id, scope) DO UPDATE SET reason = EXCLUDED.reason RETURNING *`,
      [newId('grant'), user_id, org_id, scope, reason || null]
    );
    await writeAudit({ entity: 'access_grant', entityId: rows[0].id, action: 'create', actor: req.actor, orgId: org_id, after: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default orgRouter;
