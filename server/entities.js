import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, isCrossOrgReader } from './rbac.js';
import { evaluateAbac, ABAC_RESOURCES } from './abac.js';
import { OPPORTUNITY_ENTITY, checkCreate, checkUpdate, checkDelete } from './config/opportunityPolicy.js';
import { withLockedOpportunity } from './lifecycle.js';

function policyError(result) {
  const err = new Error(result.error);
  err.status = result.status;
  if (result.fields || result.state) err.data = { ...(result.fields ? { fields: result.fields } : {}), ...(result.state ? { state: result.state } : {}) };
  return err;
}

// ---------------------------------------------------------------------------
// Entities API (E1.1 / REQ-ARCH-01..02).
//
// Postgres is the source of truth behind the existing `api.entities.<Name>`
// façade. Every record carries `owner_org_id`; reads and writes are scoped to
// the caller's org and its descendants (plus explicit grants) unless the role
// is a cross-org reader.
// ---------------------------------------------------------------------------

const ENTITY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function entityNameOk(name) {
  return typeof name === 'string' && ENTITY_RE.test(name);
}

function uuid() {
  return crypto.randomUUID();
}

function rowToRecord(row) {
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    owner_org_id: row.owner_org_id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    created_by: row.created_by,
    updated_by: row.updated_by,
  };
}

function sortRecords(rows, sort) {
  if (!sort || typeof sort !== 'string') return rows;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

// Determine the set of org ids this actor may read.
function readableOrgIds(actor) {
  if (!actor) return [];
  if (isCrossOrgReader(actor.membership)) return null; // null = all orgs
  return Array.from(new Set([actor.org_id, ...actor.descendant_ids, ...actor.granted_org_ids]));
}

export async function listRecords(entity, { query = {}, sort, limit, actor } = {}) {
  const params = [entity];
  const where = ['entity = $1', 'deleted = false'];
  const readable = readableOrgIds(actor);
  if (readable !== null) {
    params.push(readable);
    where.push(`(owner_org_id IS NULL OR owner_org_id = ANY($${params.length}))`);
  }
  // Push simple equality filters into the JSONB query.
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && typeof value === 'object') continue;
    params.push(key);
    const keyIdx = params.length;
    params.push(String(value));
    where.push(`data->>$${keyIdx} = $${params.length}`);
  }
  const sql = `SELECT * FROM entity_record WHERE ${where.join(' AND ')}`;
  const { rows } = await pool.query(sql, params);
  let records = rows.map(rowToRecord);
  // Apply remaining (array / $in) filters client-side for parity with the façade.
  for (const [key, value] of Object.entries(query || {})) {
    if (Array.isArray(value)) records = records.filter((r) => value.includes(r[key]));
    else if (value && typeof value === 'object' && value.$in) {
      records = records.filter((r) => value.$in.includes(r[key]));
    }
  }
  records = sortRecords(records, sort);
  if (typeof limit === 'number') records = records.slice(0, limit);
  return records;
}

export async function getRecord(entity, id, { actor } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [entity, id]
  );
  const row = rows[0];
  if (!row) return null;
  if (!canViewOrg(actor?.membership, row.owner_org_id, {
    descendantIds: actor?.descendant_ids || [],
    grantedOrgIds: actor?.granted_org_ids || [],
  }) && row.owner_org_id !== null) {
    const err = new Error('Not permitted to view this record');
    err.status = 403;
    throw err;
  }
  return rowToRecord(row);
}

export async function createRecord(entity, data, { actor } = {}) {
  const id = data.id || uuid();
  let ownerOrg = data.owner_org_id !== undefined ? data.owner_org_id : actor?.org_id || null;
  // Opportunities always start as a draft owned by the preparing subsidiary;
  // workflow and reviewer fields cannot be set by the create payload (WF-01).
  if (entity === OPPORTUNITY_ENTITY) {
    const checked = checkCreate(data, { actor });
    if (!checked.ok) throw policyError(checked);
    data = { ...checked.data, ...(data.id ? { id: data.id } : {}) };
    ownerOrg = checked.owner_org_id;
  }
  if (!canWriteOrg(actor?.membership, ownerOrg, {
    descendantIds: actor?.descendant_ids || [],
    grantedOrgIds: actor?.granted_org_ids || [],
  })) {
    const err = new Error('Not permitted to write to that organisation');
    err.status = 403;
    throw err;
  }
  const createdBy = data.created_by || actor?.email || null;
  const payload = { ...data };
  delete payload.data;
  delete payload.id;
  delete payload.created_date;
  delete payload.updated_date;
  const { rows } = await pool.query(
    `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
    [id, entity, ownerOrg, JSON.stringify(payload), createdBy]
  );
  const record = rowToRecord(rows[0]);
  await writeAudit({
    entity,
    entityId: id,
    action: 'create',
    actor,
    orgId: ownerOrg,
    after: record,
  });
  return record;
}

export async function bulkCreateRecords(entity, items = [], { actor } = {}) {
  const out = [];
  for (const item of items) out.push(await createRecord(entity, item, { actor }));
  return out;
}

// An opportunity edit runs under the same row lock as the workflow engine, so a
// save can never interleave with a submit or a decision, and goes through the
// write policy: system fields, the owning org and locked states are protected,
// and a material change after attestation clears the CEO/CFO attestations.
async function updateOpportunity(id, patch, { actor } = {}) {
  return withLockedOpportunity(id, async (client, row) => {
    if (!canViewOrg(actor?.membership, row.owner_org_id, {
      descendantIds: actor?.descendant_ids || [],
      grantedOrgIds: actor?.granted_org_ids || [],
    })) {
      const err = new Error('Not permitted to modify this record'); err.status = 403; throw err;
    }
    const checked = checkUpdate(row.data || {}, patch || {}, { actor, ownerOrgId: row.owner_org_id });
    if (!checked.ok) throw policyError(checked);
    if (!checked.changed.length) return rowToRecord(row);
    const before = rowToRecord(row);
    const { rows } = await client.query(
      `UPDATE entity_record SET data = (CASE WHEN $4 THEN data - 'attestations' ELSE data END) || $3::jsonb,
         updated_date = now(), updated_by = $5
       WHERE entity = $1 AND id = $2 RETURNING *`,
      [OPPORTUNITY_ENTITY, id, JSON.stringify(checked.patch), checked.clearAttestations, actor?.email || null]
    );
    const after = rowToRecord(rows[0]);
    await writeAudit({ client, entity: OPPORTUNITY_ENTITY, entityId: id, action: 'update', actor, orgId: row.owner_org_id, before, after });
    if (checked.clearAttestations) {
      await writeAudit({
        client, entity: OPPORTUNITY_ENTITY, entityId: id, action: 'attestations_invalidated', actor, orgId: row.owner_org_id,
        before: { attestations: Object.keys(row.data?.attestations || {}) },
        after: { changed: checked.changed },
        comment: 'Figures changed after the CEO/CFO attestation; both must attest again (INT-09)',
      });
    }
    return after;
  });
}

export async function updateRecord(entity, id, patch, { actor } = {}) {
  if (entity === OPPORTUNITY_ENTITY) return updateOpportunity(id, patch, { actor });
  const { rows: existing } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [entity, id]
  );
  const row = existing[0];
  if (!row) {
    const err = new Error(`${entity} with id "${id}" was not found`);
    err.status = 404;
    throw err;
  }
  if (!canWriteOrg(actor?.membership, row.owner_org_id, {
    descendantIds: actor?.descendant_ids || [],
    grantedOrgIds: actor?.granted_org_ids || [],
  })) {
    const err = new Error('Not permitted to modify this record');
    err.status = 403;
    throw err;
  }
  const before = rowToRecord(row);
  const patched = { ...row.data, ...patch };
  delete patched.id;
  delete patched.created_date;
  delete patched.updated_date;
  const ownerOrg = patch.owner_org_id !== undefined ? patch.owner_org_id : row.owner_org_id;
  // Moving a record to another organisation needs write access to the target
  // too, or a user could push their data into a sibling's scope.
  if (ownerOrg !== row.owner_org_id && !canWriteOrg(actor?.membership, ownerOrg, {
    descendantIds: actor?.descendant_ids || [],
    grantedOrgIds: actor?.granted_org_ids || [],
  })) {
    const err = new Error('Not permitted to move this record to that organisation');
    err.status = 403;
    throw err;
  }
  const { rows } = await pool.query(
    `UPDATE entity_record SET data = $3, owner_org_id = $4, updated_date = now(), updated_by = $5
      WHERE entity = $1 AND id = $2 RETURNING *`,
    [entity, id, JSON.stringify(patched), ownerOrg, actor?.email || null]
  );
  const after = rowToRecord(rows[0]);
  await writeAudit({ entity, entityId: id, action: 'update', actor, orgId: ownerOrg, before, after });
  return after;
}

export async function deleteRecord(entity, id, { actor } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [entity, id]
  );
  const row = rows[0];
  if (!row) return { id };
  if (!canWriteOrg(actor?.membership, row.owner_org_id, {
    descendantIds: actor?.descendant_ids || [],
    grantedOrgIds: actor?.granted_org_ids || [],
  })) {
    const err = new Error('Not permitted to delete this record');
    err.status = 403;
    throw err;
  }
  // A submitted opportunity is history: only a draft can be deleted (INT-13).
  if (entity === OPPORTUNITY_ENTITY) {
    const checked = checkDelete(row.data || {}, { actor, ownerOrgId: row.owner_org_id });
    if (!checked.ok) throw policyError(checked);
  }
  await pool.query('UPDATE entity_record SET deleted = true, updated_date = now() WHERE entity = $1 AND id = $2', [entity, id]);
  await writeAudit({ entity, entityId: id, action: 'delete', actor, orgId: row.owner_org_id, before: rowToRecord(row) });
  return { id };
}

// ---------------------------------------------------------------------------
// HTTP routes — /api/entities/:entity[/:id]
// ---------------------------------------------------------------------------
export const entitiesRouter = express.Router();

entitiesRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) {
    next(err);
  }
});

function guardEntity(req, res, next) {
  if (!entityNameOk(req.params.entity)) return res.status(400).json({ error: 'Invalid entity name' });
  next();
}

function parseQuery(req) {
  const { filter, sort, limit } = req.query;
  let q = {};
  if (filter) {
    try { q = JSON.parse(filter); } catch { q = {}; }
  }
  return { query: q, sort, limit: limit ? Number(limit) : undefined, actor: req.actor };
}

function abacResource(entity) {
  const e = String(entity).toLowerCase();
  return ABAC_RESOURCES.includes(e) ? e : 'analytics';
}

function recordAbacContext(rec) {
  const r = rec || {};
  const ctx = {};
  if (r.geography !== undefined) ctx.geography = r.geography;
  if (r.region !== undefined && ctx.geography === undefined) ctx.geography = r.region;
  if (r.sector !== undefined) ctx.sector = r.sector;
  if (r.industry !== undefined && ctx.sector === undefined) ctx.sector = r.industry;
  if (r.commitment_aed !== undefined) ctx.commitment_aed = r.commitment_aed;
  if (r.related_party !== undefined) ctx.related_party = r.related_party;
  if (r.flag !== undefined) ctx.flag = r.flag;
  return ctx;
}

async function enforceAbac(req, resource, context) {
  const res = await evaluateAbac(req.actor, resource, 'read', context || {});
  if (!res.allowed) {
    const err = new Error(res.reason || 'Access denied by attribute-based policy');
    err.status = 403;
    throw err;
  }
  return res;
}

function sendErr(res, err) {
  res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) });
}

entitiesRouter.get('/:entity', guardEntity, async (req, res) => {
  try {
    // Coarse resource-level ABAC guard first; then per-record filtering below.
    await enforceAbac(req, abacResource(req.params.entity), { orgId: req.actor?.org_id });
    const records = await listRecords(req.params.entity, parseQuery(req));
    const allowed = [];
    for (const rec of records) {
      const evalRes = await evaluateAbac(req.actor, abacResource(req.params.entity), 'read', recordAbacContext(rec));
      if (evalRes.allowed) allowed.push(rec);
    }
    res.json(allowed);
  } catch (err) { sendErr(res, err); }
});

entitiesRouter.get('/:entity/:id', guardEntity, async (req, res) => {
  try {
    const rec = await getRecord(req.params.entity, req.params.id, { actor: req.actor });
    if (!rec) return res.status(404).json({ error: 'Not found' });
    await enforceAbac(req, abacResource(req.params.entity), recordAbacContext(rec));
    res.json(rec);
  } catch (err) { sendErr(res, err); }
});

entitiesRouter.post('/:entity', guardEntity, async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      return res.status(201).json(await bulkCreateRecords(req.params.entity, req.body, { actor: req.actor }));
    }
    res.status(201).json(await createRecord(req.params.entity, req.body || {}, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

entitiesRouter.put('/:entity/:id', guardEntity, async (req, res) => {
  try {
    res.json(await updateRecord(req.params.entity, req.params.id, req.body || {}, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

entitiesRouter.patch('/:entity/:id', guardEntity, async (req, res) => {
  try {
    res.json(await updateRecord(req.params.entity, req.params.id, req.body || {}, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

entitiesRouter.delete('/:entity/:id', guardEntity, async (req, res) => {
  try {
    res.json(await deleteRecord(req.params.entity, req.params.id, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

// Audit viewer (E2.5).
export const auditRouter = express.Router();
auditRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});
auditRouter.get('/', async (req, res) => {
  try {
    const { entity, entity_id: entityId, limit } = req.query;
    const rows = await listAuditEvents({
      entity,
      entityId,
      orgId: isCrossOrgReader(req.actor?.membership) ? undefined : req.actor?.org_id,
      limit,
    });
    res.json(rows);
  } catch (err) { sendErr(res, err); }
});

export default entitiesRouter;
