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
      a: { current: 'proceed_to_gate2', reached: ['submitted', 'screening_review', 'proceed_to_gate2'] },
      b: { current: 'screening_review', reached: ['submitted', 'screening_review'] },
      c: { current: 'declined', reached: ['submitted', 'screening_review', 'declined'] },
    };
    const out = funnelCounts(opps, { stageByOpportunity });
    assert.equal(out.entered, 3);
    assert.equal(out.stages.find((s) => s.key === 'submitted').count, 3);
    assert.equal(out.stages.find((s) => s.key === 'screening_review').count, 3);
    assert.equal(out.stages.find((s) => s.key === 'proceed_to_gate2').count, 1);
    assert.equal(out.branches.declined, 1);
  });

  test('funnelCounts computes conversion percentages', () => {
    const opps = [{ id: 'a' }, { id: 'b' }];
    const stageByOpportunity = {
      a: { current: 'proceed_to_gate2', reached: ['submitted', 'screening_review', 'proceed_to_gate2'] },
      b: { current: 'screening_review', reached: ['submitted', 'screening_review'] },
    };
    const out = funnelCounts(opps, { stageByOpportunity });
    const proceed = out.stages.find((s) => s.key === 'proceed_to_gate2');
    assert.equal(proceed.from_first, 50);
    assert.equal(proceed.from_previous, 50);
    assert.equal(out.stages[0].from_previous, null);
    assert.deepEqual(FUNNEL_STAGE_KEYS, ['submitted', 'screening_review', 'proceed_to_gate2']);
  });

  test('reasonBreakdown groups the leaving transitions by reason code', () => {
    const transitions = [
      { to_state: 'declined', reason_code: 'R-01', reason_text: 'Out of mandate' },
      { to_state: 'declined', reason_code: 'R-01', reason_text: 'Out of mandate' },
      { to_state: 'declined', reason_code: 'R-02', reason_text: 'Valuation' },
      { to_state: 'on_hold', reason_code: 'R-03', reason_text: 'Timing' },
      { to_state: 'screening_review' },
    ];
    const out = reasonBreakdown(transitions);
    assert.equal(out.declined.total, 3);
    assert.equal(out.declined.reasons[0].code, 'R-01');
    assert.equal(out.declined.reasons[0].count, 2);
    assert.equal(out.on_hold.total, 1);
    assert.equal(out.withdrawn.total, 0);
  });

  test('cycleTime averages elapsed days and compares to the SLA', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const stageByOpportunity = {
      a: { stageTimes: { submitted: t0, screening_review: t0 + 4 * DAY, proceed_to_gate2: t0 + 10 * DAY } },
      b: { stageTimes: { submitted: t0, screening_review: t0 + 6 * DAY, proceed_to_gate2: t0 + 16 * DAY } },
    };
    const out = cycleTime(stageByOpportunity, { slaTargets: { submitted: { days: 5 }, screening_review: { days: 5 } } });
    const submitted = out.stages.find((s) => s.key === 'submitted');
    assert.equal(submitted.samples, 2);
    assert.equal(submitted.avg_days, 5);
    assert.equal(submitted.sla_days, 5);
    assert.equal(submitted.within_sla, true);
    const review = out.stages.find((s) => s.key === 'screening_review');
    assert.equal(review.samples, 2);
    assert.equal(review.avg_days, 8);
    assert.equal(review.within_sla, false);
    assert.equal(review.avg_vs_sla, 3);
  });

  test('cycleTime measures an open stage up to now', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const now = new Date(Date.UTC(2026, 0, 11));
    const stageByOpportunity = { a: { stageTimes: { screening_review: t0 } } };
    const out = cycleTime(stageByOpportunity, { now });
    const review = out.stages.find((s) => s.key === 'screening_review');
    assert.equal(review.samples, 1);
    assert.equal(review.avg_days, 10);
  });

  test('buildMetrics assembles the pack and counts cycle breaches', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const opps = [{ id: 'a' }, { id: 'b' }];
    const stageByOpportunity = {
      a: { current: 'proceed_to_gate2', reached: ['submitted', 'screening_review', 'proceed_to_gate2'], stageTimes: { submitted: t0, screening_review: t0, proceed_to_gate2: t0 + 2 * DAY } },
      b: { current: 'declined', reached: ['submitted', 'screening_review', 'declined'], stageTimes: { submitted: t0, screening_review: t0, declined: t0 + 9 * DAY } },
    };
    const transitions = [{ to_state: 'declined', reason_code: 'R-01' }];
    const out = buildMetrics(opps, transitions, { stageByOpportunity, slaTargets: { screening_review: { days: 3 } } });
    assert.equal(out.total, 2);
    assert.equal(out.entered, 2);
    assert.equal(out.funnel.find((s) => s.key === 'proceed_to_gate2').count, 1);
    assert.equal(out.reasons.declined.total, 1);
    assert.ok(out.cycle_breaches >= 1, 'the 9-day screening review breaches the 3-day SLA');
  });
});
