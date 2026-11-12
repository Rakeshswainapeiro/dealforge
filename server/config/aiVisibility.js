// ---------------------------------------------------------------------------
// Who may see the internal Sirius assessment of an opportunity.
//
// The subsidiary Preparer fills in the form, uploads documents, submits, sees
// the submission status and answers information requests. The AI validation and
// analysis, screening results, scorecards, risk flags, recommendations and the
// reviewers' overrides are the Sirius Investment Team's: they must never leave
// the server for a Preparer, whatever the screen shows.
//
// Pure: no database, no network. Every route that can return internal material
// calls these helpers so there is one definition of "internal" and one of "who".
// ---------------------------------------------------------------------------

import { isReviewer } from './workflowStates.js';

// The Sirius Investment Team (REVIEWER_ROLES) and administrators.
export const canSeeInternalAssessment = (actor) => Boolean(actor) && isReviewer(actor);

// Entities that hold internal AI material. They are written only by the AI
// review service; the generic entity API refuses them for everyone but a
// reviewer reading, and refuses every write.
export const INTERNAL_ENTITIES = Object.freeze(['AIReviewResult', 'AIReviewDecision']);
export const isInternalEntity = (entity) => INTERNAL_ENTITIES.includes(String(entity));

// Reviewer-written fields merged into the opportunity record.
export const INTERNAL_OPPORTUNITY_FIELDS = Object.freeze([
  'hard_filter_review', 'soft_filter_review', 'disqualifier_review',
  'scorecard', 'scorecard_override', 'sufficiency_overrides',
]);

// Blocks of the evaluated gate that are Sirius's assessment rather than the
// Preparer's own submission checks.
export const INTERNAL_GATE_BLOCKS = Object.freeze([
  'scorecard', 'soft_filters', 'hard_filters', 'disqualifiers', 'sufficiency',
  'portfolio_conflict', 'portfolio_synergy', 'mandate_fit',
]);

// Audit actions that describe internal assessment work.
const INTERNAL_ACTION_PREFIXES = ['ai_', 'hard_filter_', 'soft_filter_', 'disqualifier_', 'scorecard_', 'sufficiency_', 'screening_'];
export const isInternalAuditAction = (action) => {
  const a = String(action || '');
  return INTERNAL_ACTION_PREFIXES.some((p) => a.startsWith(p));
};

// An opportunity record as the actor may read it.
export function projectOpportunityRecord(record, actor) {
  if (!record || canSeeInternalAssessment(actor)) return record;
  const out = { ...record };
  for (const key of INTERNAL_OPPORTUNITY_FIELDS) delete out[key];
  return out;
}

// The evaluated gate as the actor may read it. A Preparer keeps every block that
// checks their own submission (missing items, gates, attestations, documents,
// financial checks); the Sirius assessment blocks are removed.
export function projectGate(gate, actor) {
  if (!gate || canSeeInternalAssessment(actor)) return gate;
  const out = { ...gate };
  for (const key of INTERNAL_GATE_BLOCKS) out[key] = null;
  return out;
}

export function projectAuditEvents(events, actor) {
  if (canSeeInternalAssessment(actor)) return events;
  return (events || []).filter((e) => !isInternalAuditAction(e.action));
}

export default {
  canSeeInternalAssessment, INTERNAL_ENTITIES, isInternalEntity, INTERNAL_OPPORTUNITY_FIELDS,
  INTERNAL_GATE_BLOCKS, isInternalAuditAction, projectOpportunityRecord, projectGate, projectAuditEvents,
};
