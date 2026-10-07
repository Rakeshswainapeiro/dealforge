import { pool } from './db.js';
import {
  AUDIT_CHAIN_CONFIG_KEY, AUDIT_CHAIN_GENESIS, AUDIT_CHAIN_ALGORITHM,
  computeRowHash, verifyChain,
  defaultAuditChainConfig, resolveAuditChainConfig,
} from './config/auditChain.js';

// ---------------------------------------------------------------------------
// Immutable, hash-chained audit trail (W6-05 / BRD AUD-01, REQ-RBAC-04,
// REQ-FLOW-01, E2.5).
//
// Two independent guarantees protect the log:
//   1. UPDATE/DELETE on audit_event are blocked by a DB trigger, so rows are
//      append-only.
//   2. Every row stores the hash of the row before it plus a canonical hash of
//      its own fields, so the whole log can be re-verified and any alteration
//      is detectable (see config/auditChain.js for the pure math).
//
// Chaining can be switched off through configuration; when it is off, rows are
// still append-only but carry no chain hash.
// ---------------------------------------------------------------------------

// The advisory-lock key that serialises chain appends so two concurrent writes
// cannot fork the chain (both reading the same prev_hash).
const AUDIT_CHAIN_LOCK_KEY = 7210505;

// A short-lived cache of the chain policy so every audit write does not pay for
// a settings read. Invalidated on any policy write (same process) and after TTL.
const CHAIN_CACHE_MS = 10000;
let chainCache = { at: 0, config: null };

export function invalidateAuditChainCache() {
  chainCache = { at: 0, config: null };
}

export async function loadAuditChainConfig() {
  const now = Date.now();
  if (chainCache.config && now - chainCache.at < CHAIN_CACHE_MS) return chainCache.config;
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [AUDIT_CHAIN_CONFIG_KEY]
    );
    const config = rows[0]?.setting_value
      ? resolveAuditChainConfig(rows[0].setting_value)
      : defaultAuditChainConfig();
    chainCache = { at: now, config };
    return config;
  } catch {
    return defaultAuditChainConfig();
  }
}

function toJsonb(value) {
  return value != null ? JSON.stringify(value) : null;
}

/**
 * Record one immutable audit event. Never throws into the caller's flow:
 * a failed audit write must not silently swallow the business operation, but
 * it also must not crash it - the failure is logged loudly instead.
 *
 * Pass `client` (a pg client inside an open transaction) to write the event in
 * the caller's transaction, so a state change and its audit row commit or roll
 * back together. In that mode a failure is thrown, because the caller's
 * transaction must not commit a change without its audit row.
 */
export async function writeAudit({
  entity,
  entityId = null,
  action,
  actor = null,
  orgId = null,
  role = null,
  before = null,
  after = null,
  comment = null,
  client: callerClient = null,
} = {}) {
  const entityIdStr = entityId != null ? String(entityId) : null;
  const actorId = actor?.id || null;
  const actorEmail = actor?.email || null;
  const resolvedOrg = orgId || actor?.org_id || null;
  const beforeJson = toJsonb(before);
  const afterJson = toJsonb(after);

  try {
    const config = await loadAuditChainConfig();
    const db = callerClient || pool;

    if (!config.enabled) {
      const { rows } = await db.query(
        'INSERT INTO audit_event (entity, entity_id, action, actor_id, actor_email, org_id, role, before, after, comment) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, ts',
        [entity, entityIdStr, action, actorId, actorEmail, resolvedOrg, role || null, beforeJson, afterJson, comment]
      );
      return rows[0];
    }

    // Serialise chain appends in a transaction so seq and prev_hash are read and
    // written atomically; without the lock two writers could share a prev_hash.
    const client = callerClient || await pool.connect();
    try {
      if (!callerClient) await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK_KEY]);
      const { rows: seqRows } = await client.query('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM audit_event');
      const seq = Number(seqRows[0].next_seq);
      const { rows: prevRows } = await client.query(
        'SELECT hash FROM audit_event WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1'
      );
      const prevHash = prevRows[0]?.hash || config.genesis || AUDIT_CHAIN_GENESIS;
      const ts = new Date();
      const hash = computeRowHash(prevHash, {
        seq,
        entity,
        entity_id: entityIdStr,
        action,
        actor_id: actorId,
        actor_email: actorEmail,
        org_id: resolvedOrg,
        role: role || null,
        before: before != null ? before : null,
        after: after != null ? after : null,
        comment: comment != null ? comment : null,
        ts,
      });
      const { rows } = await client.query(
        'INSERT INTO audit_event ' +
        '(entity, entity_id, action, actor_id, actor_email, org_id, role, before, after, comment, seq, prev_hash, hash, ts) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, ts, seq, prev_hash, hash',
        [entity, entityIdStr, action, actorId, actorEmail, resolvedOrg, role || null, beforeJson, afterJson, comment, seq, prevHash, hash, ts]
      );
      if (!callerClient) await client.query('COMMIT');
      return rows[0];
    } catch (txErr) {
      if (!callerClient) await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      if (!callerClient) client.release();
    }
  } catch (err) {
    console.error('[audit] failed to write audit event:', err.message);
    if (callerClient) throw err;
    return null;
  }
}

export async function listAuditEvents({ entity, entityId, orgId, limit = 200, before } = {}) {
  const where = [];
  const params = [];
  if (entity) { params.push(entity); where.push('entity = $' + params.length); }
  if (entityId != null) { params.push(String(entityId)); where.push('entity_id = $' + params.length); }
  if (orgId) { params.push(orgId); where.push('org_id = $' + params.length); }
  if (before) { params.push(before); where.push('id < $' + params.length); }
  params.push(Math.min(Number(limit) || 200, 1000));
  const sql = 'SELECT * FROM audit_event ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id DESC LIMIT $' + params.length;
  const { rows } = await pool.query(sql, params);
  return rows;
}

// Chained rows in chain order (ascending seq), for verification. Unchained rows
// (chaining off, or legacy rows) carry a null hash and are excluded here; they
// are counted separately by auditChainStats().
export async function listAuditChainRows({ limit = 100000 } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM audit_event WHERE hash IS NOT NULL ORDER BY seq ASC LIMIT $1',
    [Math.min(Number(limit) || 100000, 1000000)]
  );
  return rows;
}

export async function auditChainStats() {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS total, count(hash)::int AS chained, max(seq) AS last_seq FROM audit_event'
  );
  return rows[0];
}

// Verify the whole chain from genesis. Returns { ok, checked, broken_at, reason }.
export async function verifyAuditChain() {
  const config = await loadAuditChainConfig();
  const rows = await listAuditChainRows();
  const summary = verifyChain(rows, { genesis: config.genesis || AUDIT_CHAIN_GENESIS });
  const stats = await auditChainStats();
  // checked/chained come from the verified walk (a single snapshot), so they are
  // always consistent with each other. The whole-table totals are reported
  // separately because another writer may append between the walk and the count.
  return {
    ...summary,
    algorithm: AUDIT_CHAIN_ALGORITHM,
    enabled: config.enabled,
    genesis: config.genesis || AUDIT_CHAIN_GENESIS,
    stored_total: stats.total,
    stored_chained: stats.chained,
    last_seq: stats.last_seq != null ? Number(stats.last_seq) : null,
    verified_at: new Date().toISOString(),
  };
}
