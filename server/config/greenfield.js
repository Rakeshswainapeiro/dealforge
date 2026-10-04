// ---------------------------------------------------------------------------
// Greenfield extra tests (W1-07 / BRD INT-10).
//
// A greenfield / new-venture opportunity is a build, not an acquisition, so it
// carries a different evidence bar. When opportunity_type = 'greenfield' the
// submission must also capture:
//   - a quantified benefit and a "why now",
//   - the why-this / why-now / why-us thesis (already captured by the six-section
//     pack, so it is referenced rather than duplicated),
//   - the budget status, and
//   - a named, secured funding source.
// And the stage must be recorded as Concept, Feasibility or Initiate.
//
// Two rules are enforced here, not at the call site (REQ-RULE-10):
//   1. A greenfield submission without a secured funding source is blocked.
//   2. A Concept-stage submission requires only the concept note, which is
//      capped at two pages; the full document pack is required only once the
//      stage advances to Feasibility or Initiate.
//
// This module is the single source the gate, the submit route, the capture form
// and the tests read, mirroring config/qualifyingGates.js and config/belowFloor.js.
// ---------------------------------------------------------------------------

import { INTAKE_FIELDS } from './intakeConfig.js';

// The eligible opportunity type that triggers the extra tests (INT-04).
export const GREENFIELD_TYPE = 'greenfield';

// The three greenfield stages (INT-10). documents_required is false for
// Concept: a Concept entry is a two-page note, not a full pack.
export const GREENFIELD_STAGES = [
  { value: 'concept', label: 'Concept', documents_required: false },
  { value: 'feasibility', label: 'Feasibility', documents_required: true },
  { value: 'initiate', label: 'Initiate', documents_required: true },
];

export const GREENFIELD_STAGE_KEYS = GREENFIELD_STAGES.map((s) => s.value);

// The maximum length of a Concept-stage note, in pages (INT-10). Informational
// to the form; the concept note is a document, so the cap is surfaced as
// guidance rather than bytes enforced on an upload.
export const CONCEPT_NOTE_MAX_PAGES = 2;

// The dedicated greenfield capture fields, declared here so both the capture
// model (intakeConfig.js) and the gate read one source. stage records the
// greenfield stage; benefit is the quantified benefit; secured_source names the
// secured funding source (a greenfield-specific ask distinct from the generic
// funding_source).
export const GREENFIELD_FIELDS = {
  stage: 'greenfield_stage',
  benefit: 'greenfield_benefit',
  secured_source: 'greenfield_secured_funding_source',
};

// The thesis fields the six-section pack already captures, referenced so the
// greenfield tests and the memo name them identically (INT-10 "why-this /
// why-now / why-us thesis").
export const GREENFIELD_THESIS_FIELDS = {
  what: 'narrative_what',
  why_now: 'narrative_why_now',
  why_us: 'narrative_why_us',
};

// The generic funding fields the greenfield tests also read.
export const GREENFIELD_FUNDING_FIELDS = {
  status: 'funding_sources_status',
  budget: 'budget_status',
  source: 'funding_source',
};

// The secured value that satisfies the funding-source rule. Only 'secured'
// clears it: committed and indicative are not secured.
export const SECURED_FUNDING_STATUS = 'secured';

export const GREENFIELD_MESSAGES = {
  stage_required:
    'A greenfield / new venture must record its stage: Concept, Feasibility or Initiate.',
  benefit_required:
    'A greenfield submission must quantify the benefit: state the benefit and why now.',
  thesis_required:
    'A greenfield submission needs the why-this / why-now / why-us thesis (the rationale narratives).',
  funding_source_required:
    'A greenfield submission must name the secured funding source.',
  funding_not_secured:
    'Submission blocked: a greenfield / new venture without a secured funding source cannot be submitted. Mark the funding sources status as Secured and name the source.',
  budget_required:
    'A greenfield submission must state the budget status.',
};

export const GREENFIELD_NOT_READY =
  'Not ready: this greenfield / new venture has not cleared the extra tests. A secured funding source plus the greenfield stage and benefit are required before submission.';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function isGreenfield(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === GREENFIELD_TYPE;
}

// Labels looked up from the capture model so the form and the gate agree.
const FIELD_LABELS = new Map(INTAKE_FIELDS.map((f) => [f.key, f.label]));
const fieldLabel = (key) => FIELD_LABELS.get(key) || key;

/**
 * Evaluate the greenfield extra tests for an opportunity's data. Pure.
 *
 * Returns null for a non-greenfield opportunity (the tests do not apply).
 * For a greenfield entry it returns a decision the gate, the submit route and
 * the UI all read:
 *
 *   applies             - true, this is a greenfield / new venture
 *   stage               - the recorded stage key (or null)
 *   stage_valid         - the stage is one of Concept / Feasibility / Initiate
 *   documents_required  - false at Concept, true at Feasibility / Initiate
 *   secured             - the funding sources status is Secured
 *   satisfied           - every extra test is met, so submission may proceed
 *   stops               - the tests not yet met, each with a code and message
 *   tags                - marker fields to persist on the opportunity
 */
export function evaluateGreenfield(data = {}) {
  if (!isGreenfield(data.opportunity_type)) return null;

  const stage = blank(data[GREENFIELD_FIELDS.stage])
    ? null
    : String(data[GREENFIELD_FIELDS.stage]).trim().toLowerCase();
  const stageSpec = GREENFIELD_STAGES.find((s) => s.value === stage) || null;

  const stops = [];
  if (!stageSpec) {
    stops.push({ code: 'stage_required', message: GREENFIELD_MESSAGES.stage_required });
  }
  if (blank(data[GREENFIELD_FIELDS.benefit])) {
    stops.push({ code: 'benefit_required', message: GREENFIELD_MESSAGES.benefit_required });
  }
  for (const key of Object.values(GREENFIELD_THESIS_FIELDS)) {
    if (blank(data[key])) {
      stops.push({ code: 'thesis_required', field: key, label: fieldLabel(key), message: GREENFIELD_MESSAGES.thesis_required });
    }
  }
  if (blank(data[GREENFIELD_FUNDING_FIELDS.budget])) {
    stops.push({ code: 'budget_required', message: GREENFIELD_MESSAGES.budget_required });
  }

  const status = blank(data[GREENFIELD_FUNDING_FIELDS.status])
    ? null
    : String(data[GREENFIELD_FUNDING_FIELDS.status]).trim().toLowerCase();
  const secured = status === SECURED_FUNDING_STATUS;
  if (blank(data[GREENFIELD_FIELDS.secured_source])) {
    stops.push({ code: 'funding_source_required', message: GREENFIELD_MESSAGES.funding_source_required });
  }
  if (!secured) {
    stops.push({ code: 'funding_not_secured', message: GREENFIELD_MESSAGES.funding_not_secured });
  }

  return {
    applies: true,
    stage,
    stage_valid: Boolean(stageSpec),
    stage_label: stageSpec ? stageSpec.label : null,
    documents_required: stageSpec ? stageSpec.documents_required : true,
    concept_note_max_pages: CONCEPT_NOTE_MAX_PAGES,
    funding_status: status,
    secured,
    secured_source: blank(data[GREENFIELD_FIELDS.secured_source]) ? null : String(data[GREENFIELD_FIELDS.secured_source]),
    satisfied: stops.length === 0,
    stops,
    message: stops.length === 0 ? null : GREENFIELD_NOT_READY,
    tags: { greenfield: true, greenfield_stage: stage },
  };
}

// The default greenfield capture values, so a seed fixture and the tests can
// satisfy the extra tests without re-listing each key.
export function greenfieldDefaults(overrides = {}) {
  return {
    greenfield_stage: 'feasibility',
    greenfield_benefit: 'Adds a new recurring-revenue platform; the window is open before competitors consolidate the segment.',
    greenfield_secured_funding_source: 'Sirius balance sheet',
    funding_sources_status: 'secured',
    budget_status: 'in_budget',
    ...overrides,
  };
}

export default {
  GREENFIELD_TYPE, GREENFIELD_STAGES, GREENFIELD_STAGE_KEYS, CONCEPT_NOTE_MAX_PAGES,
  GREENFIELD_FIELDS, GREENFIELD_THESIS_FIELDS, GREENFIELD_FUNDING_FIELDS,
  SECURED_FUNDING_STATUS, GREENFIELD_MESSAGES, GREENFIELD_NOT_READY,
  isGreenfield, evaluateGreenfield, greenfieldDefaults,
};
