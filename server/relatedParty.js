import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, canConfigure } from './rbac.js';
import { SOURCING_CHANNELS } from './config/intakeConfig.js';
import {
  RELATED_PARTY_CONFIG_KEY,
  RELATED_PARTY_MESSAGES,
  ARM_LENGTH_BASES,
  defaultRelatedPartyConfig,
  validateRelatedPartyConfig,
  resolveRelatedPartyConfig,
  diffRelatedPartyConfig,
  buildRelatedPartyConfig,
  resolveOverlayStatus,
  isConflictedActor,
  maySignOff,
  mayDecide,
} from './config/relatedParty.js';

// ---------------------------------------------------------------------------
// Related-party / affiliate governance overlay (E9.5 / REQ-RPT-01, REQ-RPT-02,
// W6-03 / BRD WF-06).
//
// The overlay detects affiliate involvement, forces the disclosure field, and
// records the independent (non-conflicted) reviewer. W6-03 turns the flag into
// an enforced gate on the Gate-1 Screening Decision: a flagged deal needs a
// written arm's-length basis and evidence, an independent sign-off by a
// delegated, non-conflicted role, and no one conflicted with the deal may sign
// off or decide.
//
// The rule set is held in configuration (AppSettings, setting_key =
// 'related_party_config') so Group Compliance can retune it without a deploy;
// reads fall back to the shipped default. The pure resolution functions live in
// config/relatedParty.js.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const uuid = () => crypto.randomUUID();

// REQ-GATE-08 sourcing channels, canonical in config/intakeConfig.js so the
// capture form and the auto-flag read the same list. Re-shaped to key here.
export { SOURCING_CHANNELS };
export const SOURCING_CHANNEL_OPTIONS = SOURCING_CHANNELS.map((c) => ({ key: c.value, label: c.label, related_by_default: c.related_by_default }));

const AFFILIATE_CHANNELS = new Set(SOURCING_CHANNELS.filter((c) => c.related_by_default).map((c) => c.value));

export async function loadRelatedPartyConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [RELATED_PARTY_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultRelatedPartyConfig();
    return resolveRelatedPartyConfig(rows[0].setting_value);
  } catch {
    return defaultRelatedPartyConfig();
  }
}

async function persistRelatedPartyConfig(config, actor) {
  const payload = {
    setting_key: RELATED_PARTY_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Related-party / affiliate overlay (arms-length + independent sign-off)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [RELATED_PARTY_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'related-party-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

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

function toReview(row) {
  if (!row) return null;
  return {
    ...row,
    conflicted_users: Array.isArray(row.conflicted_users) ? row.conflicted_users : [],
    requires_independent_reviewer: Boolean(row.flagged),
    has_arm_length: Boolean(row.arm_length_basis && row.arm_length_note),
    signed_off: Boolean(row.independent_signed_off_by),
  };
}

/**
 * Auto-detect related-party status from org links and sourcing channel
 * (REQ-RPT-02). An opportunity is potentially related when it names an
 * affiliate org inside the group tree, or arrives through an affiliate
 * referral channel.
 */
export async function detectRelatedParty(opportunity) {
  const data = opportunity?.data || opportunity || {};
  const reasons = [];
  const channel = data.sourcing_channel || null;
  if (channel && AFFILIATE_CHANNELS.has(channel)) reasons.push('sourcing_channel:' + channel);
  const affiliateOrgId = data.affiliate_org_id || data.target_org_id || data.counterparty_org_id || null;
  let affiliateName = null;
  if (affiliateOrgId) {
    const { rows } = await pool.query('SELECT id, name FROM organization WHERE id = $1', [affiliateOrgId]);
    if (rows[0]) { affiliateName = rows[0].name; reasons.push('affiliate_org:' + rows[0].id); }
  }
  return {
    flagged: reasons.length > 0,
    detection_basis: reasons.length ? reasons.join(', ') : null,
    sourcing_channel: channel,
    affiliate_org_id: affiliateOrgId,
    affiliate_name: affiliateName,
  };
}

// Bulk-load the review rows for a set of opportunities, so a board read does
// not run one query per card. Returns a Map keyed by opportunity_id.
export async function loadReviewsFor(ids = []) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return new Map();
  const { rows } = await pool.query('SELECT * FROM related_party_review WHERE opportunity_id = ANY($1)', [list]);
  return new Map(rows.map((r) => [r.opportunity_id, r]));
}

async function readReviewRow(opportunityId) {
  const { rows } = await pool.query('SELECT * FROM related_party_review WHERE opportunity_id = $1', [opportunityId]);
  return rows[0] || null;
}

export async function getRelatedParty(opportunityId, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  const row = await readReviewRow(opportunityId);
  const detected = await detectRelatedParty(opp);
  const config = await loadRelatedPartyConfig();
  const flagged = row ? row.flagged : detected.flagged;
  const effectiveReview = row
    ? { ...row, flagged }
    : { flagged, disclosure: null, arm_length_basis: null, arm_length_note: null, independent_signed_off_by: null, conflicted_users: [] };
  const overlay = resolveOverlayStatus(config, effectiveReview);
  const viewerConflict = isConflictedActor(config, { actor, review: effectiveReview, opportunity: opp });
  const signoffDecision = maySignOff(config, { actor, review: effectiveReview, opportunity: opp });
  const decideDecision = mayDecide(config, { actor, review: effectiveReview, opportunity: opp });
  return {
    opportunity_id: opp.id,
    review: toReview(row),
    detection: detected,
    flagged,
    config,
    overlay,
    viewer: {
      conflicted: viewerConflict.conflicted,
      conflict_reasons: viewerConflict.reasons,
      may_sign_off: signoffDecision.allowed,
      signoff_reason: signoffDecision.reason,
      may_decide: decideDecision.allowed,
      decide_reason: decideDecision.reason,
    },
    arm_length_bases: ARM_LENGTH_BASES,
    channels: SOURCING_CHANNEL_OPTIONS,
  };
}

export async function setRelatedParty(opportunityId, payload = {}, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  if (!canWriteOrg(actor.membership, opp.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to record governance on this opportunity'); e.status = 403; throw e;
  }
  const config = await loadRelatedPartyConfig();
  const detected = await detectRelatedParty(opp);
  const flagged = payload.flagged === undefined ? detected.flagged : Boolean(payload.flagged);
  // Fields the caller omits keep what is already on file, so an edit that only
  // records the arm's-length evidence does not erase the disclosure.
  const prior = await readReviewRow(opportunityId);
  const disclosure = payload.disclosure !== undefined ? payload.disclosure : (prior?.disclosure || null);
  const reviewerEmail = payload.independent_reviewer_email !== undefined
    ? (payload.independent_reviewer_email ? String(payload.independent_reviewer_email).trim().toLowerCase() : null)
    : (prior?.independent_reviewer_email || null);
  let reviewerName = null;
  if (reviewerEmail) {
    const { rows } = await pool.query('SELECT full_name FROM app_user WHERE lower(email) = $1', [reviewerEmail]);
    reviewerName = rows[0]?.full_name || null;
  }
  if (flagged && !String(disclosure || '').trim()) {
    const e = new Error('A related-party disclosure is required'); e.status = 422; e.data = { missing: ['disclosure'] }; throw e;
  }
  const basis = payload.arm_length_basis !== undefined
    ? (payload.arm_length_basis ? String(payload.arm_length_basis).trim() : null)
    : (prior?.arm_length_basis || null);
  const note = payload.arm_length_note !== undefined
    ? (payload.arm_length_note ? String(payload.arm_length_note).trim() : null)
    : (prior?.arm_length_note || null);
  if (flagged && config.require_arm_length_documentation) {
    const missing = [];
    if (!basis) missing.push('arm_length_basis');
    if (!note) missing.push('arm_length_note');
    if (basis && !config.arm_length_bases.includes(basis)) {
      const e = new Error('The arm length basis is not one of the accepted bases'); e.status = 422; e.data = { missing: ['arm_length_basis'] }; throw e;
    }
    if (missing.length) {
      const e = new Error(RELATED_PARTY_MESSAGES.arm_length_required); e.status = 422; e.data = { missing }; throw e;
    }
  }
  const conflictedUsers = payload.conflicted_users === undefined
    ? (Array.isArray(prior?.conflicted_users) ? prior.conflicted_users : [])
    : Array.isArray(payload.conflicted_users)
    ? payload.conflicted_users.map((c) => (typeof c === 'string' ? c : c?.email)).filter(Boolean).map((c) => String(c).trim().toLowerCase())
    : [];
  let signedOffBy = prior?.independent_signed_off_by || null;
  let signedOffAt = prior?.independent_signed_off_at || null;
  if (!flagged) { signedOffBy = null; signedOffAt = null; }
  if (prior && (prior.arm_length_basis || null) !== basis) { signedOffBy = null; signedOffAt = null; }
  const { rows } = await pool.query(
    'INSERT INTO related_party_review ' +
      '(id, opportunity_id, owner_org_id, flagged, detection_basis, sourcing_channel, affiliate_org_id, ' +
      ' independent_reviewer_email, independent_reviewer_name, disclosure, set_by, ' +
      ' arm_length_basis, arm_length_note, conflicted_users, overlay_version, ' +
      ' independent_signed_off_by, independent_signed_off_at) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ' +
      'ON CONFLICT (opportunity_id) DO UPDATE SET flagged = EXCLUDED.flagged, ' +
      ' detection_basis = EXCLUDED.detection_basis, sourcing_channel = EXCLUDED.sourcing_channel, ' +
      ' affiliate_org_id = EXCLUDED.affiliate_org_id, ' +
      ' independent_reviewer_email = EXCLUDED.independent_reviewer_email, ' +
      ' independent_reviewer_name = EXCLUDED.independent_reviewer_name, ' +
      ' disclosure = EXCLUDED.disclosure, set_by = EXCLUDED.set_by, ' +
      ' arm_length_basis = EXCLUDED.arm_length_basis, arm_length_note = EXCLUDED.arm_length_note, ' +
      ' conflicted_users = EXCLUDED.conflicted_users, overlay_version = EXCLUDED.overlay_version, ' +
      ' independent_signed_off_by = EXCLUDED.independent_signed_off_by, ' +
      ' independent_signed_off_at = EXCLUDED.independent_signed_off_at, updated_at = now() ' +
      'RETURNING *',
    [uuid(), opp.id, opp.owner_org_id, flagged, payload.detection_basis || detected.detection_basis,
     payload.sourcing_channel || detected.sourcing_channel, payload.affiliate_org_id || detected.affiliate_org_id,
     reviewerEmail, reviewerName, disclosure || null, actor.email,
     basis, note, JSON.stringify(conflictedUsers), config.version,
     signedOffBy, signedOffAt]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'related_party_flag', actor, orgId: opp.owner_org_id,
    after: { flagged, independent_reviewer_email: reviewerEmail, sourcing_channel: detected.sourcing_channel, arm_length_basis: basis },
  });
  return {
    opportunity_id: opp.id, review: toReview(rows[0]), detection: detected, flagged,
    overlay: resolveOverlayStatus(config, rows[0]),
  };
}

// The overlay verdict for one opportunity and actor, used by the pipeline to
// guard the Gate-1 Screening Decision (W6-03 / BRD WF-06). Returns the config,
// the effective review, the overlay status and whether this actor may decide.
export async function decisionOverlay(opportunity, actor) {
  const config = await loadRelatedPartyConfig();
  const row = await readReviewRow(opportunity.id);
  const detected = await detectRelatedParty(opportunity);
  const flagged = row ? row.flagged : detected.flagged;
  const review = row
    ? { ...row, flagged }
    : { flagged, disclosure: null, arm_length_basis: null, arm_length_note: null, independent_signed_off_by: null, conflicted_users: [] };
  const overlay = resolveOverlayStatus(config, review);
  const decision = mayDecide(config, { actor, review, opportunity });
  return { config, review, overlay, decision };
}

// Record the independent, non-conflicted sign-off that clears the overlay for
// the Gate-1 Screening Decision (W6-03 / BRD WF-06).
export async function signOffRelatedParty(opportunityId, payload = {}, { actor } = {}) {
  const opp = await loadOpportunity(opportunityId, actor);
  if (!canWriteOrg(actor.membership, opp.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to sign off this opportunity'); e.status = 403; throw e;
  }
  const config = await loadRelatedPartyConfig();
  const row = await readReviewRow(opportunityId);
  const detected = await detectRelatedParty(opp);
  const flagged = row ? row.flagged : detected.flagged;
  if (!flagged) {
    const e = new Error(RELATED_PARTY_MESSAGES.not_flagged); e.status = 422; e.data = { overlay: { status: 'not_required' } }; throw e;
  }
  const review = { ...(row || {}), flagged };
  const decision = maySignOff(config, { actor, review, opportunity: opp });
  if (!decision.allowed) {
    const roleIssue = decision.reason === RELATED_PARTY_MESSAGES.signoff_role_required;
    const e = new Error(decision.reason || RELATED_PARTY_MESSAGES.signoff_conflicted);
    e.status = decision.conflicted || roleIssue ? 403 : 422;
    e.data = { missing: [roleIssue ? 'signoff_role' : 'independent_signoff'], conflicted: decision.conflicted };
    throw e;
  }
  const note = payload.signoff_note ? String(payload.signoff_note).trim() : null;
  const { rows } = await pool.query(
    'UPDATE related_party_review SET independent_signed_off_by = $2, independent_signed_off_at = now(), ' +
      ' independent_reviewer_email = COALESCE($3, independent_reviewer_email), ' +
      ' independent_reviewer_name = COALESCE($4, independent_reviewer_name), ' +
      ' signoff_note = $5, overlay_version = $6, updated_at = now() ' +
      'WHERE opportunity_id = $1 RETURNING *',
    [opportunityId, actor.email, actor.email, actor.full_name || null, note, config.version]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'related_party_signoff',
    actor, orgId: opp.owner_org_id,
    after: { signed_off_by: actor.email, overlay_version: config.version, arm_length_basis: review.arm_length_basis || null },
    comment: note || null,
  });
  return { opportunity_id: opp.id, review: toReview(rows[0]), overlay: resolveOverlayStatus(config, rows[0]), signed_off: true };
}

// ---------------------------------------------------------------------------
// HTTP routes - /api/related-party
// ---------------------------------------------------------------------------
export const relatedPartyRouter = express.Router();

relatedPartyRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

relatedPartyRouter.get('/channels', (_req, res) => {
  res.json({ channels: SOURCING_CHANNEL_OPTIONS, flagged_channels: [...AFFILIATE_CHANNELS] });
});

// GET /api/related-party - the effective overlay configuration.
relatedPartyRouter.get('/', async (_req, res) => {
  try {
    const config = await loadRelatedPartyConfig();
    const { ok, errors } = validateRelatedPartyConfig(config);
    res.json({ config, defaults: defaultRelatedPartyConfig(), bases: ARM_LENGTH_BASES, valid: ok, errors, disclaimer: RELATED_PARTY_MESSAGES.disclaimer });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/related-party - replace the overlay and mint a revision (admin-only).
relatedPartyRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the related-party overlay' });
    }
    const base = await loadRelatedPartyConfig();
    const config = buildRelatedPartyConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffRelatedPartyConfig(base, config);
    const id = await persistRelatedPartyConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'related_party_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

relatedPartyRouter.get('/history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'related_party_config_updated'));
  } catch (err) { sendErr(res, err); }
});

relatedPartyRouter.get('/opportunities/:id', async (req, res) => {
  try { res.json(await getRelatedParty(req.params.id, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

relatedPartyRouter.put('/opportunities/:id', async (req, res) => {
  try { res.json(await setRelatedParty(req.params.id, req.body || {}, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

// POST /api/related-party/opportunities/:id/signoff - the independent,
// non-conflicted sign-off that clears the overlay for the screening decision.
relatedPartyRouter.post('/opportunities/:id/signoff', async (req, res) => {
  try { res.json(await signOffRelatedParty(req.params.id, req.body || {}, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

export default relatedPartyRouter;
