#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Performance SIT harness (W9-04 / BRD NFR-04).
//
// Exercises the read-heavy surfaces a user touches (pipeline board, pipeline
// dashboard, funnel metrics, reporting, screening panel) with a representative
// dataset and records the P95 latency per endpoint. It calls
// server/config/performance.js summariseEndpoints for the verdict so the harness
// and the NFR-04 unit tests share one definition of "pass".
//
//   node scripts/performance_sit.mjs --base http://localhost:34010 --n 12
//   node scripts/performance_sit.mjs --out docs/evidence/W9-04/performance_report.json
//
// Exit code is non-zero when any endpoint misses the P95 budget or breaches the
// hard ceiling, so the SIT can gate a release.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { PERFORMANCE_VERSION, PERFORMANCE_TARGETS, summariseEndpoints } from '../server/config/performance.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = (arg('base', process.env.BASE || 'http://localhost:34010')).replace(/\/+$/, '');
const N = Number(arg('n', 12));
const USER = arg('user', 'user-admin');
const OUT = arg('out', 'docs/evidence/W9-04/performance_report.json');

const ENDPOINTS = [
  { label: 'pipeline_board', path: '/api/pipeline/board' },
  { label: 'pipeline_dashboard', path: '/api/pipeline-dashboard/board' },
  { label: 'funnel_metrics', path: '/api/pipeline-metrics/summary' },
  { label: 'reporting_weekly', path: '/api/reporting/weekly' },
  { label: 'portfolio_register', path: '/api/portfolio-register' },
  { label: 'screening_panel', path: null },
];

async function timeOnce(path_) {
  const start = process.hrtime.bigint();
  const res = await fetch(BASE + path_, { headers: { 'x-user-id': USER, Accept: 'application/json' } });
  await res.arrayBuffer();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, status: res.status };
}

async function resolveScreeningPath() {
  // Pick a live opportunity and time its screening panel read.
  const res = await fetch(BASE + '/api/pipeline/board', { headers: { 'x-user-id': USER, Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data.columns || []).flatMap((c) => c.items || [])[0];
  return first ? `/api/pipeline/opportunities/${first.id}/screening` : null;
}

async function main() {
  const samples = {};
  const statuses = {};
  for (const ep of ENDPOINTS) {
    const p = ep.path || (ep.label === 'screening_panel' ? await resolveScreeningPath() : null);
    if (!p) continue;
    samples[ep.label] = [];
    for (let i = 0; i < N; i++) {
      const { ms, status } = await timeOnce(p);
      samples[ep.label].push(ms);
      statuses[ep.label] = status;
    }
  }

  const result = summariseEndpoints(samples, PERFORMANCE_TARGETS);
  const report = {
    version: PERFORMANCE_VERSION,
    measured_at: new Date().toISOString(),
    base: BASE,
    samples_per_endpoint: N,
    targets: PERFORMANCE_TARGETS,
    endpoints: result.endpoints,
    statuses,
    summary: result.summary,
    gate: result.gate,
    screening_note: 'NFR-04 also sets a 15-minute screening SLA; that is an end-to-end analyst process budget, tracked separately from the page budget measured here.',
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  console.log('DealForge performance SIT (NFR-04)');
  for (const [label, e] of Object.entries(result.endpoints)) {
    console.log(`  ${label.padEnd(20)} p50 ${String(e.p50_ms).padStart(4)}ms  p95 ${String(e.p95_ms).padStart(4)}ms  max ${String(e.max_ms).padStart(4)}ms  ${e.pass ? 'PASS' : 'FAIL'}`);
  }
  console.log(`  gate: ${result.gate.pass ? 'PASS' : 'FAIL'} (P95 <= ${result.gate.p95_target_ms}ms)`);
  console.log(`  report written to : ${OUT}`);
  if (!result.gate.pass) process.exit(1);
}

main().catch((err) => { console.error('performance SIT failed:', err.message); process.exit(1); });

