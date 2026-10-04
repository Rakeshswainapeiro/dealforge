// ---------------------------------------------------------------------------
// Unit tests for the document upload policy (W5-02 / BRD DOC-02).
//
//   node --test server/tests/documentPolicy.test.js
//
// Pure module: the shipped policy, validation, resolve fallback, revision
// minting, diff, the size/type checks and the virus-scan heuristics.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_POLICY_VERSION, DOCUMENT_POLICY_CONFIG_KEY, DOCUMENT_POLICY_DEFAULT_REVISION,
  DOCUMENT_POLICY_VERSION_PREFIX,
  defaultDocumentPolicy, validateDocumentPolicy, resolveDocumentPolicy,
  diffDocumentPolicy, buildDocumentPolicy, isExtensionAllowed, maxUploadBytes,
  checkUpload, scanBufferBuiltin, scanUpload, scanBlocksUpload, DOCUMENT_POLICY_MESSAGES,
} from '../config/documentPolicy.js';
import { DOCUMENT_CORE_EXTENSIONS, DOCUMENT_SCAN_ENGINES } from '../config/documentPolicyData.js';

describe('document policy - shipped policy', () => {
  test('carries a version, a revision and the 50 MB cap', () => {
    const p = defaultDocumentPolicy();
    assert.equal(p.version, DOCUMENT_POLICY_VERSION);
    assert.equal(p.revision, DOCUMENT_POLICY_DEFAULT_REVISION);
    assert.equal(p.max_upload_mb, 50);
    assert.equal(maxUploadBytes(p), 50 * 1024 * 1024);
    assert.ok(DOCUMENT_POLICY_CONFIG_KEY);
    assert.ok(DOCUMENT_POLICY_VERSION_PREFIX);
  });

  test('accepts the four core document types', () => {
    const p = defaultDocumentPolicy();
    for (const ext of DOCUMENT_CORE_EXTENSIONS) {
      assert.ok(p.core_extensions.includes(ext), ext + ' should be core');
      assert.equal(isExtensionAllowed('report.' + ext, p), true);
    }
    assert.deepEqual(DOCUMENT_CORE_EXTENSIONS, ['pdf', 'docx', 'xlsx', 'pptx']);
  });

  test('defaults to a scan engine and a clean-scan requirement', () => {
    const p = defaultDocumentPolicy();
    assert.ok(DOCUMENT_SCAN_ENGINES.includes(p.scan_engine));
    assert.equal(p.require_clean_scan, true);
  });

  test('rejects a file whose extension is not accepted', () => {
    const p = { ...defaultDocumentPolicy(), core_extensions: ['pdf'], legacy_extensions: [] };
    assert.equal(isExtensionAllowed('payload.exe', p), false);
    assert.equal(isExtensionAllowed('payload', p), false);
  });
});

describe('document policy - validation', () => {
  const base = defaultDocumentPolicy();

  test('refuses a non-object payload', () => {
    const res = validateDocumentPolicy(null);
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(DOCUMENT_POLICY_MESSAGES.not_object));
  });

  test('refuses a non-positive size cap', () => {
    const res = validateDocumentPolicy({ max_upload_mb: 0 }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(DOCUMENT_POLICY_MESSAGES.max_upload_invalid));
  });

  test('requires at least one core type', () => {
    const res = validateDocumentPolicy({ core_extensions: [] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(DOCUMENT_POLICY_MESSAGES.core_required));
  });

  test('rejects an unknown document type and an unknown engine', () => {
    const res = validateDocumentPolicy({ core_extensions: ['pdf', 'dwg'], scan_engine: 'quantum' }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.startsWith(DOCUMENT_POLICY_MESSAGES.extension_invalid)));
    assert.ok(res.errors.some((e) => e.startsWith(DOCUMENT_POLICY_MESSAGES.engine_invalid)));
  });

  test('normalises dotted / upper-case extensions', () => {
    const res = validateDocumentPolicy({ core_extensions: ['.PDF', 'Docx'] }, { base });
    assert.equal(res.ok, true);
    assert.deepEqual(res.config.core_extensions, ['pdf', 'docx']);
  });
});

describe('document policy - resolve and mint', () => {
  test('falls back to the shipped default on blank or bad stored value', () => {
    assert.equal(resolveDocumentPolicy(null).max_upload_mb, 50);
    assert.equal(resolveDocumentPolicy('{ not json').max_upload_mb, 50);
    assert.equal(resolveDocumentPolicy('{"max_upload_mb":0}').max_upload_mb, 50);
  });

  test('returns a stored policy when valid', () => {
    const p = resolveDocumentPolicy(JSON.stringify({ max_upload_mb: 10, core_extensions: ['pdf'], legacy_extensions: [], revision: 3 }));
    assert.equal(p.max_upload_mb, 10);
    assert.deepEqual(p.core_extensions, ['pdf']);
  });

  test('build mints the next revision and a DP-01.N version', () => {
    const base = defaultDocumentPolicy();
    const next = buildDocumentPolicy({ ...base, max_upload_mb: 25 }, { base, actor: { email: 'admin@dealforge.local' } });
    assert.equal(next.revision, DOCUMENT_POLICY_DEFAULT_REVISION + 1);
    assert.equal(next.version, DOCUMENT_POLICY_VERSION_PREFIX + next.revision);
    assert.equal(next.updated_by, 'admin@dealforge.local');
  });

  test('build throws a 400 on an invalid payload', () => {
    assert.throws(() => buildDocumentPolicy({ max_upload_mb: -1 }), (e) => e.status === 400);
  });

  test('diff names a size and an engine change', () => {
    const base = defaultDocumentPolicy();
    const changes = diffDocumentPolicy(base, { ...base, max_upload_mb: 25, scan_engine: 'external' });
    assert.ok(changes.some((c) => c.field === 'max_upload_mb' && c.value === 25));
    assert.ok(changes.some((c) => c.field === 'scan_engine' && c.value === 'external'));
  });
});

describe('document policy - upload checks', () => {
  test('flags an over-size file against the cap', () => {
    const p = defaultDocumentPolicy();
    const v = checkUpload({ filename: 'big.pdf', size: 60 * 1024 * 1024 }, p);
    assert.ok(v.some((x) => x.code === 'too_large'));
  });

  test('flags an unaccepted type', () => {
    const p = { ...defaultDocumentPolicy(), core_extensions: ['pdf'], legacy_extensions: [] };
    const v = checkUpload({ filename: 'x.exe', size: 10 }, p);
    assert.ok(v.some((x) => x.code === 'type_not_allowed'));
  });

  test('passes a core type within the cap', () => {
    const v = checkUpload({ filename: 'model.xlsx', size: 1024 }, defaultDocumentPolicy());
    assert.equal(v.length, 0);
  });
});

describe('document policy - virus scan', () => {
  test('marks a benign buffer clean', () => {
    const res = scanBufferBuiltin(Buffer.from('%PDF-1.4 a normal report'));
    assert.equal(res.verdict, 'clean');
    assert.equal(res.signatures.length, 0);
  });

  test('detects the EICAR test signature as infected', () => {
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const res = scanBufferBuiltin(Buffer.from(eicar));
    assert.equal(res.verdict, 'infected');
    assert.ok(res.signatures.some((s) => s.id === 'eicar_test'));
  });

  test('detects an embedded executable by magic bytes', () => {
    const res = scanBufferBuiltin(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));
    assert.equal(res.verdict, 'infected');
    assert.ok(res.signatures.some((s) => s.id === 'embedded_executable'));
  });

  test('flags a double-extension name as suspicious', () => {
    const res = scanBufferBuiltin(Buffer.from('%PDF-1.4 ok'), { filename: 'invoice.pdf.exe' });
    assert.equal(res.verdict, 'suspicious');
  });

  test('blocks an infected scan and honours block_suspicious', () => {
    const p = defaultDocumentPolicy();
    assert.equal(scanBlocksUpload({ verdict: 'infected' }, p), true);
    assert.equal(scanBlocksUpload({ verdict: 'clean' }, p), false);
    assert.equal(scanBlocksUpload({ verdict: 'suspicious' }, p), false);
    assert.equal(scanBlocksUpload({ verdict: 'suspicious' }, { ...p, block_suspicious: true }), true);
  });

  test('scanUpload runs the builtin engine by default', async () => {
    const res = await scanUpload(Buffer.from('hello'), defaultDocumentPolicy());
    assert.equal(res.engine, 'builtin');
    assert.equal(res.verdict, 'clean');
  });
});
