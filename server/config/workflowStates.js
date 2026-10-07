// Phase 1 opportunity lifecycle (BRD v2 WF-01, WF-05, WF-06, WF-08, INT-13, SCR-09).
//
// The single source of truth for states, labels, permitted transitions, who may
// take each transition, final states, default SLAs and the mapping from the
// legacy (pre-BRD v2) state names. Pure: no database, no Express, so every rule
// here is unit tested in isolation (server/tests/workflowStates.test.js).
//
//   Draft -> Submitted -> Completeness Check -> Initial Screening -> Screening Review
//   Screening Review <-> Information Requested
//   Screening Review -> Proceed to Gate 2 | On Hold | Declined   (Gate-1 decision)
//   On Hold -> Screening Review | Declined | Information Requested
//   any open state before the decision -> Withdrawn              (INT-13)
//
// Submitted, Completeness Check and Initial Screening are automatic: the submit
// endpoint passes through them in one transaction, recording each step, so a
// record never rests in them. No automatic step can reach a decision state
// (SCR-09 human-in-the-loop).

export const STATES = Object.freeze([
  { key: 'draft', label: 'Draft', layer: 'subsidiary', final: false, system: false },
  { key: 'submitted', label: 'Submitted', layer: 'system', final: false, system: true },
  { key: 'completeness_check', label: 'Completeness Check', layer: 'system', final: false, system: true },
  { key: 'initial_screening', label: 'Initial Screening', layer: 'system', final: false, system: true },
  { key: 'screening_review', label: 'Screening Review', layer: 'sirius', final: false, system: false },
  { key: 'information_requested', label: 'Information Requested', layer: 'subsidiary', final: false, system: false },
  { key: 'on_hold', label: 'On Hold', layer: 'sirius', final: false, system: false },
  { key: 'proceed_to_gate2', label: 'Proceed to Gate 2', layer: 'sirius', final: true, system: false },
  { key: 'declined', label: 'Declined', layer: 'sirius', final: true, system: false },
  { key: 'withdrawn', label: 'Withdrawn', layer: 'subsidiary', final: true, system: false },
]);

export const STATE_KEYS = Object.freeze(STATES.map((s) => s.key));
export const STATE_LABELS = Object.freeze(Object.fromEntries(STATES.map((s) => [s.key, s.label])));
export const FINAL_STATES = Object.freeze(STATES.filter((s) => s.final).map((s) => s.key));
export const SYSTEM_STATES = Object.freeze(STATES.filter((s) => s.system).map((s) => s.key));

// States in which the producing layer may edit the record, its documents and
// its attestations. Everywhere else the record is locked.
export const EDITABLE_STATES = Object.freeze(['draft', 'information_requested']);

// States the screening board shows as columns, in workflow order.
export const BOARD_STATES = Object.freeze([
  'screening_review', 'information_requested', 'on_hold', 'proceed_to_gate2', 'declined', 'withdrawn',
]);

// Open pipeline states (submitted and not yet decided or withdrawn).
export const OPEN_STATES = Object.freeze(['screening_review', 'information_requested', 'on_hold']);

// The automatic chain submit walks through, in order.
export const SUBMIT_CHAIN = Object.freeze(['submitted', 'completeness_check', 'initial_screening', 'screening_review']);

// Who may take a transition:
//   producer - the owning subsidiary's preparers (fill roles, own org)
//   reviewer - the Sirius investment team
//   decider  - a reviewer who also holds the Gate-1 Delegation of Authority
//              for the ticket size (WF-08)
//   system   - the platform itself (never a person)
export const ACTOR_KINDS = Object.freeze(['producer', 'reviewer', 'decider', 'system']);

export const PRODUCER_ROLES = Object.freeze(['subsidiary_deal_lead', 'subsidiary_cfo', 'subsidiary_ceo']);
export const REVIEWER_ROLES = Object.freeze([
  'sirius_deal_lead', 'sirius_vertical_head', 'cio', 'leadership', 'cluster_head',
]);

export const TRANSITIONS = Object.freeze([
  { from: 'draft', to: 'submitted', by: 'producer', action: 'submit', label: 'Submit for screening' },
  { from: 'submitted', to: 'completeness_check', by: 'system', action: 'auto' },
  { from: 'completeness_check', to: 'initial_screening', by: 'system', action: 'auto' },
  { from: 'initial_screening', to: 'screening_review', by: 'system', action: 'auto' },

  { from: 'screening_review', to: 'information_requested', by: 'reviewer', action: 'request_information',
    label: 'Request information', requires: ['question'] },
  { from: 'on_hold', to: 'information_requested', by: 'reviewer', action: 'request_information',
    label: 'Request information', requires: ['question'] },
  { from: 'information_requested', to: 'screening_review', by: 'producer', action: 'respond',
    label: 'Submit response' },

  { from: 'screening_review', to: 'proceed_to_gate2', by: 'decider', action: 'proceed',
    label: 'Proceed to Gate 2', reason_class: 'proceed', gate1: true },
  { from: 'screening_review', to: 'on_hold', by: 'decider', action: 'hold',
    label: 'Put on hold', reason_class: 'hold', gate1: true },
  { from: 'screening_review', to: 'declined', by: 'decider', action: 'decline',
    label: 'Decline', reason_class: 'decline', gate1: true },
  { from: 'on_hold', to: 'screening_review', by: 'decider', action: 'resume',
    label: 'Resume review', requires: ['comment'] },
  { from: 'on_hold', to: 'declined', by: 'decider', action: 'decline',
    label: 'Decline', reason_class: 'decline', gate1: true },

  { from: 'screening_review', to: 'withdrawn', by: 'producer', action: 'withdraw',
    label: 'Withdraw', reason_class: 'withdraw' },
  { from: 'information_requested', to: 'withdrawn', by: 'producer', action: 'withdraw',
    label: 'Withdraw', reason_class: 'withdraw' },
  { from: 'on_hold', to: 'withdrawn', by: 'producer', action: 'withdraw',
    label: 'Withdraw', reason_class: 'withdraw' },
]);

// Legacy state names from the pre-BRD v2 build. Records still carrying them are
// read as their BRD v2 equivalent; `npm run migrate:states` (server/migrateStates.js) persists it.
export const LEGACY_STATE_MAP = Object.freeze({
  submission: 'screening_review',
  screening: 'screening_review',
  returned: 'information_requested',
  refinement: 'proceed_to_gate2',
  approval: 'proceed_to_gate2',
});

// Default SLA per state, in days (WF-02). The BRD suggests 48-72 hours for
// Gate 1; values are admin-editable in pipeline_sla and this is only the seed.
export const DEFAULT_SLA = Object.freeze([
  { state: 'screening_review', label: 'Screening Review', days: 3, sort_order: 10 },
  { state: 'information_requested', label: 'Information Requested', days: 5, sort_order: 20 },
  { state: 'on_hold', label: 'On Hold', days: 30, sort_order: 30 },
]);

export function normalizeState(state) {
  if (state === undefined || state === null || state === '') return 'draft';
  const key = String(state);
  return LEGACY_STATE_MAP[key] || key;
}

export function isKnownState(state) {
  return STATE_KEYS.includes(state);
}

export function isFinalState(state) {
  return FINAL_STATES.includes(normalizeState(state));
}

export function isEditableState(state) {
  return EDITABLE_STATES.includes(normalizeState(state));
}

export function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === normalizeState(from) && t.to === to) || null;
}

export function transitionsFrom(state) {
  return TRANSITIONS.filter((t) => t.from === normalizeState(state));
}

// The transition map in the { from: [to, ...] } shape the API has always served.
export function transitionMap() {
  const map = Object.fromEntries(STATE_KEYS.map((s) => [s, []]));
  for (const t of TRANSITIONS) map[t.from].push(t.to);
  return map;
}

function rolesOf(actor) {
  return Array.isArray(actor?.roles) ? actor.roles : [];
}

export function isAdmin(actor) {
  return rolesOf(actor).includes('admin');
}

// A Sirius investment-team reviewer (admin counts, as break-glass).
export function isReviewer(actor) {
  return isAdmin(actor) || rolesOf(actor).some((r) => REVIEWER_ROLES.includes(r));
}

// A preparer in the owning subsidiary (own org, a descendant, or an explicit
// grant), holding a fill role. Sirius roles that can merely read every org are
// not producers: the subsidiary owns its own record (segregation of duties).
export function isProducerFor(actor, ownerOrgId) {
  if (!actor || !ownerOrgId) return false;
  if (isAdmin(actor)) return true;
  if (!rolesOf(actor).some((r) => PRODUCER_ROLES.includes(r))) return false;
  if (actor.org_id === ownerOrgId) return true;
  if ((actor.descendant_ids || []).includes(ownerOrgId)) return true;
  if ((actor.granted_org_ids || []).includes(ownerOrgId)) return true;
  return false;
}

/**
 * Who may take transition `rule` on a record owned by `ownerOrgId`.
 * `doa` is the resolved Gate-1 authority for the ticket ({ authorized, reason }),
 * needed only for decider transitions. Returns { allowed, reason }.
 */
export function actorMayTake(rule, actor, ownerOrgId, { doa = null } = {}) {
  if (!rule) return { allowed: false, reason: 'That move is not part of the workflow.' };
  switch (rule.by) {
    case 'system':
      return { allowed: false, reason: 'This step is taken automatically by the platform.' };
    case 'producer':
      return isProducerFor(actor, ownerOrgId)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Only the owning subsidiary may ' + (rule.label || rule.action).toLowerCase() + '.' };
    case 'reviewer':
      return isReviewer(actor)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Only the Sirius investment team may ' + (rule.label || rule.action).toLowerCase() + '.' };
    case 'decider': {
      if (!isReviewer(actor)) {
        return { allowed: false, reason: 'Only the Sirius investment team takes the screening decision.' };
      }
      if (!doa) return { allowed: false, reason: 'The Delegation of Authority for this ticket could not be resolved.' };
      return doa.authorized
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Not delegated: ' + doa.reason };
    }
    default:
      return { allowed: false, reason: 'Unknown actor kind.' };
  }
}

/**
 * The moves this actor can see for a record in `state`. Each entry says whether
 * it is allowed, and if not, why - so the UI can show a disabled control that
 * explains the rule instead of hiding it. Producer moves are only listed for
 * producers and reviewer/decider moves only for reviewers, so nobody is shown a
 * control that belongs to the other layer.
 *
 * `blocks` lets the caller add business blocks per action (e.g. a related-party
 * deal awaiting the independent sign-off): { [action]: reason }.
 */
export function availableActions({ state, actor, ownerOrgId, doa = null, blocks = {} }) {
  const producer = isProducerFor(actor, ownerOrgId);
  const reviewer = isReviewer(actor);
  const out = [];
  for (const rule of transitionsFrom(state)) {
    if (rule.by === 'system' || rule.action === 'submit') continue;
    if (rule.by === 'producer' && !producer) continue;
    if ((rule.by === 'reviewer' || rule.by === 'decider') && !reviewer) continue;
    const may = actorMayTake(rule, actor, ownerOrgId, { doa });
    const blocked = may.allowed ? (blocks[rule.action] || null) : null;
    out.push({
      action: rule.action,
      to: rule.to,
      to_label: STATE_LABELS[rule.to],
      label: rule.label || STATE_LABELS[rule.to],
      by: rule.by,
      reason_class: rule.reason_class || null,
      requires: rule.requires || [],
      gate1: Boolean(rule.gate1),
      allowed: may.allowed && !blocked,
      blocked_reason: may.allowed ? blocked : may.reason,
    });
  }
  return out;
}

// May `actor` record a screening review, scorecard or override on a record in
// `state` owned by `ownerOrgId`? The Sirius team (or an admin), never the
// subsidiary that prepared it, and only while it is with Sirius (SCR-09).
export function mayReview(actor, ownerOrgId, state) {
  if (!isReviewer(actor)) return false;
  if (!isAdmin(actor) && isProducerFor(actor, ownerOrgId)) return false;
  return OPEN_STATES.includes(normalizeState(state));
}

// Who is expected to act next on a record in `state` (shown on cards and used
// by the My Work queue).
export function nextActorFor(state) {
  const s = normalizeState(state);
  if (s === 'draft' || s === 'information_requested') return 'subsidiary';
  if (OPEN_STATES.includes(s)) return 'sirius';
  return null;
}

export default {
  mayReview,
  STATES, STATE_KEYS, STATE_LABELS, FINAL_STATES, SYSTEM_STATES, EDITABLE_STATES, BOARD_STATES, OPEN_STATES,
  SUBMIT_CHAIN, TRANSITIONS, LEGACY_STATE_MAP, DEFAULT_SLA, PRODUCER_ROLES, REVIEWER_ROLES,
  normalizeState, isKnownState, isFinalState, isEditableState, findTransition, transitionsFrom, transitionMap,
  isAdmin, isReviewer, isProducerFor, actorMayTake, availableActions, nextActorFor,
};
