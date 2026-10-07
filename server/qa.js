import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg } from './rbac.js';
import { isProducerFor, isReviewer } from './config/workflowStates.js';
import { addDocumentVersion } from './gate.js';
import { UPLOAD_MAX_BYTES, uploadFilter } from './security.js';
import { notify } from './notify.js';
import { loadCommentVisibilityConfig } from './commentVisibility.js';
import {
  COMMENT_VISIBILITY_MESSAGES,
  COMMENT_VISIBILITY_KEYS,
  mayViewVisibility,
  isSubsidiaryViewer,
  effectiveMessageVisibility,
} from './config/commentVisibility.js';

// ---------------------------------------------------------------------------
// Q&A / clarification loop (E8 / REQ-QA-01, REQ-FLOW-02, REQ-RBAC-04).
//
// A thread is attached to one opportunity and is visible only to its
// participants, the owning org (and ancestors / cross-org readers, enforced by
// the same canViewOrg scope used everywhere else). Threads can require a
// response, be opened and closed, and notify their participants. Every
// message and state change is written to the immutable audit log.
//
// W6-04 / AUD-03: every thread and message also carries a visibility of
// 'shared' or 'internal'. An internal comment belongs to the group investment
// layer and is filtered out of every read (and every notification) for a
// subsidiary-only user, so the guarantee is enforced server-side.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

export async function loadOpportunity(id, actor) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, id]
  );
  const row = rows[0];
  if (!row) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this opportunity'); e.status = 403; throw e;
  }
  return row;
}

// The status a person reads (WF-04): open, answered or closed. 'answered'
// means the formal response is in but the asker has not closed the thread.
export function threadDisplayStatus(row) {
  if (!row) return null;
  if (row.status !== 'open') return 'closed';
  return row.response_received ? 'answered' : 'open';
}

export function isThreadOverdue(row, now = new Date()) {
  return Boolean(row && row.status === 'open' && !row.response_received && row.due_at && new Date(row.due_at) < now);
}

function toThread(row) {
  if (!row) return null;
  return {
    ...row,
    kind: row.kind || 'question',
    is_open: row.status === 'open',
    awaiting_response: row.requires_response && !row.response_received,
    visibility: row.visibility || 'shared',
    display_status: threadDisplayStatus(row),
    overdue: isThreadOverdue(row),
  };
}

// Normalise a caller-supplied visibility against the policy default. An unknown
// value is refused rather than silently coerced, so an author cannot believe a
// comment is internal when it is not.
function resolveVisibility(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const key = String(value).trim().toLowerCase();
  if (!COMMENT_VISIBILITY_KEYS.includes(key)) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.invalid_visibility); e.status = 400; throw e;
  }
  return key;
}

// May this actor see the thread at all? An internal thread is withheld from a
// subsidiary-only viewer, who must not even know it exists.
function maySeeThread(config, actor, thread) {
  return mayViewVisibility(config, actor, thread.visibility || 'shared');
}

// Filter a message list for the viewer: drop anything whose effective
// visibility (thread + message) the actor may not see.
function filterMessages(config, actor, thread, messages) {
  return (messages || []).filter((m) =>
    mayViewVisibility(config, actor, effectiveMessageVisibility(thread.visibility, m.visibility)));
}

// Given a set of recipient emails, drop anyone who may not see an internal
// comment (W6-04: internal comments are never notified to subsidiary roles).
async function recipientsWhoMaySee(config, emails, visibility) {
  const list = [...new Set((emails || []).filter(Boolean))];
  if (!list.length) return [];
  if (visibility !== 'internal') return list;
  const { rows } = await pool.query(
    'SELECT u.email, m.roles FROM app_user u LEFT JOIN membership m ON m.user_id = u.id WHERE lower(u.email) = ANY($1)',
    [list.map((e) => String(e).toLowerCase())]
  );
  const rolesByEmail = new Map();
  for (const r of rows) {
    const key = String(r.email).toLowerCase();
    const bucket = rolesByEmail.get(key) || [];
    for (const role of (r.roles || [])) if (!bucket.includes(role)) bucket.push(role);
    rolesByEmail.set(key, bucket);
  }
  return list.filter((email) => {
    const roles = rolesByEmail.get(String(email).toLowerCase()) || [];
    return mayViewVisibility(config, { roles }, visibility);
  });
}

/**
 * Participants may be given as emails (validated against known users). A
 * participant must be able to see the owning org, otherwise a Sirius user
 * could pull a sibling subsidiary into another subsidiary's thread and leak
 * its content (REQ-PRIV-01 / E2.4).
 */
async function resolveParticipants(candidates = [], { actor, ownerOrgId } = {}) {
  const emails = [...new Set(candidates.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const { rows } = await pool.query(
    'SELECT u.id, u.email, u.full_name, m.roles, m.org_id ' +
      'FROM app_user u LEFT JOIN membership m ON m.user_id = u.id ' +
      'WHERE lower(u.email) = ANY($1)',
    [emails]
  );
  const out = [];
  for (const r of rows) {
    const membership = { org_id: r.org_id, roles: r.roles || [] };
    if (actor && ownerOrgId && !canViewOrg(membership, ownerOrgId, { descendantIds: [], grantedOrgIds: [] })) {
      const e = new Error('A participant does not have access to this opportunity: ' + r.email);
      e.status = 403; throw e;
    }
    out.push({ user_id: r.id, user_email: r.email, full_name: r.full_name });
  }
  return out;
}

// Insert a thread, its first message and its participants through `db` (the
// pool, or a client inside the caller's transaction). Validation, audit and
// notification stay with the callers so a transactional caller can audit in the
// same transaction and notify only after it commits.
export async function insertThread(db, opp, {
  subject, body, requiresResponse = false, visibility = 'shared', participants = [],
  kind = 'question', dueAt = null, ownerEmail = null,
}, actor) {
  const id = uuid();
  const { rows } = await db.query(
    "INSERT INTO qa_thread (id, opportunity_id, owner_org_id, subject, status, requires_response, raised_by, raised_by_name, visibility, kind, due_at, owner_email) " +
      "VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10,$11) RETURNING *",
    [id, opp.id, opp.owner_org_id, subject, requiresResponse, actor.email, actor.full_name || null, visibility,
      kind, dueAt, ownerEmail]
  );
  await db.query(
    "INSERT INTO qa_message (id, thread_id, author_email, author_name, author_id, body, is_response, visibility) " +
      "VALUES ($1,$2,$3,$4,$5,$6,false,$7)",
    [uuid(), id, actor.email, actor.full_name || null, actor.id, body, visibility]
  );
  // The raiser is always a participant; explicit participants are added on top.
  const candidates = [actor.email, ...(participants || [])];
  const people = await resolveParticipants(candidates, { actor, ownerOrgId: opp.owner_org_id });
  for (const person of people) {
    await db.query(
      "INSERT INTO qa_participant (id, thread_id, user_email, role, notified_at) " +
        "VALUES ($1,$2,$3,$4, now()) ON CONFLICT (thread_id, user_email) DO NOTHING",
      [uuid(), id, person.user_email, person.user_id === actor.id ? 'raiser' : 'participant']
    );
  }
  return { thread: rows[0], people };
}

// Notify a new thread's participants (never the raiser; never an internal
// thread to a subsidiary role).
export async function notifyThreadOpened({ thread, people, opp, actor }) {
  const config = await loadCommentVisibilityConfig();
  const recipients = await recipientsWhoMaySee(
    config,
    people.map((p) => p.user_email).filter((e) => e !== actor.email),
    thread.visibility || 'shared'
  );
  const isRequest = thread.kind === 'information_request';
  await notify({
    to: recipients,
    kind: isRequest ? 'information_requested' : 'qa_thread',
    subject: (isRequest ? 'Information requested: ' : 'Question raised: ') + thread.subject,
    body: (actor.full_name || actor.email) + (isRequest ? ' requested information' : ' opened a thread')
      + (thread.requires_response ? ' requiring a response' : '') + ' on ' + (opp.data?.opportunity_name || opp.id)
      + (thread.due_at ? ' (due ' + new Date(thread.due_at).toISOString().slice(0, 10) + ')' : '') + '.',
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, orgId: opp.owner_org_id, actor,
  });
}

export async function openThread(opportunityId, payload = {}, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  const subject = (payload.subject || '').trim();
  if (!subject) { const e = new Error('A thread subject is required'); e.status = 400; throw e; }
  const body = (payload.body || '').trim();
  if (!body) { const e = new Error('The first message cannot be empty'); e.status = 400; throw e; }
  const requiresResponse = Boolean(payload.requires_response);
  const config = await loadCommentVisibilityConfig();
  const visibility = resolveVisibility(payload.visibility, config.default_thread_visibility);
  // A subsidiary-only author cannot create an internal thread (they could never
  // see it, and internal notes belong to the group layer).
  if (visibility === 'internal' && isSubsidiaryViewer(config, actor)) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.internal_hidden); e.status = 403; throw e;
  }
  const dueAt = parseDueDate(payload.due_at ?? payload.due_date);
  // WF-04: every question has an owner who must answer it. A Sirius question
  // defaults to the subsidiary preparer, who is also added as a participant.
  const preparer = String(opp.data?.owner_email || opp.data?.submitted_by || '').trim().toLowerCase() || null;
  const ownerEmail = payload.owner_email ? String(payload.owner_email).trim().toLowerCase()
    : (requiresResponse && visibility !== 'internal' && !isProducerFor(actor, opp.owner_org_id) ? preparer : null);
  const participants = [...(payload.participants || []), ...(ownerEmail ? [ownerEmail] : [])];
  if (!participants.length && preparer && visibility !== 'internal' && !isProducerFor(actor, opp.owner_org_id)) participants.push(preparer);
  const { thread, people } = await insertThread(pool, opp, {
    subject, body, requiresResponse, visibility, participants,
    kind: 'question', dueAt, ownerEmail,
  }, actor);
  await writeAudit({ entity: 'qa_thread', entityId: thread.id, action: 'thread_open', actor, orgId: opp.owner_org_id, after: { subject, requires_response: requiresResponse, visibility, due_at: dueAt } });
  await writeAudit({ entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'qa_thread_open', actor, orgId: opp.owner_org_id, after: { thread_id: thread.id, subject, visibility } });
  await notifyThreadOpened({ thread, people, opp, actor });
  return toThread(thread);
}

// A due date is optional; when given it must be a real date.
export function parseDueDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) { const e = new Error('The due date is not a valid date'); e.status = 400; throw e; }
  return d.toISOString();
}

export async function addMessage(threadId, payload = {}, { actor, documentId = null } = {}) {
  const { rows } = await pool.query('SELECT * FROM qa_thread WHERE id = $1', [threadId]);
  const thread = rows[0];
  if (!thread) { const e = new Error('Thread not found'); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, thread.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this thread'); e.status = 403; throw e;
  }
  const config = await loadCommentVisibilityConfig();
  if (!maySeeThread(config, actor, thread)) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.internal_hidden); e.status = 403; throw e;
  }
  if (thread.status !== 'open') { const e = new Error('This thread is closed'); e.status = 409; throw e; }
  const body = (payload.body || '').trim();
  if (!body) { const e = new Error('A message body is required'); e.status = 400; throw e; }
  const isResponse = Boolean(payload.is_response);
  // An internal thread keeps every reply internal; otherwise the author may
  // mark an individual message internal. A subsidiary-only author cannot.
  const requested = resolveVisibility(payload.visibility, config.default_message_visibility);
  const visibility = effectiveMessageVisibility(thread.visibility, requested);
  if (visibility === 'internal' && isSubsidiaryViewer(config, actor)) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.internal_hidden); e.status = 403; throw e;
  }
  const { rows: messageRows } = await pool.query(
    "INSERT INTO qa_message (id, thread_id, author_email, author_name, author_id, body, is_response, visibility, document_id) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [uuid(), threadId, actor.email, actor.full_name || null, actor.id, body, isResponse, visibility, documentId]
  );
  await pool.query('UPDATE qa_thread SET updated_at = now() WHERE id = $1', [threadId]);
  // A formal information request is answered only by the owning subsidiary;
  // anyone else's "response" is an ordinary message on it.
  // The person who asked cannot answer their own question.
  const countsAsAnswer = isResponse && thread.requires_response && !thread.response_received
    && String(actor.email || '').toLowerCase() !== String(thread.raised_by || '').toLowerCase()
    && (thread.kind !== 'information_request' || isProducerFor(actor, thread.owner_org_id));
  if (countsAsAnswer) {
    await pool.query(
      "UPDATE qa_thread SET response_received = true, answered_at = now(), answered_by = $2, updated_at = now() WHERE id = $1",
      [threadId, actor.email]
    );
  }
  await pool.query(
    "INSERT INTO qa_participant (id, thread_id, user_email, role, notified_at) " +
      "VALUES ($1,$2,$3,'responder', now()) ON CONFLICT (thread_id, user_email) DO NOTHING",
    [uuid(), threadId, actor.email]
  );
  await writeAudit({ entity: 'qa_thread', entityId: threadId, action: isResponse ? 'thread_response' : 'thread_message', actor, orgId: thread.owner_org_id, after: { message_id: messageRows[0].id, visibility } });
  const { rows: others } = await pool.query('SELECT user_email FROM qa_participant WHERE thread_id = $1 AND user_email <> $2', [threadId, actor.email]);
  const recipients = await recipientsWhoMaySee(config, others.map((r) => r.user_email), visibility);
  await notify({
    to: recipients,
    kind: isResponse ? 'qa_response' : 'qa_message',
    subject: isResponse ? ('Response on: ' + thread.subject) : ('New message on: ' + thread.subject),
    body: body.slice(0, 280),
    entity: OPPORTUNITY_ENTITY, entityId: thread.opportunity_id, orgId: thread.owner_org_id, actor,
  });
  return messageRows[0];
}

export async function setThreadStatus(threadId, status, { actor, comment } = {}) {
  if (!['open', 'closed'].includes(status)) { const e = new Error('Unknown thread status: ' + status); e.status = 400; throw e; }
  const { rows } = await pool.query('SELECT * FROM qa_thread WHERE id = $1', [threadId]);
  const thread = rows[0];
  if (!thread) { const e = new Error('Thread not found'); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, thread.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to change this thread'); e.status = 403; throw e; }
  const config = await loadCommentVisibilityConfig();
  if (!maySeeThread(config, actor, thread)) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.internal_hidden); e.status = 403; throw e;
  }
  const { rows: updated } = await pool.query(
    "UPDATE qa_thread SET status = $2, closed_by = $3, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END, updated_at = now() " +
      "WHERE id = $1 RETURNING *",
    [threadId, status, status === 'closed' ? actor.email : null]
  );
  await writeAudit({ entity: 'qa_thread', entityId: threadId, action: status === 'closed' ? 'thread_close' : 'thread_reopen', actor, orgId: thread.owner_org_id, comment: comment || null });
  const { rows: participants } = await pool.query('SELECT user_email FROM qa_participant WHERE thread_id = $1', [threadId]);
  const visibility = thread.visibility || 'shared';
  const recipients = await recipientsWhoMaySee(
    config,
    participants.map((r) => r.user_email).filter((e) => e !== actor.email),
    visibility
  );
  await notify({
    to: recipients,
    kind: status === 'closed' ? 'qa_closed' : 'qa_reopened',
    subject: 'Thread ' + (status === 'closed' ? 'closed' : 'reopened') + ': ' + thread.subject,
    body: comment || (status === 'closed' ? 'The thread was closed.' : 'The thread was reopened.'),
    entity: OPPORTUNITY_ENTITY, entityId: thread.opportunity_id, orgId: thread.owner_org_id, actor,
  });
  return toThread(updated[0]);
}

export async function listThreads(opportunityId, { status, awaitingResponse, actor } = {}) {
  const params = [opportunityId];
  const where = ['t.opportunity_id = $1'];
  if (status) { params.push(status); where.push('t.status = $' + params.length); }
  if (awaitingResponse) where.push('t.requires_response = true AND t.response_received = false');
  const { rows } = await pool.query(
    'SELECT t.*, (SELECT count(*)::int FROM qa_message m WHERE m.thread_id = t.id) AS message_count, ' +
      '(SELECT count(*)::int FROM qa_participant p WHERE p.thread_id = t.id) AS participant_count, ' +
      // The opening question, so a list can show what was asked without a
      // second request. Never an internal message.
      "(SELECT m.body FROM qa_message m WHERE m.thread_id = t.id AND COALESCE(m.visibility, 'shared') <> 'internal' ORDER BY m.created_at ASC LIMIT 1) AS first_message " +
      'FROM qa_thread t WHERE ' + where.join(' AND ') + ' ORDER BY t.updated_at DESC',
    params
  );
  let visible = rows;
  if (actor) {
    const config = await loadCommentVisibilityConfig();
    visible = rows.filter((t) => maySeeThread(config, actor, t));
  }
  return visible.map(toThread);
}

export async function getThread(threadId, { actor } = {}) {
  const { rows } = await pool.query('SELECT * FROM qa_thread WHERE id = $1', [threadId]);
  const thread = rows[0];
  if (!thread) return null;
  if (actor && !canViewOrg(actor.membership, thread.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this thread'); e.status = 403; throw e; }
  const config = await loadCommentVisibilityConfig();
  if (actor && !maySeeThread(config, actor, thread)) {
    const e = new Error(COMMENT_VISIBILITY_MESSAGES.internal_hidden); e.status = 403; throw e;
  }
  const { rows: messages } = await pool.query(
    "SELECT m.*, CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object('id', d.id, 'original_name', d.original_name, 'size', d.size, " +
      "'mimetype', d.mimetype, 'scan_verdict', d.scan_verdict, 'download_url', '/api/gate/documents/' || d.id || '/download') END AS attachment " +
      'FROM qa_message m LEFT JOIN submission_document d ON d.id = m.document_id AND d.deleted = false ' +
      'WHERE m.thread_id = $1 ORDER BY m.created_at',
    [threadId]
  );
  const { rows: participants } = await pool.query('SELECT * FROM qa_participant WHERE thread_id = $1 ORDER BY role, user_email', [threadId]);
  const { rows: opp } = await pool.query("SELECT data->>'opportunity_name' AS name FROM entity_record WHERE id = $1", [thread.opportunity_id]);
  return {
    ...toThread(thread),
    opportunity_name: opp[0]?.name || null,
    messages: actor ? filterMessages(config, actor, thread, messages) : messages,
    participants,
  };
}

/** Threads the actor is a participant in, open ones first. Internal threads are
 *  withheld entirely from a subsidiary-only participant (W6-04 / AUD-03). */
export async function myThreads(actor) {
  // WF-04 / EXP-04: the inbox holds every thread the user takes part in, every
  // thread they own or raised, and - for a subsidiary - every thread on its own
  // organisation's opportunities, so a colleague can answer while the preparer
  // is away. Visibility rules still withhold internal threads.
  const producerOrgs = [actor.org_id, ...(actor.granted_org_ids || [])].filter(Boolean);
  const { rows } = await pool.query(
    "SELECT t.*, p.role AS my_role, er.data->>'opportunity_name' AS opportunity_name, er.data->>'status' AS opportunity_status " +
      'FROM qa_thread t ' +
      'LEFT JOIN qa_participant p ON p.thread_id = t.id AND lower(p.user_email) = lower($1) ' +
      'LEFT JOIN entity_record er ON er.id = t.opportunity_id ' +
      'WHERE p.id IS NOT NULL OR lower(t.owner_email) = lower($1) OR lower(t.raised_by) = lower($1) ' +
      '   OR ($3 AND t.owner_org_id = ANY($2)) ' +
      "ORDER BY (t.status = 'open') DESC, t.due_at ASC NULLS LAST, t.updated_at DESC LIMIT 300",
    [actor.email, producerOrgs, producerOrgs.some((org) => isProducerFor(actor, org))]
  );
  const config = await loadCommentVisibilityConfig();
  const visible = rows
    .filter((t) => canViewOrg(actor.membership, t.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids }))
    .filter((t) => maySeeThread(config, actor, t))
    .map(toThread)
    .map((t) => ({
      ...t,
      // Is the next move mine? The owner (or, unowned, the owning subsidiary)
      // answers; the raiser closes an answered thread.
      awaiting_me: t.status === 'open' && (
        (t.display_status === 'open' && (String(t.owner_email || '').toLowerCase() === String(actor.email).toLowerCase()
          || (!t.owner_email && t.requires_response && isProducerFor(actor, t.owner_org_id))))
        || (t.display_status === 'answered' && String(t.raised_by || '').toLowerCase() === String(actor.email).toLowerCase())),
    }));
  return visible;
}

export function summarizeThreads(threads) {
  return {
    total: threads.length,
    open: threads.filter((t) => t.display_status === 'open').length,
    answered: threads.filter((t) => t.display_status === 'answered').length,
    closed: threads.filter((t) => t.display_status === 'closed').length,
    overdue: threads.filter((t) => t.overdue).length,
    awaiting_me: threads.filter((t) => t.awaiting_me).length,
  };
}

// ---------------------------------------------------------------------------
// HTTP routes - /api/qa
// ---------------------------------------------------------------------------
export const qaRouter = express.Router();

qaRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

qaRouter.get('/my-threads', async (req, res) => {
  try {
    const items = await myThreads(req.actor);
    res.json({ items, summary: summarizeThreads(items) });
  } catch (err) { sendErr(res, err); }
});

qaRouter.get('/opportunities/:id/threads', async (req, res) => {
  try {
    await loadOpportunity(req.params.id, req.actor);
    res.json({
      opportunity_id: req.params.id,
      threads: await listThreads(req.params.id, {
        status: req.query.status,
        awaitingResponse: req.query.awaiting_response === '1',
        actor: req.actor,
      }),
    });
  } catch (err) { sendErr(res, err); }
});

qaRouter.post('/opportunities/:id/threads', async (req, res) => {
  try { res.json(await openThread(req.params.id, req.body || {}, { actor: req.actor })); } catch (err) { sendErr(res, err); }
});

qaRouter.get('/threads/:id', async (req, res) => {
  try {
    const thread = await getThread(req.params.id, { actor: req.actor });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json(thread);
  } catch (err) { sendErr(res, err); }
});

qaRouter.post('/threads/:id/messages', async (req, res) => {
  try {
    const { body, is_response: isResponse, visibility } = req.body || {};
    res.json(await addMessage(req.params.id, { body, is_response: isResponse, visibility }, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

// A document sent in the thread (WF-04: "the subsidiary responds and uploads
// documents in the thread"). It goes through the same upload policy and virus
// scan as any submission document, is stored against the opportunity (so it
// stays with the record and its audit trail), and the message links to it.
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 }, fileFilter: uploadFilter });

qaRouter.post('/threads/:id/attachments', attachmentUpload.single('file'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM qa_thread WHERE id = $1', [req.params.id]);
    const thread = rows[0];
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (!canViewOrg(req.actor.membership, thread.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this thread' });
    }
    const config = await loadCommentVisibilityConfig();
    if (!maySeeThread(config, req.actor, thread)) return res.status(403).json({ error: COMMENT_VISIBILITY_MESSAGES.internal_hidden });
    if (thread.status !== 'open') return res.status(409).json({ error: 'This thread is closed' });
    if (!isProducerFor(req.actor, thread.owner_org_id) && !isReviewer(req.actor)) {
      return res.status(403).json({ error: 'Only the owning subsidiary or the Sirius team can attach documents' });
    }
    if (!req.file) return res.status(400).json({ error: 'A file is required' });
    const doc = await addDocumentVersion({
      opportunityId: thread.opportunity_id, ownerOrgId: thread.owner_org_id,
      requirementKey: 'qa_attachment:' + thread.id + ':' + uuid().slice(0, 8), file: req.file, actor: req.actor,
    });
    const body = String(req.body?.body || '').trim() || 'Attached ' + (doc.original_name || 'a document');
    const message = await addMessage(thread.id, {
      body, is_response: req.body?.is_response === 'true' || req.body?.is_response === true, visibility: req.body?.visibility,
    }, { actor: req.actor, documentId: doc.id });
    res.status(201).json({ message, document: doc });
  } catch (err) { sendErr(res, err); }
});

qaRouter.post('/threads/:id/close', async (req, res) => {
  try { res.json(await setThreadStatus(req.params.id, 'closed', { actor: req.actor, comment: req.body?.comment })); } catch (err) { sendErr(res, err); }
});

qaRouter.post('/threads/:id/reopen', async (req, res) => {
  try { res.json(await setThreadStatus(req.params.id, 'open', { actor: req.actor, comment: req.body?.comment })); } catch (err) { sendErr(res, err); }
});

qaRouter.get('/threads/:id/audit', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT owner_org_id, visibility FROM qa_thread WHERE id = $1', [req.params.id]);
    const thread = rows[0];
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (!canViewOrg(req.actor.membership, thread.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this thread' });
    }
    const config = await loadCommentVisibilityConfig();
    if (!maySeeThread(config, req.actor, thread)) {
      return res.status(403).json({ error: COMMENT_VISIBILITY_MESSAGES.internal_hidden });
    }
    res.json(await listAuditEvents({ entity: 'qa_thread', entityId: req.params.id, limit: 200 }));
  } catch (err) { sendErr(res, err); }
});

export default qaRouter;
