// ---------------------------------------------------------------------------
// Security posture (W9-02 / BRD NFR-02).
//
// The security review is a set of controls the platform ships plus a dependency
// advisory scan. This module records the control catalog and the accepted
// go-live scan result so the posture can be shown and audited in one place. The
// numbers here are the output of scripts/security_scan.mjs, refreshed by hand
// from a fresh run (the report itself is the evidence artefact).
// ---------------------------------------------------------------------------

export const SECURITY_POSTURE_VERSION = 'NFR-02.1';

// The independent penetration test is a Sirius IT activity; the platform can
// only record whether it has happened.
export const SECURITY_GOLIVE_SCAN = {
  scanned_at: '2026-09-27',
  tool: 'scripts/security_scan.mjs',
  server_runtime: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
  frontend_build: { critical: 0, high: 0, moderate: 2, low: 0, total: 2 },
  full_tree: { critical: 0, high: 0, moderate: 2, low: 2, total: 4 },
  open_critical_or_high: 0,
  server_files_checked: 59,
  syntax_failures: 0,
  sink_findings_reviewed: 8,
  unresolved_sinks: 0,
  accepted_residual: [
    { id: 'quill', severity: 'moderate', note: 'react-quill/Quill XSS advisory; the bundled editor is not used on the deal-flow surfaces. Tracked for the editor dependency refresh.' },
    { id: 'build_toolchain', severity: 'moderate/low', note: 'Remaining moderate/low advisories are in the build/dev toolchain (not shipped in the runtime image); resolved on the next dependency bump.' },
  ],
};

// The controls the review covers, each with the evidence pointer. Kept flat so
// the console can render it as a simple table and a reviewer can grep one file.
export const SECURITY_CONTROLS = [
  { id: 'security_headers', label: 'Security response headers', status: 'implemented', evidence: 'server/security.js securityHeaders() — nosniff, SAMEORIGIN, no-referrer, removes X-Powered-By on every response.' },
  { id: 'rate_limiting', label: 'Rate limiting on abuse-prone routes', status: 'implemented', evidence: 'server/security.js rateLimit() — bounded in-memory limiter on the API and the upload/AI/notification routes; tunable via env.' },
  { id: 'upload_filter', label: 'Upload extension + size allow-list', status: 'implemented', evidence: 'server/security.js isAllowedUpload()/uploadFilter() — extension allow-list with a size ceiling; 415/413 on violation.' },
  { id: 'org_trust', label: 'Client-supplied org id never trusted', status: 'implemented', evidence: 'server/security.js trustedOwnerOrg() — owner org derived from the resolved actor; sibling-org write is 403.' },
  { id: 'authz', label: 'Server-side RBAC + ABAC + tenant isolation', status: 'implemented', evidence: 'server/rbac.js and server/abac.js enforce role x org x stage and policy attributes on read and write; sibling hard-isolation is negative-tested.' },
  { id: 'authorisation_surface', label: 'Denied requests audited', status: 'implemented', evidence: 'every denied application-API call writes an access_denied audit event (J6).' },
  { id: 'session_management', label: 'Session revocation on lifecycle change', status: 'implemented', evidence: 'W8-06 revokes sessions on deactivate/ban/password change and refuses a blocked account on the next request.' },
  { id: 'audit_integrity', label: 'Hash-chained immutable audit trail', status: 'implemented', evidence: 'server/auditChain.js verifies the audit hash chain; rows are append-only.' },
  { id: 'ai_governance', label: 'AI provider approval and log redaction', status: 'implemented', evidence: 'W9-01 refuses an unapproved provider before the outbound call and stores a redacted, attributed log.' },
  { id: 'dependency_scan', label: 'Dependency advisory scan', status: 'passing', evidence: 'scripts/security_scan.mjs — 0 open critical/high across the server runtime, frontend build and dev trees.' },
  { id: 'syntax_sinks', label: 'Source syntax + injection-sink scan', status: 'passing', evidence: 'scripts/security_scan.mjs — 59 server files syntax-clean; 8 sink hits reviewed, 0 unresolved.' },
  { id: 'pen_test', label: 'Independent penetration test', status: 'external', evidence: 'Sirius IT activity, not a platform control. Recorded as an open go-live dependency.' },
  { id: 'data_residency', label: 'UAE data residency / sovereign hosting', status: 'external', evidence: 'See W9-03 (NFR-01); hosting sign-off is a Sirius IT activity.' },
];

export function buildSecurityPosture() {
  const controls = SECURITY_CONTROLS.map((c) => ({ ...c }));
  const implemented = controls.filter((c) => c.status === 'implemented').length;
  const passing = controls.filter((c) => c.status === 'passing').length;
  const external = controls.filter((c) => c.status === 'external').length;
  return {
    version: SECURITY_POSTURE_VERSION,
    scan: SECURITY_GOLIVE_SCAN,
    controls,
    summary: { total: controls.length, implemented, passing, external, open_critical_or_high: SECURITY_GOLIVE_SCAN.open_critical_or_high },
    gate: {
      pass: SECURITY_GOLIVE_SCAN.open_critical_or_high === 0 && SECURITY_GOLIVE_SCAN.syntax_failures === 0 && SECURITY_GOLIVE_SCAN.unresolved_sinks === 0,
      policy: 'No open critical or high advisories at go-live.',
    },
  };
}

export default { SECURITY_POSTURE_VERSION, SECURITY_GOLIVE_SCAN, SECURITY_CONTROLS, buildSecurityPosture };
