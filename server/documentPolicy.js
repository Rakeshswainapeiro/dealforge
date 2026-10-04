import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  DOCUMENT_POLICY_CONFIG_KEY, DOCUMENT_POLICY_MESSAGES,
  defaultDocumentPolicy, validateDocumentPolicy, resolveDocumentPolicy,
  diffDocumentPolicy, buildDocumentPolicy,
} from './config/documentPolicy.js';

// ---------------------------------------------------------------------------
// Document upload policy API (W5-02 / BRD DOC-02).
//
// The size cap, the accepted-type allow-list and the scan settings are held in
// an AppSettings record (setting_key = 'document_policy_config'). Reads fall
// back to the shipped default (50 MB, PDF/DOCX/XLSX/PPTX plus the legacy set
// outside production). Writes require the admin / configurator role and mint the
// next revision.
// ---------------------------------------------------------------------------

export async function loadDocumentPolicyConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [DOCUMENT_POLICY_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultDocumentPolicy();
    return resolveDocumentPolicy(rows[0].setting_value);
  } catch {
    return defaultDocumentPolicy();
  }
}

async function persistPolicy(config, actor) {
  const payload = {
    setting_key: DOCUMENT_POLICY_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Document upload policy (size cap, accepted types, upload scan)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [DOCUMENT_POLICY_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'document-policy-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const documentPolicyRouter = express.Router();

documentPolicyRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/document-policy - the effective policy (any authenticated reader).
documentPolicyRouter.get('/', async (_req, res) => {
  try {
    const config = await loadDocumentPolicyConfig();
    const { ok, errors } = validateDocumentPolicy(config);
    res.json({ config, valid: ok, errors, defaults: defaultDocumentPolicy() });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/document-policy - replace the policy and mint a revision.
documentPolicyRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the document policy' });
    }
    const base = await loadDocumentPolicyConfig();
    const config = buildDocumentPolicy(req.body || {}, { actor: req.actor, base });
    const changes = diffDocumentPolicy(base, config);
    const id = await persistPolicy(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'document_policy_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/document-policy/history - the revision history (audit trail).
documentPolicyRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'document_policy_updated'));
  } catch (err) { sendErr(res, err); }
});

export { DOCUMENT_POLICY_MESSAGES };
export default documentPolicyRouter;
