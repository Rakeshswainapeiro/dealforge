// ---------------------------------------------------------------------------
// Reviewer decisions on AI findings, and the consolidated overview.
//
// A Sirius reviewer may accept an AI finding, override it with a written reason
// or ask the Preparer for clarification. Each decision is an append-only record
// (never edited or deleted), so the history of who overrode what, and why, is
// kept. The latest decision per finding is laid over the stored AI result at
// read time; the AI result itself is never rewritten.
//
// Pure: no database, no network.
// ---------------------------------------------------------------------------

import { AI_REVIEW_STATUSES, ANALYSIS_RATINGS, AI_TABS } from './aiReview.js';
import { scoreAnalysis, SCORECARD_ANALYSIS_LINKS } from './aiAnalysisScore.js';

export const AI_DECISION_ENTITY = 'AIReviewDecision';
export const DECISION_ACTIONS = ['accept', 'override', 'clarify'];
export const DECISION_KINDS = ['validation', 'analysis'];
export const TAB_FINDING = '__tab__';
export const MIN_REASON_CHARS = 10;

export const DECISION_MESSAGES = {
  bad_kind: 'kind must be "validation" or "analysis".',
  bad_action: 'action must be accept, override or clarify.',
  reason_required: `An override needs a written reason of at least ${MIN_REASON_CHARS} characters.`,
  status_required: 'An override needs the status it replaces the AI finding with.',
  bad_status_validation: 'A validation override must be pass, review or fail.',
  bad_status_analysis: 'An analysis override must be one of: ' + ANALYSIS_RATINGS.join(', ') + '.',
  question_required: 'A clarification request needs the question for the Preparer (at least 5 characters).',
  no_result: 'There is no AI result on this tab to decide on yet. Run the validation or analysis first.',
};

const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** Validate a decision payload. Returns { ok, error?, decision? } (no I/O). */
export function validateDecision(body = {}, { result = null } = {}) {
  const kind = text(body.kind, 20);
  if (!DECISION_KINDS.includes(kind)) return { ok: false, error: DECISION_MESSAGES.bad_kind };
  const action = text(body.action, 20);
  if (!DECISION_ACTIONS.includes(action)) return { ok: false, error: DECISION_MESSAGES.bad_action };
  if (!result) return { ok: false, error: DECISION_MESSAGES.no_result };
  const findingKey = text(body.finding_key, 80) || TAB_FINDING;
  const reason = text(body.reason, 2000);
  const decision = { kind, action, finding_key: findingKey, reason: reason || null, to_status: null, question: null };
  if (action === 'override') {
    if (reason.length < MIN_REASON_CHARS) return { ok: false, error: DECISION_MESSAGES.reason_required };
    const to = text(body.to_status, 40);
    if (!to) return { ok: false, error: DECISION_MESSAGES.status_required };
    if (kind === 'validation' && !AI_REVIEW_STATUSES.includes(to)) return { ok: false, error: DECISION_MESSAGES.bad_status_validation };
    if (kind === 'analysis' && !ANALYSIS_RATINGS.includes(to)) return { ok: false, error: DECISION_MESSAGES.bad_status_analysis };
    decision.to_status = to;
  }
  if (action === 'clarify') {
    const q = text(body.question || body.reason, 2000);
    if (q.length < 5) return { ok: false, error: DECISION_MESSAGES.question_required };
    decision.question = q;
  }
  return { ok: true, decision };
}

/** The status the AI gave a finding (the whole tab, a validation check or an analysis item). */
export function aiStatusOf(result, kind, findingKey) {
  if (!result) return null;
  if (findingKey === TAB_FINDING) return result.status ?? null;
  if (kind === 'validation') return (result.checks || []).find((c) => c.key === findingKey)?.status ?? null;
  const idx = Number(String(findingKey).replace(/^item-/, ''));
  return Number.isInteger(idx) ? result.analysis?.items?.[idx]?.rating ?? null : null;
}

/** Latest decision per (tab, kind, finding_key). Input rows are in any order. */
export function latestDecisions(rows = []) {
  const sorted = [...rows].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const map = new Map();
  for (const r of sorted) map.set(`${r.tab}|${r.kind}|${r.finding_key}`, r);
  return [...map.values()];
}

const RANK = { pass: 0, review: 1, fail: 2 };
// An AI step that did not complete because of the provider (unapproved, down, busy) is a
// failed run a reviewer can retry. "Not configured" is a deployment choice, not a failure.
const failedRun = (r) => Boolean(r && r.ai_status && !['ok', 'not_configured'].includes(r.ai_status));
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

/**
 * The effective status of a tab's validation: the AI status, replaced by the
 * latest tab-level reviewer override while it still matches the current inputs.
 */
export function effectiveValidation(result, decision, currentHash) {
  const aiStatus = result?.status ?? null;
  const live = decision && decision.action === 'override' && decision.input_hash === currentHash;
  return live ? { status: decision.to_status, overridden: true, ai_status: aiStatus, override_stale: false }
    : { status: aiStatus, overridden: false, ai_status: aiStatus, override_stale: Boolean(decision && decision.action === 'override') };
}

/**
 * The consolidated overview across the seven tabs: per-tab validation and
 * analysis state with reviewer overrides applied, plus counts and the overall
 * validation status. `results` is the per-tab map the results API builds;
 * `decisions` is the latest-decision list; `hashes` the live input hash per tab.
 */
export function buildOverview({ results = {}, decisions = [], hashes = {}, tabs = AI_TABS } = {}) {
  const byKey = new Map(decisions.map((d) => [`${d.tab}|${d.kind}|${d.finding_key}`, d]));
  const rows = tabs.map((t) => {
    const validation = results[t.key]?.validation || null;
    const analysis = results[t.key]?.analysis || null;
    const vDecision = byKey.get(`${t.key}|validation|${TAB_FINDING}`) || null;
    const aDecision = byKey.get(`${t.key}|analysis|${TAB_FINDING}`) || null;
    const v = validation ? effectiveValidation(validation, vDecision, hashes[t.key]) : { status: null, overridden: false, ai_status: null };
    const aLive = aDecision && aDecision.action === 'override' && aDecision.input_hash === hashes[t.key];
    const clarifications = decisions.filter((d) => d.tab === t.key && d.action === 'clarify').length;
    return {
      tab: t.key, label: t.label,
      validation_status: v.status, validation_overridden: v.overridden, validation_ai_status: v.ai_status,
      validation_ran: Boolean(validation), validation_stale: Boolean(validation?.stale),
      validation_run_status: validation?.ai_status || null,
      validation_failed_run: failedRun(validation),
      analysis_rating: aLive ? aDecision.to_status : (analysis?.analysis?.recommendation?.rating || null),
      analysis_overridden: Boolean(aLive),
      analysis_ran: Boolean(analysis?.analysis), analysis_stale: Boolean(analysis?.stale),
      analysis_failed_run: failedRun(analysis),
      analysis_not_configured: analysis?.ai_status === 'not_configured',
      clarifications,
    };
  });
  // The overall AI assessment is scored from the analysis ratings only; the
  // validation status above is reported beside it and never feeds the score.
  const scored = scoreAnalysis(rows.map((r) => ({
    tab: r.tab, rating: r.analysis_rating, overridden: r.analysis_overridden, ran: r.analysis_ran,
    stale: r.analysis_stale, failed_run: r.analysis_failed_run, not_configured: r.analysis_not_configured,
  })));
  rows.forEach((r, i) => {
    const s = scored.rows[i];
    Object.assign(r, { analysis_weight: s.weight, analysis_score_state: s.state, analysis_score: s.score, analysis_weighted: s.weighted });
  });
  let overall = null;
  for (const r of rows) if (r.validation_status && RANK[r.validation_status] !== undefined) overall = overall === null ? r.validation_status : worst(overall, r.validation_status);
  return {
    overall_validation: overall,
    counts: {
      passed: rows.filter((r) => r.validation_status === 'pass').length,
      needs_review: rows.filter((r) => r.validation_status === 'review').length,
      failed: rows.filter((r) => r.validation_status === 'fail').length,
      not_run: rows.filter((r) => !r.validation_ran).length,
      weak_analysis: rows.filter((r) => r.analysis_rating === 'Weak').length,
      overridden: rows.filter((r) => r.validation_overridden || r.analysis_overridden).length,
      failed_runs: rows.filter((r) => r.validation_failed_run || r.analysis_failed_run).length,
      ai_not_configured: rows.filter((r) => r.validation_run_status === 'not_configured').length,
    },
    tabs: rows,
    analysis_assessment: { ...scored.assessment, scorecard_links: SCORECARD_ANALYSIS_LINKS },
  };
}

export default { AI_DECISION_ENTITY, validateDecision, aiStatusOf, latestDecisions, effectiveValidation, buildOverview };
