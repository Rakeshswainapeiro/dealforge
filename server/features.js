import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit } from './audit.js';
import {
  FEATURE_GROUPS,
  FEATURE_GROUPS_META,
  FEATURE_SETTING_KEY,
  resolveFeatureFlags,
} from './config/featureFlags.js';

// Helper to fetch the stored runtime feature overrides for the whole app.
export async function getRuntimeFeatureFlags() {
  const { rows } = await pool.query(
    `SELECT data->>'setting_value' AS setting_value FROM entity_record
     WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
    [FEATURE_SETTING_KEY]
  );
  if (!rows[0]?.setting_value) return {};
  try { return JSON.parse(rows[0].setting_value); } catch { return {}; }
}

// Resolve the final feature map from defaults + runtime overrides + env.
export async function resolveAppFeatures({ env = process.env.FEATURE_FLAGS } = {}) {
  const runtime = await getRuntimeFeatureFlags().catch(() => ({}));
  return resolveFeatureFlags({ runtime, env });
}

export const featuresRouter = express.Router();

featuresRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

// GET /api/features - current feature map + configurable groups (any authenticated user).
featuresRouter.get('/', async (_req, res) => {
  try {
    const features = await resolveAppFeatures();
    res.json({
      features,
      defaults: FEATURE_GROUPS,
      groups: FEATURE_GROUPS_META,
      settingKey: FEATURE_SETTING_KEY,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/features - persist runtime feature overrides (admin / configurator).
featuresRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change feature configuration' });
    }
    const overrides = req.body?.features && typeof req.body.features === 'object' ? req.body.features : {};
    const { rows: existing } = await pool.query(
      `SELECT id FROM entity_record
       WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
      [FEATURE_SETTING_KEY]
    );
    const payload = {
      setting_key: FEATURE_SETTING_KEY,
      setting_value: JSON.stringify(overrides),
      description: 'Runtime feature/menu visibility configuration',
      last_updated_by: req.actor.email,
    };
    let record;
    if (existing[0]) {
      record = await pool.query(
        `UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3
         WHERE id = $1 RETURNING *`,
        [existing[0].id, JSON.stringify(payload), req.actor.email]
      );
    } else {
      record = await pool.query(
        `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
         VALUES ($1,'AppSettings',$2,$3,$4,$4) RETURNING *`,
        [req.body?.id || ('feature-flags-' + Date.now().toString(36)), req.actor.org_id, JSON.stringify(payload), req.actor.email]
      );
    }
    const finalFeatures = await resolveAppFeatures();
    await writeAudit({
      entity: 'AppSettings',
      entityId: existing[0]?.id || record.rows[0].id,
      action: 'update',
      actor: req.actor,
      orgId: req.actor.org_id,
      after: { setting_key: FEATURE_SETTING_KEY, features: finalFeatures },
    });
    res.json({ features: finalFeatures, saved: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default featuresRouter;
