// ---------------------------------------------------------------------------
// Performance SIT targets (W9-04 / BRD NFR-04).
//
// The NFR is: a P95 page interaction under 3 seconds, and a screening run under
// 15 minutes. This module holds the targets and the pure percentile / verdict
// helpers so the harness and the unit tests share one definition of "pass".
// scripts/performance_sit.mjs drives real requests against a running server and
// feeds the samples through summariseEndpoints.
// ---------------------------------------------------------------------------

export const PERFORMANCE_VERSION = 'NFR-04.1';

export const PERFORMANCE_TARGETS = {
  // On-screen interaction budget (P95 of the sampled requests).
  p95_page_ms: 3000,
  // End-to-end screening budget (documented process SLA).
  screening_ms: 15 * 60 * 1000,
  // A request slower than this is recorded as a failure regardless of the P95.
  hard_ceiling_ms: 10000,
  // Minimum samples per endpoint before a P95 is meaningful.
  min_samples: 5,
};

// Nearest-rank percentile. samples need not be sorted.
export function percentile(samples, p) {
  if (!samples || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx];
}

export function mean(samples) {
  if (!samples || samples.length === 0) return null;
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}

// Summarise a { label: [ms, ...] } map into per-endpoint stats plus a verdict.
export function summariseEndpoints(samplesByEndpoint, targets = PERFORMANCE_TARGETS) {
  const endpoints = {};
  let allPass = true;
  for (const [label, samples] of Object.entries(samplesByEndpoint)) {
    const ok = samples.filter((s) => s >= 0);
    const p95 = percentile(ok, 95);
    const enough = ok.length >= targets.min_samples;
    const withinP95 = p95 !== null && p95 <= targets.p95_page_ms;
    const noCeilingBreach = ok.every((s) => s <= targets.hard_ceiling_ms);
    const pass = enough && withinP95 && noCeilingBreach;
    if (!pass) allPass = false;
    endpoints[label] = {
      count: ok.length,
      mean_ms: mean(ok),
      p50_ms: percentile(ok, 50),
      p95_ms: p95,
      max_ms: ok.length ? Math.max(...ok) : null,
      min_samples_met: enough,
      within_p95_target: withinP95,
      within_hard_ceiling: noCeilingBreach,
      pass,
    };
  }
  return {
    endpoints,
    summary: {
      endpoints: Object.keys(endpoints).length,
      failing: Object.values(endpoints).filter((e) => !e.pass).length,
    },
    gate: {
      pass: allPass,
      p95_target_ms: targets.p95_page_ms,
      hard_ceiling_ms: targets.hard_ceiling_ms,
      policy: 'Every sampled endpoint must serve a P95 under the page budget with no request over the hard ceiling.',
    },
  };
}

export default { PERFORMANCE_VERSION, PERFORMANCE_TARGETS, percentile, mean, summariseEndpoints };

