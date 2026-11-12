// ---------------------------------------------------------------------------
// Draft recommendation: Go / Conditional Go / No-Go (BRD AI-04, AI-05, SCR-09).
//
// Pure: no database, no network, no model. It reads the evaluated gate for one
// opportunity (the same block the screening panel and the memo read) and tests it
// against the Sirius decision rules, so the recommendation can never disagree
// with the checks shown beside it. Advisory only: a named human takes the
// decision, the recommendation never changes state.
//
//   Go             every rule passes: hard filters, hurdles in every scenario, no
//                  disqualifier, no open flag and a weighted score at or above the bar.
//   Conditional Go no rule is failed, but at least one is open (a downside miss, a
//                  concentration or completeness flag, a scorecard not yet recorded).
//                  Each open rule becomes a named condition with an owner.
//   No-Go          a rule is failed: an automatic disqualifier, a failed hard filter,
//                  a base-case return hurdle missed, or a recorded weighted score
//                  below the bar / a lens below its floor.
// ---------------------------------------------------------------------------

export const RECOMMENDATION_RATINGS = ['Go', 'Conditional Go', 'No-Go'];
export const RECOMMENDATION_STATUSES = ['pass', 'warn', 'fail'];
export const RECOMMENDATION_LABEL = 'Rule-based draft';
export const RECOMMENDATION_ADVISORY =
  'Advisory only. It tests the submission against the Sirius decision rules; a named reviewer confirms, edits or overrides it.';

// Who is expected to clear each open rule.
export const CONDITION_OWNERS = {
  hard_filters: 'Sirius Deal Lead',
  downside_hurdles: 'Subsidiary CFO',
  concentration: 'Sirius Deal Lead',
  scorecard: 'Sirius Deal Lead',
  sufficiency: 'Subsidiary Deal Lead',
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (value, unit = '') => {
  const n = num(value);
  if (n === null) return '—';
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  if (unit === '%') return text + '%';
  if (unit === 'x') return text + 'x';
  if (unit) return text + ' ' + unit;
  return text;
};

const rule = (key, label, status, detail, extra = {}) => ({ key, label, status, detail, ...extra });

// The hurdle row for one key, or null.
const hurdleRow = (gate, key) => (gate?.hurdle_table?.rows || []).find((r) => r.key === key) || null;

function baseHurdleRule(gate, key, label) {
  const row = hurdleRow(gate, key);
  const s = row?.scenarios?.base;
  if (!row || !s || !s.present) {
    return rule(`base_${key}`, `${label} (base case)`, 'warn', 'Not captured yet.', { owner_key: 'sufficiency' });
  }
  const cmp = row.comparator === 'lte' ? 'at most' : 'at least';
  const text = `${fmt(s.value, row.unit)} (${cmp} ${fmt(row.threshold, row.unit)})`;
  return rule(`base_${key}`, `${label} (base case)`, s.meets === false ? 'fail' : 'pass', text);
}

/**
 * Build the draft recommendation from an evaluated gate.
 * @param {object} gate  the result of evaluateGate (with the portfolio register passed in
 *                       so concentration is measured).
 * @returns {{ rating, summary, score, pass_bar, rules, conditions, label, advisory }}
 */
export function buildRecommendation(gate = null) {
  const g = gate || {};
  const rules = [];

  // 1. Hard filters (SCR-03).
  const hf = g.hard_filters;
  if (hf) {
    const items = Array.isArray(hf.items) ? hf.items : [];
    const failed = items.filter((i) => i.status === 'fail');
    const toConfirm = items.filter((i) => i.status === 'flag');
    const passed = items.filter((i) => i.status === 'pass').length;
    if (failed.length) {
      rules.push(rule('hard_filters', 'Hard filters', 'fail',
        `${failed.length} failed: ${failed.map((f) => f.label || f.key).join(', ')}.`));
    } else if (toConfirm.length) {
      rules.push(rule('hard_filters', 'Hard filters', 'warn',
        `${passed} of ${items.length} passed; ${toConfirm.map((f) => f.label || f.key).join(', ')} to confirm by hand.`,
        { condition: 'Confirm the open hard filters by hand: ' + toConfirm.map((f) => f.label || f.key).join(', ') + '.', owner_key: 'hard_filters' }));
    } else {
      rules.push(rule('hard_filters', 'Hard filters', 'pass', `${passed} of ${items.length} passed.`));
    }
  }

  // 2. Base-case hurdles (AI-05): equity IRR, ROIC, payback.
  rules.push(baseHurdleRule(g, 'payback', 'Payback'));
  rules.push(baseHurdleRule(g, 'equity_irr', 'Equity IRR'));
  rules.push(baseHurdleRule(g, 'roic', 'ROIC'));

  // 3. Automatic disqualifiers (SCR-05).
  const dq = g.disqualifiers;
  if (dq) {
    const raised = (dq.items || []).filter((i) => i.status === 'flagged');
    rules.push(raised.length
      ? rule('disqualifiers', 'No automatic disqualifier', 'fail', 'Raised: ' + raised.map((i) => i.label || i.key).join(', ') + '.')
      : rule('disqualifiers', 'No automatic disqualifier', 'pass', 'None raised.'));
  }

  // 4. The other scenarios: any downside / upside miss is a condition, not a stop.
  const missed = [];
  for (const row of g.hurdle_table?.rows || []) {
    for (const scenario of ['downside', 'upside']) {
      const s = row.scenarios?.[scenario];
      if (s && s.present && s.meets === false) missed.push({ row, scenario, s });
    }
  }
  if (missed.length) {
    const text = missed.map((m) => `${m.row.label} ${fmt(m.s.value, m.row.unit)} in the ${m.scenario} case`).join('; ');
    rules.push(rule('downside_hurdles', 'Hurdles in the other scenarios', 'warn', text + '.',
      { condition: 'Explain or mitigate the downside case: ' + text + '.', owner_key: 'downside_hurdles' }));
  } else if (hurdleRow(g, 'equity_irr')?.scenarios?.downside?.present) {
    rules.push(rule('downside_hurdles', 'Hurdles in the other scenarios', 'pass', 'Every captured scenario meets its hurdles.'));
  }

  // 5. Portfolio concentration (SCR-07).
  const conc = g.portfolio_conflict?.concentration;
  if (conc && conc.post_deal_pct !== null && conc.post_deal_pct !== undefined) {
    rules.push(conc.breach
      ? rule('concentration', 'Portfolio concentration', 'warn',
        `Post-deal ${conc.sector || 'sector'} concentration ${fmt(conc.post_deal_pct, '%')} exceeds the ${fmt(conc.max_pct, '%')} ceiling.`,
        { condition: `Confirm the concentration is acceptable: ${fmt(conc.post_deal_pct, '%')} against a ${fmt(conc.max_pct, '%')} ceiling.`, owner_key: 'concentration' })
      : rule('concentration', 'Portfolio concentration', 'pass',
        `Post-deal ${conc.sector || 'sector'} concentration ${fmt(conc.post_deal_pct, '%')} (ceiling ${fmt(conc.max_pct, '%')}).`));
  }

  // 6. Completeness / content sufficiency (DOC-04): advisory flags.
  const flags = (Array.isArray(g.sufficiency?.open_flags) ? g.sufficiency.open_flags : []).filter((f) => !f.overridden);
  if (flags.length) {
    const text = (f) => String(f.message || f.label || f.key).replace(/\.$/, '');
    rules.push(rule('sufficiency', 'Content sufficiency', 'warn', flags.map(text).join('. ') + '.',
      { condition: 'Resolve or override the content-sufficiency flags: ' + flags.map((f) => String(f.key || f.label).replace(/_/g, ' ')).join('; ') + '.', owner_key: 'sufficiency' }));
  }

  // 7. Weighted score (SCO-02, SCO-04). Only a reviewed scorecard counts: a pure
  // set of system proposals never reads as a passed bar.
  const sc = g.scorecard;
  const bar = num(sc?.pass_threshold);
  let score = null;
  if (sc) {
    if (sc.complete && num(sc.total) !== null) {
      score = num(sc.total);
      const overrideCondition = () => ({
        condition: 'CIO override memo is on file for the score below the bar' + (sc.override?.by ? ' (' + sc.override.by + (sc.override.at ? ', ' + String(sc.override.at).slice(0, 10) : '') + ')' : '') + '.',
        owner_key: 'scorecard',
      });
      if (sc.below_lens_floor) {
        // An explicit CIO override memo turns the failure into a named condition,
        // never an automatic rejection.
        rules.push(rule('scorecard', 'Weighted score', sc.overridden ? 'warn' : 'fail',
          `${fmt(score)} / 5; a lens is below its floor (${(sc.lenses_below_floor || []).join(', ')})${sc.overridden ? '; CIO override on file' : ''}.`,
          sc.overridden ? overrideCondition() : {}));
      } else if (bar !== null && score < bar) {
        rules.push(rule('scorecard', 'Weighted score', sc.overridden ? 'warn' : 'fail',
          `${fmt(score)} / 5 (bar ${fmt(bar)})${sc.overridden ? '; CIO override on file' : ''}.`,
          sc.overridden ? overrideCondition() : {}));
      } else {
        rules.push(rule('scorecard', 'Weighted score', 'pass', `${fmt(score)} / 5 (bar ${fmt(bar)}).`));
      }
    } else {
      rules.push(rule('scorecard', 'Weighted score', 'warn',
        'Not yet scored: the reviewer has not confirmed all criteria' + (bar !== null ? ` (pass bar ${fmt(bar)}).` : '.'),
        { condition: 'Record the weighted scorecard; it must reach ' + (bar !== null ? fmt(bar) : 'the pass bar') + ' / 5.', owner_key: 'scorecard' }));
    }
  }

  const failed = rules.filter((r) => r.status === 'fail');
  const open = rules.filter((r) => r.status === 'warn');
  const rating = failed.length ? 'No-Go' : (open.length ? 'Conditional Go' : 'Go');

  const conditions = open
    .filter((r) => r.condition)
    .map((r) => ({ key: r.key, text: r.condition, owner: CONDITION_OWNERS[r.owner_key] || 'Sirius Deal Lead' }));

  let summary;
  if (rating === 'No-Go') {
    summary = 'A decision rule is failed: ' + failed.map((r) => r.label).join(', ') + '.';
  } else if (rating === 'Conditional Go') {
    summary = (score !== null && bar !== null && score < bar
      ? `Score ${fmt(score)}, below the ${fmt(bar)} pass bar. `
      : (score === null ? 'Weighted score not yet recorded. ' : ''))
      + 'Proceed only if the named conditions are met.';
  } else {
    summary = `Every decision rule passes${score !== null ? ` with a weighted score of ${fmt(score)} / 5` : ''}.`;
  }

  return {
    rating, summary, score, pass_bar: bar,
    rules: rules.map(({ key, label, status, detail }) => ({ key, label, status, detail })),
    conditions,
    label: RECOMMENDATION_LABEL,
    advisory: RECOMMENDATION_ADVISORY,
  };
}

// ---------------------------------------------------------------------------
// Evidence-informed recommendation (Phase 1).
//
// The rating still comes from the deterministic rules above: a failed decision
// rule is a No-Go and only the rules can make one. Research, the calculated
// financials and the document / external comparison can only MAKE THE DRAFT MORE
// CAUTIOUS (Go -> Conditional Go, with named conditions and cited reasons); they
// can never lift a Conditional Go to Go or a No-Go to anything better. The draft
// stays advisory: a named Sirius reviewer decides.
// ---------------------------------------------------------------------------

export const EVIDENCE_RECOMMENDATION_LABEL = 'Evidence-informed draft';
export const HUMAN_DECISION_NOTE =
  'This draft supports the Sirius reviewers; it does not decide. The rating comes from the Sirius decision rules, and the evidence below can only add caution. A named reviewer accepts, edits or overrides it.';

const RANK = { Go: 0, 'Conditional Go': 1, 'No-Go': 2 };

/**
 * @param {object} base     buildRecommendation(gate)
 * @param {object} inputs   { financials, comparison, research }
 */
export function enhanceRecommendation(base, { financials = null, comparison = null, research = null } = {}) {
  const reasons = [];   // { text, basis, severity, refs: [comparison item ids], effect }
  const conditions = [...(base?.conditions || [])];
  const flat = comparison ? Object.values(comparison.by_tab || {}).flat() : [];

  // 1. Calculated financials.
  if (financials?.calculated) {
    const fails = (financials.integrity?.checks || []).filter((c) => c.status === 'fail');
    for (const c of fails) {
      reasons.push({ text: `Financial statements do not tie out: ${c.label}. ${c.detail}`, basis: 'verified_evidence', severity: 'high', effect: 'caution' });
    }
    if (fails.length) conditions.push({ key: 'financial_integrity', text: 'Have the Subsidiary CFO correct the financial statements so they balance and tie out.', owner: 'Subsidiary CFO' });
    const baseMiss = (financials.hurdles?.flags || []).filter((f) => f.reason === 'below_hurdle' && f.scenario === 'base');
    for (const f of baseMiss) {
      reasons.push({ text: `Calculated from the submitted projections, ${f.message}`, basis: 'verified_evidence', severity: 'high', effect: 'caution' });
    }
    if (baseMiss.length) conditions.push({ key: 'calculated_hurdles', text: 'Reconcile the calculated base-case returns with the submitted figures and the hurdles: ' + baseMiss.map((f) => f.label).join(', ') + '.', owner: 'Subsidiary CFO' });
    if (financials.survivable_downside?.survivable === false) {
      reasons.push({ text: 'The downside case is not survivable on the submitted projections.', basis: 'verified_evidence', severity: 'high', effect: 'caution' });
      conditions.push({ key: 'downside_survivability', text: 'Show how the business survives the downside case (EBITDA, cash and leverage).', owner: 'Subsidiary CFO' });
    }
  } else if (financials && !financials.calculated) {
    reasons.push({ text: 'Returns could not be calculated from the submission' + (financials.missing?.length ? ' (missing: ' + financials.missing.slice(0, 3).join('; ') + ').' : '.'), basis: 'missing', severity: 'low', effect: 'none' });
  }

  // 2. Comparison findings: high-severity items backed by verified evidence.
  for (const it of flat) {
    if (it.type === 'consistent') continue;
    if (it.severity === 'high' && it.basis === 'verified_evidence' && it.type !== 'missing_information') {
      reasons.push({ text: it.statement, basis: it.basis, severity: 'high', refs: [it.id], effect: 'caution', tab: it.tab, type: it.type });
    }
  }
  const highRisk = reasons.filter((r) => r.effect === 'caution' && r.refs).length;
  if (highRisk) conditions.push({ key: 'evidence_findings', text: 'Resolve the high-severity discrepancies and risks raised by the document and external-source comparison.', owner: 'Sirius Deal Lead' });

  // 3. Everything unverified is listed, but cannot change the rating.
  const infer = flat.filter((i) => i.basis === 'ai_inference' && i.type !== 'consistent').length;
  const missing = flat.filter((i) => i.basis === 'missing').length;
  if (infer) reasons.push({ text: `${infer} finding(s) rest on AI inference and are not verified evidence; they do not change the rating.`, basis: 'ai_inference', severity: 'info', effect: 'none' });
  if (missing) reasons.push({ text: `${missing} item(s) are missing information (not found, unreadable or not researched).`, basis: 'missing', severity: 'info', effect: 'none' });
  if (research && ['not_configured', 'not_approved', 'unauthorised', 'rate_limited'].includes(research.status)) {
    reasons.push({ text: 'External research did not run (' + research.status.replace(/_/g, ' ') + '); the draft rests on the submission, documents and rules only.', basis: 'missing', severity: 'info', effect: 'none' });
  }

  const cautious = reasons.some((r) => r.effect === 'caution');
  let rating = base?.rating || 'Conditional Go';
  if (cautious && RANK[rating] < RANK['Conditional Go']) rating = 'Conditional Go';
  const adjusted = rating !== base?.rating;

  const count = (b) => reasons.filter((r) => r.basis === b).length;
  return {
    ...base,
    rating,
    rules_rating: base?.rating || null,
    adjusted,
    summary: adjusted ? 'The decision rules pass, but the evidence calls for caution: proceed only if the named conditions are met.' : base?.summary,
    conditions,
    evidence_reasons: reasons,
    evidence_summary: { verified_evidence: count('verified_evidence'), ai_inference: count('ai_inference'), missing: count('missing') },
    label: EVIDENCE_RECOMMENDATION_LABEL,
    human_decision_note: HUMAN_DECISION_NOTE,
  };
}

export const RECOMMENDATION_NARRATIVE_SCHEMA = {
  type: 'object',
  properties: { narrative: { type: 'string' }, evidence_ids: { type: 'array', items: { type: 'string' } } },
  required: ['narrative', 'evidence_ids'],
};

/** A short model-written rationale, strictly over the listed reasons; never the rating. */
export function buildNarrativePrompt(rec) {
  const lines = (rec.evidence_reasons || []).map((r, i) => `R${i + 1} [${r.basis}] ${r.text}`).join('\n');
  const rules = (rec.rules || []).map((r) => `- ${r.label}: ${r.status} (${r.detail})`).join('\n');
  return [
    `A Sirius decision-rules engine produced the rating "${rec.rules_rating}"; the final draft rating is "${rec.rating}". You do not choose or change the rating.`,
    'Write a 3-5 sentence rationale for the investment committee using ONLY the rules and reasons below. Mention which points are verified evidence, which are AI inference and what is missing. Cite the reason ids (R1, R2, ...) you rely on. Do not add facts.',
    '', 'RULES:', rules, '', 'REASONS:', lines || '(none)',
  ].join('\n');
}

export function normaliseNarrative(raw, rec) {
  const ids = new Set((rec.evidence_reasons || []).map((_, i) => `R${i + 1}`));
  const text = String(raw?.narrative || '').trim().slice(0, 1200);
  const cited = (Array.isArray(raw?.evidence_ids) ? raw.evidence_ids : []).map(String).filter((id) => ids.has(id));
  if (!text || (ids.size && !cited.length)) return null;
  return { text, cited, basis: 'ai_inference' };
}

export default { buildRecommendation, enhanceRecommendation, RECOMMENDATION_RATINGS, RECOMMENDATION_STATUSES, CONDITION_OWNERS, RECOMMENDATION_LABEL, RECOMMENDATION_ADVISORY };
