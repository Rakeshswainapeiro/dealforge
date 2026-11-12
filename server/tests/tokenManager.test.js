import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAtlasEndpoint,
  decodeJwtExpiry,
  resolveAuthToken,
  forceTokenRefresh,
  getKnownTokens,
  persistTokenState,
  loadPersistedTokenState,
  _resetTokenStateForTesting,
  _setTokenStoreForTesting,
} from '../tokenManager.js';
import { sealJson, openJson, resolveKey } from '../secretBox.js';
import { scrubSecrets } from '../config/aiGovernance.js';

// Every test runs against an in-memory store (never the database), with no real
// Atlas credentials in the environment and no real network: a test that expects a
// call installs its own fetch.
const TEST_KEY = 'a'.repeat(64);
let memory = null;
const memoryStore = { read: async () => memory, write: async (v) => { memory = v; } };
const savedFetch = globalThis.fetch;
const ENV_KEYS = ['ATLAS_REFRESH_TOKEN', 'ATLAS_EMAIL', 'ATLAS_PASSWORD', 'TOKEN_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY_PREVIOUS', 'BETTER_AUTH_SECRET'];
let savedEnv = {};

beforeEach(() => {
  memory = null;
  _setTokenStoreForTesting(memoryStore);
  _resetTokenStateForTesting();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network call in test: ${url}`); };
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  _setTokenStoreForTesting(null);
  _resetTokenStateForTesting();
});

describe('Token Manager - Endpoint & JWT parsing', () => {
  test('correctly identifies Atlas Xailon endpoints', () => {
    assert.equal(isAtlasEndpoint('https://api-atlas.xailon.ai/v1/llm'), true);
    assert.equal(isAtlasEndpoint('https://api-atlas.xailon.ai'), true);
    assert.equal(isAtlasEndpoint('https://api.openai.com/v1'), false);
    assert.equal(isAtlasEndpoint('https://api.groq.com/openai/v1'), false);
    assert.equal(isAtlasEndpoint('http://localhost:11434/v1'), false);
    assert.equal(isAtlasEndpoint(''), false);
  });

  test('decodes expiry from JWT payload accurately', () => {
    // Payload with exp: 1793686049
    const validJwt = 'header.eyJleHAiOjE3OTM2ODYwNDksInN1YiI6InVzZXItMSJ9.signature';
    assert.equal(decodeJwtExpiry(validJwt), 1793686049000);

    // Non-JWT or malformed
    assert.equal(decodeJwtExpiry('not-a-jwt'), null);
    assert.equal(decodeJwtExpiry(''), null);
    assert.equal(decodeJwtExpiry('header.badbase64.signature'), null);
  });
});

describe('Token Manager - Static Provider Passthrough (Backward Compatibility)', () => {
  beforeEach(() => {
    _resetTokenStateForTesting();
  });

  test('passes static OpenAI key straight through without network calls', async () => {
    const staticKey = 'sk-proj-test-1234567890';
    const resolved = await resolveAuthToken('https://api.openai.com/v1', staticKey);
    assert.equal(resolved, staticKey);
    assert.ok(getKnownTokens().includes(staticKey));
  });

  test('passes static Groq key straight through without network calls', async () => {
    const groqKey = 'gsk_test-groq-key-abcdef123456';
    const resolved = await resolveAuthToken('https://api.groq.com/openai/v1', groqKey);
    assert.equal(resolved, groqKey);
    assert.ok(getKnownTokens().includes(groqKey));
  });
});

describe('Token Manager - Atlas Token Caching & Expiry', () => {
  beforeEach(() => {
    _resetTokenStateForTesting();
  });

  test('uses unexpired cached token without refresh', async () => {
    const futureExpiry = Date.now() + 500_000; // 500s in future (> 60s buffer)
    _resetTokenStateForTesting({
      access_token: 'cached-atlas-token-abc',
      expires_at: futureExpiry,
    });

    const token = await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm', 'fallback');
    assert.equal(token, 'cached-atlas-token-abc');
  });

  test('adopts active JWT fallbackKey if valid', async () => {
    const futureSec = Math.floor((Date.now() + 600_000) / 1000);
    const payload = Buffer.from(JSON.stringify({ exp: futureSec })).toString('base64url');
    const validJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;

    const token = await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm', validJwt);
    assert.equal(token, validJwt);
  });

  test('invalidates token on forceTokenRefresh', async () => {
    _resetTokenStateForTesting({
      access_token: 'old-token',
      expires_at: Date.now() + 500_000,
    });

    const fresh = await forceTokenRefresh('https://api-atlas.xailon.ai/v1/llm');
    assert.equal(fresh, null); // no refresh token or login configured: nothing to refresh with
    // The cached token is dropped, so the next resolve does not return it.
    const next = await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm', '');
    assert.notEqual(next, 'old-token');
  });
});

describe('Token Manager - Mocked Refresh, Rotation & Fallback', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetTokenStateForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  test('refreshes token using refresh_token and handles rotation', async () => {
    process.env.ATLAS_REFRESH_TOKEN = 'initial-refresh-token-123456';

    const refreshedAccessToken = 'new-access-token-987654';
    const rotatedRefreshToken = 'rotated-refresh-token-555666';

    let refreshCalledWith = null;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('/v1/auth/refresh')) {
        refreshCalledWith = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            access_token: refreshedAccessToken,
            refresh_token: rotatedRefreshToken,
            expires_in: 900,
          }),
        };
      }
      throw new Error(`Unexpected fetch call to ${url}`);
    };

    const token = await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm');
    assert.equal(token, refreshedAccessToken);
    assert.equal(refreshCalledWith.refresh_token, 'initial-refresh-token-123456');

    // Token must be registered for secret scrubbing
    const known = getKnownTokens();
    assert.ok(known.includes(refreshedAccessToken));
    assert.ok(known.includes(rotatedRefreshToken));
  });

  test('falls back to login when refresh token fails', async () => {
    process.env.ATLAS_REFRESH_TOKEN = 'failing-refresh-token';
    process.env.ATLAS_EMAIL = 'admin@example.com';
    process.env.ATLAS_PASSWORD = 'super-secret-password-xyz';

    let loginCalled = false;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('/v1/auth/refresh')) {
        return { ok: false, status: 401, json: async () => ({ detail: 'invalid token' }) };
      }
      if (url.includes('/v1/auth/login')) {
        loginCalled = true;
        const body = JSON.parse(opts.body);
        assert.equal(body.email, 'admin@example.com');
        return {
          ok: true,
          json: async () => ({
            access_token: 'login-access-token-111222',
            refresh_token: 'login-refresh-token-333444',
            expires_in: 900,
          }),
        };
      }
      throw new Error(`Unexpected fetch call to ${url}`);
    };

    const token = await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm');
    assert.equal(loginCalled, true);
    assert.equal(token, 'login-access-token-111222');
  });

  test('proactively refreshes token when within 60 second buffer', async () => {
    // Current token expiring in 30 seconds (less than 60s buffer)
    _resetTokenStateForTesting({
      access_token: 'almost-expired-token',
      refresh_token: 'valid-refresh-token-abc',
      expires_at: Date.now() + 30_000,
    });

    let refreshCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes('/v1/auth/refresh')) {
        refreshCalled = true;
        return {
          ok: true,
          json: async () => ({
            access_token: 'proactively-refreshed-token',
            refresh_token: 'new-rotated-refresh-token',
            expires_in: 900,
          }),
        };
      }
      throw new Error(`Unexpected fetch call to ${url}`);
    };

    const token = await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm');
    assert.equal(refreshCalled, true);
    assert.equal(token, 'proactively-refreshed-token');
  });

  test('scrubs dynamic tokens from log and error messages', () => {
    const sensitiveAccessToken = 'super-secret-jwt-token-abcdef123456';
    const sensitiveRefreshToken = 'super-secret-refresh-xyz987654321';

    // Register them
    _resetTokenStateForTesting({
      access_token: sensitiveAccessToken,
      refresh_token: sensitiveRefreshToken,
      expires_at: Date.now() + 600_000,
    });

    const scrubbed = scrubSecrets(
      `Error calling https://api-atlas.xailon.ai: token=${sensitiveAccessToken} and refresh=${sensitiveRefreshToken}`,
      getKnownTokens()
    );

    assert.ok(!scrubbed.includes(sensitiveAccessToken), 'Access token must be scrubbed');
    assert.ok(!scrubbed.includes(sensitiveRefreshToken), 'Refresh token must be scrubbed');
    assert.ok(scrubbed.includes('[redacted-key]'));
  });
});

describe('Token Manager - Encrypted persistence', () => {
  const ACCESS = 'access-token-plain-0123456789';
  const REFRESH = 'refresh-token-plain-9876543210';

  test('persisted state is encrypted: no raw token is written', async () => {
    await persistTokenState({ access_token: ACCESS, refresh_token: REFRESH, expires_at: 123 });
    assert.ok(memory, 'something was written');
    assert.ok(!memory.includes(ACCESS) && !memory.includes(REFRESH), 'raw tokens must not appear in storage');
    const stored = JSON.parse(memory);
    assert.equal(stored.format, 'enc-v1');
    assert.equal(stored.expires_at, 123);
    assert.match(stored.sealed, /^v1\./);
  });

  test('encrypted state round-trips and restores the cache after a restart', async () => {
    const exp = Date.now() + 600_000;
    await persistTokenState({ access_token: ACCESS, refresh_token: REFRESH, expires_at: exp });
    assert.deepEqual(await loadPersistedTokenState(), { access_token: ACCESS, refresh_token: REFRESH, expires_at: exp });
    _resetTokenStateForTesting(); // simulate restart: memory cleared, store kept
    assert.equal(await resolveAuthToken('https://api-atlas.xailon.ai/v1/llm'), ACCESS);
  });

  test('a legacy plaintext row is read once and re-written encrypted', async () => {
    memory = JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_at: 42 });
    const loaded = await loadPersistedTokenState();
    assert.equal(loaded.refresh_token, REFRESH);
    assert.ok(!memory.includes(ACCESS) && !memory.includes(REFRESH), 'the plaintext row is replaced');
    assert.equal(JSON.parse(memory).format, 'enc-v1');
  });

  test('a wrong key or tampered value is treated as no state (falls back to refresh)', async () => {
    await persistTokenState({ access_token: ACCESS, refresh_token: REFRESH, expires_at: Date.now() + 600_000 });
    process.env.TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    assert.equal(await loadPersistedTokenState(), null);
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const stored = JSON.parse(memory);
    const parts = stored.sealed.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    memory = JSON.stringify({ ...stored, sealed: parts.join('.') });
    assert.equal(await loadPersistedTokenState(), null);
  });

  test('a rotated key still opens the stored state via TOKEN_ENCRYPTION_KEY_PREVIOUS, which is then re-sealed', async () => {
    await persistTokenState({ access_token: ACCESS, refresh_token: REFRESH, expires_at: 7 });
    const sealedWithOld = JSON.parse(memory).sealed;
    process.env.TOKEN_ENCRYPTION_KEY = 'c'.repeat(64); // new key
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = 'z-unrelated-key, ' + TEST_KEY; // old key among others
    const loaded = await loadPersistedTokenState();
    assert.equal(loaded.access_token, ACCESS);
    assert.notEqual(JSON.parse(memory).sealed, sealedWithOld, 're-sealed with the new key');
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS; // the old key can now be retired
    assert.equal((await loadPersistedTokenState()).refresh_token, REFRESH);
  });

  test('without any key nothing is persisted (tokens stay in memory only)', async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.BETTER_AUTH_SECRET;
    await persistTokenState({ access_token: ACCESS, refresh_token: REFRESH, expires_at: 1 });
    assert.equal(memory, null);
  });

  test('the key derives from BETTER_AUTH_SECRET when TOKEN_ENCRYPTION_KEY is unset, and differs from it', () => {
    const env = { BETTER_AUTH_SECRET: 'session-secret-for-tests' };
    const k = resolveKey('atlas-token-state', env);
    assert.equal(k.length, 32);
    assert.notEqual(k.toString('utf8'), env.BETTER_AUTH_SECRET);
    const sealed = sealJson({ x: 1 }, 'atlas-token-state', env);
    assert.deepEqual(openJson(sealed, 'atlas-token-state', env), { x: 1 });
    assert.equal(openJson(sealed, 'another-purpose', env), null, 'bound to its purpose');
    assert.equal(resolveKey('atlas-token-state', {}), null);
  });
});
