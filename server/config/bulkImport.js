// ---------------------------------------------------------------------------
// Bulk import vocabulary + validation (W8-05 / BRD INTG-03).
//
// The Phase-1 pilot carries deals already in flight in a spreadsheet. INTG-03
// asks for a one-off bulk import with a validation report, so a row that cannot
// be loaded is reported (with the reason) rather than silently dropped.
//
// This module is pure: it maps tracker columns to the intake capture model,
// parses CSV, validates each row against the shipped vocabulary and the org
// tree, and composes the report shape. The route that creates the records lives
// in server/bulkImport.js and walks the real audited create/transition APIs.
// ---------------------------------------------------------------------------

import { INTAKE_FIELD_KEYS, ELIGIBLE_TYPES, OUTSIDE_APPETITE_TYPES, SOURCING_CHANNELS } from './intakeConfig.js';

export const BULK_IMPORT_VERSION = 'INTG-03.1';

export const BULK_IMPORT_CONFIG_KEY = 'bulk_import_policy';

// Import policy: a bounded one-off load. The row ceiling is generous but stops
// an accidental whole-database upload; the required columns are the ones the
// pipeline cannot work without.
export const IMPORT_POLICY = {
  max_rows: 500,
  required_columns: ['opportunity_name', 'owner_org_id', 'sector', 'geography', 'total_commitment_aed'],
};

// Tracker column header -> canonical capture key. Headers are matched
// case-insensitively and with spaces/underscores collapsed, so the existing
// Sirius tracker export loads without the operator renaming anything.
export const IMPORT_COLUMNS = [
  { key: 'opportunity_name', header: 'Opportunity name', required: true },
  { key: 'opportunity_type', header: 'Opportunity type', required: false },
  { key: 'target_name', header: 'Target / counterparty', required: false },
  { key: 'sector', header: 'Sector', required: true },
  { key: 'geography', header: 'Geography', required: true },
  { key: 'total_commitment_aed', header: 'Total commitment (AED mn)', required: true },
  { key: 'ask_aed', header: 'Ask from Sirius (AED mn)', required: false },
  { key: 'entry_valuation_aed', header: 'Entry valuation (AED mn)', required: false },
  { key: 'entry_multiple', header: 'Entry multiple (x)', required: false },
  { key: 'funding_source', header: 'Funding source', required: false },
  { key: 'in_approved_budget', header: 'In approved budget?', required: false },
  { key: 'target_signing_close', header: 'Target signing / close', required: false },
  { key: 'sourcing_channel', header: 'Sourcing channel', required: false },
  { key: 'owner_email', header: 'Owner email', required: false },
  { key: 'owner_org_id', header: 'Owning org id', required: true },
  { key: 'state', header: 'State', required: false },
  { key: 'narrative_what', header: 'What (narrative)', required: false },
];
export const IMPORT_COLUMN_KEYS = IMPORT_COLUMNS.map((c) => c.key);

// Columns the reader understands; anything else is ignored (and reported).
export const IMPORT_KNOWN_HEADERS = new Set(IMPORT_COLUMNS.map((c) => normaliseHeader(c.header)));

// A deal already in flight is loaded as a draft or straight into Screening
// Review (BRD v2 WF-01). The legacy names 'submission' and 'screening' from the
// old tracker are read as Screening Review.
export const IMPORT_STATES = ['draft', 'screening_review'];
const LEGACY_IMPORT_STATES = { submission: 'screening_review', screening: 'screening_review' };
export function importState(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return LEGACY_IMPORT_STATES[key] || key;
}
export const IMPORT_ROW_STATUSES = ['valid', 'warning', 'error'];

export const BULK_IMPORT_MESSAGES = {
  scope_note:
    'One-off load of deals already in flight. Every row is validated against the shipped '
    + 'capture vocabulary and the organisation tree; a row that cannot be loaded is reported '
    + 'with its reason rather than dropped. Loaded records are created through the audited '
    + 'entity API so they carry the same trail as a person-entered deal.',
  empty: 'No data rows found in the upload.',
  too_many_rows: 'The upload has more rows than the import policy allows.',
  missing_required_columns: 'The upload is missing required columns.',
};

// Collapse a header for matching: lowercase, trim, drop punctuation/extra space.
export function normaliseHeader(h) {
  return String(h == null ? '' : h).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Map a raw header cell to a canonical capture key (or null when unknown).
export function columnKeyForHeader(header) {
  const n = normaliseHeader(header);
  for (const c of IMPORT_COLUMNS) if (normaliseHeader(c.header) === n) return c.key;
  // Accept the canonical key itself as a header so a re-export round-trips.
  if (IMPORT_COLUMN_KEYS.includes(n.replace(/ /g, '_'))) return n.replace(/ /g, '_');
  return null;
}

// --- CSV ------------------------------------------------------------------
// A dependency-free RFC4180-ish splitter: quoted cells, escaped quotes and
// embedded commas/newlines.
export function splitCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch === '\r') { /* swallow; \n handles the break */ }
    else cur += ch;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Convert a matrix (header row + data rows) into canonical-key objects plus the
// headers the reader did not recognise.
export function rowsFromMatrix(matrix = []) {
  if (!matrix.length) return { rows: [], headers: [], unknown_headers: [], missing_columns: [] };
  const headers = matrix[0].map((h) => String(h == null ? '' : h).trim());
  const keyByIndex = headers.map(columnKeyForHeader);
  const unknown_headers = headers.filter((h, i) => h && !keyByIndex[i]);
  const present = new Set(keyByIndex.filter(Boolean));
  const missing_columns = IMPORT_POLICY.required_columns.filter((k) => !present.has(k));
  const rows = matrix.slice(1).map((cells, ri) => {
    const obj = { _row: ri + 2 };
    keyByIndex.forEach((key, ci) => { if (key) obj[key] = String(cells[ci] == null ? '' : cells[ci]).trim(); });
    return obj;
  });
  return { rows, headers, unknown_headers, missing_columns };
}

export function parseCsv(text) {
  return rowsFromMatrix(splitCsv(text));
}

// --- validation -----------------------------------------------------------
const TYPE_VALUES = new Set([...ELIGIBLE_TYPES, ...OUTSIDE_APPETITE_TYPES].map((t) => t.value));
const CHANNEL_VALUES = new Set(SOURCING_CHANNELS.map((c) => c.value));

function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

// Validate one parsed row. `orgs` is a Set/array of known org ids; `fields` is
// the set of intake field keys the capture model knows. Returns a findings list.
export function validateImportRow(row, { orgIds = [], fieldKeys = INTAKE_FIELD_KEYS } = {}) {
  const errors = [];
  const warnings = [];
  const orgSet = new Set(orgIds);
  const fieldSet = new Set(fieldKeys);

  if (isBlank(row.opportunity_name)) errors.push('Opportunity name is required.');

  for (const key of IMPORT_POLICY.required_columns) {
    if (key === 'opportunity_name') continue;
    if (isBlank(row[key])) errors.push(key.replace(/_/g, ' ') + ' is required.');
  }

  const commitment = Number(row.total_commitment_aed);
  if (!isBlank(row.total_commitment_aed) && (!Number.isFinite(commitment) || commitment <= 0)) {
    errors.push('Total commitment must be a positive number.');
  }
  for (const numKey of ['ask_aed', 'entry_valuation_aed', 'entry_multiple']) {
    if (!isBlank(row[numKey]) && !Number.isFinite(Number(row[numKey]))) errors.push(numKey.replace(/_/g, ' ') + ' must be numeric.');
  }

  if (!isBlank(row.owner_org_id) && !orgSet.has(row.owner_org_id)) {
    errors.push('Owning org id "' + row.owner_org_id + '" is not a known organisation.');
  }

  if (!isBlank(row.opportunity_type) && !TYPE_VALUES.has(row.opportunity_type)) {
    warnings.push('Opportunity type "' + row.opportunity_type + '" is not in the shipped vocabulary.');
  }
  if (!isBlank(row.sourcing_channel) && !CHANNEL_VALUES.has(row.sourcing_channel)) {
    warnings.push('Sourcing channel "' + row.sourcing_channel + '" is not in the shipped vocabulary.');
  }
  if (!isBlank(row.in_approved_budget) && !['yes', 'no'].includes(String(row.in_approved_budget).toLowerCase())) {
    warnings.push('In approved budget should be yes or no.');
  }
  if (!isBlank(row.state) && !IMPORT_STATES.includes(importState(row.state))) {
    warnings.push('State "' + row.state + '" is not importable; the row will be loaded as draft.');
  }
  if (!isBlank(row.owner_email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.owner_email)) {
    warnings.push('Owner email does not look like a valid address.');
  }

  // Recognised capture keys are those the intake model knows; a couple of
  // import-only keys (owner/state) are expected and not warned about.
  const importOnly = new Set(['owner_email', 'owner_org_id', 'state', '_row', 'id']);
  for (const k of Object.keys(row)) {
    if (importOnly.has(k) || k.startsWith('_')) continue;
    if (!fieldSet.has(k)) warnings.push('Column "' + k + '" is not a capture field and will be ignored.');
  }

  const status = errors.length ? 'error' : (warnings.length ? 'warning' : 'valid');
  return { status, errors, warnings };
}

// Validate a full parsed upload. Returns the report the API serves.
export function buildValidationReport(parsed, { orgIds = [], fieldKeys = INTAKE_FIELD_KEYS, policy = IMPORT_POLICY } = {}) {
  const { rows = [], unknown_headers = [], missing_columns = [] } = parsed || {};
  const report = {
    version: BULK_IMPORT_VERSION,
    scope_note: BULK_IMPORT_MESSAGES.scope_note,
    policy,
    unknown_headers,
    missing_columns,
    total: rows.length,
    valid: 0, warning: 0, error: 0,
    importable: 0,
    rows: [],
  };

  if (rows.length === 0) { report.message = BULK_IMPORT_MESSAGES.empty; return report; }
  if (rows.length > policy.max_rows) { report.message = BULK_IMPORT_MESSAGES.too_many_rows; report.blocked = true; }
  if (missing_columns.length) { report.message = BULK_IMPORT_MESSAGES.missing_required_columns; report.blocked = true; }

  report.rows = rows.map((row) => {
    const finding = validateImportRow(row, { orgIds, fieldKeys });
    if (finding.status === 'valid') report.valid += 1;
    else if (finding.status === 'warning') report.warning += 1;
    else report.error += 1;
    if (finding.status !== 'error') report.importable += 1;
    return {
      row: row._row,
      opportunity_name: row.opportunity_name || null,
      owner_org_id: row.owner_org_id || null,
      status: finding.status,
      errors: finding.errors,
      warnings: finding.warnings,
    };
  });
  report.ok = !report.blocked && report.error === 0;
  return report;
}

// The load template (header + one illustrative row), Excel-openable as CSV.
export function importTemplateCsv() {
  const header = IMPORT_COLUMNS.map((c) => c.header);
  const sample = IMPORT_COLUMNS.map((c) => {
    switch (c.key) {
      case 'opportunity_name': return 'Example in-flight deal';
      case 'opportunity_type': return 'strategic_acquisition';
      case 'target_name': return 'Example Target LLC';
      case 'sector': return 'Technology';
      case 'geography': return 'UAE';
      case 'total_commitment_aed': return '120';
      case 'ask_aed': return '60';
      case 'entry_valuation_aed': return '200';
      case 'entry_multiple': return '6.5';
      case 'funding_source': return 'Balance sheet';
      case 'in_approved_budget': return 'yes';
      case 'target_signing_close': return '2026-12';
      case 'sourcing_channel': return 'proprietary';
      case 'owner_email': return 'deal.lead@infinia.local';
      case 'owner_org_id': return 'org-infinia-technologies-limited';
      case 'state': return 'draft';
      case 'narrative_what': return 'Acquire a platform with recurring revenue.';
      default: return '';
    }
  });
  const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return [header, sample].map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

export default {
  BULK_IMPORT_VERSION, BULK_IMPORT_CONFIG_KEY, IMPORT_POLICY, IMPORT_COLUMNS,
  IMPORT_COLUMN_KEYS, IMPORT_STATES, IMPORT_ROW_STATUSES, BULK_IMPORT_MESSAGES, importState,
  normaliseHeader, columnKeyForHeader, splitCsv, rowsFromMatrix, parseCsv,
  validateImportRow, buildValidationReport, importTemplateCsv,
};
