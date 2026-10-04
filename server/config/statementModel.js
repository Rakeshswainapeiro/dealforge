// ---------------------------------------------------------------------------
// Three-statement model configuration and check (FIN-02, REQ-FIN-02).
//
// The BRD makes a linked three-statement model — profit & loss, balance sheet
// and cash flow — a mandatory upload for a submission. The system checks that
// the three statements are present and that the balance sheet balances in each
// period (assets = liabilities + equity). A non-template model is still
// accepted but flagged for manual review, so nothing is silently discarded.
//
// Parsing is deliberately dependency-free: the canonical artefact is the Sirius
// template as CSV/TSV (column A = statement, column B = line item, then one
// column per fiscal period), with an equivalent JSON form. Anything else is
// parsed as far as possible and then flagged as non-template.
//
// Pure functions only — no database, no network. See parseStatementModel().
// ---------------------------------------------------------------------------

import { FINANCIAL_PERIODS, FINANCIAL_PERIOD_KEYS } from './financials.js';

// The three linked statements a complete model must carry, and the line items
// that identify each one. Markers are compared on a normalised label so
// spacing, case and punctuation do not matter.
export const THREE_STATEMENTS = [
  {
    key: 'profit_and_loss',
    label: 'Profit & loss (P&L)',
    markers: ['revenue', 'ebitda', 'net income'],
  },
  {
    key: 'balance_sheet',
    label: 'Balance sheet',
    markers: ['total assets', 'total liabilities', 'total equity'],
  },
  {
    key: 'cash_flow_statement',
    label: 'Cash flow statement',
    markers: ['operating cash flow', 'net cash flow'],
  },
];

export const STATEMENT_KEYS = THREE_STATEMENTS.map((s) => s.key);

// The balance-sheet totals the equality check reads. Config, not hard-coded at
// the call site (REQ-RULE-10).
export const BALANCE_SHEET_TOTALS = {
  assets: 'total assets',
  liabilities: 'total liabilities',
  equity: 'total equity',
};

// Tolerance as a percent of total assets: a rounding difference inside this
// band still counts as balanced. Configurable, not a magic number.
export const BALANCE_TOLERANCE_PCT = Number(process.env.BALANCE_TOLERANCE_PCT || 0.5);

// The document_requirement key this check rides on. The financials pack is the
// mandatory upload (REQ-DOCGATE-01), so the three-statement check attaches to
// it rather than adding a fourth blocking document.
export const STATEMENT_MODEL_REQUIREMENT_KEY = 'financials';

export const NON_TEMPLATE_MESSAGE =
  'Non-template model: accepted but flagged for manual review.';
export const NOT_ATTACHED_MESSAGE = 'Three-statement model not attached.';
export const UNBALANCED_MESSAGE =
  'Balance sheet does not balance in every period: total assets must equal total liabilities plus equity.';
export const MISSING_STATEMENT_MESSAGE =
  'Model is missing one or more of the three statements.';

function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function num(value) {
  if (value === undefined || value === null) return null;
  const cleaned = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value;
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Period label/key -> canonical period key.
const PERIOD_ALIASES = (() => {
  const out = {};
  FINANCIAL_PERIOD_KEYS.forEach((key, i) => {
    out[norm(FINANCIAL_PERIODS[i])] = key;
    out[norm(key)] = key;
  });
  return out;
})();

// Statement name -> canonical statement key.
const STATEMENT_ALIASES = (() => {
  const out = {
    pl: 'profit_and_loss',
    profitandloss: 'profit_and_loss',
    profitloss: 'profit_and_loss',
    incomestatement: 'profit_and_loss',
    balancesheet: 'balance_sheet',
    statementoffinancialposition: 'balance_sheet',
    cashflow: 'cash_flow_statement',
    cashflowstatement: 'cash_flow_statement',
    statementofcashflows: 'cash_flow_statement',
  };
  for (const s of THREE_STATEMENTS) out[norm(s.key)] = s.key;
  return out;
})();

function statementKey(value) {
  return STATEMENT_ALIASES[norm(value)] || null;
}

// The canonical Sirius template as rows, exported so tests and the sample-data
// fixtures build the same artefact a preparer would upload.
export function statementTemplateRows() {
  const p = {};
  for (const key of FINANCIAL_PERIOD_KEYS) p[key] = null;
  const rowOf = (values) => ({ ...p, ...values });
  return [
    { statement: 'profit_and_loss', label: 'Revenue', values: rowOf({ fy3a: 92, fy2a: 108, fy1a: 128, y1p: 148, y2p: 171, y3p: 197, y4p: 227, y5p: 261 }) },
    { statement: 'profit_and_loss', label: 'EBITDA', values: rowOf({ fy3a: 14, fy2a: 18, fy1a: 23, y1p: 29, y2p: 36, y3p: 44, y4p: 53, y5p: 64 }) },
    { statement: 'profit_and_loss', label: 'Net income', values: rowOf({ fy3a: 6, fy2a: 9, fy1a: 12, y1p: 16, y2p: 21, y3p: 27, y4p: 34, y5p: 42 }) },
    { statement: 'balance_sheet', label: 'Total assets', values: rowOf({ fy3a: 200, fy2a: 215, fy1a: 231, y1p: 252, y2p: 276, y3p: 303, y4p: 334, y5p: 369 }) },
    { statement: 'balance_sheet', label: 'Total liabilities', values: rowOf({ fy3a: 130, fy2a: 138, fy1a: 145, y1p: 156, y2p: 168, y3p: 181, y4p: 195, y5p: 211 }) },
    { statement: 'balance_sheet', label: 'Total equity', values: rowOf({ fy3a: 70, fy2a: 77, fy1a: 86, y1p: 96, y2p: 108, y3p: 122, y4p: 139, y5p: 158 }) },
    { statement: 'cash_flow_statement', label: 'Operating cash flow', values: rowOf({ fy3a: 11, fy2a: 14, fy1a: 18, y1p: 22, y2p: 27, y3p: 33, y4p: 40, y5p: 48 }) },
    { statement: 'cash_flow_statement', label: 'Net cash flow', values: rowOf({ fy3a: 6, fy2a: 8, fy1a: 11, y1p: 13, y2p: 17, y3p: 21, y4p: 26, y5p: 32 }) },
  ];
}

// The canonical template serialised as the CSV a preparer would upload. Shared
// by the sample fixtures and the tests so both build the same artefact.
export function statementTemplateCsv(rows = statementTemplateRows()) {
  const header = ['statement', 'line_item', ...FINANCIAL_PERIODS];
  const body = rows.map((r) => [r.statement, r.label, ...FINANCIAL_PERIOD_KEYS.map((k) => (r.values[k] ?? ''))]);
  return [header, ...body].map((cols) => cols.join(',')).join('\n');
}

function summarise(lines, { format } = {}) {
  const statements = {};
  for (const key of STATEMENT_KEYS) statements[key] = false;
  const byLabel = new Map();
  for (const line of lines) {
    let statement = line.statement;
    if (!statement) {
      // Infer a statement from the line item when the model does not name it.
      const marker = norm(line.label);
      for (const s of THREE_STATEMENTS) {
        if (s.markers.some((m) => norm(m) === marker)) { statement = s.key; break; }
      }
    }
    if (statement && statements[statement] !== undefined) statements[statement] = true;
    if (statement) {
      const key = statement + ':' + norm(line.label);
      byLabel.set(key, line.values || {});
    }
  }
  const missingStatements = STATEMENT_KEYS.filter((k) => !statements[k]);

  // The balance-sheet equality check: assets = liabilities + equity per period.
  const assets = byLabel.get('balance_sheet:' + norm(BALANCE_SHEET_TOTALS.assets)) || null;
  const liabilities = byLabel.get('balance_sheet:' + norm(BALANCE_SHEET_TOTALS.liabilities)) || null;
  const equity = byLabel.get('balance_sheet:' + norm(BALANCE_SHEET_TOTALS.equity)) || null;
  const haveTotals = Boolean(assets && liabilities && equity);
  const imbalances = [];
  const periods = [];
  if (haveTotals) {
    for (const key of FINANCIAL_PERIOD_KEYS) {
      const a = num(assets[key]);
      const l = num(liabilities[key]);
      const e = num(equity[key]);
      if (a === null || l === null || e === null) continue;
      periods.push(key);
      const diff = Math.round((a - (l + e)) * 100) / 100;
      const tol = Math.abs(a) * (BALANCE_TOLERANCE_PCT / 100);
      if (Math.abs(diff) > tol) {
        imbalances.push({ period: key, assets: a, liabilities_equity: Math.round((l + e) * 100) / 100, difference: diff });
      }
    }
  }

  const template = missingStatements.length === 0 && haveTotals;
  const balance = {
    checked: haveTotals,
    balanced: haveTotals && imbalances.length === 0 ? true : (haveTotals ? false : null),
    imbalances,
  };

  const notes = [];
  if (!template) notes.push(MISSING_STATEMENT_MESSAGE);
  if (balance.checked && !balance.balanced) notes.push(UNBALANCED_MESSAGE);
  if (template && balance.balanced) notes.push('Three-statement model present and balanced.');

  return {
    parsed: true,
    format: format || 'unknown',
    template,
    statements,
    missing_statements: missingStatements,
    periods,
    balance,
    line_count: lines.length,
    notes,
  };
}

function parseDelimited(text, delimiter) {
  const grid = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field); field = '';
    } else if (char === '\n') {
      row.push(field); field = ''; grid.push(row); row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  grid.push(row);
  return grid.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function parseGrid(grid) {
  if (grid.length < 1) return [];
  const header = grid[0].map((c) => String(c));
  const periodCols = {}; // column index -> period key
  header.forEach((h, i) => {
    const key = PERIOD_ALIASES[norm(h)];
    if (key) periodCols[i] = key;
  });
  const lines = [];
  let current = null;
  for (let r = 1; r < grid.length; r += 1) {
    const row = grid[r];
    const first = String(row[0] ?? '').trim();
    const second = String(row[1] ?? '').trim();
    if (!first && !second) continue;
    const named = statementKey(first);
    let statement;
    let label;
    if (named) { statement = named; current = named; label = second; }
    else { statement = current; label = first; }
    if (!label) continue;
    const values = {};
    let anyNumber = false;
    for (const idx of Object.keys(periodCols)) {
      const v = num(row[Number(idx)]);
      if (v !== null) { values[periodCols[idx]] = v; anyNumber = true; }
    }
    if (!anyNumber) continue;
    lines.push({ statement, label, values });
  }
  return lines;
}

function parseJson(text) {
  const data = JSON.parse(text);
  const lines = [];
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const statement = statementKey(entry.statement || entry.statement_key || entry.section) || null;
      const label = entry.line_item || entry.lineItem || entry.label || entry.name;
      const raw = entry.values || entry;
      const values = {};
      for (const key of FINANCIAL_PERIOD_KEYS) {
        const v = num(raw[key]);
        if (v !== null) values[key] = v;
      }
      if (label) lines.push({ statement, label: String(label), values });
    }
    return lines;
  }
  if (data && typeof data === 'object') {
    // { profit_and_loss: { revenue: {...periods} }, ... } or a flat { label: {...} }
    for (const [section, body] of Object.entries(data)) {
      const statement = statementKey(section);
      const recordSet = statement
        ? body
        : { [section]: body }; // flat: the key is the line label
      if (!recordSet || typeof recordSet !== 'object') continue;
      for (const [label, raw] of Object.entries(recordSet)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const values = {};
        FINANCIAL_PERIOD_KEYS.forEach((key, i) => {
          const v = num(raw[key]);
          if (v !== null) { values[key] = v; return; }
          if (Array.isArray(raw.values)) {
            const a = num(raw.values[i]);
            if (a !== null) values[key] = a;
          }
        });
        lines.push({ statement, label: String(label), values });
      }
    }
    return lines;
  }
  return [];
}

// Parse an uploaded model. Returns a stable summary the gate, the form and the
// memo can all render. Never throws: an unreadable or unsupported file is
// reported as parsed:false with a reason, so the caller can flag it.
export function parseStatementModel({ buffer, filename = '', mimetype = '' } = {}) {
  const ext = String(filename).slice(String(filename).lastIndexOf('.')).toLowerCase();
  let text;
  try {
    text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '');
  } catch {
    return { parsed: false, format: 'unreadable', template: false, statements: {}, missing_statements: [...STATEMENT_KEYS], periods: [], balance: { checked: false, balanced: null, imbalances: [] }, line_count: 0, notes: [NON_TEMPLATE_MESSAGE] };
  }
  try {
    if (ext === '.json' || norm(mimetype) === 'applicationjson') {
      return summarise(parseJson(text), { format: 'json' });
    }
    if (ext === '.tsv' || ext === '.txt' || norm(mimetype).includes('tabseparated')) {
      return summarise(parseGrid(parseDelimited(text, '\t')), { format: ext === '.txt' && text.includes(',') && !text.includes('\t') ? 'csv' : 'tsv' });
    }
    if (ext === '.csv' || norm(mimetype).includes('csv')) {
      return summarise(parseGrid(parseDelimited(text, ',')), { format: 'csv' });
    }
    // Try CSV as a last resort before declaring the format unsupported.
    if (text.includes(',')) {
      const lines = parseGrid(parseDelimited(text, ','));
      if (lines.length) return summarise(lines, { format: 'csv' });
    }
    return { parsed: false, format: 'unsupported', template: false, statements: {}, missing_statements: [...STATEMENT_KEYS], periods: [], balance: { checked: false, balanced: null, imbalances: [] }, line_count: 0, notes: [NON_TEMPLATE_MESSAGE] };
  } catch {
    return { parsed: false, format: 'unreadable', template: false, statements: {}, missing_statements: [...STATEMENT_KEYS], periods: [], balance: { checked: false, balanced: null, imbalances: [] }, line_count: 0, notes: [NON_TEMPLATE_MESSAGE] };
  }
}

// The canonical, balanced Sirius model as a parsed summary. Used by the sample
// fixtures so the demo shows a checked, balanced three-statement model.
export function siriusTemplateModel() {
  return summarise(statementTemplateRows(), { format: 'csv' });
}

// Evaluate a stored statement_model block for the gate and the form. Flags are
// advisory (FIN-02 accept criterion: "raise a flag"), so this never hard-blocks
// a submission; the mandatory-upload rule is carried by the financials document.
export function evaluateStatementModel(model) {
  // A file we received but could not parse is still 'attached' (and therefore
  // flagged for review); only a wholly absent model is 'not attached'.
  const attached = Boolean(model && (model.parsed || model.format));
  if (!attached) {
    return {
      applies: true,
      attached: false,
      complete: false,
      template: false,
      statements: Object.fromEntries(STATEMENT_KEYS.map((k) => [k, false])),
      missing_statements: [...STATEMENT_KEYS],
      balance: { checked: false, balanced: null, imbalances: [] },
      accepted: false,
      flagged_for_review: false,
      message: NOT_ATTACHED_MESSAGE,
    };
  }
  const balance = model.balance || { checked: false, balanced: null, imbalances: [] };
  const missing = model.missing_statements || [];
  const flagged = !model.template || missing.length > 0 || balance.balanced === false;
  const complete = Boolean(model.template) && missing.length === 0 && balance.balanced !== false;
  let message = 'Three-statement model present and balanced.';
  if (!complete) {
    const notes = [];
    if (!model.parsed) notes.push(NON_TEMPLATE_MESSAGE);
    if (missing.length) notes.push(MISSING_STATEMENT_MESSAGE);
    if (balance.checked && balance.balanced === false) notes.push(UNBALANCED_MESSAGE);
    if (!model.template && !notes.length) notes.push(NON_TEMPLATE_MESSAGE);
    message = notes.join(' ');
  }
  return {
    applies: true,
    attached: true,
    complete,
    format: model.format || null,
    template: Boolean(model.template),
    statements: model.statements || Object.fromEntries(STATEMENT_KEYS.map((k) => [k, false])),
    missing_statements: missing,
    balance,
    accepted: true,
    flagged_for_review: flagged,
    line_count: model.line_count || 0,
    message,
  };
}

export default {
  THREE_STATEMENTS, STATEMENT_KEYS, BALANCE_SHEET_TOTALS, BALANCE_TOLERANCE_PCT,
  STATEMENT_MODEL_REQUIREMENT_KEY, NON_TEMPLATE_MESSAGE, NOT_ATTACHED_MESSAGE,
  UNBALANCED_MESSAGE, MISSING_STATEMENT_MESSAGE, statementTemplateRows,
  statementTemplateCsv, parseStatementModel, siriusTemplateModel,
  evaluateStatementModel,
};
