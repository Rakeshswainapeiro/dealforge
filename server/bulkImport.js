// ---------------------------------------------------------------------------
// Bulk import of in-flight opportunities (W8-05 / BRD INTG-03).
//
// The pilot carries live deals in a spreadsheet; this loads them in one pass.
// Every row is validated first (dry run returns the report), and an execute pass
// creates only the importable rows through the audited entity API, so a loaded
// deal carries the same create audit a person-entered deal gets. The whole load
// is itself audited with a row-level summary.
// ---------------------------------------------------------------------------

import express from 'express';
import multer from 'multer';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure, canWriteOrg } from './rbac.js';
import { writeAudit } from './audit.js';
import { createRecord } from './entities.js';
import { systemSubmit } from './lifecycle.js';
import { UPLOAD_MAX_BYTES, uploadFilter } from './security.js';
import { readXlsx } from './xlsxRead.js';
import {
  BULK_IMPORT_VERSION, IMPORT_POLICY, IMPORT_COLUMNS, IMPORT_STATES, importState,
  BULK_IMPORT_MESSAGES, parseCsv, rowsFromMatrix, buildValidationReport, importTemplateCsv,
} from './config/bulkImport.js';
import { INTAKE_FIELD_KEYS } from './config/intakeConfig.js';

const OPPORTUNITY_ENTITY = 'DealOpportunity';

export const bulkImportRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: uploadFilter,
});

bulkImportRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// Known org ids and the capture field set the validator checks against.
async function loadValidationContext() {
  const { rows } = await pool.query('SELECT id FROM organization');
  return { orgIds: rows.map((r) => r.id), fieldKeys: INTAKE_FIELD_KEYS };
}

bulkImportRouter.get('/policy', (_req, res) => {
  res.json({
    version: BULK_IMPORT_VERSION,
    policy: IMPORT_POLICY,
    columns: IMPORT_COLUMNS,
    states: IMPORT_STATES,
    scope_note: BULK_IMPORT_MESSAGES.scope_note,
  });
});

bulkImportRouter.get('/template.csv', (_req, res) => {
  res.type('text/csv').send(importTemplateCsv());
});

// POST /api/bulk-import/validate - dry run; returns the row-level report.
bulkImportRouter.post('/validate', upload.single('file'), async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to run a bulk import' });
    }
    const parsed = await parseUpload(req);
    const ctx = await loadValidationContext();
    const report = buildValidationReport(parsed, ctx);
    res.json(report);
  } catch (err) { sendErr(res, err); }
});

// POST /api/bulk-import/execute - create the importable rows (audited).
bulkImportRouter.post('/execute', upload.single('file'), async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to run a bulk import' });
    }
    const parsed = await parseUpload(req);
    const ctx = await loadValidationContext();
    const report = buildValidationReport(parsed, ctx);
    if (report.blocked) return res.status(422).json({ error: report.message || 'The upload cannot be imported.', report });
    if (!req.body?.confirm) {
      return res.status(400).json({ error: 'Confirmation is required to load the records (field "confirm").' });
    }

    const created = [];
    for (const row of parsed.rows) {
      const finding = buildValidationReport({ rows: [row], missing_columns: [] }, ctx).rows[0];
      if (finding.status === 'error') continue;
      if (!canWriteOrg(req.actor.membership, row.owner_org_id, {
        descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids,
      })) continue;
      const record = await createImportRecord(row, req.actor);
      created.push({ row: row._row, id: record.id, opportunity_name: record.opportunity_name, state: record.status });
    }

    await writeAudit({
      entity: 'bulk_import', action: 'opportunities_imported', actor: req.actor, orgId: req.actor.org_id,
      after: { version: BULK_IMPORT_VERSION, total: report.total, created: created.length, skipped: report.total - created.length },
      comment: 'Bulk import of in-flight opportunities (INTG-03)',
    });

    res.json({ ok: true, version: BULK_IMPORT_VERSION, report, created, created_count: created.length });
  } catch (err) { sendErr(res, err); }
});

// Parse the request into { rows, unknown_headers, missing_columns }.
async function parseUpload(req) {
  if (req.file) {
    const name = String(req.file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      let matrix;
      try { matrix = await readXlsx(req.file.buffer); }
      catch (err) { const e = new Error('Could not read the workbook: ' + err.message); e.status = 400; throw e; }
      return rowsFromMatrix(matrix);
    }
    return parseCsv(req.file.buffer.toString('utf8'));
  }
  const csv = typeof req.body?.csv === 'string' ? req.body.csv
    : (typeof req.body?.text === 'string' ? req.body.text : null);
  if (!csv) { const e = new Error('Provide an upload file or a CSV body (field "csv").'); e.status = 400; throw e; }
  return parseCsv(csv);
}

// Create one opportunity through the audited entity API, then walk it to its
// target state. Unknown/absent state loads as a draft.
async function createImportRecord(row, actor) {
  const data = {
    opportunity_name: row.opportunity_name,
    owner_org_id: row.owner_org_id,
    status: 'draft',
    owner_email: row.owner_email || actor.email,
    bulk_import: true,
    bulk_import_version: BULK_IMPORT_VERSION,
  };
  for (const key of INTAKE_FIELD_KEYS) {
    if (key in row && row[key] !== '' && row[key] !== undefined) data[key] = row[key];
  }
  if (data.in_approved_budget) data.in_approved_budget = String(data.in_approved_budget).toLowerCase();
  for (const numKey of ['total_commitment_aed', 'ask_aed', 'entry_valuation_aed', 'entry_multiple']) {
    if (data[numKey] !== undefined && data[numKey] !== '' && Number.isFinite(Number(data[numKey]))) data[numKey] = Number(data[numKey]);
  }

  const record = await createRecord(OPPORTUNITY_ENTITY, data, { actor });
  const target = IMPORT_STATES.includes(importState(row.state)) ? importState(row.state) : 'draft';
  if (target === 'screening_review') {
    await systemSubmit(record.id, actor, { comment: 'Loaded from the bulk import (INTG-03).' });
  }
  const { rows } = await pool.query('SELECT data FROM entity_record WHERE entity = $1 AND id = $2', [OPPORTUNITY_ENTITY, record.id]);
  return { ...record, status: rows[0]?.data?.status || 'draft' };
}

export default bulkImportRouter;
