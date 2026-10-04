// ---------------------------------------------------------------------------
// Document template renderers (W5-05 / DOC-06).
//
// Turns a template-library entry into the downloadable artefact. The Opportunity
// Overview is rendered to Word with the same six-page layout the memo uses; the
// financial model, risk register and gate checklist are rendered to CSV so the
// intake squad can open them in any spreadsheet tool without a build step.
//
// The content is drawn from the same configuration the rest of the app uses -
// the memo template, the Part B financials grid and the ten qualifying gates -
// so a downloaded template can never drift from the rules the system enforces.
//
// Pure functions only - no database, no network. See renderTemplate().
// ---------------------------------------------------------------------------

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, PageNumber, PageBreak,
} from 'docx';
import {
  MEMO_PAGE_TABS, MEMO_PAGE_TITLES, MEMO_PAGE_CAPTIONS, SIRIUS_CONFIDENTIALITY,
} from './config/siriusMemo.js';
import { FINANCIAL_PERIODS, FINANCIAL_ROWS } from './config/financials.js';
import { QUALIFYING_GATES } from './config/qualifyingGates.js';
import { INTAKE_FIELDS } from './config/intakeConfig.js';
import {
  RISK_REGISTER_COLUMNS, GATE_CHECKLIST_COLUMNS, TEMPLATE_LIBRARY_OWNER, findTemplate,
} from './config/templateLibraryData.js';

const ACCENT = '0E7490';
const BAND_FILL = 'EAF7FA';
const HEAD_FILL = 'E6F4F1';
const BORDER = 'D0D5DD';
const BODY = '1F2937';
const MUTED = '6B7280';
const PLACEHOLDER = '7A8699';
const CONTENT_W = 9020;

const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function run(text, opts = {}) {
  return new TextRun({
    text: text === undefined || text === null ? '' : String(text),
    bold: !!opts.bold,
    italics: !!opts.italics,
    color: opts.color || BODY,
    size: opts.size || 18,
    font: 'Arial',
  });
}

function para(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [run(text, opts)];
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before || 0, after: opts.after === undefined ? 80 : opts.after, line: 264 },
    children: runs,
  });
}

function placeholderPara(text) {
  return para([run(text, { italics: true, color: PLACEHOLDER, size: 17 })]);
}

function cell(children, opts = {}) {
  const content = Array.isArray(children) ? children : [children];
  return new TableCell({
    borders: cellBorders,
    shading: opts.fill ? { fill: opts.fill } : undefined,
    columnSpan: opts.columnSpan,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: content,
  });
}

// The header key-facts block the memo prints above page 1.
const KEY_FACT_LABELS = [
  ['Total commitment (AED mn)', 'total_commitment_aed'],
  ['Ask from Sirius (AED mn)', 'ask_aed'],
  ['Opportunity type', 'opportunity_type'],
  ['Target / counterparty', 'target_name'],
  ['Sector & geography', 'geography'],
  ['Subsidiary', 'subsidiary_name'],
];

function keyFactTable() {
  const rows = [];
  for (let i = 0; i < KEY_FACT_LABELS.length; i += 2) {
    const pair = KEY_FACT_LABELS.slice(i, i + 2);
    const cells = [];
    for (const [label] of pair) {
      cells.push(cell([para([run(label, { bold: true, size: 16, color: MUTED })])], { fill: HEAD_FILL, width: CONTENT_W / 4 }));
      cells.push(cell([placeholderPara('_____')], { width: CONTENT_W / 4 }));
    }
    while (cells.length < 4) cells.push(cell([para('')], { width: CONTENT_W / 4 }));
    rows.push(new TableRow({ children: cells }));
  }
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, rows });
}

function renderOpportunityOverview() {
  const children = [];

  children.push(para([run('Sirius International Holding Limited', { bold: true, size: 24, color: ACCENT })]));
  children.push(para([run('Opportunity Overview - submission template', { size: 22, color: ACCENT })]));
  children.push(para([run('Maintained by ' + TEMPLATE_LIBRARY_OWNER, { italics: true, size: 16, color: MUTED })]));
  children.push(para([run('Key facts', { bold: true, size: 20, color: ACCENT })], { before: 160 }));
  children.push(keyFactTable());
  children.push(para([], { after: 120 }));

  MEMO_PAGE_TABS.forEach((tab, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(para([run(tab.number + '. ' + MEMO_PAGE_TITLES[tab.key], { bold: true, size: 22, color: ACCENT })], { before: 120 }));
    children.push(para([run(MEMO_PAGE_CAPTIONS[tab.key], { italics: true, size: 16, color: MUTED })]));
    children.push(placeholderPara('Populate this page with the evidence behind the opportunity. Every value must be traceable to a document or captured field on the record.'));
  });

  return new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 18, color: BODY } } } },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [run('Opportunity Overview template', { size: 14, color: MUTED })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              run(SIRIUS_CONFIDENTIALITY + '        ', { size: 14, color: MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUTED, font: 'Arial' }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

// --- CSV -----------------------------------------------------------------

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function financialModelCsv() {
  const rows = [];
  rows.push(['Sirius three-statement financial model - ' + TEMPLATE_LIBRARY_OWNER]);
  rows.push(['Amounts in AED mn. Audited actuals FY-3 A to FY-1 A; projections Y1 P to Y5 P.']);
  rows.push(['New ventures may leave the actual columns blank. Growth %, EBITDA margin %, FCF and net debt / EBITDA are derived.']);
  rows.push([]);
  rows.push(['Line item', 'Kind', 'Unit', ...FINANCIAL_PERIODS]);
  for (const row of FINANCIAL_ROWS) {
    rows.push([row.label, row.kind, row.unit, ...FINANCIAL_PERIODS.map(() => '')]);
  }
  rows.push([]);
  rows.push(['Inputs', 'Value']);
  rows.push(['Net debt (AED mn)', '']);
  rows.push(['Free cash flow (AED mn)', '']);
  return toCsv(rows);
}

function riskRegisterCsv() {
  const rows = [];
  rows.push(['Sirius risk register - ' + TEMPLATE_LIBRARY_OWNER]);
  rows.push(['Capture 5-8 material risks, each with a named owner. Feeds the memo risk section and the "Risk owned" gate.']);
  rows.push([]);
  rows.push(RISK_REGISTER_COLUMNS);
  for (let i = 1; i <= 8; i += 1) {
    rows.push(['R-' + String(i).padStart(2, '0'), '', '', '', '', '', '', '']);
  }
  return toCsv(rows);
}

function gateChecklistCsv() {
  const labels = new Map(INTAKE_FIELDS.map((f) => [f.key, f.label]));
  const rows = [];
  rows.push(['Sirius qualifying-gate checklist - ' + TEMPLATE_LIBRARY_OWNER]);
  rows.push(['Every gate must be answered YES with its evidence linked before the opportunity may be submitted.']);
  rows.push([]);
  rows.push(GATE_CHECKLIST_COLUMNS);
  for (const gate of QUALIFYING_GATES) {
    const evidence = (gate.evidence || []).map((e) => labels.get(e.key) || e.key).join('; ');
    rows.push([gate.number, gate.label, gate.question, evidence, '', '', '']);
  }
  return toCsv(rows);
}

// Render a template to its artefact buffer. Returns { buffer, filename,
// contentType, id, format }.
export async function renderTemplate(id) {
  const meta = findTemplate(id);
  if (!meta) {
    const e = new Error('Unknown template id (' + id + ')');
    e.status = 404;
    throw e;
  }
  if (meta.format === 'docx') {
    const buffer = await Packer.toBuffer(renderOpportunityOverview());
    return { buffer, filename: meta.filename, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  let csv = '';
  if (id === 'financial_model') csv = financialModelCsv();
  else if (id === 'risk_register') csv = riskRegisterCsv();
  else if (id === 'gate_checklist') csv = gateChecklistCsv();
  else {
    const e = new Error('No renderer for template (' + id + ')');
    e.status = 500;
    throw e;
  }
  return { buffer: Buffer.from(csv, 'utf8'), filename: meta.filename, contentType: 'text/csv; charset=utf-8' };
}

export default { renderTemplate };
