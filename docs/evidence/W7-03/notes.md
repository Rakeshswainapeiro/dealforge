# W7-03 - Funnel & cycle-time metrics (DSH-04)

**BRD requirement:** DSH-04 - "Funnel and cycle-time metrics (conversion by stage, decline reasons, avg time/state vs SLA)".
**Acceptance criterion:** Metrics for any date range; cycle time vs SLA.
**Priority:** Should.

## What this covers

The Investment Team sees how many opportunities reach each forward stage
(submission, screening, refinement, approval), the conversion from the previous
stage and from submission, why the ones that leave are declined / returned /
withdrawn, and how long each stage takes against its SLA target. Everything is
computed over the actor's own organisation scope and honouring a date-range
preset, so a subsidiary sees only its own metrics.

## Evidence

1. **leadership_funnel_conversion_leadership.png** - the Investment Team view
   (fahad@sirius.local): the four summary cards (14 entered the funnel, 24
   tracked opportunities, 0 cycle-time breaches, any-time range), the funnel bar
   chart and table (Submission 14 / 100%, Screening 10 / 71.4%, Refinement 1 /
   7.1%, Approval 0 / 0%), the cycle-time table against the SLA, and the start of
   the "Why opportunities leave" panel.

2. **leadership_cycle_time_vs_sla_leadership.png** - the same page scrolled to
   the cycle-time table, showing per-stage samples, average, median, max, the SLA
   target and the average-versus-SLA margin, with the new **Funnel & Cycle Time**
   menu in the nav.

## How it works

- Vocabulary lives in server/config/pipelineMetricsData.js: the PMT-01. version
  prefix, the pipeline_metrics_config setting key, the four forward funnel
  stages, the three branch states and the four date-range presets.
- Pure logic lives in server/config/pipelineMetrics.js: funnelCounts (each
  opportunity counted at every stage it reached, with conversion percentages),
  reasonBreakdown (leaving transitions grouped by reason code, largest first),
  cycleTime (elapsed days between consecutive stage entries, an open stage
  measured up to now, compared to the stage SLA), buildMetrics and the versioned
  configuration helpers.
- server/pipelineMetrics.js (/api/pipeline-metrics) exposes the config, the
  summary for a range, the admin config write and the config history. It loads
  the actor's opportunities and ordered pipeline_transition rows under the same
  org-scope rule as the board and feeds them to the pure module. The default
  range lives in AppSettings under 'pipeline_metrics_config'; an admin edit mints
  revision + 1 and is audited as 'pipeline_metrics_config_updated'.
- The page renders at src/pages/PipelineMetrics.jsx (/PipelineMetrics),
  registered in pages.config.js and gated by the reporting feature group. It uses
  the recharts bar chart already shipped for the Analytics page.

## Verification

- server/tests/pipelineMetrics.test.js - 11 pure-function cases (default config,
  range clamping, validation, revision minting, range parsing/window, funnel
  counts and conversion, reason breakdown, cycle time with SLA comparison, an
  open stage measured to now, the assembled pack).
- server/tests/m6.test.js - 5 integration cases (config vocabulary, summary
  payload, a narrower range never widening the funnel, 403 for non-admin, audited
  revision edit). Full suite green (890 pass / 0 fail).
