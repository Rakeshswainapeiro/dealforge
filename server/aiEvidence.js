import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { rateLimit } from './security.js';
import { evaluateGate, listDocuments } from './gate.js';
import { loadOpportunity } from './qa.js';
import { callLLM, isAiConfigured } from './integrations.js';
import { getEffectiveTheme, getThresholds } from './themes.js';
import { UPLOAD_DIR, getObjectBuffer } from './storage.js';
import { readXlsx } from './xlsxRead.js';
import { loadPortfolioRegisterConfig } from './portfolioRegister.js';
import { isAdmin } from './config/workflowStates.js';
import { INTERNAL_OPPORTUNITY_FIELDS } from './config/aiVisibility.js';
import { AI_REVIEW_ENTITY, AI_TABS, tabFields } from './config/aiReview.js';
import { extractDocument, EXTRACTABLE_EXTENSIONS } from './documentExtract.js';
import { summariseExtraction } from './config/documentFacts.js';
import { parseStatementLines } from './config/statementModel.js';
import { resolveWacc } from './config/wacc.js';
import {
  computeFinancialModel, resolveEngineConfig, validateEngineConfig, FINANCIAL_ENGINE_SETTING_KEY,
} from './config/financialEngine.js';
import { resolveResearchParameters, RESEARCH_SETTING_KEY, FINDINGS_SCHEMA } from './config/researchParameters.js';
import { isResearchConfigured, researchConfig, runExternalResearch } from './webResearch.js';
import {
  buildComparison, buildComparisonPrompt, normaliseComparisonItems, COMPARISON_SCHEMA,
} from './config/comparison.js';
import {
  buildRecommendation, enhanceRecommendation, RECOMMENDATION_NARRATIVE_SCHEMA, buildNarrativePrompt, normaliseNarrative,
} from './config/aiRecommendation.js';

// ---------------------------------------------------------------------------
// Internal evidence pipeline (Sirius Investment Team only).
//
//   extraction  -> text/tables/OCR from every submitted document, facts per tab
//   financials  -> IRR / ROIC / MOIC / payback, three scenarios, statement integrity
//   research    -> governed web search over the research parameters, with citations
//   comparison  -> submitted fields + documents vs external research, per tab
//   recommendation -> deterministic rating, evidence added as caution only
//
// Results are stored as AIReviewResult rows (kinds extraction | financials |
// research | comparison | narrative, tab "__opp__"), which are already internal:
// the entity API refuses them to a Preparer, and this router sits behind the same
// Sirius-only guard as the rest of /api/ai-review. Nothing here is read by the
// submission gate or changes the submission workflow.
// ---------------------------------------------------------------------------

export const OPP_TAB = '__opp__';
const TEXT_EXT = ['.txt', '.md', '.csv', '.tsv', '.json'];
const STORED_TEXT_CHARS = 120_000;

export const evidenceRouter = express.Router();

const deps = { callLLM, isAiConfigured, runExternalResearch };
export function setEvidenceDeps(overrides = {}) { Object.assign(deps, overrides); }

const evidenceLimit = rateLimit({ name: 'ai-evidence', windowMs: 60_000, max: Number(process.env.AI_RATE_LIMIT_MAX || 30), message: 'Too many AI requests; try again shortly.' });
const running = new Set();
export const isEvidenceRunning = (id) => running.has(id);

const idFor = (oppId, kind, suffix = '') => `air-${oppId}-${OPP_TAB}-${kind}${suffix ? '-' + suffix : ''}`;

async function save(opp, kind, payload, actor, suffix = '') {
  const id = idFor(opp.id, kind, suffix);
  // tab and kind are set last: a payload field of the same name (a document's own tab) must not displace them.
  const data = { opportunity_id: opp.id, ...payload, tab: OPP_TAB, kind };
  await pool.query(
    `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, deleted = false, updated_date = now(), updated_by = EXCLUDED.updated_by`,
    [id, AI_REVIEW_ENTITY, opp.owner_org_id, JSON.stringify(data), actor.email]
  );
  return { id, ...data };
}

// Stored extractions keep the document's own tab as doc_tab (tab itself is the opportunity-level marker).
const fromStored = (r) => (r.kind === 'extraction' ? { ...r, tab: r.doc_tab ?? null } : r);

async function loadKind(oppId, kind) {
  const { rows } = await pool.query(
    "SELECT id, data FROM entity_record WHERE entity = $1 AND deleted = false AND data->>'opportunity_id' = $2 AND data->>'tab' = $3 AND data->>'kind' = $4",
    [AI_REVIEW_ENTITY, oppId, OPP_TAB, kind]
  );
  return rows.map((r) => fromStored({ id: r.id, ...r.data }));
}

// ------------------------------------------------------------ settings (admin)

async function loadSetting(key) {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS v FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1", [key]);
    return rows[0]?.v ? JSON.parse(rows[0].v) : null;
  } catch { return null; }
}

async function saveSetting(key, value, description, actor) {
  const payload = { setting_key: key, setting_value: JSON.stringify(value), description, last_updated_by: actor.email };
  const { rows } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1", [key]);
  if (rows[0]) {
    await pool.query('UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1', [rows[0].id, JSON.stringify(payload), actor.email]);
  } else {
    await pool.query("INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
      [`${key}-${Date.now().toString(36)}`, actor.org_id || null, JSON.stringify(payload), actor.email]);
  }
}

// --------------------------------------------------------------- documents

async function docBuffer(doc) {
  if (doc.object_key) return getObjectBuffer(doc.object_key);
  const file = path.join(UPLOAD_DIR, path.basename(doc.filename || ''));
  if (!doc.filename || !fs.existsSync(file)) return null;
  return fs.promises.readFile(file);
}

const extOf = (doc) => path.extname(doc.original_name || doc.filename || '').toLowerCase();
const skipDoc = (doc) => doc.scan_verdict === 'infected' || String(doc.requirement_key || '').startsWith('qa_attachment:');

// Text and tables of one document. PDF/DOCX/PPTX/images use the extractor (with
// OCR for scans); text files and .xlsx are read directly. Cached per document id
// (a new upload is a new id), so a document is read once.
export async function getExtraction(opp, doc, { actor, force = false } = {}) {
  if (skipDoc(doc)) return null;
  const ext = extOf(doc);
  const supported = EXTRACTABLE_EXTENSIONS.includes(ext) || TEXT_EXT.includes(ext) || ext === '.xlsx';
  if (!supported) return null;
  if (!force) {
    const hit = (await loadKind(opp.id, 'extraction')).find((r) => r.document_id === doc.id);
    if (hit) return hit;
  }
  const buffer = await docBuffer(doc);
  let extraction;
  if (!buffer) extraction = { status: 'unreadable', format: ext.slice(1), text: '', tables: [], pages: 0, ocr: { used: false, confidence: null, pages: 0, lang: null }, notes: ['The stored file could not be found.'] };
  else if (EXTRACTABLE_EXTENSIONS.includes(ext)) extraction = await extractDocument({ buffer, filename: doc.original_name || doc.filename, mimetype: doc.mimetype });
  else if (ext === '.xlsx') {
    try {
      const rows = await readXlsx(buffer);
      extraction = { status: rows.length ? 'ok' : 'empty', format: 'xlsx', text: rows.slice(0, 400).map((r) => r.join(' | ')).join('\n'), tables: rows.length ? [{ index: 1, rows: rows.slice(0, 400) }] : [], pages: 1, ocr: { used: false, confidence: null, pages: 0, lang: null }, notes: [] };
    } catch { extraction = { status: 'unreadable', format: 'xlsx', text: '', tables: [], pages: 0, ocr: { used: false, confidence: null, pages: 0, lang: null }, notes: ['The workbook could not be read.'] }; }
  } else {
    const text = buffer.toString('utf8').slice(0, 200_000);
    extraction = { status: text.trim() ? 'ok' : 'empty', format: ext.slice(1), text, tables: [], pages: 1, ocr: { used: false, confidence: null, pages: 0, lang: null }, notes: [] };
  }
  const summary = summariseExtraction(doc, extraction);
  return save(opp, 'extraction', {
    ...summary, doc_tab: summary.tab, text: extraction.text.slice(0, STORED_TEXT_CHARS),
    table_rows: extraction.tables.slice(0, 12).map((t) => ({ ...t, rows: t.rows.slice(0, 200) })),
    extracted_at: new Date().toISOString(),
  }, actor || { email: 'system@dealforge.ai-review' }, doc.id);
}

/** Just the text, for the model prompts (aiReview readSnippet). Null when unreadable. */
export async function getExtractedText(opp, doc, actor) {
  try {
    const ex = await getExtraction(opp, doc, { actor });
    return ex && ex.readable ? ex.text : null;
  } catch { return null; }
}

export async function runExtraction(opp, documents, actor, { force = false } = {}) {
  const out = [];
  for (const d of documents) {
    try { const ex = await getExtraction(opp, d, { actor, force }); if (ex) out.push(ex); } catch (err) { console.warn('[evidence] extraction failed:', d.original_name, err.message); }
  }
  return out;
}

// ---------------------------------------------------------------- financials

function gridFromTables(tables) {
  // A table whose first row names the model periods can be read as statement lines.
  for (const t of tables || []) { const lines = parseStatementLines({ grid: t.rows }); if (lines.length >= 3) return lines; }
  return [];
}

async function statementLinesFor(opp, documents, actor) {
  const slots = documents.filter((d) => ['financials', 'returns_model'].includes(d.requirement_key) && !skipDoc(d));
  for (const d of slots) {
    const ext = extOf(d);
    if (['.csv', '.tsv', '.json', '.txt'].includes(ext)) {
      const buf = await docBuffer(d).catch(() => null);
      const lines = buf ? parseStatementLines({ buffer: buf, filename: d.original_name || d.filename, mimetype: d.mimetype }) : [];
      if (lines.length >= 3) return { lines, source: d.original_name };
    } else {
      const ex = await getExtraction(opp, d, { actor }).catch(() => null);
      const lines = gridFromTables(ex?.table_rows);
      if (lines.length >= 3) return { lines, source: d.original_name };
    }
  }
  return { lines: [], source: null };
}

// Only what the Preparer submitted: a reviewer's own scoring must not make the evidence look stale.
function submittedOnly(data = {}) { const d = { ...data }; for (const k of INTERNAL_OPPORTUNITY_FIELDS) delete d[k]; return d; }

function inputHash(data, documents) {
  const canon = JSON.stringify({ data: submittedOnly(data), docs: documents.map((d) => d.id).sort() }, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => { a[x] = v[x]; return a; }, {}) : v));
  return crypto.createHash('sha1').update(canon).digest('hex').slice(0, 16);
}

export async function runFinancials(opp, documents, actor) {
  const data = opp.data || {};
  const thresholds = await getThresholds(opp.owner_org_id).catch(() => ({}));
  const wacc = resolveWacc(data, { orgWacc: thresholds?.wacc_pct ?? null });
  const { lines, source } = await statementLinesFor(opp, documents, actor);
  const config = resolveEngineConfig(await loadSetting(FINANCIAL_ENGINE_SETTING_KEY));
  const model = computeFinancialModel({ data, lines, thresholds, wacc, config });
  return save(opp, 'financials', { ...model, statement_source: source, statement_lines: lines.length, input_hash: inputHash(data, documents), ran_at: new Date().toISOString(), ran_by: actor.email }, actor);
}

// The same engine run as runFinancials, for the Financials-tab validation: it
// reuses the engine, the stored engine settings and the uploaded model's statement
// lines, but saves nothing. It never throws: a failure comes back as { error } and
// the caller reports "not run" (review), never a pass.
export async function evaluateFinancialsForReview(opp, documents, actor) {
  try {
    const data = opp.data || {};
    const thresholds = await getThresholds(opp.owner_org_id).catch(() => ({}));
    const wacc = resolveWacc(data, { orgWacc: thresholds?.wacc_pct ?? null });
    const { lines } = await statementLinesFor(opp, documents, actor);
    const config = resolveEngineConfig(await loadSetting(FINANCIAL_ENGINE_SETTING_KEY));
    return computeFinancialModel({ data, lines, thresholds, wacc, config });
  } catch (err) {
    return { error: err.message };
  }
}

// ------------------------------------------------------------------ research

const llmAdapter = () => ({ isConfigured: () => deps.isAiConfigured(), call: (args) => deps.callLLM(args) });

export async function runResearch(opp, documents, actor) {
  const data = opp.data || {};
  const parametersConfig = await loadSetting(RESEARCH_SETTING_KEY);
  const result = await deps.runExternalResearch({ data, actor, llm: llmAdapter(), parametersConfig });
  return save(opp, 'research', { ...result, input_hash: inputHash({ t: data.target_name, s: data.sector, g: data.geography }, []), ran_by: actor.email }, actor);
}

// ---------------------------------------------------------------- comparison

export async function runComparison(opp, documents, actor) {
  const data = opp.data || {};
  const extractions = (await loadKind(opp.id, 'extraction')).filter((e) => documents.some((d) => d.id === e.document_id));
  const research = (await loadKind(opp.id, 'research'))[0] || null;
  const financials = (await loadKind(opp.id, 'financials'))[0] || null;
  // Optional model pass: per tab, submitted fields vs the external sources found for it.
  let modelItems = []; let modelStatus = 'not_run';
  if (research?.sources?.length && deps.isAiConfigured()) {
    modelStatus = 'ok';
    for (const t of AI_TABS) {
      const params = (research.parameters || []).filter((p) => p.tab === t.key && !p.missing).map((p) => p.id);
      const sources = research.sources.filter((s) => (s.parameters || []).some((p) => params.includes(p)));
      if (!sources.length || !tabFields(t.key).some((f) => data[f.key])) continue;
      try {
        const raw = await deps.callLLM({ prompt: buildComparisonPrompt({ tabKey: t.key, data, sources }), response_json_schema: COMPARISON_SCHEMA, actor });
        modelItems.push(...normaliseComparisonItems(raw, { tabKey: t.key, sources, data }));
      } catch (err) { modelStatus = err.status === 403 ? 'not_approved' : 'unavailable'; break; }
    }
  } else if (research?.sources?.length) modelStatus = 'not_configured';
  const comparison = buildComparison({ data, extractions, research, financials, modelItems });
  return save(opp, 'comparison', { ...comparison, model_status: modelStatus, input_hash: inputHash(data, documents), ran_at: new Date().toISOString(), ran_by: actor.email }, actor);
}

// ------------------------------------------------------------ recommendation

async function baseRecommendation(opp) {
  const theme = await getEffectiveTheme(opp.owner_org_id).catch(() => null);
  const register = await loadPortfolioRegisterConfig().catch(() => null);
  const gate = await evaluateGate(opp, { orgId: opp.owner_org_id, theme, portfolio: register?.companies || null });
  return buildRecommendation(gate);
}

export async function buildEvidenceRecommendation(opp) {
  const base = await baseRecommendation(opp);
  const [financials, comparison, research, narrative] = await Promise.all(['financials', 'comparison', 'research', 'narrative'].map((k) => loadKind(opp.id, k).then((r) => r[0] || null)));
  if (!financials && !comparison && !research) return { ...base, evidence_available: false };
  const rec = { ...enhanceRecommendation(base, { financials, comparison, research }), evidence_available: true };
  if (narrative?.narrative && narrative.rating === rec.rating) rec.narrative = narrative.narrative;
  return rec;
}

export async function runNarrative(opp, actor) {
  if (!deps.isAiConfigured()) return null;
  const rec = await buildEvidenceRecommendation(opp);
  if (!rec.evidence_available) return null;
  try {
    const raw = await deps.callLLM({ prompt: buildNarrativePrompt(rec), response_json_schema: RECOMMENDATION_NARRATIVE_SCHEMA, actor });
    const n = normaliseNarrative(raw, rec);
    if (!n) return null;
    return save(opp, 'narrative', { narrative: n, rating: rec.rating, ran_by: actor.email, ran_at: new Date().toISOString() }, actor);
  } catch { return null; }
}

// ------------------------------------------------------------------ pipeline

export const EVIDENCE_STEPS = ['extraction', 'financials', 'research', 'comparison', 'recommendation'];

/** Run the evidence pipeline for one opportunity. Each step is isolated: one failing never stops the next. */
export async function runEvidence(opportunityId, actor, { steps = EVIDENCE_STEPS, trigger = 'manual', force = false } = {}) {
  if (running.has(opportunityId)) return { skipped: true, reason: 'already_running' };
  running.add(opportunityId);
  const summary = { steps: {} };
  try {
    const { rows } = await pool.query("SELECT * FROM entity_record WHERE entity = 'DealOpportunity' AND id = $1 AND deleted = false", [opportunityId]);
    const opp = rows[0];
    if (!opp) return { skipped: true, reason: 'not_found' };
    const runActor = { ...actor, org_id: opp.owner_org_id };
    const documents = (await listDocuments(opp.id, { currentOnly: true })).filter((d) => !skipDoc(d));
    const step = async (name, fn) => {
      if (!steps.includes(name)) return;
      try { const out = await fn(); summary.steps[name] = out?.status || 'ok'; } catch (err) { summary.steps[name] = 'error'; console.warn(`[evidence] ${name} failed:`, err.message); }
    };
    await step('extraction', () => runExtraction(opp, documents, runActor, { force }));
    await step('financials', () => runFinancials(opp, documents, runActor));
    await step('research', () => runResearch(opp, documents, runActor));
    await step('comparison', () => runComparison(opp, documents, runActor));
    await step('recommendation', () => runNarrative(opp, runActor));
    await writeAudit({ entity: 'DealOpportunity', entityId: opp.id, action: 'ai_evidence_run', actor: runActor, orgId: opp.owner_org_id, after: { trigger, steps: summary.steps } }).catch(() => {});
    return summary;
  } finally { running.delete(opportunityId); }
}

// ---------------------------------------------------------------------- API

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

const publicExtraction = (row) => ({ ...row, text: undefined, table_rows: undefined, text_chars: row.text?.length || 0 });

// GET /api/ai-review/opportunities/:id/evidence
evidenceRouter.get('/opportunities/:id/evidence', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    const documents = (await listDocuments(opp.id, { currentOnly: true })).filter((d) => !skipDoc(d));
    const currentHash = inputHash(opp.data || {}, documents);
    const [extractions, financials, research, comparison] = await Promise.all(['extraction', 'financials', 'research', 'comparison'].map((k) => loadKind(opp.id, k)));
    const live = extractions.filter((e) => documents.some((d) => d.id === e.document_id));
    const stale = (r) => (r ? r.input_hash !== currentHash && r.kind !== 'research' : null);
    res.json({
      opportunity_id: opp.id, running: running.has(opp.id),
      extractions: live.map(publicExtraction),
      documents_total: documents.length,
      financials: financials[0] ? { ...financials[0], stale: stale(financials[0]) } : null,
      research: research[0] || null,
      comparison: comparison[0] ? { ...comparison[0], stale: stale(comparison[0]) } : null,
      recommendation: await buildEvidenceRecommendation(opp),
      capabilities: {
        web_search_configured: isResearchConfigured(), web_search_provider: researchConfig().provider,
        model_configured: deps.isAiConfigured(),
        ocr_languages: process.env.OCR_LANGS || 'eng',
      },
    });
  } catch (err) { sendErr(res, err); }
});

// POST /api/ai-review/opportunities/:id/evidence/run  { steps?: [...], force?: bool }
evidenceRouter.post('/opportunities/:id/evidence/run', evidenceLimit, async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (running.has(opp.id)) return res.status(202).json({ started: false, already_running: true });
    const steps = Array.isArray(req.body?.steps) ? req.body.steps.filter((s) => EVIDENCE_STEPS.includes(s)) : EVIDENCE_STEPS;
    setImmediate(() => {
      runEvidence(opp.id, req.actor, { steps, trigger: 'manual', force: req.body?.force === true })
        .catch((err) => console.warn('[evidence] run failed:', err.message));
    });
    res.status(202).json({ started: true, steps });
  } catch (err) { sendErr(res, err); }
});

// GET/PUT engine config and research parameters (Sirius-configurable; PUT admin only).
evidenceRouter.get('/engine-config', async (req, res) => {
  try {
    res.json({
      financial_engine: resolveEngineConfig(await loadSetting(FINANCIAL_ENGINE_SETTING_KEY)),
      research_parameters: resolveResearchParameters(await loadSetting(RESEARCH_SETTING_KEY)),
      can_configure: isAdmin(req.actor),
    });
  } catch (err) { sendErr(res, err); }
});

evidenceRouter.put('/engine-config', async (req, res) => {
  try {
    if (!isAdmin(req.actor)) return res.status(403).json({ error: 'Administrator role required to change the financial engine or research parameters' });
    const { financial_engine: fe, research_parameters: rp } = req.body || {};
    if (fe !== undefined) {
      const check = validateEngineConfig(fe);
      if (!check.ok) return res.status(400).json({ error: 'Invalid financial engine configuration', errors: check.errors });
      await saveSetting(FINANCIAL_ENGINE_SETTING_KEY, fe, 'Financial engine scenario flexes and ROIC assumptions', req.actor);
    }
    if (rp !== undefined) {
      if (!Array.isArray(rp)) return res.status(400).json({ error: 'research_parameters must be an array' });
      await saveSetting(RESEARCH_SETTING_KEY, rp.map((p) => ({ id: p?.id, label: p?.label, terms: p?.terms, enabled: p?.enabled })), 'External research parameters', req.actor);
    }
    await writeAudit({ entity: 'ai_governance', entityId: 'evidence_config', action: 'ai_evidence_config_updated', actor: req.actor, orgId: req.actor.org_id, after: { financial_engine: fe !== undefined, research_parameters: rp !== undefined } });
    res.json({
      financial_engine: resolveEngineConfig(await loadSetting(FINANCIAL_ENGINE_SETTING_KEY)),
      research_parameters: resolveResearchParameters(await loadSetting(RESEARCH_SETTING_KEY)),
    });
  } catch (err) { sendErr(res, err); }
});

void FINDINGS_SCHEMA;
export default evidenceRouter;
