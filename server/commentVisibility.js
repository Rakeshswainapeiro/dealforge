import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import {
  COMMENT_VISIBILITY_CONFIG_KEY,
  COMMENT_VISIBILITIES,
  COMMENT_VISIBILITY_MESSAGES,
  COMMENT_VISIBILITY_CROSS_ORG_ROLES,
  defaultCommentVisibilityConfig,
  validateCommentVisibilityConfig,
  resolveCommentVisibilityConfig,
  diffCommentVisibilityConfig,
  buildCommentVisibilityConfig,
  isSubsidiaryViewer,
  mayViewVisibility,
  canViewInternal,
} from './config/commentVisibility.js';

// ---------------------------------------------------------------------------
// Internal vs shared comment visibility (W6-04 / BRD AUD-03, REQ-RBAC-04).
//
// The policy that governs who may see an internal clarification comment lives
// in configuration (AppSettings, setting_key = 'comment_visibility_config') so
// Group Compliance can retune the subsidiary layer without a deploy; reads fall
// back to the shipped default. The pure resolution and enforcement functions
// live in config/commentVisibility.js; the Q&A module (server/qa.js) imports the
// loader here and applies the filter on every read.
// ---------------------------------------------------------------------------

export async function loadCommentVisibilityConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [COMMENT_VISIBILITY_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultCommentVisibilityConfig();
    return resolveCommentVisibilityConfig(rows[0].setting_value);
  } catch {
    return defaultCommentVisibilityConfig();
  }
}

async function persistCommentVisibilityConfig(config, actor) {
  const payload = {
    setting_key: COMMENT_VISIBILITY_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Internal vs shared comment visibility policy (AUD-03)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [COMMENT_VISIBILITY_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'comment-visibility-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export {
  isSubsidiaryViewer, mayViewVisibility, canViewInternal,
  COMMENT_VISIBILITIES, COMMENT_VISIBILITY_MESSAGES, COMMENT_VISIBILITY_CROSS_ORG_ROLES,
  defaultCommentVisibilityConfig, resolveCommentVisibilityConfig, validateCommentVisibilityConfig,
};

export const commentVisibilityRouter = express.Router();

commentVisibilityRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/comment-visibility - the effective policy, the shipped default and
// what the calling user themselves is allowed to see.
commentVisibilityRouter.get('/', async (req, res) => {
  try {
    const config = await loadCommentVisibilityConfig();
    const { ok, errors } = validateCommentVisibilityConfig(config);
    res.json({
      config,
      defaults: defaultCommentVisibilityConfig(),
      visibilities: COMMENT_VISIBILITIES,
      valid: ok,
      errors,
      viewer: {
        subsidiary_only: isSubsidiaryViewer(config, req.actor),
        may_view_internal: canViewInternal(config, req.actor),
      },
      disclaimer: COMMENT_VISIBILITY_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/comment-visibility - replace the policy and mint a revision (admin).
commentVisibilityRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the comment visibility policy' });
    }
    const base = await loadCommentVisibilityConfig();
    const config = buildCommentVisibilityConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffCommentVisibilityConfig(base, config);
    const id = await persistCommentVisibilityConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'comment_visibility_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

commentVisibilityRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'comment_visibility_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default commentVisibilityRouter;
