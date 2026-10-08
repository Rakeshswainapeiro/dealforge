import nodemailer from 'nodemailer';
import { pool } from './db.js';

// ---------------------------------------------------------------------------
// Outbound email (BRD v2 NTF-01, data residency).
//
// Mail goes through the SMTP relay Sirius designates (in-region, e.g. the
// group's Exchange Online / UAE relay), configured by environment:
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" for 465), SMTP_USER,
//   SMTP_PASS, MAIL_FROM ("DealForge <dealforge@sirius.ae>")
// Without SMTP_HOST, or with NOTIFY_DELIVERY=log, mail is recorded in
// email_logs and not sent, so a dev or test environment never emails anyone.
// The notification service calls this directly (no HTTP hop, no client-side
// keys), and every attempt is logged with its outcome.
// ---------------------------------------------------------------------------

let transport = null;
let transportKey = null;

export function mailConfig(env = process.env) {
  const host = env.SMTP_HOST || '';
  return {
    host,
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'DealForge <no-reply@dealforge.local>',
    mode: env.NOTIFY_DELIVERY === 'log' || !host ? 'log' : 'smtp',
  };
}

function getTransport(cfg) {
  const key = [cfg.host, cfg.port, cfg.secure, cfg.user].join('|');
  if (!transport || transportKey !== key) {
    transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      // Require TLS on the submission port; never send credentials in clear.
      requireTLS: !cfg.secure,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    transportKey = key;
  }
  return transport;
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const isEmail = (v) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(v || ''));

/**
 * Send (or log) one email. Returns { delivered, status, detail }.
 * `text` is plain text; the HTML part is the escaped text, so a subject or a
 * user-written comment can never inject markup into a recipient's mail client.
 */
export async function sendEmail({ to, subject, text }, { env = process.env } = {}) {
  const cfg = mailConfig(env);
  const cleanSubject = String(subject || 'DealForge').replace(/[\r\n]+/g, ' ').slice(0, 200);
  let status = 'logged';
  let detail = cfg.mode === 'log' ? 'logged (no SMTP relay configured)' : '';
  if (!isEmail(to)) {
    status = 'failed';
    detail = 'invalid recipient';
  } else if (cfg.mode === 'smtp') {
    try {
      const info = await getTransport(cfg).sendMail({
        from: cfg.from, to, subject: cleanSubject, text: String(text || ''),
        html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + escapeHtml(text) + '</div>',
      });
      status = 'sent';
      detail = info?.messageId || 'accepted';
    } catch (err) {
      status = 'failed';
      detail = err.message;
    }
  }
  await pool.query(
    'INSERT INTO email_logs (to_email, from_email, subject, body, status) VALUES ($1, $2, $3, $4, $5)',
    [String(to || ''), cfg.from, cleanSubject, String(text || ''), status]
  ).catch((err) => console.warn('[mail] failed to log email:', err.message));
  return { delivered: status === 'sent', status, detail };
}

export default { sendEmail, mailConfig, escapeHtml };
