// Pure-function tests for the IHC weekly report (W7-01 / BRD DSH-03).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultReportingConfig,
  resolveReportingConfig,
  validateReportingConfig,
  buildReportingConfig,
  diffReportingConfig,
  buildWeeklyRows,
  columnValue,
  summarizeWeekly,
  toCsv,
  scheduleKey,
  WEEKLY_COLUMN_KEYS,
} from '../config/reporting.js';

const card = (over = {}) => ({
  id: 'opp-12345678-abcd',
  owner_org_id: 'org-infinia-technologies-limited',
  state: 'screening',
  state_label: 'Screening',
  opportunity_name: 'Vision Care Imaging Platform',
  opportunity_type: 'Acquisition',
  sector: 'Healthcare',
  geography: 'UAE',
  total_commitment_aed: 125,
  owner_email: 'deal.lead@infinia.local',
  age_days: 12,
  sla_days: 5,
  sla_breached: true,
  updated_date: '2026-09-20T10:00:00.000Z',
  ...over,
});

describe('reporting config (W7-01)', () => {
  test('the shipped default carries the Friday tracker columns in order', () => {
    const cfg = defaultReportingConfig();
    assert.equal(cfg.revision, 1);
    assert.deepEqual(cfg.columns, WEEKLY_COLUMN_KEYS);
    assert.equal(cfg.schedule.weekday, 5);
    assert.equal(cfg.states.includes('submission'), true);
  });

  test('resolve clamps unknown columns and bad schedule values', () => {
    const cfg = resolveReportingConfig({
      columns: ['ref', 'nope', 'opportunity_name'],
      schedule: { weekday: 9, hour: 40 },
    });
    assert.deepEqual(cfg.columns, ['ref', 'opportunity_name']);
    assert.equal(cfg.schedule.weekday, 5, 'out-of-range weekday falls back to default');
    assert.equal(cfg.schedule.hour, 9);
  });

  test('validate rejects an empty column list', () => {
    assert.equal(validateReportingConfig({ columns: [] }).ok, false);
    assert.equal(validateReportingConfig(defaultReportingConfig()).ok, true);
  });

  test('an admin edit mints revision + 1 and reports the change', () => {
    const base = defaultReportingConfig();
    const next = buildReportingConfig({ columns: ['ref', 'subsidiary'] }, { actor: { email: 'admin@dealforge.local' }, base });
    assert.equal(next.revision, 2);
    assert.equal(next.source, 'admin');
    const changes = diffReportingConfig(base, next);
    assert.equal(changes.some((c) => c.field === 'columns'), true);
  });
});

describe('weekly rows (W7-01) - build from pipeline cards', () => {
  test('money is rendered in AED millions', () => {
    assert.equal(columnValue('total_commitment_mn', card()), 125);
  });

  test('a subsidiary name is resolved from the org map', () => {
    const { rows } = buildWeeklyRows([card()], {
      config: defaultReportingConfig(),
      subsidiaryNames: { 'org-infinia-technologies-limited': 'Infinia Technologies Limited' },
    });
    assert.equal(rows[0].values.subsidiary, 'Infinia Technologies Limited');
    assert.equal(rows[0].values.state_label, 'Screening');
    assert.equal(rows[0].values.sla_breached, 'Yes');
    assert.equal(rows[0].values.ref, 'OPP-1234');
  });

  test('a declined card surfaces its decision reason', () => {
    assert.equal(columnValue('decision', card({ state: 'declined', declined_reason: 'Outside mandate' })), 'Outside mandate');
    assert.equal(columnValue('decision', card({ state: 'screening' })), '');
  });

  test('the summary counts stages, breaches and commitment', () => {
    const { rows } = buildWeeklyRows(
      [card(), card({ id: 'opp-2', state: 'approval', state_label: 'Approval', sla_breached: false, total_commitment_aed: 75 })],
      { config: defaultReportingConfig() }
    );
    const s = summarizeWeekly(rows);
    assert.equal(s.total, 2);
    assert.equal(s.breaches, 1);
    assert.equal(s.by_state.Screening, 1);
    assert.equal(s.commitment_aed_mn, 200);
  });

  test('CSV renders a header and escapes commas', () => {
    const { columns, rows } = buildWeeklyRows([card({ opportunity_name: 'Alpha, Beta' })], { config: defaultReportingConfig() });
    const csv = toCsv({ columns: columns.slice(0, 3), rows });
    const [head] = csv.split('\n');
    assert.equal(head, 'Ref,Subsidiary,Opportunity');
    assert.ok(csv.includes('"Alpha, Beta"'));
  });

  test('the schedule key identifies the ISO week of the run', () => {
    const key = scheduleKey(defaultReportingConfig().schedule, new Date('2026-09-25T09:00:00Z'));
    assert.equal(key, '2026-09-21');
  });
});
