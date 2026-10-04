// Pure-function tests for the funnel & cycle-time metrics (W7-03 / BRD DSH-04).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPipelineMetricsConfig,
  resolvePipelineMetricsConfig,
  validatePipelineMetricsConfig,
  buildPipelineMetricsConfig,
  diffPipelineMetricsConfig,
  parseRange,
  rangeStart,
  funnelCounts,
  reasonBreakdown,
  cycleTime,
  buildMetrics,
  FUNNEL_STAGE_KEYS,
  METRIC_RANGES,
} from '../config/pipelineMetrics.js';

const DAY = 86_400_000;

describe('pipeline metrics config (W7-03)', () => {
  test('the shipped default carries the any-time range and cycle-time on', () => {
    const cfg = defaultPipelineMetricsConfig();
    assert.equal(cfg.revision, 1);
    assert.equal(cfg.range, 'any');
    assert.equal(cfg.show_cycle_time, true);
  });

  test('resolve clamps an unknown range', () => {
    assert.equal(resolvePipelineMetricsConfig({ range: 'nope' }).range, 'any');
    assert.equal(resolvePipelineMetricsConfig({ range: '90d' }).range, '90d');
  });

  test('validate rejects an unknown range', () => {
    assert.equal(validatePipelineMetricsConfig({ range: 'nope' }).ok, false);
    assert.equal(validatePipelineMetricsConfig(defaultPipelineMetricsConfig()).ok, true);
  });

  test('an admin edit mints revision + 1 and reports the change', () => {
    const base = defaultPipelineMetricsConfig();
    const next = buildPipelineMetricsConfig({ range: '90d' }, { actor: { email: 'admin@dealforge.local' }, base });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.range, '90d');
    const changes = diffPipelineMetricsConfig(base, next);
    assert.ok(changes.some((c) => c.field === 'range'));
  });

  test('parseRange and rangeStart honour the presets', () => {
    const now = new Date('2026-09-27T00:00:00.000Z');
    assert.equal(parseRange({ range: '30d' }), '30d');
    assert.equal(parseRange({ range: 'nope' }), 'any');
    assert.equal(rangeStart('any'), null);
    assert.equal(rangeStart('30d', { now }), now.getTime() - 30 * DAY);
    assert.equal(METRIC_RANGES.length, 4);
  });
});

describe('pipeline metrics logic (W7-03)', () => {
  test('funnelCounts counts each opportunity at every stage it reached', () => {
    const opps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const stageByOpportunity = {
      a: { current: 'approval', reached: ['submission', 'screening', 'refinement', 'approval'] },
      b: { current: 'screening', reached: ['submission', 'screening'] },
      c: { current: 'declined', reached: ['submission', 'screening', 'declined'] },
    };
    const out = funnelCounts(opps, { stageByOpportunity });
    assert.equal(out.entered, 3);
    assert.equal(out.stages.find((s) => s.key === 'submission').count, 3);
    assert.equal(out.stages.find((s) => s.key === 'screening').count, 3);
    assert.equal(out.stages.find((s) => s.key === 'approval').count, 1);
    assert.equal(out.branches.declined, 1);
  });

  test('funnelCounts computes conversion percentages', () => {
    const opps = [{ id: 'a' }, { id: 'b' }];
    const stageByOpportunity = {
      a: { current: 'approval', reached: ['submission', 'screening', 'refinement', 'approval'] },
      b: { current: 'screening', reached: ['submission', 'screening'] },
    };
    const out = funnelCounts(opps, { stageByOpportunity });
    const approval = out.stages.find((s) => s.key === 'approval');
    assert.equal(approval.from_first, 50);
    assert.equal(approval.from_previous, 100);
    assert.equal(out.stages[0].from_previous, null);
    assert.deepEqual(FUNNEL_STAGE_KEYS, ['submission', 'screening', 'refinement', 'approval']);
  });

  test('reasonBreakdown groups the leaving transitions by reason code', () => {
    const transitions = [
      { to_state: 'declined', reason_code: 'R-01', reason_text: 'Out of mandate' },
      { to_state: 'declined', reason_code: 'R-01', reason_text: 'Out of mandate' },
      { to_state: 'declined', reason_code: 'R-02', reason_text: 'Valuation' },
      { to_state: 'returned', reason_code: 'R-03', reason_text: 'Incomplete' },
      { to_state: 'screening' },
    ];
    const out = reasonBreakdown(transitions);
    assert.equal(out.declined.total, 3);
    assert.equal(out.declined.reasons[0].code, 'R-01');
    assert.equal(out.declined.reasons[0].count, 2);
    assert.equal(out.returned.total, 1);
    assert.equal(out.withdrawn.total, 0);
  });

  test('cycleTime averages elapsed days and compares to the SLA', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const stageByOpportunity = {
      a: { stageTimes: { submission: t0, screening: t0 + 4 * DAY, refinement: t0 + 10 * DAY, approval: t0 + 12 * DAY } },
      b: { stageTimes: { submission: t0, screening: t0 + 6 * DAY, refinement: t0 + 16 * DAY } },
    };
    const out = cycleTime(stageByOpportunity, { slaTargets: { submission: { days: 5 }, screening: { days: 5 } } });
    const submission = out.stages.find((s) => s.key === 'submission');
    assert.equal(submission.samples, 2);
    assert.equal(submission.avg_days, 5);
    assert.equal(submission.sla_days, 5);
    assert.equal(submission.within_sla, true);
    const screening = out.stages.find((s) => s.key === 'screening');
    assert.equal(screening.samples, 2);
    assert.equal(screening.avg_days, 8);
    assert.equal(screening.within_sla, false);
    assert.equal(screening.avg_vs_sla, 3);
  });

  test('cycleTime measures an open stage up to now', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const now = new Date(Date.UTC(2026, 0, 11));
    const stageByOpportunity = { a: { stageTimes: { submission: t0 } } };
    const out = cycleTime(stageByOpportunity, { now });
    const submission = out.stages.find((s) => s.key === 'submission');
    assert.equal(submission.samples, 1);
    assert.equal(submission.avg_days, 10);
  });

  test('buildMetrics assembles the pack and counts cycle breaches', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const opps = [{ id: 'a' }, { id: 'b' }];
    const stageByOpportunity = {
      a: { current: 'approval', reached: ['submission', 'screening', 'refinement', 'approval'], stageTimes: { submission: t0, screening: t0 + 2 * DAY, refinement: t0 + 5 * DAY, approval: t0 + 7 * DAY } },
      b: { current: 'declined', reached: ['submission', 'screening', 'declined'], stageTimes: { submission: t0, screening: t0 + 9 * DAY } },
    };
    const transitions = [{ to_state: 'declined', reason_code: 'R-01' }];
    const out = buildMetrics(opps, transitions, { stageByOpportunity, slaTargets: { submission: { days: 5 }, screening: { days: 5 } } });
    assert.equal(out.total, 2);
    assert.equal(out.entered, 2);
    assert.equal(out.funnel.find((s) => s.key === 'approval').count, 1);
    assert.equal(out.reasons.declined.total, 1);
    assert.ok(out.cycle_breaches >= 1, 'the 9-day screening breaches the 5-day SLA');
  });
});
