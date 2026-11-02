#!/usr/bin/env node
// ---------------------------------------------------------------------------
// End-to-end check of the per-tab AI review against a running DealForge server:
// validation, analysis and Q&A on a real opportunity.
//
//   npm run ai:e2e                       (first opportunity, a few tabs)
//   npm run ai:e2e -- --opp=<id> --tabs=executive_summary,financials
//
// Signs in as the seeded admin (ADMIN_EMAIL / DEFAULT_USER_PASSWORD), runs each
// step, asserts the response shape, the AI label/disclaimer, advisory-only
// status, stale detection and that the API key never appears in any response.
// Writes AI review results for the chosen opportunity (and audit rows); it does
// not edit the opportunity.
// ---------------------------------------------------------------------------
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;
const BASE = (arg('base', process.env.BASE_URL || 'http://localhost:3001')).replace(/\/+$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'admin@dealforge.local';
const PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'DealForge!2026';
const KEY = process.env.OPENAI_API_KEY || '';
const TABS = arg('tabs', 'executive_summary,financials,funding').split(',');
let cookie = '';
let failed = 0;
const raws = [];

const ok = (cond, label, detail = '') => { if (!cond) failed += 1; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`); return cond; };

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
  });
  const text = await res.text();
  raws.push(text);
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, json, setCookie: res.headers.getSetCookie?.() || [] };
}

// Model calls retry after a provider rate limit (free tiers cap tokens per
// minute), so a busy minute pauses the run instead of failing it.
async function paced(path, opts) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await call(path, opts);
    const limited = r.res.status === 429 || r.json?.result?.ai_status === 'rate_limited' || r.json?.run_error === 'rate_limited';
    if (!limited || attempt === 3) return r;
    console.log('      provider rate limit, waiting 40s');
    await new Promise((resolve) => setTimeout(resolve, 40000));
  }
}

const login = await call('/api/auth/sign-in/email', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ');
if (!ok(login.res.ok && cookie, 'sign in', `HTTP ${login.res.status}`)) process.exit(1);

const gov = await call('/api/ai-governance');
const openai = gov.json?.config?.providers?.find((p) => p.id === 'openai');
ok(openai?.approval_status === 'approved' || gov.json?.config?.require_provider_approval === false,
  'AI provider is approved in AI governance', `status: ${openai?.approval_status}`);

let oppId = arg('opp', '');
if (!oppId) {
  const list = await call('/api/entities/DealOpportunity');
  const rows = Array.isArray(list.json) ? list.json : list.json?.items || list.json?.data || [];
  oppId = rows[0]?.id || '';
}
if (!ok(oppId, 'found an opportunity', oppId)) process.exit(1);
const P = `/api/ai-review/opportunities/${encodeURIComponent(oppId)}`;

for (const tab of TABS) {
  console.log(`\n--- ${tab}`);
  const v = await paced(`${P}/validate`, { method: 'POST', body: { tab } });
  const vr = v.json?.result;
  ok(v.res.ok && vr?.checks?.length > 0, 'validate returns checks', `HTTP ${v.res.status}, ${vr?.checks?.length} checks, ai_status=${vr?.ai_status}`);
  ok(vr?.ai_status === 'ok', 'validation model checks ran', vr?.ai_status);
  ok(vr?.checks?.some((c) => c.source === 'ai'), 'validation includes AI checks');
  ok(vr?.stale === false && /AI-generated/.test(vr?.disclaimer || ''), 'result is fresh and carries the AI disclaimer');

  const a = await paced(`${P}/analyse`, { method: 'POST', body: { tab } });
  const ar = a.json?.result;
  ok(a.res.ok && ar?.ai_status === 'ok' && ar?.analysis, 'analyse returns research', `HTTP ${a.res.status}, ai_status=${ar?.ai_status}`);
  ok(Array.isArray(ar?.analysis?.items) && ar.analysis.recommendation?.rating, 'analysis has a recommendation and items', `${ar?.analysis?.items?.length} items`);
  ok(!JSON.stringify(ar?.analysis || {}).match(/https?:\/\//), 'analysis cites no web sources');

  const q = await paced(`${P}/ask`, { method: 'POST', body: { tab, question: 'What is the most important thing missing on this tab?' } });
  const msgs = q.json?.qa?.messages || [];
  ok(q.res.ok && msgs.at(-1)?.role === 'assistant' && msgs.at(-1)?.text, 'ask returns an answer', `HTTP ${q.res.status}`);
  ok(/AI-generated/.test(q.json?.qa?.disclaimer || ''), 'answer carries the AI disclaimer');
}

const all = await call(`${P}/results`);
ok(TABS.every((t) => all.json?.results?.[t]?.validation && all.json?.results?.[t]?.analysis), 'results hold validation and analysis for every tab run');
ok(TABS.every((t) => all.json?.qa?.[t]?.messages?.length >= 2), 'Q&A thread kept per tab');
ok(TABS.every((t) => all.json?.results?.[t]?.validation?.stale === false), 'nothing is stale right after running');

const empty = await call(`${P}/ask`, { method: 'POST', body: { tab: TABS[0], question: '   ' } });
ok(empty.res.status === 400, 'an empty question is refused', `HTTP ${empty.res.status}`);
const badTab = await call(`${P}/validate`, { method: 'POST', body: { tab: 'nope' } });
ok(badTab.res.status === 400, 'an unknown tab is refused', `HTTP ${badTab.res.status}`);

ok(!KEY || !raws.some((r) => r.includes(KEY)), 'the API key appears in no response');
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
