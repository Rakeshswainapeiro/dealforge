# W6-05 - Hash-chained, tamper-evident audit (BRD AUD-01)

**Acceptance:** "Log verifiable; tamper detected; 100% gate actions logged"

## What this delivers

Two independent guarantees now protect the audit trail:

1. **Append-only.** The audit_event table already refuses UPDATE/DELETE through
   the audit_event_no_update trigger, so a row can never be rewritten in place.
2. **Tamper-evident hash chain.** Every audit row stores prev_hash (the hash of
   the row before it) and its own hash:

       hash(row) = sha256( prev_hash || canonical(row fields) )

   canonical() is a deterministic JSON serialisation with sorted keys and a
   normalised seq, so the hash is reproducible across processes. The first row
   anchors on the published constant DEALFORGE-AUDIT-GENESIS-V1.

Editing, reordering or deleting any historic row changes its hash (and every
downstream prev_hash), so recomputing the chain names the first broken row.

## Where it lives

- server/config/auditChainData.js - vocabulary: config key, algorithm, genesis
  constant, chained fields, messages.
- server/config/auditChain.js - pure functions: canonicalize, canonicalRow,
  computeRowHash, verifyChain, plus the config resolve/validate/build/diff
  helpers.
- server/audit.js - writeAudit() computes and stores the chain columns inside a
  transaction guarded by pg_advisory_xact_lock, so two concurrent writers cannot
  fork the chain; verifyAuditChain() walks the whole chain from genesis and
  reports { ok, checked, unchained, broken_at, reason }.
- server/auditChain.js - the HTTP surface, mounted at /api/audit-chain.
- server/db.js - AUDIT_CHAIN_SCHEMA adds seq, prev_hash and hash with IF NOT
  EXISTS plus a partial unique index on seq.
- src/pages/Settings.jsx - the **Audit Integrity** tab; src/api/client.js
  exposes api.auditChain.

## Policy and enforcement

The chain policy (on/off, algorithm, owner, genesis) lives in AppSettings under
setting_key = 'audit_chain_config', so Internal Audit can retune it without a
deploy. Reads fall back to the shipped default. Chaining ships **on**; if it is
switched off, rows stay append-only but carry no chain hash.

POST /api/audit-chain/verify is administrator-only (canConfigure) and the run is
itself written to the audit trail, so verification is accountable.

## Evidence

- admin_audit_chain_policy_admin.png - the Audit Integrity tab: chaining on,
  sha256, the genesis constant, and the verify action.
- admin_audit_chain_verified_intact.png - running **Verify chain** recomputes the
  log server-side and reports it intact ("Chain intact - 2 rows verified").

## Tests

- server/tests/auditChain.test.js - 13 pure-function cases (determinism, tamper
  detection, row removal, reorder, legacy/unchained rows, config).
- server/tests/m6.test.js - 6 integration cases (policy read, 403 for a
  non-admin, verify intact + audited, contiguous chain under concurrency,
  revision mint + history, cache invalidation).
