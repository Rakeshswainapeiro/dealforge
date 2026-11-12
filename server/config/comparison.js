// ---------------------------------------------------------------------------
// Submitted information versus uploaded documents and external research.
//
// Pure. Produces evidence-backed findings, grouped by submission tab, of five
// kinds: discrepancy, unsupported_claim, missing_information, risk, consistent.
// Every finding states what the Preparer submitted, what the evidence says, and
// its basis (verified_evidence | ai_inference | missing) so a reviewer can see
// how much weight it carries. The deterministic rules need no model; an optional
// model pass adds semantic comparisons that must still cite real sources.
// ---------------------------------------------------------------------------

import { AI_TABS, tabFields } from './aiReview.js';
import { EVIDENCE, quoteAppears, citation } from './researchParameters.js';

export const FINDING_TYPES = ['discrepancy', 'unsupported_claim', 'missing_information', 'risk', 'consistent'];
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
export const COMPARISON_TOLERANCE_PCT = Number(process.env.COMPARISON_TOLERANCE_PCT || 5);

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/[,\s]/g, '') : v);
  return Number.isFinite(n) ? n : null;
};
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const labelOf = (key) => {
  for (const t of AI_TABS) { const f = tabFields(t.key).find((x) => x.key === key); if (f) return f.label; }
  return key;
};

let seq = 0;
function item(partial) { seq += 1; return { id: `C${seq}`, severity: 'medium', ...partial }; }

// --------------------------------------------------- submitted vs documents

function documentFacts(extractions, data) {
  const out = [];
  for (const ex of extractions) {
    for (const f of ex.facts || []) {
      const submitted = data[f.field];
      const doc = { kind: 'document', ref: ex.name, document_id: ex.document_id, value: f.value, unit: f.unit, evidence: f.evidence, page: f.page || null };
      if (blank(submitted)) {
        out.push(item({ tab: f.tab, type: 'missing_information', severity: 'low', basis: EVIDENCE.VERIFIED,
          statement: `${f.label} is not filled in on the form, but ${ex.name} states ${f.raw}.`,
          submitted: { kind: 'field', ref: f.field, label: labelOf(f.field), value: null }, evidence: [doc] }));
        continue;
      }
      if (f.key === 'founded' || typeof submitted === 'string' && num(submitted) === null) continue;
      const s = num(submitted); if (s === null) continue;
      const diffPct = s === 0 ? (f.value === 0 ? 0 : 100) : (Math.abs(f.value - s) / Math.abs(s)) * 100;
      const submittedRef = { kind: 'field', ref: f.field, label: labelOf(f.field), value: s };
      if (diffPct > COMPARISON_TOLERANCE_PCT) {
        out.push(item({ tab: f.tab, type: 'discrepancy', severity: diffPct > 25 ? 'high' : 'medium', basis: EVIDENCE.VERIFIED,
          statement: `${f.label}: the form says ${s}${f.unit ? ' ' + f.unit : ''} but ${ex.name} says ${f.value}${f.unit ? ' ' + f.unit : ''} (${Math.round(diffPct)}% apart).`,
          submitted: submittedRef, evidence: [doc] }));
      } else {
        out.push(item({ tab: f.tab, type: 'consistent', severity: 'info', basis: EVIDENCE.VERIFIED,
          statement: `${f.label} on the form matches ${ex.name}.`, submitted: submittedRef, evidence: [doc] }));
      }
    }
  }
  return out;
}

function documentQuality(extractions) {
  const out = [];
  for (const ex of extractions) {
    const tab = ex.tab || 'documents';
    if (!ex.readable && ex.status !== 'unsupported') {
      out.push(item({ tab, type: 'missing_information', severity: ex.requirement_key ? 'medium' : 'low', basis: EVIDENCE.MISSING,
        statement: `${ex.name} could not be read (${ex.status.replace(/_/g, ' ')}). ${ex.notes?.[0] || ''}`.trim(), submitted: { kind: 'document', ref: ex.name, document_id: ex.document_id }, evidence: [] }));
    } else if (ex.low_confidence) {
      out.push(item({ tab, type: 'missing_information', severity: 'medium', basis: EVIDENCE.MISSING,
        statement: `${ex.name} was read by OCR with low confidence (${ex.ocr.confidence}%), so its figures are unreliable.`, submitted: { kind: 'document', ref: ex.name, document_id: ex.document_id }, evidence: [] }));
    }
    if (ex.content_check && ex.content_check.matches_slot === false) {
      out.push(item({ tab, type: 'discrepancy', severity: 'low', basis: EVIDENCE.INFERENCE,
        statement: `${ex.name}: ${ex.content_check.note}`, submitted: { kind: 'document', ref: ex.name, document_id: ex.document_id, label: ex.requirement_key }, evidence: [] }));
    }
  }
  return out;
}

// -------------------------------------------------------- unsupported claims

// A claim is a sentence in a narrative field that states a quantity: a percentage,
// a money amount or a multiple.
const CLAIM_RE = /([^.!?\n]*?(?:\b\d[\d,]*(?:\.\d+)?\s*(?:%|bn|billion|mn|million|x\b)|\bAED\s*\d[\d,]*(?:\.\d+)?|\$\s*\d[\d,]*(?:\.\d+)?)[^.!?\n]*[.!?]?)/gi;
const UNIT_NUMBER = /(?:AED|\$)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:%|bn|billion|mn|million|x\b)/gi;

export function extractClaims(text) {
  const out = [];
  for (const m of String(text || '').matchAll(CLAIM_RE)) {
    const s = m[1].trim();
    // Only figures that carry a unit (%, AED, $, bn, mn, x) are claims; "last 18 months" is not.
    const nums = [...s.matchAll(UNIT_NUMBER)].map((x) => (x[1] || x[2]).replace(/,/g, '')).filter((n) => n.length >= 2 || n.includes('.'));
    if (s.length >= 20 && nums.length) out.push({ sentence: s.slice(0, 300), numbers: nums });
  }
  return out.slice(0, 8);
}

const NARRATIVE_FIELDS = ['rationale_evidence', 'market_data_evidence', 'comparable_transactions', 'strategic_objective', 'narrative_what', 'narrative_why_now', 'narrative_why_us', 'exec_summary_headline_value'];

// A figure counts as present only as a whole number (14 is not found inside 1400 or 2026-02-14).
export function hasNumber(haystack, n) {
  return new RegExp(`(?<![\\d.])${String(n).replace(/\./g, '\\.')}(?![\\d]|\\.\\d)`).test(haystack);
}

function unsupportedClaims(data, extractions, research, researchRan) {
  const corpus = [
    ...extractions.map((e) => ({ kind: 'document', text: e.text || '' })),
    ...(research?.sources || []).map((s) => ({ kind: 'external', text: `${s.title} ${s.snippet}` })),
  ];
  const haystack = corpus.map((c) => c.text).join(' ').replace(/,/g, '');
  const out = [];
  for (const key of NARRATIVE_FIELDS) {
    const tab = AI_TABS.find((t) => tabFields(t.key).some((f) => f.key === key))?.key;
    if (!tab || blank(data[key])) continue;
    for (const claim of extractClaims(data[key])) {
      // Each figure is checked on its own: a sentence is only as supported as its weakest number.
      const unsupported = claim.numbers.filter((n) => !hasNumber(haystack, n));
      if (!unsupported.length) continue;
      out.push(item({ tab, type: 'unsupported_claim', severity: 'medium', basis: EVIDENCE.MISSING,
        statement: `"${claim.sentence}" — ${unsupported.join(', ')} ${unsupported.length === 1 ? 'does' : 'do'} not appear in the uploaded documents${researchRan ? ' or in the external sources found' : ''}.`,
        submitted: { kind: 'field', ref: key, label: labelOf(key), value: claim.sentence }, evidence: [], unsupported_figures: unsupported,
        note: researchRan ? 'Searched submitted documents and external research.' : 'External research has not run; only the uploaded documents were searched.' }));
    }
  }
  return out;
}

// ------------------------------------------------------------- research gaps

function researchItems(research) {
  const out = [];
  if (!research || !['ok', 'no_results', 'rate_limited', 'not_approved', 'unauthorised'].includes(research.status)) return out;
  for (const p of research.parameters || []) {
    if (p.missing) {
      out.push(item({ tab: p.tab, type: 'missing_information', severity: 'low', basis: EVIDENCE.MISSING,
        statement: `External research found nothing usable on "${p.label}".`, submitted: null, evidence: [], parameter: p.id }));
    }
  }
  for (const f of research.findings || []) {
    if (f.risk === 'high' || f.risk === 'medium') {
      out.push(item({ tab: f.tab, type: 'risk', severity: f.risk, basis: f.basis,
        statement: f.statement, submitted: null, evidence: [], external: f.sources, quote: f.quote, parameter: f.parameter }));
    }
  }
  const covered = new Set(out.filter((o) => o.type === 'risk').flatMap((o) => (o.external || []).map((s) => s.id)));
  for (const c of research.risk_candidates || []) {
    if (covered.has(c.source.id)) continue;
    out.push(item({ tab: c.tab, type: 'risk', severity: 'medium', basis: EVIDENCE.VERIFIED,
      statement: `A source mentions "${c.term}" in connection with this research topic. ${c.note}`, submitted: null, evidence: [], external: [c.source], quote: c.quote, parameter: c.parameter, needs_review: true }));
  }
  return out;
}

// ------------------------------------------------------------ financial model

function financialItems(fin, data) {
  const out = [];
  if (!fin) return out;
  for (const c of fin.integrity?.checks || []) {
    if (c.status === 'fail') out.push(item({ tab: 'financials', type: 'discrepancy', severity: 'high', basis: EVIDENCE.VERIFIED, statement: `${c.label}: ${c.detail}`, submitted: { kind: 'document', ref: 'Three-statement model / Financials grid' }, evidence: [{ kind: 'calculation', ref: c.id, details: c.evidence }] }));
  }
  // Plausibility warnings (advisory). Older stored results have no `sanity` block.
  for (const c of fin.sanity?.checks || []) {
    if (c.status !== 'warn' && c.status !== 'info') continue;
    const isIntegrity = c.group === 'integrity';
    out.push(item({ tab: 'financials', type: isIntegrity ? 'discrepancy' : 'risk',
      severity: c.status === 'info' ? 'low' : (isIntegrity ? 'low' : 'medium'), basis: EVIDENCE.VERIFIED,
      statement: `${c.label}: ${c.detail}`, submitted: { kind: 'document', ref: 'Financials grid / projections' },
      evidence: [{ kind: 'calculation', ref: c.id, details: c.evidence }] }));
  }
  for (const v of fin.vs_submitted || []) {
    if (!v.like_for_like || !v.material) continue;
    out.push(item({ tab: 'financials', type: 'discrepancy', severity: 'medium', basis: EVIDENCE.VERIFIED,
      statement: `${v.metric.replace(/_/g, ' ')} (base): the form says ${v.submitted}${v.unit}, but the submitted projections calculate to ${v.calculated}${v.unit}.`,
      submitted: { kind: 'field', ref: v.metric, value: v.submitted }, evidence: [{ kind: 'calculation', ref: `${v.metric}:${v.scenario}`, calculated: v.calculated, tolerance: v.tolerance }] }));
  }
  for (const f of fin.hurdles?.flags || []) {
    if (f.reason === 'below_hurdle') out.push(item({ tab: 'financials', type: 'risk', severity: f.scenario === 'base' ? 'high' : 'medium', basis: EVIDENCE.VERIFIED, statement: `Calculated ${f.message}`, submitted: null, evidence: [{ kind: 'calculation', ref: `${f.key}:${f.scenario}`, value: f.value, threshold: f.threshold }] }));
  }
  if (fin.survivable_downside?.survivable === false) {
    out.push(item({ tab: 'financials', type: 'risk', severity: 'high', basis: EVIDENCE.VERIFIED, statement: 'The downside case is not survivable on the submitted projections (EBITDA, cumulative free cash flow or leverage fails).', submitted: null, evidence: [{ kind: 'calculation', ref: 'survivable_downside', details: fin.survivable_downside }] }));
  }
  if (!fin.calculated && fin.missing?.length) {
    out.push(item({ tab: 'financials', type: 'missing_information', severity: 'medium', basis: EVIDENCE.MISSING, statement: `Returns could not be calculated: missing ${fin.missing.join('; ')}.`, submitted: null, evidence: [] }));
  }
  void data;
  return out;
}

// ------------------------------------------------------------- model pass

export const COMPARISON_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    type: { type: 'string', enum: ['discrepancy', 'unsupported_claim', 'risk', 'consistent'] },
    statement: { type: 'string' }, field_key: { type: 'string' },
    source_ids: { type: 'array', items: { type: 'string' } }, quote: { type: 'string' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
  }, required: ['type', 'statement', 'field_key', 'source_ids', 'quote'] } } },
  required: ['items'],
};

export function buildComparisonPrompt({ tabKey, data, sources }) {
  const tab = AI_TABS.find((t) => t.key === tabKey);
  const fields = tabFields(tabKey).filter((f) => !blank(data[f.key])).map((f) => `- ${f.key} (${f.label}): ${String(data[f.key]).slice(0, 500)}`).join('\n');
  const src = sources.map((s) => `[${s.id}] ${s.title} (${s.published_date || 'date not given'}): ${s.snippet}`).join('\n');
  return [
    'Compare what the Preparer submitted with the external sources below. Use ONLY the submitted fields and the listed sources.',
    `Tab: ${tab?.label || tabKey}.`,
    'Report only: a discrepancy (a submitted claim the sources contradict), an unsupported claim (a specific submitted claim the sources do not support), a risk the sources reveal, or a consistent point. Each item must cite source ids and give a quote copied exactly from one of those sources. If there is nothing to report, return an empty list.',
    '', 'SUBMITTED:', fields || '(nothing submitted on this tab)', '', 'EXTERNAL SOURCES:', src || '(none)',
  ].join('\n');
}

export function normaliseComparisonItems(raw, { tabKey, sources, data }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out = [];
  for (const r of Array.isArray(raw?.items) ? raw.items : []) {
    if (!FINDING_TYPES.includes(r?.type) || r.type === 'missing_information') continue;
    const ids = [...new Set((Array.isArray(r.source_ids) ? r.source_ids : []).map(String))].filter((id) => byId.has(id));
    const statement = String(r.statement || '').trim().slice(0, 500);
    if (!statement || !ids.length) continue;       // an uncited comparison is not evidence
    const hit = r.quote ? ids.find((id) => quoteAppears(r.quote, `${byId.get(id).snippet} ${byId.get(id).title}`)) : null;
    const field = r.field_key && !blank(data[r.field_key]) ? r.field_key : null;
    out.push(item({
      tab: tabKey, type: r.type, severity: r.type === 'consistent' ? 'info' : (['high', 'medium', 'low'].includes(r.severity) ? r.severity : 'medium'),
      basis: hit ? EVIDENCE.VERIFIED : EVIDENCE.INFERENCE, statement,
      submitted: field ? { kind: 'field', ref: field, label: labelOf(field), value: String(data[field]).slice(0, 300) } : null,
      evidence: [], external: ids.map((id) => citation(byId.get(id), id === hit)), quote: hit ? String(r.quote).slice(0, 400) : null,
    }));
  }
  return out;
}

// ------------------------------------------------------------------- assemble

/**
 * Build the comparison. `extractions` = [{...summary, text}], `research` = the
 * runExternalResearch result (or null), `financials` = computeFinancialModel
 * output (or null), `modelItems` = normalised model comparison items.
 */
export function buildComparison({ data = {}, extractions = [], research = null, financials = null, modelItems = [] } = {}) {
  seq = 0;
  const researchRan = Boolean(research && ['ok', 'no_results'].includes(research.status) && (research.sources || []).length > 0);
  const items = [
    ...documentFacts(extractions, data),
    ...documentQuality(extractions),
    ...unsupportedClaims(data, extractions, research, researchRan),
    ...researchItems(research),
    ...financialItems(financials, data),
    ...modelItems.map((m) => ({ ...m, id: `C${++seq}` })),
  ];
  const byTab = {};
  for (const t of AI_TABS) byTab[t.key] = [];
  for (const it of items) (byTab[it.tab] || (byTab[it.tab] = [])).push(it);
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  for (const k of Object.keys(byTab)) byTab[k].sort((a, b) => order[a.severity] - order[b.severity]);
  const count = (fn) => items.filter(fn).length;
  return {
    by_tab: byTab,
    counts: {
      discrepancy: count((i) => i.type === 'discrepancy'), unsupported_claim: count((i) => i.type === 'unsupported_claim'),
      missing_information: count((i) => i.type === 'missing_information'), risk: count((i) => i.type === 'risk'), consistent: count((i) => i.type === 'consistent'),
      verified_evidence: count((i) => i.basis === EVIDENCE.VERIFIED), ai_inference: count((i) => i.basis === EVIDENCE.INFERENCE), missing: count((i) => i.basis === EVIDENCE.MISSING),
    },
    sources_checked: { documents: extractions.filter((e) => e.readable).length, external_sources: research?.sources?.length || 0, external_research_ran: researchRan },
  };
}

export default { FINDING_TYPES, buildComparison, extractClaims, buildComparisonPrompt, normaliseComparisonItems, COMPARISON_SCHEMA };
