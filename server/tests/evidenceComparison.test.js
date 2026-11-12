import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, classifyDocument, summariseExtraction, tabForSlot } from '../config/documentFacts.js';
import { buildComparison, extractClaims, normaliseComparisonItems, hasNumber } from '../config/comparison.js';
import { buildRecommendation, enhanceRecommendation, normaliseNarrative } from '../config/aiRecommendation.js';
import { computeFinancialModel } from '../config/financialEngine.js';
import { indexSources, normaliseSources } from '../config/researchParameters.js';

test('facts are read only where a labelled figure exists, with their evidence line', () => {
  const text = 'Annual report FY25\nTotal revenue: AED 120 million\nEBITDA margin 29%\nEBITDA AED 35 mn\nEmployees 1,250\nFounded in 1998\nEquity IRR 24.5%\nNothing else here';
  const f = Object.fromEntries(extractFacts(text).map((x) => [x.key, x]));
  assert.equal(f.revenue_last_fy.value, 120);
  assert.equal(f.ebitda_last_fy.value, 35, 'the margin line is skipped');
  assert.equal(f.employees.value, 1250);
  assert.equal(f.founded.value, 1998);
  assert.equal(f.equity_irr.value, 24.5);
  assert.match(f.revenue_last_fy.evidence, /Total revenue/);
  assert.equal(f.revenue_last_fy.field, 'snapshot_revenue_last_fy_aed');
  assert.equal(f.revenue_last_fy.tab, 'opportunity_overview');
  assert.equal(f.moic, undefined, 'a figure that is not there is not invented');
  assert.equal(extractFacts('Revenue AED 1.2 bn').find((x) => x.key === 'revenue_last_fy').value, 1200);
});

test('slots map to tabs, and a document that reads like another slot is flagged', () => {
  assert.equal(tabForSlot('financials'), 'financials');
  assert.equal(tabForSlot('risk_register'), 'risks');
  assert.equal(tabForSlot('nonsense'), null);
  const risky = 'Risk register. Each risk has a likelihood, a mitigation and a risk owner, with residual risk after mitigation. '.repeat(2);
  const c = classifyDocument(risky, 'financials');
  assert.equal(c.matches_slot, false);
  assert.equal(c.best_guess, 'risk_register');
  assert.equal(classifyDocument(risky, 'risk_register').matches_slot, true);
  assert.equal(classifyDocument('short', 'financials').matches_slot, null);
});

const doc = { id: 'd1', original_name: 'report.pdf', requirement_key: 'business_plan' };
const ex = (text, over = {}) => ({ ...summariseExtraction(doc, { status: 'ok', format: 'pdf', text, tables: [], pages: 1, ocr: { used: false }, notes: [], ...over }), text });

test('comparison: a document that disagrees with the form is a discrepancy; agreement is consistent; a blank field is missing information', () => {
  const e = ex('Total revenue: AED 200 million\nEmployees 500\nFounded in 1990');
  const c = buildComparison({ data: { snapshot_revenue_last_fy_aed: 120, snapshot_employees: 500 }, extractions: [e] });
  const items = c.by_tab.opportunity_overview;
  const rev = items.find((i) => /Revenue/.test(i.statement) && i.type === 'discrepancy');
  assert.ok(rev, 'revenue discrepancy');
  assert.equal(rev.severity, 'high');
  assert.equal(rev.basis, 'verified_evidence');
  assert.match(rev.evidence[0].evidence, /Total revenue/);
  assert.ok(items.some((i) => i.type === 'consistent' && /Employees/.test(i.statement)));
  assert.ok(items.some((i) => i.type === 'missing_information' && /Founded/.test(i.statement)));
});

test('comparison: unsupported claims are those whose figures appear in no document and no external source', () => {
  assert.equal(extractClaims('The market is worth AED 5 bn and grows 12% a year. We are good.').length, 1);
  const data = { market_data_evidence: 'The UAE market is worth AED 7500 mn and growing at 14% a year.', rationale_evidence: 'Revenue was 120 mn.' };
  const sources = indexSources(normaliseSources('tavily', { results: [{ title: 'M', url: 'https://a.example.com', content: 'The market grows at 14% a year.' }] }));
  const c = buildComparison({ data, extractions: [ex('Revenue was 120 mn.')], research: { status: 'ok', sources, parameters: [], findings: [], risk_candidates: [] } });
  const un = c.by_tab.rationale.filter((i) => i.type === 'unsupported_claim');
  assert.equal(un.length, 1, 'the 14% and the 120 are found, the 7500 is not');
  assert.match(un[0].statement, /7500/);
  assert.doesNotMatch(un[0].statement, /14 /);
  const c2 = buildComparison({ data: { market_data_evidence: 'The market is worth AED 7500 mn.' }, extractions: [], research: null });
  const u2 = c2.by_tab.rationale.find((i) => i.type === 'unsupported_claim');
  assert.ok(u2);
  assert.equal(u2.basis, 'missing');
  assert.match(u2.note, /External research has not run/);
});

test('comparison: unreadable and low-confidence documents are reported as missing information', () => {
  const bad = { ...summariseExtraction({ id: 'd2', original_name: 'scan.pdf', requirement_key: 'financials' }, { status: 'ocr_unavailable', format: 'pdf', text: '', tables: [], pages: 2, ocr: { used: false }, notes: ['OCR could not run'] }), text: '' };
  const low = { ...summariseExtraction({ id: 'd3', original_name: 'blurry.png', requirement_key: 'market_data' }, { status: 'ocr', format: 'png', text: 'revenue 5 million blurry text here and more words to read', tables: [], pages: 1, ocr: { used: true, confidence: 41 }, notes: [] }), text: 'x' };
  const c = buildComparison({ data: {}, extractions: [bad, low] });
  assert.ok(c.by_tab.financials.some((i) => i.type === 'missing_information' && /could not be read/.test(i.statement)));
  assert.ok(c.by_tab.rationale.some((i) => /low confidence/.test(i.statement)));
});

test('comparison: external risks and research gaps surface per tab with their sources', () => {
  const research = { status: 'ok', sources: [], parameters: [{ id: 'business_market', label: 'Market size and growth', tab: 'rationale', missing: true }],
    findings: [{ parameter: 'risks', tab: 'risks', statement: 'The group faces a court case', risk: 'high', basis: 'verified_evidence', quote: 'court case filed', sources: [{ id: 'S1', url: 'https://x.example.com', source_name: 'X', published_date: '2026-01-01' }] }],
    risk_candidates: [] };
  const c = buildComparison({ data: {}, extractions: [], research });
  assert.ok(c.by_tab.risks.some((i) => i.type === 'risk' && i.severity === 'high' && i.external[0].url === 'https://x.example.com'));
  assert.ok(c.by_tab.rationale.some((i) => i.type === 'missing_information' && i.basis === 'missing'));
  assert.equal(c.counts.risk, 1);
});

test('model comparison items must cite a real source; a verbatim quote makes them verified', () => {
  const sources = indexSources(normaliseSources('tavily', { results: [{ title: 'Market', url: 'https://a.example.com', content: 'The addressable market is AED 3 bn according to the regulator.', published_date: '2026-04-01' }] }));
  const raw = { items: [
    { type: 'discrepancy', statement: 'Market is smaller than claimed', field_key: 'market_data_evidence', source_ids: ['S1'], quote: 'addressable market is AED 3 bn', severity: 'high' },
    { type: 'risk', statement: 'No citation', field_key: 'x', source_ids: ['S5'], quote: 'nope nope nope nope' },
    { type: 'unsupported_claim', statement: 'Paraphrase only', field_key: 'market_data_evidence', source_ids: ['S1'], quote: 'the regulator said something else entirely' },
  ] };
  const out = normaliseComparisonItems(raw, { tabKey: 'rationale', sources, data: { market_data_evidence: 'AED 9 bn market' } });
  assert.equal(out.length, 2);
  assert.equal(out[0].basis, 'verified_evidence');
  assert.equal(out[0].external[0].published_date, '2026-04-01');
  assert.equal(out[1].basis, 'ai_inference');
});

const goBase = () => ({ rating: 'Go', summary: 'ok', conditions: [], rules: [{ label: 'Hard filters', status: 'pass', detail: '5/5' }] });

test('recommendation: evidence can add caution but never upgrade, and never creates a No-Go', () => {
  const fin = computeFinancialModel({ data: { total_commitment_aed: 100, exit_multiple: 8, financials: { ebitda: { y1p: 22, y2p: 25, y3p: 28, y4p: 31, y5p: 35 }, capex: { y1p: 5, y2p: 5, y3p: 5, y4p: 5, y5p: 5 } } }, thresholds: { equity_irr_min: 60, roic_wacc_spread: 5, wacc_pct: 10, payback_max_years: 3.5 } });
  const r = enhanceRecommendation(goBase(), { financials: fin });
  assert.equal(r.rules_rating, 'Go');
  assert.equal(r.rating, 'Conditional Go');
  assert.equal(r.adjusted, true);
  assert.ok(r.evidence_reasons.some((x) => /does not meet/.test(x.text) && x.basis === 'verified_evidence'));
  assert.ok(r.conditions.some((c) => c.key === 'calculated_hurdles'));
  assert.match(r.human_decision_note, /does not decide/);
  // A No-Go from the rules stays a No-Go; a Conditional Go is never raised to Go.
  assert.equal(enhanceRecommendation({ ...goBase(), rating: 'No-Go' }, { financials: fin }).rating, 'No-Go');
  const clean = enhanceRecommendation({ ...goBase(), rating: 'Conditional Go' }, { financials: null, comparison: buildComparison({ data: {} }) });
  assert.equal(clean.rating, 'Conditional Go');
  const none = enhanceRecommendation(goBase(), {});
  assert.equal(none.rating, 'Go');
  assert.equal(none.adjusted, false);
});

test('recommendation: unverified and missing evidence is listed but cannot change the rating', () => {
  const comparison = { by_tab: { rationale: [{ id: 'C1', tab: 'rationale', type: 'unsupported_claim', severity: 'medium', basis: 'ai_inference', statement: 's' }, { id: 'C2', tab: 'risks', type: 'missing_information', severity: 'low', basis: 'missing', statement: 'm' }] } };
  const r = enhanceRecommendation(goBase(), { comparison, research: { status: 'not_configured' } });
  assert.equal(r.rating, 'Go');
  assert.equal(r.evidence_summary.ai_inference, 1);
  assert.ok(r.evidence_reasons.some((x) => /External research did not run/.test(x.text)));
});

test('recommendation: a high-severity verified discrepancy adds a cited condition', () => {
  const comparison = { by_tab: { financials: [{ id: 'C7', tab: 'financials', type: 'discrepancy', severity: 'high', basis: 'verified_evidence', statement: 'Balance sheet does not balance' }] } };
  const r = enhanceRecommendation(goBase(), { comparison });
  assert.equal(r.rating, 'Conditional Go');
  assert.deepEqual(r.evidence_reasons[0].refs, ['C7']);
});

test('the model narrative is accepted only when it cites real reasons', () => {
  const rec = { evidence_reasons: [{ text: 'a', basis: 'verified_evidence' }, { text: 'b', basis: 'missing' }] };
  assert.ok(normaliseNarrative({ narrative: 'Because R1.', evidence_ids: ['R1'] }, rec));
  assert.equal(normaliseNarrative({ narrative: 'Because.', evidence_ids: ['R9'] }, rec), null);
  assert.equal(normaliseNarrative({ narrative: '', evidence_ids: ['R1'] }, rec), null);
  void buildRecommendation;
});

test('a figure is found only as a whole number', () => {
  assert.equal(hasNumber('growth of 14 percent', '14'), true);
  assert.equal(hasNumber('revenue 1400 and 214x', '14'), false);
  assert.equal(hasNumber('rate 14.5 now', '14'), false);
  assert.equal(hasNumber('rate 14.5 now', '14.5'), true);
});
