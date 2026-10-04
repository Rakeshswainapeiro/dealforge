import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import {
  NOTIFICATION_FREQUENCY_KEY,
  NOTIFICATION_FREQUENCY_MESSAGES,
  NOTIFICATION_FREQUENCIES,
  defaultNotificationFrequencyConfig,
  validateNotificationFrequencyConfig,
  resolveNotificationFrequencyConfig,
  diffNotificationFrequencyConfig,
  buildNotificationFrequencyConfig,
  effectiveFrequency,
  validateUserPreference,
  composeDigest,
} from './config/notificationFrequency.js';

// ---------------------------------------------------------------------------
// Notification email frequency (W6-07 / BRD NTF-01).
//
// A user chooses whether event email is delivered immediately or batched into a
// daily digest. The group policy (whether users may choose, the default, the
// advertised digest hour) lives in an AppSettings record (setting_key =
// 'notification_frequency_config') so the group can retune it without a deploy;
// reads fall back to the shipped default. Each user's own choice is stored on
// their app_user row. The digest only ever groups the rows addressed to that
// user, so entity isolation is preserved (REQ-PRIV-01).
// ---------------------------------------------------------------------------

export async function loadNotificationFrequencyConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [NOTIFICATION_FREQUENCY_KEY]
    );
    if (!rows[0]?.setting_value) return defaultNotificationFrequencyConfig();
    return resolveNotificationFrequencyConfig(rows[0].setting_value);
  } catch {
    return defaultNotificationFrequencyConfig();
  }
}

async function persistNotificationFrequencyConfig(config, actor) {
  const payload = {
    setting_key: NOTIFICATION_FREQUENCY_KEY,
    setting_value: JSON.stringify(config),
    description: 'Notification email frequency policy (NTF-01)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [NOTIFICATION_FREQUENCY_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'notification-frequency-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

// The effective frequency for a recipient email, used by the delivery path.
export async function frequencyForRecipient(email) {
  const config = await loadNotificationFrequencyConfig();
  if (!email) return { config, preference: null, frequency: config.default_frequency };
  let preference = null;
  try {
    const { rows } = await pool.query('SELECT notification_frequency FROM app_user WHERE lower(email) = lower($1)', [email]);
    preference = rows[0]?.notification_frequency || null;
  } catch { preference = null; }
  return { config, preference, frequency: effectiveFrequency(preference, config) };
}

// Whether the email channel should be sent now for this recipient, or deferred
// to the digest. Returns true when the user is on immediate email (or has no
// preference and immediate is the default).
export async function shouldDeliverEmailNow(email) {
  const { frequency } = await frequencyForRecipient(email);
  return frequency !== 'daily_digest';
}

export async function getUserPreference(id) {
  const { rows } = await pool.query('SELECT notification_frequency FROM app_user WHERE id = $1', [id]);
  return rows[0]?.notification_frequency || null;
}

export async function setUserPreference(id, frequency, actor) {
  await pool.query('UPDATE app_user SET notification_frequency = $2, updated_at = now() WHERE id = $1', [id, frequency]);
  await writeAudit({
    entity: 'app_user', entityId: id, action: 'notification_frequency_set',
    actor, orgId: actor.org_id, after: { frequency },
  });
  return frequency;
}

// Build the digest for one user from their own pending (email-channel,
// not-yet-digested) notification rows. Only rows addressed to them are read.
export async function buildUserDigest(email, { since = null, limit = 500 } = {}) {
  const config = await loadNotificationFrequencyConfig();
  const params = [email];
  const where = ['lower(recipient_email) = lower($1)', "channel = 'email'"];
  if (since) { params.push(since); where.push('created_at >= $' + params.length); }
  params.push(Math.min(Number(limit) || 500, 1000));
  const { rows } = await pool.query(
    'SELECT id, recipient_email, kind, subject, entity, entity_id, org_id, created_at FROM notification ' +
      'WHERE ' + where.join(' AND ') + ' ORDER BY created_at DESC LIMIT $' + params.length,
    params
  );
  return composeDigest(rows, { email, since, at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// HTTP routes - /api/notification-frequency
// ---------------------------------------------------------------------------
export const notificationFrequencyRouter = express.Router();

notificationFrequencyRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// GET /api/notification-frequency - the policy plus this user's own choice.
notificationFrequencyRouter.get('/', async (req, res) => {
  try {
    const config = await loadNotificationFrequencyConfig();
    const { ok, errors } = validateNotificationFrequencyConfig(config);
    const preference = await getUserPreference(req.actor.id);
    res.json({
      config,
      defaults: defaultNotificationFrequencyConfig(),
      frequencies: NOTIFICATION_FREQUENCIES,
      valid: ok,
      errors,
      viewer: {
        preference,
        frequency: effectiveFrequency(preference, config),
        may_choose: config.user_selectable,
      },
      disclaimer: NOTIFICATION_FREQUENCY_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// PUT /api/notification-frequency - the user sets their own frequency.
notificationFrequencyRouter.put('/', async (req, res) => {
  try {
    const config = await loadNotificationFrequencyConfig();
    const { value, error, field } = validateUserPreference(req.body?.frequency, config);
    if (error) return res.status(422).json({ error, missing: [field] });
    await setUserPreference(req.actor.id, value, req.actor);
    res.json({ ok: true, viewer: { preference: value, frequency: value, may_choose: config.user_selectable } });
  } catch (err) { sendErr(res, err); }
});

// GET /api/notification-frequency/policy-history - the audited policy edits.
notificationFrequencyRouter.get('/policy-history', async (_req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'notification_frequency_config_updated'));
  } catch (err) { sendErr(res, err); }
});

// PUT /api/notification-frequency/policy - an admin replaces the group policy.
notificationFrequencyRouter.put('/policy', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the notification frequency policy' });
    }
    const base = await loadNotificationFrequencyConfig();
    const config = buildNotificationFrequencyConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffNotificationFrequencyConfig(base, config);
    const id = await persistNotificationFrequencyConfig(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'notification_frequency_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/notification-frequency/digest - this user's own digest preview.
notificationFrequencyRouter.get('/digest', async (req, res) => {
  try {
    const digest = await buildUserDigest(req.actor.email, { since: req.query.since || null });
    res.json(digest);
  } catch (err) { sendErr(res, err); }
});

export default notificationFrequencyRouter;
