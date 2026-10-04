// ---------------------------------------------------------------------------
// Single screening panel (W3-01 / BRD SCR-01).
//
// Source of truth: the Phase-1 BRD, "Automated initial screening": on
// submission the system runs the initial screen - eligibility, hard filters,
// hurdle tests, alignment, synergy and conflict, and completeness sufficiency -
// and shows the results on a single screening panel. Each check shows its
// result, rationale and evidence reference. The screen runs within 15 minutes
// of submission.
//
// This module does not re-derive any rule. It composes the results the platform
// already produces - the submission gate (eligibility / self-screen / hurdle
// table / completeness / statement model / currency) and the theme alignment
// score - into one ordered set of checks with a result, a rationale and
// evidence references, so the board can render the whole screen in one place.
// The checks whose dedicated rule sets land in later W3 slices (hard filters,
// synergy) are marked advisory: they are shown with their inputs and an explicit
// "not configured yet" rationale rather than a fabricated verdict.
//
// Every check is advisory to the decision. SCR-09 (E6.3) keeps a person in the
// loop: the panel carries a recommendation, never a rejection.
//
// Pure functions only - no database, no network. See evaluateScreeningPanel().
// ---------------------------------------------------------------------------

import { evaluateQualityScore } from './qualityScore.js';

export const SCREENING_PANEL_VERSION = 'SCR-01.1';

// The screen runs within 15 minutes of submission (SCR-01 accept criterion).
export const SCREENING_SLA_MINUTES = 15;

export const SCREENING_RESULTS = ['pass', 'flag', 'fail', 'not_applicable'];

export const SCREENING_DISCLAIMER =
  'Screening is advisory. The system never rejects an opportunity on its own; a person takes the screening decision after reviewing these checks.';

// The six checks the BRD names for the initial screen, in display order. Each is
// owned by a module. A check whose rule set is not configured yet is marked
// advisory so the panel shows the whole picture without pretending an unbuilt
// rule set is live; advisory checks never block completeness.
export const SCREENING_CHECKS = [
  {
    key: 'eligibility', module: 'eligibility', label: 'Eligibility', order: 1, advisory: false,
    description: 'Opportunity type, the size floor and the pre-form self-screen.',
  },
  {
    key: 'hard_filters', module: 'hard_filters', label: 'Hard filters', order: 2, advisory: false,
    description: 'The five Gate-1 standing filters; a failed filter recommends decline for a reviewer.',
  },
  {
    key: 'hurdle_tests', module: 'hurdle_tests', label: 'Hurdle tests', order: 3, advisory: false,
    description: 'Each return hurdle per scenario against the mandate thresholds.',
  },
  {
    key: 'alignment', module: 'alignment', label: 'Strategic alignment', order: 4, advisory: false,
    description: 'Fit against the owning subsidiary mandate and the group strategy.',
  },
  {
    key: 'synergy_conflict', module: 'synergy_conflict', label: 'Synergy & conflict', order: 5, advisory: false,
    description: 'Portfolio synergy, duplicate-target and related-party conflict.',
  },
  {
    key: 'completeness', module: 'completeness', label: 'Completeness sufficiency', order: 6, advisory: false,
    description: 'Required fields, required documents and the financial pack.',
  },
];

export const SCREENING_CHECK_KEYS = SCREENING_CHECKS.map((c) => c.key);

// Operator-facing messages kept in configuration (REQ-RULE-10).
export const SCREENING_MESSAGES = {
  all_pass: 'All screening checks passed. The opportunity is clear to proceed to the screening decision.',
  flagged: 'Screening completed with flags. Review each flagged check before the screening decision.',
  blocking: 'Screening found blocking checks. Resolve them before the screening decision can be taken.',
  advisory_open:
    'Advisory checks have no configured rule set yet; they are shown for completeness and take no decision.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function statusFor(result) {
  if (result === 'pass') return 'completed';
  if (result === 'flag') return 'completed_with_flags';
  if (result === 'fail') return 'blocked';
  return 'pending';
}

// Build one check row with the shared shape. Every check carries a result, a
// rationale and evidence references (SCR-01 accept criterion).
function makeCheck(spec, { result, rationale, evidence_refs = [], detail = {} }) {
  return {
    key: spec.key,
    module: spec.module,
    label: spec.label,
    order: spec.order,
    advisory: spec.advisory,
    description: spec.description,
    result,
    pending: result === 'not_applicable',
    status: statusFor(result),
    rationale,
    evidence_refs,
    detail,
  };
}

const na = (spec, rationale, evidence_refs = [], detail = {}) =>
  makeCheck(spec, { result: 'not_applicable', rationale, evidence_refs, detail });
const pass = (spec, rationale, evidence_refs = [], detail = {}) =>
  makeCheck(spec, { result: 'pass', rationale, evidence_refs, detail });
const flag = (spec, rationale, evidence_refs = [], detail = {}) =>
  makeCheck(spec, { result: 'flag', rationale, evidence_refs, detail });
const fail = (spec, rationale, evidence_refs = [], detail = {}) =>
  makeCheck(spec, { result: 'fail', rationale, evidence_refs, detail });

// 1. Eligibility - the pre-form self-screen (type, floor, sector, geography,
// plan, related party) plus the below-floor exception route. Composed from the
// gate's self_screen and below_floor blocks.
function eligibilityCheck(spec, gate) {
  const ss = gate?.self_screen;
  if (!ss) return na(spec, 'The pre-form self-screen has not been run yet.');

  const answerRefs = Object.entries(ss.answers || {})
    .filter(([, v]) => !blank(v))
    .map(([key, value]) => ({ type: 'answer', key, label: key + ' = ' + value }));
  const stopRefs = (ss.stops || []).map((s) => ({ type: 'self_screen_stop', key: s.code, label: s.message }));
  const flagRefs = (ss.flags || []).map((f) => ({ type: 'self_screen_flag', key: f.code, label: f.message }));
  const refs = [...stopRefs, ...flagRefs, ...answerRefs];
  const detail = { decision: ss.decision, stops: ss.stops, flags: ss.flags };

  if ((ss.stops || []).length > 0) {
    return fail(spec, 'Self-screen stopped the opportunity: ' + ss.stops.map((s) => s.message).join(' '), refs, detail);
  }

  const bf = gate?.below_floor;
  if (bf && bf.applies && !bf.qualifying) {
    return fail(
      spec,
      'Below the AED ' + bf.floor_aed_mn + 'mn floor and the exception route is not satisfied: '
        + bf.stops.map((s) => s.message).join(' '),
      [...refs, { type: 'below_floor', key: bf.tag, label: 'Below-floor exception route' }],
      { ...detail, below_floor: bf }
    );
  }

  if ((ss.flags || []).length > 0 || (bf && bf.applies && bf.qualifying)) {
    const notes = [];
    if (bf && bf.applies && bf.qualifying) notes.push('Below-floor exception route satisfied; the case escalates to Sirius.');
    if ((ss.flags || []).length > 0) notes.push('Flags raised: ' + ss.flags.map((f) => f.code).join(', ') + '.');
    return flag(spec, 'Eligibility clear with flags. ' + notes.join(' '), refs, { ...detail, below_floor: bf || null });
  }

  return pass(spec, 'Eligibility clear: the type is within appetite and the ticket clears the AED floor.', refs, detail);
}

// 2. Gate-1 hard filters (W3-02 / SCR-03): the five standing filters. A failed
// filter recommends decline with the reason; the system never rejects on its
// own, so the check reports the recommended outcome and the reviewer decision
// where one is on the record. An unconfirmed manual filter is a flag, not a
// pending check, so it never makes the panel incomplete.
function hardFiltersCheck(spec, gate) {
  const hf = gate?.hard_filters;
  if (!hf) return na(spec, 'The Gate-1 hard filters have not been evaluated yet.');

  const items = hf.items || [];
  const refs = [];
  for (const item of items) {
    refs.push({
      type: 'hard_filter', key: item.key,
      label: item.label + ' (' + item.status.replace(/_/g, ' ') + ')',
    });
  }
  for (const f of hf.failed || []) refs.push({ type: 'hard_filter_fail', key: f.key, label: f.rationale });
  if (hf.review) {
    refs.push({ type: 'hard_filter_review', key: hf.review.decision, label: 'Reviewer ' + hf.review.decision + ': ' + hf.review.reason });
  }
  const detail = {
    version: hf.version,
    recommended_outcome: hf.recommended_outcome,
    effective_outcome: hf.effective_outcome,
    review: hf.review || null,
    failed: (hf.failed || []).map((f) => f.key),
    pending: hf.pending || [],
  };

  if (hf.recommended_outcome === 'recommended_decline') {
    return fail(spec, hf.message, refs, detail);
  }
  const flagged = items.filter((i) => i.status === 'flag');
  if (flagged.length > 0) {
    return flag(
      spec,
      'No hard filter failed. ' + flagged.length + ' filter(s) await manual confirmation: '
        + flagged.map((i) => i.label).join(', ') + '.',
      refs,
      detail
    );
  }
  return pass(spec, 'All five Gate-1 hard filters pass.', refs, detail);
}

// 3. Hurdle tests - the automatic per-scenario hurdle verdict (FIN-04). Any
// below-hurdle case is a flag, never a block, matching the financials workstream.
function hurdleCheck(spec, gate) {
  const ht = gate?.hurdle_table;
  if (!ht) return na(spec, 'The hurdle test has not been evaluated yet.');

  const scenarios = ht.scenarios || [];
  const anyValue = (ht.rows || []).some((r) => scenarios.some((s) => r.scenarios?.[s]?.present));
  if (!anyValue) return na(spec, 'No return figures are captured yet; the hurdle test runs once returns are entered.', [], { version: ht.version });

  const below = (ht.flags || []).filter((f) => f.reason === 'below_hurdle');
  const noThreshold = (ht.flags || []).filter((f) => f.reason === 'no_threshold');
  const refs = below.map((f) => ({ type: 'hurdle', key: f.key, label: f.message }));
  for (const f of noThreshold) refs.push({ type: 'hurdle_threshold', key: f.key, label: 'No threshold configured for ' + f.label });
  const detail = { version: ht.version, pass_rate: ht.pass_rate, thresholds: ht.thresholds, meets_all: ht.meets_all };

  if (below.length > 0) {
    const list = below.map((f) => f.label + ' (' + f.scenario + ')').join(', ');
    return flag(spec, 'One or more hurdles are below threshold: ' + list + '. ' + ht.message, refs, detail);
  }
  const base = ht.pass_rate?.base;
  return pass(
    spec,
    ht.message + (base != null ? ' Base case passes ' + base + '/' + (ht.rows || []).length + ' hurdles.' : ''),
    refs,
    detail
  );
}

// 4. Strategic alignment - the theme alignment score (E5). A missing theme is
// pending rather than a false pass or fail.
function alignmentCheck(spec, alignment) {
  const al = alignment;
  if (!al) return na(spec, 'Alignment has not been scored yet.');

  const refs = [];
  if (al.theme_org_id) refs.push({ type: 'theme', key: al.theme_org_id, label: 'Theme (' + (al.theme_status || 'configured') + ')' });
  for (const m of al.matched || []) refs.push({ type: 'match', key: m, label: 'Matched ' + m });
  for (const s of al.signals || []) refs.push({ type: 'signal', key: s.type, label: s.label });
  // Cite the strategy passage each graded dimension rests on (W3-13 / SCR-02).
  for (const d of al.dimensions || []) {
    if (!d.citation) continue;
    refs.push({
      type: 'strategy_citation', key: d.key,
      label: (d.citation.document_name || 'Strategy document') + ': ' + String(d.citation.text || '').slice(0, 160),
    });
  }
  const detail = { score: al.score, aligned: al.aligned, theme_status: al.theme_status };

  if (!al.has_theme) {
    return na(spec, 'No approved investment theme is configured for the owning subsidiary, so alignment cannot be scored.', refs, detail);
  }
  const reasons = (al.reasons || []).join(' ');
  const citation = (al.dimensions || []).find((d) => d.citation);
  const quote = citation
    ? ' Source: ' + (citation.citation.document_name || 'strategy document') + ' - "' + String(citation.citation.text || '').slice(0, 200) + '".'
    : '';
  if (al.aligned) return pass(spec, 'Aligned with the subsidiary theme (score ' + al.score + '/100). ' + reasons + quote, refs, detail);
  return flag(spec, 'Not aligned with the subsidiary theme (score ' + al.score + '/100). ' + reasons + quote, refs, detail);
}

// 5. Synergy & conflict - composed from the duplicate-target warning (cross-org
// readers only), the related-party self-screen flag and any declared conflict.
// The portfolio-synergy rule set is not configured yet, so this check is
// advisory and never blocks.
function synergyConflictCheck(spec, gate, duplicates, conflict) {
  const related = (gate?.self_screen?.flags || []).find((f) => f.code === 'related_party');
  const dupCount = typeof duplicates === 'number' ? duplicates : Number(duplicates?.count || 0);
  const dupMatches = duplicates?.matches || [];
  const refs = [];
  const synergy = gate?.portfolio_synergy || null;
  const conflictAnalysis = gate?.portfolio_conflict || null;
  if (dupCount > 0) {
    refs.push({ type: 'duplicate', key: 'duplicates', label: dupCount + ' possible duplicate target(s) across the group' });
    for (const m of dupMatches.slice(0, 5)) {
      refs.push({ type: 'duplicate_match', key: m.opportunity_id, label: m.opportunity_name || m.opportunity_id });
    }
  }
  if (related) refs.push({ type: 'flag', key: related.code, label: related.message });
  if (!blank(conflict)) refs.push({ type: 'conflict', key: 'conflict', label: String(conflict) });

  // The register-grounded analysis (W3-10 / SCR-07, W3-11 / SCR-06). Each
  // synergy and conflict names the affected portfolio company, so the reference
  // list carries the company, not just a count.
  for (const s of (synergy?.synergies || [])) {
    refs.push({ type: 'synergy', key: s.company_id, label: 'Synergy: ' + s.company + ' - ' + s.rationale });
  }
  for (const f of (conflictAnalysis?.flags || [])) {
    refs.push({ type: 'conflict_match', key: f.company_id, label: (f.severity === 'high' ? 'Conflict: ' : 'Overlap: ') + f.company + ' - ' + f.reason });
  }

  const signals = [];
  if (dupCount > 0) signals.push(dupCount + ' possible duplicate target(s) across the group');
  if (related) signals.push('related-party / affiliate involvement declared');
  if (!blank(conflict)) signals.push('declared conflict of interest');
  if (conflictAnalysis?.unmitigable_count > 0) signals.push(conflictAnalysis.unmitigable_count + ' un-mitigable portfolio overlap(s)');
  else if (conflictAnalysis?.flag_count > 0) signals.push(conflictAnalysis.flag_count + ' portfolio overlap(s)');
  if (conflictAnalysis?.concentration?.breach) signals.push('post-deal ' + conflictAnalysis.concentration.sector + ' concentration ' + conflictAnalysis.concentration.post_deal_pct + '% exceeds the ' + conflictAnalysis.concentration.max_pct + '% ceiling');

  const detail = {
    duplicate_count: dupCount,
    related_party: Boolean(related),
    conflict: blank(conflict) ? null : String(conflict),
    synergy_count: synergy?.synergy_count ?? null,
    synergies: (synergy?.synergies || []).map((s) => ({ company: s.company, strength: s.strength, signoff: s.signoff })),
    synergy_signoff_marker: synergy?.signoff_marker || null,
    conflict_flag_count: conflictAnalysis?.flag_count ?? null,
    conflict_companies: (conflictAnalysis?.flags || []).map((f) => ({ company: f.company, severity: f.severity })),
    concentration: conflictAnalysis?.concentration || null,
  };

  const synergyNote = synergy?.synergy_count
    ? synergy.synergy_count + ' portfolio synergy match(es) - every claim ' + (synergy.signoff_marker || 'requires operating-company sign-off') + '.'
    : 'No portfolio synergy match found.';

  if (signals.length > 0) {
    const fail = (conflictAnalysis?.unmitigable_count || 0) > 0;
    const line = 'Portfolio overlap: ' + signals.join('; ') + '. ' + synergyNote + ' Advisory - the reviewer confirms whether any overlap is un-mitigable.';
    return fail ? makeCheck(spec, { result: 'fail', rationale: line, evidence_refs: refs, detail })
      : flag(spec, line, refs, detail);
  }
  return pass(spec, 'No duplicate-target, related-party or declared-conflict signal detected. ' + synergyNote, refs, detail);
}

// 6. Completeness sufficiency - required fields, required documents and the
// financial pack (statement model, reporting currency / FX).
function completenessCheck(spec, gate) {
  if (!gate) return na(spec, 'Completeness has not been evaluated yet.');

  const missingFields = (gate.missing || []).filter((m) => m.type === 'field');
  const missingDocs = (gate.missing || []).filter((m) => m.type === 'document');
  const refs = [];
  for (const m of missingFields) refs.push({ type: 'field', key: m.key, label: m.label || m.key });
  for (const m of missingDocs) refs.push({ type: 'document', key: m.key, label: m.label || m.key });

  const advisoryNotes = [];
  const financialNotes = [];
  const sm = gate.statement_model;
  if (sm && sm.attached && !sm.complete) financialNotes.push(sm.message);
  const cur = gate.currency;
  if (cur && !cur.complete) financialNotes.push(cur.message);
  // The content sufficiency check (W5-03 / DOC-04) is the reviewer-side half of
  // the "flags to preparer pre-submit and reviewer post" criterion: its open
  // advisory flags are named here with a reference each, so the reviewer sees
  // thin content on the same panel as every other check.
  const suff = gate.sufficiency;
  const suffOpen = (suff && suff.open_flags) || [];
  for (const flag of suffOpen) {
    advisoryNotes.push('Content sufficiency: ' + flag.label + ' (' + flag.observed + ').');
    refs.push({ type: 'sufficiency', key: flag.key, label: flag.label });
  }
  for (const note of financialNotes) {
    advisoryNotes.push(note);
    refs.push({ type: 'financial_pack', key: 'financial_pack', label: note });
  }

  const detail = {
    completeness: gate.completeness,
    missing_fields: missingFields.map((m) => m.key),
    missing_documents: missingDocs.map((m) => m.key),
    statement_model: sm ? { complete: sm.complete, flagged_for_review: sm.flagged_for_review } : null,
    currency: cur ? { currency: cur.currency, complete: cur.complete } : null,
    sufficiency: suff ? { sufficient: suff.sufficient, open_count: suff.open_count, open_flags: suffOpen.map((f) => f.key) } : null,
  };

  if (missingFields.length > 0 || missingDocs.length > 0) {
    return fail(
      spec,
      'Completeness ' + gate.completeness + '%: ' + missingFields.length + ' required field(s) and '
        + missingDocs.length + ' required document(s) outstanding.'
        + (advisoryNotes.length ? ' ' + advisoryNotes.join(' ') : ''),
      refs,
      detail
    );
  }
  if (advisoryNotes.length > 0) {
    return flag(spec, 'Required fields and documents are complete; financial-pack notes: ' + advisoryNotes.join(' '), refs, detail);
  }
  return pass(spec, 'Required fields and documents are complete (' + gate.completeness + '%).', refs, detail);
}

/**
 * Compose the single screening panel from the already-computed blocks.
 * Pure: no database, no network.
 *
 * @param {object}  input
 * @param {object}  input.gate       the evaluateGate() result (may be null)
 * @param {object}  input.alignment  the evaluateAlignment() result (may be null)
 * @param {object|number|null} input.duplicates  duplicate matches or a count
 * @param {string|null} input.conflict  a declared conflict of interest
 * @param {string|null} input.evaluated_at  an ISO timestamp override (tests)
 *
 * Returns the six ordered checks plus a summary. summary.recommended is a
 * recommendation for the person taking the screening decision, never a decision.
 */
export function evaluateScreeningPanel({
  gate = null, alignment = null, duplicates = null, conflict = null, evaluated_at = null,
  qualityScoreConfig = null,
} = {}) {
  const spec = (key) => SCREENING_CHECKS.find((c) => c.key === key);

  const checks = [
    eligibilityCheck(spec('eligibility'), gate),
    hardFiltersCheck(spec('hard_filters'), gate),
    hurdleCheck(spec('hurdle_tests'), gate),
    alignmentCheck(spec('alignment'), alignment),
    synergyConflictCheck(spec('synergy_conflict'), gate, duplicates, conflict),
    completenessCheck(spec('completeness'), gate),
  ].sort((a, b) => a.order - b.order);

  const counts = { pass: 0, flag: 0, fail: 0, not_applicable: 0 };
  for (const c of checks) counts[c.result] += 1;

  const blockingKeys = checks.filter((c) => c.result === 'fail').map((c) => c.key);
  const flaggedKeys = checks.filter((c) => c.result === 'flag').map((c) => c.key);
  const advisoryOpen = checks.filter((c) => c.advisory && c.result === 'not_applicable').map((c) => c.key);
  const requiredChecks = checks.filter((c) => !c.advisory);
  const complete = requiredChecks.every((c) => !c.pending);

  const recommended = counts.fail > 0 ? 'stop' : (counts.flag > 0 ? 'review' : 'pass');
  const blockingLabels = checks.filter((c) => c.result === 'fail').map((c) => c.label);
  const flaggedLabels = checks.filter((c) => c.result === 'flag').map((c) => c.label);

  let message;
  if (counts.fail > 0) message = SCREENING_MESSAGES.blocking + ' Open: ' + blockingLabels.join(', ') + '.';
  else if (counts.flag > 0) message = SCREENING_MESSAGES.flagged + ' Flagged: ' + flaggedLabels.join(', ') + '.';
  else message = SCREENING_MESSAGES.all_pass;

  const flags = checks
    .filter((c) => c.result === 'fail' || c.result === 'flag')
    .map((c) => ({ key: c.key, label: c.label, result: c.result, rationale: c.rationale }));

  return {
    version: SCREENING_PANEL_VERSION,
    sla_minutes: SCREENING_SLA_MINUTES,
    generated_at: evaluated_at || new Date().toISOString(),
    disclaimer: SCREENING_DISCLAIMER,
    checks,
    check_count: checks.length,
    summary: {
      total: checks.length,
      counts,
      blocking: blockingKeys,
      flagged: flaggedKeys,
      advisory_open: advisoryOpen,
      recommended,
      complete,
    },
    complete,
    flags,
    message,
    // Gate 1 soft filters (W3-03 / SCR-04) are a scored set, not one of the six
    // Portfolio conflict / concentration (W3-10 / SCR-07) and portfolio synergy
    // (W3-11 / SCR-06) ride along as their own sections so the board can render
    // them directly, alongside the composed synergy & conflict check.
    portfolio_conflict: gate?.portfolio_conflict || null,
    portfolio_synergy: gate?.portfolio_synergy || null,
    // Sirius group mandate fit (W4-04 / ENT-03) rides along as its own section:
    // the advisory in-scope test against the versioned group mandate. It never
    // contributes to the recommendation.
    mandate_fit: gate?.mandate_fit || null,
    // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08) rides
    // along as its own section so the panel can show the verdict, the note and
    // the evidence held on the record.
    adverse_media: gate?.adverse_media || null,
    // BRD checks, so they ride along as their own section rather than a check.
    // Scored 1-5; never used to kill a deal.
    soft_filters: gate?.soft_filters || null,
    // Automatic disqualifier flags (W3-04 / SCR-05) are named flags on the
    // record, not one of the six BRD checks, so they ride along as their own
    // section. A flag is prominent and a clearing needs a named reviewer.
    disqualifiers: gate?.disqualifiers || null,
    // Gate 2 weighted scorecard (W3-05 / SCO-02) is the second-gate quantitative
    // screen, not one of the six Gate-1 checks, so it rides along as its own
    // section. Seven weighted 1-5 criteria, a 3.5 pass bar and the CIO override.
    scorecard: gate?.scorecard || null,
    // Overall pre-screening quality score (W3-09 / SCO-01): the six gate signals
    // rolled into a single advisory 0-100% score with a component breakdown and
    // configurable bands. Advisory only; it never takes the decision.
    quality_score: evaluateQualityScore(
      { gate, alignment },
      qualityScoreConfig
        ? { components: qualityScoreConfig.components, bands: qualityScoreConfig.bands, version: qualityScoreConfig.version }
        : {}
    ),
  };
}

export default {
  SCREENING_PANEL_VERSION, SCREENING_SLA_MINUTES, SCREENING_RESULTS,
  SCREENING_DISCLAIMER, SCREENING_MESSAGES, SCREENING_CHECKS, SCREENING_CHECK_KEYS,
  evaluateScreeningPanel,
};
