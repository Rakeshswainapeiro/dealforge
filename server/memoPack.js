import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg } from './rbac.js';
import { getOrganization } from './org.js';
import { evaluateAlignment } from './themes.js';
import { listDocuments } from './gate.js';
import { buildSiriusMemo } from './config/siriusMemo.js';
import {
  MEMO_PACK_KEY, MEMO_PACK_TITLE, MEMO_PACK_FORMATS, PACK_PAGE_ORDER, MEMO_PACK_MESSAGES,
  buildMemoPackManifest, packFilenameStem, renderMemoPack,
} from './config/memoPack.js';

// ---------------------------------------------------------------------------
// Opportunity Overview pack (W7-04 / BRD OUT-02).
//
// GET /api/memo-pack                              -> formats + template page order
// GET /api/memo-pack/opportunities/:id            -> the six-page pack manifest
// GET /api/memo-pack/opportunities/:id.:format     -> the downloadable pack
//        (.html = print-ready, six pages in Part B order; .md = plain text)
//
// The pack is the export form of the Sirius Investment Framework Part B
// Opportunity Overview. It reads the opportunity through the same org-visibility
// rule as the pipeline and the .docx memo, so a cross-tenant caller gets 403 and
// never sees the document. Assembly is deterministic and reuses the memo model,
// so the pack, the on-screen preview and the .docx can never disagree.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';

export const memoPackRouter = express.Router();

memoPackRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

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
  const memo = buildSiriusMemo({ opportunity: row, org, documents, alignment });
  return { row, org, memo };
}

// GET / - the pack vocabulary: formats, page order, provenance note.
memoPackRouter.get('/', async (_req, res) => {
  try {
    res.json({
      key: MEMO_PACK_KEY,
      title: MEMO_PACK_TITLE,
      formats: MEMO_PACK_FORMATS,
      page_order: PACK_PAGE_ORDER,
      messages: MEMO_PACK_MESSAGES,
    });
  } catch (err) { sendErr(res, err); }
});

// GET /opportunities/:id.:ext - the downloadable pack in the given format.
// Registered before the manifest route: Express matches `:id` across dots, so a
// plain `/opportunities/:id` would otherwise swallow `/opportunities/abc.html`.
memoPackRouter.get('/opportunities/:id.:ext', async (req, res) => {
  try {
    const format = String(req.params.ext || 'html').toLowerCase();
    if (!MEMO_PACK_FORMATS.some((f) => f.key === format)) {
      return res.status(400).json({ error: 'Unsupported pack format: ' + format, supported: MEMO_PACK_FORMATS.map((f) => f.key) });
    }
    const { row, org, memo } = await loadMemoInputs(req);
    const rendered = renderMemoPack(memo, format);
    const filename = packFilenameStem(memo) + '.' + rendered.extension;
    res.setHeader('Content-Type', rendered.mime);
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'memo_pack_export',
      actor: req.actor, orgId: row.owner_org_id,
      after: { format: rendered.format, pages: memo.pages.length, subsidiary: org?.name || null },
    });
    res.send(rendered.body);
  } catch (err) { sendErr(res, err); }
});

// GET /opportunities/:id - the manifest, including the verified page order.
memoPackRouter.get('/opportunities/:id', async (req, res) => {
  try {
    const { row, memo } = await loadMemoInputs(req);
    const manifest = buildMemoPackManifest(memo);
    manifest.opportunity_id = row.id;
    res.json(manifest);
  } catch (err) { sendErr(res, err); }
});

export default memoPackRouter;
