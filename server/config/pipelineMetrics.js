// ---------------------------------------------------------------------------
// Funnel & cycle-time metrics - pure logic (W7-03 / BRD DSH-04).
//
// No database, no network. Owns the funnel conversion counts, the decline
// reason breakdown, the cycle-time per stage measured against its SLA, and the
// versioned configuration. The route supplies the opportunity rows and the
// ordered transition rows; this module decides what the graphs show.
// ---------------------------------------------------------------------------

import {
  PIPELINE_METRICS_KEY, PIPELINE_METRICS_VERSION, PIPELINE_METRICS_VERSION_PREFIX,
  PIPELINE_METRICS_DEFAULT_REVISION, FUNNEL_STAGES, FUNNEL_STAGE_KEYS, BRANCH_STATES,
  BRANCH_STATE_KEYS, METRIC_RANGES, PIPELINE_METRICS_MESSAGES,
} from './pipelineMetricsData.js';

export {
  PIPELINE_METRICS_KEY, PIPELINE_METRICS_VERSION, PIPELINE_METRICS_VERSION_PREFIX,
  PIPELINE_METRICS_DEFAULT_REVISION, FUNNEL_STAGES, FUNNEL_STAGE_KEYS, BRANCH_STATES,
  BRANCH_STATE_KEYS, METRIC_RANGES, PIPELINE_METRICS_MESSAGES,
};

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function defaultPipelineMetricsConfig() {
  return {
    version: PIPELINE_METRICS_VERSION,
    revision: PIPELINE_METRICS_DEFAULT_REVISION,
    source: 'default',
    range: 'any',
    show_cycle_time: true,
    updated_by: null,
    updated_at: null,
  };
}

export function resolvePipelineMetricsConfig(raw, { base = defaultPipelineMetricsConfig() } = {}) {
  const cfg = coerce(raw);
  if (!isPlainObject(cfg)) return base;
  const range = METRIC_RANGES.some((r) => r.key === cfg.range) ? cfg.range : base.range;
  return {
    version: base.version,
    revision: Number.isInteger(cfg.revision) ? cfg.revision : base.revision,
    source: cfg.source || base.source,
    range,
    show_cycle_time: cfg.show_cycle_time == null ? base.show_cycle_time : Boolean(cfg.show_cycle_time),
    updated_by: cfg.updated_by || base.updated_by,
    updated_at: cfg.updated_at || base.updated_at,
  };
}

export function validatePipelineMetricsConfig(config) {
  const cfg = coerce(config);
  const errors = [];
  if (!isPlainObject(cfg)) return { ok: false, errors: ['configuration must be an object'] };
  if (cfg.range != null && !METRIC_RANGES.some((r) => r.key === cfg.range)) errors.push('unknown range: ' + cfg.range);
  return { ok: errors.length === 0, errors };
}

export function diffPipelineMetricsConfig(before, after) {
  const changes = [];
  const b = resolvePipelineMetricsConfig(before);
  const a = resolvePipelineMetricsConfig(after);
  if (b.range !== a.range) changes.push({ field: 'range', before: b.range, after: a.range });
  if (b.show_cycle_time !== a.show_cycle_time) changes.push({ field: 'show_cycle_time', before: b.show_cycle_time, after: a.show_cycle_time });
  return changes;
}

export function buildPipelineMetricsConfig(patch, { actor, base } = {}) {
  const current = resolvePipelineMetricsConfig(base);
  const merged = resolvePipelineMetricsConfig({ ...current, ...patch }, { base: current });
  return {
    ...merged,
    revision: (current.revision || 0) + 1,
    source: 'admin',
    updated_by: actor?.email || null,
    updated_at: new Date().toISOString(),
  };
}

// Normalise the range query against the presets.
export function parseRange(query = {}, { config } = {}) {
  const raw = query.range || config?.range || 'any';
  const found = METRIC_RANGES.find((r) => r.key === raw);
  return found ? found.key : 'any';
}

// The window lower bound (ms) for a range key, or null for "any".
export function rangeStart(key, { now = new Date() } = {}) {
  const found = METRIC_RANGES.find((r) => r.key === key);
  if (!found || found.days == null) return null;
  return now.getTime() - found.days * 86_400_000;
}

// Funnel conversion: how many opportunities reached each forward stage, plus
// the branch counts. An opportunity reaches a stage if it is currently there
// (and the current state is at or beyond it) or if a transition landed there.
export function funnelCounts(opportunities, { stageByOpportunity = {}, funnel = FUNNEL_STAGE_KEYS } = {}) {
  const reached = {};
  for (const s of funnel) reached[s] = 0;
  const branches = {};
  for (const s of BRANCH_STATE_KEYS) branches[s] = 0;
  for (const opp of opportunities || []) {
    const index = stageByOpportunity[opp.id];
    if (index == null) continue;
    let forward = 0;
    if (funnel.includes(index.current)) forward = funnel.indexOf(index.current) + 1;
    if (Array.isArray(index.reached)) {
      for (const s of index.reached) if (funnel.includes(s)) forward = Math.max(forward, funnel.indexOf(s) + 1);
    }
    for (let i = 0; i < forward; i += 1) reached[funnel[i]] += 1;
    if (BRANCH_STATE_KEYS.includes(index.current)) branches[index.current] += 1;
  }
  const stages = funnel.map((key) => ({ key, count: reached[key] }));
  const conversion = stages.map((s, i) => ({
    key: s.key,
    count: s.count,
    from_previous: i === 0 ? null : (stages[i - 1].count ? Math.round((s.count / stages[i - 1].count) * 1000) / 10 : null),
    from_first: stages[0].count ? Math.round((s.count / stages[0].count) * 1000) / 10 : null,
  }));
  return { stages: conversion, branches, entered: stages[0] ? stages[0].count : 0 };
}

// The decline (and return / withdrawal) reason breakdown.
export function reasonBreakdown(transitions, { kinds = BRANCH_STATE_KEYS } = {}) {
  const byKind = {};
  for (const k of kinds) byKind[k] = { total: 0, reasons: [] };
  const counters = {};
  for (const t of transitions || []) {
    if (!kinds.includes(t.to_state)) continue;
    byKind[t.to_state].total += 1;
    const code = t.reason_code || 'unspecified';
    const key = t.to_state + '::' + code;
    if (!counters[key]) { counters[key] = { state: t.to_state, code, text: t.reason_text || null, count: 0 }; byKind[t.to_state].reasons.push(counters[key]); }
    counters[key].count += 1;
  }
  for (const k of kinds) byKind[k].reasons.sort((a, b) => b.count - a.count);
  return byKind;
}

// Cycle time per stage: average/median/max elapsed days between one forward
// stage and the next stage (or now for items still in that stage), measured
// against the stage SLA target.
export function cycleTime(stageByOpportunity, { slaTargets = {}, funnel = FUNNEL_STAGE_KEYS, now = new Date() } = {}) {
  const samples = {};
  for (const s of funnel) samples[s] = [];
  for (const opp of Object.values(stageByOpportunity || {})) {
    const times = opp.stageTimes || {};
    for (let i = 0; i < funnel.length; i += 1) {
      const start = times[funnel[i]];
      if (start == null) continue;
      const nextKey = funnel[i + 1];
      // The next stage's entry closes the sample; an item still in the stage is
      // measured up to now so open work is not dropped from the average.
      const end = nextKey != null && times[nextKey] != null ? times[nextKey] : now.getTime();
      samples[funnel[i]].push((end - start) / 86_400_000);
    }
  }
  const stages = funnel.map((key) => {
    const arr = samples[key].slice().sort((a, b) => a - b);
    const days = arr.length ? arr : null;
    const avg = days ? days.reduce((s, d) => s + d, 0) / days.length : null;
    const median = days ? days[Math.floor(days.length / 2)] : null;
    const max = days ? days[days.length - 1] : null;
    const sla = slaTargets[key]?.days ?? slaTargets[key] ?? null;
    return {
      key,
      samples: days ? days.length : 0,
      avg_days: avg == null ? null : Math.round(avg * 10) / 10,
      median_days: median == null ? null : Math.round(median * 10) / 10,
      max_days: max == null ? null : Math.round(max * 10) / 10,
      sla_days: sla == null ? null : Number(sla),
      avg_vs_sla: sla != null && avg != null ? Math.round((avg - Number(sla)) * 10) / 10 : null,
      within_sla: sla == null || avg == null ? null : avg <= Number(sla),
    };
  });
  return { stages };
}

// The whole metrics pack for a set of opportunities and their transitions.
export function buildMetrics(opportunities, transitions, { stageByOpportunity = {}, slaTargets = {}, funnel = FUNNEL_STAGE_KEYS, now = new Date() } = {}) {
  const counts = funnelCounts(opportunities, { stageByOpportunity, funnel });
  const reasons = reasonBreakdown(transitions);
  const cycle = cycleTime(stageByOpportunity, { slaTargets, funnel, now });
  const breaches = cycle.stages.filter((s) => s.within_sla === false).length;
  return {
    funnel: counts.stages,
    entered: counts.entered,
    branches: counts.branches,
    reasons,
    cycle: cycle.stages,
    cycle_breaches: breaches,
    total: (opportunities || []).length,
  };
}
