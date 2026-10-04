import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, canConfigure, isCrossOrgReader } from './rbac.js';
import {
  PRESENTATION_CONFIG_KEY,
  PRESENTATION_MESSAGES,
  PRESENTATION_STATUSES,
  PRESENTATION_FORMATS,
  PRESENTATION_STATUS_KEYS,
  defaultPresentationConfig,
  validatePresentationConfig,
  resolvePresentationConfig,
  diffPresentationConfig,
  buildPresentationConfig,
  normaliseSession,
  mayManagePresentations,
} from './config/presentationSessions.js';

// ---------------------------------------------------------------------------
// Subsidiary presentation scheduling (W6-06 / BRD WF-07).
//
// A presentation is captured on the opportunity record: the scheduled date, the
// group attendees, and - once held - the outcome and the next steps. The policy
// (which fields are mandatory, the default format) lives in an AppSettings
// record (setting_key = 'presentation_session_config') so the group can retune
// it without a deploy; reads fall back to the shipped default. The pure
// resolution and validation functions live in config/presentationSessions.js.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

export async function loadPresentationConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [PRESENTATION_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultPresentationConfig();
    return resolvePresentationConfig(rows[0].setting_value);
  } catch {
    return defaultPresentationConfig();
  }
}

async function persistPresentationConfig(config, actor) {
  const payload = {
    setting_key: PRESENTATION_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Subsidiary presentation scheduling policy (WF-07)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [PRESENTATION_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'presentation-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

async function loadOpportunity(id, actor) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, id]
  );
  const row = rows[0];
  if (!row) { const e = new Error(PRESENTATION_MESSAGES.opportunity_not_found); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this opportunity'); e.status = 403; throw e;
  }
  return row;
}

function toSession(row) {
  if (!row) return null;
  return {
    ...row,
    attendees: Array.isArray(row.attendees) ? row.attendees : [],
    scheduled_at: row.scheduled_at || null,
    completed: row.status === 'completed',
  };
}

export async function listPresentations(opportunityId, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  const config = await loadPresentationConfig();
  const { rows } = await pool.query(
    'SELECT * FROM presentation_session WHERE opportunity_id = $1 ORDER BY scheduled_at DESC NULLS LAST, created_at DESC',
    [opportunityId]
  );
  return {
    opportunity_id: opp.id,
    owner_org_id: opp.owner_org_id,
    sessions: rows.map(toSession),
    config,
    statuses: PRESENTATION_STATUSES,
    formats: PRESENTATION_FORMATS,
    viewer: { may_manage: mayManagePresentations(actor, opp.owner_org_id) },
  };
}

export async function createPresentation(opportunityId, payload = {}, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  const config = await loadPresentationConfig();
  if (!mayManagePresentations(actor, opp.owner_org_id)) {
    const e = new Error(PRESENTATION_MESSAGES.forbidden); e.status = 403; throw e;
  }
  const { value, error, field } = normaliseSession(payload, config);
  if (error) { const e = new Error(error); e.status = 422; e.data = { missing: [field] }; throw e; }
  const { rows } = await pool.query(
    'INSERT INTO presentation_session ' +
      '(id, opportunity_id, owner_org_id, scheduled_at, status, format, location, attendees, outcome, next_steps, notes, created_by, updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *',
    [uuid(), opp.id, opp.owner_org_id, value.scheduled_at, value.status, value.format, value.location,
     JSON.stringify(value.attendees), value.outcome, value.next_steps, value.notes, actor.email]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'presentation_scheduled',
    actor, orgId: opp.owner_org_id,
    after: { session_id: rows[0].id, scheduled_at: value.scheduled_at, status: value.status, attendees: value.attendees.map((a) => a.email) },
  });
  return { opportunity_id: opp.id, session: toSession(rows[0]) };
}

export async function updatePresentation(opportunityId, sessionId, payload = {}, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  const config = await loadPresentationConfig();
  if (!mayManagePresentations(actor, opp.owner_org_id)) {
    const e = new Error(PRESENTATION_MESSAGES.forbidden); e.status = 403; throw e;
  }
  const { rows: existing } = await pool.query(
    'SELECT * FROM presentation_session WHERE id = $1 AND opportunity_id = $2',
    [sessionId, opportunityId]
  );
  if (!existing[0]) { const e = new Error(PRESENTATION_MESSAGES.not_found); e.status = 404; throw e; }
  const prior = existing[0];
  // Merge so an edit that only records the outcome keeps the scheduled fields.
  const merged = {
    scheduled_at: payload.scheduled_at !== undefined ? payload.scheduled_at : prior.scheduled_at,
    status: payload.status !== undefined ? payload.status : prior.status,
    format: payload.format !== undefined ? payload.format : prior.format,
    location: payload.location !== undefined ? payload.location : prior.location,
    attendees: payload.attendees !== undefined ? payload.attendees : prior.attendees,
    outcome: payload.outcome !== undefined ? payload.outcome : prior.outcome,
    next_steps: payload.next_steps !== undefined ? payload.next_steps : prior.next_steps,
    notes: payload.notes !== undefined ? payload.notes : prior.notes,
  };
  const { value, error, field } = normaliseSession(merged, config);
  if (error) { const e = new Error(error); e.status = 422; e.data = { missing: [field] }; throw e; }
  const { rows } = await pool.query(
    'UPDATE presentation_session SET scheduled_at = $3, status = $4, format = $5, location = $6, ' +
      ' attendees = $7, outcome = $8, next_steps = $9, notes = $10, updated_by = $11, updated_at = now() ' +
      'WHERE id = $1 AND opportunity_id = $2 RETURNING *',
    [sessionId, opportunityId, value.scheduled_at, value.status, value.format, value.location,
     JSON.stringify(value.attendees), value.outcome, value.next_steps, value.notes, actor.email]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'presentation_updated',
    actor, orgId: opp.owner_org_id,
    before: { status: prior.status, outcome: prior.outcome },
    after: { session_id: sessionId, status: value.status, outcome: value.outcome, next_steps: value.next_steps },
  });
  return { opportunity_id: opp.id, session: toSession(rows[0]) };
}

// ---------------------------------------------------------------------------
// HTTP routes - /api/presentations
// ---------------------------------------------------------------------------
export const presentationsRouter = express.Router();

presentationsRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/presentations - the effective policy (any authenticated reader).
presentationsRouter.get('/', async (_req, res) => {
  try {
    const config = await loadPresentationConfig();
    const { ok, errors } = validatePresentationConfig(config);
    res.json({
      config,
      defaults: defaultPresentationConfig(),
      statuses: PRESENTATION_STATUSES,
      formats: PRESENTATION_FORMATS,
      valid: ok,
      errors,
      disclaimer: PRESENTATION_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/presentations - replace the policy and mint a revision (admin-only).
presentationsRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the presentation policy' });
    }
    const base = await loadPresentationConfig();
    const config = buildPresentationConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffPresentationConfig(base, config);
    const id = await persistPresentationConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'presentation_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

presentationsRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'presentation_config_updated'));
  } catch (err) { sendErr(res, err); }
});

// Opportunity-scoped session CRUD.
presentationsRouter.get('/opportunities/:id', async (req, res) => {
  try { res.json(await listPresentations(req.params.id, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

presentationsRouter.post('/opportunities/:id', async (req, res) => {
  try { res.json(await createPresentation(req.params.id, req.body || {}, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

presentationsRouter.put('/opportunities/:id/sessions/:sessionId', async (req, res) => {
  try { res.json(await updatePresentation(req.params.id, req.params.sessionId, req.body || {}, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

export default presentationsRouter;
