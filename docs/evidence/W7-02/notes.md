# W7-02 - Pipeline dashboard filters (DSH-01)

**BRD requirement:** DSH-01 - "Investment Team dashboard filters (entity, cluster, sector, state, owner, date) + drill-down".
**Acceptance criterion:** Filters + drill-down; near-real-time.
**Priority:** Must.

## What this covers

The Investment Team board is sliced by entity, cluster, sector, stage, owner and
date, and can be drilled down into any of those cuts. The server applies the
filter set over the live screening board (which already respects the actor's
organisation scope) and returns the filtered cards, the near-real-time summary,
the filter options present in the current scope and the drill-down grouping. The
dimension list and default drill-down are configuration (AppSettings
'pipeline_dashboard_config'), versioned and audited.

## Evidence

1. **leadership_pipeline_dashboard_filters_leadership.png** - the Investment Team
   view (fahad@sirius.local) of the dashboard: the five dropdown filters (entity,
   cluster, sector, owner, updated) plus the stage chips, the drill-down selector,
   the near-real-time summary (14 matching opportunities, board total 14, 0 SLA
   breaches, 3 stages in the cut) and the drill-down by state (Screening 9,
   Submission 4, Refinement 1). The nav shows the new **Pipeline Dashboard** menu.

2. **leadership_pipeline_dashboard_drilldown_leadership.png** - the same board
   drilled down by **entity** instead: the grouped counts per subsidiary (Infinia
   Technologies Limited 11, Finstreet Limited 3) with the stages each group spans.

## How it works

- Vocabulary lives in server/config/pipelineDashboardData.js: the six filter
  dimensions (entity, cluster, sector, state, owner, date), the date presets and
  the sector->cluster map that mirrors the portfolio register taxonomy.
- Pure logic lives in server/config/pipelineDashboard.js: filter parsing
  (comma lists / repeated params), card matching (entity / cluster / sector /
  stage / owner / date window), the in-scope filter options, the drill-down
  grouping and the summary, plus the versioned configuration helpers.
- server/pipelineDashboard.js (/api/pipeline-dashboard) exposes the config, the
  filtered board, the admin config write and the config history. The dimension
  set and default drill-down are held in AppSettings under
  'pipeline_dashboard_config', falling back to the shipped default; an admin edit
  mints revision + 1 and is audited as 'pipeline_dashboard_config_updated'.
- The page renders at src/pages/PipelineDashboard.jsx (/PipelineDashboard),
  registered in pages.config.js and gated by the 'reporting' feature group.

## Verification

- server/tests/pipelineDashboard.test.js - 12 pure-function cases (default
  dimensions, clamping, validation, revision minting, filter parsing, card
  matching by entity/sector/stage/owner, date presets, derived cluster, in-scope
  options, drill-down grouping, summary, active-filter count).
- server/tests/m6.test.js - 6 integration cases (config vocabulary, board
  payload, stage filter narrowing, drill-down regrouping, 403 for non-admin,
  audited revision edit). Full suite green (874 pass / 0 fail).
