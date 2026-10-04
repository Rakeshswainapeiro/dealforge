// i18n API integration (W8-02 / BRD PLT-06).
//
// Exercises the locale endpoint the client language switcher reads. Skips
// (rather than fails) when the server is unreachable.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/\/+$/, '');

let online = false;

async function api(path, { user } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-user-id'] = user;
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[i18nApi.test] server not reachable — tests will be skipped');
});

describe('i18n API', () => {
  test('GET /api/i18n reports the locale catalogue with completeness', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/i18n');
    assert.equal(status, 200);
    assert.equal(data.default_locale, 'en');
    assert.deepEqual(data.locales.map((l) => l.code), ['en', 'ar']);
    const ar = data.locales.find((l) => l.code === 'ar');
    assert.equal(ar.dir, 'rtl');
    assert.equal(ar.complete, true);
    assert.equal(ar.missing.length, 0);
    assert.equal(data.rtl_demo_screen.route, '/Dashboard');
  });

  test('GET /api/i18n/locales lists descriptors for the switcher', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/i18n/locales');
    assert.equal(status, 200);
    assert.equal(data.locales.length, 2);
    assert.equal(data.locales[1].dir, 'rtl');
  });
});
