# W5-02 - Version history plus virus scan on upload (DOC-02)

## What this delivers

Every submission upload now passes a configurable document policy before it is
stored: a **50 MB** per-file cap and an accepted-type allow-list (**PDF, DOCX,
XLSX, PPTX** in production, with the legacy formats available outside
production). Each upload is **virus-scanned** - the dependency-free built-in
engine by default, or an operator-configured external command - and the verdict
(clean / suspicious / infected) plus the engine and timestamp are recorded on the
document row. An infected file is rejected and never becomes evidence. The
previous version of every requirement is **retained** (superseded, not
overwritten), so a submission's evidence is reproducible and the form shows the
scan verdict and the retained-version count. The policy is admin-editable without
code and each save mints a new revision.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Admin | Upload Policy tab | admin_document_policy_admin.png | The **Upload Policy** tab in Settings: the **DP-01.1** revision badge and the **50 MB** cap, the size-cap field set to **50 MB per file**, the virus-scan engine selector (**Built-in heuristic**) with "Require a clean scan before an upload is stored" checked, and the accepted types (**pdf**, **docx**, **xlsx**, **pptx** as core, none legacy in production). Saving mints a new revision. |

## How it works

1. server/config/documentPolicyData.js holds the vocabulary and the shipped
   policy: the 50 MB cap, the four core extensions, the legacy set (empty in
   production), the scan engines and the shipped defaults.
2. server/config/documentPolicy.js is the pure module:
   `defaultDocumentPolicy()`, `validateDocumentPolicy()`,
   `resolveDocumentPolicy()` (fallback), `diffDocumentPolicy()`,
   `buildDocumentPolicy()` (mints revision + 1 and the `DP-01.N` version),
   `checkUpload()` (size + type), and the scanner - `scanBufferBuiltin()`
   (EICAR, embedded-executable magic bytes, double-extension names),
   `scanBufferExternal()` (pipes the buffer to the operator command) and
   `scanBlocksUpload()`.
3. server/documentPolicy.js is the API: the policy lives in an AppSettings
   record (setting_key = 'document_policy_config') with `GET`,
   `PUT` (admin-only, mints a revision, writes the `document_policy_updated`
   audit event) and `GET /history`.
4. server/gate.js runs `checkUpload` and `scanUpload` inside
   `addDocumentVersion`, rejecting a blocked scan before any row is written, and
   persists the scan verdict / engine / detail / timestamp on the
   `submission_document` row (new columns in server/db.js).
5. src/api/client.js adds the policy methods, src/pages/Settings.jsx adds the
   **Upload Policy** tab, and src/pages/SubmitOpportunity.jsx shows each
   document's scan verdict and retained-version count.

## Validation

- node --test server/tests/documentPolicy.test.js - 23 pass, 5 suites (shipped
  policy, validation, resolve and mint, upload checks, virus scan).
- BASE_URL=http://localhost:34099 node --test server/tests/*.test.js - 643 pass
  / 149 suites, including the five W5-02 integration cases in server/tests/m6.test.js:
  a reader sees the effective policy + 50 MB default, a deal lead gets 403 on
  PUT, an admin edit mints revision + 1 and is recorded in history, a clean
  upload records its scan verdict and engine, and an infected (EICAR) upload is
  rejected with 422 and writes no document row.
- eslint clean on the touched files; npm run build passes.
- Demo verification: GET /api/document-policy on the demo stack returns DP-01.1
  with the 50 MB cap and the four core types.

## Notes

The shipping gate still enforces the standing `UPLOAD_MAX_BYTES` hard ceiling in
server/security.js; the policy adds the configurable, BRD-named cap and the type
allow-list on top. Evidence captured against the demo stack at
http://localhost:34010 (production build, so the legacy set is empty as the BRD
intends).
