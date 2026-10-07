import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, canConfigure, canActAtStage, canSign } from './rbac.js';
import { canReturnAtStage } from './rbac.js';
import { notify } from './notify.js';
import { loadDecisionReasonConfig } from './decisionReasons.js';
import { recordDecisionReason } from './config/decisionReasons.js';

// ---------------------------------------------------------------------------
// Submission route — a minimal, reusable workflow engine (E7 / REQ-WF-01..04,
// REQ-WF-06..08, REQ-FLOW-01/02).
//
// A *workflow* is an org-scoped, named template: an ordered list of stages,
// each with an action (fill / review / sign / approve), the roles allowed to
// act, required fields that must be present before the stage can complete, and
// whether the stage captures a signature. Applying a workflow to a submission
// snapshots the stages into a *route*, resolves the participants for each
// stage, and produces a signature map (participants, actions, order, status).
//
// Every action and return is written to workflow_event and to the immutable
// audit log, and participants are notified.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

export const WORKFLOW_ACTIONS = ['fill', 'review', 'sign', 'approve'];
export const WORKFLOW_STATUSES = ['draft', 'active', 'archived'];

// The sign-off route (Fill -> Review -> Sign -> Approve, through leadership and
// the IC) is the Phase 2 four-gate approval workflow (BRD v2 WF-09). In Phase 1
// it is recorded alongside the opportunity but never moves the Gate-1
// lifecycle: only the screening workflow (config/workflowStates.js) does, so a
// route action cannot skip the screening decision or the Delegation of
// Authority.
// The default route mirrors the pilot approval path (REQ-APPR-01): the
// producing layer prepares, the subsidiary signs off, the Sirius investment
// team refines, leadership approves, then the IC approves.
export const DEFAULT_WORKFLOW = {
  name: 'Standard submission route',
  description: 'Subsidiary prepare and sign-off, Sirius review, leadership and IC approval.',
  status: 'active',
  is_default: true,
  stages: [
    {
      stage_key: 'prepare',
      name: 'Prepare & submit',
      action: 'fill',
      roles: ['subsidiary_deal_lead', 'subsidiary_cfo', 'subsidiary_ceo'],
      required_fields: ['narrative_what', 'decision_sought'],
      requires_signature: false,
      sort_order: 10,
    },
    {
      stage_key: 'subsidiary_sign',
      name: 'Subsidiary sign-off',
      action: 'sign',
      roles: ['subsidiary_ceo', 'subsidiary_cfo', 'opco_signatory'],
      required_fields: ['total_commitment_aed'],
      requires_signature: true,
      sort_order: 20,
    },
    {
      stage_key: 'investment_review',
      name: 'Investment-team review',
      action: 'review',
      roles: ['sirius_deal_lead', 'sirius_vertical_head', 'cluster_head'],
      required_fields: ['business_plan'],
      requires_signature: false,
      sort_order: 30,
    },
    {
      stage_key: 'refinement',
      name: 'Investment-team refinement',
      action: 'review',
      roles: ['sirius_deal_lead', 'sirius_vertical_head'],
      required_fields: [],
      requires_signature: false,
      sort_order: 35,
    },
    {
      stage_key: 'leadership_approve',
      name: 'Leadership approval',
      action: 'approve',
      roles: ['leadership', 'sirius_vertical_head', 'cio'],
      required_fields: [],
      requires_signature: true,
      requires_rationale: false,
      sort_order: 40,
    },
    {
      stage_key: 'ic_approve',
      name: 'IC approval',
      action: 'approve',
      roles: ['ic_member', 'board_member'],
      required_fields: [],
      requires_signature: true,
      requires_rationale: true,
      sort_order: 50,
    },
  ],
};

function normArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

/** Seed the standard route for the group root if no workflow exists yet. */
export async function seedWorkflows({ force = false, orgId } = {}) {
  const targetOrg = orgId || process.env.GROUP_ROOT_ORG_ID || 'org-sirius-international-holding-limited';
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM workflow');
  if (rows[0].n > 0 && !force) {
    // The default route may have gained stages (E9 approval path). Keep the
    // group-root default in step with the shipped definition so a fresh apply
    // snapshots the current approval path.
    const { rows: defaults } = await pool.query(
      "SELECT id FROM workflow WHERE org_id = $1 AND is_default = true AND name = $2 ORDER BY updated_at DESC LIMIT 1",
      [targetOrg, DEFAULT_WORKFLOW.name]
    );
    if (defaults[0]) {
      const existing = await getWorkflow(defaults[0].id);
      const sameStages = (existing?.stages || []).length === DEFAULT_WORKFLOW.stages.length;
      if (!sameStages) {
        await upsertWorkflow({ ...DEFAULT_WORKFLOW, id: defaults[0].id, org_id: targetOrg }, { actor: { id: 'system', email: 'system' } });
        return { skipped: false, upgraded: true, count: 1 };
      }
    }
    return { skipped: true, count: rows[0].n };
  }
  await upsertWorkflow({ ...DEFAULT_WORKFLOW, org_id: targetOrg }, { actor: { id: 'system', email: 'system' } });
  return { skipped: false, count: 1 };
}

export async function getWorkflow(id, { withStages = true } = {}) {
  const { rows } = await pool.query('SELECT * FROM workflow WHERE id = $1', [id]);
  const wf = rows[0];
  if (!wf) return null;
  if (!withStages) return wf;
  const { rows: stages } = await pool.query(
    'SELECT * FROM workflow_stage WHERE workflow_id = $1 ORDER BY sort_order', [id]
  );
  return { ...wf, stages };
}

export async function listWorkflows({ orgId, includeArchived = false } = {}) {
  const params = [];
  const where = [];
  if (orgId) { params.push(orgId); where.push(`org_id = $${params.length}`); }
  if (!includeArchived) where.push(`status <> 'archived'`);
  const { rows } = await pool.query(
    `SELECT * FROM workflow ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY is_default DESC, name`,
    params
  );
  const out = [];
  for (const wf of rows) {
  const { rows: stages } = await pool.query(
      'SELECT * FROM workflow_stage WHERE workflow_id = $1 ORDER BY sort_order', [wf.id]
    );
    out.push({ ...wf, stages });
  }
  return out;
}

export async function upsertWorkflow(payload = {}, { actor } = {}) {
  const orgId = payload.org_id || actor?.org_id;
  if (!orgId) { const e = new Error('org_id is required'); e.status = 400; throw e; }
  const name = (payload.name || '').trim();
  if (!name) { const e = new Error('A workflow name is required'); e.status = 400; throw e; }
  const status = WORKFLOW_STATUSES.includes(payload.status) ? payload.status : 'draft';
  const stages = Array.isArray(payload.stages) ? payload.stages : [];
  for (const [index, stage] of stages.entries()) {
    if (!WORKFLOW_ACTIONS.includes(stage.action)) {
      const e = new Error(`Stage ${stage.stage_key || index + 1}: unknown action '${stage.action}'`);
      e.status = 400; throw e;
    }
    if (!stage.name || !String(stage.name).trim()) {
      const e = new Error(`Stage ${index + 1}: a name is required`); e.status = 400; throw e;
    }
  }
  const id = payload.id || uuid();
  const isDefault = payload.is_default === undefined ? false : Boolean(payload.is_default);
  if (isDefault) {
    await pool.query('UPDATE workflow SET is_default = false WHERE org_id = $1', [orgId]);
  }
  await pool.query(
    `INSERT INTO workflow (id, org_id, name, description, status, is_default, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
       status = EXCLUDED.status, is_default = EXCLUDED.is_default, updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [id, orgId, name, payload.description || null, status, isDefault, actor?.email || null]
  );
  // Re-stage: replace the stage set wholesale so reorder/remove is atomic.
  await pool.query('DELETE FROM workflow_stage WHERE workflow_id = $1', [id]);
  for (const [index, stage] of stages.entries()) {
    const key = (stage.stage_key || stage.name).toString().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `stage_${index + 1}`;
    await pool.query(
      `INSERT INTO workflow_stage (id, workflow_id, stage_key, name, action, roles, required_fields, requires_signature, requires_rationale, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        uuid(), id, key, String(stage.name).trim(), stage.action,
        normArray(stage.roles), normArray(stage.required_fields),
        Boolean(stage.requires_signature), Boolean(stage.requires_rationale),
        Number.isFinite(Number(stage.sort_order)) ? Number(stage.sort_order) : (index + 1) * 10,
      ]
    );
  }
  await writeAudit({ entity: 'workflow', entityId: id, action: 'save', actor, orgId, after: { name, status, stages: stages.length } });
  return getWorkflow(id);
}

// Resolve who can act at a stage: any user holding one of the stage roles in the
// owning org, in an ancestor org, or in the group root (cross-org readers).
async function resolveParticipants(ownerOrgId, stage) {
  const { rows: ownerRows } = await pool.query('SELECT path FROM organization WHERE id = $1', [ownerOrgId]);
  const ownerPath = ownerRows[0]?.path || null;
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.email, u.full_name, m.roles, m.can_sign, m.org_id, o.name AS org_name
       FROM membership m
       JOIN app_user u ON u.id = m.user_id
       JOIN organization o ON o.id = m.org_id
      WHERE m.roles && $1::text[]
        AND (m.org_id = $2 OR ($3::text IS NOT NULL AND $3 LIKE o.path || '%'))
      ORDER BY u.full_name`,
    [stage.roles || [], ownerOrgId, ownerPath]
  );
  return rows.map((r) => ({
    user_id: r.id,
    user_email: r.email,
    full_name: r.full_name,
    role: (r.roles || []).find((role) => (stage.roles || []).includes(role)) || (r.roles || [])[0] || null,
    can_sign: Boolean(r.can_sign),
    org_id: r.org_id,
  }));
}

async function loadOpportunity(id, actor) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, id]
  );
  const row = rows[0];
  if (!row) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this opportunity'); e.status = 403; throw e;
  }
  return row;
}

/** Apply a workflow to a submission: snapshot stages, resolve participants. */
export async function applyRoute(opportunityId, { workflowId, actor, comment } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  if (!canWriteOrg(actor.membership, opp.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to route this opportunity'); e.status = 403; throw e;
  }
  let workflow = null;
  if (workflowId) workflow = await getWorkflow(workflowId);
  if (!workflow) {
    const { rows } = await pool.query(
      `SELECT id FROM workflow WHERE org_id = $1 AND status = 'active' ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
      [opp.owner_org_id]
    );
    if (rows[0]) workflow = await getWorkflow(rows[0].id);
  }
  if (!workflow) {
    const { rows } = await pool.query(
      `SELECT id FROM workflow WHERE status = 'active' ORDER BY is_default DESC, updated_at DESC LIMIT 1`
    );
    if (rows[0]) workflow = await getWorkflow(rows[0].id);
  }
  if (!workflow) { const e = new Error('No active workflow is available to apply'); e.status = 400; throw e; }
  if (!workflow.stages?.length) { const e = new Error('That workflow has no stages'); e.status = 400; throw e; }

  // One route per opportunity (REQ-WF-06): re-applying replaces the old route.
  await pool.query('DELETE FROM route_participant WHERE route_id IN (SELECT id FROM submission_route WHERE opportunity_id = $1)', [opp.id]);
  await pool.query('DELETE FROM route_stage WHERE route_id IN (SELECT id FROM submission_route WHERE opportunity_id = $1)', [opp.id]);
  await pool.query('DELETE FROM submission_route WHERE opportunity_id = $1', [opp.id]);

  const routeId = uuid();
  const firstStage = workflow.stages[0].stage_key;
  await pool.query(
    `INSERT INTO submission_route (id, opportunity_id, owner_org_id, workflow_id, workflow_name, status, current_stage, applied_by)
     VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
    [routeId, opp.id, opp.owner_org_id, workflow.id, workflow.name, firstStage, actor.email]
  );
  let participantCount = 0;
  for (const stage of workflow.stages) {
    await pool.query(
      `INSERT INTO route_stage (id, route_id, stage_key, name, action, roles, required_fields, requires_signature, requires_rationale, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
      [uuid(), routeId, stage.stage_key, stage.name, stage.action, stage.roles || [], stage.required_fields || [], stage.requires_signature, Boolean(stage.requires_rationale), stage.sort_order]
    );
    const participants = await resolveParticipants(opp.owner_org_id, stage);
    for (const [index, person] of participants.entries()) {
      await pool.query(
        `INSERT INTO route_participant (id, route_id, stage_key, user_id, user_email, full_name, role, action, is_signer, sort_order, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
         ON CONFLICT (route_id, stage_key, user_email) DO NOTHING`,
        [uuid(), routeId, stage.stage_key, person.user_id, person.user_email, person.full_name, person.role, stage.action, Boolean(stage.requires_signature && person.can_sign), index + 1]
      );
      participantCount += 1;
    }
  }
  const now = new Date().toISOString();
  const patched = { ...(opp.data || {}), route_id: routeId, route_workflow: workflow.name, route_applied_at: now, route_applied_by: actor.email };
  await pool.query(
    'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
    [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), actor.email]
  );
  const eventId = uuid();
  await pool.query(
    `INSERT INTO workflow_event (id, route_id, opportunity_id, owner_org_id, stage_key, action, actor_email, comment)
     VALUES ($1,$2,$3,$4,$5,'route_applied',$6,$7)`,
    [eventId, routeId, opp.id, opp.owner_org_id, firstStage, actor.email, comment || null]
  );
  await writeAudit({ entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'route_applied', actor, orgId: opp.owner_org_id, after: { workflow: workflow.name, stages: workflow.stages.length } });

  const signer = (await getRouteParticipants(routeId)).filter((p) => p.is_signer);
  await notify({
    to: [...new Set(signer.map((p) => p.user_email))],
    kind: 'route_applied',
    subject: `Signature required: ${patched.opportunity_name || opp.id}`,
    body: `A submission route (${workflow.name}) has been applied and your signature is on the map.`,
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, orgId: opp.owner_org_id, actor,
  });
  return { route_id: routeId, workflow_id: workflow.id, workflow_name: workflow.name, stages: workflow.stages.length, participants: participantCount };
}

export async function getRouteParticipants(routeId) {
  const { rows } = await pool.query('SELECT * FROM route_participant WHERE route_id = $1 ORDER BY sort_order', [routeId]);
  return rows;
}

export async function getRoute(opportunityId, { actor } = {}) {
  const { rows } = await pool.query('SELECT * FROM submission_route WHERE opportunity_id = $1', [opportunityId]);
  const route = rows[0];
  if (!route) return null;
  if (actor && !canViewOrg(actor.membership, route.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this route'); e.status = 403; throw e;
  }
  const { rows: stages } = await pool.query('SELECT * FROM route_stage WHERE route_id = $1 ORDER BY sort_order', [route.id]);
  const participants = await getRouteParticipants(route.id);
  const { rows: events } = await pool.query('SELECT * FROM workflow_event WHERE route_id = $1 ORDER BY created_at DESC LIMIT 100', [route.id]);
  return { route, stages, participants, events };
}

export async function signatureMap(opportunityId, { actor } = {}) {
  const bundle = await getRoute(opportunityId, { actor });
  if (!bundle) return null;
  const { route, stages, participants } = bundle;
  const byStage = stages.map((stage) => ({
    stage_key: stage.stage_key,
    name: stage.name,
    action: stage.action,
    roles: stage.roles || [],
    required_fields: stage.required_fields || [],
    requires_signature: stage.requires_signature,
    requires_rationale: Boolean(stage.requires_rationale),
    sort_order: stage.sort_order,
    status: stage.status,
    acted_by: stage.acted_by,
    acted_at: stage.acted_at,
    signing_order: participants.filter((p) => p.stage_key === stage.stage_key && p.is_signer).map((p) => ({
      user_email: p.user_email, full_name: p.full_name, role: p.role, status: p.status, signed_at: p.signed_at,
    })),
    participants: participants.filter((p) => p.stage_key === stage.stage_key).map((p) => ({
      user_email: p.user_email, full_name: p.full_name, role: p.role, action: p.action, status: p.status,
    })),
  }));
  return {
    route_id: route.id,
    opportunity_id: route.opportunity_id,
    workflow_name: route.workflow_name,
    route_status: route.status,
    current_stage: route.current_stage,
    stages: byStage,
  };
}

// Advance a route: the current stage is completed by an authorised actor.
export async function actOnStage(opportunityId, { stageKey, action = 'act', comment, reasonCode, reasonText, actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  const { rows: routeRows } = await pool.query('SELECT * FROM submission_route WHERE opportunity_id = $1', [opportunityId]);
  const route = routeRows[0];
  if (!route) { const e = new Error('This opportunity has no applied route'); e.status = 404; throw e; }
  const currentKey = stageKey || route.current_stage;
  if (!currentKey) { const e = new Error('This route has no current stage'); e.status = 409; throw e; }
  // Only the current stage may be acted on; a caller cannot jump ahead by
  // naming a later stage_key (REQ-WF-02).
  if (stageKey && route.current_stage && stageKey !== route.current_stage) {
    const e = new Error('Only the current stage (' + route.current_stage + ') can be acted on');
    e.status = 409; throw e;
  }
  const { rows: stageRows } = await pool.query('SELECT * FROM route_stage WHERE route_id = $1 AND stage_key = $2', [route.id, currentKey]);
  const stage = stageRows[0];
  if (!stage) { const e = new Error('Unknown stage: ' + currentKey); e.status = 404; throw e; }
  if (stage.status !== 'pending') { const e = new Error('Stage ' + currentKey + ' is already ' + stage.status); e.status = 409; throw e; }
  if (route.status !== 'active') { const e = new Error('This route is ' + route.status); e.status = 409; throw e; }

  const actionName = action === 'sign' ? 'sign' : stage.action;
  if (action === 'return') {
    if (!canReturnAtStage(actor.membership, actionName)) {
      const e = new Error(`Not permitted to return at this stage`); e.status = 403; throw e;
    }
  } else if (!canActAtStage(actor.membership, actionName)) {
    const e = new Error(`Not permitted to ${actionName} at this stage`); e.status = 403; throw e;
  }
  if (action === 'sign') {
    if (!canSign(actor.membership)) { const e = new Error('You are not a recognised signatory'); e.status = 403; throw e; }
  }
  // Required fields (REQ-WF-02) must be present on the opportunity.
  const data = opp.data || {};
  const missing = (stage.required_fields || []).filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
  if (action !== 'return' && missing.length) {
    const e = new Error('Missing required fields for this stage: ' + missing.join(', '));
    e.status = 422; e.data = { missing }; throw e;
  }
  // Approve/Return decisions that carry a rationale (E9.3, REQ-APPR-01) must
  // state it, so the audit trail records why, not just what.
  const decision = action === 'return' ? 'return' : 'approve';
  if (action !== 'return' && stage.requires_rationale && !(comment || '').trim()) {
    const e = new Error('A rationale is required to complete this stage');
    e.status = 422; e.data = { missing: ['rationale'] }; throw e;
  }
  // Every return, and every approve whose stage demands a rationale, carries a
  // reason code from the maintained catalogue (WF-05), so the decision is
  // comparable and the rationale is structured.
  let reasonFields = {};
  const requiresReason = action === 'return' || (action !== 'sign' && stage.requires_rationale);
  if (requiresReason) {
    const config = await loadDecisionReasonConfig();
    const recorded = recordDecisionReason(config, {
      decisionClass: decision,
      code: reasonCode,
      text: reasonText !== undefined && reasonText !== null ? reasonText : comment,
      actor,
    });
    if (!recorded.ok) {
      const e = new Error(recorded.errors.join(' '));
      e.status = 422; e.data = { missing: ['reason_code'] }; throw e;
    }
    reasonFields = recorded.data;
  }

  const { rows: stageList } = await pool.query('SELECT * FROM route_stage WHERE route_id = $1 ORDER BY sort_order', [route.id]);
  const idx = stageList.findIndex((s) => s.stage_key === currentKey);
  const returning = action === 'return';

  if (returning) {
    await pool.query("UPDATE route_stage SET status = 'returned', acted_by = $2, acted_at = now(), comment = $3, decision = $4, reason_code = $5, reason_text = $6 WHERE id = $1", [stage.id, actor.email, comment || null, decision, reasonFields.decision_reason || null, reasonFields.decision_reason_text || null]);
    await pool.query("UPDATE submission_route SET status = 'returned', current_stage = $2, updated_at = now() WHERE id = $1", [route.id, currentKey]);
    await pool.query("UPDATE route_participant SET status = 'returned' WHERE route_id = $1 AND stage_key = $2", [route.id, currentKey]);
  } else {
    await pool.query("UPDATE route_stage SET status = 'complete', acted_by = $2, acted_at = now(), comment = $3, decision = $4, reason_code = $5, reason_text = $6 WHERE id = $1", [stage.id, actor.email, comment || null, decision, reasonFields.decision_reason || null, reasonFields.decision_reason_text || null]);
    await pool.query("UPDATE route_participant SET status = 'complete' WHERE route_id = $1 AND stage_key = $2", [route.id, currentKey]);
    if (stage.requires_signature) {
      await pool.query(
        "UPDATE route_participant SET status = 'signed', signed_at = now() WHERE route_id = $1 AND stage_key = $2 AND user_email = $3",
        [route.id, currentKey, actor.email]
      );
    }
    const next = stageList[idx + 1];
    if (next) {
      await pool.query("UPDATE submission_route SET current_stage = $2, updated_at = now() WHERE id = $1", [route.id, next.stage_key]);
    } else {
      await pool.query("UPDATE submission_route SET status = 'complete', current_stage = NULL, updated_at = now() WHERE id = $1", [route.id]);
    }
  }

  await pool.query(
    `INSERT INTO workflow_event (id, route_id, opportunity_id, owner_org_id, stage_key, action, actor_email, comment, decision, reason_code, reason_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [uuid(), route.id, opp.id, opp.owner_org_id, currentKey, returning ? 'return' : (stage.requires_signature ? 'sign' : 'act'), actor.email, comment || null, decision, reasonFields.decision_reason || null, reasonFields.decision_reason_text || null]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: returning ? 'route_return' : 'route_act',
    actor, orgId: opp.owner_org_id,
    after: { stage: currentKey, result: returning ? 'returned' : 'complete', reason_code: reasonFields.decision_reason || null, reason_text: reasonFields.decision_reason_text || null },
    comment: comment || null,
  });

  const nextStageKey = returning ? null : (stageList[idx + 1]?.stage_key || null);
  const allParticipants = await getRouteParticipants(route.id);
  const recipients = allParticipants
    .filter((p) => p.stage_key === (nextStageKey || currentKey))
    .map((p) => p.user_email);
  // Decisions notify the producing layer as well as the next stage, so the
  // subsidiary always learns the outcome (E9.4 / REQ-FLOW-02).
  const ownerParticipants = allParticipants
    .filter((p) => p.stage_key === 'prepare')
    .map((p) => p.user_email);
  const isDecision = !returning && (stage.action === 'approve' || stage.action === 'sign');
  const notifyTo = returning || isDecision ? [...new Set([...recipients, ...ownerParticipants])] : [...new Set(recipients)];
  await notify({
    to: notifyTo,
    kind: returning ? 'route_returned' : 'route_advanced',
    subject: `Route ${returning ? 'returned' : 'advanced'}: ${data.opportunity_name || opp.id}`,
    body: returning
      ? `Stage '${stage.name}' was returned for revision. ${comment || ''}`.trim()
      : `Stage '${stage.name}' is complete${nextStageKey ? `; next is '${nextStageKey}'` : ' and the route is complete'}.`,
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, orgId: opp.owner_org_id, actor,
    // Decisions reach people who may not be watching the app (email + SMS).
    channels: isDecision || returning ? ['in_app', 'email', 'sms'] : ['in_app', 'email'],
  });

  return { ok: true, opportunity_id: opp.id, stage: currentKey, decision, status: returning ? 'returned' : 'complete', next_stage: nextStageKey, route_status: returning ? 'returned' : (nextStageKey ? 'active' : 'complete') };
}

export async function listWorkflowEvents(opportunityId) {
  const { rows } = await pool.query(
    'SELECT * FROM workflow_event WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 200',
    [opportunityId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// HTTP routes — /api/workflows
// ---------------------------------------------------------------------------
export const workflowRouter = express.Router();

workflowRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

workflowRouter.get('/actions', async (_req, res) => {
  res.json({ actions: WORKFLOW_ACTIONS, statuses: WORKFLOW_STATUSES });
});

workflowRouter.get('/', async (req, res) => {
  try {
    const orgId = req.query.org_id || req.actor.org_id;
    if (!canViewOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view those workflows' });
    }
    res.json({ org_id: orgId, workflows: await listWorkflows({ orgId, includeArchived: req.query.include_archived === '1' }) });
  } catch (err) { sendErr(res, err); }
});

workflowRouter.get('/:id', async (req, res) => {
  try {
    const wf = await getWorkflow(req.params.id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });
    if (!canViewOrg(req.actor.membership, wf.org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view that workflow' });
    }
    res.json(wf);
  } catch (err) { sendErr(res, err); }
});

workflowRouter.post('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Admin role required' });
    res.json(await upsertWorkflow(req.body || {}, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

workflowRouter.put('/:id', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Admin role required' });
    res.json(await upsertWorkflow({ ...(req.body || {}), id: req.params.id }, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

workflowRouter.post('/apply/:opportunityId', async (req, res) => {
  try {
    res.json(await applyRoute(req.params.opportunityId, { workflowId: req.body?.workflow_id, actor: req.actor, comment: req.body?.comment }));
  } catch (err) { sendErr(res, err); }
});

workflowRouter.get('/route/:opportunityId', async (req, res) => {
  try {
    const bundle = await getRoute(req.params.opportunityId, { actor: req.actor });
    if (!bundle) return res.status(404).json({ error: 'This opportunity has no applied route' });
    res.json(bundle);
  } catch (err) { sendErr(res, err); }
});

workflowRouter.get('/signature-map/:opportunityId', async (req, res) => {
  try {
    const map = await signatureMap(req.params.opportunityId, { actor: req.actor });
    if (!map) return res.status(404).json({ error: 'This opportunity has no applied route' });
    res.json(map);
  } catch (err) { sendErr(res, err); }
});

workflowRouter.post('/route/:opportunityId/act', async (req, res) => {
  try {
    res.json(await actOnStage(req.params.opportunityId, {
      stageKey: req.body?.stage_key, action: req.body?.action || 'act', comment: req.body?.comment,
      reasonCode: req.body?.reason_code, reasonText: req.body?.reason_text, actor: req.actor,
    }));
  } catch (err) { sendErr(res, err); }
});

workflowRouter.get('/route/:opportunityId/events', async (req, res) => {
  try {
    await loadOpportunity(req.params.opportunityId, req.actor);
    res.json(await listWorkflowEvents(req.params.opportunityId));
  } catch (err) { sendErr(res, err); }
});

export default workflowRouter;
