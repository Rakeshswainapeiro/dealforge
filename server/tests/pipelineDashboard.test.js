// Pure-function tests for the pipeline dashboard filters (W7-02 / BRD DSH-01).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPipelineDashboardConfig,
  resolvePipelineDashboardConfig,
  validatePipelineDashboardConfig,
  buildPipelineDashboardConfig,
  diffPipelineDashboardConfig,
  parseFilters,
  filterCards,
  filterOptions,
  drillDown,
  summarizePipeline,
  activeFilterCount,
  FILTER_PARAMS,
  DRILLDOWN_DIMENSIONS,
} from '../config/pipelineDashboard.js';

const card = (over = {}) => ({
  id: 'opp-' + Math.random().toString(36).slice(2, 8),
  owner_org_id: 'org-infinia-technologies-limited',
  owner_org_name: 'Infinia Technologies Limited',
  opportunity_name: 'Vision Care Imaging Platform',
  sector: 'Healthcare',
  state: 'screening',
  state_label: 'Screening',
  owner_email: 'deal.lead@infinia.local',
  total_commitment_aed: 125,
  updated_date: '2026-09-20T10:00:00.000Z',
  sla_breached: false,
  ...over,
});

describe('pipeline dashboard config (W7-02)', () => {
  test('the shipped default exposes every filter dimension', () => {
    const cfg = defaultPipelineDashboardConfig();
    assert.equal(cfg.revision, 1);
    assert.deepEqual(cfg.dimensions, FILTER_PARAMS);
    assert.equal(cfg.default_drilldown, 'state');
  });

  test('resolve clamps unknown dimensions and a bad default drill-down', () => {
    const cfg = resolvePipelineDashboardConfig({ dimensions: ['entity', 'nope'], default_drilldown: 'nope' });
    assert.deepEqual(cfg.dimensions, ['entity']);
    assert.equal(cfg.default_drilldown, 'state');
  });

  test('validate rejects an empty dimension list', () => {
    assert.equal(validatePipelineDashboardConfig({ dimensions: [] }).ok, false);
    assert.equal(validatePipelineDashboardConfig(defaultPipelineDashboardConfig()).ok, true);
  });

  test('an admin edit mints revision + 1 and reports the change', () => {
    const base = defaultPipelineDashboardConfig();
    const next = buildPipelineDashboardConfig({ default_drilldown: 'entity' }, { actor: { email: 'admin@dealforge.local' }, base });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.default_drilldown, 'entity');
    assert.equal(next.updated_by, 'admin@dealforge.local');
    const changes = diffPipelineDashboardConfig(base, next);
    assert.ok(changes.some((c) => c.field === 'default_drilldown'));
  });
});

describe('pipeline dashboard filters (W7-02)', () => {
  test('parseFilters normalises comma lists and drops "any" dates', () => {
    const f = parseFilters({ entity: 'a,b', state: 'screening', date: 'any' });
    assert.deepEqual(f.entity, ['a', 'b']);
    assert.deepEqual(f.state, ['screening']);
    assert.equal(f.date, null);
  });

  test('filterCards narrows by entity, sector, stage and owner', () => {
    const cards = [
      card({ owner_org_id: 'org-a', sector: 'Healthcare', state: 'screening', owner_email: 'x@a.local' }),
      card({ owner_org_id: 'org-b', sector: 'Energy', state: 'approval', owner_email: 'y@b.local' }),
    ];
    assert.equal(filterCards(cards, { entity: ['org-a'] }).length, 1);
    assert.equal(filterCards(cards, { sector: ['Energy'] }).length, 1);
    assert.equal(filterCards(cards, { state: ['approval'] }).length, 1);
    assert.equal(filterCards(cards, { owner: ['x@a.local'] }).length, 1);
    assert.equal(filterCards(cards, {}).length, 2);
  });

  test('filterCards applies a date preset against updated_date', () => {
    const now = new Date('2026-09-27T00:00:00.000Z');
    const cards = [card({ updated_date: '2026-09-25T00:00:00.000Z' }), card({ updated_date: '2026-08-20T00:00:00.000Z' })];
    assert.equal(filterCards(cards, { date: '7d' }, { now }).length, 1);
    assert.equal(filterCards(cards, { date: '90d' }, { now }).length, 2);
  });

  test('filterCards narrows by derived cluster', () => {
    const cards = [card({ sector: 'Healthcare' }), card({ sector: 'Energy' })];
    assert.equal(filterCards(cards, { cluster: ['healthcare_life_sciences'] }).length, 1);
    assert.equal(filterCards(cards, { cluster: ['energy_utilities'] }).length, 1);
  });

  test('filterOptions surfaces only the values present in the cards', () => {
    const cards = [
      card({ owner_org_id: 'org-a', sector: 'Healthcare', state: 'screening' }),
      card({ owner_org_id: 'org-b', sector: 'Energy', state: 'approval' }),
    ];
    const opts = filterOptions(cards, { subsidiaryNames: { 'org-a': 'Alpha Ltd', 'org-b': 'Beta Ltd' } });
    assert.equal(opts.entity.length, 2);
    assert.ok(opts.entity.some((e) => e.label === 'Alpha Ltd'));
    assert.equal(opts.sector.length, 2);
    assert.equal(opts.state.length, 2);
  });

  test('drillDown groups the filtered cards by a dimension', () => {
    const cards = [card({ state: 'screening' }), card({ state: 'screening' }), card({ state: 'approval' })];
    const dd = drillDown(cards, 'state');
    assert.equal(dd.dimension, 'state');
    const screening = dd.groups.find((g) => g.key === 'screening');
    assert.equal(screening.count, 2);
    assert.equal(dd.groups[0].count, 2, 'the largest group sorts first');
    assert.ok(DRILLDOWN_DIMENSIONS.includes('cluster'));
  });

  test('summarizePipeline counts totals, stages and breaches', () => {
    const cards = [card({ state: 'screening', sla_breached: true }), card({ state: 'approval' })];
    const s = summarizePipeline(cards);
    assert.equal(s.total, 2);
    assert.equal(s.breaches, 1);
    assert.equal(s.by_state.screening, 1);
  });

  test('activeFilterCount counts only set dimensions', () => {
    assert.equal(activeFilterCount({ entity: ['a'], state: [], date: null }), 1);
    assert.equal(activeFilterCount({ entity: ['a'], date: '7d' }), 2);
  });
});
