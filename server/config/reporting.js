// ---------------------------------------------------------------------------
// IHC weekly report - pure logic (W7-01 / BRD DSH-03).
//
// No database, no network. Owns the column vocabulary, the value resolution
// from a pipeline card, the schedule validation and the CSV serialisation. The
// route (server/reporting.js) supplies the cards; this module decides how they
// become rows and files.
// ---------------------------------------------------------------------------

import {
  REPORTING_CONFIG_KEY, REPORTING_VERSION, REPORTING_VERSION_PREFIX,
  REPORTING_DEFAULT_REVISION, REPORTING_OWNER, WEEKLY_COLUMNS, WEEKLY_COLUMN_KEYS,
  WEEKLY_STATES, DEFAULT_SCHEDULE, WEEKDAYS, REPORTING_EXPORT_FORMATS, REPORTING_MESSAGES,
} from './reportingData.js';

export {
  REPORTING_CONFIG_KEY, REPORTING_VERSION, REPORTING_VERSION_PREFIX,
  REPORTING_DEFAULT_REVISION, REPORTING_OWNER, WEEKLY_COLUMNS, WEEKLY_COLUMN_KEYS,
  WEEKLY_STATES, DEFAULT_SCHEDULE, WEEKDAYS, REPORTING_EXPORT_FORMATS, REPORTING_MESSAGES,
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

export function defaultReportingConfig() {
  return {
    version: REPORTING_VERSION,
    revision: REPORTING_DEFAULT_REVISION,
    source: 'default',
    owner: REPORTING_OWNER,
    columns: WEEKLY_COLUMN_KEYS.slice(),
    states: WEEKLY_STATES.slice(),
    schedule: { ...DEFAULT_SCHEDULE },
    updated_by: null,
    updated_at: null,
  };
}

function normSchedule(raw, base = DEFAULT_SCHEDULE) {
  if (!isPlainObject(raw)) return { ...base };
  const weekday = Number(raw.weekday);
  const hour = Number(raw.hour);
  return {
    enabled: raw.enabled === undefined ? base.enabled : Boolean(raw.enabled),
    weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : base.weekday,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : base.hour,
    timezone: raw.timezone !== undefined && String(raw.timezone).trim() !== '' ? String(raw.timezone).trim() : base.timezone,
  };
}

export function resolveReportingConfig(raw, { base = defaultReportingConfig() } = {}) {
  const cfg = coerce(raw);
  if (!isPlainObject(cfg)) return base;
  const cols = Array.isArray(cfg.columns)
    ? cfg.columns.map((c) => String(c)).filter((c) => WEEKLY_COLUMN_KEYS.includes(c))
    : base.columns;
  const states = Array.isArray(cfg.states)
    ? cfg.states.map((s) => String(s)).filter((s) => WEEKLY_STATES.includes(s))
    : base.states;
  return {
    version: base.version,
    revision: Number.isInteger(cfg.revision) ? cfg.revision : base.revision,
    source: cfg.source || base.source,
    owner: cfg.owner !== undefined && String(cfg.owner).trim() !== '' ? String(cfg.owner).trim() : base.owner,
    columns: cols.length ? cols : base.columns,
    states: states.length ? states : base.states,
    schedule: normSchedule(cfg.schedule, base.schedule),
    updated_by: cfg.updated_by || base.updated_by,
    updated_at: cfg.updated_at || base.updated_at,
  };
}

export function validateReportingConfig(config) {
  const cfg = coerce(config);
  const errors = [];
  if (!isPlainObject(cfg)) return { ok: false, errors: ['configuration must be an object'] };
  if (!Array.isArray(cfg.columns) || cfg.columns.length === 0) errors.push('columns must be a non-empty list');
  else {
    for (const c of cfg.columns) if (!WEEKLY_COLUMN_KEYS.includes(c)) errors.push('unknown column: ' + c);
  }
  if (cfg.schedule && cfg.schedule.weekday !== undefined) {
    const wd = Number(cfg.schedule.weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) errors.push('schedule.weekday must be 0-6');
  }
  return { ok: errors.length === 0, errors };
}

// A stable, comparable digest of the schedule so the run log can tell whether a
// report for this window already exists.
export function scheduleKey(schedule, at = new Date()) {
  normSchedule(schedule); // validate/normalise the schedule shape
  const d = new Date(at);
  // ISO week start (Monday) so a Friday run is identified by its week.
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

// Resolve one pipeline card into a tracker row using the configured columns.
export function buildWeeklyRows(cards, { config, subsidiaryNames = {} } = {}) {
  const cfg = resolveReportingConfig(config);
  const cols = WEEKLY_COLUMNS.filter((c) => cfg.columns.includes(c.key));
  const rows = (cards || []).map((card) => {
    const values = {};
    for (const col of cols) values[col.key] = columnValue(col.key, card, subsidiaryNames);
    return { id: card.id, owner_org_id: card.owner_org_id || null, state: card.state, values };
  });
  return { columns: cols, rows };
}

function decisionText(card) {
  const label = card.decision_reason_label ? card.decision_reason_label + (card.decision_reason_text ? ': ' : '') : '';
  if (card.state === 'declined') return label + (card.declined_reason || card.decision_reason_text || '') || 'Declined';
  if (card.state === 'withdrawn') return label + (card.withdrawn_reason || card.decision_reason_text || '') || 'Withdrawn';
  if (card.state === 'on_hold') return label + (card.hold_reason || card.decision_reason_text || '') || 'On hold';
  if (card.state === 'proceed_to_gate2') return label + (card.decision_reason_text || '') || 'Proceed to Gate 2';
  if (card.state === 'information_requested') return 'Information requested' + (card.info_request_due_at ? ' (due ' + String(card.info_request_due_at).slice(0, 10) + ')' : '');
  return '';
}

export function columnValue(key, card, subsidiaryNames = {}) {
  switch (key) {
    case 'ref': return card.ref || (card.id ? card.id.slice(0, 8).toUpperCase() : '');
    case 'subsidiary': return subsidiaryNames[card.owner_org_id] || card.owner_org_name || card.owner_org_id || '';
    case 'opportunity_name': return card.opportunity_name || '';
    case 'opportunity_type': return card.opportunity_type || '';
    case 'sector': return card.sector || '';
    case 'geography': return card.geography || '';
    case 'total_commitment_mn': return card.total_commitment_aed == null ? '' : Number(card.total_commitment_aed);
    case 'state_label': return card.state_label || card.state || '';
    case 'sirius_owner': return card.sirius_owner_name || card.sirius_owner_email || 'Unassigned';
    case 'owner_email': return card.owner_email || '';
    case 'age_days': return card.age_days == null ? '' : card.age_days;
    case 'sla_days': return card.sla_days == null ? '' : card.sla_days;
    case 'sla_breached': return card.sla_breached ? 'Yes' : 'No';
    case 'decision': return decisionText(card);
    case 'updated_date': return card.updated_date ? new Date(card.updated_date).toISOString() : '';
    default: return '';
  }
}

// Summary block shown above the tracker (counts by stage and the SLA posture).
export function summarizeWeekly(rows) {
  const by_state = {};
  let breaches = 0;
  let commitment = 0;
  for (const r of rows) {
    const s = r.values.state_label || r.state || 'unknown';
    by_state[s] = (by_state[s] || 0) + 1;
    if (r.values.sla_breached === 'Yes') breaches += 1;
    const c = Number(r.values.total_commitment_mn);
    if (Number.isFinite(c)) commitment += c;
  }
  return { total: rows.length, breaches, by_state, commitment_aed_mn: Math.round(commitment * 100) / 100 };
}

function fmtCell(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function esc(v) {
  const s = fmtCell(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Render the tracker as CSV (the Excel export builds on the same rows).
export function toCsv({ columns, rows }) {
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r.values[c.key])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

export function diffReportingConfig(before, after) {
  const changes = [];
  const b = resolveReportingConfig(before);
  const a = resolveReportingConfig(after);
  if (JSON.stringify(b.columns) !== JSON.stringify(a.columns)) changes.push({ field: 'columns', before: b.columns, after: a.columns });
  if (JSON.stringify(b.states) !== JSON.stringify(a.states)) changes.push({ field: 'states', before: b.states, after: a.states });
  if (JSON.stringify(b.schedule) !== JSON.stringify(a.schedule)) changes.push({ field: 'schedule', before: b.schedule, after: a.schedule });
  if (b.owner !== a.owner) changes.push({ field: 'owner', before: b.owner, after: a.owner });
  return changes;
}

export function buildReportingConfig(patch, { actor, base } = {}) {
  const current = resolveReportingConfig(base);
  const merged = resolveReportingConfig({ ...current, ...patch }, { base: current });
  return {
    ...merged,
    revision: (current.revision || 0) + 1,
    source: 'admin',
    updated_by: actor?.email || null,
    updated_at: new Date().toISOString(),
  };
}
