import crypto from 'node:crypto';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { canViewOrg } from './rbac.js';
import { loadDoaConfig } from './doa.js';
import { resolveAuthority } from './config/doa.js';
import { decisionOverlay } from './relatedParty.js';
import { loadDecisionReasonConfig } from './decisionReasons.js';
import { recordDecisionReason } from './config/decisionReasons.js';
import { insertThread, notifyThreadOpened } from './qa.js';
import { notify } from './notify.js';
import {
  STATE_LABELS, SUBMIT_CHAIN, normalizeState, isKnownState, findTransition, actorMayTake, isReviewer,
} from './config/workflowStates.js';

// ---------------------------------------------------------------------------
// Opportunity lifecycle engine (BRD v2 WF-01, WF-04, WF-05, WF-06, WF-08,
// INT-13, SCR-09).
//
// Every state change happens inside one database transaction that holds a row
// lock on the opportunity, so two people acting at once cannot both succeed,
// and the state, its transition history row and its audit row commit together
// or not at all. Permission is checked before input is validated, so a person
// who may not act gets 403 rather than a hint about what a valid request looks
// like. Notifications are sent only after the commit.
// ---------------------------------------------------------------------------

export const OPPORTUNITY_ENTITY = 'DealOpportunity';
export const SYSTEM_ACTOR = Object.freeze({ id: 'system', email: 'system', full_name: 'DealForge', roles: [] });
const uuid = () => crypto.randomUUID();

function httpError(status, message, data) {
  const e = new Error(message);
  e.status = status;
  if (data) e.data = data;
  return e;
}

/**
 * Run `fn(client, row)` in a transaction holding a FOR UPDATE lock on the
 * opportunity row. Commits on success, rolls back on any throw.
 */
export async function withLockedOpportunity(id, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false FOR UPDATE',
      [OPPORTUNITY_ENTITY, id]
    );
    if (!rows[0]) throw httpError(404, 'Opportunity not found');
    const out = await fn(client, rows[0]);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record one or more consecutive state steps on a locked row: merge `patch`
 * and the final state into the record, write one pipeline_transition row and
 * one audit row per step. Each step is { from, to, actor, comment, reasonCode,
 * reasonText }. Returns the merged data.
 */
export async function recordSteps(client, row, steps, { patch = {}, actor } = {}) {
  const final = steps[steps.length - 1].to;
  const now = new Date().toISOString();
  const statePatch = { ...patch, status: final, status_entered_at: now, status_changed_by: actor?.email || 'system' };
  const { rowCount } = await client.query(
    'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
    [OPPORTUNITY_ENTITY, row.id, JSON.stringify(statePatch), actor?.email || 'system']
  );
  if (rowCount !== 1) throw httpError(409, 'The opportunity changed while this action was being saved; reload and try again');
  for (const step of steps) {
    const who = step.actor || actor || SYSTEM_ACTOR;
    await client.query(
      'INSERT INTO pipeline_transition (id, opportunity_id, owner_org_id, from_state, to_state, actor_email, comment, reason_code, reason_text, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, clock_timestamp())',
      [uuid(), row.id, row.owner_org_id, step.from, step.to, who.email, step.comment || null, step.reasonCode || null, step.reasonText || null]
    );
    await writeAudit({
      client,
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: who.id === 'system' ? 'transition_auto' : 'transition',
      actor: who, orgId: row.owner_org_id,
      before: { status: step.from },
      after: { status: step.to, reason_code: step.reasonCode || null, reason_text: step.reasonText || null },
      comment: step.comment || (who.id === 'system' ? 'Automatic step: ' + STATE_LABELS[step.to] : null),
    });
  }
  return { ...(row.data || {}), ...statePatch };
}

/**
 * The steps submit records: the producer's draft -> submitted, then the three
 * automatic steps to Screening Review (completeness check and initial screen
 * have already passed by the time this is called).
 */
export function submitSteps(fromState, actor, { comment = null } = {}) {
  const steps = [{ from: normalizeState(fromState), to: SUBMIT_CHAIN[0], actor, comment }];
  for (let i = 1; i < SUBMIT_CHAIN.length; i += 1) {
    steps.push({ from: SUBMIT_CHAIN[i - 1], to: SUBMIT_CHAIN[i], actor: SYSTEM_ACTOR });
  }
  return steps;
}

// Hooks run inside every submit transaction (e.g. the Sirius owner assignment,
// WF-02) and after it commits (its notification). Registered by modules that
// cannot be imported here without a cycle. An inTransaction hook receives
// { client, row, actor, gate } and returns fields to merge into the record.
export const submitHooks = { inTransaction: [], afterCommit: [] };
export function onSubmit({ inTransaction = null, afterCommit = null } = {}) {
  if (inTransaction) submitHooks.inTransaction.push(inTransaction);
  if (afterCommit) submitHooks.afterCommit.push(afterCommit);
}

export async function runAfterSubmit(args) {
  for (const hook of submitHooks.afterCommit) {
    await Promise.resolve().then(() => hook(args)).catch((err) => console.warn('[submit] hook failed:', err.message));
  }
}

/**
 * Submit without the interactive gate, for trusted loaders only: the sample
 * seed and the admin bulk import of deals already in flight (INTG-03). The
 * same steps and audit rows are recorded as an interactive submit.
 */
export async function systemSubmit(opportunityId, actor, { comment = null } = {}) {
  return withLockedOpportunity(opportunityId, async (client, row) => {
    const state = normalizeState(row.data?.status);
    if (state !== 'draft') throw httpError(409, 'Only a draft opportunity can be submitted', { state });
    const now = new Date().toISOString();
    const patch = { submitted_at: now, submitted_by: actor.email };
    for (const hook of submitHooks.inTransaction) Object.assign(patch, await hook({ client, row, actor, gate: null }) || {});
    const merged = await recordSteps(client, row, submitSteps(state, actor, { comment }), { patch, actor });
    await writeAudit({ client, entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'submit', actor, orgId: row.owner_org_id,
      before: { status: state }, after: { status: merged.status }, comment });
    return { ...row, data: merged };
  }).then(async (row) => { await runAfterSubmit({ row, actor, gate: null }); return row; });
}

function addDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.max(1, Number(days) || 5));
  return d.toISOString();
}

async function slaDays(state, fallback) {
  try {
    const { rows } = await pool.query('SELECT days FROM pipeline_sla WHERE state = $1', [state]);
    return rows[0]?.days ?? fallback;
  } catch { return fallback; }
}

// Who in the owning subsidiary is expected to answer an information request.
function requestOwner(data) {
  return (data.owner_email || data.submitted_by || '').toLowerCase() || null;
}

/**
 * Move an opportunity to `toState` (not submit - that has its own endpoint).
 *
 * options:
 *   actor, comment, reasonCode, reasonText
 *   question { subject, body, due_at? }   for an information request
 *   beforeRespond(row) -> { ok, status?, error?, data? }   checks the producer's
 *       response is complete (gate re-check, every request answered)
 */
export async function transitionOpportunity(opportunityId, toState, {
  actor, comment, reasonCode, reasonText, question = null, beforeRespond = null,
} = {}) {
  if (!isKnownState(toState)) throw httpError(400, 'Unknown pipeline state: ' + toState);
  const note = typeof comment === 'string' ? comment.trim() : '';
  const after = [];

  const result = await withLockedOpportunity(opportunityId, async (client, row) => {
    if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
      throw httpError(403, 'Not permitted to view this opportunity');
    }
    const data = row.data || {};
    const from = normalizeState(data.status);
    const rule = findTransition(from, toState);
    if (!rule) {
      throw httpError(409, 'Invalid transition ' + from + ' -> ' + toState, { from, to: toState });
    }
    if (rule.action === 'submit') throw httpError(409, 'Use Submit for screening to submit a draft');

    // 1. Permission (before any input validation).
    let doa = null;
    if (rule.by === 'decider') {
      const doaConfig = await loadDoaConfig();
      doa = resolveAuthority(doaConfig, { amountAed: data.total_commitment_aed, roles: actor.roles || [], gate: doaConfig.gate });
    }
    const may = actorMayTake(rule, actor, row.owner_org_id, { doa });
    if (!may.allowed) {
      const missing = rule.by === 'decider' && isReviewer(actor) ? ['doa_authority'] : [];
      throw httpError(403, rule.gate1 && missing.length ? 'Not permitted to take the Gate-1 decision: ' + doa.reason : may.reason,
        { doa, missing });
    }
    let overlay = null;
    if (rule.gate1) {
      const rp = await decisionOverlay({ id: row.id, data }, actor);
      if (rp.overlay.flagged) {
        overlay = rp.overlay;
        if (!rp.decision.allowed) {
          throw httpError(403, 'The related-party overlay blocks the Gate-1 decision: ' + rp.decision.reason,
            { related_party: rp.overlay, conflicted: rp.decision.conflicted === true, missing: ['independent_signoff'] });
        }
      }
    }

    // 2. Input.
    const now = new Date().toISOString();
    let reasonFields = {};
    if (rule.reason_class) {
      const recorded = recordDecisionReason(await loadDecisionReasonConfig(), {
        decisionClass: rule.reason_class,
        code: reasonCode,
        text: reasonText !== undefined && reasonText !== null ? reasonText : comment,
        actor, at: now,
      });
      if (!recorded.ok) throw httpError(400, recorded.errors.join(' '), { missing: ['reason_code'] });
      reasonFields = recorded.data;
    }
    if ((rule.requires || []).includes('comment') && !note) {
      throw httpError(400, 'A comment is required to ' + rule.label.toLowerCase(), { missing: ['comment'] });
    }
    let q = null;
    if ((rule.requires || []).includes('question')) {
      const subject = String(question?.subject || '').trim();
      const body = String(question?.body || '').trim();
      if (!subject || !body) {
        throw httpError(400, 'An information request needs a subject and the question itself', { missing: ['question'] });
      }
      q = { subject, body, due_at: question?.due_at || null };
    }
    if (rule.action === 'respond' && beforeRespond) {
      const check = await beforeRespond(row, client);
      if (!check.ok) throw httpError(check.status || 422, check.error, check.data);
    }

    // 3. Apply.
    const patch = { ...reasonFields };
    if (rule.action === 'decline') Object.assign(patch, { declined_reason: reasonFields.decision_reason_text || note || null, declined_at: now, declined_by: actor.email });
    if (rule.action === 'withdraw') Object.assign(patch, { withdrawn_reason: reasonFields.decision_reason_text || note || null, withdrawn_at: now, withdrawn_by: actor.email });
    if (rule.action === 'proceed') Object.assign(patch, { proceed_at: now, proceed_by: actor.email });
    if (rule.action === 'hold') Object.assign(patch, { hold_reason: reasonFields.decision_reason_text || note || null, hold_at: now, hold_by: actor.email });
    if (rule.action === 'resume') Object.assign(patch, { resumed_at: now, resumed_by: actor.email });
    if (rule.action === 'respond') Object.assign(patch, { responded_at: now, responded_by: actor.email });
    if (doa && rule.gate1) {
      patch.gate1_authority = {
        gate: doa.gate, tier: doa.tier.key, tier_label: doa.tier.label,
        band_min_aed: doa.tier.min_aed, band_max_aed: doa.tier.max_aed,
        responsibilities: doa.tier.responsibilities, decision_roles: doa.tier.decision_roles,
        accountable_party: doa.accountable_party, amount_aed: doa.amount_aed, version: doa.version,
        decided_by: actor.email, decided_at: now, decision: rule.action,
      };
    }
    if (overlay) {
      patch.related_party_overlay = {
        gate: overlay.gate, status: overlay.status, version: overlay.version,
        signed_off_by: overlay.signed_off_by || null, conflict_excluded: overlay.conflicted === true,
        decided_by: actor.email, decided_at: now,
      };
    }
    let thread = null;
    if (q) {
      const due = q.due_at ? new Date(q.due_at) : null;
      const dueAt = due && !Number.isNaN(due.getTime()) ? due.toISOString() : addDays(await slaDays('information_requested', 5));
      const owner = requestOwner(data);
      const inserted = await insertThread(client, row, {
        subject: q.subject, body: q.body, requiresResponse: true, visibility: 'shared',
        participants: [owner, data.submitted_by].filter(Boolean), kind: 'information_request', dueAt, ownerEmail: owner,
      }, actor);
      thread = inserted.thread;
      Object.assign(patch, { info_request_thread_id: thread.id, info_requested_at: now, info_requested_by: actor.email, info_request_due_at: dueAt });
      await writeAudit({ client, entity: 'qa_thread', entityId: thread.id, action: 'thread_open', actor, orgId: row.owner_org_id, after: { subject: q.subject, kind: 'information_request', due_at: dueAt } });
      after.push(() => notifyThreadOpened({ thread, people: inserted.people, opp: row, actor }));
    }

    const merged = await recordSteps(client, row, [{
      from, to: toState, actor, comment: note || null,
      reasonCode: reasonFields.decision_reason || null, reasonText: reasonFields.decision_reason_text || null,
    }], { patch, actor });
    if (patch.gate1_authority) {
      await writeAudit({ client, entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'gate1_authority_applied', actor, orgId: row.owner_org_id,
        after: { tier: doa.tier.key, decision_roles: doa.tier.decision_roles, amount_aed: doa.amount_aed, decision: rule.action } });
    }
    if (patch.related_party_overlay) {
      await writeAudit({ client, entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'related_party_overlay_applied', actor, orgId: row.owner_org_id,
        after: { status: overlay.status, signed_off_by: overlay.signed_off_by || null } });
    }
    return { row: { ...row, data: merged }, from, rule, doa, overlay, reasonFields, thread };
  });

  for (const fn of after) await Promise.resolve().then(fn).catch((err) => console.warn('[lifecycle] notify failed:', err.message));
  await notifyDecision(result, actor).catch((err) => console.warn('[lifecycle] notify failed:', err.message));

  return {
    ok: true,
    opportunity_id: result.row.id,
    from_state: result.from,
    state: toState,
    state_label: STATE_LABELS[toState],
    action: result.rule.action,
    reason_code: result.reasonFields.decision_reason || null,
    reason_label: result.reasonFields.decision_reason_label || null,
    doa: result.doa || null,
    related_party: result.overlay || null,
    thread_id: result.thread?.id || null,
  };
}

// Tell the subsidiary about every Sirius move, and the Sirius owner about every
// subsidiary move (NTF-01). The information request has its own thread notice.
async function notifyDecision(result, actor) {
  const { row, rule } = result;
  const data = row.data || {};
  if (rule.action === 'request_information') return;
  const name = data.opportunity_name || row.id;
  const subsidiaryPeople = [data.owner_email, data.submitted_by].filter(Boolean);
  const siriusPeople = [data.sirius_owner_email].filter(Boolean);
  const to = rule.by === 'producer' ? siriusPeople : subsidiaryPeople;
  if (!to.length) return;
  const decision = ['proceed', 'hold', 'decline'].includes(rule.action);
  await notify({
    to,
    kind: decision ? 'decision_made' : 'state_changed',
    subject: name + ': ' + STATE_LABELS[rule.to],
    body: (actor.full_name || actor.email) + ' moved ' + name + ' to ' + STATE_LABELS[rule.to]
      + (result.reasonFields.decision_reason_label ? ' (' + result.reasonFields.decision_reason_label + ')' : '') + '.',
    entity: OPPORTUNITY_ENTITY, entityId: row.id, orgId: row.owner_org_id, actor,
    channels: decision ? ['in_app', 'email'] : ['in_app'],
  });
}

export default { withLockedOpportunity, recordSteps, submitSteps, systemSubmit, transitionOpportunity, onSubmit, SYSTEM_ACTOR };
