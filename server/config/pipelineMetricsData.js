// ---------------------------------------------------------------------------
// Funnel & cycle-time metrics - vocabulary (W7-03 / BRD DSH-04).
//
// The Investment Team tracks how many opportunities reach each stage, why the
// ones that leave are declined, and how long each stage takes against its SLA.
// This module holds the stage vocabulary and the messages; it contains no
// database access.
// ---------------------------------------------------------------------------

export const PIPELINE_METRICS_KEY = 'pipeline_metrics_config';
export const PIPELINE_METRICS_VERSION = 'PMT-01.1';
export const PIPELINE_METRICS_VERSION_PREFIX = 'PMT-01';
export const PIPELINE_METRICS_DEFAULT_REVISION = 1;

// The funnel, in order (BRD v2 WF-01). Only the forward path is a funnel; the
// branch states are tracked separately as the reasons items leave. Submitted
// counts every opportunity that entered screening; the automatic completeness
// and initial-screening steps are not separate funnel stages.
export const FUNNEL_STAGES = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'screening_review', label: 'Screening Review' },
  { key: 'proceed_to_gate2', label: 'Proceed to Gate 2' },
];

export const FUNNEL_STAGE_KEYS = FUNNEL_STAGES.map((s) => s.key);

// The branch/terminal states an item may leave the funnel through, and the
// loops it may pass through on the way.
export const BRANCH_STATES = [
  { key: 'information_requested', label: 'Information Requested' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'declined', label: 'Declined' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

export const BRANCH_STATE_KEYS = BRANCH_STATES.map((s) => s.key);

// The date-range presets the metrics honour.
export const METRIC_RANGES = [
  { key: 'any', label: 'Any time', days: null },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '365d', label: 'Last 12 months', days: 365 },
];

export const PIPELINE_METRICS_MESSAGES = {
  disclaimer:
    'Funnel and cycle-time metrics are computed from the actor’s own organisation scope: transitions and opportunities outside it are excluded.',
  cycle_note: 'Cycle time is the elapsed time between consecutive transitions, measured against the stage SLA target.',
};
