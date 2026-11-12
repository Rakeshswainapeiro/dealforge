import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { rateLimit } from './security.js';
import { evaluateGate, listDocuments } from './gate.js';
import { loadOpportunity, openThread } from './qa.js';
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
  withCheckedAgainst, AI_TABS,
} from './config/aiReview.js';
import { isReviewer, isAdmin, isProducerFor } from './config/workflowStates.js';
import { onSubmit, onTransition } from './lifecycle.js';
import { canSeeInternalAssessment } from './config/aiVisibility.js';
import {
  AI_DECISION_ENTITY, validateDecision, aiStatusOf, latestDecisions, buildOverview,
} from './config/aiReviewDecisions.js';
import { evidenceRouter, getExtractedText, runEvidence, isEvidenceRunning, buildEvidenceRecommendation, evaluateFinancialsForReview } from './aiEvidence.js';
import { isRubricEnabled, rubricAuditFields } from './config/aiRubrics.js';
import { EXTRACTABLE_EXTENSIONS } from './documentExtract.js';

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
    // Internal AI validation, analysis, Q&A and reviewer decisions belong to the
    // Sirius Investment Team. The subsidiary Preparer is refused here, before any
    // opportunity is loaded or any model is called.
    if (!canSeeInternalAssessment(req.actor)) {
      return res.status(403).json({ error: 'Only the Sirius Investment Team may use the internal AI review' });
    }
    next();
  } catch (err) { next(err); }
});

// The evidence pipeline (extraction, financials, research, comparison): same Sirius-only guard.
aiReviewRouter.use(evidenceRouter);

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
async function readSnippet(doc, opp = null, actor = null) {
  try {
    if (doc.scan_verdict === 'infected') return null;
    if (String(doc.requirement_key || '').startsWith('qa_attachment:')) return null;
    const ext = path.extname(doc.original_name || doc.filename || '').toLowerCase();
    // PDF, DOCX, PPTX and images (scans, via OCR) are read by the extractor, once per document.
    if (opp && EXTRACTABLE_EXTENSIONS.includes(ext)) {
      const text = await getExtractedText(opp, doc, actor);
      return text ? text.slice(0, DOC_SNIPPET_CHARS) : null;
    }
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
async function gatherMaterial(opp, tab, { data, documents, theme, actor = null }) {
  const snippets = {};
  for (const d of tabDocuments(tab, documents)) snippets[d.id] = await readSnippet(d, opp, actor);
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
    "SELECT id, data FROM entity_record WHERE entity = $1 AND deleted = false AND data->>'opportunity_id' = $2 AND COALESCE(data->>'tab','') <> '__opp__'",
    [AI_REVIEW_ENTITY, opportunityId]
  );
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

// Validation of one tab: rule checks plus (when a model is approved) the model
// checks. Stored as the tab's latest validation result. Shared by the reviewer's
// manual run and the automatic run after submission.
export async function runValidation(opp, tab, actor, trigger = 'manual') {
  const { data, gate, documents, theme } = await loadReviewInputs(opp);
  const inputHash = hashTabInputs(tab, data, documents);
  // Financials only, and only while its rubric is on: the financial engine's result feeds the rule checks.
  const engine = tab === 'financials' && isRubricEnabled(tab) ? await evaluateFinancialsForReview(opp, documents, actor) : undefined;
  const ruleChecks = runDeterministicChecks(tab, { data, gate, engine });
  let aiChecks = [];
  let aiStatus = 'ok';
  if (!deps.isAiConfigured()) {
    aiStatus = 'not_configured';
  } else {
    try {
      const material = await gatherMaterial(opp, tab, { data, documents, theme, actor });
      const embedded = embeddedInstructionsCheck([
        ...buildTabContext(tab, data).fields.map((f) => ({ where: f.label, text: typeof f.value === 'string' ? f.value : '' })),
        ...tabDocuments(tab, documents).map((d) => ({ where: d.original_name, text: material.snippets[d.id] || '' })),
      ]);
      if (embedded) ruleChecks.push(embedded);
      const prompt = buildValidationPrompt({ tabKey: tab, data, documents, ruleChecks, ...material });
      const raw = await deps.callLLM({ prompt, response_json_schema: VALIDATION_SCHEMA, actor });
      aiChecks = normaliseValidation(raw, tab, tabDocuments(tab, documents), ruleChecks, { data, snippets: material.snippets });
    } catch (err) {
      // A provider that is unapproved, unreachable or answers badly never
      // fails the run: the rule-based checks stand and the card says why.
      aiStatus = err.status === 403 ? 'not_approved' : err.status === 429 ? 'rate_limited' : 'unavailable';
      console.warn('[ai-review] model check failed:', err.message);
    }
  }
  const checks = [...ruleChecks, ...aiChecks];
  const saved = await saveResult({
    opp, tab, kind: 'validation', actor,
    payload: {
      status: overallStatus(checks), checks, ai_status: aiStatus,
      input_hash: inputHash, ran_at: new Date().toISOString(), ran_by: actor.email, trigger,
    },
  });
  // The audit row records that a run happened and its outcome, not the content.
  await writeAudit({
    entity: 'DealOpportunity', entityId: opp.id, action: 'ai_validation_run',
    actor, orgId: opp.owner_org_id,
    after: { tab, trigger, status: saved.status, ai_status: aiStatus, checks: checks.length, ...rubricAuditFields(tab) },
  });
  return { saved, data, inputHash, aiStatus };
}

// Analysis of one tab: reads only that tab, its documents and the Sirius strategy
// library. A failed run never replaces a good earlier analysis.
export async function runAnalysis(opp, tab, actor, trigger = 'manual') {
  const { data, gate, documents, theme } = await loadReviewInputs(opp);
  const inputHash = hashTabInputs(tab, data, documents);
  let analysis = null;
  let aiStatus = 'ok';
  if (!deps.isAiConfigured()) {
    aiStatus = 'not_configured';
  } else {
    try {
      const material = await gatherMaterial(opp, tab, { data, documents, theme, actor });
      const engine = tab === 'financials' && isRubricEnabled(tab) ? await evaluateFinancialsForReview(opp, documents, actor) : undefined;
      const ruleChecks = runDeterministicChecks(tab, { data, gate, engine });
      const prompt = buildAnalysisPrompt({ tabKey: tab, data, documents, ruleChecks, ...material });
      const raw = await deps.callLLM({ prompt, response_json_schema: ANALYSIS_SCHEMA, actor });
      analysis = normaliseAnalysis(raw, { tabKey: tab, documents, passages: material.passages, data, snippets: material.snippets });
    } catch (err) {
      aiStatus = err.status === 403 ? 'not_approved' : err.status === 429 ? 'rate_limited' : 'unavailable';
      console.warn('[ai-review] analysis failed:', err.message);
    }
  }
  if (!analysis && aiStatus !== 'not_configured') {
    const prev = (await loadResults(opp.id)).find((r) => r.tab === tab && r.kind === 'analysis' && r.analysis);
    if (prev) {
      await writeAudit({
        entity: 'DealOpportunity', entityId: opp.id, action: 'ai_analysis_run',
        actor, orgId: opp.owner_org_id, after: { tab, trigger, ai_status: aiStatus, kept_previous: true, ...rubricAuditFields(tab) },
      });
      return { saved: prev, inputHash, aiStatus, keptPrevious: true };
    }
  }
  const saved = await saveResult({
    opp, tab, kind: 'analysis', actor,
    payload: {
      status: analysis?.recommendation?.rating || null, analysis, ai_status: aiStatus,
      input_hash: inputHash, ran_at: new Date().toISOString(), ran_by: actor.email, trigger,
    },
  });
  await writeAudit({
    entity: 'DealOpportunity', entityId: opp.id, action: 'ai_analysis_run',
    actor, orgId: opp.owner_org_id,
    after: { tab, trigger, ai_status: aiStatus, rating: analysis?.recommendation?.rating || null, items: analysis?.items?.length || 0, ...rubricAuditFields(tab) },
  });
  return { saved, inputHash, aiStatus, keptPrevious: false };
}

// POST /api/ai-review/opportunities/:id/validate  { tab, trigger? }
aiReviewRouter.post('/opportunities/:id/validate', aiReviewLimit, async (req, res) => {
  try {
    const tab = requireTab(req.body?.tab);
    const trigger = req.body?.trigger === 'auto_save' ? 'auto_save' : 'manual';
    const opp = await loadOpportunity(req.params.id, req.actor);
    const { saved, data, inputHash } = await runValidation(opp, tab, req.actor, trigger);
    res.json({ result: withCheckedAgainst(presentResult(saved, inputHash), data) });
  } catch (err) { sendErr(res, err); }
});

// POST /api/ai-review/opportunities/:id/analyse  { tab }
aiReviewRouter.post('/opportunities/:id/analyse', aiReviewLimit, async (req, res) => {
  try {
    const tab = requireTab(req.body?.tab);
    const opp = await loadOpportunity(req.params.id, req.actor);
    const out = await runAnalysis(opp, tab, req.actor, 'manual');
    res.json({ result: presentResult(out.saved, out.inputHash), ...(out.keptPrevious ? { run_error: out.aiStatus } : {}) });
  } catch (err) { sendErr(res, err); }
});

// ---------------------------------------------------------------------------
// Automatic run after submission. When the Preparer submits, every tab is
// validated and analysed in the background by the platform (not by the Preparer,
// who never sees the results). A transient provider failure is retried once;
// whatever happens is stored per tab, so a failed tab shows its reason and can be
// re-run by a reviewer. The submit response never waits for the model.
// ---------------------------------------------------------------------------
const SYSTEM_ACTOR = Object.freeze({ id: null, email: 'system@dealforge.ai-review', roles: [], membership: [] });
const TRANSIENT = new Set(['unavailable', 'rate_limited']);
const autoRunning = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runAllTabs(opportunityId, actor = SYSTEM_ACTOR, { trigger = 'auto_submit', onlyStale = false } = {}) {
  if (autoRunning.has(opportunityId)) return { skipped: true, reason: 'already_running' };
  autoRunning.add(opportunityId);
  const summary = { tabs: {}, failed: 0 };
  try {
    const { rows } = await pool.query(
      "SELECT * FROM entity_record WHERE entity = 'DealOpportunity' AND id = $1 AND deleted = false", [opportunityId]);
    const opp = rows[0];
    if (!opp) return { skipped: true, reason: 'not_found' };
    const retryMs = Number(process.env.AI_AUTO_RETRY_MS ?? 3000);
    const runActor = { ...actor, org_id: opp.owner_org_id };
    const stored = onlyStale ? await loadResults(opp.id) : [];
    const { data, documents } = onlyStale ? await loadReviewInputs(opp) : { data: null, documents: null };
    for (const t of AI_TABS) {
      if (onlyStale) {
        const fresh = (kind) => stored.some((r) => r.tab === t.key && r.kind === kind && r.input_hash === hashTabInputs(t.key, data, documents)
          && (kind !== 'validation' || !r.ai_status || r.ai_status === 'ok' || r.ai_status === 'not_configured'));
        if (fresh('validation') && fresh('analysis')) { summary.tabs[t.key] = 'current'; continue; }
      }
      const outcome = {};
      for (const [name, run] of [['validation', runValidation], ['analysis', runAnalysis]]) {
        try {
          let out = await run(opp, t.key, runActor, trigger);
          if (TRANSIENT.has(out.aiStatus) && retryMs >= 0) { await sleep(retryMs); out = await run(opp, t.key, runActor, trigger); }
          outcome[name] = out.aiStatus;
          if (out.aiStatus !== 'ok' && out.aiStatus !== 'not_configured') summary.failed += 1;
        } catch (err) {
          outcome[name] = 'error';
          summary.failed += 1;
          console.warn(`[ai-review] auto ${name} on ${t.key} failed:`, err.message);
        }
      }
      summary.tabs[t.key] = outcome;
    }
    // Evidence pipeline (extraction, calculations, research, comparison). Isolated:
    // whatever it does, the per-tab results above stand. A re-run after the Preparer
    // answers does not repeat paid web research.
    try {
      summary.evidence = await runEvidence(opp.id, runActor, {
        trigger, steps: onlyStale ? ['extraction', 'financials', 'comparison', 'recommendation'] : undefined,
      });
    } catch (err) { console.warn('[ai-review] evidence pipeline failed:', err.message); }
    await writeAudit({
      entity: 'DealOpportunity', entityId: opp.id, action: 'ai_auto_run', actor: runActor, orgId: opp.owner_org_id,
      after: { trigger, failed: summary.failed, tabs: summary.tabs },
    }).catch(() => {});
    return summary;
  } finally {
    autoRunning.delete(opportunityId);
  }
}

// Start the automatic run once a submission commits. Skipped for trusted loaders
// (sample seed, bulk import: no gate) and when AI_AUTO_RUN=0.
onSubmit({
  afterCommit: async ({ row, gate }) => {
    if (!gate || process.env.AI_AUTO_RUN === '0' || !row?.id) return;
    setImmediate(() => {
      runAllTabs(row.id).catch((err) => console.warn('[ai-review] automatic run failed:', err.message));
    });
  },
});

// When the Preparer answers an information request, only the tabs whose content
// changed (or whose earlier run failed) are re-run.
onTransition(async ({ row, rule }) => {
  if (rule?.action !== 'respond' || process.env.AI_AUTO_RUN === '0' || !row?.id) return;
  setImmediate(() => {
    runAllTabs(row.id, SYSTEM_ACTOR, { trigger: 'auto_response', onlyStale: true })
      .catch((err) => console.warn('[ai-review] automatic re-run failed:', err.message));
  });
});

// POST /api/ai-review/opportunities/:id/run-all  { only_stale? }
// A reviewer starts (or retries) the whole review; runs in the background.
aiReviewRouter.post('/opportunities/:id/run-all', aiReviewLimit, async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (autoRunning.has(opp.id)) return res.status(202).json({ started: false, already_running: true });
    setImmediate(() => {
      runAllTabs(opp.id, req.actor, { trigger: 'manual_all', onlyStale: req.body?.only_stale === true })
        .catch((err) => console.warn('[ai-review] run-all failed:', err.message));
    });
    res.status(202).json({ started: true });
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

      const material = await gatherMaterial(opp, tab, { data, documents, theme, actor: req.actor });
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
      else if (row.kind === 'validation') results[row.tab][row.kind] = withCheckedAgainst(presentResult(row, hash), data);
      else if (row.kind === 'analysis') results[row.tab][row.kind] = presentResult(row, hash);
    }
    const decisions = latestDecisions(await loadDecisions(opp.id));
    const hashes = Object.fromEntries(AI_TAB_KEYS.map((t) => [t, hashTabInputs(t, data, documents)]));
    const overview = buildOverview({ results, decisions, hashes });
    res.json({ results, qa, suggestions: SUGGESTED_QUESTIONS, tabs: AI_TAB_KEYS, decisions, overview, running: autoRunning.has(opp.id) || isEvidenceRunning(opp.id) });
  } catch (err) { sendErr(res, err); }
});

async function loadDecisions(opportunityId, tab = null) {
  const { rows } = await pool.query(
    "SELECT id, data FROM entity_record WHERE entity = $1 AND deleted = false AND data->>'opportunity_id' = $2 ORDER BY created_date ASC",
    [AI_DECISION_ENTITY, opportunityId]
  );
  return rows.map((r) => ({ id: r.id, ...r.data })).filter((d) => !tab || d.tab === tab);
}

// POST /api/ai-review/opportunities/:id/tabs/:tab/review
// { kind: 'validation'|'analysis', finding_key?, action: 'accept'|'override'|'clarify',
//   reason?, to_status?, question? }
// A reviewer accepts an AI finding, overrides it with a written reason, or asks the
// Preparer for clarification (which opens a Q&A thread on that tab). Every decision
// is an append-only record plus an audit row; the AI result itself is never edited.
aiReviewRouter.post('/opportunities/:id/tabs/:tab/review', async (req, res) => {
  try {
    const tab = requireTab(req.params.tab);
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!isAdmin(req.actor) && isProducerFor(req.actor, opp.owner_org_id)) {
      return res.status(403).json({ error: 'The subsidiary that prepared the opportunity cannot review its AI findings (segregation of duties)' });
    }
    const kind = req.body?.kind;
    const stored = (await loadResults(opp.id)).find((r) => r.tab === tab && r.kind === kind);
    const checked = validateDecision(req.body || {}, { result: stored || null });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const d = checked.decision;
    const { data, documents } = await loadReviewInputs(opp);
    const inputHash = hashTabInputs(tab, data, documents);
    let threadId = null;
    if (d.action === 'clarify') {
      const tabLabel = tabByKey(tab)?.label || tab;
      const thread = await openThread(opp.id, {
        subject: ('Clarification needed: ' + tabLabel).slice(0, 200),
        body: d.question, requires_response: true, section: tab,
      }, { actor: req.actor });
      threadId = thread?.id || thread?.thread?.id || null;
    }
    const id = `aird-${opp.id}-${tab}-${crypto.randomUUID()}`;
    const record = {
      opportunity_id: opp.id, tab, kind: d.kind, finding_key: d.finding_key, action: d.action,
      reason: d.reason, to_status: d.to_status, question: d.question, thread_id: threadId,
      from_status: aiStatusOf(stored, d.kind, d.finding_key), input_hash: inputHash,
      result_ran_at: stored.ran_at || null, by: req.actor.email, at: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [id, AI_DECISION_ENTITY, opp.owner_org_id, JSON.stringify(record), req.actor.email]
    );
    await writeAudit({
      entity: 'DealOpportunity', entityId: opp.id, action: 'ai_review_' + d.action,
      actor: req.actor, orgId: opp.owner_org_id,
      before: { status: record.from_status }, after: { tab, kind: d.kind, finding_key: d.finding_key, to_status: d.to_status, thread_id: threadId },
      comment: d.reason || d.question,
    });
    res.status(201).json({ decision: { id, ...record } });
  } catch (err) { sendErr(res, err); }
});

// GET /api/ai-review/opportunities/:id/review-history[?tab=]
// Every reviewer decision on the AI findings, oldest first (the override history).
aiReviewRouter.get('/opportunities/:id/review-history', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    const tab = req.query.tab ? requireTab(String(req.query.tab)) : null;
    res.json({ opportunity_id: opp.id, decisions: await loadDecisions(opp.id, tab) });
  } catch (err) { sendErr(res, err); }
});

// GET /api/ai-review/opportunities/:id/recommendation
// The draft Go / Conditional Go / No-Go recommendation (BRD AI-04, AI-05). It is a
// reviewer feature: the Sirius investment team only. Rule-based, so reading it
// never calls the model and never changes the opportunity.
aiReviewRouter.get('/opportunities/:id/recommendation', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!isReviewer(req.actor)) {
      return res.status(403).json({ error: 'Only the Sirius investment team can read the draft recommendation' });
    }
    // The rating comes from the deterministic rules; stored research, calculations and
    // comparison findings only add caution and cited reasons (never read-triggered model calls).
    res.json({ opportunity_id: opp.id, recommendation: await buildEvidenceRecommendation(opp) });
  } catch (err) { sendErr(res, err); }
});

export default aiReviewRouter;
