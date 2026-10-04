// ---------------------------------------------------------------------------
// Hash-chained audit vocabulary (W6-05 / BRD AUD-01).
//
// Source of truth: the Phase-1 BRD, Audit Trail - "Hash-chained, tamper-evident
// audit over append-only audit_event" with the accept criterion "Log
// verifiable; tamper detected; 100% gate actions logged".
//
// Every audit_event row is linked to the row before it by a SHA-256 hash of the
// previous row's hash plus a canonical serialisation of this row. Editing or
// removing any historic row breaks the chain from that point forward, so the
// log is verifiable end to end and any tamper is detectable by recomputation.
//
// This module is vocabulary only; the pure hashing, canonicalisation and
// verification functions live in config/auditChain.js and the HTTP route in
// server/auditChain.js.
// ---------------------------------------------------------------------------

export const AUDIT_CHAIN_CONFIG_KEY = 'audit_chain_config';
export const AUDIT_CHAIN_VERSION = 'AUDC-01.1';
export const AUDIT_CHAIN_VERSION_PREFIX = 'AUDC-01.';
export const AUDIT_CHAIN_DEFAULT_REVISION = 1;
export const AUDIT_CHAIN_OWNER = 'Group Compliance / Internal Audit';

// The chain algorithm. SHA-256 is the shipped default; the field is kept in
// configuration so a deployment can pin it and so the value is recorded with
// each verified summary.
export const AUDIT_CHAIN_ALGORITHM = 'sha256';

// The anchor a chain starts from: the prev_hash of the very first chained row.
// A fixed, published constant so the whole chain can be re-verified
// independently of this database.
export const AUDIT_CHAIN_GENESIS = 'DEALFORGE-AUDIT-GENESIS-V1';

// Fields that participate in the row hash. Anything outside this set (the hash
// columns themselves) is deliberately excluded.
export const AUDIT_CHAIN_FIELDS = [
  'seq', 'entity', 'entity_id', 'action', 'actor_id', 'actor_email',
  'org_id', 'role', 'before', 'after', 'comment', 'ts',
];

export const AUDIT_CHAIN_MESSAGES = {
  config_invalid: 'The audit chain configuration is invalid.',
  unsupported_algorithm: 'Only the sha256 chaining algorithm is supported.',
  verify_ok: 'The audit chain is intact: every row hash matches and the chain is unbroken.',
  verify_broken: 'The audit chain is broken: a row has been altered or removed.',
  verify_empty: 'There are no audit rows to verify yet.',
  tamper_detected: 'Tamper detected: recomputing a row hash did not match the stored hash.',
  disabled: 'Hash chaining is switched off; new audit rows are recorded without a chain hash.',
  disclaimer:
    'Each audit row stores the hash of the previous row plus a canonical hash of its own fields. ' +
    'Recomputing the chain from genesis proves the log has not been altered; a mismatch names the first ' +
    'broken row. Verification is available to administrators and every run is itself audited.',
};

export default {
  AUDIT_CHAIN_CONFIG_KEY,
  AUDIT_CHAIN_VERSION,
  AUDIT_CHAIN_VERSION_PREFIX,
  AUDIT_CHAIN_DEFAULT_REVISION,
  AUDIT_CHAIN_OWNER,
  AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_GENESIS,
  AUDIT_CHAIN_FIELDS,
  AUDIT_CHAIN_MESSAGES,
};
