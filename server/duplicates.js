// ---------------------------------------------------------------------------
// Duplicate detection API (W1-10 / INT-12).
//
// GET  /api/duplicates/opportunities/:id                 -> matches for one item
// POST /api/duplicates/opportunities/:id/:matchId/link   -> confirm same target
// POST /api/duplicates/opportunities/:id/:matchId/dismiss-> not a duplicate
//
// Every route is gated to the Investment Team (cross-org readers). A subsidiary
// preparer can never call these and never sees another tenant's records, which
// is exactly the isolation the BRD asks for: the warning is for the Investment
// Team alone.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { isCrossOrgReader } from './rbac.js';
import { findDuplicates } from './config/duplicates.js';

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

// Load every opportunity row across the group (no org scoping). Only call this
// behind an isCrossOrgReader check.
async function allOpportunityRows() {
  const { rows } = await pool.query(
    'SELECT id, owner_org_id, data FROM entity_record WHERE entity = $1 AND deleted = false ORDER BY updated_date DESC LIMIT 1000',
    [OPPORTUNITY_ENTITY]
  );
  return rows;
}

async function loadSubject(id) {
  const { rows } = await pool.query(
    'SELECT id, owner_org_id, data FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, id]
  );
  return rows[0] || null;
}

// The dismissal / link decisions, keyed "opportunity|match" so callers can drop
// dismissed pairs from a warning without a query per row.
async function reviewIndex() {
  const { rows } = await pool.query(
    'SELECT opportunity_id, match_opportunity_id, status, reason, reviewed_by, updated_at FROM duplicate_review'
  );
  const byPair = new Map();
  const dismissed = new Set();
  for (const r of rows) {
    byPair.set(r.opportunity_id + '|' + r.match_opportunity_id, {
      status: r.status, reason: r.reason, reviewed_by: r.reviewed_by, reviewed_at: r.updated_at,
    });
    if (r.status === 'dismissed') dismissed.add(r.opportunity_id + '|' + r.match_opportunity_id);
  }
  return { byPair, dismissed };
}

// Full match list for one opportunity, review decisions attached.
export async function duplicateMatchesFor(subjectId) {
  const rows = await allOpportunityRows();
  const subject = rows.find((r) => r.id === subjectId);
  if (!subject) return null;
  const matches = findDuplicates(subject, rows);
  const { byPair } = await reviewIndex();
  return {
    opportunity_id: subjectId,
    count: matches.filter((m) => !(byPair.get(subjectId + '|' + m.opportunity_id)?.status === 'dismissed')).length,
    matches: matches.map((m) => ({
      ...m,
      review: byPair.get(subjectId + '|' + m.opportunity_id) || null,
    })),
  };
}

// Warning counts per opportunity id (dismissed pairs excluded), for the board.
// Loads the full opportunity set itself so the comparison is always against the
// whole group, not just the states the board happens to show.
export async function duplicateCountMap() {
  const allRows = await allOpportunityRows();
  const { dismissed } = await reviewIndex();
  const map = new Map();
  for (const row of allRows) {
    const matches = findDuplicates(row, allRows).filter(
      (m) => !dismissed.has(row.id + '|' + m.opportunity_id)
    );
    map.set(row.id, matches.length);
  }
  return map;
}

export const duplicatesRouter = express.Router();

duplicatesRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

function requireInvestmentTeam(req, res) {
  if (!isCrossOrgReader(req.actor.membership)) {
    res.status(403).json({ error: 'Duplicate warnings are for the Investment Team only' });
    return false;
  }
  return true;
}

duplicatesRouter.get('/opportunities/:id', async (req, res) => {
  try {
    if (!requireInvestmentTeam(req, res)) return;
    const result = await duplicateMatchesFor(req.params.id);
    if (!result) return res.status(404).json({ error: 'Opportunity not found' });
    res.json(result);
  } catch (err) { sendErr(res, err); }
});

async function recordReview(req, res, status) {
  if (!requireInvestmentTeam(req, res)) return;
  const subject = await loadSubject(req.params.id);
  if (!subject) return res.status(404).json({ error: 'Opportunity not found' });
  const match = await loadSubject(req.params.matchId);
  if (!match) return res.status(404).json({ error: 'Matched opportunity not found' });
  const reason = req.body?.reason ? String(req.body.reason).trim() : null;
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO duplicate_review (id, opportunity_id, match_opportunity_id, status, reason, reviewed_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),now())
     ON CONFLICT (opportunity_id, match_opportunity_id)
     DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, reviewed_by = EXCLUDED.reviewed_by, updated_at = now()`,
    [uuid(), req.params.id, req.params.matchId, status, reason, req.actor.email]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: req.params.id,
    action: status === 'linked' ? 'duplicate_linked' : 'duplicate_dismissed',
    actor: req.actor, orgId: subject.owner_org_id,
    after: { match_opportunity_id: req.params.matchId, status, reason, at: now },
    comment: status === 'linked' ? 'Investment Team linked a duplicate' : 'Investment Team dismissed a duplicate',
  });
  res.json({ ok: true, opportunity_id: req.params.id, match_opportunity_id: req.params.matchId, status, reason });
}

duplicatesRouter.post('/opportunities/:id/:matchId/link', async (req, res) => {
  try { await recordReview(req, res, 'linked'); } catch (err) { sendErr(res, err); }
});

duplicatesRouter.post('/opportunities/:id/:matchId/dismiss', async (req, res) => {
  try { await recordReview(req, res, 'dismissed'); } catch (err) { sendErr(res, err); }
});

export default duplicatesRouter;
