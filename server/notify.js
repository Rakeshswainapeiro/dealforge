import { sendEmail } from './mailer.js';
import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { shouldDeliverEmailNow } from './notificationFrequency.js';

// ---------------------------------------------------------------------------
// Notifications (E8.2 participant notification; E9.4 email + SMS on assignment,
// return and decision).
//
// The durable record is a notification row: one row per recipient per channel
// ('in_app', 'email', 'sms'). The in-app row is the inbox entry; the transport
// rows record the delivery attempt and its outcome so "did we tell them?" is
// answerable from the database alone.
//
// Transport is the existing integrations service (Resend for email, the SMS
// log endpoint otherwise) so behaviour is identical in the pilot and in tests.
// In test mode attempts are recorded but no network call is made; delivery
// failures are logged, never thrown, so a notification can never break a state
// change (REQ-FLOW-02).
// ---------------------------------------------------------------------------

export const NOTIFY_CHANNELS = ['in_app', 'email', 'sms'];

// Attempt a real transport call only outside tests and when not disabled.
function transportEnabled() {
  if (process.env.NOTIFY_DELIVERY === 'off') return false;
  if (process.env.NOTIFY_DELIVERY === 'on') return true;
  return process.env.NODE_ENV !== 'test';
}

// Normalise the "to" argument into resolvable recipients. Accepts a string, an
// array of emails, or objects carrying an explicit phone (used when the caller
// already knows the number).
export async function resolveRecipients(to) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const map = new Map();
  for (const item of list) {
    if (typeof item === 'string') {
      const email = item.trim().toLowerCase();
      if (email) map.set(email, { email, phone: null, full_name: null });
    } else if (item && item.email) {
      const email = String(item.email).trim().toLowerCase();
      if (email) map.set(email, { email, phone: item.phone || null, full_name: item.full_name || null });
    }
  }
  const emails = [...map.keys()];
  if (emails.length) {
    const { rows } = await pool.query(
      'SELECT email, full_name, phone FROM app_user WHERE lower(email) = ANY($1)',
      [emails]
    );
    for (const row of rows) {
      const key = String(row.email).toLowerCase();
      const existing = map.get(key) || { email: key, phone: null, full_name: null };
      map.set(key, { email: key, full_name: existing.full_name || row.full_name, phone: existing.phone || row.phone || null });
    }
  }
  return [...map.values()];
}

async function recordChannel({ recipient, channel, kind, subject, body, entity, entityId, orgId, actor, status, providerDetail = null, phone = null }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO notification
       (id, recipient_email, kind, subject, body, entity, entity_id, org_id, actor_email,
        channel, status, phone, provider_detail, attempted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())`,
    [id, recipient.email, kind, subject || null, body || null, entity,
     entityId != null ? String(entityId) : null, orgId, actor?.email || null,
     channel, status, phone, providerDetail]
  );
  return { id, to: recipient.email, channel, kind, status };
}

/**
 * Record and (optionally) deliver a notification.
 *
 * @param to       recipient email(s) - string, array of strings, or objects with email/phone
 * @param channels which channels to fan out to; defaults to ['in_app','email']
 * @param deliver  set false to record without attempting transport
 */
export async function notify({
  to,
  kind,
  subject,
  body,
  entity = null,
  entityId = null,
  orgId = null,
  actor = null,
  deliver = true,
  channels = ['in_app', 'email'],
} = {}) {
  if (!to) return [];
  const recipients = await resolveRecipients(to);
  if (!recipients.length) return [];
  const wanted = channels.filter((c) => NOTIFY_CHANNELS.includes(c));
  const active = wanted.length ? wanted : ['in_app'];
  const performDelivery = deliver && transportEnabled();
  const rows = [];

  for (const recipient of recipients) {
    if (active.includes('in_app')) {
      rows.push(await recordChannel({
        recipient, channel: 'in_app', kind, subject, body, entity, entityId, orgId, actor, status: 'delivered',
      }));
    }
    if (active.includes('email') && recipient.email) {
      let status = 'recorded';
      let detail = 'transport disabled';
      // A user on a daily digest does not receive event email as it happens:
      // the row is recorded and deferred, and the digest composes it later
      // (W6-07 / NTF-01). Entity isolation is unaffected because the digest
      // only ever groups rows addressed to that same recipient.
      const deliverNow = await shouldDeliverEmailNow(recipient.email).catch(() => true);
      if (!deliverNow) {
        status = 'deferred';
        detail = 'queued for daily digest';
      } else if (performDelivery) {
        // Straight to the in-region SMTP relay (no HTTP hop, no client keys).
        const sent = await sendEmail({ to: recipient.email, subject: subject || 'DealForge', text: body || subject || '' });
        status = sent.delivered ? 'sent' : sent.status;
        detail = sent.detail;
        if (sent.status === 'failed') console.warn('[notify] email delivery failed:', sent.detail);
      }
      rows.push(await recordChannel({
        recipient, channel: 'email', kind, subject, body, entity, entityId, orgId, actor, status, providerDetail: detail,
      }));
    }
    if (active.includes('sms') && recipient.phone) {
      let status = 'recorded';
      let detail = 'transport disabled';
      if (performDelivery) {
        // No SMS gateway is in Phase 1 scope (NTF-01 is in-app and email);
        // the row records that nothing was sent.
        status = 'logged';
        detail = 'no SMS gateway configured';
      }
      rows.push(await recordChannel({
        recipient, channel: 'sms', kind, subject, body, entity, entityId, orgId, actor,
        status, providerDetail: detail, phone: recipient.phone,
      }));
    }
  }

  await writeAudit({
    entity: entity || 'notification',
    entityId,
    action: 'notify',
    actor,
    orgId,
    after: { kind, channels: active, recipients: recipients.map((r) => r.email) },
  });
  return rows;
}

export async function listNotifications({ email, limit = 50, allChannels = false } = {}) {
  const params = [];
  const where = [];
  if (email) { params.push(email); where.push('recipient_email = $' + params.length); }
  if (!allChannels) where.push("channel = 'in_app'");
  params.push(Math.min(Number(limit) || 50, 200));
  const { rows } = await pool.query(
    'SELECT * FROM notification ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT $' + params.length,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// HTTP routes - /api/notifications (the recipient's own inbox).
// ---------------------------------------------------------------------------
export const notificationsRouter = express.Router();

notificationsRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

notificationsRouter.get('/', async (req, res) => {
  try {
    const all = req.query.all === '1';
    // Only an admin may read every inbox; otherwise a subsidiary user could
    // read across the group (REQ-PRIV-01 / E2.4).
    if (all && !req.actor.roles?.includes('admin')) {
      return res.status(403).json({ error: 'Admin role required to read all notifications' });
    }
    const items = await listNotifications({
      email: all ? null : req.actor.email,
      limit: req.query.limit,
      allChannels: all || req.query.channels === 'all',
    });
    res.json({ recipient: all ? null : req.actor.email, items, total: items.length });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

export default notificationsRouter;
