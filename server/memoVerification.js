import express from 'express';
import QRCode from 'qrcode';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg } from './rbac.js';
import { getOrganization } from './org.js';
import { evaluateAlignment } from './themes.js';
import { listDocuments } from './gate.js';
import { buildSiriusMemo } from './config/siriusMemo.js';
import { authSecret } from './auth.js';
import {
  MEMO_VERIFICATION_KEY, MEMO_VERIFICATION_TITLE, MEMO_VERIFICATION_VERSION,
  FINGERPRINT_FIELDS, VERIFY_PARAMS, VERIFY_RESULTS, MEMO_VERIFICATION_MESSAGES,
  memoFingerprint, issueVerification, verifyToken, tokenFromQuery,
} from './config/memoVerification.js';

// ---------------------------------------------------------------------------
// Memo QR verification (W7-05 / BRD OUT-03).
//
// GET /api/memo-verification                                   -> vocabulary
// GET /api/memo-verification/opportunities/:id                 -> issue/refresh
//        the signed QR payload for the opportunity's current memo, returning
//        the version, content hash and the verify URL the QR encodes.
// GET /api/memo-verification/opportunities/:id/qr.png|.svg      -> the QR image
// GET /api/memo-verification/verify?id&v&h&t&sig                -> PUBLIC check
//        (no session): recomputes the live fingerprint and reports whether the
//        scanned copy still matches. A changed record or forged signature fails.
//
// The issued payload is stored so a reviewer can see what version/hash was
// handed out; the public verify path is deliberately unauthenticated (a scanned
// phone has no session) but never reveals anything beyond valid/version/hash.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';

export const memoVerificationRouter = express.Router();

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// Actor middleware - applied only to the authenticated routes, never to the
// public verify path.
async function actorMiddleware(req, res, next) {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
}

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || ('http://localhost:' + (process.env.PORT || '3001'))).replace(/\/+$/, '');
}

// Load the opportunity through the same org-visibility rule as the pipeline and
// memo routes, then assemble the current memo. A cross-tenant caller gets 403.
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

// A stable, human-readable version tag for a memo: the content hash truncated.
// Because it is derived from the fingerprint, an unchanged record keeps the same
// version across regenerations and a changed record gets a new one.
export function contentVersion(hash) {
  return 'v-' + String(hash).slice(0, 12);
}

async function latestIssuance(opportunityId) {
  const { rows } = await pool.query(
    'SELECT * FROM memo_verification WHERE opportunity_id = $1 ORDER BY issued_at DESC LIMIT 1',
    [opportunityId]
  );
  return rows[0] || null;
}

async function recordIssuance({ opportunityId, ownerOrgId, version, hash, url, actor }) {
  const { rows } = await pool.query(
    `INSERT INTO memo_verification
       (id, opportunity_id, owner_org_id, version, hash, url, issued_by, issued_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())
     RETURNING *`,
    [opportunityId, ownerOrgId, version, hash, url, actor?.email || null]
  );
  return rows[0];
}

// Issue + persist a verification payload for an already-loaded memo and return
// the QR PNG alongside the version/hash/url. Used by the memo .docx export so
// the printed footer carries a live QR (W7-05), and re-used by the QR image
// routes. Kept here (not in the pure config module) because it writes the
// issuance row and the audit event.
export async function prepareDocxVerification({ row, memo, actor }) {
  const hash = memoFingerprint(memo);
  const version = contentVersion(hash);
  const issuedAt = new Date().toISOString();
  const issued = issueVerification({
    opportunityId: row.id, version, hash, issuedAt,
    baseUrl: publicBaseUrl(), secret: authSecret(),
  });
  const qr = await QRCode.toBuffer(issued.url, { type: 'png', margin: 1, width: 240 });
  await recordIssuance({ opportunityId: row.id, ownerOrgId: row.owner_org_id, version, hash, url: issued.url, actor });
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'memo_verification_issued',
    actor, orgId: row.owner_org_id, after: { version, hash, url: issued.url, embedded: 'docx' },
  });
  return { qr, version, hash, url: issued.url, issued_at: issuedAt };
}

// GET / - vocabulary: fields hashed, result legend, scan note.
memoVerificationRouter.get('/', async (_req, res) => {
  try {
    res.json({
      key: MEMO_VERIFICATION_KEY,
      title: MEMO_VERIFICATION_TITLE,
      version: MEMO_VERIFICATION_VERSION,
      fingerprint_fields: FINGERPRINT_FIELDS,
      results: VERIFY_RESULTS,
      messages: MEMO_VERIFICATION_MESSAGES,
    });
  } catch (err) { sendErr(res, err); }
});

// PUBLIC verify - no session. Recomputes the live fingerprint and compares.
memoVerificationRouter.get('/verify', async (req, res) => {
  try {
    const token = tokenFromQuery(req.query);
    if (!token.id || !token.hash) {
      return res.status(400).json({ valid: false, result: VERIFY_RESULTS.malformed });
    }
    // Always verify the signature first; a forged token never triggers a record
    // lookup and never leaks whether the id exists.
    let memo = null;
    if (verifyToken({ token, memo: null, secret: authSecret() }).result !== VERIFY_RESULTS.signature_invalid) {
      const { rows } = await pool.query(
        'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
        [OPPORTUNITY_ENTITY, token.id]
      );
      const row = rows[0];
      if (row) {
        const [org, documents, alignment] = await Promise.all([
          getOrganization(row.owner_org_id).catch(() => null),
          listDocuments(row.id, { currentOnly: true }).catch(() => []),
          evaluateAlignment(row, { orgId: row.owner_org_id }).catch(() => null),
        ]);
        memo = buildSiriusMemo({ opportunity: row, org, documents, alignment });
      }
    }
    const outcome = verifyToken({ token, memo, secret: authSecret() });
    // Record every scan against the opportunity so an unexpected public hit is
    // visible in the trail (best-effort - a scan must never fail on audit).
    writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: token.id, action: 'memo_verification_scanned',
      orgId: null,
      after: { valid: outcome.valid, result: outcome.result, issued_hash: outcome.issued_hash || null, current_hash: outcome.current_hash || null },
      comment: 'public QR verification scan',
    }).catch(() => {});
    res.json({
      valid: outcome.valid,
      result: outcome.result,
      status_label: outcome.result?.label || null,
      message: outcome.result?.message || null,
      version: outcome.version || null,
      issued_hash: outcome.issued_hash || null,
      current_hash: outcome.current_hash || null,
      issued_at: outcome.issued_at || null,
    });
  } catch (err) { sendErr(res, err); }
});

// Authenticated: issue/refresh the QR payload for this opportunity's memo.
memoVerificationRouter.get('/opportunities/:id', actorMiddleware, async (req, res) => {
  try {
    const { row, memo } = await loadMemoInputs(req);
    const hash = memoFingerprint(memo);
    const version = contentVersion(hash);
    const issuedAt = new Date().toISOString();
    const issued = issueVerification({
      opportunityId: row.id, version, hash, issuedAt,
      baseUrl: publicBaseUrl(), secret: authSecret(),
    });
    await recordIssuance({ opportunityId: row.id, ownerOrgId: row.owner_org_id, version, hash, url: issued.url, actor: req.actor });
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'memo_verification_issued',
      actor: req.actor, orgId: row.owner_org_id,
      after: { version, hash, url: issued.url },
    });
    res.json({
      key: MEMO_VERIFICATION_KEY,
      opportunity_id: row.id,
      version,
      hash,
      issued_at: issuedAt,
      verify_url: issued.url,
      token: issued.token,
      fingerprint_fields: FINGERPRINT_FIELDS,
    });
  } catch (err) { sendErr(res, err); }
});

// Authenticated: the last issued payload (if any) for the opportunity.
memoVerificationRouter.get('/opportunities/:id/latest', actorMiddleware, async (req, res) => {
  try {
    const { row } = await loadMemoInputs(req);
    const latest = await latestIssuance(row.id);
    res.json({
      opportunity_id: row.id,
      latest: latest ? {
        version: latest.version, hash: latest.hash, verify_url: latest.url,
        issued_by: latest.issued_by, issued_at: latest.issued_at,
      } : null,
    });
  } catch (err) { sendErr(res, err); }
});

// Authenticated: the QR image for the opportunity's issued payload. Both render
// the same verify URL, so a client preview and the printed memo agree.
async function qrForOpportunity(req) {
  const { row, memo } = await loadMemoInputs(req);
  const hash = memoFingerprint(memo);
  const version = contentVersion(hash);
  const issued = issueVerification({
    opportunityId: row.id, version, hash,
    issuedAt: new Date().toISOString(), baseUrl: publicBaseUrl(), secret: authSecret(),
  });
  return { row, issued };
}

memoVerificationRouter.get('/opportunities/:id/qr.png', actorMiddleware, async (req, res) => {
  try {
    const { issued } = await qrForOpportunity(req);
    const buffer = await QRCode.toBuffer(issued.url, { type: 'png', margin: 1, width: 240 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) { sendErr(res, err); }
});

memoVerificationRouter.get('/opportunities/:id/qr.svg', actorMiddleware, async (req, res) => {
  try {
    const { issued } = await qrForOpportunity(req);
    const svg = await QRCode.toString(issued.url, { type: 'svg', margin: 1, width: 200 });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    res.send(svg);
  } catch (err) { sendErr(res, err); }
});

export default memoVerificationRouter;
