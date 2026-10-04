// ---------------------------------------------------------------------------
// Document upload policy - vocabulary and shipped default (W5-02 / BRD DOC-02).
//
// Source of truth: the Phase-1 BRD, "Document upload": a submission document is
// capped at 50 MB and accepted in PDF, DOCX, XLSX and PPTX; every upload is
// virus-scanned and the previous version is retained so a submission's evidence
// is reproducible.
//
// The vocabulary lives here; the pure policy / scan logic lives in
// server/config/documentPolicy.js and the storage + HTTP routes in
// server/documentPolicy.js. An administrator may edit the policy without code
// (the effective policy is held in an AppSettings record).
// ---------------------------------------------------------------------------

export const DOCUMENT_POLICY_VERSION = 'DP-01.1';
export const DOCUMENT_POLICY_CONFIG_KEY = 'document_policy_config';
export const DOCUMENT_POLICY_DEFAULT_REVISION = 1;
export const DOCUMENT_POLICY_VERSION_PREFIX = 'DP-01.';

// The four document types the BRD names as the accepted submission formats.
export const DOCUMENT_CORE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx'];

// The legacy / convenience formats kept available for pilots and the demo
// fixtures. An operator turns them off to enforce exactly the four core types.
export const DOCUMENT_LEGACY_EXTENSIONS = [
  'doc', 'xls', 'ppt', 'csv', 'tsv', 'txt', 'md', 'rtf', 'odt', 'ods', 'msg', 'eml',
];

// The scan engines the policy can select. 'builtin' is the dependency-free
// heuristic scanner; 'external' shells out to the operator-configured command.
export const DOCUMENT_SCAN_ENGINES = ['builtin', 'external'];

// The verdict vocabulary a scan can return.
export const DOCUMENT_SCAN_VERDICTS = ['clean', 'suspicious', 'infected'];

// The shipped policy: the BRD size ceiling and core types, with the legacy set
// available in non-production so pilots and the demo fixtures keep working. In
// production the legacy set is off, leaving exactly PDF / DOCX / XLSX / PPTX.
const PRODUCTION = process.env.NODE_ENV === 'production';

export const DOCUMENT_POLICY_DEFAULT = {
  max_upload_mb: 50,
  core_extensions: [...DOCUMENT_CORE_EXTENSIONS],
  legacy_extensions: PRODUCTION ? [] : [...DOCUMENT_LEGACY_EXTENSIONS],
  scan_engine: 'builtin',
  require_clean_scan: true,
  block_suspicious: false,
};

export const DOCUMENT_POLICY_DISCLAIMER =
  'Submission documents are capped at 50 MB and accepted in PDF, DOCX, XLSX and PPTX (legacy formats are available outside production). Every upload is virus-scanned and the previous version is retained.';

export default {
  DOCUMENT_POLICY_VERSION, DOCUMENT_POLICY_CONFIG_KEY, DOCUMENT_POLICY_DEFAULT_REVISION,
  DOCUMENT_POLICY_VERSION_PREFIX, DOCUMENT_CORE_EXTENSIONS, DOCUMENT_LEGACY_EXTENSIONS,
  DOCUMENT_SCAN_ENGINES, DOCUMENT_SCAN_VERDICTS, DOCUMENT_POLICY_DEFAULT,
  DOCUMENT_POLICY_DISCLAIMER,
};
