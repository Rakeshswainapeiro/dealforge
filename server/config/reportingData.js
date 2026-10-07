// ---------------------------------------------------------------------------
// IHC weekly report - hand-authored vocabulary (W7-01 / BRD DSH-03).
//
// The group's Investment Holding Committee reviews a standing weekly tracker
// every Friday. DealForge reproduces that tracker from the pipeline so the
// weekly pack is generated rather than retyped. This module holds what is
// configuration: the column set (and their order), the default weekly schedule
// and the human labels. It contains no database access.
// ---------------------------------------------------------------------------

export const REPORTING_CONFIG_KEY = 'reporting_config';
export const REPORTING_VERSION = 'RPT-01.1';
export const REPORTING_VERSION_PREFIX = 'RPT-01';
export const REPORTING_DEFAULT_REVISION = 1;
export const REPORTING_OWNER = 'Group Investment Holding Committee (IHC)';

// The Friday tracker columns, in presentation order. kind drives the value
// resolution and the Excel/CSV formatting: 'text' | 'money_mn' | 'days' |
// 'boolean' | 'date' | 'enum'.
export const WEEKLY_COLUMNS = [
  { key: 'ref', label: 'Ref', kind: 'text', width: 16 },
  { key: 'subsidiary', label: 'Subsidiary', kind: 'text', width: 26 },
  { key: 'opportunity_name', label: 'Opportunity', kind: 'text', width: 34 },
  { key: 'opportunity_type', label: 'Type', kind: 'text', width: 16 },
  { key: 'sector', label: 'Sector', kind: 'text', width: 20 },
  { key: 'geography', label: 'Geography', kind: 'text', width: 16 },
  { key: 'total_commitment_mn', label: 'Commitment (AED mn)', kind: 'money_mn', width: 20 },
  { key: 'state_label', label: 'Stage', kind: 'enum', width: 14 },
  { key: 'sirius_owner', label: 'Sirius owner', kind: 'text', width: 26 },
  { key: 'owner_email', label: 'Prepared by', kind: 'text', width: 26 },
  { key: 'age_days', label: 'Age (days)', kind: 'days', width: 12 },
  { key: 'sla_days', label: 'SLA (days)', kind: 'days', width: 12 },
  { key: 'sla_breached', label: 'SLA breached', kind: 'boolean', width: 14 },
  { key: 'decision', label: 'Decision / reason', kind: 'text', width: 40 },
  { key: 'updated_date', label: 'Last updated', kind: 'date', width: 22 },
];

export const WEEKLY_COLUMN_KEYS = WEEKLY_COLUMNS.map((c) => c.key);

// Which pipeline states the weekly IHC tracker carries. The BRD tracker covers
// the live pipeline (everything not yet settled) plus the decisions taken in
// the week, so terminal branches are included but labelled.
export const WEEKLY_STATES = ['screening_review', 'information_requested', 'on_hold', 'proceed_to_gate2', 'declined', 'withdrawn'];

// Default weekly cadence. Friday 09:00 Asia/Dubai (0 = Sunday .. 5 = Friday).
export const DEFAULT_SCHEDULE = {
  enabled: false,
  weekday: 5,
  hour: 9,
  timezone: 'Asia/Dubai',
};

export const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export const REPORTING_EXPORT_FORMATS = [
  { key: 'xlsx', label: 'Excel (.xlsx)' },
  { key: 'csv', label: 'CSV (.csv)' },
];

export const REPORTING_MESSAGES = {
  disclaimer:
    'The weekly IHC tracker is generated from the live pipeline. Columns follow the agreed Friday tracker layout; every figure traces back to the opportunity record.',
  export_note:
    'Excel and CSV exports reproduce the same columns and order shown on screen.',
};
