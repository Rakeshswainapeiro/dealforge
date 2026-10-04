# W7-05 - QR verification on exported memos (BRD OUT-03)

## What this delivers

Every exported Sirius memo carries a QR code that binds the printed copy to the
opportunity record **version** and **content hash** it was generated from. A scan
opens a public verify page (no session) that recomputes the live record's
fingerprint and compares it to the one embedded in the QR.

- `server/config/memoVerificationData.js` - vocabulary (verify path, fingerprint
  fields, result legend, query params).
- `server/config/memoVerification.js` - pure math: `memoFingerprint(memo)` is a
  sha256 of the canonicalised six-page body (the volatile `generated_at` stamp is
  excluded, so regenerating an unchanged record keeps the same hash);
  `issueVerification()` / `verifyToken()` sign and check an HMAC over
  `id|version|hash|issued_at`.
- `server/memoVerification.js` - storage + router (`/api/memo-verification`):
  authenticated issue/refresh + QR PNG/SVG, and a **public** `GET /verify`.
- The `.docx` export embeds the QR PNG in the footer (`ImageRun`), so the printed
  memo and the on-screen panel agree.
- `src/pages/VerifyMemo.jsx` - the public `/verify` page the QR points at.

## How the acceptance criteria are met

- **Authorised scan opens record version/hash** - issuing returns the content
  version (`v-<12 hex>`), the full sha256 and the signed verify URL; the panel
  shows both (shot 1) and the verify page echoes them (shot 2).
- **Tampered copy fails** - altering the hash in the QR breaks the HMAC signature,
  so the public page reports **Unverified** without any record lookup (shot 3).
  A record changed after issue is caught by the fingerprint comparison
  (`record_changed`); this is covered by the pure tests.

## Evidence

1. `preparer_verification_qr_panel.png` - the memo dialog's QR verification panel:
   the signed QR, the record version and the content hash the copy is bound to.
2. `preparer_verify_page_match.png` - the public verify page a scan opens; the
   live record fingerprints to the issued hash, so the copy reads **Verified**.
3. `preparer_verify_page_tampered.png` - the same QR with its hash altered; the
   signature check fails and the page reads **Unverified**.

## Tests

- `server/tests/memoVerification.test.js` - 12 pure cases (fingerprint stability,
  generated-at independence, mutation detection, signature round-trip, forged and
  tampered rejection, unknown record).
- `server/tests/m6.test.js` - integration: vocabulary, issue, QR PNG, public
  verify valid, tampered hash invalid, malformed rejected, cross-tenant 403.
