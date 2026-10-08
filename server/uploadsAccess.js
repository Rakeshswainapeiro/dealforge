import path from 'node:path';
import fs from 'node:fs';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canViewOrg, isCrossOrgReader } from './rbac.js';
import { isReviewer } from './config/workflowStates.js';
import { UPLOAD_DIR } from './storage.js';

// ---------------------------------------------------------------------------
// Local-disk files (DOC-02, PLT-02). A file is served only to someone allowed
// to see the record it belongs to: a submission document or a strategy
// document follows its organisation (an internal Q&A attachment, the Sirius
// team only); a generic upload follows its uploader and their organisation.
// Unknown names are 404, files are never listed, and the response is a
// download with nosniff, so an uploaded file cannot run as a page.
// ---------------------------------------------------------------------------

const scope = (actor) => ({ descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids });

export async function mayReadUpload(actor, filename) {
  const { rows: docs } = await pool.query(
    'SELECT owner_org_id, requirement_key FROM submission_document WHERE filename = $1 AND deleted = false LIMIT 1', [filename]
  );
  if (docs[0]) {
    if (!canViewOrg(actor.membership, docs[0].owner_org_id, scope(actor))) return false;
    if (String(docs[0].requirement_key).startsWith('qa_attachment:')) {
      const threadId = docs[0].requirement_key.split(':')[1];
      const { rows: t } = await pool.query('SELECT visibility FROM qa_thread WHERE id = $1', [threadId]);
      if (t[0]?.visibility === 'internal' && !isReviewer(actor)) return false;
    }
    return true;
  }
  const { rows: strat } = await pool.query('SELECT org_id FROM strategy_document WHERE filename = $1 LIMIT 1', [filename]).catch(() => ({ rows: [] }));
  if (strat[0]) return canViewOrg(actor.membership, strat[0].org_id, scope(actor));
  const { rows: ups } = await pool.query('SELECT uploaded_by, org_id FROM uploads WHERE filename = $1 LIMIT 1', [filename]);
  if (ups[0]) {
    if (String(ups[0].uploaded_by || '').toLowerCase() === String(actor.email || '').toLowerCase()) return true;
    if (ups[0].org_id) return canViewOrg(actor.membership, ups[0].org_id, scope(actor));
    return isCrossOrgReader(actor.membership);
  }
  return null; // unknown
}

export async function serveUpload(req, res) {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(401).json({ error: 'Sign in required' });
    let filename;
    try { filename = path.basename(decodeURIComponent(req.path || '')); } catch { return res.status(404).json({ error: 'Not found' }); }
    if (!filename || filename.startsWith('.')) return res.status(404).json({ error: 'Not found' });
    const allowed = await mayReadUpload(actor, filename);
    if (allowed === null) return res.status(404).json({ error: 'Not found' });
    if (!allowed) return res.status(403).json({ error: 'Not permitted to read this file' });
    const file = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename.replace(/[^\w.\- ]/g, '_') + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return fs.createReadStream(file).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default serveUpload;
