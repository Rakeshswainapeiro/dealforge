// ---------------------------------------------------------------------------
// Automated Token Manager for Atlas Xailon (OpenAI-compatible gateway).
//
// Features:
// 1. In-memory token caching with proactive refresh (60s before expiry).
// 2. Token expiration decoding from JWT payload.
// 3. Secure Refresh-Token Rotation and persistence in PostgreSQL (AppSettings).
// 4. Server restart recovery: restores the latest rotated refresh/access tokens.
// 5. Officially supported login fallback via /v1/auth/login if refresh token rotates or expires.
// 6. Reactive 401 retry hook for callLLM.
// 7. Full backward compatibility: transparent passthrough for static keys (OpenAI/Groq).
// 8. Secret scrubbing integration: never logs or leaks tokens.
// ---------------------------------------------------------------------------

import { pool } from './db.js';
import { hasKey, sealJson, openSealed } from './secretBox.js';

const SETTING_KEY = 'atlas_token_state';
const PROACTIVE_REFRESH_BUFFER_MS = 60_000; // 60 seconds

let inMemoryState = {
  access_token: null,
  refresh_token: null,
  expires_at: 0,
};

// Registered sensitive tokens to scrub from logs and errors.
const knownTokens = new Set();

export function isAtlasEndpoint(baseUrl) {
  const base = String(baseUrl || '').toLowerCase();
  return base.includes('api-atlas.xailon.ai') || base.includes('atlas.xailon');
}

export function decodeJwtExpiry(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

export function getKnownTokens() {
  return Array.from(knownTokens).filter(Boolean);
}

function registerToken(token) {
  if (token && typeof token === 'string' && token.length > 8) {
    knownTokens.add(token);
  }
}

function resolveOrigin(baseUrl) {
  try {
    return new URL(baseUrl || 'https://api-atlas.xailon.ai').origin;
  } catch {
    return 'https://api-atlas.xailon.ai';
  }
}

// ---------------------------------------------------------------------------
// Database persistence (survives server restart & maintains rotated tokens)
//
// The token pair is stored ENCRYPTED (AES-256-GCM, server/secretBox.js) in the
// AppSettings record 'atlas_token_state'; only the expiry time is in clear. With
// no encryption key configured nothing is persisted (tokens stay in memory). A
// row written before encryption existed is read once and immediately re-written
// encrypted. The generic settings API never returns this record
// (SYSTEM_MANAGED_SETTING_KEYS in entities.js).
// ---------------------------------------------------------------------------
export const ATLAS_TOKEN_SETTING_KEY = SETTING_KEY;
const SEAL_PURPOSE = 'atlas-token-state';
const STORED_FORMAT = 'enc-v1';

// The raw store: one AppSettings row. Swappable so tests never touch a database.
const dbStore = {
  async read() {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [SETTING_KEY]
    );
    return rows[0]?.setting_value ?? null;
  },
  async write(settingValue) {
    const payload = {
      setting_key: SETTING_KEY,
      setting_value: settingValue,
      description: 'Active Atlas Xailon rotated token state (auto-managed, encrypted)',
      last_updated_by: 'system_token_manager',
    };
    const { rows: existing } = await pool.query(
      "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [SETTING_KEY]
    );
    if (existing[0]) {
      await pool.query(
        'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
        [existing[0].id, JSON.stringify(payload), 'system_token_manager']
      );
    } else {
      await pool.query(
        "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1, 'AppSettings', NULL, $2, 'system', 'system')",
        ['atlas-token-state', JSON.stringify(payload)]
      );
    }
  },
};
let store = dbStore;
let warnedNoKey = false;

export async function persistTokenState(state) {
  if (!state) return;
  if (!hasKey(SEAL_PURPOSE)) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn('[token-manager] no encryption key (TOKEN_ENCRYPTION_KEY or BETTER_AUTH_SECRET); Atlas tokens are kept in memory only');
    }
    return;
  }
  try {
    const sealed = sealJson({ access_token: state.access_token || null, refresh_token: state.refresh_token || null }, SEAL_PURPOSE);
    await store.write(JSON.stringify({
      format: STORED_FORMAT,
      sealed,
      expires_at: state.expires_at || 0,
      updated_at: new Date().toISOString(),
    }));
  } catch (err) {
    // Non-fatal: in-memory state still functions if DB write fails transiently.
    console.warn('[token-manager] failed to persist token state:', err.message);
  }
}

export async function loadPersistedTokenState() {
  try {
    const raw = await store.read();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.format === STORED_FORMAT) {
      const opened = openSealed(parsed.sealed, SEAL_PURPOSE);
      if (!opened) return null; // wrong key, tampered or corrupt: start fresh (refresh / login)
      const state = {
        access_token: opened.value.access_token || null,
        refresh_token: opened.value.refresh_token || null,
        expires_at: Number(parsed.expires_at) || 0,
      };
      if (opened.rotated) await persistTokenState(state); // opened with a retired key: re-seal with the current one
      return state;
    }
    // Legacy plaintext row: use it once and re-write it encrypted straight away.
    if (parsed && (parsed.access_token || parsed.refresh_token)) {
      const legacy = {
        access_token: parsed.access_token || null,
        refresh_token: parsed.refresh_token || null,
        expires_at: Number(parsed.expires_at) || 0,
      };
      await persistTokenState(legacy);
      return legacy;
    }
  } catch {
    // If DB is offline or table uninitialized, fall back gracefully.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outbound Refresh & Login Calls
// ---------------------------------------------------------------------------
async function refreshWithAtlas(origin, refreshToken) {
  if (!refreshToken) return null;
  registerToken(refreshToken);
  const res = await fetch(`${origin}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!data?.access_token) return null;

  registerToken(data.access_token);
  registerToken(data.refresh_token);

  const expires_at = data.expires_in
    ? Date.now() + data.expires_in * 1000
    : decodeJwtExpiry(data.access_token) || Date.now() + 900_000;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // Atlas rotates refresh_token
    expires_at,
  };
}

async function loginWithAtlas(origin, email, password) {
  if (!email || !password) return null;
  registerToken(password);
  const res = await fetch(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!data?.access_token) return null;

  registerToken(data.access_token);
  registerToken(data.refresh_token);

  const expires_at = data.expires_in
    ? Date.now() + data.expires_in * 1000
    : decodeJwtExpiry(data.access_token) || Date.now() + 900_000;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at,
  };
}

// ---------------------------------------------------------------------------
// Main Token Resolution
// ---------------------------------------------------------------------------
export async function resolveAuthToken(baseUrl, fallbackKey = '') {
  // 1. Non-Atlas providers: return static key immediately with zero overhead.
  if (!isAtlasEndpoint(baseUrl) && !process.env.ATLAS_REFRESH_TOKEN && !process.env.ATLAS_EMAIL) {
    registerToken(fallbackKey);
    return fallbackKey;
  }

  const now = Date.now();
  const origin = resolveOrigin(baseUrl);

  // 2. In-memory cache hit (unexpired, with proactive 60s buffer).
  if (inMemoryState.access_token && now < inMemoryState.expires_at - PROACTIVE_REFRESH_BUFFER_MS) {
    return inMemoryState.access_token;
  }

  // 3. Check persistent database state (server restart recovery).
  if (!inMemoryState.access_token) {
    const persisted = await loadPersistedTokenState();
    if (persisted) {
      if (persisted.access_token) registerToken(persisted.access_token);
      if (persisted.refresh_token) registerToken(persisted.refresh_token);

      if (persisted.access_token && now < persisted.expires_at - PROACTIVE_REFRESH_BUFFER_MS) {
        inMemoryState = { ...persisted };
        return inMemoryState.access_token;
      }
      // Stored token is expired, but we may have the latest rotated refresh_token!
      if (persisted.refresh_token) {
        inMemoryState.refresh_token = persisted.refresh_token;
      }
    }
  }

  // 4. If fallbackKey is a valid JWT that is still active, adopt it.
  if (fallbackKey && (!inMemoryState.access_token || inMemoryState.access_token === fallbackKey)) {
    const jwtExpiry = decodeJwtExpiry(fallbackKey);
    registerToken(fallbackKey);
    if (jwtExpiry && now < jwtExpiry - PROACTIVE_REFRESH_BUFFER_MS) {
      inMemoryState.access_token = fallbackKey;
      inMemoryState.expires_at = jwtExpiry;
      return inMemoryState.access_token;
    }
  }

  // 5. Perform token refresh using active/persisted refresh token or env.
  const activeRefreshToken = inMemoryState.refresh_token || process.env.ATLAS_REFRESH_TOKEN || null;
  if (activeRefreshToken) {
    const refreshed = await refreshWithAtlas(origin, activeRefreshToken);
    if (refreshed) {
      inMemoryState = { ...refreshed };
      await persistTokenState(inMemoryState);
      return inMemoryState.access_token;
    }
  }

  // 6. Login fallback if refresh token fails or is missing (officially supported fallback).
  const email = process.env.ATLAS_EMAIL;
  const password = process.env.ATLAS_PASSWORD;
  if (email && password) {
    const loggedIn = await loginWithAtlas(origin, email, password);
    if (loggedIn) {
      inMemoryState = { ...loggedIn };
      await persistTokenState(inMemoryState);
      return inMemoryState.access_token;
    }
  }

  // 7. Last resort: return fallbackKey if provided, else null.
  return inMemoryState.access_token || fallbackKey || null;
}

// ---------------------------------------------------------------------------
// Reactive 401 Recovery
// ---------------------------------------------------------------------------
export async function forceTokenRefresh(baseUrl) {
  const origin = resolveOrigin(baseUrl);
  inMemoryState.access_token = null;
  inMemoryState.expires_at = 0;

  // Try refresh with latest available refresh token
  const activeRefreshToken = inMemoryState.refresh_token || process.env.ATLAS_REFRESH_TOKEN || null;
  if (activeRefreshToken) {
    const refreshed = await refreshWithAtlas(origin, activeRefreshToken);
    if (refreshed) {
      inMemoryState = { ...refreshed };
      await persistTokenState(inMemoryState);
      return inMemoryState.access_token;
    }
  }

  // Fallback to login
  const email = process.env.ATLAS_EMAIL;
  const password = process.env.ATLAS_PASSWORD;
  if (email && password) {
    const loggedIn = await loginWithAtlas(origin, email, password);
    if (loggedIn) {
      inMemoryState = { ...loggedIn };
      await persistTokenState(inMemoryState);
      return inMemoryState.access_token;
    }
  }

  return null;
}

// For testing: replace the persistence store ({ read, write }); null restores the database store.
export function _setTokenStoreForTesting(testStore = null) {
  store = testStore || dbStore;
  warnedNoKey = false;
}

// For testing and harness resets
export function _resetTokenStateForTesting(state = {}) {
  inMemoryState = {
    access_token: state.access_token || null,
    refresh_token: state.refresh_token || null,
    expires_at: state.expires_at || 0,
  };
  if (state.access_token) registerToken(state.access_token);
  if (state.refresh_token) registerToken(state.refresh_token);
}
