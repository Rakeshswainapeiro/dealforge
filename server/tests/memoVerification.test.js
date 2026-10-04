// Pure-function tests for memo QR verification (W7-05 / BRD OUT-03).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSiriusMemo } from '../config/siriusMemo.js';
import {
  VERIFY_RESULTS,
  VERIFY_PAGE_PATH,
  FINGERPRINT_FIELDS,
  memoFingerprint,
  fingerprintPayload,
  signVerification,
  verifySignature,
  issueVerification,
  verifyToken,
  tokenFromQuery,
} from '../config/memoVerification.js';

const SECRET = 'test-secret';

function sampleMemo(overrides = {}) {
  return buildSiriusMemo({
    opportunity: {
      data: {
        opportunity_name: overrides.name || 'Test Opportunity',
        total_commitment_aed: overrides.commitment ?? 120,
        ask_aed: 40,
        narrative_what: 'A bolt-on acquisition of a regional logistics platform.',
      },
    },
    org: { name: 'Infinia Technologies Limited' },
  });
}

describe('memo verification vocabulary (W7-05)', () => {
  test('the verify page and fingerprint fields are declared', () => {
    assert.equal(VERIFY_PAGE_PATH, '/verify');
    assert.deepEqual(FINGERPRINT_FIELDS.map((f) => f.key), ['subsidiary', 'opportunity_name', 'pages']);
    assert.equal(VERIFY_RESULTS.ok.valid, true);
    assert.equal(VERIFY_RESULTS.record_changed.valid, false);
  });
});

describe('memo fingerprint (W7-05)', () => {
  test('the fingerprint is stable across regenerations of the same record', () => {
    const a = memoFingerprint(sampleMemo());
    const b = memoFingerprint(sampleMemo());
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  test('the generated_at stamp does not affect the fingerprint', () => {
    const memo = sampleMemo();
    const before = memoFingerprint(memo);
    memo.generated_at = '2099-01-01T00:00:00.000Z';
    assert.equal(memoFingerprint(memo), before);
  });

  test('a changed value inside a page changes the fingerprint', () => {
    const before = memoFingerprint(sampleMemo({ commitment: 120 }));
    const after = memoFingerprint(sampleMemo({ commitment: 121 }));
    assert.notEqual(before, after);
  });

  test('fingerprintPayload excludes volatile stamps and keeps the six pages', () => {
    const payload = fingerprintPayload(sampleMemo());
    assert.equal(payload.opportunity_name, 'Test Opportunity');
    assert.equal(payload.pages.length, 6);
    assert.equal(payload.pages[0].key, 'executive_summary');
  });
});

describe('verification signature (W7-05)', () => {
  test('a signature round-trips over the same fields', () => {
    const args = { id: 'opp-1', version: 'v-abc', hash: 'deadbeef', issuedAt: '2026-01-01T00:00:00.000Z', secret: SECRET };
    const sig = signVerification(args);
    assert.equal(sig.length, 32);
    assert.equal(verifySignature({ ...args, signature: sig }), true);
  });

  test('a different secret fails the signature', () => {
    const sig = signVerification({ id: 'opp-1', version: 'v', hash: 'h', issuedAt: 't', secret: SECRET });
    assert.equal(verifySignature({ id: 'opp-1', version: 'v', hash: 'h', issuedAt: 't', signature: sig, secret: 'other' }), false);
  });

  test('a tampered hash fails the signature', () => {
    const sig = signVerification({ id: 'opp-1', version: 'v', hash: 'good', issuedAt: 't', secret: SECRET });
    assert.equal(verifySignature({ id: 'opp-1', version: 'v', hash: 'evil', issuedAt: 't', signature: sig, secret: SECRET }), false);
  });
});

describe('issue and verify tokens (W7-05)', () => {
  test('an issued token verifies against the live memo', () => {
    const memo = sampleMemo();
    const hash = memoFingerprint(memo);
    const issued = issueVerification({ opportunityId: 'opp-1', version: 'v-1', hash, issuedAt: '2026-01-01T00:00:00.000Z', baseUrl: 'http://localhost:34000', secret: SECRET });
    assert.ok(issued.url.startsWith('http://localhost:34000/verify?'));
    assert.ok(issued.url.includes(encodeURIComponent(hash)));
    const token = tokenFromQuery(issued.url.split('?')[1]);
    const outcome = verifyToken({ token, memo, secret: SECRET });
    assert.equal(outcome.valid, true);
    assert.equal(outcome.result, VERIFY_RESULTS.ok);
    assert.equal(outcome.version, 'v-1');
  });

  test('a record changed after issue fails verification', () => {
    const issued = issueVerification({ opportunityId: 'opp-2', version: 'v-1', hash: memoFingerprint(sampleMemo({ commitment: 120 })), baseUrl: 'http://x', secret: SECRET });
    const token = tokenFromQuery(issued.url.split('?')[1]);
    // The live record now fingerprints differently, so the scanned hash no longer matches.
    const outcome = verifyToken({ token, memo: sampleMemo({ commitment: 999 }), secret: SECRET });
    assert.equal(outcome.valid, false);
    assert.equal(outcome.result, VERIFY_RESULTS.record_changed);
    assert.notEqual(outcome.issued_hash, outcome.current_hash);
  });

  test('a forged signature fails verification', () => {
    const memo = sampleMemo();
    const issued = issueVerification({ opportunityId: 'opp-3', version: 'v-1', hash: memoFingerprint(memo), baseUrl: 'http://x', secret: SECRET });
    const token = tokenFromQuery(issued.url.split('?')[1]);
    token.signature = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const outcome = verifyToken({ token, memo, secret: SECRET });
    assert.equal(outcome.valid, false);
    assert.equal(outcome.result, VERIFY_RESULTS.signature_invalid);
  });

  test('an unknown record reports not-found', () => {
    const memo = sampleMemo();
    const issued = issueVerification({ opportunityId: 'opp-4', version: 'v-1', hash: memoFingerprint(memo), baseUrl: 'http://x', secret: SECRET });
    const token = tokenFromQuery(issued.url.split('?')[1]);
    const outcome = verifyToken({ token, memo: null, secret: SECRET });
    assert.equal(outcome.valid, false);
    assert.equal(outcome.result, VERIFY_RESULTS.unknown_record);
  });
});
