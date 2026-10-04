// ---------------------------------------------------------------------------
// Unit tests for the three-statement model check (W2-02 / FIN-02).
// Pure functions only — no server, no database.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  THREE_STATEMENTS, STATEMENT_KEYS, STATEMENT_MODEL_REQUIREMENT_KEY,
  statementTemplateRows, parseStatementModel, siriusTemplateModel, evaluateStatementModel,
  NOT_ATTACHED_MESSAGE, UNBALANCED_MESSAGE, NON_TEMPLATE_MESSAGE,
} from '../config/statementModel.js';

function csvFromRows(rows) {
  const periods = ['FY-3 A', 'FY-2 A', 'FY-1 A', 'Y1 P', 'Y2 P', 'Y3 P', 'Y4 P', 'Y5 P'];
  const keys = ['fy3a', 'fy2a', 'fy1a', 'y1p', 'y2p', 'y3p', 'y4p', 'y5p'];
  const header = ['statement', 'line_item', ...periods].join(',');
  const body = rows.map((r) => [r.statement, r.label, ...keys.map((k) => (r.values[k] ?? ''))].join(',')).join('\n');
  return header + '\n' + body;
}

describe('three-statement config', () => {
  test('declares exactly three statements', () => {
    assert.equal(THREE_STATEMENTS.length, 3);
    assert.deepEqual(STATEMENT_KEYS, ['profit_and_loss', 'balance_sheet', 'cash_flow_statement']);
  });

  test('rides on the mandatory financials document', () => {
    assert.equal(STATEMENT_MODEL_REQUIREMENT_KEY, 'financials');
  });
});

describe('parseStatementModel', () => {
  test('parses the canonical Sirius CSV template as balanced and on-template', () => {
    const csv = csvFromRows(statementTemplateRows());
    const parsed = parseStatementModel({ buffer: Buffer.from(csv), filename: 'model.csv', mimetype: 'text/csv' });
    assert.equal(parsed.parsed, true);
    assert.equal(parsed.format, 'csv');
    assert.equal(parsed.template, true);
    assert.deepEqual(parsed.missing_statements, []);
    assert.equal(parsed.balance.checked, true);
    assert.equal(parsed.balance.balanced, true);
    assert.equal(parsed.balance.imbalances.length, 0);
    assert.equal(parsed.periods.length, 8);
  });

  test('flags a balance sheet that does not balance', () => {
    const rows = statementTemplateRows().map((r) => {
      if (r.label === 'Total assets') return { ...r, values: { ...r.values, y1p: 999 } };
      return r;
    });
    const parsed = parseStatementModel({ buffer: Buffer.from(csvFromRows(rows)), filename: 'model.csv' });
    assert.equal(parsed.template, true);
    assert.equal(parsed.balance.checked, true);
    assert.equal(parsed.balance.balanced, false);
    assert.ok(parsed.balance.imbalances.some((i) => i.period === 'y1p'));
  });

  test('ignores a difference within the tolerance band', () => {
    const rows = statementTemplateRows().map((r) => {
      if (r.label === 'Total assets') return { ...r, values: { ...r.values, y1p: r.values.y1p + 0.5 } };
      return r;
    });
    const parsed = parseStatementModel({ buffer: Buffer.from(csvFromRows(rows)), filename: 'model.csv' });
    assert.equal(parsed.balance.balanced, true, 'a sub-tolerance rounding difference still balances');
  });

  test('reports a missing statement when the cash flow is absent', () => {
    const rows = statementTemplateRows().filter((r) => r.statement !== 'cash_flow_statement');
    const parsed = parseStatementModel({ buffer: Buffer.from(csvFromRows(rows)), filename: 'model.csv' });
    assert.equal(parsed.template, false);
    assert.deepEqual(parsed.missing_statements, ['cash_flow_statement']);
  });

  test('parses the equivalent JSON form', () => {
    const rows = statementTemplateRows();
    const payload = {};
    for (const r of rows) {
      payload[r.statement] = payload[r.statement] || {};
      payload[r.statement][r.label] = r.values;
    }
    const parsed = parseStatementModel({ buffer: Buffer.from(JSON.stringify(payload)), filename: 'model.json', mimetype: 'application/json' });
    assert.equal(parsed.format, 'json');
    assert.equal(parsed.template, true);
    assert.equal(parsed.balance.balanced, true);
  });

  test('accepts TSV', () => {
    const rows = statementTemplateRows();
    const periods = ['FY-3 A', 'FY-2 A', 'FY-1 A', 'Y1 P', 'Y2 P', 'Y3 P', 'Y4 P', 'Y5 P'];
    const keys = ['fy3a', 'fy2a', 'fy1a', 'y1p', 'y2p', 'y3p', 'y4p', 'y5p'];
    const tsv = [['statement', 'line_item', ...periods].join('\t')]
      .concat(rows.map((r) => [r.statement, r.label, ...keys.map((k) => (r.values[k] ?? ''))].join('\t')))
      .join('\n');
    const parsed = parseStatementModel({ buffer: Buffer.from(tsv), filename: 'model.tsv' });
    assert.equal(parsed.format, 'tsv');
    assert.equal(parsed.template, true);
  });

  test('a non-template (unreadable) file does not throw and is not on-template', () => {
    const parsed = parseStatementModel({ buffer: Buffer.from('%PDF-1.4 binary'), filename: 'model.pdf', mimetype: 'application/pdf' });
    assert.equal(parsed.parsed, false);
    assert.equal(parsed.template, false);
    assert.equal(parsed.balance.checked, false);
  });
});

describe('evaluateStatementModel', () => {
  test('an unattached model is not attached and names the message', () => {
    const res = evaluateStatementModel(null);
    assert.equal(res.attached, false);
    assert.equal(res.accepted, false);
    assert.equal(res.message, NOT_ATTACHED_MESSAGE);
  });

  test('the template model is complete, accepted and not flagged', () => {
    const res = evaluateStatementModel(siriusTemplateModel());
    assert.equal(res.attached, true);
    assert.equal(res.complete, true);
    assert.equal(res.accepted, true);
    assert.equal(res.flagged_for_review, false);
  });

  test('an unbalanced model is accepted but flagged for review', () => {
    const rows = statementTemplateRows().map((r) => (r.label === 'Total assets' ? { ...r, values: { ...r.values, y1p: 999 } } : r));
    const parsed = parseStatementModel({ buffer: Buffer.from(csvFromRows(rows)), filename: 'model.csv' });
    const res = evaluateStatementModel(parsed);
    assert.equal(res.accepted, true, 'never hard-blocks');
    assert.equal(res.flagged_for_review, true);
    assert.equal(res.complete, false);
    assert.ok(res.message.includes(UNBALANCED_MESSAGE));
  });

  test('a non-template model is accepted but flagged for manual review', () => {
    const parsed = parseStatementModel({ buffer: Buffer.from('%PDF binary'), filename: 'model.pdf' });
    const res = evaluateStatementModel(parsed);
    assert.equal(res.accepted, true);
    assert.equal(res.flagged_for_review, true);
    assert.equal(res.complete, false);
    assert.ok(res.message.includes(NON_TEMPLATE_MESSAGE));
  });
});
