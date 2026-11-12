#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Smoke test for the OpenAI-compatible backend DealForge uses for AI features.
//
//   npm run ai:check
//
// Reads OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL from the environment
// (node --env-file=.env), then checks: the key is set, /models answers, and
// /chat/completions returns valid JSON in JSON mode (what validation, analysis
// and Q&A rely on). The key is never printed; provider errors are scrubbed.
// ---------------------------------------------------------------------------
import { scrubSecrets } from '../server/config/aiGovernance.js';
import { resolveAuthToken, getKnownTokens } from '../server/tokenManager.js';

const base = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
const key = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let activeKey = key;
try {
  activeKey = await resolveAuthToken(base, key);
} catch {
  // Graceful fallback to static key
}

const safe = (t) => scrubSecrets(t, [key, activeKey, ...getKnownTokens()]);
const headers = { 'Content-Type': 'application/json', ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}) };
let failed = false;
const report = (ok, label, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + safe(detail) : ''}`); };

console.log(`Endpoint: ${base || '(not set)'}   Model: ${model}   Key: ${activeKey ? 'set (hidden)' : 'NOT SET'}`);
report(Boolean(base), 'OPENAI_BASE_URL is set');
report(Boolean(activeKey) || !/api\.openai\.com/.test(base), 'OPENAI_API_KEY / Token is resolved');
if (!base || (!activeKey && /api\.openai\.com/.test(base))) process.exit(1);

try {
  const res = await fetch(`${base}/models`, { headers });
  const body = await res.json().catch(() => ({}));
  report(res.ok, 'GET /models', res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}: ${body?.error?.message || res.statusText}`);
  if (res.ok && Array.isArray(body?.data)) report(body.data.some((m) => m.id === model), `model "${model}" is available to this key`);
} catch (err) { report(false, 'GET /models', err.message); }

try {
  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Reply with only this JSON object: {"ok": true, "word": "ping"}' }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  report(res.ok, 'POST /chat/completions', res.ok ? `HTTP ${res.status}, ${Date.now() - started} ms` : `HTTP ${res.status}: ${body?.error?.message || res.statusText}`);
  if (res.ok) {
    let parsed = null;
    try { parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? ''); } catch { /* reported below */ }
    report(parsed?.ok === true, 'JSON mode returns valid JSON');
    if (body?.usage) console.log(`      tokens: ${body.usage.prompt_tokens} in / ${body.usage.completion_tokens} out`);
  }
} catch (err) { report(false, 'POST /chat/completions', err.message); }

console.log(failed ? '\nNot ready.' : '\nOpenAI backend is ready. Next: approve the provider in Admin > AI governance, then npm run ai:e2e.');
process.exit(failed ? 1 : 0);
