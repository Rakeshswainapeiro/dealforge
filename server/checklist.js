import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  DOCUMENT_CHECKLIST_CONFIG_KEY,
  CHECKLIST_MESSAGES,
  defaultDocumentChecklist,
  validateDocumentChecklist,
  resolveDocumentChecklist,
  diffDocumentChecklist,
  buildDocumentChecklist,
} from './config/documentChecklist.js';

// ---------------------------------------------------------------------------
// Document checklist API (W5-01 / BRD DOC-01).
//
// The type / stage / flag-driven document checklist is held in an AppSettings
// record (setting_key = 'document_checklist_config'). Reads fall back to the
// shipped default, which reproduces the standing MVP document gate, so nothing
// new blocks until an administrator changes it. Writes require the admin /
// configurator role and mint the next revision.
// ---------------------------------------------------------------------------

export async function loadDocumentChecklistConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [DOCUMENT_CHECKLIST_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultDocumentChecklist();
    return resolveDocumentChecklist(rows[0].setting_value);
  } catch {
    return defaultDocumentChecklist();
  }
}

async function persistChecklist(config, actor) {
  const payload = {
    setting_key: DOCUMENT_CHECKLIST_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Document checklist (type / stage / flag-driven, per-item tier and rule)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [DOCUMENT_CHECKLIST_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'document-checklist-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const checklistRouter = express.Router();

checklistRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/checklist - the effective checklist (any authenticated reader).
checklistRouter.get('/', async (_req, res) => {
  try {
    const config = await loadDocumentChecklistConfig();
    const { ok, errors } = validateDocumentChecklist(config);
    res.json({ config, valid: ok, errors, defaults: defaultDocumentChecklist() });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/checklist - replace the checklist and mint a revision.
checklistRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the document checklist' });
    }
    const base = await loadDocumentChecklistConfig();
    const config = buildDocumentChecklist(req.body || {}, { actor: req.actor, base });
    const changes = diffDocumentChecklist(base, config);
    const id = await persistChecklist(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'document_checklist_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/checklist/history - the revision history (audit trail).
checklistRouter.get('/history', async (req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'document_checklist_updated'));
  } catch (err) { sendErr(res, err); }
});

export { CHECKLIST_MESSAGES };
export default checklistRouter;
