// ---------------------------------------------------------------------------
// Evidence pipeline end to end: document extraction (PDF, DOCX, scanned PDF with
// OCR), financial calculation, governed web research, comparison and the
// evidence-informed recommendation - and the rule that none of it reaches a
// Preparer. Real routers and database; the model and the search provider are
// stand-ins (their HTTP surface is covered in webResearch.test.js).
// ---------------------------------------------------------------------------
process.env.RATE_LIMIT_DISABLED = '1';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';
process.env.AUTH_ALLOW_HEADER_IDENTITY = '1';
process.env.AI_AUTO_RETRY_MS = '0';
process.env.AI_AUTO_RUN = '0'; // this test drives the pipeline itself

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

let pool; let server; let BASE; let online = false; let ev; let aiReview; let storage;
const SIRIUS = 'deal.lead@sirius.local';
const PREPARER = 'deal.lead@infinia.local';
const OUTSIDER = 'deal.lead@finstreet.local';
const OPP = 'zz-evid-' + crypto.randomBytes(4).toString('hex');
const ORG = 'org-infinia-technologies-limited';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-evid-'));

async function call(p, { method = 'GET', body, as = SIRIUS } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers['x-user-email'] = as;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const offline = (t) => { if (!online) { t.skip('database unavailable'); return true; } return false; };

async function addDoc(id, slot, name, buffer) {
  const filename = `${id}-${name}`;
  fs.writeFileSync(path.join(storage.UPLOAD_DIR, filename), buffer);
  await pool.query(
    `INSERT INTO submission_document (id, opportunity_id, owner_org_id, requirement_key, filename, original_name, mimetype, size, storage, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,'application/octet-stream',$7,'local',$8)`,
    [id, OPP, ORG, slot, filename, name, buffer.length, PREPARER]);
}

before(async () => {
  try {
    process.env.UPLOAD_DIR = dir;
    ({ pool } = await import('../db.js'));
    await pool.query('SELECT 1'); online = true;
  } catch (e) { console.warn('[aiEvidenceApi.test] database unavailable:', e.message); return; }
  storage = await import('../storage.js');
  aiReview = await import('../aiReview.js');
  ev = await import('../aiEvidence.js');
  const { entitiesRouter } = await import('../entities.js');
  const { default: JSZip } = await import('jszip');
  const { Document, Packer, Paragraph, Table, TableRow, TableCell } = await import('docx');
  const { textPdf, imagePdf } = await import('./helpers/pdfFixtures.js');
  const { createCanvas } = await import('@napi-rs/canvas');

  const data = {
    opportunity_name: 'ZZ evidence synthetic', status: 'screening_review', owner_email: PREPARER, submitted_by: PREPARER,
    target_name: 'Acme Medical LLC', sector: 'Healthcare', geography: 'UAE',
    total_commitment_aed: 100, ask_aed: 60, exit_multiple: 8, return_irr_base: 18,
    snapshot_revenue_last_fy_aed: 120, snapshot_employees: 400,
    market_data_evidence: 'The UAE healthcare market is worth AED 9999 mn and grows 17% a year.',
    financials: {
      revenue: { fy1a: 100, y1p: 110, y2p: 121, y3p: 133, y4p: 146, y5p: 161 },
      ebitda: { fy1a: 20, y1p: 22, y2p: 25, y3p: 28, y4p: 31, y5p: 35 },
      capex: { y1p: 5, y2p: 5, y3p: 5, y4p: 5, y5p: 5 },
    },
    scorecard: { scores: { revenue_scale: 4 }, by: SIRIUS },
  };
  await pool.query("INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'DealOpportunity',$2,$3,$4,$4)", [OPP, ORG, JSON.stringify(data), PREPARER]);

  // 1. A text PDF whose revenue disagrees with the form (AED 200 mn vs 120).
  await addDoc(OPP + '-d1', 'business_plan', 'plan.pdf', textPdf([
    { y: 780, parts: [{ x: 50, text: 'Business plan' }] },
    { y: 750, parts: [{ x: 50, text: 'Total revenue: AED 200 million' }] },
    { y: 730, parts: [{ x: 50, text: 'Employees 400' }] }]));
  // 2. A scanned PDF (image only): needs OCR.
  const c = createCanvas(900, 260); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 260); g.fillStyle = '#000'; g.font = '44px sans-serif'; g.fillText('Market size AED 9999 mn', 20, 140);
  await addDoc(OPP + '-d2', 'market_data', 'scan.pdf', imagePdf(c.toBuffer('image/jpeg', 90), 900, 260));
  // 3. A DOCX with a statement table (period headers) for the integrity checks.
  const cell = (t) => new TableCell({ children: [new Paragraph(String(t))] });
  const hdr = ['Line item', 'FY-1 A', 'Y1 P'];
  const rows = [hdr, ['Total assets', 220, 240], ['Total liabilities', 120, 130], ['Total equity', 100, 105], ['EBITDA', 20, 22], ['Net income', 12, 14]];
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Financial model'), new Table({ rows: rows.map((r) => new TableRow({ children: r.map(cell) })) })] }] }));
  await addDoc(OPP + '-d3', 'financials', 'model.docx', docx);
  void JSZip;

  const app = express(); app.use(express.json());
  app.use('/api/ai-review', aiReview.aiReviewRouter);
  app.use('/api/entities', entitiesRouter);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  BASE = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (online) {
    const { shutdownOcr } = await import('../documentExtract.js'); await shutdownOcr();
    await pool.query('DELETE FROM submission_document WHERE opportunity_id = $1', [OPP]).catch(() => {});
    await pool.query("DELETE FROM entity_record WHERE id = $1 OR data->>'opportunity_id' = $1 OR id LIKE $2", [OPP, `air-${OPP}-%`]);
    await pool.query("DELETE FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' IN ('financial_engine','research_parameters') AND created_by = $1", [SIRIUS]).catch(() => {});
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (pool) await pool.end();
});

const ACTOR = { email: SIRIUS, roles: ['sirius_deal_lead'], membership: [] };
const researchStub = (status = 'ok') => async ({ data }) => ({
  status, provider: 'tavily', subject: { target: data.target_name }, ran_at: new Date().toISOString(), message: null,
  queries_sent: ['"Acme Medical LLC" news'], answered: 1, total: 9,
  parameters: [
    { id: 'business_market', label: 'Business and market', tab: 'rationale', status: 'ok', missing: false, source_ids: ['S1'], counts: { verified: 1, inference: 0 }, synthesis: 'ai' },
    { id: 'risks', label: 'Risks', tab: 'risks', status: 'no_results', missing: true, source_ids: [], counts: { verified: 0, inference: 0 } },
  ],
  sources: [{ id: 'S1', title: 'UAE healthcare market', url: 'https://r.example.com/m', source_name: 'r.example.com', published_date: '2026-02-10', snippet: 'The UAE healthcare market is expected to reach AED 4000 mn by 2030.', parameters: ['market_size_growth'] }],
  findings: [{ parameter: 'business_market', tab: 'rationale', statement: 'Market about AED 4 bn', risk: 'none', basis: 'verified_evidence', quote: 'expected to reach AED 4000 mn by 2030', sources: [{ id: 'S1', url: 'https://r.example.com/m', source_name: 'r.example.com', published_date: '2026-02-10' }] }],
  risk_candidates: [],
});

describe('the evidence pipeline (Sirius)', () => {
  test('extracts text PDF, scanned PDF (OCR) and DOCX tables, with facts mapped to tabs', async (t) => {
    if (offline(t)) return;
    ev.setEvidenceDeps({ isAiConfigured: () => false, runExternalResearch: researchStub('not_configured') });
    const out = await ev.runEvidence(OPP, ACTOR, { steps: ['extraction'] });
    assert.equal(out.steps.extraction, 'ok');
    const r = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.data.extractions.map((e) => [e.name, e]));
    assert.equal(by['plan.pdf'].status, 'ok');
    assert.equal(by['plan.pdf'].tab, 'opportunity_overview');
    assert.ok(by['plan.pdf'].facts.some((f) => f.key === 'revenue_last_fy' && f.value === 200 && /Total revenue/.test(f.evidence)));
    assert.equal(by['scan.pdf'].status, 'ocr');
    assert.equal(by['scan.pdf'].ocr.used, true);
    assert.ok(by['scan.pdf'].ocr.confidence > 50);
    assert.equal(by['model.docx'].status, 'ok');
    assert.ok(by['model.docx'].tables >= 1);
    assert.equal(r.data.extractions.every((e) => e.text === undefined), true, 'the response carries no raw text');
  });

  test('calculates returns, runs the statement integrity checks and applies the hurdles', async (t) => {
    if (offline(t)) return;
    await ev.runEvidence(OPP, ACTOR, { steps: ['financials'] });
    const { data } = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    const f = data.financials;
    assert.equal(f.calculated, true);
    assert.ok(f.scenarios.base.equity_irr > 0);
    assert.ok(f.scenarios.upside.equity_irr > f.scenarios.downside.equity_irr);
    assert.ok(f.assumptions.length >= 3);
    assert.equal(f.statement_source, 'model.docx', 'the model table was read from the DOCX');
    const bs = f.integrity.checks.find((c) => c.id === 'bs_balance');
    assert.equal(bs.status, 'fail', 'the model table does not balance (220 vs 120 + 100 = 220 in FY-1, 240 vs 235 in Y1)');
    assert.ok(f.hurdles.rows.length >= 3);
    assert.ok(f.vs_submitted.some((v) => v.metric === 'equity_irr' && v.scenario === 'base'));
  });

  test('research without a provider records "not configured" and invents nothing', async (t) => {
    if (offline(t)) return;
    ev.setEvidenceDeps({ runExternalResearch: (await import('../webResearch.js')).runExternalResearch });
    delete process.env.RESEARCH_PROVIDER; delete process.env.RESEARCH_API_KEY;
    await ev.runEvidence(OPP, ACTOR, { steps: ['research'] });
    const { data } = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    assert.equal(data.research.status, 'not_configured');
    assert.deepEqual(data.research.findings, []);
    assert.equal(data.capabilities.web_search_configured, false);
  });

  test('comparison and recommendation: discrepancies, unsupported claims and cautions are evidence-backed', async (t) => {
    if (offline(t)) return;
    ev.setEvidenceDeps({ isAiConfigured: () => false, runExternalResearch: researchStub('ok') });
    await ev.runEvidence(OPP, ACTOR, { steps: ['research', 'comparison'] });
    const { data } = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    const c = data.comparison;
    const overview = c.by_tab.opportunity_overview;
    const rev = overview.find((i) => i.type === 'discrepancy' && /Revenue/.test(i.statement));
    assert.ok(rev, 'the PDF says AED 200 mn, the form says 120');
    assert.equal(rev.basis, 'verified_evidence');
    assert.equal(rev.evidence[0].ref, 'plan.pdf');
    assert.ok(overview.some((i) => i.type === 'consistent' && /Employees/.test(i.statement)));
    // 9999 is in the scanned PDF (OCR) so that claim is supported; the 17% appears nowhere.
    const claims = c.by_tab.rationale.filter((i) => i.type === 'unsupported_claim');
    assert.ok(claims.some((i) => i.unsupported_figures.includes('17')));
    assert.ok(!claims.some((i) => i.unsupported_figures.includes('9999')), 'a figure found by OCR counts as supported');
    assert.ok(c.by_tab.risks.some((i) => i.type === 'missing_information' && i.basis === 'missing'), 'a parameter with no sources is reported as a gap');
    assert.ok(c.by_tab.financials.some((i) => i.type === 'discrepancy' && i.severity === 'high'), 'unbalanced statements');
    assert.equal(c.sources_checked.external_research_ran, true);
    const rec = data.recommendation;
    assert.equal(rec.evidence_available, true);
    assert.ok(['Conditional Go', 'No-Go'].includes(rec.rating));
    assert.ok(rec.evidence_reasons.length >= 1);
    assert.match(rec.human_decision_note, /does not decide/);
  });

  test('re-reading never calls the model, and stale flags follow the submission', async (t) => {
    if (offline(t)) return;
    let calls = 0;
    ev.setEvidenceDeps({ isAiConfigured: () => true, callLLM: async () => { calls += 1; return {}; } });
    const a = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    const b = await call(`/api/ai-review/opportunities/${OPP}/recommendation`);
    assert.equal(calls, 0);
    assert.equal(a.data.financials.stale, false);
    assert.equal(b.status, 200);
    assert.equal(b.data.recommendation.evidence_available, true);
    await pool.query("UPDATE entity_record SET data = jsonb_set(data,'{total_commitment_aed}','150') WHERE id = $1", [OPP]);
    const c = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    assert.equal(c.data.financials.stale, true);
    await pool.query("UPDATE entity_record SET data = jsonb_set(data,'{total_commitment_aed}','100') WHERE id = $1", [OPP]);
  });

  test('a reviewer scoring the deal does not make the evidence stale', async (t) => {
    if (offline(t)) return;
    await pool.query("UPDATE entity_record SET data = jsonb_set(data,'{scorecard,scores,revenue_scale}','2') WHERE id = $1", [OPP]);
    const r = await call(`/api/ai-review/opportunities/${OPP}/evidence`);
    assert.equal(r.data.financials.stale, false);
  });

  test('the model narrative must cite real reasons; the rating is never the model\'s', async (t) => {
    if (offline(t)) return;
    ev.setEvidenceDeps({ isAiConfigured: () => true, callLLM: async () => ({ narrative: 'Because R1 the financial statements do not tie out.', evidence_ids: ['R1'] }) });
    const before = (await call(`/api/ai-review/opportunities/${OPP}/recommendation`)).data.recommendation;
    await ev.runEvidence(OPP, ACTOR, { steps: ['recommendation'] });
    const after = (await call(`/api/ai-review/opportunities/${OPP}/recommendation`)).data.recommendation;
    assert.equal(after.rating, before.rating);
    assert.equal(after.narrative.basis, 'ai_inference');
    ev.setEvidenceDeps({ callLLM: async () => ({ narrative: 'Uncited prose', evidence_ids: ['R99'] }) });
    await ev.runEvidence(OPP, ACTOR, { steps: ['recommendation'] });
    const kept = (await call(`/api/ai-review/opportunities/${OPP}/recommendation`)).data.recommendation;
    assert.ok(kept.narrative, 'an invalid narrative does not replace the stored valid one');
  });

  test('admin-only configuration: flexes and research parameters', async (t) => {
    if (offline(t)) return;
    const get = await call('/api/ai-review/engine-config');
    assert.equal(get.status, 200);
    assert.equal(get.data.research_parameters.length, 9);
    assert.equal(get.data.financial_engine.scenarios.downside.ebitda_pct, -25);
    const denied = await call('/api/ai-review/engine-config', { method: 'PUT', body: { financial_engine: { tax_rate_pct: 10 } } });
    assert.equal(denied.status, 403);
  });
});

describe('a Preparer reaches none of it', () => {
  for (const as of [PREPARER, OUTSIDER]) {
    test(`evidence routes are 403 for ${as}`, async (t) => {
      if (offline(t)) return;
      for (const [method, p, body] of [
        ['GET', `/opportunities/${OPP}/evidence`], ['POST', `/opportunities/${OPP}/evidence/run`, {}],
        ['GET', '/engine-config'], ['PUT', '/engine-config', { financial_engine: { tax_rate_pct: 1 } }], ['GET', `/opportunities/${OPP}/recommendation`],
      ]) {
        const r = await call('/api/ai-review' + p, { method, body, as });
        assert.equal(r.status, 403, `${method} ${p} as ${as}`);
      }
    });
  }

  test('the entity API refuses the stored extraction, research and comparison rows to every role', async (t) => {
    if (offline(t)) return;
    const mine = await call(`/api/entities/AIReviewResult?opportunity_id=${OPP}`, { as: PREPARER });
    assert.equal(mine.status, 403);
    const sirius = await call(`/api/entities/AIReviewResult`, { as: SIRIUS });
    assert.equal(sirius.status, 403, 'closed to every role; the evidence is served by /api/ai-review');
  });

  test('extraction never alters the submission: documents and data are unchanged', async (t) => {
    if (offline(t)) return;
    const { rows } = await pool.query("SELECT data FROM entity_record WHERE id = $1", [OPP]);
    assert.equal(rows[0].data.target_name, 'Acme Medical LLC');
    const docs = await pool.query('SELECT count(*)::int AS n FROM submission_document WHERE opportunity_id = $1 AND deleted = false', [OPP]);
    assert.equal(docs.rows[0].n, 3);
  });
});
