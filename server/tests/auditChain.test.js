// Hash-chained, tamper-evident audit (W6-05 / BRD AUD-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalize, canonicalRow, computeRowHash, verifyChain,
  defaultAuditChainConfig, validateAuditChainConfig, resolveAuditChainConfig,
  diffAuditChainConfig, buildAuditChainConfig,
  AUDIT_CHAIN_GENESIS, AUDIT_CHAIN_MESSAGES,
} from '../config/auditChain.js';

function row(seq, fields = {}) {
  return {
    seq, id: seq, entity: 'DealOpportunity', entity_id: 'opp-' + seq, action: 'gate1_submitted',
    actor_id: 'user-deal-lead', actor_email: 'deal.lead@infinia.local', org_id: 'org-infinia',
    role: 'subsidiary_deal_lead', before: null, after: { score: 42 }, comment: null,
    ts: '2026-01-0' + seq + 'T00:00:00.000Z', ...fields,
  };
}

// Build a valid chain from a list of raw rows (no hashes yet).
function chain(rows, genesis = AUDIT_CHAIN_GENESIS) {
  let prev = genesis;
  return rows.map((r) => {
    const hash = computeRowHash(prev, r);
    const chained = { ...r, prev_hash: prev, hash };
    prev = hash;
    return chained;
  });
}

test('canonicalize is deterministic regardless of key order', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.equal(canonicalize({ a: 2, b: 1 }), '{"a":2,"b":1}');
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize(undefined), 'null');
  assert.equal(canonicalize([1, 'x', null]), '[1,"x",null]');
  assert.equal(canonicalize(new Date('2026-01-01T00:00:00.000Z')), '"2026-01-01T00:00:00.000Z"');
});

test('canonicalRow only includes the chained fields and normalises seq', () => {
  const r = row(1, { hash: 'ignored', prev_hash: 'ignored', ssn: 'ignored' });
  const canon = canonicalRow(r);
  assert.ok(!canon.includes('ignored'));
  assert.ok(canon.includes('"seq":"1"'));
});

test('computeRowHash changes with any field and with the previous hash', () => {
  const a = computeRowHash('prev', row(1));
  assert.equal(a.length, 64);
  assert.notEqual(a, computeRowHash('prev2', row(1)));
  assert.notEqual(a, computeRowHash('prev', row(1, { action: 'gate1_approved' })));
  assert.notEqual(a, computeRowHash('prev', row(1, { after: { score: 43 } })));
});

test('a valid chain verifies from genesis', () => {
  const rows = chain([row(1), row(2), row(3)]);
  const result = verifyChain(rows);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 3);
  assert.equal(result.broken_at, null);
});

test('tampering with a chained row is detected at that row', () => {
  const rows = chain([row(1), row(2), row(3)]);
  rows[1].after = { score: 99 };
  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.broken_at, 2);
  assert.equal(result.reason, 'hash_mismatch');
  assert.equal(result.message, AUDIT_CHAIN_MESSAGES.tamper_detected);
});

test('removing a middle row breaks the chain at the next row', () => {
  const rows = chain([row(1), row(2), row(3)]);
  const spliced = [rows[0], rows[2]];
  const result = verifyChain(spliced);
  assert.equal(result.ok, false);
  assert.equal(result.broken_at, 3);
  assert.equal(result.reason, 'prev_hash_mismatch');
});

test('reordering rows breaks the chain', () => {
  const rows = chain([row(1), row(2), row(3)]);
  const result = verifyChain([rows[1], rows[0], rows[2]]);
  assert.equal(result.ok, false);
});

test('unchained (legacy) rows are skipped without breaking verification', () => {
  const legacy = { seq: null, id: 1, entity: 'X', action: 'y', hash: null, prev_hash: null };
  const rows = [legacy, ...chain([row(2), row(3)])];
  const result = verifyChain(rows);
  assert.equal(result.ok, true);
  assert.equal(result.chained, 2);
  assert.equal(result.unchained, 1);
});

test('an empty log verifies trivially', () => {
  const result = verifyChain([]);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.equal(result.message, AUDIT_CHAIN_MESSAGES.verify_empty);
});

test('the shipped policy chains on with sha256 and the published genesis', () => {
  const cfg = defaultAuditChainConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.algorithm, 'sha256');
  assert.equal(cfg.genesis, AUDIT_CHAIN_GENESIS);
});

test('validation rejects an unsupported algorithm only', () => {
  assert.equal(validateAuditChainConfig({ enabled: true }).ok, true);
  const bad = validateAuditChainConfig({ algorithm: 'md5' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.field === 'algorithm'));
});

test('build mints a revision, and the diff reports what changed', () => {
  const base = defaultAuditChainConfig();
  const next = buildAuditChainConfig({ enabled: false }, { actor: { email: 'admin@dealforge.local' }, base });
  assert.equal(next.version, 'AUDC-01.2');
  assert.equal(next.revision, 2);
  assert.equal(next.source, 'stored');
  assert.equal(next.enabled, false);
  assert.equal(next.updated_by, 'admin@dealforge.local');
  const changes = diffAuditChainConfig(base, next);
  assert.ok(changes.some((c) => c.field === 'enabled' && c.before === true && c.after === false));
});

test('a stored config resolves back to a stable shape', () => {
  const resolved = resolveAuditChainConfig(JSON.stringify({ enabled: true, algorithm: 'sha256', revision: 4, source: 'stored' }));
  assert.equal(resolved.revision, 4);
  assert.equal(resolved.source, 'stored');
  assert.equal(resolved.genesis, AUDIT_CHAIN_GENESIS);
});
