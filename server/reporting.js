import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { listOrganizations } from './org.js';
import { screeningBoard } from './pipeline.js';
import { buildXlsx } from './xlsx.js';
import {
  REPORTING_CONFIG_KEY,
  REPORTING_MESSAGES,
  WEEKLY_COLUMNS,
  WEEKDAYS,
  REPORTING_EXPORT_FORMATS,
  defaultReportingConfig,
  resolveReportingConfig,
  validateReportingConfig,
  diffReportingConfig,
  buildReportingConfig,
  scheduleKey,
  buildWeeklyRows,
  summarizeWeekly,
  toCsv,
} from './config/reporting.js';

// ---------------------------------------------------------------------------
// IHC weekly report (W7-01 / BRD DSH-03).
//
// The group Investment Holding Committee keeps a standing weekly tracker. This
// route reproduces that tracker straight from the live pipeline: the same
// columns in the agreed order, an Excel/CSV export, and an optional weekly
// schedule. The column set, the state filter and the schedule live in an
// AppSettings record (setting_key = 'reporting_config') so the group can retune
// the pack without a deploy; reads fall back to the shipped default.
// ---------------------------------------------------------------------------

export async function loadReportingConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [REPORTING_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultReportingConfig();
    return resolveReportingConfig(rows[0].setting_value);
  } catch {
    return defaultReportingConfig();
  }
}

async function persistReportingConfig(config, actor) {
  const payload = {
    setting_key: REPORTING_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'IHC weekly report configuration (columns, states, schedule)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [REPORTING_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'reporting-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

// Compose the weekly report for the actor: the tracker rows plus a summary.
export async function buildWeeklyReport(actor, { config } = {}) {
  const cfg = config || await loadReportingConfig();
  const board = await screeningBoard(actor);
  const cards = board.columns.flatMap((col) => col.items);
  const orgs = await listOrganizations().catch(() => []);
  const subsidiaryNames = {};
  for (const o of orgs) subsidiaryNames[o.id] = o.name;
  const states = new Set(cfg.states);
  const filtered = cards.filter((c) => states.has(c.state));
  const { columns, rows } = buildWeeklyRows(filtered, { config: cfg, subsidiaryNames });
  const summary = summarizeWeekly(rows);
  return { config: cfg, columns, rows, summary, generated_at: new Date().toISOString(), states: cfg.states };
}

function rowsToMatrix(report) {
  const header = report.columns.map((c) => c.label);
  const body = report.rows.map((r) => report.columns.map((c) => r.values[c.key]));
  return [header, ...body];
}

function filenameFor(config) {
  const stamp = new Date().toISOString().slice(0, 10);
  const wd = WEEKDAYS.find((d) => d.value === config.schedule?.weekday)?.label || 'Weekly';
  return 'IHC_' + wd + '_Tracker_' + stamp;
}

export const reportingRouter = express.Router();

reportingRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/reporting/config - the effective configuration + vocabulary.
reportingRouter.get('/config', async (_req, res) => {
  try {
    const config = await loadReportingConfig();
    const { ok, errors } = validateReportingConfig(config);
    res.json({
      config,
      defaults: defaultReportingConfig(),
      all_columns: WEEKLY_COLUMNS,
      weekdays: WEEKDAYS,
      formats: REPORTING_EXPORT_FORMATS,
      valid: ok,
      errors,
      disclaimer: REPORTING_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/reporting/config - an admin replaces the configuration.
reportingRouter.put('/config', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the reporting configuration' });
    }
    const base = await loadReportingConfig();
    const config = buildReportingConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffReportingConfig(base, config);
    const id = await persistReportingConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'reporting_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/reporting/config-history - the audited configuration edits.
reportingRouter.get('/config-history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'reporting_config_updated'));
  } catch (err) { sendErr(res, err); }
});

// GET /api/reporting/weekly - the weekly tracker (JSON).
reportingRouter.get('/weekly', async (req, res) => {
  try {
    const report = await buildWeeklyReport(req.actor);
    res.json(report);
  } catch (err) { sendErr(res, err); }
});

// GET /api/reporting/weekly.xlsx - the weekly tracker as an Excel workbook.
reportingRouter.get('/weekly.xlsx', async (req, res) => {
  try {
    const report = await buildWeeklyReport(req.actor);
    const matrix = rowsToMatrix(report);
    // Prepend a title + summary banner, then the tracker table.
    const banner = [
      ['IHC Weekly Deal Tracker'],
      ['Generated', report.generated_at, 'Total', report.summary.total, 'SLA breaches', report.summary.breaches, 'Commitment (AED mn)', report.summary.commitment_aed_mn],
      [],
      ...matrix,
    ];
    const buffer = await buildXlsx({ sheetName: 'IHC Weekly Tracker', rows: banner });
    const filename = filenameFor(report.config) + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', String(buffer.length));
    await writeAudit({
      entity: 'AppSettings', entityId: 'ihc-weekly-report', action: 'weekly_report_export',
      actor: req.actor, orgId: req.actor.org_id,
      after: { format: 'xlsx', rows: report.rows.length, states: report.states },
    });
    res.send(buffer);
  } catch (err) { sendErr(res, err); }
});

// GET /api/reporting/weekly.csv - the weekly tracker as CSV.
reportingRouter.get('/weekly.csv', async (req, res) => {
  try {
    const report = await buildWeeklyReport(req.actor);
    const csv = toCsv({ columns: report.columns, rows: report.rows });
    const filename = filenameFor(report.config) + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(csv);
  } catch (err) { sendErr(res, err); }
});

// GET /api/reporting/schedule - the next scheduled run window.
reportingRouter.get('/schedule', async (_req, res) => {
  try {
    const config = await loadReportingConfig();
    res.json({
      schedule: config.schedule,
      enabled: config.schedule.enabled,
      next_window: scheduleKey(config.schedule),
      weekdays: WEEKDAYS,
    });
  } catch (err) { sendErr(res, err); }
});

export default reportingRouter;
