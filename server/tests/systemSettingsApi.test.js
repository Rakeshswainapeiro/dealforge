// The generic settings API never exposes or accepts a system-managed setting
// (the encrypted Atlas token state), for any role. Runs against a live server
// (BASE_URL) with header identity enabled; skipped when none is reachable.
// It never touches the real token row: it plants its own probe row under the
// system-managed key (an unreadable placeholder) and always removes it.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemManagedSetting, SYSTEM_MANAGED_SETTING_KEYS } from '../entities.js';
import { ATLAS_TOKEN_SETTING_KEY } from '../tokenManager.js';
import { pool } from '../db.js';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/[/]+$/, '');
const PROBE_ID = 'system-setting-probe-' + Date.now();
let online = false;
let planted = false;

async function api(path, { method = 'GET', body, user } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-user-id'] = user;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

before(async () => {
  try {
    const r = await api('/api/entities/AppSettings', { user: 'user-admin' });
    online = r.status === 200 && Array.isArray(r.data);
  } catch { online = false; }
  if (!online) return;
  try {
    const value = JSON.stringify({ format: 'enc-v1', sealed: 'v1.probe.probe.probe', expires_at: 0 });
    await pool.query(
      "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',NULL,$2,'test','test')",
      [PROBE_ID, JSON.stringify({ setting_key: ATLAS_TOKEN_SETTING_KEY, setting_value: value })]
    );
    planted = true;
  } catch { planted = false; }
});

after(async () => {
  if (planted) await pool.query('DELETE FROM entity_record WHERE id = $1', [PROBE_ID]).catch(() => {});
  await pool.end().catch(() => {});
});

test('the Atlas token state is a system-managed setting', () => {
  assert.ok(SYSTEM_MANAGED_SETTING_KEYS.includes(ATLAS_TOKEN_SETTING_KEY));
  assert.equal(isSystemManagedSetting({ setting_key: ATLAS_TOKEN_SETTING_KEY }), true);
  assert.equal(isSystemManagedSetting({ setting_key: 'doa_config' }), false);
  assert.equal(isSystemManagedSetting(null), false);
});

describe('generic settings API (live server)', () => {
  test('no role, administrators included, can list or read the token state', async (t) => {
    if (!online || !planted) return t.skip('server offline, header identity disabled, or no database to plant a probe row');
    for (const user of ['user-admin', 'user-cio']) {
      const list = await api('/api/entities/AppSettings', { user });
      assert.equal(list.status, 200);
      assert.ok(!list.data.some((x) => x.setting_key === ATLAS_TOKEN_SETTING_KEY), `${user} must not see it in the list`);
      assert.ok(!JSON.stringify(list.data).includes('"sealed"'), 'no sealed token payload in the list');
      const one = await api('/api/entities/AppSettings/' + PROBE_ID, { user });
      assert.equal(one.status, 404, `${user} must get 404 by id`);
    }
  });

  test('the token state cannot be created, changed or deleted through the generic API', async (t) => {
    if (!online || !planted) return t.skip('server offline, header identity disabled, or no database to plant a probe row');
    const create = await api('/api/entities/AppSettings', { method: 'POST', user: 'user-admin', body: { setting_key: ATLAS_TOKEN_SETTING_KEY, setting_value: '{}' } });
    assert.equal(create.status, 403);
    const bulk = await api('/api/entities/AppSettings', { method: 'POST', user: 'user-admin', body: [{ setting_key: ATLAS_TOKEN_SETTING_KEY, setting_value: '{}' }] });
    assert.equal(bulk.status, 403);
    // Writes by id are refused before any change reaches the row.
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = await api('/api/entities/AppSettings/' + PROBE_ID, { method, user: 'user-admin', body: method === 'DELETE' ? undefined : { description: 'tampered' } });
      assert.equal(r.status, 404, `${method} must be refused, got ${r.status}`);
    }
    const { rows } = await pool.query("SELECT deleted, data->>'description' AS description FROM entity_record WHERE id = $1", [PROBE_ID]);
    assert.equal(rows[0].deleted, false, 'not deleted');
    assert.equal(rows[0].description, null, 'not changed');
  });

  test('an ordinary setting cannot be renamed into the token state', async (t) => {
    if (!online) return t.skip('server offline or header identity disabled');
    const made = await api('/api/entities/AppSettings', { method: 'POST', user: 'user-admin', body: { setting_key: 'system_settings_probe', setting_value: '{}' } });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    try {
      const rename = await api('/api/entities/AppSettings/' + made.data.id, { method: 'PUT', user: 'user-admin', body: { setting_key: ATLAS_TOKEN_SETTING_KEY } });
      assert.equal(rename.status, 403);
    } finally {
      await api('/api/entities/AppSettings/' + made.data.id, { method: 'DELETE', user: 'user-admin' });
    }
  });
});
