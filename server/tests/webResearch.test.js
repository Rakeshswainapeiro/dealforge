import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runExternalResearch, searchWeb, setResearchDeps, researchConfig, isResearchConfigured } from '../webResearch.js';
import {
  buildResearchQueries, resolveResearchParameters, normaliseSources, indexSources, normaliseFindings, quoteAppears, riskCandidates, DEFAULT_RESEARCH_PARAMETERS, EVIDENCE,
} from '../config/researchParameters.js';

const opp = { target_name: 'Acme Medical LLC', sector: 'Healthcare', geography: 'UAE', total_commitment_aed: 500, ask_aed: 300, narrative_what: 'SECRET deal narrative AED 500 mn', financials: { revenue: { y1p: 1 } } };

test('there are nine research parameters, each mapped to a submission tab', () => {
  assert.equal(DEFAULT_RESEARCH_PARAMETERS.length, 9);
  assert.ok(DEFAULT_RESEARCH_PARAMETERS.every((p) => p.tab && p.label && p.terms.length));
});

test('queries carry only public identifiers: never amounts, narratives or financials', () => {
  const qs = buildResearchQueries(opp);
  assert.ok(qs.length >= 9);
  const joined = qs.map((q) => q.query).join(' ');
  assert.match(joined, /Acme Medical LLC/);
  assert.match(joined, /Healthcare UAE/);
  assert.doesNotMatch(joined, /SECRET|500|300|narrative/i);
  assert.ok(qs.every((q) => q.query.length <= 200));
  assert.equal(new Set(qs.map((q) => q.parameter)).size, 9, 'every parameter has a query');
  assert.deepEqual(buildResearchQueries({}), [], 'no subject, no queries');
});

test('a parameter can be disabled or re-termed by Sirius, but ids cannot be invented', () => {
  const p = resolveResearchParameters([{ id: 'business_market', enabled: false }, { id: 'made_up', label: 'x' }]);
  assert.equal(p.length, 9);
  assert.equal(p.find((x) => x.id === 'business_market').enabled, false);
  assert.equal(buildResearchQueries(opp, p).some((q) => q.parameter === 'business_market'), false);
});

test('provider responses are normalised; sources without a real URL or date are handled honestly', () => {
  const t = normaliseSources('tavily', { results: [
    { title: 'A', url: 'https://news.example.com/a', content: 'Acme opened a hospital.', published_date: '2026-03-02' },
    { title: 'B', url: 'javascript:alert(1)', content: 'x' },
    { title: 'C', url: 'https://x.example.org/c', content: 'No date here', published_date: 'not a date' },
  ] });
  assert.equal(t.length, 2);
  assert.equal(t[0].published_date, '2026-03-02');
  assert.equal(t[1].published_date, null, 'no date is recorded as null, never guessed');
  assert.equal(t[0].source_name, 'news.example.com');
  const b = normaliseSources('brave', { web: { results: [{ title: 'D', url: 'https://d.example.com', description: '<b>Acme</b> grew', page_age: '2026-01-05T00:00:00', profile: { name: 'Daily D' } }] } });
  assert.equal(b[0].source_name, 'Daily D');
  assert.equal(b[0].snippet, 'Acme grew');
  const idx = indexSources([...t, ...t]);
  assert.equal(idx.length, 2);
  assert.deepEqual(idx.map((s) => s.id), ['S1', 'S2']);
});

const sources = indexSources(normaliseSources('tavily', { results: [
  { title: 'Acme opens hospital', url: 'https://news.example.com/a', content: 'Acme Medical opened a 200-bed hospital in Dubai in March, regulators said.', published_date: '2026-03-02' },
] }));
const param = DEFAULT_RESEARCH_PARAMETERS[0];

test('findings: a verbatim quote is verified; a cited paraphrase is inference; an uncited or invented citation is dropped', () => {
  const raw = { findings: [
    { statement: 'Acme opened a hospital', source_ids: ['S1'], quote: 'opened a 200-bed hospital in Dubai', risk: 'none' },
    { statement: 'Acme is the market leader', source_ids: ['S1'], quote: 'Acme dominates the whole GCC market', risk: 'low' },
    { statement: 'Acme was fined', source_ids: ['S9'], quote: 'fined heavily by the regulator', risk: 'high' },
    { statement: 'No citation at all', source_ids: [], quote: '' },
  ] };
  const { findings, dropped_uncited } = normaliseFindings(raw, sources, param);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].basis, EVIDENCE.VERIFIED);
  assert.equal(findings[0].sources[0].url, 'https://news.example.com/a');
  assert.equal(findings[0].sources[0].published_date, '2026-03-02');
  assert.equal(findings[1].basis, EVIDENCE.INFERENCE, 'a quote not in the source is not verified');
  assert.equal(findings[1].quote, null);
  assert.equal(dropped_uncited, 2);
  assert.equal(quoteAppears('short', 'short text'), false, 'too-short quotes prove nothing');
});

test('risk candidates are flagged for review from risk-parameter sources only', () => {
  const risky = indexSources(normaliseSources('tavily', { results: [{ title: 'Probe', url: 'https://x.example.com/p', content: 'Regulator opened an investigation into the group.' }] }));
  const riskParam = DEFAULT_RESEARCH_PARAMETERS.find((p) => p.id === 'risks');
  const c = riskCandidates(risky, riskParam);
  assert.equal(c.length, 1);
  assert.match(c[0].note, /reviewer must read/);
  assert.equal(riskCandidates(risky, DEFAULT_RESEARCH_PARAMETERS.find((p) => p.id === 'business_market')).length, 0);
});

const okGate = async () => ({ allowed: true, config: {} });
function fakeFetch(handler) {
  return async (url, init) => { const r = handler(url, init); return { ok: r.status === undefined || r.status < 400, status: r.status || 200, statusText: 'x', json: async () => r.body }; };
}
const env = { RESEARCH_PROVIDER: 'tavily', RESEARCH_API_KEY: 'tvly-secret-key-123456' };

test('with no provider configured nothing is searched and no result is invented', async () => {
  const r = await runExternalResearch({ data: opp, env: {} });
  assert.equal(r.status, 'not_configured');
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.sources, []);
  assert.equal(isResearchConfigured({}), false);
  assert.equal(researchConfig({ RESEARCH_PROVIDER: 'nope', RESEARCH_API_KEY: 'k' }).provider, null);
});

test('an unapproved search provider is refused before any request is made', async () => {
  let called = 0;
  setResearchDeps({ checkProvider: async () => ({ allowed: false, config: {} }), fetch: fakeFetch(() => { called += 1; return { body: {} }; }), log: async () => {} });
  const r = await runExternalResearch({ data: opp, env });
  assert.equal(r.status, 'not_approved');
  assert.equal(called, 0);
  await assert.rejects(() => searchWeb({ query: 'x', env }), (e) => e.status === 403);
});

test('a full run over all nine parameters records sources, citations, dates and gaps', async () => {
  const seen = [];
  setResearchDeps({
    checkProvider: okGate, log: async () => {},
    fetch: fakeFetch((url, init) => {
      const body = JSON.parse(init.body); seen.push(body.query);
      // Only the market-size and news parameters get results; everything else is empty.
      if (/CAGR/.test(body.query)) return { body: { results: [{ title: 'Healthcare market', url: 'https://r.example.com/m', content: 'The UAE healthcare market is expected to grow at a CAGR of 7.2 percent to 2030.', published_date: '2026-02-10' }] } };
      if (/governance ownership/.test(body.query)) return { body: { results: [{ title: 'Acme news', url: 'https://r.example.com/n', content: 'Acme Medical has a single owner.' }] } };
      return { body: { results: [] } };
    }),
  });
  const llm = { isConfigured: () => true, call: async ({ prompt }) => (/Market size/.test(prompt)
    ? { findings: [{ statement: 'Market growing about 7% a year', source_ids: ['S1'], quote: 'grow at a CAGR of 7.2 percent to 2030', risk: 'none' }] }
    : { findings: [{ statement: 'Made-up', source_ids: ['S77'], quote: 'invented quote nowhere' }] }) };
  const r = await runExternalResearch({ data: opp, env, llm });
  assert.equal(r.status, 'ok');
  assert.equal(r.parameters.length, 9);
  const market = r.parameters.find((p) => p.id === 'business_market');
  assert.equal(market.status, 'ok');
  assert.equal(market.counts.verified, 1);
  const f = r.findings.find((x) => x.parameter === 'business_market');
  assert.equal(f.sources[0].published_date, '2026-02-10');
  assert.equal(f.sources[0].url, 'https://r.example.com/m');
  // The news parameter's model answer cited a source that does not exist: it falls back to the source excerpt itself.
  const news = r.findings.filter((x) => x.parameter === 'governance');
  assert.ok(news.length && news.every((x) => x.excerpt_only && x.sources[0].published_date === null));
  assert.equal(r.parameters.filter((p) => p.missing).length, 7, 'seven parameters had nothing and are reported missing');
  assert.ok(r.queries_sent.length >= 9);
  assert.ok(seen.every((q) => !/500|300|SECRET/.test(q)));
});

test('provider failures are scrubbed of the key and reported, not thrown', async () => {
  setResearchDeps({ checkProvider: okGate, log: async () => {}, fetch: async () => { throw new Error('connect failed for tvly-secret-key-123456'); } });
  const r = await runExternalResearch({ data: opp, env });
  assert.equal(r.status, 'no_results');
  assert.ok(r.parameters.every((p) => p.status === 'error' || p.status === 'no_results'));
  assert.ok(!JSON.stringify(r).includes('tvly-secret-key-123456'));
  setResearchDeps({ fetch: fakeFetch(() => ({ status: 429, body: { message: 'slow down' } })) });
  const lim = await runExternalResearch({ data: opp, env });
  assert.equal(lim.status, 'rate_limited');
});
