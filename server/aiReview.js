import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { rateLimit } from './security.js';
import { evaluateGate, listDocuments } from './gate.js';
import { loadOpportunity } from './qa.js';
import { callLLM, isAiConfigured } from './integrations.js';
import { loadSiriusMandateConfig } from './mandate.js';
import { loadStrategyCorpus, searchStrategyCorpus } from './strategy.js';
import { getEffectiveTheme } from './themes.js';
import { UPLOAD_DIR, getObjectBuffer } from './storage.js';
import { readXlsx } from './xlsxRead.js';
import {
  AI_REVIEW_ENTITY, AI_REVIEW_MESSAGES, AI_TAB_KEYS, DOC_SNIPPET_CHARS, VALIDATION_SCHEMA,
  tabByKey, tabDocuments, buildTabContext, hashTabInputs, runDeterministicChecks,
  buildValidationPrompt, normaliseValidation, overallStatus, presentResult,
  ANALYSIS_SCHEMA, QA_SCHEMA, SUGGESTED_QUESTIONS, buildAnalysisPrompt, normaliseAnalysis,
  buildQaPrompt, normaliseQa, checkQuestion, embeddedInstructionsCheck, isDuplicateQuestion, appendQaTurns, presentQa,
} from './config/aiReview.js';

// ---------------------------------------------------------------------------
// Per-tab AI review API (/api/ai-review).
//
// Phase 1: validation. A run does two things on one tab of one opportunity:
//   1. rule-based checks (completeness, tie-outs) from the gate result - exact;
//   2. model checks (right document in each slot, mandate fit, consistency) -
//      through the same governed call path as every other AI feature, so the
//      provider-approval gate, prompt redaction and call log all apply.
//
// Results are advisory: they are stored and shown, never read by the submission
// gate. Access follows the opportunity: whoever may view it may run and read the
// review, and the review is scoped to the opportunity's owning org. Each result
// carries a hash of the tab's inputs, so the API marks it stale the moment the
// tab (or its documents) changes.
// ---------------------------------------------------------------------------

export const aiReviewRouter = express.Router();

// The model call and its "is a backend configured" probe, held in one object so
// the integration tests can stand in for the provider. Production never changes it.
const deps = { callLLM, isAiConfigured };
export function setAiDeps(overrides = {}) { Object.assign(deps, overrides); }

// One Q&A turn at a time per (opportunity, tab, person). A second request for the
// same thread waits for the first, so a double submit or two quick questions can
// neither duplicate a turn nor overwrite each other's. (In-process: with several
// server instances this would need a database advisory lock.)
const threadLocks = new Map();
async function withThreadLock(key, fn) {
  const run = (threadLocks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  threadLocks.set(key, run);
  try { return await run; } finally { if (threadLocks.get(key) === run) threadLocks.delete(key); }
}

const aiReviewLimit = rateLimit({
  name: 'ai-review', windowMs: 60_000,
  max: Number(process.env.AI_RATE_LIMIT_MAX || 30),
  message: 'Too many AI requests; try again shortly.',
});

aiReviewRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

function requireTab(tab) {
  if (!tabByKey(tab)) {
    const e = new Error(AI_REVIEW_MESSAGES.unknown_tab); e.status = 400; throw e;
  }
  return tab;
}

// A Q&A thread is private to its asker: the kind carries a short hash of the email.
const qaKind = (actor) => 'qa-' + crypto.createHash('sha1').update(String(actor.email).toLowerCase()).digest('hex').slice(0, 10);

const resultId = (opportunityId, tab, kind) => `air-${opportunityId}-${tab}-${kind}`;

// Documents are read only to give the model something to judge: text-like files
// and .xlsx are read, other formats are judged on name and type. Infected files
// and Q&A attachments are never read.
async function readSnippet(doc) {
  try {
    if (doc.scan_verdict === 'infected') return null;
    if (String(doc.requirement_key || '').startsWith('qa_attachment:')) return null;
    const ext = path.extname(doc.original_name || doc.filename || '').toLowerCase();
    const textLike = ['.txt', '.md', '.csv', '.tsv', '.json'].includes(ext);
    if (!textLike && ext !== '.xlsx') return null;
    let buffer;
    if (doc.object_key) buffer = await getObjectBuffer(doc.object_key);
    else {
      const file = path.join(UPLOAD_DIR, path.basename(doc.filename || ''));
      if (!doc.filename || !fs.existsSync(file)) return null;
      buffer = await fs.promises.readFile(file);
    }
    if (ext === '.xlsx') {
      const rows = await readXlsx(buffer);
      return rows.slice(0, 60).map((r) => r.join(' | ')).join('\n').slice(0, DOC_SNIPPET_CHARS);
    }
    return buffer.toString('utf8').slice(0, DOC_SNIPPET_CHARS);
  } catch {
    return null;
  }
}

// Everything a run reads about one opportunity, loaded once.
async function loadReviewInputs(opp) {
  const data = opp.data || {};
  const theme = await getEffectiveTheme(opp.owner_org_id).catch(() => null);
  const [gate, documents] = await Promise.all([
    evaluateGate(opp, { orgId: opp.owner_org_id, theme }),
    listDocuments(opp.id, { currentOnly: true }),
  ]);
  const visibleDocs = documents.filter((d) => !String(d.requirement_key || '').startsWith('qa_attachment:'));
  return { data, gate, documents: visibleDocs, theme };
}

// The material a model call on one tab reads: that tab's documents (read where
// the format allows), the Sirius strategy passages nearest the tab's text and
// the mandate. Nothing outside the opportunity's own org scope is loaded.
async function gatherMaterial(opp, tab, { data, documents, theme }) {
  const snippets = {};
  for (const d of tabDocuments(tab, documents)) snippets[d.id] = await readSnippet(d);
  const corpus = await loadStrategyCorpus(opp.owner_org_id).catch(() => ({ passages: [] }));
  const ctx = buildTabContext(tab, data);
  const query = ctx.fields.map((f) => (typeof f.value === 'string' ? f.value : '')).join(' ').slice(0, 1500);
  const passages = searchStrategyCorpus(corpus, query, { limit: 4 });
  const mandate = await loadSiriusMandateConfig().catch(() => null);
  return { snippets, passages, mandate, theme };
}

async function saveResult({ opp, tab, kind, payload, actor }) {
  const id = resultId(opp.id, tab, kind);
  const data = { opportunity_id: opp.id, tab, kind, ...payload };
  // One atomic statement: concurrent first runs on the same tab cannot collide.
  await pool.query(
    `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, deleted = false, updated_date = now(), updated_by = EXCLUDED.updated_by`,
    [id, AI_REVIEW_ENTITY, opp.owner_org_id, JSON.stringify(data), actor.email]
  );
  return { id, ...data };
}

async function loadResults(opportunityId) {
  const { rows } = await pool.query(
    "SELECT id, data FROM entity_record WHERE entity = $1 AND deleted = false AND data->>'opportunity_id' = $2",
    [AI_REVIEW_ENTITY, opportunityId]
  );
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

// POST /api/ai-review/opportunities/:id/validate  { tab, trigger? }
// Runs validation on one tab and returns the stored result.
aiReviewRouter.post('/opportunities/:id/validate', aiReviewLimit, async (req, res) => {
  try {
    const tab = requireTab(req.body?.tab);
    const trigger = req.body?.trigger === 'auto_save' ? 'auto_save' : 'manual';
    const opp = await loadOpportunity(req.params.id, req.actor);
    const { data, gate, documents, theme } = await loadReviewInputs(opp);
    const inputHash = hashTabInputs(tab, data, documents);

    const ruleChecks = runDeterministicChecks(tab, { data, gate });
    let aiChecks = [];
    let aiStatus = 'ok';
    if (!deps.isAiConfigured()) {
      aiStatus = 'not_configured';
    } else {
      try {
        const material = await gatherMaterial(opp, tab, { data, documents, theme });
        const embedded = embeddedInstructionsCheck([
          ...buildTabContext(tab, data).fields.map((f) => ({ where: f.label, text: typeof f.value === 'string' ? f.value : '' })),
          ...tabDocuments(tab, documents).map((d) => ({ where: d.original_name, text: material.snippets[d.id] || '' })),
        ]);
        if (embedded) ruleChecks.push(embedded);
        const prompt = buildValidationPrompt({ tabKey: tab, data, documents, ruleChecks, ...material });
        const raw = await deps.callLLM({ prompt, response_json_schema: VALIDATION_SCHEMA, actor: req.actor });
        aiChecks = normaliseValidation(raw, tab, tabDocuments(tab, documents), ruleChecks);
      } catch (err) {
        // A provider that is unapproved, unreachable or answers badly never
        // fails the run: the rule-based checks stand and the card says why.
        aiStatus = err.status === 403 ? 'not_approved' : err.status === 429 ? 'rate_limited' : 'unavailable';
        console.warn('[ai-review] model check failed:', err.message);
      }
    }

    const checks = [...ruleChecks, ...aiChecks];
    const saved = await saveResult({
      opp, tab, kind: 'validation', actor: req.actor,
      payload: {
        status: overallStatus(checks), checks, ai_status: aiStatus,
        input_hash: inputHash, ran_at: new Date().toISOString(), ran_by: req.actor.email, trigger,
      },
    });
    // The audit row records that a run happened and its outcome, not the content.
    await writeAudit({
      entity: 'DealOpportunity', entityId: opp.id, action: 'ai_validation_run',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { tab, trigger, status: saved.status, ai_status: aiStatus, checks: checks.length },
    });
    res.json({ result: presentResult(saved, inputHash) });
  } catch (err) { sendErr(res, err); }
});

// POST /api/ai-review/opportunities/:id/analyse  { tab }
// "AI research" on one tab: reads only that tab, its documents and the Sirius
// strategy library. Needs the model; with none configured it says so.
aiReviewRouter.post('/opportunities/:id/analyse', aiReviewLimit, async (req, res) => {
  try {
    const tab = requireTab(req.body?.tab);
    const opp = await loadOpportunity(req.params.id, req.actor);
    const { data, gate, documents, theme } = await loadReviewInputs(opp);
    const inputHash = hashTabInputs(tab, data, documents);
    let analysis = null;
    let aiStatus = 'ok';
    if (!deps.isAiConfigured()) {
      aiStatus = 'not_configured';
    } else {
      try {
        const material = await gatherMaterial(opp, tab, { data, documents, theme });
        const ruleChecks = runDeterministicChecks(tab, { data, gate });
        const prompt = buildAnalysisPrompt({ tabKey: tab, data, documents, ruleChecks, ...material });
        const raw = await deps.callLLM({ prompt, response_json_schema: ANALYSIS_SCHEMA, actor: req.actor });
        analysis = normaliseAnalysis(raw, { tabKey: tab, documents, passages: material.passages, data, snippets: material.snippets });
      } catch (err) {
        aiStatus = err.status === 403 ? 'not_approved' : err.status === 429 ? 'rate_limited' : 'unavailable';
        console.warn('[ai-review] analysis failed:', err.message);
      }
    }
    // A failed run never replaces a good earlier analysis; the earlier one is
    // returned with the reason this run failed.
    if (!analysis && aiStatus !== 'not_configured') {
      const prev = (await loadResults(opp.id)).find((r) => r.tab === tab && r.kind === 'analysis' && r.analysis);
      if (prev) {
        await writeAudit({
          entity: 'DealOpportunity', entityId: opp.id, action: 'ai_analysis_run',
          actor: req.actor, orgId: opp.owner_org_id, after: { tab, ai_status: aiStatus, kept_previous: true },
        });
        return res.json({ result: presentResult(prev, inputHash), run_error: aiStatus });
      }
    }
    const saved = await saveResult({
      opp, tab, kind: 'analysis', actor: req.actor,
      payload: {
        status: analysis?.recommendation?.rating || null, analysis, ai_status: aiStatus,
        input_hash: inputHash, ran_at: new Date().toISOString(), ran_by: req.actor.email, trigger: 'manual',
      },
    });
    await writeAudit({
      entity: 'DealOpportunity', entityId: opp.id, action: 'ai_analysis_run',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { tab, ai_status: aiStatus, rating: analysis?.recommendation?.rating || null, items: analysis?.items?.length || 0 },
    });
    res.json({ result: presentResult(saved, inputHash) });
  } catch (err) { sendErr(res, err); }
});

// POST /api/ai-review/opportunities/:id/ask  { tab, question }
// One question about one tab. The thread is private to the asker (per user, per
// tab); each answer remembers the tab hash so it can be marked stale.
aiReviewRouter.post('/opportunities/:id/ask', aiReviewLimit, async (req, res) => {
  try {
    const tab = requireTab(req.body?.tab);
    const { question, error: questionError } = checkQuestion(req.body?.question);
    if (questionError) return res.status(400).json({ error: AI_REVIEW_MESSAGES[questionError] });
    if (!deps.isAiConfigured()) return res.status(400).json({ error: AI_REVIEW_MESSAGES.not_configured_ask });
    const opp = await loadOpportunity(req.params.id, req.actor);
    const kind = qaKind(req.actor);
    const out = await withThreadLock(`${opp.id}|${tab}|${kind}`, async () => {
      const { data, gate, documents, theme } = await loadReviewInputs(opp);
      const inputHash = hashTabInputs(tab, data, documents);
      const existing = (await loadResults(opp.id)).find((r) => r.tab === tab && r.kind === kind);
      const history = existing?.messages || [];
      // The same question moments after the last one is a retry or a double
      // click: return the thread as it is instead of asking the model again.
      if (isDuplicateQuestion(history, question)) return { qa: presentQa(existing, inputHash), duplicate: true };

      const material = await gatherMaterial(opp, tab, { data, documents, theme });
      const ruleChecks = runDeterministicChecks(tab, { data, gate });
      const prompt = buildQaPrompt({ tabKey: tab, question, history, data, documents, ruleChecks, ...material });
      const raw = await deps.callLLM({ prompt, response_json_schema: QA_SCHEMA, actor: req.actor });
      const answer = normaliseQa(raw, { tabKey: tab, documents, passages: material.passages });
      const at = new Date().toISOString();
      // The question and its answer are written together, only once there is an
      // answer: a failed call leaves the thread exactly as it was.
      const messages = appendQaTurns(history, [
        { role: 'user', text: question, at },
        { role: 'assistant', text: answer.answer, ...answer, at, input_hash: inputHash },
      ]);
      const saved = await saveResult({
        opp, tab, kind, actor: req.actor,
        payload: { messages, user: req.actor.email, input_hash: inputHash, ran_at: at, ran_by: req.actor.email },
      });
      await writeAudit({
        entity: 'DealOpportunity', entityId: opp.id, action: 'ai_question_asked',
        actor: req.actor, orgId: opp.owner_org_id, after: { tab, answerable: answer.answerable, grounded: answer.grounded },
      });
      return { qa: presentQa(saved, inputHash) };
    });
    res.json(out);
  } catch (err) { sendErr(res, err); }
});

// DELETE /api/ai-review/opportunities/:id/ask?tab=  - clear the asker's own thread.
aiReviewRouter.delete('/opportunities/:id/ask', async (req, res) => {
  try {
    const tab = requireTab(req.query.tab);
    const opp = await loadOpportunity(req.params.id, req.actor);
    await pool.query(
      'UPDATE entity_record SET deleted = true, updated_date = now(), updated_by = $2 WHERE entity = $3 AND id = $1',
      [resultId(opp.id, tab, qaKind(req.actor)), req.actor.email, AI_REVIEW_ENTITY]
    );
    res.json({ ok: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/ai-review/opportunities/:id/results
// The latest stored result per tab and kind, each marked stale against the live
// inputs. Reading never calls the model.
aiReviewRouter.get('/opportunities/:id/results', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    const { data, documents } = await loadReviewInputs(opp);
    const stored = await loadResults(opp.id);
    const mine = qaKind(req.actor);
    const results = {};
    const qa = {};
    for (const tab of AI_TAB_KEYS) { results[tab] = { validation: null, analysis: null }; qa[tab] = presentQa(null, null); }
    for (const row of stored) {
      if (!results[row.tab]) continue;
      const hash = hashTabInputs(row.tab, data, documents);
      if (row.kind === mine) qa[row.tab] = presentQa(row, hash);
      else if (row.kind === 'validation' || row.kind === 'analysis') results[row.tab][row.kind] = presentResult(row, hash);
    }
    res.json({ results, qa, suggestions: SUGGESTED_QUESTIONS, tabs: AI_TAB_KEYS });
  } catch (err) { sendErr(res, err); }
});

export default aiReviewRouter;
