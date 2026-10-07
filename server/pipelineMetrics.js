import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure, isCrossOrgReader } from './rbac.js';
import { getSlaTargets, STATE_LABELS } from './pipeline.js';
import { normalizeState } from './config/workflowStates.js';
import {
  PIPELINE_METRICS_KEY,
  PIPELINE_METRICS_MESSAGES,
  FUNNEL_STAGES,
  BRANCH_STATES,
  METRIC_RANGES,
  defaultPipelineMetricsConfig,
  resolvePipelineMetricsConfig,
  validatePipelineMetricsConfig,
  diffPipelineMetricsConfig,
  buildPipelineMetricsConfig,
  parseRange,
  rangeStart,
  buildMetrics,
} from './config/pipelineMetrics.js';

// ---------------------------------------------------------------------------
// Funnel & cycle-time metrics (W7-03 / BRD DSH-04).
//
// The Investment Team tracks how many opportunities reach each forward stage
// (submission -> screening -> refinement -> approval), why the ones that leave
// are declined / returned / withdrawn, and how long each stage takes against
// its SLA target. Everything is computed over the actor's own organisation
// scope, so a subsidiary sees only its metrics. The default range and the
// optional display of cycle time live in an AppSettings record
// (setting_key = 'pipeline_metrics_config'); reads fall back to the default.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';

export async function loadPipelineMetricsConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [PIPELINE_METRICS_KEY]
    );
    if (!rows[0]?.setting_value) return defaultPipelineMetricsConfig();
    return resolvePipelineMetricsConfig(rows[0].setting_value);
  } catch {
    return defaultPipelineMetricsConfig();
  }
}

async function persistPipelineMetricsConfig(config, actor) {
  const payload = {
    setting_key: PIPELINE_METRICS_KEY,
    setting_value: JSON.stringify(config),
    description: 'Funnel and cycle-time metrics configuration (default range, cycle-time display)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [PIPELINE_METRICS_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'pipeline-metrics-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

// The opportunity rows and the ordered transitions the actor may see, scoped by
// the same org visibility rule as the board.
async function scopeIds(actor) {
  if (isCrossOrgReader(actor.membership)) return null;
  return Array.from(new Set([actor.org_id, ...(actor.descendant_ids || []), ...(actor.granted_org_ids || [])]));
}

export async function loadMetricRows(actor, { since = null } = {}) {
  const ids = await scopeIds(actor);
  const oppParams = [OPPORTUNITY_ENTITY];
  const oppWhere = ['entity = $1', 'deleted = false'];
  if (ids) { oppParams.push(ids); oppWhere.push('owner_org_id = ANY($' + oppParams.length + ')'); }
  if (since != null) { oppParams.push(new Date(since).toISOString()); oppWhere.push('updated_date >= $' + oppParams.length); }
  const { rows: opps } = await pool.query(
    'SELECT id, owner_org_id, data, created_date, updated_date FROM entity_record WHERE ' + oppWhere.join(' AND ') + ' ORDER BY updated_date DESC LIMIT 1000',
    oppParams
  );
  const trParams = [];
  const trWhere = [];
  if (ids) { trParams.push(ids); trWhere.push('owner_org_id = ANY($' + trParams.length + ')'); }
  if (since != null) { trParams.push(new Date(since).toISOString()); trWhere.push('created_at >= $' + trParams.length); }
  const trSql = 'SELECT * FROM pipeline_transition' + (trWhere.length ? ' WHERE ' + trWhere.join(' AND ') : '') + ' ORDER BY opportunity_id, created_at ASC LIMIT 5000';
  const { rows: transitions } = await pool.query(trSql, trParams);
  return { opps, transitions };
}

// Build the per-opportunity stage index the pure module needs: the current
// state, the forward stages reached, and the timestamp at which each stage was
// entered.
function indexStage(card, transitionsForOpp, state) {
  const reached = [];
  const stageTimes = {};
  for (const t of transitionsForOpp) {
    if (t.to_state) reached.push(t.to_state);
    if (t.to_state && stageTimes[t.to_state] == null) stageTimes[t.to_state] = t.created_at ? new Date(t.created_at).getTime() : null;
  }
  // Records submitted under the pre-BRD v2 names were "submitted" when they
  // entered screening, so the funnel's first stage counts them too.
  if (stageTimes.submitted == null && stageTimes.screening_review != null) stageTimes.submitted = stageTimes.screening_review;
  return { current: state, reached, stageTimes };
}

// Compose the metrics pack for the actor.
export async function buildPipelineMetrics(actor, query = {}, { config } = {}) {
  const cfg = config || await loadPipelineMetricsConfig();
  const range = parseRange(query, { config: cfg });
  const since = rangeStart(range);
  const loaded = await loadMetricRows(actor, { since });
  const opps = loaded.opps;
  // Legacy state names on older history rows count as their BRD v2 state.
  const transitions = loaded.transitions.map((t) => ({ ...t, from_state: t.from_state ? normalizeState(t.from_state) : t.from_state, to_state: normalizeState(t.to_state) }));

  const byOpp = new Map();
  for (const t of transitions) {
    if (!byOpp.has(t.opportunity_id)) byOpp.set(t.opportunity_id, []);
    byOpp.get(t.opportunity_id).push(t);
  }

  const stageByOpportunity = {};
  for (const row of opps) {
    const state = normalizeState(row.data?.status);
    stageByOpportunity[row.id] = indexStage(row, byOpp.get(row.id) || [], state);
  }
  const slaByState = await getSlaTargets();
  const stageDefs = FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, state_label: STATE_LABELS[s.key] || s.label }));
  const result = buildMetrics(opps, transitions, { stageByOpportunity, slaTargets: slaByState });
  return {
    config: cfg,
    range,
    stages: stageDefs,
    branch_states: BRANCH_STATES,
    ...result,
    generated_at: new Date().toISOString(),
  };
}

export const pipelineMetricsRouter = express.Router();

pipelineMetricsRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/pipeline-metrics - the effective configuration + vocabulary.
pipelineMetricsRouter.get('/', async (_req, res) => {
  try {
    const config = await loadPipelineMetricsConfig();
    const { ok, errors } = validatePipelineMetricsConfig(config);
    res.json({
      config,
      defaults: defaultPipelineMetricsConfig(),
      stages: FUNNEL_STAGES,
      branch_states: BRANCH_STATES,
      ranges: METRIC_RANGES,
      valid: ok,
      errors,
      disclaimer: PIPELINE_METRICS_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// GET /api/pipeline-metrics/summary - funnel + cycle time for a range.
pipelineMetricsRouter.get('/summary', async (req, res) => {
  try {
    res.json(await buildPipelineMetrics(req.actor, req.query));
  } catch (err) { sendErr(res, err); }
});

// PUT /api/pipeline-metrics/config - an admin replaces the configuration.
pipelineMetricsRouter.put('/config', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the metrics configuration' });
    }
    const base = await loadPipelineMetricsConfig();
    const config = buildPipelineMetricsConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffPipelineMetricsConfig(base, config);
    const id = await persistPipelineMetricsConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'pipeline_metrics_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/pipeline-metrics/config-history - the audited configuration edits.
pipelineMetricsRouter.get('/config-history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'pipeline_metrics_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default pipelineMetricsRouter;
