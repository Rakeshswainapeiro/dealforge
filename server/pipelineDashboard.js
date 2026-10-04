import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { listOrganizations } from './org.js';
import { screeningBoard } from './pipeline.js';
import {
  PIPELINE_DASHBOARD_KEY,
  PIPELINE_DASHBOARD_MESSAGES,
  FILTER_DIMENSIONS,
  DATE_PRESETS,
  DRILLDOWN_DIMENSIONS,
  defaultPipelineDashboardConfig,
  resolvePipelineDashboardConfig,
  validatePipelineDashboardConfig,
  diffPipelineDashboardConfig,
  buildPipelineDashboardConfig,
  parseFilters,
  filterCards,
  filterOptions,
  drillDown,
  summarizePipeline,
  activeFilterCount,
} from './config/pipelineDashboard.js';

// ---------------------------------------------------------------------------
// Pipeline dashboard (W7-02 / BRD DSH-01).
//
// The Investment Team board is sliced by entity, cluster, sector, stage, owner
// and date, and can be drilled down by any of those cuts. This route applies
// the filter set over the live screening board (the board itself already
// respects the actor's organisation scope) and returns the filtered cards, the
// near-real-time summary, the options present in the current scope and the
// drill-down grouping. The dimension list and default drill-down live in an
// AppSettings record (setting_key = 'pipeline_dashboard_config'); reads fall
// back to the shipped default.
// ---------------------------------------------------------------------------

export async function loadPipelineDashboardConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [PIPELINE_DASHBOARD_KEY]
    );
    if (!rows[0]?.setting_value) return defaultPipelineDashboardConfig();
    return resolvePipelineDashboardConfig(rows[0].setting_value);
  } catch {
    return defaultPipelineDashboardConfig();
  }
}

async function persistPipelineDashboardConfig(config, actor) {
  const payload = {
    setting_key: PIPELINE_DASHBOARD_KEY,
    setting_value: JSON.stringify(config),
    description: 'Pipeline dashboard configuration (filter dimensions, default drill-down)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [PIPELINE_DASHBOARD_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'pipeline-dashboard-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

// The subsidiary names for the entity labels.
async function subsidiaryNames() {
  const orgs = await listOrganizations().catch(() => []);
  const names = {};
  for (const o of orgs) names[o.id] = o.name;
  return names;
}

// The board cards the actor may see, flattened.
async function boardCards(actor) {
  const board = await screeningBoard(actor);
  return { board, cards: board.columns.flatMap((col) => col.items) };
}

// Compose the filtered dashboard for the actor.
export async function buildDashboard(actor, query = {}, { config } = {}) {
  const cfg = config || await loadPipelineDashboardConfig();
  const { board, cards } = await boardCards(actor);
  const names = await subsidiaryNames();
  const filters = parseFilters(query);
  const filtered = filterCards(cards, filters);
  const dimension = typeof query.drilldown === 'string' && query.drilldown ? query.drilldown : cfg.default_drilldown;
  const options = filterOptions(cards, { subsidiaryNames: names });
  return {
    config: cfg,
    filters,
    active_filters: activeFilterCount(filters),
    cards: filtered,
    summary: summarizePipeline(filtered),
    options,
    drilldown: drillDown(filtered, dimension, { subsidiaryNames: names }),
    board_total: board.total,
    by_state: board.by_state,
    generated_at: new Date().toISOString(),
  };
}

export const pipelineDashboardRouter = express.Router();

pipelineDashboardRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/pipeline-dashboard - the effective configuration + filter vocabulary.
pipelineDashboardRouter.get('/', async (_req, res) => {
  try {
    const config = await loadPipelineDashboardConfig();
    const { ok, errors } = validatePipelineDashboardConfig(config);
    res.json({
      config,
      defaults: defaultPipelineDashboardConfig(),
      dimensions: FILTER_DIMENSIONS,
      date_presets: DATE_PRESETS,
      drilldown_dimensions: DRILLDOWN_DIMENSIONS,
      valid: ok,
      errors,
      disclaimer: PIPELINE_DASHBOARD_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// GET /api/pipeline-dashboard/board - the filtered board + drill-down.
pipelineDashboardRouter.get('/board', async (req, res) => {
  try {
    res.json(await buildDashboard(req.actor, req.query));
  } catch (err) { sendErr(res, err); }
});

// PUT /api/pipeline-dashboard/config - an admin replaces the configuration.
pipelineDashboardRouter.put('/config', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the dashboard configuration' });
    }
    const base = await loadPipelineDashboardConfig();
    const config = buildPipelineDashboardConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffPipelineDashboardConfig(base, config);
    const id = await persistPipelineDashboardConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'pipeline_dashboard_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/pipeline-dashboard/config-history - the audited configuration edits.
pipelineDashboardRouter.get('/config-history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'pipeline_dashboard_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default pipelineDashboardRouter;
