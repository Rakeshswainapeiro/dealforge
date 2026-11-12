// ---------------------------------------------------------------------------
// Authenticated encryption for secrets the server must keep at rest (for
// example the rotated Atlas access / refresh tokens).
//
// AES-256-GCM with a random 96-bit IV per value. The key is resolved at call
// time from, in order:
//   1. TOKEN_ENCRYPTION_KEY - 64 hex chars or base64 of 32 bytes is used as is;
//      any other string is stretched with HKDF-SHA256.
//   2. BETTER_AUTH_SECRET   - stretched with HKDF-SHA256 under a purpose label,
//      so the derived key is never the session secret itself.
// With neither set there is no key, and callers must not persist the secret.
// TOKEN_ENCRYPTION_KEY_PREVIOUS (comma-separated) lists retired keys that may
// still open older values, so the key can be rotated without losing state.
//
// A sealed value is "v1.<iv>.<tag>.<ciphertext>" (base64url parts). The
// purpose label is bound in as additional authenticated data, so a value
// sealed for one purpose does not open for another.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

const VERSION = 'v1';
const HKDF_SALT = 'dealforge-secret-box';

function rawKey(material) {
  const s = String(material).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32 && b.toString('base64').replace(/=+$/, '') === s.replace(/=+$/, '')) return b;
  } catch { /* not base64 */ }
  return null;
}

/** The 32-byte key for a purpose, or null when no key material is configured. */
export function resolveKey(purpose, env = process.env) {
  const explicit = env.TOKEN_ENCRYPTION_KEY && String(env.TOKEN_ENCRYPTION_KEY).trim();
  const material = explicit || (env.BETTER_AUTH_SECRET && String(env.BETTER_AUTH_SECRET).trim());
  if (!material) return null;
  if (explicit) {
    const raw = rawKey(explicit);
    if (raw) return raw;
  }
  return Buffer.from(crypto.hkdfSync('sha256', material, HKDF_SALT, 'dealforge:' + purpose, 32));
}

// Retired keys that may still open older values (comma-separated
// TOKEN_ENCRYPTION_KEY_PREVIOUS), so a key can be rotated without losing state.
function previousKeys(purpose, env = process.env) {
  return String(env.TOKEN_ENCRYPTION_KEY_PREVIOUS || '')
    .split(',').map((k) => k.trim()).filter(Boolean)
    .map((material) => rawKey(material) || Buffer.from(crypto.hkdfSync('sha256', material, HKDF_SALT, 'dealforge:' + purpose, 32)));
}

export function hasKey(purpose, env = process.env) {
  return resolveKey(purpose, env) !== null;
}

const b64 = (buf) => buf.toString('base64url');

/** Seal a JSON-serialisable value. Throws when no key is configured. */
export function sealJson(value, purpose, env = process.env) {
  const key = resolveKey(purpose, env);
  if (!key) throw new Error('No encryption key is configured (set TOKEN_ENCRYPTION_KEY or BETTER_AUTH_SECRET)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose, 'utf8'));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join('.');
}

function openWith(key, parts, purpose) {
  const [, iv, tag, ct] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p, 'base64url')));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(purpose, 'utf8'));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
}

/**
 * Open a sealed value with the current key, then any previous key.
 * Returns { value, rotated } (rotated = opened with a previous key, so the caller
 * should re-seal it), or null when it is malformed, tampered with, or no key opens it.
 */
export function openSealed(sealed, purpose, env = process.env) {
  const parts = String(sealed || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const current = resolveKey(purpose, env);
  const candidates = [...(current ? [{ key: current, rotated: false }] : []), ...previousKeys(purpose, env).map((key) => ({ key, rotated: true }))];
  for (const c of candidates) {
    try { return { value: openWith(c.key, parts, purpose), rotated: c.rotated }; } catch { /* try the next key */ }
  }
  return null;
}

/** Open a sealed value. Returns null when it is malformed, tampered with, or no configured key opens it. */
export function openJson(sealed, purpose, env = process.env) {
  return openSealed(sealed, purpose, env)?.value ?? null;
}

export default { resolveKey, hasKey, sealJson, openJson, openSealed };
