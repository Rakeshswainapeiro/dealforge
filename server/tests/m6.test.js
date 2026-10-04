// M6 integration tests — hardening, i18n readiness and UAT demo data (E10).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.BASE_URL || 'http://localhost:34000').replace(/[/]+$/, '');
const INFINIA = 'org-infinia-technologies-limited';
const FINSTREET = 'org-finstreet-limited';

let online = false;

async function api(path, { method = 'GET', body, user, form, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (user) headers['x-user-id'] = user;
  if (!form) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

function uploadForm(name, content = 'hello', type = 'text/plain') {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), name);
  return form;
}

// A gate document upload also needs the requirement it satisfies.
function docUploadForm(requirementKey, name, content = 'hello', type = 'text/plain') {
  const form = uploadForm(name, content, type);
  form.append('requirement_key', requirementKey);
  return form;
}

before(async () => {
  try { const res = await fetch(BASE + '/api/health'); online = res.ok; } catch { online = false; }
  if (!online) console.warn('[m6.test] server unreachable at ' + BASE);
});

describe('content sufficiency check (W5-03 / DOC-04)', () => {
  test('a reader sees the effective configuration and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/sufficiency', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective config and default are both returned');
    assert.equal(data.valid, true);
    assert.equal(data.config.min_history_years, 3);
    const keys = data.config.rules.map((r) => r.key);
    for (const key of ['cash_flow', 'history_years', 'downside_case']) {
      assert.ok(keys.includes(key), key + ' should be a shipped rule');
    }
  });

  test('a deal lead cannot change the configuration (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/sufficiency', {
      method: 'PUT', user: 'user-deal-lead', body: { min_history_years: 5 },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/sufficiency', { user: 'user-admin' });
    const base = before.data.config;
    const { status, data } = await api('/api/sufficiency', {
      method: 'PUT', user: 'user-admin',
      body: { min_history_years: 4, enabled: { cash_flow: base.rules.find((r) => r.key === 'cash_flow').enabled } },
    });
    assert.equal(status, 200);
    assert.equal(data.config.revision, base.revision + 1);
    assert.equal(data.config.min_history_years, 4);
    assert.ok(data.config.version.endsWith('.' + data.config.revision));
    assert.ok(data.changes.some((c) => c.field === 'min_history_years' && c.after === 4));

    const history = await api('/api/sufficiency/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore the shipped configuration so later runs start from the brief.
    await api('/api/sufficiency', { method: 'PUT', user: 'user-admin', body: { min_history_years: base.min_history_years, rules: base.rules } });
  });

  test('the gate flags thin content on a draft and a reviewer override clears it', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead', body: { status: 'draft', opportunity_name: 'W5-03 sufficiency probe' },
    });
    const id = draft.data.id;
    const gate = await api('/api/gate/opportunities/' + id + '/status', { user: 'user-deal-lead' });
    assert.equal(gate.status, 200);
    const suff = gate.data.gate.sufficiency;
    assert.ok(suff, 'the gate carries the sufficiency result');
    assert.equal(suff.advisory, true);
    assert.ok(suff.open_count > 0, 'an empty draft raises advisory flags');
    const target = suff.open_flags[0];

    // A deal lead owns the deal but is not a reviewer, so the override is 403.
    const denied = await api('/api/gate/opportunities/' + id + '/sufficiency-override', {
      method: 'POST', user: 'user-deal-lead', body: { key: target.key, by: 'x', reason: 'ignore this flag please' },
    });
    assert.equal(denied.status, 403);

    // A short reason is rejected.
    const short = await api('/api/gate/opportunities/' + id + '/sufficiency-override', {
      method: 'POST', user: 'user-admin', body: { key: target.key, reason: 'too short' },
    });
    assert.equal(short.status, 400);

    // A named admin with a written reason clears the flag.
    const ok = await api('/api/gate/opportunities/' + id + '/sufficiency-override', {
      method: 'POST', user: 'user-admin', body: { key: target.key, reason: 'Reviewed: the content is sufficient for this stage.' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.override.by, 'admin@dealforge.local');
    assert.ok(ok.data.sufficiency.open_count < suff.open_count, 'the override clears the flag from the open set');
    const flag = ok.data.sufficiency.flags.find((f) => f.key === target.key);
    assert.equal(flag.overridden, true);

    const history = await api('/api/gate/opportunities/' + id + '/sufficiency/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(history.data.some((e) => e.action === 'sufficiency_override'), 'the override is audited');
    await api('/api/entities/DealOpportunity/' + id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('security headers (E10.1)', () => {
  test('every API response carries the hardening baseline', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, headers } = await api('/api/health');
    assert.equal(status, 200);
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(headers.get('referrer-policy'), 'no-referrer');
    assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(headers.get('x-powered-by'), null, 'X-Powered-By must not be advertised');
  });

  test('uploads are served without a directory index', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/uploads/');
    assert.ok(status === 404 || status === 403, 'expected no directory listing, got ' + status);
  });
});

describe('upload validation (E10.1)', () => {
  test('a disallowed extension is rejected with 415', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/integrations/upload-file', {
      method: 'POST', form: uploadForm('payload.exe', 'MZ', 'application/octet-stream'),
    });
    assert.equal(status, 415);
    assert.match(String(data.error || ''), /Unsupported file type/i);
  });

  test('an allowed extension is accepted', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/integrations/upload-file', {
      method: 'POST', form: uploadForm('memo.pdf', '%PDF-1.4 test', 'application/pdf'),
    });
    assert.equal(status, 200);
    assert.ok(data.file_url, 'expected a stored file url');
  });

  test('the gate document route applies the same allow-list', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'M6 upload probe' },
    });
    const { status } = await api('/api/gate/opportunities/' + draft.data.id + '/documents', {
      method: 'POST', user: 'user-deal-lead', form: uploadForm('bad.exe', 'MZ', 'application/octet-stream'),
    });
    assert.equal(status, 415);
    await api('/api/entities/DealOpportunity/' + draft.data.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('rate limiting (E10.1)', () => {
  test('a limited route reports its budget and eventually returns 429', async (t) => {
    if (!online) return t.skip('server offline');
    if (process.env.RATE_LIMIT_DISABLED === '1') return t.skip('rate limiting disabled');
    // The limiter is keyed by actor, so a dedicated probe user gets a clean
    // budget. Read the advertised ceiling from the first response, then drive a
    // little past it, so the assertion holds whatever maximum the run sets.
    let limited = null;
    let ceiling = 30;
    for (let i = 0; i < 400; i += 1) {
      const res = await api('/api/integrations/upload-file', {
        method: 'POST', user: 'user-m6-ratelimit',
        form: uploadForm('probe.exe', 'MZ', 'application/octet-stream'),
      });
      if (res.status === 429) { limited = res; break; }
      assert.equal(res.status, 415, 'unexpected status ' + res.status);
      const advertised = Number(res.headers.get('ratelimit-limit'));
      assert.ok(advertised >= 1, 'the limiter advertises its ceiling');
      ceiling = advertised;
      if (i >= ceiling) break; // driven one past the ceiling; the trip is asserted below
    }
    assert.ok(limited, 'expected the limiter to trip past the advertised ceiling');
    assert.ok(Number(limited.headers.get('retry-after')) > 0, 'expected a Retry-After header');
  });
});

describe('client-supplied organisation is never trusted (E10.1, REQ-RBAC-02)', () => {
  test('a subsidiary user cannot create a record in a sibling organisation', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'M6 sibling write probe', owner_org_id: FINSTREET },
    });
    assert.equal(status, 403);
  });

  test('the owning organisation is derived from the actor', async (t) => {
    if (!online) return t.skip('server offline');
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'M6 ownership probe', owner_org_id: INFINIA },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.owner_org_id, INFINIA);
    await api('/api/entities/DealOpportunity/' + created.data.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('MVP sample data (W1-11/W1-12)', () => {
  test('the sample opportunities are present and spread across the pipeline', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api(
      '/api/entities/DealOpportunity?filter=' + encodeURIComponent(JSON.stringify({ seed: true })),
      { user: 'user-admin' }
    );
    assert.equal(status, 200);
    if (!Array.isArray(data) || data.length === 0) {
      return t.skip('sample data not seeded (SEED_PROFILE=mvp to enable)');
    }
    const states = new Set(data.map((opp) => opp.status));
    for (const expected of ['draft', 'submission', 'screening', 'refinement']) {
      assert.ok(states.has(expected), 'expected a sample opportunity in state ' + expected);
    }
    assert.ok(data.every((opp) => opp.seed === true), 'sample records carry the seed marker');
  });

  test('sample records stay inside their owning organisation for a sibling user', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api(
      '/api/entities/DealOpportunity?filter=' + encodeURIComponent(JSON.stringify({ seed: true })),
      { user: 'user-finstreet-lead' }
    );
    assert.equal(status, 200);
    if (!Array.isArray(data)) return t.skip('unexpected payload');
    assert.ok(
      data.every((opp) => opp.owner_org_id === FINSTREET),
      'a Finstreet user must only see Finstreet sample records'
    );
  });
});

describe('document upload policy (W5-02 / DOC-02)', () => {
  test('a reader sees the effective policy and the shipped 50 MB default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/document-policy', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective policy and default are both returned');
    assert.equal(data.valid, true);
    assert.equal(data.config.max_upload_mb, 50);
    for (const ext of ['pdf', 'docx', 'xlsx', 'pptx']) assert.ok(data.config.core_extensions.includes(ext), ext + ' should be core');
  });

  test('a deal lead cannot change the policy (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/document-policy', {
      method: 'PUT', user: 'user-deal-lead', body: { max_upload_mb: 5 },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/document-policy', { user: 'user-admin' });
    const base = before.data.config;
    const { status, data } = await api('/api/document-policy', {
      method: 'PUT', user: 'user-admin',
      body: { ...base, max_upload_mb: base.max_upload_mb, block_suspicious: true },
    });
    assert.equal(status, 200);
    assert.equal(data.config.revision, base.revision + 1);
    assert.ok(data.config.version.endsWith('.' + data.config.revision));
    assert.ok(data.changes.some((c) => c.field === 'block_suspicious' && c.value === true));

    const history = await api('/api/document-policy/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore the shipped policy so later runs start from the brief.
    await api('/api/document-policy', { method: 'PUT', user: 'user-admin', body: { ...base } });
  });

  test('a clean upload records its scan verdict and engine', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead', body: { status: 'draft', opportunity_name: 'W5-02 scan probe' },
    });
    const { status, data } = await api('/api/gate/opportunities/' + draft.data.id + '/documents', {
      method: 'POST', user: 'user-deal-lead', form: docUploadForm('business_plan', 'business_plan.pdf', '%PDF-1.4 clean report', 'application/pdf'),
    });
    assert.equal(status, 201);
    assert.equal(data.scan_verdict, 'clean');
    assert.ok(data.scan_engine, 'the scan engine is recorded');
    assert.ok(data.scanned_at, 'the scan timestamp is recorded');
    await api('/api/entities/DealOpportunity/' + draft.data.id, { method: 'DELETE', user: 'user-deal-lead' });
  });

  test('an infected upload is rejected and never becomes evidence', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead', body: { status: 'draft', opportunity_name: 'W5-02 infected probe' },
    });
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const { status, data } = await api('/api/gate/opportunities/' + draft.data.id + '/documents', {
      method: 'POST', user: 'user-deal-lead', form: docUploadForm('business_plan', 'business_plan.txt', eicar, 'text/plain'),
    });
    assert.equal(status, 422, 'an infected upload is not stored');
    assert.match(String(data.error || ''), /virus scan/i);

    const list = await api('/api/gate/opportunities/' + draft.data.id + '/documents', { user: 'user-deal-lead' });
    assert.equal(list.data.filter((d) => d.requirement_key === 'business_plan').length, 0, 'no document row is written');
    await api('/api/entities/DealOpportunity/' + draft.data.id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});

describe('data-point to source mapping (W5-04 / DOC-05)', () => {
  test('a reader sees the effective mapping and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/data-sources', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective mapping and default are both returned');
    assert.equal(data.valid, true);
    assert.equal(data.config.links.length, data.defaults.links.length);
    const fin = data.config.links.find((l) => l.target === 'financials_returns');
    assert.equal(fin.source_ref, 'returns_model');
    assert.equal(fin.source_type, 'document');
  });

  test('a deal lead cannot change the mapping (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/data-sources', {
      method: 'PUT', user: 'user-deal-lead', body: { links: [{ target: 'financials_returns', source_ref: 'market_data' }] },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/data-sources', { user: 'user-admin' });
    const base = before.data.config;
    const { status, data } = await api('/api/data-sources', {
      method: 'PUT', user: 'user-admin',
      body: { links: [{ target: 'financials_returns', source_ref: 'valuation_basis', source_type: 'document' }] },
    });
    assert.equal(status, 200);
    assert.equal(data.config.revision, base.revision + 1);
    assert.ok(data.config.version.endsWith('.' + data.config.revision));
    assert.equal(data.config.links.find((l) => l.target === 'financials_returns').source_ref, 'valuation_basis');
    assert.ok(data.changes.some((c) => c.target === 'financials_returns' && c.after === 'valuation_basis'));

    const history = await api('/api/data-sources/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore the shipped mapping so later runs start from the brief.
    await api('/api/data-sources', { method: 'PUT', user: 'user-admin', body: { links: base.links } });
  });

  test('the memo carries a source map that links a data point to its attached document', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W5-04 source probe', total_commitment_aed: 120 },
    });
    const id = draft.data.id;
    const up = await api('/api/gate/opportunities/' + id + '/documents', {
      method: 'POST', user: 'user-deal-lead',
      form: docUploadForm('returns_model', 'returns_model.pdf', '%PDF-1.4 returns', 'application/pdf'),
    });
    assert.equal(up.status, 201);

    const { status, data } = await api('/api/pipeline/opportunities/' + id + '/memo', { user: 'user-reviewer' });
    assert.equal(status, 200);
    assert.ok(data.source_map, 'the memo carries a source map');
    assert.ok(data.source_map.pages.length > 0, 'links are grouped by memo page');
    const fin = data.source_map.links.find((l) => l.target === 'financials_returns');
    assert.equal(fin.resolved, true);
    assert.equal(fin.availability, 'attached');
    assert.equal(fin.version, 1);
    assert.ok(fin.url, 'the attached source has an openable url');
    const commit = data.source_map.links.find((l) => l.target === 'header_total_commitment');
    assert.equal(commit.availability, 'captured');
    assert.equal(commit.value, 120);
    await api('/api/entities/DealOpportunity/' + id, { method: 'DELETE', user: 'user-deal-lead' });
  });
});


describe('document template library (W5-05 / DOC-06)', () => {
  test('a reader sees the four maintained templates and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/templates', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective library and default are both returned');
    assert.equal(data.valid, true);
    assert.equal(data.templates.length, 4);
    assert.deepEqual(
      data.templates.map((row) => row.id).sort(),
      ['financial_model', 'gate_checklist', 'opportunity_overview', 'risk_register']
    );
    const overview = data.templates.find((row) => row.id === 'opportunity_overview');
    assert.equal(overview.format, 'docx');
    assert.equal(overview.enabled, true);
    assert.equal(overview.download_url, '/api/templates/opportunity_overview/download');
  });

  test('a deal lead cannot maintain the library (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/templates', {
      method: 'PUT', user: 'user-deal-lead', body: { templates: [{ id: 'risk_register', owner: 'Me' }] },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1, audits it, and can re-enable', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/templates', { user: 'user-admin' });
    const base = before.data.config;
    const off = await api('/api/templates', {
      method: 'PUT', user: 'user-admin', body: { templates: [{ id: 'risk_register', enabled: false }] },
    });
    assert.equal(off.status, 200);
    assert.equal(off.data.config.revision, base.revision + 1);
    assert.ok(off.data.changes.some((c) => c.id === 'risk_register' && c.field === 'enabled'));
    const afterOff = await api('/api/templates', { user: 'user-admin' });
    assert.ok(!afterOff.data.templates.some((row) => row.id === 'risk_register'), 'disabled template is hidden');

    const history = await api('/api/templates/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore the shipped library so later runs start clean.
    await api('/api/templates', { method: 'PUT', user: 'user-admin', body: { templates: base.templates } });
  });

  test('each template downloads a current version with the right content type', async (t) => {
    if (!online) return t.skip('server offline');
    const docx = await fetch(BASE + '/api/templates/opportunity_overview/download', { headers: { 'x-user-id': 'user-deal-lead' } });
    assert.equal(docx.status, 200);
    assert.match(docx.headers.get('content-type'), /wordprocessingml/);
    assert.match(docx.headers.get('content-disposition'), /Sirius_Opportunity_Overview\.docx/);
    const docxBytes = Buffer.from(await docx.arrayBuffer());
    assert.ok(docxBytes.length > 2000, 'a real docx is produced');

    const csv = await fetch(BASE + '/api/templates/financial_model/download', { headers: { 'x-user-id': 'user-deal-lead' } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /Line item,Kind,Unit,FY-3 A/);

    assert.equal((await fetch(BASE + '/api/templates/ghost/download', { headers: { 'x-user-id': 'user-deal-lead' } })).status, 404);
  });
});

describe('decision reason codes (W6-01 / WF-05)', () => {
  test('a reader sees the catalogue, per-class options and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/decision-reasons', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective config and default are both returned');
    assert.equal(data.valid, true);
    const keys = data.config.classes.map((c) => c.key);
    for (const key of ['approve', 'return', 'decline', 'withdraw']) {
      assert.ok(keys.includes(key), key + ' should be a shipped decision class');
    }
    assert.ok(Array.isArray(data.options.decline) && data.options.decline.length >= 4, 'decline options are exposed');
  });

  test('a deal lead cannot change the catalogue (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/decision-reasons', {
      method: 'PUT', user: 'user-deal-lead', body: { classes: [] },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1, audits it, and hides a disabled code', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/decision-reasons', { user: 'user-admin' });
    const base = before.data.config;
    const off = await api('/api/decision-reasons', {
      method: 'PUT', user: 'user-admin',
      body: { classes: [{ key: 'decline', reasons: [{ id: 'capital_constraint', enabled: false }] }] },
    });
    assert.equal(off.status, 200);
    assert.equal(off.data.config.revision, base.revision + 1);
    assert.ok(off.data.changes.some((c) => c.id === 'capital_constraint' && c.field === 'enabled'));
    const afterOff = await api('/api/decision-reasons', { user: 'user-admin' });
    assert.ok(!afterOff.data.options.decline.some((r) => r.id === 'capital_constraint'), 'disabled code is hidden');

    const history = await api('/api/decision-reasons/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore the shipped catalogue so later runs start clean.
    await api('/api/decision-reasons', { method: 'PUT', user: 'user-admin', body: { classes: base.classes } });
  });

  test('a decline without a reason code is refused and with one is recorded', async (t) => {
    if (!online) return t.skip('server offline');
    // Build a submitted-in-review opportunity the reviewer can decline.
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: {
        opportunity_name: 'W6-01 decline probe',
        owner_org_id: INFINIA,
        status: 'submission',
      },
    });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const id = created.data.id;
    await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' },
    });

    const noCode = await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-fahad', body: { state: 'declined', comment: 'Not for us' },
    });
    assert.equal(noCode.status, 400, JSON.stringify(noCode.data));
    const still = await api('/api/entities/DealOpportunity/' + id, { user: 'user-deal-lead' });
    assert.equal(still.data.status, 'screening', 'the item is unchanged without a reason code');

    const declined = await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-fahad',
      body: { state: 'declined', reason_code: 'returns_below_hurdle', comment: 'IRR under hurdle' },
    });
    assert.equal(declined.status, 200, JSON.stringify(declined.data));
    assert.equal(declined.data.reason_code, 'returns_below_hurdle');
    const after = await api('/api/entities/DealOpportunity/' + id, { user: 'user-deal-lead' });
    assert.equal(after.data.status, 'declined');
    assert.equal(after.data.decision_reason, 'returns_below_hurdle');
    assert.equal(after.data.decision_reason_class, 'decline');
    assert.equal(after.data.decision_reason_text, 'IRR under hurdle');
    const history = await api('/api/pipeline/opportunities/' + id + '/transitions', { user: 'user-deal-lead' });
    const row = history.data.find((h) => h.to_state === 'declined');
    assert.equal(row.reason_code, 'returns_below_hurdle', 'the code is retained on the transition history');
  });
});

describe('delegation of authority (W6-02 / WF-08)', () => {
  test('a reader sees the matrix and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/doa', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective config and default are both returned');
    assert.equal(data.valid, true);
    const keys = data.config.tiers.map((x) => x.key);
    for (const key of ['standard', 'elevated', 'committee', 'board']) {
      assert.ok(keys.includes(key), key + ' should be a shipped ticket band');
    }
  });

  test('resolving a ticket size names the accountable party and the deciding roles', async (t) => {
    if (!online) return t.skip('server offline');
    const low = await api('/api/doa/resolve', {
      method: 'POST', user: 'user-deal-lead', body: { amount_aed: 150, roles: ['sirius_deal_lead'] },
    });
    assert.equal(low.status, 200);
    assert.equal(low.data.authority.tier.key, 'standard');
    assert.equal(low.data.authority.accountable_party.key, 'vertical_head');
    assert.equal(low.data.authority.authorized, true);

    const high = await api('/api/doa/resolve', {
      method: 'POST', user: 'user-deal-lead', body: { amount_aed: 800, roles: ['sirius_deal_lead'] },
    });
    assert.equal(high.data.authority.tier.key, 'board');
    assert.equal(high.data.authority.authorized, false, 'a deal lead cannot decide a board ticket');
  });

  test('a deal lead cannot change the matrix (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/doa', { method: 'PUT', user: 'user-deal-lead', body: { tiers: [] } });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/doa', { user: 'user-admin' });
    const base = before.data.config;
    const edited = base.tiers.map((x) => (x.key === 'board' ? { ...x, description: 'Above the board threshold (retuned).' } : x));
    const saved = await api('/api/doa', { method: 'PUT', user: 'user-admin', body: { tiers: edited } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.key === 'board' && c.field === 'description'));

    const history = await api('/api/doa/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore so later runs start clean.
    await api('/api/doa', { method: 'PUT', user: 'user-admin', body: { tiers: base.tiers } });
  });

  test('an admin edit that overlaps bands is refused with 400', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/doa', { user: 'user-admin' });
    const base = before.data.config;
    const overlap = base.tiers.map((x) => (x.key === 'standard' ? { ...x, max_aed: 500 } : x));
    const res = await api('/api/doa', { method: 'PUT', user: 'user-admin', body: { tiers: overlap } });
    assert.equal(res.status, 400, JSON.stringify(res.data));
    assert.match(res.data.error, /invalid/i);
  });

  test('a Gate-1 decision by a non-delegated role is refused and by the delegated role succeeds', async (t) => {
    if (!online) return t.skip('server offline');
    // A committee-scale ticket (AED 500mn) is delegated to the CIO and IC only.
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { opportunity_name: 'W6-02 DoA probe', owner_org_id: INFINIA, status: 'submission', total_commitment_aed: 500 },
    });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const id = created.data.id;
    await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' },
    });

    // The consolidated leadership role is not delegated a committee-scale ticket.
    const refused = await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-fahad', body: { state: 'refinement' },
    });
    assert.equal(refused.status, 403, JSON.stringify(refused.data));
    assert.ok(refused.data.doa, 'the refusal carries the band and its delegated roles');
    assert.equal(refused.data.doa.tier.key, 'committee');
    assert.equal(refused.data.doa.authorized, false);

    // The CIO is delegated this band.
    const allowed = await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-cio', body: { state: 'refinement' },
    });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
    assert.equal(allowed.data.doa.tier.key, 'committee');

    // The bestowing authority is stamped on the record.
    const after = await api('/api/entities/DealOpportunity/' + id, { user: 'user-deal-lead' });
    assert.equal(after.data.gate1_authority.tier, 'committee');
    assert.equal(after.data.gate1_authority.decided_by, 'cio@sirius.local');

    const events = await api('/api/audit?entity=DealOpportunity&entity_id=' + id, { user: 'user-admin' });
    const rows = Array.isArray(events.data) ? events.data : (events.data.events || []);
    assert.ok(rows.some((e) => e.action === 'gate1_authority_applied'), 'the applied authority is audited');
  });
});

describe('related-party overlay (W6-03 / WF-06)', () => {
  test('a reader sees the overlay config and the shipped default', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/related-party', { user: 'user-deal-lead' });
    assert.equal(status, 200);
    assert.ok(data.config && data.defaults, 'effective config and default are both returned');
    assert.equal(data.valid, true);
    assert.ok(Array.isArray(data.bases) && data.bases.length >= 5, 'the accepted arm length bases are exposed');
    assert.equal(data.config.require_independent_signoff, true, 'the independent sign-off requirement ships on');
    assert.ok(data.config.signoff_roles.includes('independent_reviewer'));
  });

  test('a deal lead cannot change the overlay (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/related-party', {
      method: 'PUT', user: 'user-deal-lead', body: { require_independent_signoff: false },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/related-party', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/related-party', {
      method: 'PUT', user: 'user-admin',
      body: { require_arm_length_documentation: false },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'require_arm_length_documentation' && c.after === false));

    const history = await api('/api/related-party/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');

    // Restore so later runs start clean.
    await api('/api/related-party', {
      method: 'PUT', user: 'user-admin',
      body: { require_arm_length_documentation: base.require_arm_length_documentation },
    });
  });

  test('a flagged deal is refused the Gate-1 decision until an independent sign-off is recorded', async (t) => {
    if (!online) return t.skip('server offline');
    // A self-contained flag-to-signoff walk, so re-runs never depend on the
    // sample fixture still sitting in its original state.
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: {
        opportunity_name: 'W6-03 related-party probe', owner_org_id: INFINIA,
        status: 'draft', total_commitment_aed: 120, sourcing_channel: 'ihc_affiliate_referral',
      },
    });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const id = created.data.id;
    await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'submission' },
    });
    await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { state: 'screening' },
    });
    const view = await api('/api/related-party/opportunities/' + id, { user: 'user-sirius-deal-lead' });
    assert.equal(view.status, 200, JSON.stringify(view.data));
    assert.equal(view.data.flagged, true, 'the affiliate referral auto-flags the deal');

    // The arm-length record is not on file yet, so the overlay is open and the
    // Gate-1 decision is blocked for a delegated decider.
    const blocked = await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-fahad', body: { state: 'refinement' },
    });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.data));
    assert.ok(blocked.data.related_party, 'the refusal carries the overlay verdict');
    assert.equal(blocked.data.related_party.blocked, true);
    assert.ok(blocked.data.missing.includes('independent_signoff'));

    // The arm-length evidence is recorded by the owning layer.
    const recorded = await api('/api/related-party/opportunities/' + id, {
      method: 'PUT', user: 'user-sirius-deal-lead',
      body: {
        flagged: true,
        disclosure: 'Referred by an IHC affiliate; an independent reviewer must sign off before decision.',
        arm_length_basis: 'independent_fairness_opinion',
        arm_length_note: 'Independent fairness opinion commissioned by the audit committee.',
      },
    });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.data));

    // The independent reviewer gives the sign-off.
    const signed = await api('/api/related-party/opportunities/' + id + '/signoff', {
      method: 'POST', user: 'user-reviewer', body: { signoff_note: 'Reviewed the arm length evidence; no conflict.' },
    });
    assert.equal(signed.status, 200, JSON.stringify(signed.data));
    assert.equal(signed.data.signed_off, true);
    assert.equal(signed.data.overlay.status, 'signed_off');

    // Now the delegated decider may take the Screening Decision.
    const allowed = await api('/api/pipeline/opportunities/' + id + '/transition', {
      method: 'POST', user: 'user-fahad', body: { state: 'refinement' },
    });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
    assert.ok(allowed.data.related_party, 'the applied overlay is returned');
    assert.equal(allowed.data.related_party.signed_off, true);

    const after = await api('/api/entities/DealOpportunity/' + id, { user: 'user-admin' });
    assert.equal(after.data.related_party_overlay.status, 'signed_off');
    assert.equal(after.data.related_party_overlay.signed_off_by, 'reviewer@sirius.local');

    const events = await api('/api/audit?entity=DealOpportunity&entity_id=' + id, { user: 'user-admin' });
    const rows = Array.isArray(events.data) ? events.data : (events.data.events || []);
    assert.ok(rows.some((e) => e.action === 'related_party_overlay_applied'), 'the applied overlay is audited');
    assert.ok(rows.some((e) => e.action === 'related_party_signoff'), 'the sign-off is audited');
  });

  test('a conflicted user is ineligible to sign off and to decide', async (t) => {
    if (!online) return t.skip('server offline');
    const id = 'seed-related-party';
    const view = await api('/api/related-party/opportunities/' + id, { user: 'user-deal-lead' });
    if (view.status === 404) return t.skip('sample data not seeded');

    // The preparer is conflicted with the deal and cannot give the sign-off.
    const conflictedSignoff = await api('/api/related-party/opportunities/' + id + '/signoff', {
      method: 'POST', user: 'user-deal-lead', body: {},
    });
    assert.equal(conflictedSignoff.status, 403, JSON.stringify(conflictedSignoff.data));
    assert.equal(conflictedSignoff.data.conflicted, true);

    // The viewer block reports the conflict and that the reviewer may not decide.
    const reviewerView = await api('/api/related-party/opportunities/' + id, { user: 'user-deal-lead' });
    assert.equal(reviewerView.data.viewer.conflicted, true);
    assert.ok(reviewerView.data.viewer.conflict_reasons.includes('preparer'));
  });
});


describe('comment visibility (W6-04 / AUD-03)', () => {
  // A self-contained opportunity owned by the subsidiary, so the test never
  // depends on the sample fixture being in any particular state on a re-run.
  async function makeSubsidiaryOpportunity(note) {
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: {
        opportunity_name: 'W6-04 visibility probe ' + note, owner_org_id: INFINIA,
        status: 'draft', total_commitment_aed: 90,
      },
    });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    return created.data.id;
  }

  test('a reader sees the policy and their own internal-comment capability', async (t) => {
    if (!online) return t.skip('server offline');
    const sub = await api('/api/comment-visibility', { user: 'user-deal-lead' });
    assert.equal(sub.status, 200);
    assert.ok(sub.data.config && sub.data.defaults, 'effective config and default are both returned');
    assert.equal(sub.data.valid, true);
    assert.equal(sub.data.config.restrict_internal_to_group, true, 'the restriction ships on');
    assert.equal(sub.data.viewer.may_view_internal, false, 'a subsidiary deal lead may not see internal comments');
    const grp = await api('/api/comment-visibility', { user: 'user-sirius-deal-lead' });
    assert.equal(grp.data.viewer.may_view_internal, true, 'the group layer may see internal comments');
  });

  test('a deal lead cannot change the policy (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/comment-visibility', {
      method: 'PUT', user: 'user-deal-lead', body: { restrict_internal_to_group: false },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records the change in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/comment-visibility', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/comment-visibility', {
      method: 'PUT', user: 'user-admin',
      body: { notify_internal_messages: true },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'notify_internal_messages' && c.after === true));
    const history = await api('/api/comment-visibility/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');
    await api('/api/comment-visibility', {
      method: 'PUT', user: 'user-admin',
      body: { notify_internal_messages: base.notify_internal_messages },
    });
  });

  test('an internal thread is never visible to a subsidiary role', async (t) => {
    if (!online) return t.skip('server offline');
    const oppId = await makeSubsidiaryOpportunity('internal');
    const opened = await api('/api/qa/opportunities/' + oppId + '/threads', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: {
        subject: 'Internal note: valuation bridge',
        body: 'Group-only working assumption, do not share with the subsidiary.',
        visibility: 'internal',
        participants: ['deal.lead@infinia.local'],
      },
    });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assert.equal(opened.data.visibility, 'internal');
    const threadId = opened.data.id;

    // The subsidiary deal lead cannot see it in any read path.
    const list = await api('/api/qa/opportunities/' + oppId + '/threads', { user: 'user-deal-lead' });
    assert.ok(!list.data.threads.some((x) => x.id === threadId), 'internal thread is filtered from the list');
    const mine = await api('/api/qa/my-threads', { user: 'user-deal-lead' });
    assert.ok(!mine.data.items.some((x) => x.id === threadId), 'internal thread is filtered from the inbox');
    const detail = await api('/api/qa/threads/' + threadId, { user: 'user-deal-lead' });
    assert.equal(detail.status, 403, 'internal thread detail is refused');
    const reply = await api('/api/qa/threads/' + threadId + '/messages', {
      method: 'POST', user: 'user-deal-lead', body: { body: 'Trying to peek' },
    });
    assert.equal(reply.status, 403, 'a subsidiary role cannot post to an internal thread');
    const audit = await api('/api/qa/threads/' + threadId + '/audit', { user: 'user-deal-lead' });
    assert.equal(audit.status, 403, 'a subsidiary role cannot read the internal thread audit');

    // The group layer sees it in full.
    const grpList = await api('/api/qa/opportunities/' + oppId + '/threads', { user: 'user-sirius-deal-lead' });
    assert.ok(grpList.data.threads.some((x) => x.id === threadId), 'the group layer sees the internal thread');
    const grpDetail = await api('/api/qa/threads/' + threadId, { user: 'user-sirius-deal-lead' });
    assert.equal(grpDetail.status, 200);
    assert.ok(grpDetail.data.messages.some((m) => m.visibility === 'internal'));

    // The subsidiary participant was never notified about the internal thread.
    const notif = await api('/api/notifications', { user: 'user-deal-lead' });
    const items = Array.isArray(notif.data) ? notif.data : (notif.data.items || []);
    assert.ok(!items.some((n) => String(n.subject || '').includes('valuation bridge')), 'no internal notification reaches the subsidiary role');
  });

  test('a subsidiary-only author cannot create an internal thread (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const oppId = await makeSubsidiaryOpportunity('author');
    const { status } = await api('/api/qa/opportunities/' + oppId + '/threads', {
      method: 'POST', user: 'user-deal-lead',
      body: { subject: 'Sneaky internal', body: 'not allowed', visibility: 'internal' },
    });
    assert.equal(status, 403);
  });

  test('a shared thread is visible to both layers; an internal message on it is not', async (t) => {
    if (!online) return t.skip('server offline');
    const oppId = await makeSubsidiaryOpportunity('mixed');
    const opened = await api('/api/qa/opportunities/' + oppId + '/threads', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { subject: 'Shared question', body: 'Visible to all participants.', visibility: 'shared' },
    });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assert.equal(opened.data.visibility, 'shared');
    const threadId = opened.data.id;

    // A group-only message is posted on the shared thread.
    const internalMsg = await api('/api/qa/threads/' + threadId + '/messages', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { body: 'Group-only aside.', visibility: 'internal' },
    });
    assert.equal(internalMsg.status, 200, JSON.stringify(internalMsg.data));
    assert.equal(internalMsg.data.visibility, 'internal');
    const sharedMsg = await api('/api/qa/threads/' + threadId + '/messages', {
      method: 'POST', user: 'user-sirius-deal-lead', body: { body: 'Shared follow-up.' },
    });
    assert.equal(sharedMsg.data.visibility, 'shared');

    const sub = await api('/api/qa/threads/' + threadId, { user: 'user-deal-lead' });
    assert.equal(sub.status, 200, 'the shared thread is visible to the subsidiary role');
    assert.ok(sub.data.messages.some((m) => m.body === 'Visible to all participants.'), 'the shared message is visible');
    assert.ok(sub.data.messages.some((m) => m.body === 'Shared follow-up.'), 'the later shared message is visible');
    assert.ok(!sub.data.messages.some((m) => m.body === 'Group-only aside.'), 'the internal message is filtered out');

    const grp = await api('/api/qa/threads/' + threadId, { user: 'user-sirius-deal-lead' });
    assert.ok(grp.data.messages.some((m) => m.body === 'Group-only aside.'), 'the group layer sees the internal message');
  });
});

describe('hash-chained audit (W6-05 / AUD-01)', () => {
  test('a reader sees the chain policy and it validates', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/audit-chain', { user: 'user-deal-lead' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.config && res.data.defaults, 'effective config and default are both returned');
    assert.equal(res.data.valid, true);
    assert.equal(res.data.config.enabled, true, 'hash chaining ships on');
    assert.equal(res.data.config.algorithm, 'sha256');
  });

  test('a deal lead cannot verify the chain (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/audit-chain/verify', { method: 'POST', user: 'user-deal-lead' });
    assert.equal(status, 403);
  });

  test('an admin verify reports an intact chain and is itself audited', async (t) => {
    if (!online) return t.skip('server offline');
    const first = await api('/api/audit-chain/verify', { method: 'POST', user: 'user-admin' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.ok, true, 'the live chain verifies clean');
    assert.ok(first.data.summary.checked >= 1, 'at least the events written by this run are chained');
    assert.equal(first.data.summary.chained, first.data.summary.checked);
    // The verify run writes its own audit row, so a second verify sees strictly more.
    const second = await api('/api/audit-chain/verify', { method: 'POST', user: 'user-admin' });
    assert.equal(second.data.ok, true);
    assert.ok(second.data.summary.checked > first.data.summary.checked, 'each verify appends a chained row');
    assert.ok(second.data.summary.last_seq >= second.data.summary.checked);
  });

  test('a chain write serialises seq and prev_hash into a contiguous chain', async (t) => {
    if (!online) return t.skip('server offline');
    // Two verify runs write two audit rows back to back; the chain must stay
    // contiguous (no duplicate seq) with each row pointing at its predecessor.
    await api('/api/audit-chain/verify', { method: 'POST', user: 'user-admin' });
    await api('/api/audit-chain/verify', { method: 'POST', user: 'user-admin' });
    const res = await api('/api/audit-chain/verify', { method: 'POST', user: 'user-admin' });
    assert.equal(res.data.ok, true);
    assert.equal(res.data.summary.reason, null);
    assert.equal(res.data.summary.broken_at, null);
  });

  test('an admin edit mints revision + 1 and records it in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/audit-chain', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/audit-chain', {
      method: 'PUT', user: 'user-admin', body: { owner: 'Internal Audit' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'owner' && c.after === 'Internal Audit'));
    const history = await api('/api/audit-chain/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');
    // Restore so a re-run starts from the shipped owner.
    await api('/api/audit-chain', { method: 'PUT', user: 'user-admin', body: { owner: base.owner } });
  });

  test('a changed chain config invalidates the write cache and still verifies', async (t) => {
    if (!online) return t.skip('server offline');
    const saved = await api('/api/audit-chain', {
      method: 'PUT', user: 'user-admin', body: { enabled: true, algorithm: 'sha256' },
    });
    assert.equal(saved.status, 200);
    const res = await api('/api/audit-chain/verify', { method: 'POST', user: 'user-admin' });
    assert.equal(res.data.ok, true);
    assert.equal(res.data.summary.enabled, true);
  });
});

describe('presentation scheduling (W6-06 / WF-07)', () => {
  async function makeSubsidiaryOpportunity(note) {
    const created = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: {
        opportunity_name: 'W6-06 presentation probe ' + note, owner_org_id: INFINIA,
        status: 'draft', total_commitment_aed: 90,
      },
    });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    return created.data.id;
  }

  test('a reader sees the presentation policy and its vocabulary', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/presentations', { user: 'user-deal-lead' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.config && res.data.defaults, 'effective config and default are both returned');
    assert.equal(res.data.valid, true);
    assert.ok(res.data.statuses.some((s) => s.key === 'completed'));
    assert.ok(res.data.formats.some((f) => f.key === 'video'));
  });

  test('a deal lead cannot change the policy (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/presentations', {
      method: 'PUT', user: 'user-deal-lead', body: { require_attendees: false },
    });
    assert.equal(status, 403);
  });

  test('a session needs a date and an attendee (422) and is recorded on success', async (t) => {
    if (!online) return t.skip('server offline');
    const oppId = await makeSubsidiaryOpportunity('capture');
    const missingDate = await api('/api/presentations/opportunities/' + oppId, {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { attendees: ['analyst@sirius.local'] },
    });
    assert.equal(missingDate.status, 422, JSON.stringify(missingDate.data));
    assert.deepEqual(missingDate.data.missing, ['scheduled_at']);
    const missingAttendee = await api('/api/presentations/opportunities/' + oppId, {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { scheduled_at: '2026-03-01T09:00:00Z' },
    });
    assert.equal(missingAttendee.status, 422);
    assert.deepEqual(missingAttendee.data.missing, ['attendees']);

    const created = await api('/api/presentations/opportunities/' + oppId, {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: {
        scheduled_at: '2026-03-01T09:00:00Z', format: 'video',
        attendees: [{ email: 'analyst@sirius.local', name: 'Analyst' }],
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.session.status, 'scheduled');
    assert.equal(created.data.session.attendees.length, 1);

    const listed = await api('/api/presentations/opportunities/' + oppId, { user: 'user-sirius-deal-lead' });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.sessions.length, 1);
    assert.equal(listed.data.viewer.may_manage, true);
  });

  test('the owning subsidiary deal lead may manage its own presentation', async (t) => {
    if (!online) return t.skip('server offline');
    const oppId = await makeSubsidiaryOpportunity('own');
    const created = await api('/api/presentations/opportunities/' + oppId, {
      method: 'POST', user: 'user-deal-lead',
      body: { scheduled_at: '2026-03-02T09:00:00Z', attendees: ['gc@sirius.local'] },
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const listed = await api('/api/presentations/opportunities/' + oppId, { user: 'user-deal-lead' });
    assert.equal(listed.data.viewer.may_manage, true);
  });

  test('completing a session requires an outcome, then the record shows it', async (t) => {
    if (!online) return t.skip('server offline');
    const oppId = await makeSubsidiaryOpportunity('complete');
    const created = await api('/api/presentations/opportunities/' + oppId, {
      method: 'POST', user: 'user-sirius-deal-lead',
      body: { scheduled_at: '2026-03-03T09:00:00Z', attendees: ['ic@sirius.local'] },
    });
    const sessionId = created.data.session.id;
    const refused = await api('/api/presentations/opportunities/' + oppId + '/sessions/' + sessionId, {
      method: 'PUT', user: 'user-sirius-deal-lead', body: { status: 'completed' },
    });
    assert.equal(refused.status, 422);
    assert.deepEqual(refused.data.missing, ['outcome']);
    const done = await api('/api/presentations/opportunities/' + oppId + '/sessions/' + sessionId, {
      method: 'PUT', user: 'user-sirius-deal-lead',
      body: { status: 'completed', outcome: 'Approved to proceed to Gate 1', next_steps: 'Draft the IC pack' },
    });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal(done.data.session.status, 'completed');
    assert.equal(done.data.session.outcome, 'Approved to proceed to Gate 1');
    assert.equal(done.data.session.next_steps, 'Draft the IC pack');
  });

  test('an admin edit mints revision + 1 and records it in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/presentations', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/presentations', {
      method: 'PUT', user: 'user-admin', body: { require_outcome_on_complete: false },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'require_outcome_on_complete'));
    const history = await api('/api/presentations/history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1, 'the change is audited');
    await api('/api/presentations', {
      method: 'PUT', user: 'user-admin',
      body: { require_outcome_on_complete: base.require_outcome_on_complete },
    });
  });
});

describe('notification email frequency (W6-07 / NTF-01)', () => {
  test('a user sees the policy and their own effective frequency', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/notification-frequency', { user: 'user-deal-lead' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.config && res.data.defaults);
    assert.equal(res.data.valid, true);
    assert.equal(res.data.config.default_frequency, 'immediate');
    assert.equal(res.data.config.user_selectable, true);
    assert.ok(res.data.frequencies.some((f) => f.key === 'daily_digest'));
    assert.ok(res.data.viewer && 'frequency' in res.data.viewer);
  });

  test('a user sets their own frequency and it round-trips', async (t) => {
    if (!online) return t.skip('server offline');
    const saved = await api('/api/notification-frequency', {
      method: 'PUT', user: 'user-deal-lead', body: { frequency: 'daily_digest' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.viewer.preference, 'daily_digest');
    const after = await api('/api/notification-frequency', { user: 'user-deal-lead' });
    assert.equal(after.data.viewer.frequency, 'daily_digest');
    // Restore so a re-run starts from immediate.
    await api('/api/notification-frequency', { method: 'PUT', user: 'user-deal-lead', body: { frequency: 'immediate' } });
  });

  test('an unknown frequency is refused (422)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/notification-frequency', {
      method: 'PUT', user: 'user-deal-lead', body: { frequency: 'weekly' },
    });
    assert.equal(status, 422);
  });

  test('a deal lead cannot change the group policy (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/notification-frequency/policy', {
      method: 'PUT', user: 'user-deal-lead', body: { default_frequency: 'daily_digest' },
    });
    assert.equal(status, 403);
  });

  test('the digest contains only the caller\u2019s own notifications', async (t) => {
    if (!online) return t.skip('server offline');
    // The subsidiary deal lead\u2019s digest must never name a recipient other than themselves.
    const digest = await api('/api/notification-frequency/digest', { user: 'user-deal-lead' });
    assert.equal(digest.status, 200, JSON.stringify(digest.data));
    assert.equal(digest.data.recipient_email, 'deal.lead@infinia.local');
    const rows = (digest.data.kinds || []).flatMap((k) => k.items || []);
    assert.ok(rows.every((r) => !r.recipient_email || r.recipient_email === 'deal.lead@infinia.local'));
  });

  test('an admin edit mints revision + 1 and records it in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/notification-frequency', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/notification-frequency/policy', {
      method: 'PUT', user: 'user-admin', body: { default_frequency: 'daily_digest' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'default_frequency' && c.after === 'daily_digest'));
    const history = await api('/api/notification-frequency/policy-history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1);
    await api('/api/notification-frequency/policy', {
      method: 'PUT', user: 'user-admin',
      body: { default_frequency: base.default_frequency, digest_hour: base.digest_hour, user_selectable: base.user_selectable },
    });
  });
});

describe('IHC weekly report (W7-01 / DSH-03)', () => {
  test('a reader sees the tracker columns in the agreed order', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/reporting/weekly', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const keys = res.data.columns.map((c) => c.key);
    assert.deepEqual(keys, ['ref', 'subsidiary', 'opportunity_name', 'opportunity_type', 'sector', 'geography',
      'total_commitment_mn', 'state_label', 'owner_email', 'age_days', 'sla_days', 'sla_breached', 'decision', 'updated_date']);
    assert.ok(res.data.summary && 'total' in res.data.summary);
  });

  test('the config carries the default schedule and full column vocabulary', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/reporting/config', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.valid, true);
    assert.equal(res.data.config.schedule.weekday, 5);
    assert.equal(res.data.all_columns.length, 14);
  });

  test('a deal lead cannot change the configuration (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/reporting/config', {
      method: 'PUT', user: 'user-deal-lead', body: { columns: ['ref'] },
    });
    assert.equal(status, 403);
  });

  test('the Excel export returns a workbook', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/reporting/weekly.xlsx', { user: 'user-admin', headers: { Accept: 'application/octet-stream' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /spreadsheetml/);
  });

  test('an admin edit mints revision + 1 and records it in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/reporting/config', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/reporting/config', {
      method: 'PUT', user: 'user-admin', body: { schedule: { ...base.schedule, enabled: true } },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'schedule'));
    const history = await api('/api/reporting/config-history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1);
    await api('/api/reporting/config', {
      method: 'PUT', user: 'user-admin', body: { schedule: base.schedule },
    });
  });
});

describe('pipeline dashboard (W7-02 / DSH-01)', () => {
  test('the config exposes every filter dimension and default drill-down', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/pipeline-dashboard', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.valid, true);
    assert.equal(res.data.config.default_drilldown, 'state');
    assert.ok(Array.isArray(res.data.dimensions) && res.data.dimensions.length === 6);
  });

  test('the board returns the cards, options and drill-down for the actor', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/pipeline-dashboard/board', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(Array.isArray(res.data.cards));
    assert.ok(res.data.summary && 'total' in res.data.summary);
    assert.ok(res.data.options && Array.isArray(res.data.options.state));
    assert.ok(res.data.drilldown && Array.isArray(res.data.drilldown.groups));
  });

  test('a stage filter narrows the returned cards', async (t) => {
    if (!online) return t.skip('server offline');
    const all = await api('/api/pipeline-dashboard/board', { user: 'user-admin' });
    const state = all.data.options.state[0]?.value;
    if (!state) return t.skip('no cards to filter');
    const filtered = await api('/api/pipeline-dashboard/board?state=' + encodeURIComponent(state), { user: 'user-admin' });
    assert.equal(filtered.status, 200, JSON.stringify(filtered.data));
    assert.ok(filtered.data.cards.length <= all.data.cards.length);
    assert.ok(filtered.data.cards.every((c) => c.state === state));
    assert.equal(filtered.data.active_filters, 1);
  });

  test('a drill-down regroups by the requested dimension', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/pipeline-dashboard/board?drilldown=entity', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.drilldown.dimension, 'entity');
  });

  test('a deal lead cannot change the configuration (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/pipeline-dashboard/config', {
      method: 'PUT', user: 'user-deal-lead', body: { default_drilldown: 'entity' },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records it in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/pipeline-dashboard', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/pipeline-dashboard/config', {
      method: 'PUT', user: 'user-admin', body: { default_drilldown: 'entity' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'default_drilldown'));
    const history = await api('/api/pipeline-dashboard/config-history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1);
    await api('/api/pipeline-dashboard/config', {
      method: 'PUT', user: 'user-admin', body: { default_drilldown: base.default_drilldown },
    });
  });
});

describe('funnel & cycle-time metrics (W7-03 / DSH-04)', () => {
  test('the config exposes the funnel stages, branch states and ranges', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/pipeline-metrics', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.valid, true);
    assert.equal(res.data.stages.length, 4);
    assert.equal(res.data.branch_states.length, 3);
    assert.equal(res.data.ranges.length, 4);
  });

  test('the summary returns the funnel, cycle time and reasons', async (t) => {
    if (!online) return t.skip('server offline');
    const res = await api('/api/pipeline-metrics/summary', { user: 'user-admin' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(Array.isArray(res.data.funnel) && res.data.funnel.length === 4);
    assert.ok(Array.isArray(res.data.cycle) && res.data.cycle.length === 4);
    assert.ok(res.data.reasons && res.data.reasons.declined);
    assert.ok('entered' in res.data && 'cycle_breaches' in res.data);
  });

  test('a narrower range never widens the entered funnel', async (t) => {
    if (!online) return t.skip('server offline');
    const all = await api('/api/pipeline-metrics/summary', { user: 'user-admin' });
    const narrow = await api('/api/pipeline-metrics/summary?range=30d', { user: 'user-admin' });
    assert.equal(narrow.status, 200, JSON.stringify(narrow.data));
    assert.ok(narrow.data.entered <= all.data.entered);
    assert.equal(narrow.data.range, '30d');
  });

  test('a deal lead cannot change the configuration (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const { status } = await api('/api/pipeline-metrics/config', {
      method: 'PUT', user: 'user-deal-lead', body: { range: '30d' },
    });
    assert.equal(status, 403);
  });

  test('an admin edit mints revision + 1 and records it in history', async (t) => {
    if (!online) return t.skip('server offline');
    const before = await api('/api/pipeline-metrics', { user: 'user-admin' });
    const base = before.data.config;
    const saved = await api('/api/pipeline-metrics/config', {
      method: 'PUT', user: 'user-admin', body: { range: '90d' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.revision, base.revision + 1);
    assert.ok(saved.data.changes.some((c) => c.field === 'range'));
    const history = await api('/api/pipeline-metrics/config-history', { user: 'user-admin' });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.length >= 1);
    await api('/api/pipeline-metrics/config', {
      method: 'PUT', user: 'user-admin', body: { range: base.range },
    });
  });
});

describe('opportunity overview pack (W7-04 / OUT-02)', () => {
  test('the pack vocabulary lists the six-page Part B order', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/memo-pack', { user: 'user-admin' });
    assert.equal(status, 200, JSON.stringify(data));
    assert.deepEqual(data.page_order.map((p) => p.key), ['executive_summary', 'overview', 'rationale', 'financials', 'funding', 'risks']);
    assert.ok(Array.isArray(data.formats) && data.formats.some((f) => f.key === 'html'));
  });

  test('the manifest confirms the six pages are in template order', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-04 pack probe', total_commitment_aed: 120, ask_aed: 40 },
    });
    const id = draft.data.id;
    const { status, data } = await api('/api/memo-pack/opportunities/' + id, { user: 'user-deal-lead' });
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.page_count, 6);
    assert.equal(data.in_template_order, true);
    assert.equal(data.pages.length, 6);
  });

  test('the HTML pack downloads with six ordered pages and an attachment header', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-04 html probe', total_commitment_aed: 80 },
    });
    const id = draft.data.id;
    const res = await api('/api/memo-pack/opportunities/' + id + '.html', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(res.headers.get('content-disposition') || '', /attachment/);
    assert.equal((String(res.data).match(/<section/g) || []).length, 6);
    assert.ok(String(res.data).indexOf('id="page-1"') < String(res.data).indexOf('id="page-6"'));
  });

  test('the markdown pack downloads as text', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-04 md probe' },
    });
    const res = await api('/api/memo-pack/opportunities/' + draft.data.id + '.md', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/markdown/);
    assert.equal((String(res.data).match(/^## Page /gm) || []).length, 6);
  });

  test('an unsupported pack format is rejected (400)', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-04 bad format probe' },
    });
    const res = await api('/api/memo-pack/opportunities/' + draft.data.id + '.pdf', { user: 'user-deal-lead' });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.data.supported));
  });

  test('a cross-org caller cannot export another tenant\u2019s pack (403)', async (t) => {
    if (!online) return t.skip('server offline');
    // Admin files a sibling-tenancy (Finstreet) opportunity; the Infinia deal
    // lead is neither in that org, a descendant of it, nor a cross-org reader.
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-admin',
      body: { status: 'draft', opportunity_name: 'W7-04 tenant probe', owner_org_id: FINSTREET },
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    const manifest = await api('/api/memo-pack/opportunities/' + draft.data.id, { user: 'user-deal-lead' });
    assert.equal(manifest.status, 403);
    const pack = await api('/api/memo-pack/opportunities/' + draft.data.id + '.html', { user: 'user-deal-lead' });
    assert.equal(pack.status, 403);
  });
});

describe('memo QR verification (W7-05 / OUT-03)', () => {
  test('the vocabulary lists the fingerprint fields and result legend', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/memo-verification', { user: 'user-admin' });
    assert.equal(status, 200, JSON.stringify(data));
    assert.deepEqual(data.fingerprint_fields.map((f) => f.key), ['subsidiary', 'opportunity_name', 'pages']);
    assert.equal(data.results.ok.valid, true);
  });

  test('issuing returns a signed verify URL, version and hash', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-05 verify probe', total_commitment_aed: 120 },
    });
    const id = draft.data.id;
    const { status, data } = await api('/api/memo-verification/opportunities/' + id, { user: 'user-deal-lead' });
    assert.equal(status, 200, JSON.stringify(data));
    assert.match(data.hash, /^[0-9a-f]{64}$/);
    assert.match(data.version, /^v-[0-9a-f]{12}$/);
    assert.ok(data.verify_url.includes('/verify?'), data.verify_url);
    assert.ok(data.token.includes('sig='), data.token);
  });

  test('the QR image renders as PNG for the issued payload', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-05 qr probe' },
    });
    const res = await api('/api/memo-verification/opportunities/' + draft.data.id + '/qr.png', { user: 'user-deal-lead' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /image\/png/);
    assert.ok(String(res.data).length > 100 || res.data instanceof ArrayBuffer);
  });

  test('an authorised scan of an unchanged record verifies as valid', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-05 public verify probe', total_commitment_aed: 55 },
    });
    const id = draft.data.id;
    const issued = await api('/api/memo-verification/opportunities/' + id, { user: 'user-deal-lead' });
    // Public verify carries no session: exactly what a scanned phone has.
    const { status, data } = await api('/api/memo-verification/verify?' + issued.data.token);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.valid, true, JSON.stringify(data));
    assert.equal(data.result.valid, true);
    assert.equal(data.version, issued.data.version);
  });

  test('a tampered hash fails the public scan', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-deal-lead',
      body: { status: 'draft', opportunity_name: 'W7-05 tamper probe' },
    });
    const id = draft.data.id;
    const issued = await api('/api/memo-verification/opportunities/' + id, { user: 'user-deal-lead' });
    const token = new URLSearchParams(issued.data.token);
    token.set('h', 'f'.repeat(64));
    const { status, data } = await api('/api/memo-verification/verify?' + token.toString());
    assert.equal(status, 200);
    assert.equal(data.valid, false);
    // A forged hash breaks the HMAC signature before any record comparison.
    assert.equal(data.result.label, 'Unverified');
  });

  test('an unsigned / malformed scan is rejected', async (t) => {
    if (!online) return t.skip('server offline');
    const { status, data } = await api('/api/memo-verification/verify?id=opp-x');
    assert.equal(status, 400);
    assert.equal(data.valid, false);
  });

  test('a cross-org caller cannot issue a QR for another tenant (403)', async (t) => {
    if (!online) return t.skip('server offline');
    const draft = await api('/api/entities/DealOpportunity', {
      method: 'POST', user: 'user-admin',
      body: { status: 'draft', opportunity_name: 'W7-05 tenant probe', owner_org_id: FINSTREET },
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    const issue = await api('/api/memo-verification/opportunities/' + draft.data.id, { user: 'user-deal-lead' });
    assert.equal(issue.status, 403);
    const qr = await api('/api/memo-verification/opportunities/' + draft.data.id + '/qr.png', { user: 'user-deal-lead' });
    assert.equal(qr.status, 403);
  });
});
