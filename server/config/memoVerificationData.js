// ---------------------------------------------------------------------------
// Memo QR verification - vocabulary (W7-05 / BRD OUT-03).
//
// Every exported investment memo carries a QR code that ties the printed copy
// back to the exact record version and content hash it was generated from. A
// scan opens a public verify page that recomputes the record's current
// fingerprint and compares it to the fingerprint embedded in the QR:
//
//   * a copy whose record has since changed no longer matches (stale/tampered);
//   * a forged URL/QR fails the HMAC signature check.
//
// The signature is an HMAC over  id|version|hash|issued_at  so an attacker who
// does not hold the app secret cannot mint a QR that points at an arbitrary
// hash. Pure data only - no database, no network.
// ---------------------------------------------------------------------------

export const MEMO_VERIFICATION_VERSION = '1.0';

export const MEMO_VERIFICATION_KEY = 'memo_verification';

export const MEMO_VERIFICATION_TITLE = 'Sirius memo - QR verification';

// The public, unauthenticated verify page the QR points at. It is a client
// route (src/pages/VerifyMemo.jsx) that reads the query string and calls the
// public verify API.
export const VERIFY_PAGE_PATH = '/verify';

// Public API that recomputes the fingerprint; mounted outside the actor layer
// so a scanned phone with no session can still check the copy.
export const VERIFY_API_PATH = '/api/memo-verification/verify';

// The ordered fields hashed into the fingerprint, in the order they are read.
// The set is deliberately identity + content: the volatile generated_at stamp
// is excluded so two generations of an unchanged record fingerprint alike.
export const FINGERPRINT_FIELDS = [
  { key: 'subsidiary', label: 'Subsidiary' },
  { key: 'opportunity_name', label: 'Opportunity' },
  { key: 'pages', label: 'Six-page body (Part B order)' },
];

// Query-string parameter names carried in the QR payload and read back by the
// public verify endpoint / page.
export const VERIFY_PARAMS = {
  id: 'id',
  version: 'v',
  hash: 'h',
  issuedAt: 't',
  signature: 'sig',
};

// Human-readable outcomes the verify page renders. `valid` is the pass/fail
// flag; the rest explain a failure so a reviewer knows whether the record
// changed or the QR was forged.
export const VERIFY_RESULTS = {
  ok: { valid: true, label: 'Verified', message: 'This copy matches the record version and hash it was issued from.' },
  record_changed: { valid: false, label: 'Record changed', message: 'The record has changed since this copy was issued; the QR no longer matches the live version.' },
  signature_invalid: { valid: false, label: 'Unverified', message: 'The QR signature is not valid - this copy was not issued by DealForge.' },
  unknown_record: { valid: false, label: 'Not found', message: 'No opportunity matches this QR reference.' },
  malformed: { valid: false, label: 'Unreadable', message: 'The QR reference is incomplete or malformed.' },
};

export const MEMO_VERIFICATION_MESSAGES = {
  source: 'QR binds the exported memo to its opportunity record version and content hash.',
  scan_note: 'Scan the QR on the memo to open the verify page. Authorised scans show the record version and hash; an edited record or forged QR fails the check.',
  scanned_audit: 'Public verification scans are recorded in the audit trail.',
};

export default {
  MEMO_VERIFICATION_VERSION,
  MEMO_VERIFICATION_KEY,
  MEMO_VERIFICATION_TITLE,
  VERIFY_PAGE_PATH,
  VERIFY_API_PATH,
  FINGERPRINT_FIELDS,
  VERIFY_PARAMS,
  VERIFY_RESULTS,
  MEMO_VERIFICATION_MESSAGES,
};
