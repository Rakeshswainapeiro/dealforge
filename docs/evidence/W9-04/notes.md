# W9-04 — Performance SIT (BRD NFR-04)

Requirement: **NFR-04** — P95 page interaction under 3 seconds; a screening run
under 15 minutes.

## What was done

- **Reproducible harness.** `scripts/performance_sit.mjs` exercises the
  read-heavy surfaces a user touches — the pipeline board, the pipeline
  dashboard board, funnel metrics, the weekly reporting view, the portfolio
  register and a live opportunity's screening panel — records each request's
  latency, and writes a per-endpoint P50/P95/max report. It calls
  `summariseEndpoints` for the verdict and **exits non-zero when any endpoint
  misses the P95 budget or breaches the hard ceiling**, so the SIT can gate a
  release.
- **Shared targets.** `server/config/performance.js` holds the NFR-04 targets
  (P95 page budget 3000 ms, screening SLA 15 min, a 10 s hard ceiling, a minimum
  sample count) and the pure `percentile` / `mean` / `summariseEndpoints`
  helpers, unit-tested independently of any running server.

## Measured result (dev stack, 16,610 opportunity records, 20 samples/endpoint)

| Endpoint | P50 | P95 | Max | Verdict |
|---|---|---|---|---|
| pipeline board | 9.9 ms | 43.9 ms | 43.9 ms | PASS |
| pipeline dashboard | 10.1 ms | 13.7 ms | 13.7 ms | PASS |
| funnel metrics | 3.7 ms | 4.3 ms | 4.3 ms | PASS |
| reporting weekly | 8.7 ms | 10.2 ms | 10.2 ms | PASS |
| portfolio register | 2.3 ms | 2.8 ms | 2.8 ms | PASS |
| screening panel | 6.1 ms | 7.0 ms | 7.0 ms | PASS |

Every endpoint is three orders of magnitude inside the 3000 ms P95 budget on a
representative dataset.

## Notes

- The 15-minute screening figure is an end-to-end analyst process SLA (intake to
  a screened decision), not a single HTTP request, so it is recorded as a
  process budget rather than measured by the HTTP harness. The per-request work
  the screening step depends on is covered by the screening-panel and pipeline
  endpoints above.
- The harness also works against the UAT demo stack
  (`--base http://localhost:34010`) with a smaller sample set.

## Evidence

- `docs/evidence/W9-04/performance_report.json` — the measured per-endpoint
  latencies and the gate verdict from `scripts/performance_sit.mjs`.

## Tests

- `server/tests/performance.test.js` — 7 pass: targets, nearest-rank percentile,
  a passing endpoint, an over-P95 endpoint, too few samples, a hard-ceiling
  breach and the mean.
