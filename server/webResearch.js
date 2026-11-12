import { checkAIProvider, logLLMCall } from './aiGovernance.js';
import { fetchWithTimeout } from './integrations.js';
import { scrubSecrets } from './config/aiGovernance.js';
import {
  EVIDENCE, resolveResearchParameters, buildResearchQueries, researchSubject, normaliseSources, indexSources,
  FINDINGS_SCHEMA, buildFindingsPrompt, normaliseFindings, excerptFindings, riskCandidates, RESULTS_PER_QUERY,
} from './config/researchParameters.js';

// ---------------------------------------------------------------------------
// External web research.
//
// A search provider (Tavily or Brave Search) is configured on the server:
//   RESEARCH_PROVIDER=tavily|brave   RESEARCH_API_KEY=...   (RESEARCH_BASE_URL optional)
// The provider goes through the same written-approval gate as a model provider
// (AI governance register: tavily, brave_search), is time-limited, rate-limit
// aware, and every query is written to the governed call log. Only public
// identifiers (target name, sector, geography) are ever put in a query.
//
// Results are never fabricated: with no provider, no approval, or no results, the
// parameter is recorded as missing. A model may summarise the returned sources
// but every finding must cite one of them, and only a quote that appears verbatim
// in a source is labelled verified evidence.
// ---------------------------------------------------------------------------

const PROVIDERS = {
  tavily: { base: 'https://api.tavily.com' },
  brave: { base: 'https://api.search.brave.com' },
};

export function researchConfig(env = process.env) {
  const provider = String(env.RESEARCH_PROVIDER || '').toLowerCase();
  if (!PROVIDERS[provider]) return { provider: null, key: '', base: '' };
  return { provider, key: env.RESEARCH_API_KEY || '', base: (env.RESEARCH_BASE_URL || PROVIDERS[provider].base).replace(/\/+$/, '') };
}

export function isResearchConfigured(env = process.env) {
  const c = researchConfig(env);
  return Boolean(c.provider && c.key);
}

const deps = { fetch: fetchWithTimeout, now: () => new Date(), checkProvider: checkAIProvider, log: logLLMCall };
export function setResearchDeps(overrides = {}) { Object.assign(deps, overrides); }

function statusError(message, status) { const e = new Error(message); e.status = status; return e; }

/** One governed search. Returns normalised sources; throws an error with .status on failure. */
export async function searchWeb({ query, topic = 'general', parameter = null, queryKey = null, actor = null, env = process.env }) {
  const cfg = researchConfig(env);
  if (!cfg.provider || !cfg.key) throw statusError('No web search provider is configured (set RESEARCH_PROVIDER and RESEARCH_API_KEY).', 400);
  const gate = await deps.checkProvider(cfg.base);
  if (!gate.allowed) throw statusError('The web search provider is not approved for use. Record a written approval in Settings > AI Governance.', 403);

  let url; let init;
  if (cfg.provider === 'tavily') {
    url = `${cfg.base}/search`;
    init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ query, max_results: RESULTS_PER_QUERY, topic: topic === 'news' ? 'news' : 'general', include_answer: false, search_depth: 'basic' }) };
  } else {
    const path = topic === 'news' ? '/res/v1/news/search' : '/res/v1/web/search';
    url = `${cfg.base}${path}?q=${encodeURIComponent(query)}&count=${RESULTS_PER_QUERY}`;
    init = { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': cfg.key } };
  }
  let response; let payload;
  try {
    response = await deps.fetch(url, init, Number(env.RESEARCH_TIMEOUT_MS || 20_000));
    payload = await response.json().catch(() => ({}));
  } catch (err) {
    const message = scrubSecrets(`Failed to reach the search provider: ${err.message}`, [cfg.key]);
    await deps.log({ model: `search:${cfg.provider}`, baseUrl: cfg.base, actor, prompt: query, error: message, config: gate.config }).catch(() => {});
    throw statusError(message, err.status || 502);
  }
  if (!response.ok) {
    const message = scrubSecrets(`Search provider error (${response.status}): ${payload?.detail?.error || payload?.error?.message || payload?.message || response.statusText}`, [cfg.key]);
    await deps.log({ model: `search:${cfg.provider}`, baseUrl: cfg.base, actor, prompt: query, error: message, config: gate.config }).catch(() => {});
    throw statusError(message, response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 401 : 502);
  }
  const sources = normaliseSources(cfg.provider, payload, { parameter, queryKey });
  await deps.log({ model: `search:${cfg.provider}`, baseUrl: cfg.base, actor, prompt: query, response: `${sources.length} result(s)`, config: gate.config }).catch(() => {});
  return sources;
}

/**
 * Research all parameters for one opportunity. `llm` = { isConfigured(), call(args) }
 * lets a model summarise the sources; without it the sources themselves are listed.
 */
export async function runExternalResearch({ data = {}, actor = null, llm = null, parametersConfig = null, env = process.env } = {}) {
  const cfg = researchConfig(env);
  const subject = researchSubject(data);
  const parameters = resolveResearchParameters(parametersConfig);
  const base = { provider: cfg.provider, subject, ran_at: deps.now().toISOString(), parameters: [], sources: [], findings: [], risk_candidates: [], queries_sent: [] };
  if (!cfg.provider || !cfg.key) return { ...base, status: 'not_configured', message: 'No web search provider is configured, so no external research was run. Set RESEARCH_PROVIDER and RESEARCH_API_KEY on the server.' };
  if (!subject.target) return { ...base, status: 'no_subject', message: 'The opportunity has no target or counterparty name to research.' };

  const queries = buildResearchQueries(data, parameters);
  const all = []; const perParam = new Map(parameters.map((p) => [p.id, { id: p.id, label: p.label, tab: p.tab, status: 'pending', source_ids: [], errors: [] }]));
  let blocked = null;
  for (const q of queries) {
    if (blocked) break;
    try {
      const found = await searchWeb({ query: q.query, topic: q.topic, parameter: q.parameter, queryKey: q.key, actor, env });
      base.queries_sent.push(q.query);
      all.push(...found);
    } catch (err) {
      const st = err.status;
      perParam.get(q.parameter).errors.push(err.message);
      // An unapproved or unauthorised provider, or an exhausted limit, ends the run: the rest would fail the same way.
      if (st === 403 || st === 401 || st === 429) blocked = { status: st === 403 ? 'not_approved' : st === 429 ? 'rate_limited' : 'unauthorised', message: err.message };
    }
  }
  const sources = indexSources(all);
  base.sources = sources;
  const useModel = Boolean(llm && llm.isConfigured && llm.isConfigured());
  for (const p of parameters) {
    const row = perParam.get(p.id);
    const mine = sources.filter((s) => s.parameters.includes(p.id));
    row.source_ids = mine.map((s) => s.id);
    let findings = [];
    if (mine.length) {
      row.synthesis = 'excerpts';
      if (useModel) {
        try {
          const raw = await llm.call({ prompt: buildFindingsPrompt({ parameter: p, subject, sources: mine }), response_json_schema: FINDINGS_SCHEMA, actor });
          const n = normaliseFindings(raw, mine, p);
          findings = n.findings; row.dropped_uncited = n.dropped_uncited; row.synthesis = 'ai';
          if (!findings.length) findings = excerptFindings(mine, p), row.synthesis = 'excerpts';
        } catch (err) {
          row.synthesis = err.status === 403 ? 'excerpts (model not approved)' : 'excerpts (model unavailable)';
          findings = excerptFindings(mine, p);
        }
      } else findings = excerptFindings(mine, p);
      base.risk_candidates.push(...riskCandidates(mine, p));
    }
    row.status = findings.length ? 'ok' : (blocked || row.errors.length ? 'error' : 'no_results');
    row.missing = findings.length === 0;
    row.counts = {
      verified: findings.filter((f) => f.basis === EVIDENCE.VERIFIED).length,
      inference: findings.filter((f) => f.basis === EVIDENCE.INFERENCE).length,
    };
    base.parameters.push(row);
    base.findings.push(...findings);
  }
  const answered = base.parameters.filter((p) => !p.missing).length;
  const status = blocked ? blocked.status : (answered === 0 ? 'no_results' : 'ok');
  return { ...base, status, message: blocked?.message || (answered === 0 ? 'The search returned nothing usable for any parameter.' : null), answered, total: base.parameters.length };
}

export default { researchConfig, isResearchConfigured, searchWeb, runExternalResearch, setResearchDeps };
