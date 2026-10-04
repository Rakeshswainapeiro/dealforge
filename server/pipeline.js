import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, canActAtStage, isCrossOrgReader } from './rbac.js';
import { descendantIds } from './org.js';
import { evaluateAlignment } from './themes.js';
import { getOrganization } from './org.js';
import { listDocuments, evaluateGate, loadQualityScoreConfig } from './gate.js';
import { buildSiriusMemo, missingMemoFields } from './config/siriusMemo.js';
import { packSiriusMemo } from './siriusMemoDocx.js';
import { prepareDocxVerification } from './memoVerification.js';
import { loadDataSourceConfig } from './dataSource.js';
import { buildSourceMap } from './config/dataSource.js';
import { duplicateCountMap, duplicateMatchesFor } from './duplicates.js';
import { evaluateScreeningPanel } from './config/screeningPanel.js';
import { loadPortfolioRegisterConfig } from './portfolioRegister.js';
import { loadStrategyCorpus, getLatestStrategyProfile, recordScreeningSnapshot } from './strategy.js';
import { loadDecisionReasonConfig } from './decisionReasons.js';
import { recordDecisionReason, decisionClassForState } from './config/decisionReasons.js';
import { loadDoaConfig } from './doa.js';
import { resolveAuthority } from './config/doa.js';
import { decisionOverlay } from './relatedParty.js';
import { loadReviewsFor, loadRelatedPartyConfig as loadRelatedPartyConfigForCards } from './relatedParty.js';
import { resolveOverlayStatus as resolveRpOverlay } from './config/relatedParty.js';
import { buildDataroomLinkRecord, describeDataroomLink, DATAROOM_LINK_VERSION, DATAROOM_PROVIDERS } from './config/dataroomLink.js';

// ---------------------------------------------------------------------------
// Screening pipeline & board (E6 / REQ-PIPE-01, REQ-DASH-02/03, REQ-FLOW-03).
//
// Canonical route: submission -> screening -> refinement -> approval, with
// returned / declined branches. Every transition is an audited workflow step
// (REQ-PIPE-01) and carries SLA targets per state (REQ-GATE-06, partial).
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

export const PIPELINE_STATES = ['draft', 'submission', 'screening', 'refinement', 'approval', 'returned', 'declined', 'withdrawn'];

// Allowed transitions. Resubmission of a returned item goes back to submission.
export const TRANSITIONS = {
  draft: ['submission'],
  submission: ['screening', 'returned', 'declined', 'withdrawn'],
  screening: ['refinement', 'returned', 'declined'],
  refinement: ['approval', 'returned', 'declined'],
  approval: ['returned', 'declined'],
  returned: ['submission', 'withdrawn'],
  declined: [],
  withdrawn: [],
};

// Which stage action each target state corresponds to (REQ-WF-02).
const STATE_ACTION = {
  submission: 'fill',
  screening: 'review',
  refinement: 'review',
  approval: 'approve',
  returned: 'review',
  declined: 'approve',
  withdrawn: 'fill',
};

// The Gate-1 screening decision (WF-01, WF-08): the transitions that settle the
// initial screen - progressing a reviewed item to Gate 2, or declining it. The
// Delegation of Authority matrix, not the generic stage action, governs who may
// take these; every other transition is routed by role as before.
export const GATE1_DECISIONS = {
  submission: ['declined'],
  screening: ['refinement', 'declined'],
};

function isGate1Decision(fromState, toState) {
  return (GATE1_DECISIONS[fromState] || []).includes(toState);
}

export const STATE_LABELS = {
  draft: 'Draft',
  submission: 'Submission',
  screening: 'Screening',
  refinement: 'Refinement',
  approval: 'Approval',
  returned: 'Returned',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

// Indicative SLA targets per state in business days (plan §16 — to be confirmed).
export const DEFAULT_SLA = [
  { state: 'submission', label: 'Submission', days: 3, sort_order: 10 },
  { state: 'screening', label: 'Screening', days: 5, sort_order: 20 },
  { state: 'refinement', label: 'Refinement', days: 10, sort_order: 30 },
  { state: 'approval', label: 'Approval', days: 10, sort_order: 40 },
  { state: 'returned', label: 'Returned', days: 5, sort_order: 50 },
];

export async function seedPipelineSla({ force = false } = {}) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM pipeline_sla');
  if (rows[0].n > 0 && !force) return { skipped: true, count: rows[0].n };
  for (const s of DEFAULT_SLA) {
    await pool.query(
      `INSERT INTO pipeline_sla (state, label, days, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (state) DO UPDATE SET label = EXCLUDED.label, days = EXCLUDED.days,
         sort_order = EXCLUDED.sort_order`,
      [s.state, s.label, s.days, s.sort_order]
    );
  }
  return { skipped: false, count: DEFAULT_SLA.length };
}

export async function getSlaTargets() {
  const { rows } = await pool.query('SELECT * FROM pipeline_sla ORDER BY sort_order');
  const byState = {};
  for (const r of rows) byState[r.state] = r;
  return byState;
}

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((to.getTime() - start) / 86400000));
}

function opportunityToCard(row, slaByState, actor = null, doaConfig = null, rpConfig = null, rpReview = null) {
  const data = row.data || {};
  const state = data.status || 'draft';
  const since = data.status_entered_at || data.submitted_at || row.updated_date;
  const ageDays = daysBetween(since);
  const sla = slaByState[state] || null;
  const target = sla?.days ?? null;
  // The preparer's producing layer may withdraw an active submission (INT-13).
  // The button is only offered where the server would allow it, so the UI never
  // promises an action the route would reject.
  const canWithdraw = Boolean(
    actor &&
      ['submission', 'returned'].includes(state) &&
      canWriteOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })
  );
  // The Gate-1 Delegation of Authority for this item (WF-08): who owns the
  // screening decision at this ticket size, and whether this actor may take
  // it. Shown on the board so the owner is explicit, not implied.
  let doa = null;
  if (doaConfig && ['submission', 'screening'].includes(state)) {
    doa = resolveAuthority(doaConfig, { amountAed: data.total_commitment_aed, roles: actor?.roles || [], gate: doaConfig.gate });
  }
  return {
    id: row.id,
    owner_org_id: row.owner_org_id,
    opportunity_name: data.opportunity_name || '(untitled)',
    opportunity_type: data.opportunity_type || null,
    sector: data.sector || null,
    geography: data.geography || null,
    total_commitment_aed: data.total_commitment_aed ?? null,
    owner_email: data.owner_email || null,
    state,
    state_label: STATE_LABELS[state] || state,
    age_days: ageDays,
    sla_days: target,
    sla_breached: target != null && ageDays != null && ageDays > target,
    theme_exception: Boolean(data.theme_exception_reason),
    dataroom_folder: describeDataroomLink(data),
    updated_date: row.updated_date,
    // The reason a branch state carries, surfaced so the board and the retained
    // history both explain why the item left the active pipeline (INT-13).
    returned_reason: data.returned_reason || null,
    declined_reason: data.declined_reason || null,
    withdrawn_reason: data.withdrawn_reason || null,
    can_withdraw: canWithdraw,
    related_party_overlay: rpConfig ? (() => { const st = resolveRpOverlay(rpConfig, rpReview || {}); return st.flagged ? { status: st.status, status_label: st.status_label, blocked: st.blocked, signed_off: st.signed_off, version: st.version, outstanding: st.outstanding } : null; })() : null,
    gate1_authority: doa
      ? {
          tier: doa.tier.key,
          tier_label: doa.tier.label,
          accountable_party: doa.accountable_party,
          decision_roles: doa.tier.decision_roles,
          responsibilities: doa.tier.responsibilities,
          version: doa.version,
          authorized: doa.authorized,
          reason: doa.reason,
        }
      : null,
  };
}

// Readable opportunities for the actor, newest first, scoped by org visibility.
async function readableOpportunities(actor, { states = null, ownerOrgId = null } = {}) {
  const params = [OPPORTUNITY_ENTITY];
  const where = ['entity = $1', 'deleted = false'];
  if (!isCrossOrgReader(actor.membership)) {
    const ids = Array.from(new Set([actor.org_id, ...actor.descendant_ids, ...actor.granted_org_ids]));
    params.push(ids);
    where.push('owner_org_id = ANY($' + params.length + ')');
  }
  if (ownerOrgId) { params.push(ownerOrgId); where.push('owner_org_id = $' + params.length); }
  if (states && states.length) { params.push(states); where.push("data->>'status' = ANY($" + params.length + ')'); }
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE ' + where.join(' AND ') + ' ORDER BY updated_date DESC LIMIT 500',
    params
  );
  return rows;
}

// Screening board: items by state with owner, age and SLA breach (E6.2).
export async function screeningBoard(actor) {
  const slaByState = await getSlaTargets();
  const doaConfig = await loadDoaConfig();
  const rpConfig = await loadRelatedPartyConfigForCards();
  const rows = await readableOpportunities(actor, { states: ['submission', 'screening', 'refinement', 'approval', 'returned', 'declined', 'withdrawn'] });
  const rpReviews = await loadReviewsFor(rows.map((r) => r.id)).catch(() => new Map());
  const cards = rows.map((r) => opportunityToCard(r, slaByState, actor, doaConfig, rpConfig, rpReviews.get(r.id)));
  // Cross-group duplicate warnings are shown to the Investment Team only
  // (INT-12): a subsidiary preparer never sees a sibling's item.
  if (isCrossOrgReader(actor.membership)) {
    const counts = await duplicateCountMap().catch(() => new Map());
    for (const card of cards) card.duplicate_warning = counts.get(card.id) || 0;
  }
  // The Gate-1 Delegation of Authority matrix the board is read against, so a
  // reviewer sees which bands exist and which one owns the decision (WF-08).
  const doa = {
    gate: doaConfig.gate,
    gate_label: doaConfig.gate_label,
    version: doaConfig.version,
    revision: doaConfig.revision,
    tiers: doaConfig.tiers.map((t) => ({
      key: t.key, label: t.label, min_aed: t.min_aed, max_aed: t.max_aed,
      responsibilities: t.responsibilities, decision_roles: t.decision_roles,
    })),
  };
  const columns = ['submission', 'screening', 'refinement', 'approval', 'returned', 'declined', 'withdrawn'].map((state) => ({
    state,
    label: STATE_LABELS[state],
    sla_days: slaByState[state]?.days ?? null,
    items: cards.filter((c) => c.state === state),
  }));
  // The related-party overlay in force (W6-03 / BRD WF-06), so the board can
  // explain a blocked screening decision and link to the overlay record.
  const relatedParty = {
    gate: rpConfig.gate,
    gate_label: rpConfig.gate_label,
    version: rpConfig.version,
    revision: rpConfig.revision,
    require_arm_length_documentation: rpConfig.require_arm_length_documentation,
    require_independent_signoff: rpConfig.require_independent_signoff,
    block_decision_without_signoff: rpConfig.block_decision_without_signoff,
    exclude_conflicted_users: rpConfig.exclude_conflicted_users,
    signoff_roles: rpConfig.signoff_roles,
  };
  return {
    columns,
    total: cards.length,
    breaches: cards.filter((c) => c.sla_breached).length,
    by_state: columns.reduce((acc, col) => { acc[col.state] = col.items.length; return acc; }, {}),
    doa,
    related_party: relatedParty,
  };
}

// "Awaiting my review" (E6.3): items whose current state maps to an action the
// actor's roles can perform.
export async function awaitingMyReview(actor) {
  const slaByState = await getSlaTargets();
  const doaConfig = await loadDoaConfig();
  const rpConfig = await loadRelatedPartyConfigForCards();
  const rows = await readableOpportunities(actor, { states: ['submission', 'screening', 'refinement', 'approval'] });
  const rpReviews = await loadReviewsFor(rows.map((r) => r.id)).catch(() => new Map());
  const cards = rows.map((r) => opportunityToCard(r, slaByState, actor, doaConfig, rpConfig, rpReviews.get(r.id)));
  const actionable = cards.filter((c) => canActAtStage(actor.membership, STATE_ACTION[c.state] || 'review'));
  return { items: actionable, total: actionable.length };
}

// Subsidiary "my opportunities & status" (E6.4).
export async function myOpportunities(actor, { orgId } = {}) {
  const slaByState = await getSlaTargets();
  const doaConfig = await loadDoaConfig();
  const rpConfig = await loadRelatedPartyConfigForCards();
  const scope = orgId || actor.org_id;
  if (scope !== actor.org_id && !canViewOrg(actor.membership, scope, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view those opportunities'); e.status = 403; throw e;
  }
  const rows = await readableOpportunities(actor, { ownerOrgId: scope });
  const rpReviews = await loadReviewsFor(rows.map((r) => r.id)).catch(() => new Map());
  const cards = rows.map((r) => opportunityToCard(r, slaByState, actor, doaConfig, rpConfig, rpReviews.get(r.id)));
  const open = cards.filter((c) => !['declined', 'withdrawn'].includes(c.state));
  return {
    org_id: scope,
    items: cards,
    total: cards.length,
    open: open.length,
    by_state: cards.reduce((acc, c) => { acc[c.state] = (acc[c.state] || 0) + 1; return acc; }, {}),
  };
}

// Rollup counts at ancestor orgs (E6.6 / REQ-FLOW-03).
export async function orgRollup(actor, { orgId } = {}) {
  const target = orgId || actor.org_id;
  if (!canViewOrg(actor.membership, target, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view that organisation'); e.status = 403; throw e;
  }
  const ids = await descendantIds(target);
  const { rows } = await pool.query(
    "SELECT owner_org_id, COALESCE(data->>'status','draft') AS state, count(*)::int AS n " +
      'FROM entity_record WHERE entity = $1 AND deleted = false AND owner_org_id = ANY($2) ' +
      "GROUP BY owner_org_id, COALESCE(data->>'status','draft')",
    [OPPORTUNITY_ENTITY, ids]
  );
  const byOrg = {};
  const total = {};
  for (const r of rows) {
    byOrg[r.owner_org_id] = byOrg[r.owner_org_id] || {};
    byOrg[r.owner_org_id][r.state] = r.n;
    total[r.state] = (total[r.state] || 0) + r.n;
  }
  return { org_id: target, descendants: ids.length, by_org: byOrg, total_by_state: total };
}

// Perform an audited state transition (E6.1).
export async function transition(opportunityId, toState, { actor, comment, reasonCode, reasonText, reasonConfig } = {}) {
  if (!PIPELINE_STATES.includes(toState)) { const e = new Error('Unknown pipeline state: ' + toState); e.status = 400; throw e; }
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, opportunityId]
  );
  const row = rows[0];
  if (!row) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this opportunity'); e.status = 403; throw e;
  }
  const data = row.data || {};
  const fromState = data.status || 'draft';
  const allowed = TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    const e = new Error('Invalid transition ' + fromState + ' -> ' + toState); e.status = 409; throw e;
  }
  const action = STATE_ACTION[toState] || 'review';
  // Delegation of Authority (WF-08): the Gate-1 screening decision - moving a
  // reviewed item on to Gate 2, or declining it - is reserved to the party the
  // ticket band names, not to the generic stage action. Everyone else is
  // refused with the band and its delegated roles so the board can explain.
  let gate1Authority = null;
  if (isGate1Decision(fromState, toState)) {
    const doaConfig = await loadDoaConfig();
    gate1Authority = resolveAuthority(doaConfig, {
      amountAed: data.total_commitment_aed,
      roles: actor.roles || [],
      gate: doaConfig.gate,
    });
    if (!gate1Authority.authorized) {
      const e = new Error('Not permitted to take the Gate-1 decision: ' + gate1Authority.reason);
      e.status = 403;
      e.data = { doa: gate1Authority, missing: ['doa_authority'] };
      throw e;
    }
  }

  // Related-party overlay (W6-03 / BRD WF-06): a flagged deal cannot reach the
  // Gate-1 Screening Decision without an independent, non-conflicted sign-off,
  // and a user conflicted with the deal may not take that decision at all. The
  // overlay is read from the same configuration the review form writes.
  let relatedPartyOverlay = null;
  if (isGate1Decision(fromState, toState)) {
    const overlay = await decisionOverlay({ id: row.id, data }, actor);
    if (overlay.overlay.flagged) {
      relatedPartyOverlay = overlay.overlay;
      if (!overlay.decision.allowed) {
        const e = new Error('The related-party overlay blocks the Gate-1 decision: ' + overlay.decision.reason);
        e.status = 403;
        e.data = { related_party: overlay.overlay, conflicted: overlay.decision.conflicted === true, missing: ['independent_signoff'] };
        throw e;
      }
    }
  }
  // Withdrawing is a producing-layer action (INT-13): the preparer who owns the
  // item takes it back before a screening decision, and the reason is
  // mandatory so the retained history record is self-explanatory.
  if (toState === 'withdrawn') {
    if (!canWriteOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
      const e = new Error('Not permitted to withdraw this opportunity'); e.status = 403; throw e;
    }
    if (!comment || !String(comment).trim()) {
      const e = new Error('A reason is required to withdraw an opportunity'); e.status = 400; throw e;
    }
  }
  // Returning an item to its producing layer is a reviewer action; the resubmit
  // leg back to submission belongs to the producing layer.
  if (toState !== 'submission') {
    if (!canActAtStage(actor.membership, action)) {
      const e = new Error('Not permitted to move this opportunity to ' + toState); e.status = 403; throw e;
    }
  } else if (!canWriteOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to resubmit this opportunity'); e.status = 403; throw e;
  }
  const now = new Date().toISOString();
  // A reason code is mandatory for the terminal / revision decisions so the
  // retained history is self-explanatory and declines are comparable (WF-05).
  const reasonClass = decisionClassForState(toState);
  let reasonFields = {};
  if (reasonClass) {
    const config = reasonConfig || await loadDecisionReasonConfig();
    const recorded = recordDecisionReason(config, {
      decisionClass: reasonClass.key,
      code: reasonCode,
      text: reasonText !== undefined ? reasonText : comment,
      actor,
      at: now,
    });
    if (!recorded.ok) {
      const e = new Error(recorded.errors.join(' '));
      e.status = 400; e.data = { missing: ['reason_code'] }; throw e;
    }
    reasonFields = recorded.data;
  }
  const patched = {
    ...data,
    status: toState,
    status_entered_at: now,
    status_changed_by: actor.email,
    ...(toState === 'returned' ? { returned_reason: comment || null, returned_at: now } : {}),
    ...(toState === 'declined' ? { declined_reason: comment || null, declined_at: now } : {}),
    ...(toState === 'withdrawn' ? { withdrawn_reason: String(comment).trim(), withdrawn_at: now, withdrawn_by: actor.email } : {}),
    ...reasonFields,
  };
  await pool.query(
    'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
    [OPPORTUNITY_ENTITY, row.id, JSON.stringify(patched), actor.email]
  );
  await pool.query(
    'INSERT INTO pipeline_transition (id, opportunity_id, owner_org_id, from_state, to_state, actor_email, comment, reason_code, reason_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [uuid(), row.id, row.owner_org_id, fromState, toState, actor.email, comment || null, reasonFields.decision_reason || null, reasonFields.decision_reason_text || null]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'transition',
    actor, orgId: row.owner_org_id, before: { status: fromState },
    after: { status: toState, reason_code: reasonFields.decision_reason || null, reason_text: reasonFields.decision_reason_text || null },
    comment: comment || null,
  });
  // The Gate-1 authority the decision was taken under (WF-08) is recorded on the
  // record and in the audit trail so the RACI ownership is reconstructable.
  if (gate1Authority) {
    const authorityPatch = {
      gate1_authority: {
        gate: gate1Authority.gate,
        tier: gate1Authority.tier.key,
        tier_label: gate1Authority.tier.label,
        band_min_aed: gate1Authority.tier.min_aed,
        band_max_aed: gate1Authority.tier.max_aed,
        responsibilities: gate1Authority.tier.responsibilities,
        decision_roles: gate1Authority.tier.decision_roles,
        accountable_party: gate1Authority.accountable_party,
        amount_aed: gate1Authority.amount_aed,
        version: gate1Authority.version,
        decided_by: actor.email,
        decided_at: now,
      },
    };
    await pool.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(authorityPatch), actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'gate1_authority_applied',
      actor, orgId: row.owner_org_id,
      after: { tier: gate1Authority.tier.key, decision_roles: gate1Authority.tier.decision_roles, amount_aed: gate1Authority.amount_aed },
    });
  }
  // The related-party overlay that cleared the decision (W6-03) is stamped on
  // the record and audited so a flagged deal's independent sign-off is
  // reconstructable from the retained history.
  if (relatedPartyOverlay) {
    const overlayPatch = {
      related_party_overlay: {
        gate: relatedPartyOverlay.gate,
        status: relatedPartyOverlay.status,
        version: relatedPartyOverlay.version,
        signed_off_by: relatedPartyOverlay.signed_off_by || null,
        conflict_excluded: relatedPartyOverlay.conflicted === true,
        decided_by: actor.email,
        decided_at: now,
      },
    };
    await pool.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(overlayPatch), actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'related_party_overlay_applied',
      actor, orgId: row.owner_org_id,
      after: { status: relatedPartyOverlay.status, signed_off_by: relatedPartyOverlay.signed_off_by || null },
    });
  }
  return {
    ok: true, opportunity_id: row.id, from_state: fromState, state: toState,
    reason_code: reasonFields.decision_reason || null,
    reason_label: reasonFields.decision_reason_label || null,
    doa: gate1Authority || null,
    related_party: relatedPartyOverlay || null,
  };
}

export async function listTransitions(opportunityId) {
  const { rows } = await pool.query(
    'SELECT * FROM pipeline_transition WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 100',
    [opportunityId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// HTTP routes — /api/pipeline
// ---------------------------------------------------------------------------
export const pipelineRouter = express.Router();

pipelineRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

pipelineRouter.get('/states', async (_req, res) => {
  res.json({
    states: PIPELINE_STATES.map((s) => ({ state: s, label: STATE_LABELS[s] })),
    transitions: TRANSITIONS,
    sla: await getSlaTargets(),
  });
});

pipelineRouter.get('/board', async (req, res) => {
  try { res.json(await screeningBoard(req.actor)); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/awaiting-my-review', async (req, res) => {
  try { res.json(await awaitingMyReview(req.actor)); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/my-opportunities', async (req, res) => {
  try { res.json(await myOpportunities(req.actor, { orgId: req.query.org_id })); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/rollup', async (req, res) => {
  try { res.json(await orgRollup(req.actor, { orgId: req.query.org_id })); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/alignment', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    // Load the entity's indexed corpus so the alignment rationale can quote the
    // strategy passage behind each graded dimension (W3-13 / SCR-02).
    const strategy = await loadStrategyCorpus(row.owner_org_id).catch(() => null);
    res.json({ opportunity_id: row.id, alignment: await evaluateAlignment(row, { orgId: row.owner_org_id, strategy }) });
  } catch (err) { sendErr(res, err); }
});

// The single screening panel (W3-01 / SCR-01). Composes the initial screen -
// eligibility, hard filters, hurdle tests, alignment, synergy & conflict and
// completeness - from the same gate and alignment blocks every other route
// reads, so the panel can never disagree with the form or the memo. Advisory
// throughout (SCR-09): the panel recommends, a person decides.
pipelineRouter.get('/opportunities/:id/screening', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    // The portfolio register (W4-01 / ENT-04) feeds the advisory synergy and
    // conflict checks. It is reference data, so every reader sees it.
    const portfolioRegister = await loadPortfolioRegisterConfig().catch(() => null);
    // The entity's indexed strategy corpus (W4-02 / ENT-02) feeds the
    // document-passage citation on the alignment check (W3-13).
    const strategy = await loadStrategyCorpus(row.owner_org_id).catch(() => null);
    const strategyProfile = await getLatestStrategyProfile(row.owner_org_id).catch(() => null);
    const [gate, alignment, duplicates, qualityScoreConfig] = await Promise.all([
      evaluateGate(row, { orgId: row.owner_org_id, portfolio: portfolioRegister?.companies || null }).catch(() => null),
      evaluateAlignment(row, { orgId: row.owner_org_id, strategy }).catch(() => null),
      // The duplicate-target check compares against the whole group, which only
      // a cross-org reader may see (INT-12); everyone else gets the count-free
      // panel without the conflict signal.
      isCrossOrgReader(req.actor.membership) ? duplicateMatchesFor(row.id).catch(() => null) : Promise.resolve(null),
      loadQualityScoreConfig().catch(() => null),
    ]);
    const panel = evaluateScreeningPanel({
      gate,
      alignment,
      duplicates,
      conflict: row.data?.conflict_of_interest ?? null,
      qualityScoreConfig,
    });
    // Record the strategy profile version this screening used (W4-03 / ENT-01),
    // so the retained record names the mandate in force when the screen ran.
    const screeningRecord = await recordScreeningSnapshot(row.id, {
      orgId: row.owner_org_id, profile: strategyProfile, strategy, alignment, panel, actor: req.actor,
    }).catch(() => null);
    panel.strategy_profile = strategyProfile
      ? { version: strategyProfile.version, published_at: strategyProfile.published_at, source_document_ids: strategyProfile.source_document_ids }
      : null;
    panel.screening_record = screeningRecord;
    res.json({ opportunity_id: row.id, screening: panel });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/transitions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    res.json(await listTransitions(req.params.id));
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.post('/opportunities/:id/transition', async (req, res) => {
  try {
    const toState = req.body?.state || req.body?.to_state;
    res.json(await transition(req.params.id, toState, {
      actor: req.actor,
      comment: req.body?.comment,
      reasonCode: req.body?.reason_code,
      reasonText: req.body?.reason_text,
    }));
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Sirius investment memo (REQ-MEMO-01).
//
// GET  /opportunities/:id/memo        -> the structured six-page memo model
// GET  /opportunities/:id/memo.docx   -> the same memo rendered to Word
//
// Both read the opportunity through the same org-visibility rule as every
// other pipeline route, so a cross-tenant caller gets 403 and never sees the
// document. The memo is assembled from the opportunity's structured fields
// (gate.js OPPORTUNITY_FIELDS), the owning subsidiary and the submission
// documents already on the record; anything the template shows but the record
// does not carry renders as the template's grey placeholder.
// ---------------------------------------------------------------------------

async function loadMemoInputs(req) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, req.params.id]
  );
  const row = rows[0];
  if (!row) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this opportunity'); e.status = 403; throw e;
  }
  const [org, documents, alignment] = await Promise.all([
    getOrganization(row.owner_org_id).catch(() => null),
    listDocuments(row.id, { currentOnly: true }).catch(() => []),
    evaluateAlignment(row, { orgId: row.owner_org_id }).catch(() => null),
  ]);
  return { row, org, documents, alignment };
}

function memoFilename(row, org) {
  const base = [org?.name || row.owner_org_id, row.data?.opportunity_name]
    .filter(Boolean).join(' - ')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'investment_memo';
  return `Sirius_Memo_${base}.docx`;
}

// Data-room folder link (W8-04 / BRD INTG-01). The opportunity holds a durable
// pointer to the folder a screening works from; the secure room itself stays the
// system of record for documents. Reading is scoped by the same org rule as the
// rest of the pipeline; setting or clearing it is audited.
pipelineRouter.get('/dataroom-providers', (_req, res) => {
  res.json({ version: DATAROOM_LINK_VERSION, providers: DATAROOM_PROVIDERS });
});

pipelineRouter.get('/opportunities/:id/dataroom-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    res.json({ opportunity_id: row.id, link: describeDataroomLink(row.data || {}), version: DATAROOM_LINK_VERSION });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.put('/opportunities/:id/dataroom-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canWriteOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to change this opportunity' });
    }
    const before = describeDataroomLink(row.data || {});
    const built = buildDataroomLinkRecord(req.body || {}, { actor: req.actor });
    if (!built.ok) return res.status(422).json({ error: built.errors.join(' '), errors: built.errors });
    await pool.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(built.record), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'dataroom_link_set',
      actor: req.actor, orgId: row.owner_org_id, before, after: built.record,
    });
    res.json({ ok: true, link: describeDataroomLink(built.record), saved: true });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.delete('/opportunities/:id/dataroom-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canWriteOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to change this opportunity' });
    }
    const before = describeDataroomLink(row.data || {});
    if (!before) return res.status(404).json({ error: 'No data-room link is set on this opportunity' });
    const cleared = {
      dataroom_folder_url: null, dataroom_folder_label: null, dataroom_provider: null,
      dataroom_provider_label: null, dataroom_unlinked_at: new Date().toISOString(), dataroom_unlinked_by: req.actor.email,
    };
    await pool.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(cleared), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'dataroom_link_cleared',
      actor: req.actor, orgId: row.owner_org_id, before,
    });
    res.json({ ok: true, link: null, cleared: true });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/memo', async (req, res) => {
  try {
    const { row, org, documents, alignment } = await loadMemoInputs(req);
    const memo = buildSiriusMemo({ opportunity: row, org, documents, alignment });
    memo.missing = missingMemoFields(row);
    // Data-point to source mapping (W5-04 / DOC-05): trace every memo value back
    // to the artefact or captured field it came from, so a reviewer can open the
    // linked source. Provenance only - it never changes a value.
    try {
      const sourceConfig = await loadDataSourceConfig();
      memo.source_map = buildSourceMap({ config: sourceConfig, documents, data: row.data || {} });
    } catch {
      memo.source_map = null;
    }
    res.json(memo);
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/memo.docx', async (req, res) => {
  try {
    const { row, org, documents, alignment } = await loadMemoInputs(req);
    const memo = buildSiriusMemo({ opportunity: row, org, documents, alignment });
    // Embed the QR verification image in the footer (W7-05 / OUT-03) so the
    // printed memo carries a scan-to-verify link to this record version/hash.
    let verification = null;
    try {
      verification = await prepareDocxVerification({ row, memo, actor: req.actor });
    } catch { verification = null; }
    const buffer = await packSiriusMemo(memo, verification);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${memoFilename(row, org)}"`);
    res.setHeader('Content-Length', String(buffer.length));
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'memo_generate',
      actor: req.actor, orgId: row.owner_org_id,
      after: { format: 'docx', pages: memo.pages.length, subsidiary: org?.name || null },
    });
    res.send(buffer);
  } catch (err) { sendErr(res, err); }
});

export default pipelineRouter;
