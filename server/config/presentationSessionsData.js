// ---------------------------------------------------------------------------
// Subsidiary presentation scheduling vocabulary (W6-06 / BRD WF-07).
//
// Source of truth: the Phase-1 BRD, Workflow - "Subsidiary presentation
// scheduling" with accept criterion "Captured on record".
//
// A subsidiary presents a live deal to the group investment layer before it is
// screened. Each presentation is a session captured on the opportunity record:
// who attends, when it is held, and - once it has happened - the outcome and the
// next steps. The session is durable so the record shows what was discussed and
// what was agreed.
//
// This module is vocabulary only; the pure resolution and validation functions
// live in config/presentationSessions.js and the HTTP route in
// server/presentationSessions.js.
// ---------------------------------------------------------------------------

export const PRESENTATION_CONFIG_KEY = 'presentation_session_config';
export const PRESENTATION_VERSION = 'PRS-01.1';
export const PRESENTATION_VERSION_PREFIX = 'PRS-01.';
export const PRESENTATION_DEFAULT_REVISION = 1;
export const PRESENTATION_OWNER = 'Group Investment Team / Investment Committee';

// A session moves from scheduled to completed (held) or cancelled.
export const PRESENTATION_STATUSES = [
  { key: 'scheduled', label: 'Scheduled', description: 'Booked with the group, not yet held.' },
  { key: 'completed', label: 'Completed', description: 'Held; the outcome and next steps are recorded.' },
  { key: 'cancelled', label: 'Cancelled', description: 'Not held; the reason is recorded in the outcome.' },
];
export const PRESENTATION_STATUS_KEYS = PRESENTATION_STATUSES.map((s) => s.key);

// How the session is held.
export const PRESENTATION_FORMATS = [
  { key: 'video', label: 'Video conference' },
  { key: 'in_person', label: 'In person' },
  { key: 'hybrid', label: 'Hybrid' },
];
export const PRESENTATION_FORMAT_KEYS = PRESENTATION_FORMATS.map((f) => f.key);

export const DEFAULT_PRESENTATION_STATUS = 'scheduled';
export const DEFAULT_PRESENTATION_FORMAT = 'video';

// The fields that must be present before a session counts as captured on
// record. The shipped policy requires a date and at least one attendee.
export const PRESENTATION_REQUIRED_FIELDS = ['scheduled_at', 'attendees'];

// Roles that own a subsidiary's presentation with the group. A cross-org reader
// may also see every session regardless of subsidiary.
export const PRESENTATION_CROSS_ORG_ROLES = ['sirius_deal_lead', 'cio', 'leadership', 'ic_member', 'board_member', 'group_compliance', 'admin'];

export const PRESENTATION_MESSAGES = {
  config_invalid: 'The presentation session configuration is invalid.',
  scheduled_at_required: 'A presentation must be scheduled with a date and time.',
  attendees_required: 'A presentation must name at least one attendee.',
  invalid_status: 'A presentation status must be scheduled, completed or cancelled.',
  invalid_format: 'A presentation format must be video, in person or hybrid.',
  not_found: 'That presentation session could not be found.',
  opportunity_not_found: 'That opportunity could not be found.',
  forbidden: 'You do not have permission to manage presentations for this opportunity.',
  outcome_required: 'Record the outcome before marking a presentation completed.',
  disclaimer:
    'Presentations are captured on the opportunity record: the scheduled date, the group attendees, the outcome and ' +
    'the next steps. Every create or update is written to the audit trail.',
};

export default {
  PRESENTATION_CONFIG_KEY,
  PRESENTATION_VERSION,
  PRESENTATION_VERSION_PREFIX,
  PRESENTATION_DEFAULT_REVISION,
  PRESENTATION_OWNER,
  PRESENTATION_STATUSES,
  PRESENTATION_STATUS_KEYS,
  PRESENTATION_FORMATS,
  PRESENTATION_FORMAT_KEYS,
  DEFAULT_PRESENTATION_STATUS,
  DEFAULT_PRESENTATION_FORMAT,
  PRESENTATION_REQUIRED_FIELDS,
  PRESENTATION_CROSS_ORG_ROLES,
  PRESENTATION_MESSAGES,
};
