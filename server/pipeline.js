import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, isCrossOrgReader } from './rbac.js';
import { descendantIds } from './org.js';
import { evaluateAlignment } from './themes.js';
import { getOrganization } from './org.js';
import { listDocuments, evaluateGate, loadQualityScoreConfig } from './gate.js';
import { buildSiriusMemo, missingMemoFields } from './config/siriusMemo.js';
import { packSiriusMemo } from './siriusMemoDocx.js';
import { prepareDocxVerification } from './memoVerification.js';
import { loadDataSourceConfig } from './dataSource.js';
import { buildSourceMap } from './config/dataSource.js';
import { duplicateCountMap, duplicateMatchesFor } from './duplicates.js';
import { evaluateScreeningPanel } from './config/screeningPanel.js';
import { loadPortfolioRegisterConfig } from './portfolioRegister.js';
import { loadStrategyCorpus, getLatestStrategyProfile, recordScreeningSnapshot } from './strategy.js';
import { loadDecisionReasonConfig } from './decisionReasons.js';
import { loadDoaConfig } from './doa.js';
import { resolveAuthority } from './config/doa.js';
import { loadReviewsFor, loadRelatedPartyConfig as loadRelatedPartyConfigForCards } from './relatedParty.js';
import { resolveOverlayStatus as resolveRpOverlay } from './config/relatedParty.js';
import {
  STATES, TRANSITIONS as TRANSITION_RULES, STATE_KEYS, STATE_LABELS, DEFAULT_SLA, BOARD_STATES, OPEN_STATES, FINAL_STATES, transitionMap, normalizeState,
  availableActions, nextActorFor, isReviewer, isProducerFor, EDITABLE_STATES,
} from './config/workflowStates.js';
import { transitionOpportunity } from './lifecycle.js';
import { buildDataroomLinkRecord, describeDataroomLink, DATAROOM_LINK_VERSION, DATAROOM_PROVIDERS } from './config/dataroomLink.js';

// ---------------------------------------------------------------------------
// Screening pipeline & board (BRD v2 WF-01, WF-02, WF-03, DSH-02).
//
// The lifecycle itself - states, permitted moves, who may take them - lives in
// config/workflowStates.js; the transactional engine in lifecycle.js. This
// module builds the board, the queues and the cards from them.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

export const PIPELINE_STATES = STATE_KEYS;
export const TRANSITIONS = transitionMap();
export { STATE_LABELS, DEFAULT_SLA };

export async function seedPipelineSla({ force = false } = {}) {
  // Retired pre-BRD v2 states are removed; the shipped states are inserted when
  // missing. An administrator's edited days are kept unless force is set.
  await pool.query('DELETE FROM pipeline_sla WHERE NOT (state = ANY($1))', [DEFAULT_SLA.map((s) => s.state)]);
  for (const s of DEFAULT_SLA) {
    await pool.query(
      force
        ? `INSERT INTO pipeline_sla (state, label, days, sort_order) VALUES ($1,$2,$3,$4)
           ON CONFLICT (state) DO UPDATE SET label = EXCLUDED.label, days = EXCLUDED.days, sort_order = EXCLUDED.sort_order`
        : `INSERT INTO pipeline_sla (state, label, days, sort_order) VALUES ($1,$2,$3,$4)
           ON CONFLICT (state) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order`,
      [s.state, s.label, s.days, s.sort_order]
    );
  }
  return { skipped: false, count: DEFAULT_SLA.length };
}

export async function getSlaTargets() {
  const { rows } = await pool.query('SELECT * FROM pipeline_sla ORDER BY sort_order');
  const byState = {};
  for (const r of rows) byState[r.state] = r;
  return byState;
}

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((to.getTime() - start) / 86400000));
}

// Legacy state names stored on older records count as their BRD v2 state, so
// SQL filters by state must match both spellings.
function withLegacyNames(states) {
  const set = new Set(states);
  for (const [legacy, now] of Object.entries(LEGACY_FOR_FILTER)) if (set.has(now)) set.add(legacy);
  return [...set];
}
const LEGACY_FOR_FILTER = { submission: 'screening_review', screening: 'screening_review', returned: 'information_requested', refinement: 'proceed_to_gate2', approval: 'proceed_to_gate2' };

function opportunityToCard(row, slaByState, actor = null, doaConfig = null, rpConfig = null, rpReview = null) {
  const data = row.data || {};
  const state = normalizeState(data.status);
  const since = data.status_entered_at || data.submitted_at || row.updated_date;
  const ageDays = daysBetween(since);
  const sla = slaByState[state] || null;
  const target = sla?.days ?? null;
  const open = OPEN_STATES.includes(state);
  // The Gate-1 Delegation of Authority for this item (WF-08): who owns the
  // screening decision at this ticket size, and whether this actor may take it.
  let doa = null;
  if (doaConfig && open) {
    doa = resolveAuthority(doaConfig, { amountAed: data.total_commitment_aed, roles: actor?.roles || [], gate: doaConfig.gate });
  }
  const rp = rpConfig ? resolveRpOverlay(rpConfig, rpReview || {}) : null;
  // The moves this actor may make, computed from the same rules the engine
  // enforces, so the UI never offers a move the server would refuse.
  const actions = actor
    ? availableActions({
      state, actor, ownerOrgId: row.owner_org_id, doa,
      blocks: rp?.flagged && rp.blocked
        ? { proceed: 'An independent, non-conflicted sign-off is required first (related party).',
          hold: 'An independent, non-conflicted sign-off is required first (related party).',
          decline: 'An independent, non-conflicted sign-off is required first (related party).' }
        : {},
    })
    : [];
  return {
    id: row.id,
    owner_org_id: row.owner_org_id,
    opportunity_name: data.opportunity_name || '(untitled)',
    opportunity_type: data.opportunity_type || null,
    sector: data.sector || null,
    geography: data.geography || null,
    total_commitment_aed: data.total_commitment_aed ?? null,
    // The subsidiary preparer who owns the submission, and the named Sirius
    // Investment Team owner (WF-02).
    owner_email: data.owner_email || data.submitted_by || null,
    sirius_owner_email: data.sirius_owner_email || null,
    sirius_owner_name: data.sirius_owner_name || null,
    state,
    state_label: STATE_LABELS[state] || state,
    legacy_state: data.status && data.status !== state ? data.status : null,
    next_actor: nextActorFor(state),
    is_open: open,
    is_final: FINAL_STATES.includes(state),
    editable: EDITABLE_STATES.includes(state),
    age_days: ageDays,
    sla_days: target,
    sla_due_at: target != null && since ? new Date(new Date(since).getTime() + target * 86400000).toISOString() : null,
    sla_breached: target != null && ageDays != null && ageDays > target,
    theme_exception: Boolean(data.theme_exception_reason),
    dataroom_folder: describeDataroomLink(data),
    submitted_at: data.submitted_at || null,
    updated_date: row.updated_date,
    // Why the item left the active pipeline, kept on the card (INT-13, WF-05).
    decision_reason: data.decision_reason || null,
    decision_reason_label: data.decision_reason_label || null,
    decision_reason_text: data.decision_reason_text || null,
    declined_reason: data.declined_reason || null,
    withdrawn_reason: data.withdrawn_reason || null,
    hold_reason: data.hold_reason || null,
    info_request_thread_id: data.info_request_thread_id || null,
    info_request_due_at: data.info_request_due_at || null,
    available_actions: actions,
    can_withdraw: actions.some((a) => a.action === 'withdraw' && a.allowed),
    related_party_overlay: rp && rp.flagged
      ? { status: rp.status, status_label: rp.status_label, blocked: rp.blocked, signed_off: rp.signed_off, version: rp.version, outstanding: rp.outstanding }
      : null,
    gate1_authority: doa
      ? {
          tier: doa.tier.key,
          tier_label: doa.tier.label,
          accountable_party: doa.accountable_party,
          decision_roles: doa.tier.decision_roles,
          responsibilities: doa.tier.responsibilities,
          version: doa.version,
          authorized: doa.authorized,
          reason: doa.reason,
        }
      : null,
  };
}

// Readable opportunities for the actor, newest first, scoped by org visibility.
async function readableOpportunities(actor, { states = null, ownerOrgId = null } = {}) {
  const params = [OPPORTUNITY_ENTITY];
  const where = ['entity = $1', 'deleted = false'];
  if (!isCrossOrgReader(actor.membership)) {
    const ids = Array.from(new Set([actor.org_id, ...actor.descendant_ids, ...actor.granted_org_ids]));
    params.push(ids);
    where.push('owner_org_id = ANY($' + params.length + ')');
  }
  if (ownerOrgId) { params.push(ownerOrgId); where.push('owner_org_id = $' + params.length); }
  if (states && states.length) { params.push(withLegacyNames(states)); where.push("data->>'status' = ANY($" + params.length + ')'); }
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE ' + where.join(' AND ') + ' ORDER BY updated_date DESC LIMIT 500',
    params
  );
  return rows;
}

async function cardsFor(actor, rows) {
  const slaByState = await getSlaTargets();
  const doaConfig = await loadDoaConfig();
  const rpConfig = await loadRelatedPartyConfigForCards();
  const rpReviews = await loadReviewsFor(rows.map((r) => r.id)).catch(() => new Map());
  return rows.map((r) => opportunityToCard(r, slaByState, actor, doaConfig, rpConfig, rpReviews.get(r.id)));
}

// Screening board: items by state with owner, age and SLA breach (WF-01/02).
export async function screeningBoard(actor) {
  const slaByState = await getSlaTargets();
  const doaConfig = await loadDoaConfig();
  const rpConfig = await loadRelatedPartyConfigForCards();
  const rows = await readableOpportunities(actor, { states: BOARD_STATES });
  const cards = await cardsFor(actor, rows);
  // Cross-group duplicate warnings are shown to the Investment Team only
  // (INT-12): a subsidiary preparer never sees a sibling's item.
  if (isCrossOrgReader(actor.membership)) {
    const counts = await duplicateCountMap().catch(() => new Map());
    for (const card of cards) card.duplicate_warning = counts.get(card.id) || 0;
  }
  // The Gate-1 Delegation of Authority matrix the board is read against, so a
  // reviewer sees which bands exist and which one owns the decision (WF-08).
  const doa = {
    gate: doaConfig.gate,
    gate_label: doaConfig.gate_label,
    version: doaConfig.version,
    revision: doaConfig.revision,
    tiers: doaConfig.tiers.map((t) => ({
      key: t.key, label: t.label, min_aed: t.min_aed, max_aed: t.max_aed,
      responsibilities: t.responsibilities, decision_roles: t.decision_roles,
    })),
  };
  const columns = BOARD_STATES.map((state) => ({
    state,
    label: STATE_LABELS[state],
    sla_days: slaByState[state]?.days ?? null,
    final: FINAL_STATES.includes(state),
    items: cards.filter((c) => c.state === state),
  }));
  // The related-party overlay in force (W6-03 / BRD WF-06), so the board can
  // explain a blocked screening decision and link to the overlay record.
  const relatedParty = {
    gate: rpConfig.gate,
    gate_label: rpConfig.gate_label,
    version: rpConfig.version,
    revision: rpConfig.revision,
    require_arm_length_documentation: rpConfig.require_arm_length_documentation,
    require_independent_signoff: rpConfig.require_independent_signoff,
    block_decision_without_signoff: rpConfig.block_decision_without_signoff,
    exclude_conflicted_users: rpConfig.exclude_conflicted_users,
    signoff_roles: rpConfig.signoff_roles,
  };
  return {
    columns,
    total: cards.length,
    open: cards.filter((c) => c.is_open).length,
    breaches: cards.filter((c) => c.sla_breached && c.is_open).length,
    by_state: columns.reduce((acc, col) => { acc[col.state] = col.items.length; return acc; }, {}),
    doa,
    related_party: relatedParty,
  };
}

// "Awaiting my action": open items where this actor holds an allowed move other
// than withdrawing. Sirius reviewers see what waits on Sirius; a preparer sees
// the information requests waiting on their subsidiary.
export async function awaitingMyReview(actor) {
  const rows = await readableOpportunities(actor, { states: OPEN_STATES });
  const cards = await cardsFor(actor, rows);
  const actionable = cards.filter((c) => c.available_actions.some((a) => a.allowed && a.action !== 'withdraw'));
  return { items: actionable, total: actionable.length };
}

// Subsidiary "my opportunities & status" (DSH-02).
export async function myOpportunities(actor, { orgId } = {}) {
  const scope = orgId || actor.org_id;
  if (scope !== actor.org_id && !canViewOrg(actor.membership, scope, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view those opportunities'); e.status = 403; throw e;
  }
  const rows = await readableOpportunities(actor, { ownerOrgId: scope });
  const cards = await cardsFor(actor, rows);
  return {
    org_id: scope,
    items: cards,
    total: cards.length,
    open: cards.filter((c) => c.is_open).length,
    by_state: cards.reduce((acc, c) => { acc[c.state] = (acc[c.state] || 0) + 1; return acc; }, {}),
  };
}

// Rollup counts at ancestor orgs (DSH-01 cluster / Sirius roll-up).
export async function orgRollup(actor, { orgId } = {}) {
  const target = orgId || actor.org_id;
  if (!canViewOrg(actor.membership, target, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view that organisation'); e.status = 403; throw e;
  }
  const ids = await descendantIds(target);
  const { rows } = await pool.query(
    "SELECT owner_org_id, COALESCE(data->>'status','draft') AS state, count(*)::int AS n " +
      'FROM entity_record WHERE entity = $1 AND deleted = false AND owner_org_id = ANY($2) ' +
      "GROUP BY owner_org_id, COALESCE(data->>'status','draft')",
    [OPPORTUNITY_ENTITY, ids]
  );
  const byOrg = {};
  const total = {};
  for (const r of rows) {
    const state = normalizeState(r.state);
    byOrg[r.owner_org_id] = byOrg[r.owner_org_id] || {};
    byOrg[r.owner_org_id][state] = (byOrg[r.owner_org_id][state] || 0) + r.n;
    total[state] = (total[state] || 0) + r.n;
  }
  return { org_id: target, descendants: ids.length, by_org: byOrg, total_by_state: total };
}

// Before the subsidiary sends an information request back (WF-01): every open
// request is answered and the submission still passes the gate - an edit while
// information was requested may have cleared the CEO/CFO attestations.
async function checkResponseReady(row) {
  const { rows: open } = await pool.query(
    "SELECT id, subject FROM qa_thread WHERE opportunity_id = $1 AND kind = 'information_request' AND status = 'open' AND response_received = false",
    [row.id]
  );
  if (open.length) {
    return { ok: false, status: 422, error: 'Answer every information request before sending the response: ' + open.map((t) => t.subject).join('; '),
      data: { missing: ['information_request_answer'], unanswered: open } };
  }
  const gate = await evaluateGate(row, { orgId: row.owner_org_id });
  if (!gate.complete || !gate.qualifying_gates?.complete || !gate.attestations?.complete) {
    const missing = [
      ...(gate.missing || []).map((m) => m.label || m.key),
      ...(gate.qualifying_gates?.complete ? [] : ['qualifying gates']),
      ...(gate.attestations?.complete ? [] : ['CEO and CFO attestations']),
    ];
    return { ok: false, status: 422, error: 'The submission is no longer complete: ' + missing.join(', '), data: { gate } };
  }
  return { ok: true };
}

// Perform an audited, transactional state change (WF-01). Submit has its own
// endpoint (gate.js) because it runs the full submission gate first.
export async function transition(opportunityId, toState, { actor, comment, reasonCode, reasonText, question } = {}) {
  return transitionOpportunity(opportunityId, normalizeState(toState), {
    actor, comment, reasonCode, reasonText, question, beforeRespond: checkResponseReady,
  });
}

export async function listTransitions(opportunityId) {
  const { rows } = await pool.query(
    'SELECT * FROM pipeline_transition WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 100',
    [opportunityId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// HTTP routes — /api/pipeline
// ---------------------------------------------------------------------------
export const pipelineRouter = express.Router();

pipelineRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

pipelineRouter.get('/states', async (_req, res) => {
  try {
    res.json({
      states: STATES.map((s) => ({ state: s.key, label: s.label, final: s.final, system: s.system, layer: s.layer })),
      board: BOARD_STATES,
      open: OPEN_STATES,
      editable: EDITABLE_STATES,
      transitions: TRANSITIONS,
      rules: TRANSITION_RULES.map((t) => ({ from: t.from, to: t.to, by: t.by, action: t.action, label: t.label || null,
        reason_class: t.reason_class || null, requires: t.requires || [], gate1: Boolean(t.gate1) })),
      sla: await getSlaTargets(),
    });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/board', async (req, res) => {
  try { res.json(await screeningBoard(req.actor)); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/awaiting-my-review', async (req, res) => {
  try { res.json(await awaitingMyReview(req.actor)); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/my-opportunities', async (req, res) => {
  try { res.json(await myOpportunities(req.actor, { orgId: req.query.org_id })); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/rollup', async (req, res) => {
  try { res.json(await orgRollup(req.actor, { orgId: req.query.org_id })); } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/alignment', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    // Load the entity's indexed corpus so the alignment rationale can quote the
    // strategy passage behind each graded dimension (W3-13 / SCR-02).
    const strategy = await loadStrategyCorpus(row.owner_org_id).catch(() => null);
    res.json({ opportunity_id: row.id, alignment: await evaluateAlignment(row, { orgId: row.owner_org_id, strategy }) });
  } catch (err) { sendErr(res, err); }
});

// The single screening panel (W3-01 / SCR-01). Composes the initial screen -
// eligibility, hard filters, hurdle tests, alignment, synergy & conflict and
// completeness - from the same gate and alignment blocks every other route
// reads, so the panel can never disagree with the form or the memo. Advisory
// throughout (SCR-09): the panel recommends, a person decides.
pipelineRouter.get('/opportunities/:id/screening', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    // The portfolio register (W4-01 / ENT-04) feeds the advisory synergy and
    // conflict checks. It is reference data, so every reader sees it.
    const portfolioRegister = await loadPortfolioRegisterConfig().catch(() => null);
    // The entity's indexed strategy corpus (W4-02 / ENT-02) feeds the
    // document-passage citation on the alignment check (W3-13).
    const strategy = await loadStrategyCorpus(row.owner_org_id).catch(() => null);
    const strategyProfile = await getLatestStrategyProfile(row.owner_org_id).catch(() => null);
    const [gate, alignment, duplicates, qualityScoreConfig] = await Promise.all([
      evaluateGate(row, { orgId: row.owner_org_id, portfolio: portfolioRegister?.companies || null }).catch(() => null),
      evaluateAlignment(row, { orgId: row.owner_org_id, strategy }).catch(() => null),
      // The duplicate-target check compares against the whole group, which only
      // a cross-org reader may see (INT-12); everyone else gets the count-free
      // panel without the conflict signal.
      isCrossOrgReader(req.actor.membership) ? duplicateMatchesFor(row.id).catch(() => null) : Promise.resolve(null),
      loadQualityScoreConfig().catch(() => null),
    ]);
    const panel = evaluateScreeningPanel({
      gate,
      alignment,
      duplicates,
      conflict: row.data?.conflict_of_interest ?? null,
      qualityScoreConfig,
    });
    // Record the strategy profile version this screening used (W4-03 / ENT-01),
    // so the retained record names the mandate in force when the screen ran.
    const screeningRecord = await recordScreeningSnapshot(row.id, {
      orgId: row.owner_org_id, profile: strategyProfile, strategy, alignment, panel, actor: req.actor,
    }).catch(() => null);
    panel.strategy_profile = strategyProfile
      ? { version: strategyProfile.version, published_at: strategyProfile.published_at, source_document_ids: strategyProfile.source_document_ids }
      : null;
    panel.screening_record = screeningRecord;
    res.json({ opportunity_id: row.id, screening: panel });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/transitions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    res.json(await listTransitions(req.params.id));
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.post('/opportunities/:id/transition', async (req, res) => {
  try {
    const toState = req.body?.state || req.body?.to_state;
    res.json(await transition(req.params.id, toState, {
      actor: req.actor,
      comment: req.body?.comment,
      reasonCode: req.body?.reason_code,
      reasonText: req.body?.reason_text,
      question: req.body?.question || null,
    }));
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Sirius investment memo (REQ-MEMO-01).
//
// GET  /opportunities/:id/memo        -> the structured six-page memo model
// GET  /opportunities/:id/memo.docx   -> the same memo rendered to Word
//
// Both read the opportunity through the same org-visibility rule as every
// other pipeline route, so a cross-tenant caller gets 403 and never sees the
// document. The memo is assembled from the opportunity's structured fields
// (gate.js OPPORTUNITY_FIELDS), the owning subsidiary and the submission
// documents already on the record; anything the template shows but the record
// does not carry renders as the template's grey placeholder.
// ---------------------------------------------------------------------------

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
  return { row, org, documents, alignment };
}

function memoFilename(row, org) {
  const base = [org?.name || row.owner_org_id, row.data?.opportunity_name]
    .filter(Boolean).join(' - ')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'investment_memo';
  return `Sirius_Memo_${base}.docx`;
}

// Data-room folder link (W8-04 / BRD INTG-01). The opportunity holds a durable
// pointer to the folder a screening works from; the secure room itself stays the
// system of record for documents. Reading is scoped by the same org rule as the
// rest of the pipeline; setting or clearing it is audited.
pipelineRouter.get('/dataroom-providers', (_req, res) => {
  res.json({ version: DATAROOM_LINK_VERSION, providers: DATAROOM_PROVIDERS });
});

pipelineRouter.get('/opportunities/:id/dataroom-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    res.json({ opportunity_id: row.id, link: describeDataroomLink(row.data || {}), version: DATAROOM_LINK_VERSION });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.put('/opportunities/:id/dataroom-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canWriteOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to change this opportunity' });
    }
    const before = describeDataroomLink(row.data || {});
    const built = buildDataroomLinkRecord(req.body || {}, { actor: req.actor });
    if (!built.ok) return res.status(422).json({ error: built.errors.join(' '), errors: built.errors });
    await pool.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(built.record), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'dataroom_link_set',
      actor: req.actor, orgId: row.owner_org_id, before, after: built.record,
    });
    res.json({ ok: true, link: describeDataroomLink(built.record), saved: true });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.delete('/opportunities/:id/dataroom-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      [OPPORTUNITY_ENTITY, req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canWriteOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to change this opportunity' });
    }
    const before = describeDataroomLink(row.data || {});
    if (!before) return res.status(404).json({ error: 'No data-room link is set on this opportunity' });
    const cleared = {
      dataroom_folder_url: null, dataroom_folder_label: null, dataroom_provider: null,
      dataroom_provider_label: null, dataroom_unlinked_at: new Date().toISOString(), dataroom_unlinked_by: req.actor.email,
    };
    await pool.query(
      'UPDATE entity_record SET data = data || $3::jsonb, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, row.id, JSON.stringify(cleared), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'dataroom_link_cleared',
      actor: req.actor, orgId: row.owner_org_id, before,
    });
    res.json({ ok: true, link: null, cleared: true });
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/memo', async (req, res) => {
  try {
    const { row, org, documents, alignment } = await loadMemoInputs(req);
    const memo = buildSiriusMemo({ opportunity: row, org, documents, alignment });
    memo.missing = missingMemoFields(row);
    // Data-point to source mapping (W5-04 / DOC-05): trace every memo value back
    // to the artefact or captured field it came from, so a reviewer can open the
    // linked source. Provenance only - it never changes a value.
    try {
      const sourceConfig = await loadDataSourceConfig();
      memo.source_map = buildSourceMap({ config: sourceConfig, documents, data: row.data || {} });
    } catch {
      memo.source_map = null;
    }
    res.json(memo);
  } catch (err) { sendErr(res, err); }
});

pipelineRouter.get('/opportunities/:id/memo.docx', async (req, res) => {
  try {
    const { row, org, documents, alignment } = await loadMemoInputs(req);
    const memo = buildSiriusMemo({ opportunity: row, org, documents, alignment });
    // Embed the QR verification image in the footer (W7-05 / OUT-03) so the
    // printed memo carries a scan-to-verify link to this record version/hash.
    let verification = null;
    try {
      verification = await prepareDocxVerification({ row, memo, actor: req.actor });
    } catch { verification = null; }
    const buffer = await packSiriusMemo(memo, verification);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${memoFilename(row, org)}"`);
    res.setHeader('Content-Length', String(buffer.length));
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: row.id, action: 'memo_generate',
      actor: req.actor, orgId: row.owner_org_id,
      after: { format: 'docx', pages: memo.pages.length, subsidiary: org?.name || null },
    });
    res.send(buffer);
  } catch (err) { sendErr(res, err); }
});

export default pipelineRouter;
