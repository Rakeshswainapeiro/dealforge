// ---------------------------------------------------------------------------
// Document upload policy (W5-02 / BRD DOC-02).
//
// The pure module behind the size cap, the accepted-type allow-list and the
// upload virus scan: the shipped default policy, the validation, the resolve
// fallback, the diff, the revision builder and the scanner. Storage and HTTP
// routes live in server/documentPolicy.js.
//
// The scanner is deliberately dependency-free. The 'builtin' engine runs
// signature heuristics (the EICAR test string and embedded executables); the
// 'external' engine shells out to the operator-configured command. A scan never
// reads past the policy's own file, and every verdict is recorded on the upload
// so a reviewer can see that a document was scanned, by what and when.
// ---------------------------------------------------------------------------

import {
  DOCUMENT_POLICY_VERSION, DOCUMENT_POLICY_CONFIG_KEY,
  DOCUMENT_POLICY_DEFAULT_REVISION, DOCUMENT_POLICY_VERSION_PREFIX,
  DOCUMENT_CORE_EXTENSIONS, DOCUMENT_LEGACY_EXTENSIONS, DOCUMENT_SCAN_ENGINES,
  DOCUMENT_SCAN_VERDICTS, DOCUMENT_POLICY_DEFAULT, DOCUMENT_POLICY_DISCLAIMER,
} from './documentPolicyData.js';

export {
  DOCUMENT_POLICY_VERSION, DOCUMENT_POLICY_CONFIG_KEY,
  DOCUMENT_POLICY_DEFAULT_REVISION, DOCUMENT_POLICY_VERSION_PREFIX,
  DOCUMENT_CORE_EXTENSIONS, DOCUMENT_LEGACY_EXTENSIONS, DOCUMENT_SCAN_ENGINES,
  DOCUMENT_SCAN_VERDICTS, DOCUMENT_POLICY_DISCLAIMER,
};

export const DOCUMENT_POLICY_MESSAGES = {
  not_object: 'The document policy payload must be an object.',
  max_upload_invalid: 'max_upload_mb must be a positive number.',
  core_required: 'At least one core document type is required.',
  extension_invalid: 'Unknown document type: ',
  engine_invalid: 'Unknown scan engine: ',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// All extension names the app knows about, whether core or legacy.
export const KNOWN_EXTENSIONS = new Set([...DOCUMENT_CORE_EXTENSIONS, ...DOCUMENT_LEGACY_EXTENSIONS]);

// Normalise an extension token: strip the leading dot, lower-case.
export function normalizeExtension(v) {
  return String(v || '').trim().toLowerCase().replace(/^\.+/, '');
}

function toExtArray(v) {
  const list = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,\n]/) : []);
  return list.map(normalizeExtension).filter(Boolean);
}

export function defaultDocumentPolicy() {
  return {
    version: DOCUMENT_POLICY_VERSION,
    revision: DOCUMENT_POLICY_DEFAULT_REVISION,
    max_upload_mb: DOCUMENT_POLICY_DEFAULT.max_upload_mb,
    core_extensions: [...DOCUMENT_POLICY_DEFAULT.core_extensions],
    legacy_extensions: [...DOCUMENT_POLICY_DEFAULT.legacy_extensions],
    scan_engine: DOCUMENT_POLICY_DEFAULT.scan_engine,
    require_clean_scan: DOCUMENT_POLICY_DEFAULT.require_clean_scan,
    block_suspicious: DOCUMENT_POLICY_DEFAULT.block_suspicious,
    disclaimer: DOCUMENT_POLICY_DISCLAIMER,
  };
}

export function validateDocumentPolicy(input, { base = null } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: [DOCUMENT_POLICY_MESSAGES.not_object], config: base || defaultDocumentPolicy() };
  }
  const maxMb = input.max_upload_mb != null ? Number(input.max_upload_mb) : DOCUMENT_POLICY_DEFAULT.max_upload_mb;
  if (!Number.isFinite(maxMb) || maxMb <= 0) errors.push(DOCUMENT_POLICY_MESSAGES.max_upload_invalid);
  const core = input.core_extensions != null ? toExtArray(input.core_extensions) : [...DOCUMENT_POLICY_DEFAULT.core_extensions];
  if (core.length === 0) errors.push(DOCUMENT_POLICY_MESSAGES.core_required);
  for (const ext of [...core, ...toExtArray(input.legacy_extensions)]) {
    if (!KNOWN_EXTENSIONS.has(ext)) errors.push(DOCUMENT_POLICY_MESSAGES.extension_invalid + ext);
  }
  const engine = blank(input.scan_engine) ? DOCUMENT_POLICY_DEFAULT.scan_engine : String(input.scan_engine).trim().toLowerCase();
  if (!DOCUMENT_SCAN_ENGINES.includes(engine)) errors.push(DOCUMENT_POLICY_MESSAGES.engine_invalid + input.scan_engine);
  const config = {
    version: base?.version || DOCUMENT_POLICY_VERSION,
    revision: base?.revision ?? DOCUMENT_POLICY_DEFAULT_REVISION,
    max_upload_mb: Number.isFinite(maxMb) ? maxMb : DOCUMENT_POLICY_DEFAULT.max_upload_mb,
    core_extensions: core,
    legacy_extensions: toExtArray(input.legacy_extensions),
    scan_engine: DOCUMENT_SCAN_ENGINES.includes(engine) ? engine : DOCUMENT_POLICY_DEFAULT.scan_engine,
    require_clean_scan: input.require_clean_scan !== undefined ? input.require_clean_scan === true : DOCUMENT_POLICY_DEFAULT.require_clean_scan,
    block_suspicious: input.block_suspicious === true,
    disclaimer: blank(input.disclaimer) ? (base?.disclaimer || DOCUMENT_POLICY_DISCLAIMER) : String(input.disclaimer).trim(),
  };
  return { ok: errors.length === 0, errors, config };
}

export function resolveDocumentPolicy(stored) {
  if (blank(stored)) return defaultDocumentPolicy();
  let parsed = stored;
  if (typeof stored === 'string') {
    try { parsed = JSON.parse(stored); } catch { return defaultDocumentPolicy(); }
  }
  const res = validateDocumentPolicy(parsed, { base: parsed });
  return res.ok ? res.config : defaultDocumentPolicy();
}

export function diffDocumentPolicy(base, next) {
  const changes = [];
  for (const field of ['max_upload_mb', 'scan_engine', 'require_clean_scan', 'block_suspicious']) {
    if (base?.[field] !== next?.[field]) changes.push({ field, op: 'set', value: next?.[field], from: base?.[field] });
  }
  for (const field of ['core_extensions', 'legacy_extensions']) {
    const before = (base?.[field] || []).join(',');
    const after = (next?.[field] || []).join(',');
    if (before !== after) changes.push({ field, op: 'set', value: next?.[field] });
  }
  return changes;
}

export function buildDocumentPolicy(body, { actor = null, at = null, base = null } = {}) {
  const current = base || defaultDocumentPolicy();
  const res = validateDocumentPolicy(body, { base: current });
  if (!res.ok) {
    const e = new Error('Invalid document policy: ' + res.errors.join(' '));
    e.status = 400;
    e.errors = res.errors;
    throw e;
  }
  const revision = (current.revision || DOCUMENT_POLICY_DEFAULT_REVISION) + 1;
  return {
    ...res.config,
    revision,
    version: DOCUMENT_POLICY_VERSION_PREFIX + revision,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
}

// --- policy checks ---------------------------------------------------------
// Is a file's extension accepted by the effective policy?
export function isExtensionAllowed(filename, policy) {
  const p = policy || defaultDocumentPolicy();
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = normalizeExtension(name.slice(dot + 1));
  return p.core_extensions.includes(ext) || p.legacy_extensions.includes(ext);
}

export function maxUploadBytes(policy) {
  const p = policy || defaultDocumentPolicy();
  return Math.round(Number(p.max_upload_mb) * 1024 * 1024);
}

// Check a file against the size cap and the type allow-list. Returns a list of
// violations (empty when the file passes).
export function checkUpload({ filename, size } = {}, policy) {
  const p = policy || defaultDocumentPolicy();
  const violations = [];
  if (size != null && Number(size) > maxUploadBytes(p)) {
    violations.push({ code: 'too_large', limit_mb: p.max_upload_mb, size: Number(size) });
  }
  if (!isExtensionAllowed(filename, p)) {
    violations.push({ code: 'type_not_allowed', filename, allowed: [...p.core_extensions, ...p.legacy_extensions] });
  }
  return violations;
}

// --- virus scan ------------------------------------------------------------
// The EICAR anti-virus test signature, split so this source file never itself
// trips a scanner.
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS', '-TEST-FILE!$H+H*'].join('');

// Executable / script magic bytes that should never appear in a deal document.
const EXECUTABLE_MAGIC = [
  { mime: 'application/x-msdownload', bytes: [0x4d, 0x5a] },        // MZ (Windows PE)
  { mime: 'application/x-elf', bytes: [0x7f, 0x45, 0x4c, 0x46] },    // ELF
  { mime: 'application/x-mach-binary', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { mime: 'application/x-mach-binary', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
];

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (buffer[i] !== bytes[i]) return false;
  return true;
}

/**
 * Scan a buffer with the dependency-free builtin heuristics. Returns a verdict
 * of 'clean', 'suspicious' or 'infected' plus the signatures that tripped.
 */
export function scanBufferBuiltin(buffer, { filename = '' } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const signatures = [];
  const text = buf.toString('latin1');
  if (text.includes(EICAR)) signatures.push({ id: 'eicar_test', label: 'EICAR antivirus test signature' });
  for (const sig of EXECUTABLE_MAGIC) {
    if (startsWith(buf, sig.bytes)) signatures.push({ id: 'embedded_executable', label: 'Embedded executable (' + sig.mime + ')' });
  }
  // A double-extension masquerading as a document (e.g. invoice.pdf.exe) is a
  // strong signal even when the body itself is benign.
  const name = String(filename || '').toLowerCase();
  const dangerous = '(?:exe|dll|bat|cmd|sh|js|vbs|scr|jar|ps1)';
  const documentExt = '(?:pdf|docx?|xlsx?|pptx?)';
  const doubleExt = new RegExp('\\.' + dangerous + '\\.' + documentExt + '$' + '|\\.' + documentExt + '\\.' + dangerous + '$');
  if (doubleExt.test(name)) {
    signatures.push({ id: 'double_extension', label: 'Double extension: ' + filename });
  }
  const infected = signatures.some((s) => s.id === 'eicar_test' || s.id === 'embedded_executable');
  const verdict = infected ? 'infected' : (signatures.length ? 'suspicious' : 'clean');
  return { verdict, engine: 'builtin', signatures };
}

/**
 * Scan a buffer with the external engine by piping it to the operator command
 * on stdin. The command signals a hit with a non-zero exit code; a clean file
 * exits zero. A missing or failing command is reported as an engine error rather
 * than a hit, so the caller decides whether to block.
 */
export async function scanBufferExternal(buffer, { command, timeoutMs = 15000 } = {}) {
  if (!command) return { verdict: 'error', engine: 'external', error: 'No external scan command configured' };
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    let child;
    try {
      child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ verdict: 'error', engine: 'external', error: err.message });
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish({ verdict: 'error', engine: 'external', error: 'scan timed out' }); }, timeoutMs);
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); finish({ verdict: 'error', engine: 'external', error: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return finish({ verdict: 'clean', engine: 'external', detail: out.trim() || null });
      if (code === 1) return finish({ verdict: 'infected', engine: 'external', signatures: [{ id: 'external_hit', label: out.trim() || 'External engine reported a hit' }] });
      return finish({ verdict: 'error', engine: 'external', error: out.trim() || ('exit ' + code) });
    });
    try { child.stdin.end(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')); } catch { /* ignore */ }
  });
}

/**
 * Scan a buffer with the engine named by the policy. Returns
 * { verdict, engine, signatures, error? }.
 */
export async function scanUpload(buffer, policy, { filename = '', command = process.env.DOCUMENT_SCAN_COMMAND } = {}) {
  const p = policy || defaultDocumentPolicy();
  const engine = DOCUMENT_SCAN_ENGINES.includes(p.scan_engine) ? p.scan_engine : 'builtin';
  if (engine === 'external') {
    return scanBufferExternal(buffer, { command });
  }
  return scanBufferBuiltin(buffer, { filename });
}

// Does a scan result block the upload under the effective policy?
export function scanBlocksUpload(scan, policy) {
  const p = policy || defaultDocumentPolicy();
  if (!scan) return false;
  if (scan.verdict === 'infected') return true;
  if (scan.verdict === 'suspicious') return p.block_suspicious === true;
  if (scan.verdict === 'error') return p.require_clean_scan === true && p.scan_engine === 'external';
  return false;
}

export default {
  DOCUMENT_POLICY_VERSION, DOCUMENT_POLICY_CONFIG_KEY, DOCUMENT_POLICY_DEFAULT_REVISION,
  DOCUMENT_POLICY_VERSION_PREFIX, DOCUMENT_POLICY_MESSAGES, KNOWN_EXTENSIONS,
  defaultDocumentPolicy, validateDocumentPolicy, resolveDocumentPolicy, diffDocumentPolicy,
  buildDocumentPolicy, isExtensionAllowed, maxUploadBytes, checkUpload,
  scanBufferBuiltin, scanBufferExternal, scanUpload, scanBlocksUpload,
};
