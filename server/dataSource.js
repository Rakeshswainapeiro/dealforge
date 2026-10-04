import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  DATA_SOURCE_CONFIG_KEY,
  DATA_SOURCE_MESSAGES,
  defaultDataSourceConfig,
  validateDataSourceConfig,
  resolveDataSourceConfig,
  diffDataSourceConfig,
  buildDataSourceConfig,
} from './config/dataSource.js';

// ---------------------------------------------------------------------------
// Data-point to source mapping API (W5-04 / BRD DOC-05).
//
// The mapping is held in an AppSettings record (setting_key =
// 'data_source_config'). Reads fall back to the shipped default, where every
// memo data point is linked to the artefact or field it came from, so nothing
// changes until an administrator re-points a data point. Writes require the
// admin / configurator role and mint the next revision.
// ---------------------------------------------------------------------------

export async function loadDataSourceConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [DATA_SOURCE_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultDataSourceConfig();
    return resolveDataSourceConfig(rows[0].setting_value);
  } catch {
    return defaultDataSourceConfig();
  }
}

async function persistDataSource(config, actor) {
  const payload = {
    setting_key: DATA_SOURCE_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Data-point to source mapping (memo provenance links)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [DATA_SOURCE_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'data-source-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const dataSourceRouter = express.Router();

dataSourceRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/data-sources - the effective mapping (any authenticated reader).
dataSourceRouter.get('/', async (_req, res) => {
  try {
    const config = await loadDataSourceConfig();
    const { ok, errors } = validateDataSourceConfig(config);
    res.json({ config, valid: ok, errors, defaults: defaultDataSourceConfig(), disclaimer: DATA_SOURCE_MESSAGES.disclaimer });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/data-sources - replace the mapping and mint a revision.
dataSourceRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the data-source mapping' });
    }
    const base = await loadDataSourceConfig();
    const config = buildDataSourceConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffDataSourceConfig(base, config);
    const id = await persistDataSource(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'data_source_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/data-sources/history - the revision history (audit trail).
dataSourceRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'data_source_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default dataSourceRouter;
