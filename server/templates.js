import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  TEMPLATE_LIBRARY_CONFIG_KEY,
  TEMPLATE_LIBRARY_MESSAGES,
  defaultTemplateLibraryConfig,
  validateTemplateLibraryConfig,
  resolveTemplateLibraryConfig,
  diffTemplateLibraryConfig,
  buildTemplateLibraryConfig,
  templateCatalogue,
} from './config/templateLibrary.js';
import { renderTemplate } from './templateRender.js';

// ---------------------------------------------------------------------------
// Document template library API (W5-05 / BRD DOC-06).
//
// The library is held in an AppSettings record (setting_key =
// 'template_library_config') so the Investment Team can maintain the labels,
// owners and availability of the standard templates without a deploy. Reads
// fall back to the shipped default, so nothing changes until an administrator
// edits it. The artefacts themselves are rendered on demand from the same
// configuration the memo and the gates use, so a download is always the
// current version.
// ---------------------------------------------------------------------------

export async function loadTemplateLibraryConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [TEMPLATE_LIBRARY_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultTemplateLibraryConfig();
    return resolveTemplateLibraryConfig(rows[0].setting_value);
  } catch {
    return defaultTemplateLibraryConfig();
  }
}

async function persistTemplateLibrary(config, actor) {
  const payload = {
    setting_key: TEMPLATE_LIBRARY_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Document template library (maintained template metadata)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [TEMPLATE_LIBRARY_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'template-library-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const templatesRouter = express.Router();

templatesRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/templates - the effective catalogue (any authenticated reader).
templatesRouter.get('/', async (_req, res) => {
  try {
    const config = await loadTemplateLibraryConfig();
    const { ok, errors } = validateTemplateLibraryConfig(config);
    res.json({
      config,
      templates: templateCatalogue(config),
      valid: ok,
      errors,
      defaults: defaultTemplateLibraryConfig(),
      disclaimer: TEMPLATE_LIBRARY_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/templates - replace the maintained metadata and mint a revision.
templatesRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the template library' });
    }
    const base = await loadTemplateLibraryConfig();
    const config = buildTemplateLibraryConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffTemplateLibraryConfig(base, config);
    const id = await persistTemplateLibrary(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'template_library_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/templates/history - the revision history (audit trail).
templatesRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'template_library_updated'));
  } catch (err) { sendErr(res, err); }
});

// GET /api/templates/:id/download - render the current version and stream it.
templatesRouter.get('/:id/download', async (req, res) => {
  try {
    const config = await loadTemplateLibraryConfig();
    const row = resolveTemplateLibraryConfig(config).templates.find((t) => t.id === req.params.id);
    if (!row || row.enabled === false) return res.status(404).json({ error: 'Unknown template (' + req.params.id + ')' });
    const { buffer, filename, contentType } = await renderTemplate(req.params.id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('X-Template-Version', config.version || '');
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (err) { sendErr(res, err); }
});

export default templatesRouter;
