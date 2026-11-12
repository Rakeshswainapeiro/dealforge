// ---------------------------------------------------------------------------
// Facts read from submitted documents, mapped to the submission tabs.
//
// Pure. Input is the output of documentExtract.extractDocument() plus the
// document row (its slot, i.e. requirement_key). Output is a list of facts, each
// with the verbatim text it was read from, so a reviewer can check it. A fact is
// only produced when a labelled figure is found; nothing is inferred.
// ---------------------------------------------------------------------------

import { AI_TABS } from './aiReview.js';

// Figures that map onto a form field. `pattern` finds the label; the value is the
// first number that follows within ~40 characters on the same line.
export const FACT_SPECS = [
  { key: 'revenue_last_fy', field: 'snapshot_revenue_last_fy_aed', tab: 'opportunity_overview', label: 'Revenue (last FY)', unit: 'AED mn', pattern: /\b(?:total\s+)?revenue\b|\bturnover\b|\bnet sales\b/i },
  { key: 'ebitda_last_fy', field: 'snapshot_ebitda_last_fy_aed', tab: 'opportunity_overview', label: 'EBITDA (last FY)', unit: 'AED mn', pattern: /\bebitda\b/i, avoid: /margin|%\s*of/i },
  { key: 'employees', field: 'snapshot_employees', tab: 'opportunity_overview', label: 'Employees', unit: '', pattern: /\b(?:employees|headcount|staff)\b/i, count: true },
  { key: 'founded', field: 'snapshot_founded', tab: 'opportunity_overview', label: 'Founded', unit: 'year', pattern: /\b(?:founded|established|incorporated)\b(?:\s+in)?/i, year: true },
  { key: 'equity_irr', field: 'return_irr_base', tab: 'financials', label: 'Equity IRR (base)', unit: '%', pattern: /\b(?:equity\s+)?irr\b/i },
  { key: 'roic', field: 'return_roic_base', tab: 'financials', label: 'ROIC (base)', unit: '%', pattern: /\broic\b/i },
  { key: 'payback', field: 'return_payback_years', tab: 'financials', label: 'Payback (years)', unit: 'yrs', pattern: /\bpayback\b/i },
  { key: 'moic', field: 'return_moic_base', tab: 'financials', label: 'MOIC (base)', unit: 'x', pattern: /\bmoic\b|\bmultiple of invested capital\b/i },
  { key: 'exit_multiple', field: 'exit_multiple', tab: 'financials', label: 'Exit multiple', unit: 'x', pattern: /\bexit\s+(?:ev\/ebitda\s+)?multiple\b/i },
  { key: 'entry_valuation', field: 'entry_valuation_aed', tab: 'financials', label: 'Entry valuation', unit: 'AED mn', pattern: /\b(?:entry|enterprise|equity)\s+(?:valuation|value)\b/i },
  { key: 'total_commitment', field: 'total_commitment_aed', tab: 'funding', label: 'Total commitment', unit: 'AED mn', pattern: /\btotal\s+(?:commitment|investment|funding)\b/i },
  { key: 'ask', field: 'ask_aed', tab: 'funding', label: 'Ask from Sirius', unit: 'AED mn', pattern: /\b(?:ask|request(?:ed)?\s+(?:from|to)\s+sirius|sirius\s+(?:ask|contribution|investment))\b/i },
];

const NUM = /(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(bn|billion|m(?:n|m|illion)?|k|thousand|%|x)?/i;

function parseNumber(raw, suffix, unit) {
  let n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const s = String(suffix || '').toLowerCase();
  if (unit === 'AED mn') { if (/^(bn|billion)$/.test(s)) n *= 1000; else if (/^(k|thousand)$/.test(s)) n /= 1000; }
  return n;
}

const SNIP = 220;

/** Find labelled figures in one block of text. First credible hit per spec wins. */
export function extractFacts(text) {
  const facts = [];
  const lines = String(text || '').split(/\n/);
  for (const spec of FACT_SPECS) {
    for (const line of lines) {
      const m = spec.pattern.exec(line);
      if (!m) continue;
      if (spec.avoid && spec.avoid.test(line)) continue;
      const after = line.slice(m.index + m[0].length, m.index + m[0].length + 60);
      let value = null; let raw = null;
      if (spec.year) {
        const y = /\b(1[89]\d{2}|20\d{2})\b/.exec(after);
        if (y) { value = Number(y[1]); raw = y[1]; }
      } else {
        const n = NUM.exec(after.replace(/^[\s:=|\-–—()a-z]*?(?=[-\d])/i, ''));
        if (n) { value = parseNumber(n[1], n[2], spec.unit); raw = n[0].trim(); }
      }
      if (value === null) continue;
      if (spec.count && (value < 1 || value > 5_000_000)) continue;
      facts.push({ key: spec.key, field: spec.field, tab: spec.tab, label: spec.label, unit: spec.unit, value, raw, evidence: line.trim().slice(0, SNIP) });
      break;
    }
  }
  return facts;
}

// The slot a document is uploaded to -> its tab.
export function tabForSlot(requirementKey) {
  const hit = AI_TABS.find((t) => Array.isArray(t.docs) && t.docs.includes(requirementKey));
  return hit ? hit.key : null;
}

// What each slot's content normally talks about. Used to notice a document that
// reads like it belongs in another slot; a hint for review, never a verdict.
export const SLOT_KEYWORDS = {
  financials: ['revenue', 'ebitda', 'net income', 'balance sheet', 'cash flow', 'profit and loss', 'total assets'],
  returns_model: ['irr', 'roic', 'payback', 'moic', 'scenario', 'downside', 'upside'],
  risk_register: ['risk register', 'likelihood', 'mitigation', 'risk owner', 'residual risk'],
  business_plan: ['business plan', 'strategy', 'go-to-market', 'milestones', 'operating model'],
  market_data: ['market size', 'cagr', 'market share', 'competitors', 'industry'],
  cap_table: ['cap table', 'shareholder', 'shares', 'ownership', 'dilution'],
  funding_plan: ['sources and uses', 'funding', 'tranche', 'capital structure', 'drawdown'],
  compliance_screen: ['sanctions', 'kyc', 'aml', 'screening', 'adverse media', 'pep'],
  due_diligence_report: ['due diligence', 'findings', 'legal', 'tax', 'commercial dd'],
  execution_plan: ['timeline', 'workstream', 'closing', 'integration', 'milestone'],
};

export function classifyDocument(text, requirementKey) {
  const t = String(text || '').toLowerCase();
  if (t.length < 80) return { slot: requirementKey, matches_slot: null, scores: {}, note: 'Too little readable text to judge the content.' };
  const scores = {};
  for (const [slot, words] of Object.entries(SLOT_KEYWORDS)) scores[slot] = words.filter((w) => t.includes(w)).length;
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const own = scores[requirementKey];
  if (own === undefined) return { slot: requirementKey, matches_slot: null, scores, note: 'No content profile is defined for this slot.' };
  const mismatch = best[1] >= 3 && best[0] !== requirementKey && best[1] >= own + 2;
  return {
    slot: requirementKey, matches_slot: !mismatch, best_guess: best[0], scores,
    note: mismatch ? `The text reads more like ${best[0].replace(/_/g, ' ')} than ${requirementKey.replace(/_/g, ' ')}. A reviewer should confirm it is in the right slot.` : null,
  };
}

/**
 * One document's extraction summary for storage and display: status, quality,
 * the tab it belongs to, the facts read from it and a content check. The full
 * text is kept separately (capped) for the comparison and the model prompts.
 */
export function summariseExtraction(doc, extraction) {
  const facts = extraction.status === 'ok' || extraction.status === 'ocr' ? extractFacts(extraction.text) : [];
  const tab = tabForSlot(doc.requirement_key);
  const usable = ['ok', 'ocr'].includes(extraction.status) && extraction.text.trim().length > 0;
  return {
    document_id: doc.id, name: doc.original_name || doc.filename, requirement_key: doc.requirement_key || null, tab,
    status: extraction.status, format: extraction.format, pages: extraction.pages, chars: extraction.text.length,
    tables: extraction.tables.length, ocr: extraction.ocr, notes: extraction.notes,
    readable: usable,
    low_confidence: Boolean(extraction.ocr?.used && extraction.ocr.confidence !== null && extraction.ocr.confidence < 60),
    content_check: usable ? classifyDocument(extraction.text, doc.requirement_key) : null,
    facts: facts.map((f) => ({ ...f, tab: f.tab, document_id: doc.id, document: doc.original_name || doc.filename })),
  };
}

export default { FACT_SPECS, extractFacts, tabForSlot, classifyDocument, summariseExtraction };
