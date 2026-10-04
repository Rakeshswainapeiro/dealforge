import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import {
  buildAdminConfigPayload, registrySummary, groupedDomains,
} from './config/adminConfig.js';
import {
  CONFIG_DOMAINS, CONFIG_DOMAIN_KEYS, ADMIN_CONFIG_MESSAGES,
} from './config/adminConfigData.js';

// ---------------------------------------------------------------------------
// Unified admin configuration registry (W8-03 / BRD ADM-01).
//
// The screening pipeline is shaped by more than twenty independently stored,
// versioned configuration areas. This route exposes a single registry over
// them: what each area is, the route an administrator edits it through, whether
// it carries a revision, and its change history read from the immutable audit
// trail. It is a read / governance surface - edits still go through each area's
// own router so the per-area validation and revision bumping are preserved.
// ---------------------------------------------------------------------------

export const adminConfigRouter = express.Router();

adminConfigRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

function requireAdmin(req, res) {
  if (!canConfigure(req.actor.membership)) {
    res.status(403).json({ error: ADMIN_CONFIG_MESSAGES.admin_required });
    return false;
  }
  return true;
}

// GET /api/admin-config - the full registry grouped by area, with a roll-up and
// the viewer's own configuration rights.
adminConfigRouter.get('/', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const payload = buildAdminConfigPayload();
    res.json({
      ...payload,
      viewer: {
        email: req.actor.email,
        roles: req.actor.roles,
        can_configure: true,
      },
    });
  } catch (err) { sendErr(res, err); }
});

// GET /api/admin-config/domains - a flat list of the registered areas.
adminConfigRouter.get('/domains', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    res.json({ domains: CONFIG_DOMAINS, domain_keys: CONFIG_DOMAIN_KEYS });
  } catch (err) { sendErr(res, err); }
});

// GET /api/admin-config/:domain - one area's descriptor plus its change history
// drawn from the immutable audit trail.
adminConfigRouter.get('/:domain', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const domain = CONFIG_DOMAINS.find((d) => d.domain === String(req.params.domain || '').toLowerCase());
    if (!domain) return res.status(404).json({ error: ADMIN_CONFIG_MESSAGES.domain_unknown });
    const history = await domainHistory(domain);
    const { rows: latest } = await pool.query(
      'SELECT ts FROM audit_event WHERE action = $1 ORDER BY id DESC LIMIT 1',
      [domain.action]
    ).catch(() => ({ rows: [] }));
    res.json({
      domain,
      last_changed_at: latest[0]?.ts || null,
      change_count: history.length,
      history,
    });
  } catch (err) { sendErr(res, err); }
});

// GET /api/admin-config/:domain/history - the audited edits for one area.
adminConfigRouter.get('/:domain/history', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const domain = CONFIG_DOMAINS.find((d) => d.domain === String(req.params.domain || '').toLowerCase());
    if (!domain) return res.status(404).json({ error: ADMIN_CONFIG_MESSAGES.domain_unknown });
    const history = await domainHistory(domain);
    res.json({ domain: domain.domain, action: domain.action, history });
  } catch (err) { sendErr(res, err); }
});

async function domainHistory(domain) {
  try {
    const { rows } = await pool.query(
      'SELECT id, action, actor_email, org_id, before, after, comment, ts ' +
      'FROM audit_event WHERE action = $1 ORDER BY id DESC LIMIT 50',
      [domain.action]
    );
    return rows;
  } catch { return []; }
}

export { registrySummary, groupedDomains };
export default adminConfigRouter;
