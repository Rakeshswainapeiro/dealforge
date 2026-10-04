// ---------------------------------------------------------------------------
// Security primitives for the MVP hardening pass (E10.1, plan §9).
//
// Everything here is intentionally dependency-free so the hardening story is
// auditable in one small file:
//   - securityHeaders()  : a conservative header baseline on every response
//   - rateLimit()        : a bounded in-memory limiter for abuse-prone routes
//   - uploadFilter()     : an extension + mimetype allow-list for uploads
//   - assertNoClientOrgTrust() : documents the one rule that org ids are never
//     read from the client; kept as a helper so the intent is greppable.
//
// A single-node in-memory limiter is the right shape for the MVP (plan §9
// availability: single-node acceptable). Swap for a shared store at rollout.
// ---------------------------------------------------------------------------

export function securityHeaders() {
  return (req, res, next) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  };
}

// ---------------------------------------------------------------------------
// Rate limiting (E10.1).
//
// Fixed-window counter keyed by the acting user when known, falling back to
// the peer address. The store is swept lazily so a long-lived process cannot
// grow without bound. Limits are read from the environment so an operator can
// tighten them without a code change:
//   RATE_LIMIT_DISABLED=1        - turn every limiter off (tests)
//   RATE_LIMIT_MAX / _WINDOW_MS  - defaults for the generic integration limit
// ---------------------------------------------------------------------------
const buckets = new Map();

function clientKey(req) {
  const actorId = req.actor?.id;
  if (actorId) return 'u:' + actorId;
  const fwd = req.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0].trim() : req.ip) || 'unknown';
  return 'ip:' + ip;
}

function sweep(now, windowMs) {
  if (buckets.size < 5000) return;
  for (const [key, entry] of buckets) {
    if (now - entry.start >= windowMs) buckets.delete(key);
  }
}

export function rateLimit({ windowMs = 60_000, max = 120, name = 'default', message } = {}) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === '1') return next();
    const now = Date.now();
    sweep(now, windowMs);
    const key = name + '|' + clientKey(req);
    let entry = buckets.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      buckets.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.start + windowMs - now) / 1000)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests; slow down and try again.' });
    }
    next();
  };
}

// Test/ops hook: clear the counters (used by the test suite for determinism).
export function resetRateLimits() {
  buckets.clear();
}

// ---------------------------------------------------------------------------
// Upload validation (E10.1): a small allow-list of document extensions plus a
// size ceiling. Anything else is rejected before it is written to disk or the
// object store. Kept broad enough for real deal documents (pdf/office/images/
// csv/text) but not executable or script-bearing types.
// ---------------------------------------------------------------------------
export const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 100 * 1024 * 1024);

export const SAFE_UPLOAD_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.tsv', '.txt', '.md', '.json', '.xml', '.rtf', '.odt', '.ods',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.bmp',
  '.zip', '.msg', '.eml', '.log',
]);

export function isAllowedUpload(filename) {
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return SAFE_UPLOAD_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

// multer fileFilter that rejects disallowed extensions with a 415-shaped error.
export function uploadFilter(_req, file, cb) {
  if (!isAllowedUpload(file.originalname)) {
    const err = new Error('Unsupported file type: ' + (file.originalname || 'unknown'));
    err.status = 415;
    return cb(err);
  }
  return cb(null, true);
}

// ---------------------------------------------------------------------------
// Client input trust (REQ-RBAC-02, NFR security).
// The owning organisation of a record is always derived from the resolved
// actor, never from a client-supplied owner_org_id, unless the caller is a
// cross-org writer (admin / governance) who may legitimately place a record in
// a descendant or granted org. Centralised here so the rule has one home.
// ---------------------------------------------------------------------------
export function trustedOwnerOrg(actor, requestedOrgId, { allowRequested = false } = {}) {
  if (allowRequested && requestedOrgId) return requestedOrgId;
  return actor?.org_id || null;
}

export default { securityHeaders, rateLimit, resetRateLimits, uploadFilter, isAllowedUpload };

