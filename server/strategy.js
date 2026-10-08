// ---------------------------------------------------------------------------
// Entity & strategy library API (W4-02/W4-03/W4-04, BRD ENT-01/ENT-02/ENT-03).
//
// Strategy documents are uploaded against an entity (org) and indexed into
// citable passages (W4-02, ENT-02) so the alignment engine can quote a source
// passage. The structured strategy profile is versioned, and the version used
// for each screening is recorded (W4-03, ENT-01). The group mandate and the
// entity themes remain admin-editable and audited (W4-04, ENT-03).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure, canViewOrg, canWriteOrg } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { saveFile, getObjectBuffer, scopedObjectKey } from './storage.js';
import { uploadFilter, UPLOAD_MAX_BYTES, assertContentMatches } from './security.js';
import {
  STRATEGY_INDEX_VERSION, STRATEGY_DOC_FORMATS, STRATEGY_STATUS, STRATEGY_MESSAGES,
  isIndexableFormat, extractText, buildPassages, rankPassages, bestCitation,
} from './config/strategyIndex.js';
import { getTheme, getThresholds } from './themes.js';

const uuid = () => crypto.randomUUID();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES }, fileFilter: uploadFilter });

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

function docToRecord(row, { withPassages = false } = {}) {
  const rec = {
    id: row.id,
    org_id: row.org_id,
    original_name: row.original_name,
    mimetype: row.mimetype,
    size: row.size != null ? Number(row.size) : null,
    format: row.format,
    status: row.status,
    index_reason: row.index_reason,
    char_count: row.char_count,
    passage_count: row.passage_count,
    index_version: row.index_version,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
    indexed_at: row.indexed_at,
    file_url: row.object_key ? '/api/files/' + String(row.object_key).split('/').map(encodeURIComponent).join('/') : null,
  };
  if (withPassages) rec.passages = Array.isArray(row.passages) ? row.passages : [];
  return rec;
}

// Turn a stored document into citable passages and persist them. Returns the
// up-to-date record. Never throws on an unindexable format: the document keeps
// its 'stored' status and names the reason (ENT-02 - upload never fails on
// extraction, but the alignment engine only sees what was indexed).
export async function indexStrategyDocument(id, { buffer, actor } = {}) {
  const { rows } = await pool.query('SELECT * FROM strategy_document WHERE id = $1 AND deleted = false', [id]);
  const doc = rows[0];
  if (!doc) { const e = new Error('Strategy document not found'); e.status = 404; throw e; }
  let content = buffer;
  if (!content && doc.object_key) {
    content = await getObjectBuffer(doc.object_key).catch(() => null);
  }
  const extracted = extractText({ buffer: content, filename: doc.original_name, format: doc.format });
  if (!extracted.ok) {
    const { rows: upd } = await pool.query(
      `UPDATE strategy_document SET status = 'stored', index_reason = $2, passages = '[]'::jsonb,
         char_count = 0, passage_count = 0 WHERE id = $1 RETURNING *`,
      [id, extracted.reason || STRATEGY_MESSAGES.stored_only]
    );
    return docToRecord(upd[0], { withPassages: true });
  }
  const passages = buildPassages(extracted.text).map((text, index) => ({ index, text }));
  const { rows: upd } = await pool.query(
    `UPDATE strategy_document SET status = 'indexed', index_reason = NULL, passages = $2::jsonb,
       char_count = $3, passage_count = $4, index_version = $5, indexed_at = now()
     WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(passages), extracted.text.length, passages.length, STRATEGY_INDEX_VERSION]
  );
  await writeAudit({
    entity: 'strategy_document', entityId: id, action: 'indexed', actor, orgId: doc.org_id,
    after: { passage_count: passages.length, char_count: extracted.text.length, index_version: STRATEGY_INDEX_VERSION },
  });
  return docToRecord(upd[0], { withPassages: true });
}

// The indexed passages for an org, across its documents, each tagged with the
// document it came from. This is the corpus the alignment citation reads.
export async function loadStrategyCorpus(orgId) {
  const { rows } = await pool.query(
    "SELECT id, original_name, passages FROM strategy_document WHERE org_id = $1 AND deleted = false AND status = 'indexed' ORDER BY uploaded_at DESC",
    [orgId]
  );
  const passages = [];
  for (const row of rows) {
    const list = Array.isArray(row.passages) ? row.passages : [];
    for (const p of list) {
      passages.push({ document_id: row.id, document_name: row.original_name, index: p.index, text: p.text });
    }
  }
  return { documents: rows.length, passages };
}

// Search the corpus for a query; returns the top passages with their source.
export function searchStrategyCorpus(corpus, query, { limit } = {}) {
  return rankPassages(corpus?.passages || [], query, { limit: limit || undefined });
}

// --- versioned structured profile (W4-03 / ENT-01) -------------------------

export const STRATEGY_PROFILE_KEY_FIELDS = ['mission', 'sectors', 'geographies', 'focus_areas', 'constraints'];

// Build the structured profile from what the entity already holds: the approved
// theme (sector / keywords / geographies / size band) and the mandate
// thresholds. An operator may override any field when publishing a new version.
export async function deriveStrategyProfile(orgId, overrides = {}) {
  const theme = await getTheme(orgId);
  const thresholds = await getThresholds(orgId);
  const profile = {
    mission: overrides.mission || theme?.description || null,
    sectors: overrides.sectors || (theme?.sector ? [theme.sector] : []),
    geographies: overrides.geographies || theme?.geographies || [],
    focus_areas: overrides.focus_areas || theme?.keywords || [],
    constraints: overrides.constraints || {
      floor_aed: thresholds?.floor_aed ?? null,
      equity_irr_min: thresholds?.equity_irr_min ?? null,
      leverage_max: thresholds?.leverage_max ?? null,
    },
  };
  return profile;
}

export async function getLatestStrategyProfile(orgId) {
  const { rows } = await pool.query(
    "SELECT * FROM strategy_profile WHERE org_id = $1 AND status = 'published' ORDER BY version DESC LIMIT 1",
    [orgId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, org_id: row.org_id, version: row.version, profile: row.profile || {},
    summary: row.summary, status: row.status,
    source_document_ids: row.source_document_ids || [],
    published_by: row.published_by, published_at: row.published_at,
  };
}

// Record the strategy profile version a screening used (W4-03 / ENT-01). One
// row per opportunity holds the latest snapshot; a change of version is a new
// audit event so the retained history is self-explanatory. Idempotent by
// opportunity id.
export async function recordScreeningSnapshot(opportunityId, { orgId, profile = null, strategy = null, alignment = null, panel = null, actor } = {}) {
  const { rows: existing } = await pool.query('SELECT * FROM screening_record WHERE opportunity_id = $1', [opportunityId]);
  const prior = existing[0] || null;
  const id = prior?.id || uuid();
  await pool.query(
    `INSERT INTO screening_record
       (id, opportunity_id, owner_org_id, strategy_profile_id, strategy_profile_version,
        strategy_document_count, alignment_score, panel_version, recommended, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (opportunity_id) DO UPDATE SET
       owner_org_id = EXCLUDED.owner_org_id,
       strategy_profile_id = EXCLUDED.strategy_profile_id,
       strategy_profile_version = EXCLUDED.strategy_profile_version,
       strategy_document_count = EXCLUDED.strategy_document_count,
       alignment_score = EXCLUDED.alignment_score,
       panel_version = EXCLUDED.panel_version,
       recommended = EXCLUDED.recommended,
       recorded_by = EXCLUDED.recorded_by,
       updated_at = now()`,
    [id, opportunityId, orgId, profile?.id || null, profile?.version ?? null,
      (strategy?.documents || 0), alignment?.score ?? null, panel?.version || null,
      panel?.summary?.recommended || null, actor?.email || null]
  );
  if (!prior || prior.strategy_profile_version !== (profile?.version ?? null)) {
    await writeAudit({
      entity: 'screening_record', entityId: id, action: 'recorded', actor, orgId,
      before: { strategy_profile_version: prior?.strategy_profile_version ?? null },
      after: { strategy_profile_version: profile?.version ?? null, alignment_score: alignment?.score ?? null },
    });
  }
  const { rows } = await pool.query('SELECT * FROM screening_record WHERE opportunity_id = $1', [opportunityId]);
  const row = rows[0];
  return {
    id: row.id, opportunity_id: row.opportunity_id, owner_org_id: row.owner_org_id,
    strategy_profile_id: row.strategy_profile_id, strategy_profile_version: row.strategy_profile_version,
    strategy_document_count: row.strategy_document_count, alignment_score: row.alignment_score,
    panel_version: row.panel_version, recommended: row.recommended,
    recorded_by: row.recorded_by, recorded_at: row.updated_at,
  };
}

export async function getScreeningSnapshot(opportunityId) {
  const { rows } = await pool.query('SELECT * FROM screening_record WHERE opportunity_id = $1', [opportunityId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, opportunity_id: row.opportunity_id, owner_org_id: row.owner_org_id,
    strategy_profile_id: row.strategy_profile_id, strategy_profile_version: row.strategy_profile_version,
    strategy_document_count: row.strategy_document_count, alignment_score: row.alignment_score,
    panel_version: row.panel_version, recommended: row.recommended,
    recorded_by: row.recorded_by, recorded_at: row.updated_at,
  };
}

export async function publishStrategyProfile(orgId, { profile, summary, sourceDocumentIds = [], actor } = {}) {
  const { rows: prior } = await pool.query('SELECT COALESCE(MAX(version),0)::int AS v FROM strategy_profile WHERE org_id = $1', [orgId]);
  const version = prior[0].v + 1;
  const id = uuid();
  const { rows } = await pool.query(
    `INSERT INTO strategy_profile (id, org_id, version, profile, summary, status, source_document_ids, published_by)
     VALUES ($1,$2,$3,$4,$5,'published',$6,$7) RETURNING *`,
    [id, orgId, version, JSON.stringify(profile || {}), summary || null, JSON.stringify(sourceDocumentIds), actor?.email || null]
  );
  await writeAudit({
    entity: 'strategy_profile', entityId: id, action: 'published', actor, orgId,
    before: { version: prior[0].v || null }, after: { version, profile: rows[0].profile, summary },
  });
  return { id, org_id: orgId, version, profile: rows[0].profile, summary, status: 'published', source_document_ids: sourceDocumentIds, published_by: rows[0].published_by, published_at: rows[0].published_at };
}

// --- router ----------------------------------------------------------------

export const strategyRouter = express.Router();

strategyRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function orgFromQuery(req) {
  return req.query.org_id || req.actor.org_id;
}

// GET /api/strategy/config - the indexer's shape (any authenticated reader).
strategyRouter.get('/config', (_req, res) => {
  res.json({ version: STRATEGY_INDEX_VERSION, formats: STRATEGY_DOC_FORMATS, statuses: STRATEGY_STATUS, messages: STRATEGY_MESSAGES });
});

// GET /api/strategy/documents?org_id= - the entity's strategy documents.
strategyRouter.get('/documents', async (req, res) => {
  try {
    const orgId = orgFromQuery(req);
    if (!canViewOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view those strategy documents' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM strategy_document WHERE org_id = $1 AND deleted = false ORDER BY uploaded_at DESC',
      [orgId]
    );
    res.json({ org_id: orgId, documents: rows.map((r) => docToRecord(r)) });
  } catch (err) { sendErr(res, err); }
});

// POST /api/strategy/documents?org_id= - upload and index a strategy document.
strategyRouter.post('/documents', upload.single('file'), async (req, res) => {
  try {
    const orgId = req.body?.org_id || req.actor.org_id;
    if (!canWriteOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to add strategy documents to this entity' });
    }
    if (!req.file?.buffer) return res.status(400).json({ error: 'A file is required' });
    assertContentMatches(req.file.buffer, req.file.originalname);
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const key = scopedObjectKey({ orgId, opportunityId: 'strategy', originalName: req.file.originalname });
    const saved = await saveFile({ buffer: req.file.buffer, originalName: req.file.originalname, mimetype: req.file.mimetype, key });
    const dot = String(req.file.originalname).lastIndexOf('.') ;
    const format = dot < 0 ? '' : String(req.file.originalname).slice(dot).toLowerCase();
    const id = uuid();
    await pool.query(
      `INSERT INTO strategy_document (id, org_id, filename, original_name, mimetype, size, object_key, sha256, format, status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'stored',$10)`,
      [id, orgId, saved.filename, saved.original_name, saved.mimetype, saved.size, saved.key, sha256, format, req.actor.email]
    );
    await writeAudit({ entity: 'strategy_document', entityId: id, action: 'upload', actor: req.actor, orgId, after: { original_name: saved.original_name, sha256 } });
    // Index synchronously so the passages are available to the alignment engine
    // well inside the ten-minute window (ENT-02). Extraction is in-process and
    // dependency-free, so this returns in milliseconds for text-bearing formats.
    const indexed = isIndexableFormat(req.file.originalname)
      ? await indexStrategyDocument(id, { buffer: req.file.buffer, actor: req.actor })
      : docToRecord((await pool.query('SELECT * FROM strategy_document WHERE id = $1', [id])).rows[0], { withPassages: true });
    res.status(201).json(indexed);
  } catch (err) { sendErr(res, err); }
});

// POST /api/strategy/documents/:id/reindex - re-run indexing on a document.
strategyRouter.post('/documents/:id/reindex', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM strategy_document WHERE id = $1 AND deleted = false', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Strategy document not found' });
    if (!canWriteOrg(req.actor.membership, rows[0].org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to reindex this document' });
    }
    res.json(await indexStrategyDocument(req.params.id, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

// DELETE /api/strategy/documents/:id - soft-delete a document.
strategyRouter.delete('/documents/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM strategy_document WHERE id = $1 AND deleted = false', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Strategy document not found' });
    if (!canWriteOrg(req.actor.membership, rows[0].org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to remove this document' });
    }
    await pool.query('UPDATE strategy_document SET deleted = true WHERE id = $1', [req.params.id]);
    await writeAudit({ entity: 'strategy_document', entityId: req.params.id, action: 'delete', actor: req.actor, orgId: rows[0].org_id });
    res.json({ ok: true, deleted: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/strategy/search?org_id=&q= - the citable passages for a query.
strategyRouter.get('/search', async (req, res) => {
  try {
    const orgId = orgFromQuery(req);
    if (!canViewOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to read those strategy documents' });
    }
    const q = req.query.q || '';
    const corpus = await loadStrategyCorpus(orgId);
    res.json({ org_id: orgId, query: q, documents: corpus.documents, citations: searchStrategyCorpus(corpus, q) });
  } catch (err) { sendErr(res, err); }
});

// GET /api/strategy/profile?org_id= - the published profile + its history.
strategyRouter.get('/profile', async (req, res) => {
  try {
    const orgId = orgFromQuery(req);
    if (!canViewOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view that profile' });
    }
    const [current, derived] = await Promise.all([getLatestStrategyProfile(orgId), deriveStrategyProfile(orgId)]);
    const { rows: history } = await pool.query(
      'SELECT version, summary, status, published_by, published_at FROM strategy_profile WHERE org_id = $1 ORDER BY version DESC LIMIT 20',
      [orgId]
    );
    res.json({ org_id: orgId, current, derived, history });
  } catch (err) { sendErr(res, err); }
});

// POST /api/strategy/profile?org_id= - publish a new versioned profile.
strategyRouter.post('/profile', async (req, res) => {
  try {
    const orgId = req.body?.org_id || req.actor.org_id;
    if (!canConfigure(req.actor.membership) && !canWriteOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to publish a strategy profile for this entity' });
    }
    const derived = await deriveStrategyProfile(orgId, req.body?.profile || {});
    const { rows: docs } = await pool.query("SELECT id FROM strategy_document WHERE org_id = $1 AND deleted = false AND status = 'indexed'", [orgId]);
    const profile = await publishStrategyProfile(orgId, {
      profile: derived,
      summary: req.body?.summary || null,
      sourceDocumentIds: req.body?.source_document_ids || docs.map((d) => d.id),
      actor: req.actor,
    });
    res.status(201).json(profile);
  } catch (err) { sendErr(res, err); }
});

// GET /api/strategy/profile/history?org_id= - the version audit trail.
strategyRouter.get('/profile/history', async (req, res) => {
  try {
    const orgId = orgFromQuery(req);
    res.json({ org_id: orgId, events: await listAuditEvents({ entity: 'strategy_profile', orgId, limit: 50 }) });
  } catch (err) { sendErr(res, err); }
});

export default { strategyRouter, indexStrategyDocument, loadStrategyCorpus, searchStrategyCorpus, deriveStrategyProfile, getLatestStrategyProfile, publishStrategyProfile, bestCitation, recordScreeningSnapshot, getScreeningSnapshot };
