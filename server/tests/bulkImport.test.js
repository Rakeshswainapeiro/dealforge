// ---------------------------------------------------------------------------
// Bulk import unit tests (W8-05 / BRD INTG-03).
//
//   node --test server/tests/bulkImport.test.js
//
// Pure module + the XLSX reader/writer round trip. No server is needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, splitCsv, rowsFromMatrix, columnKeyForHeader, validateImportRow,
  buildValidationReport, importTemplateCsv, IMPORT_COLUMNS, IMPORT_POLICY,
  BULK_IMPORT_VERSION,
} from '../config/bulkImport.js';
import { buildXlsx } from '../xlsx.js';
import { readXlsx } from '../xlsxRead.js';

const ORGS = ['org-infinia-technologies-limited', 'org-finstreet-limited'];

describe('bulk import csv parsing (INTG-03)', () => {
  test('splits quoted cells, embedded commas and escaped quotes', () => {
    const rows = splitCsv('a,b\n"x, y","he said ""hi"""\n');
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  test('maps tracker headers to capture keys and flags unknown ones', () => {
    assert.equal(columnKeyForHeader('Opportunity name'), 'opportunity_name');
    assert.equal(columnKeyForHeader('TOTAL COMMITMENT (AED MN)'), 'total_commitment_aed');
    assert.equal(columnKeyForHeader('Nonsense column'), null);
    const parsed = parseCsv('Opportunity name,Mystery,Sector,Geography,Total commitment (AED mn),Owning org id\nDeal A,zzz,Energy,UAE,80,org-finstreet-limited\n');
    assert.deepEqual(parsed.unknown_headers, ['Mystery']);
    assert.deepEqual(parsed.missing_columns, []);
    assert.equal(parsed.rows[0].opportunity_name, 'Deal A');
  });

  test('reports the required columns that are absent', () => {
    const parsed = parseCsv('Opportunity name\nDeal A\n');
    assert.ok(parsed.missing_columns.includes('owner_org_id'));
    assert.ok(parsed.missing_columns.includes('sector'));
  });
});

describe('bulk import row validation (INTG-03)', () => {
  const good = {
    _row: 2, opportunity_name: 'Deal A', sector: 'Technology', geography: 'UAE',
    total_commitment_aed: '120', owner_org_id: 'org-infinia-technologies-limited',
    opportunity_type: 'strategic_acquisition', sourcing_channel: 'proprietary', in_approved_budget: 'yes',
  };

  test('a complete row is valid', () => {
    const f = validateImportRow(good, { orgIds: ORGS });
    assert.equal(f.status, 'valid');
    assert.deepEqual(f.errors, []);
  });

  test('missing required values and an unknown org are errors', () => {
    const f = validateImportRow({ _row: 3, opportunity_name: '', owner_org_id: 'org-nope', total_commitment_aed: '0' }, { orgIds: ORGS });
    assert.equal(f.status, 'error');
    assert.ok(f.errors.some((e) => /Organization|organisation/i.test(e) || /required/i.test(e)));
    assert.ok(f.errors.some((e) => /positive/i.test(e)));
  });

  test('off-vocabulary values are warnings, not errors', () => {
    const f = validateImportRow({ ...good, opportunity_type: 'mystery_type', in_approved_budget: 'maybe' }, { orgIds: ORGS });
    assert.equal(f.status, 'warning');
    assert.equal(f.errors.length, 0);
    assert.ok(f.warnings.length >= 2);
  });
});

describe('bulk import report (INTG-03)', () => {
  test('totals the report and blocks an upload with no data rows', () => {
    const report = buildValidationReport({ rows: [] }, { orgIds: ORGS });
    assert.equal(report.total, 0);
    assert.match(report.message, /No data rows/i);
    assert.equal(report.version, BULK_IMPORT_VERSION);
    assert.deepEqual(report.policy, IMPORT_POLICY);
  });

  test('counts valid / warning / error and which rows are importable', () => {
    const csv = [
      'Opportunity name,Sector,Geography,Total commitment (AED mn),Owning org id',
      'Deal A,Technology,UAE,120,org-infinia-technologies-limited',
      'Deal B,Energy,UAE,80,org-finstreet-limited',
      ',Energy,UAE,80,org-finstreet-limited',
    ].join('\n');
    const report = buildValidationReport(parseCsv(csv), { orgIds: ORGS });
    assert.equal(report.total, 3);
    assert.equal(report.valid, 2);
    assert.equal(report.error, 1);
    assert.equal(report.importable, 2);
    assert.equal(report.ok, false);
  });

  test('the template has every column and validates clean', () => {
    const csv = importTemplateCsv();
    const header = splitCsv(csv)[0];
    assert.equal(header.length, IMPORT_COLUMNS.length);
    const report = buildValidationReport(parseCsv(csv), { orgIds: ORGS });
    assert.equal(report.error, 0);
    assert.equal(report.total, 1);
  });
});

describe('xlsx reader round trip (INTG-03)', () => {
  test('reads back what the writer produced, including quoted text', async () => {
    const rows = [
      ['Opportunity name', 'Sector', 'Geography', 'Total commitment (AED mn)', 'Owning org id'],
      ['Deal A', 'Technology', 'UAE', 120, 'org-infinia-technologies-limited'],
      ['Deal, quoted', 'Energy', 'UAE', 80, 'org-finstreet-limited'],
    ];
    const buffer = await buildXlsx({ rows });
    const matrix = await readXlsx(buffer);
    const parsed = rowsFromMatrix(matrix);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].opportunity_name, 'Deal A');
    assert.equal(parsed.rows[1].opportunity_name, 'Deal, quoted');
    const report = buildValidationReport(parsed, { orgIds: ORGS });
    assert.equal(report.valid, 2);
  });
});
