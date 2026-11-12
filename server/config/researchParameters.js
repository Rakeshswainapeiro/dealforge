// ---------------------------------------------------------------------------
// External research: the research parameters, the queries, and the rules that
// keep a finding honest. Pure: no database, no network.
//
// Evidence classes used everywhere in the research, comparison and
// recommendation output:
//   verified_evidence  a quote that appears verbatim in a returned source (with
//                      its name, URL and date when the source gave one) or in a
//                      submitted document / field
//   ai_inference       a model's reading of sources it was given; cites them but
//                      the wording is the model's
//   missing            nothing was found; recorded so the gap is visible
// A finding that cites a source that was not returned is dropped, never kept.
// ---------------------------------------------------------------------------

export const EVIDENCE = { VERIFIED: 'verified_evidence', INFERENCE: 'ai_inference', MISSING: 'missing' };
export const EVIDENCE_CLASSES = Object.values(EVIDENCE);

// The nine research parameters named in the Phase 1 requirement (Req 5): business
// and market, strategic fit, management, financial performance, quality of
// earnings, risks, governance, subsidiary value and synergies. `tab` is where the
// finding is shown; `risk` marks parameters whose findings can raise a risk;
// `scope` says what the query is about: the target company, its sector and
// geography, or both (first term about the company, the rest about the market).
// The search terms are Sirius-editable (AppSettings key research_parameters).
export const DEFAULT_RESEARCH_PARAMETERS = [
  { id: 'business_market', label: 'Business and market', tab: 'opportunity_overview', risk: false, scope: 'both',
    terms: ['business model products customers', 'market size growth competitors CAGR'] },
  { id: 'strategic_fit', label: 'Strategic fit', tab: 'rationale', risk: false, scope: 'market',
    terms: ['industry trends consolidation investment outlook'] },
  { id: 'management', label: 'Management', tab: 'opportunity_overview', risk: false, scope: 'company',
    terms: ['management team CEO founders background track record'] },
  { id: 'financial_performance', label: 'Financial performance', tab: 'financials', risk: false, scope: 'company',
    terms: ['revenue profit results financial performance growth'] },
  { id: 'quality_of_earnings', label: 'Quality of earnings', tab: 'financials', risk: true, scope: 'company',
    terms: ['earnings quality restatement audit qualified opinion revenue recognition'] },
  { id: 'risks', label: 'Risks', tab: 'risks', risk: true, scope: 'both',
    terms: ['litigation lawsuit investigation fine penalty sanctions', 'sector risks regulation outlook'] },
  { id: 'governance', label: 'Governance', tab: 'risks', risk: true, scope: 'company',
    terms: ['governance ownership shareholders board related party controversy corruption'] },
  { id: 'subsidiary_value', label: 'Subsidiary value', tab: 'executive_summary', risk: false, scope: 'market',
    terms: ['valuation multiple acquisition comparable transactions'] },
  { id: 'synergies', label: 'Synergies', tab: 'rationale', risk: false, scope: 'both',
    terms: ['partnerships customers cross-sell', 'synergies integration sector acquisitions'] },
];

export const RESEARCH_SETTING_KEY = 'research_parameters';
export const MAX_QUERY_CHARS = 200;
export const RESULTS_PER_QUERY = 5;

const text = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Stored overrides over the defaults. Ids cannot be invented; only label/terms/enabled can change. */
export function resolveResearchParameters(stored = null) {
  const byId = new Map((Array.isArray(stored) ? stored : []).map((p) => [p?.id, p]));
  return DEFAULT_RESEARCH_PARAMETERS.map((d) => {
    const o = byId.get(d.id) || {};
    const terms = Array.isArray(o.terms) && o.terms.length ? o.terms.map((t) => text(t, 120)).filter(Boolean).slice(0, 4) : d.terms;
    return { ...d, label: text(o.label, 80) || d.label, terms, enabled: o.enabled !== false };
  });
}

/**
 * The search queries for one opportunity. Only PUBLIC identifiers leave the
 * platform: the target's name, its sector and its geography. Amounts, financials,
 * narratives, the Sirius ask and the Preparer's identity are never put in a query.
 */
export function buildResearchQueries(data = {}, parameters = resolveResearchParameters()) {
  const target = text(data.target_name || data.opportunity_name, 90);
  const sector = text(data.sector, 60);
  const geography = text(data.geography, 60);
  const queries = [];
  for (const p of parameters.filter((x) => x.enabled !== false)) {
    p.terms.forEach((term, i) => {
      // Company parameters search the target; market parameters search sector + geography;
      // "both" searches the company with the first term and the market with the rest.
      const company = p.scope === 'company' || (p.scope === 'both' && i === 0);
      const subject = company ? target : [sector, geography].filter(Boolean).join(' ');
      if (!subject) return;
      const q = text([`"${subject}"`, term, company && geography ? geography : ''].filter(Boolean).join(' '), MAX_QUERY_CHARS);
      queries.push({ parameter: p.id, key: `${p.id}:${i}`, query: q, topic: p.id === 'risks' && i === 0 ? 'news' : 'general' });
    });
  }
  return queries;
}

/** Can the platform research this opportunity at all? Without a target there is nothing to search for. */
export function researchSubject(data = {}) {
  return { target: text(data.target_name || data.opportunity_name, 90) || null, sector: text(data.sector, 60) || null, geography: text(data.geography, 60) || null };
}

// ------------------------------------------------------------------ sources

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };
const validDate = (d) => {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/**
 * Turn a provider response into plain sources. A source must have an http(s) URL;
 * the date is kept only when the provider supplied a parseable one.
 */
export function normaliseSources(provider, raw, { parameter, queryKey } = {}) {
  let items = [];
  if (provider === 'tavily') {
    items = (raw?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, date: r.published_date, name: null }));
  } else if (provider === 'brave') {
    const list = raw?.web?.results || raw?.results || [];
    items = list.map((r) => ({ title: r.title, url: r.url, snippet: [r.description, ...(r.extra_snippets || [])].filter(Boolean).join(' '), date: r.page_age || null, name: r.profile?.name || r.meta_url?.hostname || null }));
  }
  const out = [];
  for (const it of items) {
    if (!/^https?:\/\//i.test(String(it.url || ''))) continue;
    const snippet = text(String(it.snippet || '').replace(/<[^>]+>/g, ' '), 1200);
    if (!snippet && !it.title) continue;
    out.push({
      title: text(it.title, 200), url: String(it.url).slice(0, 500), source_name: text(it.name, 80) || hostOf(it.url),
      published_date: validDate(it.date), snippet, parameter: parameter || null, query_key: queryKey || null, provider,
    });
  }
  return out;
}

/** De-duplicate by URL, give each source a stable id (S1, S2, ...) in order. */
export function indexSources(sources = []) {
  const seen = new Map();
  for (const s of sources) {
    const key = s.url.replace(/#.*$/, '').replace(/\/$/, '');
    if (!seen.has(key)) seen.set(key, { ...s, parameters: new Set([s.parameter]) });
    else seen.get(key).parameters.add(s.parameter);
  }
  return [...seen.values()].map((s, i) => ({ ...s, id: `S${i + 1}`, parameters: [...s.parameters].filter(Boolean) }));
}

// ----------------------------------------------------------------- findings

const squash = (s) => String(s ?? '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[“”"'‘’]/g, '').trim();

/** True when `quote` appears (whitespace/case/quote-insensitive) in `haystack`. */
export function quoteAppears(quote, haystack) {
  const q = squash(quote);
  return q.length >= 12 && squash(haystack).includes(q);
}

export const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string' },
          source_ids: { type: 'array', items: { type: 'string' } },
          quote: { type: 'string' },
          risk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
        },
        required: ['statement', 'source_ids', 'quote'],
      },
    },
  },
  required: ['findings'],
};

export function buildFindingsPrompt({ parameter, subject, sources }) {
  const list = sources.map((s) => `[${s.id}] ${s.title}\nURL: ${s.url}\nPublished: ${s.published_date || 'date not given'}\nExtract: ${s.snippet}`).join('\n\n');
  return [
    'You are summarising web search results for an investment screening team. Use ONLY the sources listed below. Do not use any other knowledge.',
    `Research parameter: ${parameter.label}. Subject: ${[subject.target, subject.sector, subject.geography].filter(Boolean).join(', ')}.`,
    'For each finding give: a one-sentence statement; the ids of the sources that support it; a quote copied EXACTLY (word for word) from one of those sources\' extracts; and a risk level (none, low, medium, high) for the investment.',
    'If the sources do not address the parameter, return an empty findings list. Never invent a source, a figure or a quote.',
    '', 'SOURCES:', list || '(none)',
  ].join('\n');
}

/**
 * Validate model findings against the sources actually returned.
 *  - unknown source ids are removed; a finding left with none is dropped;
 *  - a quote found verbatim in a cited source makes it verified_evidence;
 *  - otherwise it is kept as ai_inference (still cited, never presented as verified).
 */
export function normaliseFindings(raw, sources, parameter) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out = [];
  const dropped = [];
  for (const f of Array.isArray(raw?.findings) ? raw.findings : []) {
    const statement = text(f?.statement, 400);
    if (!statement) continue;
    const ids = [...new Set((Array.isArray(f.source_ids) ? f.source_ids : []).map(String))].filter((id) => byId.has(id));
    if (!ids.length) { dropped.push(statement); continue; }
    const quote = text(f.quote, 400);
    const hit = quote ? ids.find((id) => quoteAppears(quote, `${byId.get(id).snippet} ${byId.get(id).title}`)) : null;
    const risk = ['low', 'medium', 'high'].includes(f.risk) ? f.risk : 'none';
    out.push({
      parameter: parameter.id, tab: parameter.tab, statement, risk,
      basis: hit ? EVIDENCE.VERIFIED : EVIDENCE.INFERENCE,
      quote: hit ? quote : null,
      sources: ids.map((id) => citation(byId.get(id), id === hit)),
    });
  }
  return { findings: out, dropped_uncited: dropped.length };
}

export function citation(s, supports = false) {
  return { id: s.id, source_name: s.source_name, title: s.title, url: s.url, published_date: s.published_date, supports_quote: Boolean(supports) };
}

/**
 * Without a model, the sources themselves are the evidence: each returned result
 * becomes a verified source excerpt (its own text, its name, URL and date). No
 * statement is composed, so nothing can be wrong in the wording.
 */
export function excerptFindings(sources, parameter) {
  return sources.slice(0, 5).map((s) => ({
    parameter: parameter.id, tab: parameter.tab, statement: s.title || s.source_name, risk: 'none',
    basis: EVIDENCE.VERIFIED, quote: s.snippet.slice(0, 300), excerpt_only: true, sources: [citation(s, true)],
  }));
}

// Words in a source extract that make a result worth a human look as a possible risk.
export const RISK_TERMS = /\b(sanction(?:ed|s)?|fraud|lawsuit|litigation|insolven\w+|bankrupt\w*|investigat\w+|indict\w+|penalt\w+|fined?|money laundering|default(?:ed)?|violation|embezzle\w*|bribery|corruption|blacklist\w*|debar\w*|recall|data breach|strike)\b/i;

/** Flag risk-term hits in sources of a risk parameter, as candidates for review (never as a conclusion). */
export function riskCandidates(sources, parameter) {
  if (!parameter.risk) return [];
  const out = [];
  for (const s of sources) {
    const m = RISK_TERMS.exec(`${s.title} ${s.snippet}`);
    if (m) out.push({ parameter: parameter.id, tab: parameter.tab, term: m[1].toLowerCase(), source: citation(s, true), quote: s.snippet.slice(0, 300), basis: EVIDENCE.VERIFIED, note: 'A risk-related term appears in this source. It may not refer to the target; a reviewer must read the source.' });
  }
  return out;
}

export default { EVIDENCE, DEFAULT_RESEARCH_PARAMETERS, resolveResearchParameters, buildResearchQueries, researchSubject, normaliseSources, indexSources, quoteAppears, FINDINGS_SCHEMA, buildFindingsPrompt, normaliseFindings, excerptFindings, riskCandidates };
