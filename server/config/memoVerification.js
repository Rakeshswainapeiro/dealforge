// ---------------------------------------------------------------------------
// Memo QR verification - pure assembly (W7-05 / BRD OUT-03).
//
// Two responsibilities, both pure (no database, no network):
//
//   1. Fingerprint an assembled memo: a deterministic sha256 over the ordered
//      identity + body of the six Part B pages. The volatile generated_at stamp
//      is deliberately excluded, so regenerating an unchanged record yields the
//      same fingerprint - the QR therefore only fails when the *record* changed.
//
//   2. Issue and check a signed QR payload: `id|version|hash|issued_at` with an
//      HMAC signature. verifyToken() recomputes the fingerprint of the live
//      record and compares it to the one the QR carries, and verifies the
//      signature, so either a changed record or a forged QR fails.
// ---------------------------------------------------------------------------

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalize } from './auditChain.js';
import {
  MEMO_VERIFICATION_VERSION, MEMO_VERIFICATION_KEY, MEMO_VERIFICATION_TITLE,
  VERIFY_PAGE_PATH, VERIFY_API_PATH, FINGERPRINT_FIELDS, VERIFY_PARAMS, VERIFY_RESULTS,
  MEMO_VERIFICATION_MESSAGES,
} from './memoVerificationData.js';

export {
  MEMO_VERIFICATION_VERSION, MEMO_VERIFICATION_KEY, MEMO_VERIFICATION_TITLE,
  VERIFY_PAGE_PATH, VERIFY_API_PATH, FINGERPRINT_FIELDS, VERIFY_PARAMS, VERIFY_RESULTS,
  MEMO_VERIFICATION_MESSAGES,
};

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

// The value actually hashed: the memo's identity and six pages, canonicalised so
// key order never changes the bytes. generated_at / evidence stamps are excluded
// so the fingerprint tracks the record's content, not when it was printed.
export function fingerprintPayload(memo = {}) {
  return {
    subsidiary: memo.subsidiary || null,
    opportunity_name: memo.opportunity_name || null,
    pages: (Array.isArray(memo.pages) ? memo.pages : []).map((page) => ({
      number: page.number,
      key: page.key,
      title: page.title || null,
      sections: page.sections || [],
    })),
  };
}

// Deterministic content hash of an assembled memo. Two builds of the same
// record produce the same hash; any change to a value inside the six pages
// changes it.
export function memoFingerprint(memo) {
  return sha256Hex(canonicalize(fingerprintPayload(memo)));
}

// The exact byte string signed. Field order is fixed so signer and verifier
// agree regardless of how the token was assembled.
export function signingString({ id, version, hash, issuedAt }) {
  return [id, version, hash, issuedAt].map((v) => (v === undefined || v === null ? '' : String(v))).join('|');
}

// Short HMAC of the signing string, truncated to 32 hex chars (128 bits) - long
// enough that a forged signature is infeasible, short enough for a QR payload.
export function signVerification({ id, version, hash, issuedAt, secret }) {
  const mac = createHmac('sha256', String(secret || '')).update(signingString({ id, version, hash, issuedAt })).digest('hex');
  return mac.slice(0, 32);
}

function safeEqualHex(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  try { return timingSafeEqual(Buffer.from(sa, 'hex'), Buffer.from(sb, 'hex')); } catch { return false; }
}

// Build the QR payload: { url, token, params }. The URL points at the public
// verify page with id/version/hash/issued_at/signature in the query string, so a
// plain phone camera scan opens the check with no app session.
export function issueVerification({ opportunityId, version, hash, issuedAt, baseUrl, secret }) {
  const id = String(opportunityId);
  const v = version === undefined || version === null ? '1' : String(version);
  const t = issuedAt || new Date().toISOString();
  const signature = signVerification({ id, version: v, hash, issuedAt: t, secret });
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const params = {
    [VERIFY_PARAMS.id]: id,
    [VERIFY_PARAMS.version]: v,
    [VERIFY_PARAMS.hash]: String(hash),
    [VERIFY_PARAMS.issuedAt]: t,
    [VERIFY_PARAMS.signature]: signature,
  };
  const qs = new URLSearchParams(params).toString();
  const url = (base || '') + VERIFY_PAGE_PATH + '?' + qs;
  return { url, token: qs, signature, params, opportunity_id: id, version: v, hash: String(hash), issued_at: t };
}

// Verify the signature over the token fields. Returns false for a malformed or
// forged token.
export function verifySignature({ id, version, hash, issuedAt, signature, secret }) {
  if (!id || !hash || !signature) return false;
  const expected = signVerification({ id, version, hash, issuedAt, secret });
  return safeEqualHex(expected, signature);
}

// The full check: recompute the live record's fingerprint and compare it to the
// one in the QR, after the signature check. `result` is one of VERIFY_RESULTS.
export function verifyToken({ token = {}, memo, secret }) {
  const { id, version, hash, issuedAt, signature } = token;
  if (!id || !hash) return { valid: false, result: VERIFY_RESULTS.malformed, scanned: { ...token } };
  if (!verifySignature({ id, version, hash, issuedAt, signature, secret })) {
    return { valid: false, result: VERIFY_RESULTS.signature_invalid, scanned: { id, version, hash, issued_at: issuedAt } };
  }
  if (!memo) return { valid: false, result: VERIFY_RESULTS.unknown_record, scanned: { id, version, hash, issued_at: issuedAt } };
  const current = memoFingerprint(memo);
  const match = current === String(hash);
  return {
    valid: match,
    result: match ? VERIFY_RESULTS.ok : VERIFY_RESULTS.record_changed,
    issued_hash: String(hash),
    current_hash: current,
    version: version != null ? String(version) : null,
    issued_at: issuedAt || null,
    scanned: { id, version, hash, issued_at: issuedAt },
  };
}

// Parse a query string (or URLSearchParams) back into the token shape used by
// verifyToken. Accepts either the raw `?...` string or a plain object.
export function tokenFromQuery(query) {
  const get = (key) => {
    if (!query) return undefined;
    if (typeof query.get === 'function') return query.get(key) || undefined;
    if (typeof query === 'string') return new URLSearchParams(query.replace(/^\?/, '')).get(key) || undefined;
    return query[key];
  };
  return {
    id: get(VERIFY_PARAMS.id),
    version: get(VERIFY_PARAMS.version),
    hash: get(VERIFY_PARAMS.hash),
    issuedAt: get(VERIFY_PARAMS.issuedAt),
    signature: get(VERIFY_PARAMS.signature),
  };
}

export default {
  fingerprintPayload,
  memoFingerprint,
  signingString,
  signVerification,
  issueVerification,
  verifySignature,
  verifyToken,
  tokenFromQuery,
};
