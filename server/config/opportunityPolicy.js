// Write policy for opportunity records through the generic entities API
// (BRD v2 WF-01 "only permitted transitions possible", INT-09 attestations,
// PLT-02 isolation, AUD-01). Pure: no database, no Express.
//
// The generic PUT/POST /api/entities/DealOpportunity routes used to accept any
// field, so a preparer could move a deal past Gate 1 by writing `status`, write
// a reviewer's scorecard, edit figures after the CEO and CFO attested, or move
// the record to another subsidiary. These rules close that:
//   - system-managed fields can only be written by their own endpoints;
//   - the owning organisation never changes;
//   - only the producing layer edits, and only in an editable state;
//   - a material change after attestation clears the attestations, so the CEO
//     and CFO re-confirm what is actually submitted.
// A patch that re-sends unchanged values is accepted as a no-op, because the
// form posts the whole record on every save.

import { EDITABLE_STATES, normalizeState, isProducerFor } from './workflowStates.js';

export const OPPORTUNITY_ENTITY = 'DealOpportunity';

// Fields written only by dedicated endpoints (transition, submit, attestations,
// reviewer actions, data-room link, document parsing, owner assignment).
export const SYSTEM_FIELDS = Object.freeze([
  'status', 'attestations', 'statement_model',
  'sourcing_tags', 'related_party_auto_flag', 'compressed_timeline',
  'below_floor_tag', 'below_floor_escalated', 'below_floor_escalated_at',
  'hard_filter_review', 'soft_filter_review', 'disqualifier_review',
  'scorecard', 'scorecard_override', 'sufficiency_overrides',
  'gate1_authority', 'related_party_overlay', 'legacy_status',
  'decision_reason', 'decision_reason_label', 'decision_reason_text', 'decision_reason_class',
  'decision_reason_by', 'decision_reason_at',
  'owner_org_id', 'created_by', 'updated_by', 'created_date', 'updated_date',
]);

export const SYSTEM_FIELD_PREFIXES = Object.freeze([
  'status_', 'submitted_', 'declined_', 'withdrawn_', 'returned_', 'dataroom_',
  'gate1_', 'sirius_owner', 'info_request', 'proceed_', 'hold_', 'resumed_', 'responded_',
]);

// Changing one of these does not alter what the CEO and CFO attested to.
export const NON_MATERIAL_FIELDS = Object.freeze(['owner_email']);

export function isSystemField(key) {
  return SYSTEM_FIELDS.includes(key) || SYSTEM_FIELD_PREFIXES.some((p) => key.startsWith(p));
}

function same(a, b) {
  if (a === b) return true;
  if ((a === undefined || a === null || a === '') && (b === undefined || b === null || b === '')) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function fail(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

/**
 * Sanitise a create payload. A new opportunity always starts as a draft in the
 * creator's own organisation; system fields in the payload are dropped.
 * Returns { ok, data, dropped } or a failure.
 */
export function checkCreate(payload, { actor } = {}) {
  const input = payload && typeof payload === 'object' ? payload : {};
  if (input.owner_org_id !== undefined && input.owner_org_id !== null && input.owner_org_id !== actor?.org_id
    && !isProducerFor(actor, input.owner_org_id)) {
    return fail(403, 'An opportunity can only be created for your own organisation');
  }
  const ownerOrgId = input.owner_org_id || actor?.org_id || null;
  if (!isProducerFor(actor, ownerOrgId)) {
    return fail(403, 'Only the subsidiary preparing an opportunity can create it');
  }
  const data = {};
  const dropped = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === 'id') continue;
    if (isSystemField(key)) { if (key !== 'owner_org_id') dropped.push(key); continue; }
    data[key] = value;
  }
  data.status = 'draft';
  return { ok: true, data, owner_org_id: ownerOrgId, dropped };
}

/**
 * Check an update patch against the stored record.
 * Returns { ok, patch, changed, material, clearAttestations } or a failure
 * { ok:false, status, error, fields? }.
 */
export function checkUpdate(stored, patch, { actor, ownerOrgId } = {}) {
  const before = stored && typeof stored === 'object' ? stored : {};
  const input = patch && typeof patch === 'object' ? patch : {};
  const changed = Object.keys(input).filter((k) => k !== 'id' && !same(before[k], input[k]));

  if (input.owner_org_id !== undefined && !same(input.owner_org_id, ownerOrgId)) {
    return fail(403, 'The owning organisation of an opportunity cannot be changed', { fields: ['owner_org_id'] });
  }
  const systemChanged = changed.filter((k) => k !== 'owner_org_id' && isSystemField(k));
  if (systemChanged.length) {
    return fail(409, 'These fields are managed by the workflow and cannot be edited directly: ' + systemChanged.join(', ')
      + (systemChanged.includes('status') ? '. Use the workflow actions to move the opportunity.' : ''), { fields: systemChanged });
  }
  const userChanged = changed.filter((k) => k !== 'owner_org_id');
  if (!userChanged.length) return { ok: true, patch: {}, changed: [], material: false, clearAttestations: false };

  if (!isProducerFor(actor, ownerOrgId)) {
    return fail(403, 'Only the owning subsidiary can edit this opportunity');
  }
  const state = normalizeState(before.status);
  if (!EDITABLE_STATES.includes(state)) {
    return fail(409, 'The opportunity is locked while it is ' + state.replace(/_/g, ' ')
      + '. It can be edited as a draft or when Sirius requests information.', { state });
  }
  const clean = Object.fromEntries(userChanged.map((k) => [k, input[k]]));
  const material = userChanged.some((k) => !NON_MATERIAL_FIELDS.includes(k));
  const attested = Boolean(before.attestations && typeof before.attestations === 'object'
    && Object.keys(before.attestations).length > 0);
  return { ok: true, patch: clean, changed: userChanged, material, clearAttestations: material && attested };
}

/** Deleting is allowed for a producer's draft only; submitted records are history. */
export function checkDelete(stored, { actor, ownerOrgId } = {}) {
  if (!isProducerFor(actor, ownerOrgId)) return fail(403, 'Only the owning subsidiary can delete this opportunity');
  const state = normalizeState(stored?.status);
  if (state !== 'draft') {
    return fail(409, 'A submitted opportunity cannot be deleted; withdraw it instead so the history is kept', { state });
  }
  return { ok: true };
}

export default { OPPORTUNITY_ENTITY, SYSTEM_FIELDS, SYSTEM_FIELD_PREFIXES, isSystemField, checkCreate, checkUpdate, checkDelete };
