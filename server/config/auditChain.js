// ---------------------------------------------------------------------------
// Hash-chained, tamper-evident audit (W6-05 / BRD AUD-01, REQ-RBAC-04).
//
// Pure functions only - no database, no network. Each audit row is linked to
// the one before it:
//
//   hash(row) = sha256( prev_hash || canonical(row fields) )
//
// where canonical() is a deterministic JSON serialisation with sorted keys so
// two encoders agree on the bytes. Recomputing the chain from the genesis
// constant proves the whole log is intact; editing, reordering or removing any
// row changes its hash (and every downstream prev_hash), which is exactly the
// tamper the BRD requires us to detect.
//
// The configuration (on/off, algorithm, owner) is held in AppSettings by
// server/auditChain.js; this module owns the vocabulary and the math.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  AUDIT_CHAIN_CONFIG_KEY, AUDIT_CHAIN_VERSION, AUDIT_CHAIN_VERSION_PREFIX,
  AUDIT_CHAIN_DEFAULT_REVISION, AUDIT_CHAIN_OWNER, AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_GENESIS, AUDIT_CHAIN_FIELDS, AUDIT_CHAIN_MESSAGES,
} from './auditChainData.js';

export {
  AUDIT_CHAIN_CONFIG_KEY, AUDIT_CHAIN_VERSION, AUDIT_CHAIN_VERSION_PREFIX,
  AUDIT_CHAIN_DEFAULT_REVISION, AUDIT_CHAIN_OWNER, AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_GENESIS, AUDIT_CHAIN_FIELDS, AUDIT_CHAIN_MESSAGES,
};

function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Deterministic serialisation: objects are written with sorted keys, arrays keep
// their order, and undefined is normalised to null so a missing column and a
// SQL NULL hash identically. This is the exact byte string that gets hashed, so
// it must not depend on key insertion order.
export function canonicalize(value) {
  if (value === undefined || value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

// The canonical string a row contributes to the chain: only the chained fields,
// in a fixed order, so the hash is reproducible across processes and languages.
export function canonicalRow(row = {}) {
  const picked = {};
  for (const field of AUDIT_CHAIN_FIELDS) {
    let v = row[field];
    if (v === undefined) v = null;
    // A bigint (seq) comes back from pg as a string but is inserted as a
    // number; normalise so the hash is stable across the round trip.
    if (field === 'seq' && v !== null) v = String(v);
    picked[field] = v;
  }
  return canonicalize(picked);
}

export function computeRowHash(prevHash, row) {
  const material = String(prevHash == null ? '' : prevHash) + '|' + canonicalRow(row);
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

// The shipped chain policy. Deterministic so two calls compare equal.
export function defaultAuditChainConfig() {
  return {
    version: AUDIT_CHAIN_VERSION,
    revision: AUDIT_CHAIN_DEFAULT_REVISION,
    source: 'default',
    owner: AUDIT_CHAIN_OWNER,
    // The BRD requires a tamper-evident log, so chaining ships on.
    enabled: true,
    algorithm: AUDIT_CHAIN_ALGORITHM,
    genesis: AUDIT_CHAIN_GENESIS,
    updated_by: null,
    updated_at: null,
  };
}

function normConfig(raw, base = defaultAuditChainConfig()) {
  return {
    version: base.version,
    revision: Number.isInteger(raw.revision) ? raw.revision : base.revision,
    source: raw.source || base.source,
    owner: raw.owner !== undefined && String(raw.owner).trim() !== '' ? String(raw.owner).trim() : base.owner,
    enabled: raw.enabled === undefined ? base.enabled : Boolean(raw.enabled),
    algorithm: String(raw.algorithm || base.algorithm).trim().toLowerCase() === 'sha256' ? 'sha256' : base.algorithm,
    genesis: raw.genesis !== undefined && String(raw.genesis).trim() !== '' ? String(raw.genesis) : base.genesis,
    updated_by: raw.updated_by ?? base.updated_by,
    updated_at: raw.updated_at ?? base.updated_at,
  };
}

export function validateAuditChainConfig(config = {}) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  config = coerce(config);
  if (!isPlainObject(config)) {
    push('config', AUDIT_CHAIN_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  if (config.algorithm !== undefined && String(config.algorithm).trim().toLowerCase() !== 'sha256') {
    push('algorithm', AUDIT_CHAIN_MESSAGES.unsupported_algorithm);
  }
  return { ok: errors.length === 0, errors };
}

export function resolveAuditChainConfig(config = null) {
  const base = defaultAuditChainConfig();
  config = coerce(config);
  if (!isPlainObject(config)) return base;
  return { ...normConfig(config, base), version: config.version || base.version, source: config.source || 'stored' };
}

export function diffAuditChainConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveAuditChainConfig(before);
  const a = resolveAuditChainConfig(after);
  for (const field of ['enabled', 'algorithm', 'owner', 'genesis']) {
    if (b[field] !== a[field]) changes.push({ field, before: b[field], after: a[field] });
  }
  return changes;
}

export function buildAuditChainConfig(body = {}, { actor = null, base = defaultAuditChainConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveAuditChainConfig(base);
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const merged = { ...resolvedBase, ...body };
  const next = {
    ...normConfig(merged, resolvedBase),
    version: AUDIT_CHAIN_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateAuditChainConfig(next);
  if (!ok) {
    const e = new Error(AUDIT_CHAIN_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    e.data = { errors };
    throw e;
  }
  return next;
}

// Verify an ordered (ascending id) array of audit rows against the chain.
// Returns a summary naming the first broken row when the chain does not hold.
//   - rows with a null/missing hash are "unchained" (recorded while chaining was
//     off, or legacy rows written before the feature shipped); the walk rebases
//     prev_hash onto the last chained hash so a later chained row is still
//     checked against its recorded prev_hash.
export function verifyChain(rows = [], { genesis = AUDIT_CHAIN_GENESIS } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return { ok: true, checked: 0, chained: 0, unchained: 0, broken_at: null, reason: null, message: AUDIT_CHAIN_MESSAGES.verify_empty };
  }
  let prev = genesis;
  let checked = 0;
  let chained = 0;
  let unchained = 0;
  for (const row of list) {
    if (row == null || row.hash == null || row.hash === '') {
      // Unchained row (chaining off / legacy). It cannot be verified, and it
      // does not break the chain; the next chained row carries its own
      // prev_hash, which we still check below.
      unchained += 1;
      continue;
    }
    checked += 1;
    chained += 1;
    const expectedPrev = prev;
    const rowPrev = row.prev_hash == null ? genesis : row.prev_hash;
    if (rowPrev !== expectedPrev) {
      return {
        ok: false, checked, chained, unchained, broken_at: row.id ?? null,
        reason: 'prev_hash_mismatch',
        message: AUDIT_CHAIN_MESSAGES.verify_broken,
      };
    }
    const expectedHash = computeRowHash(rowPrev, row);
    if (expectedHash !== row.hash) {
      return {
        ok: false, checked, chained, unchained, broken_at: row.id ?? null,
        reason: 'hash_mismatch',
        message: AUDIT_CHAIN_MESSAGES.tamper_detected,
      };
    }
    prev = row.hash;
  }
  return {
    ok: true, checked, chained, unchained, broken_at: null, reason: null,
    message: AUDIT_CHAIN_MESSAGES.verify_ok,
  };
}

export default {
  canonicalize, canonicalRow, computeRowHash,
  defaultAuditChainConfig, validateAuditChainConfig, resolveAuditChainConfig,
  diffAuditChainConfig, buildAuditChainConfig, verifyChain,
  AUDIT_CHAIN_CONFIG_KEY, AUDIT_CHAIN_VERSION, AUDIT_CHAIN_GENESIS, AUDIT_CHAIN_MESSAGES,
};
