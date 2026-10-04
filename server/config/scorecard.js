// ---------------------------------------------------------------------------
// Gate 2 weighted scorecard (W3-05 / BRD SCO-02, REQ-GATE-02).
//
// Source of truth: the Sirius "Gate 2 - Quantitative Screen Scorecard"
// (D4). Seven criteria, each scored 1-5, each carrying a weight; the weights
// sum to 100%. The weighted total is computed on the same scale (1-5) and a
// total of 3.5 or above proceeds; below 3.5 the opportunity cannot proceed to
// Gate 3 without an explicit CIO override memo (a named CIO and a written
// reason).
//
// This module is pure: the criteria, weights, thresholds and messages are
// passed in or read from this file, so the board, the gate, the memo and the
// tests read one source of truth (REQ-RULE-10). The weights and the 3.5 pass
// bar are configuration - the IC may recalibrate them without a code change
// (SCO-05), and every assessment keeps the version it was scored under.
// ---------------------------------------------------------------------------

export const SCORECARD_VERSION = 'SC-01.3';

// The 1-5 scale shared with the soft filters (a single scoring vocabulary).
export const SCORECARD_SCALE = [
  { value: 1, label: 'Well below threshold' },
  { value: 2, label: 'Below threshold' },
  { value: 3, label: 'Meets threshold' },
  { value: 4, label: 'Exceeds threshold' },
  { value: 5, label: 'Materially exceeds' },
];

export const SCORECARD_MIN_SCORE = 1;
export const SCORECARD_MAX_SCORE = 5;

// Weights are whole percentages so a reviewer can see them sum to 100 directly.
export const SCORECARD_WEIGHT_TOTAL = 100;

// The pass bar: a weighted total of 3.5 or above proceeds. Below it, an
// explicit CIO override memo is required (REQ-GATE-02).
export const SCORECARD_PASS_THRESHOLD = 3.5;

// The two-lens floor (W3-06 / BRD SCO-04). The seven criteria group into a
// strategic lens and a financial lens; each lens carries its own weighted
// sub-total on the same 1-5 scale, and both must clear a floor. A strong score
// in one lens can never mask a weak score in the other: a deal whose weighted
// total clears 3.5 but whose strategic or financial sub-total sits below the
// floor still cannot proceed without the explicit CIO override memo.
export const SCORECARD_LENS_FLOOR = 3.0;

export const SCORECARD_LENSES = [
  {
    key: 'strategic',
    label: 'Strategic lens',
    description: 'Fit, scale, control and the path to liquidity - the strategic case for the deal.',
    criteria: ['revenue_scale', 'growth_rate', 'ownership_control', 'path_to_liquidity'],
  },
  {
    key: 'financial',
    label: 'Financial lens',
    description: 'Entry value, the capital structure and unit economics - the financial case for the deal.',
    criteria: ['entry_valuation', 'capital_structure', 'unit_economics'],
  },
];

export const SCORECARD_REASON_MIN = 10;
export const SCORECARD_TAG = 'scorecard';
export const SCORECARD_OVERRIDE_TAG = 'scorecard_override';

// System-proposed scores (W3-07 / BRD SCO-03). The system proposes a 1-5 score
// for every criterion from the structured data already on the record; the
// reviewer confirms the proposal or adjusts it. An adjustment must carry a
// written comment, and both the proposal and the final score are kept on the
// record so a later reader can see what changed and why.
export const SCORECARD_ADJUST_REASON_MIN = 10;
export const SCORECARD_NEUTRAL_SCORE = 3;

// Scorecard configuration (W3-08 / BRD SCO-05). The criteria, their weights,
// the pass bar, the two lenses and the lens floor are configuration, not code:
// an administrator can recalibrate them, and every recalibration mints a new
// revision. Each assessment keeps the version - and the criteria weights - it
// was scored under, so a later recalibration never silently recalculates a
// historical score. The configuration lives on the AppSettings entity under a
// single setting key; this module resolves the effective set and validates any
// proposed change purely.
export const SCORECARD_CONFIG_KEY = 'scorecard_config';
export const SCORECARD_CONFIG_DEFAULT_REVISION = 3;
export const SCORECARD_VERSION_PREFIX = 'SC-01.';

// The shipped (default) scorecard configuration, in the shape the admin console
// stores and the gate resolves. Every field is configuration an administrator
// can change; the revision numbers every recalibration.
export function defaultScorecardConfig() {
  return {
    revision: SCORECARD_CONFIG_DEFAULT_REVISION,
    version: SCORECARD_VERSION,
    pass_threshold: SCORECARD_PASS_THRESHOLD,
    lens_floor: SCORECARD_LENS_FLOOR,
    criteria: SCORECARD_ITEMS.map((i) => ({ ...i, guide: { ...i.guide } })),
    lenses: SCORECARD_LENSES.map((l) => ({ ...l, criteria: l.criteria.slice() })),
  };
}

const versionFor = (revision) => SCORECARD_VERSION_PREFIX + revision;

// Normalise and validate a proposed scorecard configuration against the
// shipped defaults. Pure. Returns { ok, errors, config }: config is the
// resolved set to persist when ok, and a best-effort set otherwise. A
// recalibrated weight set that does not total 100, an unknown criterion, a
// score outside 1-5, a lens that references an unknown criterion or a floor
// outside the 1-5 scale are all refused (SCO-05).
export function validateScorecardConfig(input = {}, { base = defaultScorecardConfig() } = {}) {
  const errors = [];
  const rawCriteria = Array.isArray(input.criteria) && input.criteria.length
    ? input.criteria
    : base.criteria;

  const criteria = rawCriteria.map((c, idx) => {
    const key = String(c.key || '').trim();
    const weight = Number(c.weight);
    if (!key) errors.push('Every criterion needs a key.');
    if (!Number.isFinite(weight) || weight < 0) errors.push('Criterion ' + (key || idx) + ' needs a non-negative weight.');
    return {
      key,
      label: String(c.label || key),
      weight: Number.isFinite(weight) ? weight : 0,
      order: Number.isFinite(Number(c.order)) ? Number(c.order) : idx + 1,
      threshold: c.threshold != null ? String(c.threshold) : null,
      guide: c.guide && typeof c.guide === 'object' ? { ...c.guide } : null,
    };
  });

  const weightTotal = criteria.reduce((t, c) => t + c.weight, 0);
  if (weightTotal !== SCORECARD_WEIGHT_TOTAL) {
    errors.push(SCORECARD_MESSAGES.weight_mismatch + ' (currently ' + weightTotal + '%).');
  }

  const keys = criteria.map((c) => c.key);
  if (new Set(keys).size !== keys.length) errors.push('Criterion keys must be unique.');

  const rawLenses = Array.isArray(input.lenses) && input.lenses.length ? input.lenses : base.lenses;
  const lenses = rawLenses.map((l) => {
    const members = Array.isArray(l.criteria) ? l.criteria.map((k) => String(k)) : [];
    for (const k of members) {
      if (!keys.includes(k)) errors.push('Lens ' + (l.key || '?') + ' references an unknown criterion: ' + k + '.');
    }
    if (!members.length) errors.push('Lens ' + (l.key || '?') + ' must reference at least one criterion.');
    return {
      key: String(l.key || '').trim(),
      label: String(l.label || l.key || ''),
      description: l.description != null ? String(l.description) : null,
      criteria: members,
    };
  });

  const passThreshold = Number(input.pass_threshold != null ? input.pass_threshold : base.pass_threshold);
  if (!Number.isFinite(passThreshold) || passThreshold < SCORECARD_MIN_SCORE || passThreshold > SCORECARD_MAX_SCORE) {
    errors.push('The pass bar must be between ' + SCORECARD_MIN_SCORE + ' and ' + SCORECARD_MAX_SCORE + '.');
  }
  const lensFloor = Number(input.lens_floor != null ? input.lens_floor : base.lens_floor);
  if (!Number.isFinite(lensFloor) || lensFloor < SCORECARD_MIN_SCORE || lensFloor > SCORECARD_MAX_SCORE) {
    errors.push('The lens floor must be between ' + SCORECARD_MIN_SCORE + ' and ' + SCORECARD_MAX_SCORE + '.');
  }

  const revision = Number.isInteger(input.revision) && input.revision >= 1 ? input.revision : base.revision;
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    config: {
      revision,
      version: input.version || versionFor(revision),
      pass_threshold: Number.isFinite(passThreshold) ? passThreshold : base.pass_threshold,
      lens_floor: Number.isFinite(lensFloor) ? lensFloor : base.lens_floor,
      criteria,
      lenses,
    },
  };
}

// Resolve a stored configuration (from AppSettings) into the effective set,
// falling back to the shipped defaults when nothing valid is stored. Pure.
export function resolveScorecardConfig(stored) {
  const base = defaultScorecardConfig();
  if (!stored) return base;
  const parsed = typeof stored === 'string' ? safeJson(stored) : stored;
  if (!parsed || typeof parsed !== 'object') return base;
  const { ok, config } = validateScorecardConfig(parsed, { base });
  if (!ok) return base;
  return { ...config, updated_by: parsed.updated_by || null, updated_at: parsed.updated_at || null };
}

function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }

// A short, human-readable diff between two configurations, for the audit trail
// and the admin confirmation (SCO-05).
export function diffScorecardConfig(base = defaultScorecardConfig(), next = defaultScorecardConfig()) {
  const changes = [];
  if (base.pass_threshold !== next.pass_threshold) {
    changes.push({ field: 'pass_threshold', from: base.pass_threshold, to: next.pass_threshold });
  }
  if (base.lens_floor !== next.lens_floor) {
    changes.push({ field: 'lens_floor', from: base.lens_floor, to: next.lens_floor });
  }
  const baseByKey = Object.fromEntries(base.criteria.map((c) => [c.key, c]));
  for (const c of next.criteria) {
    const prev = baseByKey[c.key];
    if (!prev) changes.push({ field: 'criterion_added', key: c.key, to: c.weight });
    else if (prev.weight !== c.weight) changes.push({ field: 'weight', key: c.key, from: prev.weight, to: c.weight });
  }
  for (const c of base.criteria) {
    if (!next.criteria.some((n) => n.key === c.key)) changes.push({ field: 'criterion_removed', key: c.key, from: c.weight });
  }
  const lensKeys = next.lenses.map((l) => l.key).join(',');
  const baseLensKeys = base.lenses.map((l) => l.key).join(',');
  if (lensKeys !== baseLensKeys) changes.push({ field: 'lenses', from: baseLensKeys, to: lensKeys });
  return changes;
}

// Validate a proposed recalibration from the admin console and mint the next
// revision. Pure. Returns the record to persist, or throws a 400-shaped error.
export function buildScorecardConfig(body = {}, { actor = null, at = null, base = defaultScorecardConfig() } = {}) {
  const { ok, errors, config } = validateScorecardConfig({ ...body, revision: base.revision + 1, version: null }, { base });
  if (!ok) {
    const e = new Error(SCORECARD_MESSAGES.config_invalid + ' ' + errors.join(' '));
    e.status = 400;
    e.errors = errors;
    throw e;
  }
  return {
    ...config,
    version: versionFor(config.revision),
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
}

// Below-threshold outcomes. 'proceed' clears the bar; 'override_required' needs
// the CIO memo; 'proceed_override' is the same deal after the memo is filed.
export const SCORECARD_OUTCOMES = ['proceed', 'override_required', 'proceed_override'];

// The seven Gate-2 criteria in scorecard order (D4), with the illustrative
// threshold and the 1-5 scoring guide condensed from the Scoring Guide tab.
export const SCORECARD_ITEMS = [
  {
    key: 'revenue_scale', label: 'Revenue scale / trajectory', weight: 15, order: 1,
    threshold: 'Minimum scale for stage, or a credible path within 24 months',
    guide: {
      1: 'Below minimum scale with no credible path to it',
      2: 'Below minimum scale; path is speculative',
      3: 'At minimum scale, or a credible path within 24 months',
      4: 'Ahead of scale target with visible momentum',
      5: 'Materially ahead of scale target with a de-risked trajectory',
    },
  },
  {
    key: 'growth_rate', label: 'Growth rate', weight: 15, order: 2,
    threshold: '≥ 25% YoY growth-stage; sector-appropriate for mature assets',
    guide: {
      1: 'Far below sector-appropriate growth; decelerating without explanation',
      2: 'Below sector-appropriate growth',
      3: '≥ 25% YoY (growth-stage) or in line with sector norms (mature)',
      4: 'Growth meaningfully above sector norms, sustained ≥ 2 periods',
      5: 'Top-decile growth for the sector with credible durability',
    },
  },
  {
    key: 'entry_valuation', label: 'Entry valuation vs. comps', weight: 20, order: 3,
    threshold: 'Within a defensible 3-5 name comp set',
    guide: {
      1: 'Above the tightest defensible comp by more than 20% without justification',
      2: 'Above the defensible range of the comp set',
      3: 'Within the defensible range of the 3-5 name comp set',
      4: 'At or below the low end of the comp range',
      5: 'Meaningful discount to comps with no quality trade-off identified',
    },
  },
  {
    key: 'ownership_control', label: 'Target ownership / control', weight: 10, order: 4,
    threshold: 'Minimum stake for a board seat plus information rights',
    guide: {
      1: 'Below the stake needed for a board seat or information rights',
      2: 'Below the stake needed for board seat and information rights',
      3: 'Meets the minimum stake for board seat plus information rights',
      4: 'Stake plus enhanced minority protections (veto rights, pro-rata)',
      5: 'Stake plus board control or equivalent influence',
    },
  },
  {
    key: 'capital_structure', label: 'Capital structure', weight: 10, order: 5,
    threshold: 'No debt/preference stack subordinating Sirius below acceptable recovery',
    guide: {
      1: 'Debt/preference stack subordinates Sirius below acceptable recovery',
      2: 'Recovery position is under pressure with unresolved red flags',
      3: 'Recovery position acceptable; no red flags',
      4: 'Clean structure with limited leverage and standard protections',
      5: 'Clean structure with strong downside protection (liquidation preference, covenants)',
    },
  },
  {
    key: 'path_to_liquidity', label: 'Path to liquidity', weight: 15, order: 6,
    threshold: 'Identifiable exit route within a 4-7 year horizon',
    guide: {
      1: 'No identifiable exit route, or the route exceeds 7 years',
      2: 'A route is conceivable but not evidenced within the horizon',
      3: 'Identifiable exit route within a 4-7 year horizon',
      4: 'Multiple credible exit routes within the horizon',
      5: 'Near-term, high-confidence exit route (signed process, strategic interest)',
    },
  },
  {
    key: 'unit_economics', label: 'Unit economics', weight: 15, order: 7,
    threshold: 'Gross margin and payback consistent with sector benchmarks, or an evidenced path',
    guide: {
      1: 'Gross margin or payback below sector benchmark with no credible path',
      2: 'Below sector benchmark; the path is not yet evidenced',
      3: 'Consistent with sector benchmark, or an evidenced path to it',
      4: 'Above sector benchmark with a demonstrated trend',
      5: 'Best-in-class unit economics for the sector',
    },
  },
];

export const SCORECARD_KEYS = SCORECARD_ITEMS.map((i) => i.key);

// The captured score/note field per criterion: scorecard_<key> and _note.
export const SCORECARD_FIELDS = Object.fromEntries(
  SCORECARD_ITEMS.flatMap((i) => [
    ['score_' + i.key, 'scorecard_' + i.key],
    ['note_' + i.key, 'scorecard_' + i.key + '_note'],
  ])
);

// Operator-facing messages kept in configuration (REQ-RULE-10).
export const SCORECARD_MESSAGES = {
  weights_ok: 'The Gate 2 weights sum to ' + SCORECARD_WEIGHT_TOTAL + '%.',
  score_range: 'Every Gate 2 score must be a whole number from ' + SCORECARD_MIN_SCORE + ' to ' + SCORECARD_MAX_SCORE + '.',
  incomplete: 'Every Gate 2 criterion must be scored before the weighted total is final.',
  proceed: 'The weighted total clears the ' + SCORECARD_PASS_THRESHOLD + ' pass bar; the opportunity may proceed to Gate 3.',
  override_required: 'The weighted total is below the ' + SCORECARD_PASS_THRESHOLD + ' pass bar; an explicit CIO override memo is required to proceed.',
  below_lens_floor: 'The weighted total clears the ' + SCORECARD_PASS_THRESHOLD + ' pass bar, but a lens sub-total is below the ' + SCORECARD_LENS_FLOOR + ' floor; an explicit CIO override memo is required to proceed.',
  override_provided: 'The CIO override memo is on file; the opportunity may proceed below the pass bar.',
  reason_required: 'A written reason of at least ' + SCORECARD_REASON_MIN + ' characters is required.',
  weight_mismatch: 'The Gate 2 weights must sum to ' + SCORECARD_WEIGHT_TOTAL + '%.',
  proposed: 'A score is proposed for every Gate 2 criterion from the data on the record; the reviewer confirms or adjusts each score.',
  awaiting_review: 'A score is proposed for every Gate 2 criterion. The reviewer confirms or adjusts each score; an adjustment needs a written comment.',
  adjust_comment_required: 'A written comment of at least ' + SCORECARD_ADJUST_REASON_MIN + ' characters is required when a score is adjusted away from the system proposal.',
  config_invalid: 'The proposed scorecard configuration is invalid:',
  config_saved: 'The scorecard configuration was saved under a new revision.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const clampScore = (n) => Math.max(SCORECARD_MIN_SCORE, Math.min(SCORECARD_MAX_SCORE, Math.round(n)));
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => {
  if (blank(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const seed = (key) => {
  const band = SCORECARD_SCALE.find((s) => s.value === SCORECARD_NEUTRAL_SCORE);
  return { key, score: SCORECARD_NEUTRAL_SCORE, band: band ? band.label : null, refs: [], detail: {} };
};

// System-proposed scores (W3-07 / SCO-03). Each proposal is derived from the
// structured data already on the record: the page-4 financial table for the
// growth and unit-economics criteria, the captured entry valuation and
// comparables for the entry-valuation criterion, the snapshot and strategy for
// the scale and control criteria, and so on. Every proposal carries the score,
// the band label and the evidence it read; where the data is not yet captured
// the criterion is proposed neutral (3) with a note saying so, never a silent
// pass. The reviewer confirms or adjusts; an adjustment needs a written comment.
const FIN_GROWTH = 'financials';

// The latest captured growth % from the page-4 financial matrix (any period).
function latestGrowth(data) {
  const matrix = data[FIN_GROWTH];
  if (!matrix || typeof matrix !== 'object' || !matrix.growth || typeof matrix.growth !== 'object') return null;
  const values = Object.values(matrix.growth).map((v) => num(v)).filter((v) => v !== null);
  return values.length ? values[values.length - 1] : null;
}

export function proposeScorecardItem(key, data = {}) {
  const p = seed(key);
  const what = [data.narrative_what, data.strategic_objective, data.rationale_evidence].filter(Boolean).join(' ');

  if (key === 'revenue_scale') {
    const rev = num(data.snapshot_revenue_last_fy_aed);
    if (rev !== null) {
      p.refs.push({ type: 'financial', key: 'snapshot_revenue_last_fy_aed', label: 'Revenue last FY: AED ' + rev + ' mn' });
      p.detail = { revenue_last_fy_aed: rev };
      p.score = rev >= 200 ? 5 : rev >= 100 ? 4 : rev >= 50 ? 3 : 2;
      p.band = labelFor(p.score);
      return p;
    }
    if (what.length > 40) {
      p.refs.push({ type: 'narrative', key: 'narrative_what', label: 'Scale / trajectory described in the narrative' });
      p.detail = { narrative: true };
      return p;
    }
    return p;
  }

  if (key === 'growth_rate') {
    const g = latestGrowth(data);
    if (g !== null) {
      p.refs.push({ type: 'financial', key: 'financials', label: 'Latest captured growth: ' + g + '%' });
      p.detail = { growth_pct: g };
      p.score = g >= 35 ? 5 : g >= 25 ? 4 : g >= 15 ? 3 : g >= 5 ? 2 : 1;
      p.band = labelFor(p.score);
      return p;
    }
    return p;
  }

  if (key === 'entry_valuation') {
    const method = data.entry_valuation_method;
    const multiple = num(data.entry_multiple);
    const comps = data.valuation_comparables && typeof data.valuation_comparables === 'object'
      ? (Array.isArray(data.valuation_comparables.comparables) ? data.valuation_comparables.comparables.length : 0)
      : 0;
    if (method || multiple !== null || comps) {
      if (method) p.refs.push({ type: 'valuation', key: 'entry_valuation_method', label: 'Method: ' + method });
      if (multiple !== null) p.refs.push({ type: 'valuation', key: 'entry_multiple', label: 'Entry multiple: ' + multiple + 'x' });
      if (comps) p.refs.push({ type: 'comps', key: 'valuation_comparables', label: comps + ' comparable(s) captured' });
      p.detail = { method: method ?? null, entry_multiple: multiple, comparables: comps };
      p.score = comps >= 3 ? 4 : comps >= 1 ? 3 : 3;
      p.band = labelFor(p.score);
      return p;
    }
    return p;
  }

  if (key === 'ownership_control') {
    const own = data.snapshot_current_ownership;
    if (!blank(own)) {
      p.refs.push({ type: 'ownership', key: 'snapshot_current_ownership', label: 'Current ownership: ' + own });
      p.detail = { current_ownership: String(own) };
      return p;
    }
    return p;
  }

  if (key === 'capital_structure') {
    const lev = num(data.financials?.leverage?.latest) ?? num(data.leverage) ?? num(data.net_debt_ebitda);
    if (lev !== null) {
      p.refs.push({ type: 'financial', key: 'leverage', label: 'Net debt / EBITDA: ' + lev + 'x' });
      p.detail = { leverage: lev };
      p.score = lev <= 2 ? 4 : lev <= 3 ? 3 : 2;
      p.band = labelFor(p.score);
      return p;
    }
    return p;
  }

  if (key === 'path_to_liquidity') {
    const route = data.exit_route;
    const timing = data.exit_timing;
    if (!blank(route) || !blank(timing)) {
      if (!blank(route)) p.refs.push({ type: 'exit', key: 'exit_route', label: 'Exit route: ' + route });
      if (!blank(timing)) p.refs.push({ type: 'exit', key: 'exit_timing', label: 'Exit timing: ' + timing });
      p.detail = { exit_route: route ?? null, exit_timing: timing ?? null };
      p.score = !blank(route) && !blank(timing) ? 4 : 3;
      p.band = labelFor(p.score);
      return p;
    }
    return p;
  }

  if (key === 'unit_economics') {
    const rev = num(data.snapshot_revenue_last_fy_aed);
    const ebitda = num(data.snapshot_ebitda_last_fy_aed);
    if (rev && ebitda !== null) {
      const margin = round2((ebitda / rev) * 100);
      p.refs.push({ type: 'financial', key: 'snapshot_ebitda_last_fy_aed', label: 'EBITDA margin last FY: ' + margin + '%' });
      p.detail = { ebitda_margin_pct: margin };
      p.score = margin >= 25 ? 4 : margin >= 15 ? 3 : 2;
      p.band = labelFor(p.score);
      return p;
    }
    return p;
  }

  return p;
}

function labelFor(score) {
  const band = SCORECARD_SCALE.find((s) => s.value === clampScore(score));
  return band ? band.label : null;
}

// Validate a criteria set (or the default) so a recalibrated weight set can
// never silently mis-total (SCO-05). Returns {ok, total, message}.
export function validateWeights(items = SCORECARD_ITEMS) {
  const total = items.reduce((t, i) => t + Number(i.weight || 0), 0);
  const ok = total === SCORECARD_WEIGHT_TOTAL;
  return { ok, total, message: ok ? SCORECARD_MESSAGES.weights_ok : SCORECARD_MESSAGES.weight_mismatch };
}

const captured = (data) => (data[SCORECARD_TAG] && typeof data[SCORECARD_TAG] === 'object'
  ? data[SCORECARD_TAG]
  : null);

// Read the captured score for a criterion from the opportunity data. The score
// recorded through the capture route (data.scorecard.scores) wins; a flat
// scorecard_<key> field is the fallback. A blank is null (not scored), never a
// silent zero.
export function capturedScore(data = {}, key) {
  const tag = captured(data);
  const raw = tag?.scores && tag.scores[key] != null ? tag.scores[key] : data[SCORECARD_FIELDS['score_' + key]];
  if (blank(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampScore(n) : null;
}

// Read the captured note for a criterion (from the tag, then the flat field).
export function capturedNote(data = {}, key) {
  const tag = captured(data);
  const raw = tag?.notes && tag.notes[key] != null ? tag.notes[key] : data[SCORECARD_FIELDS['note_' + key]];
  return blank(raw) ? null : String(raw);
}

// Group the scored criteria into the two lenses and compute each weighted
// sub-total on the same 1-5 scale. A lens is complete only when every one of
// its criteria is scored; its sub-total is the weight-normalised weighted
// average, so it is directly comparable to the overall pass bar and the floor.
export function evaluateLenses(items = [], { floor = SCORECARD_LENS_FLOOR, lenses = SCORECARD_LENSES } = {}) {
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  return lenses.map((lens) => {
    const members = lens.criteria.map((k) => byKey[k]).filter(Boolean);
    const lensWeight = members.reduce((t, m) => t + Number(m.weight || 0), 0);
    const scored = members.filter((m) => m.scored);
    const complete = members.length > 0 && scored.length === members.length;
    const subtotal = scored.length && lensWeight
      ? round2(scored.reduce((t, m) => t + (m.score * Number(m.weight || 0)), 0) / lensWeight)
      : null;
    const belowFloor = complete && subtotal < floor;
    return {
      key: lens.key,
      label: lens.label,
      description: lens.description,
      floor,
      criteria: lens.criteria.slice(),
      weight: lensWeight,
      item_count: members.length,
      scored_count: scored.length,
      complete,
      subtotal,
      below_floor: belowFloor,
    };
  });
}

/**
 * Evaluate the Gate-2 weighted scorecard. Pure.
 *
 * @param {object} data  the opportunity data (carries the captured 1-5 scores)
 * @param {object} options
 * @param {Array}  options.criteria  the criteria + weights (defaults to D4)
 *
 * Returns each criterion with its score, weight and weighted contribution, the
 * weight validation, the weighted total on the 1-5 scale, the pass/override
 * outcome, and the recorded CIO override memo when one is on file.
 */
export function evaluateScorecard(data = {}, { criteria = SCORECARD_ITEMS, lenses = SCORECARD_LENSES, passThreshold = SCORECARD_PASS_THRESHOLD, lensFloor = SCORECARD_LENS_FLOOR, version = SCORECARD_VERSION } = {}) {
  const weights = validateWeights(criteria);

  const items = criteria.map((c) => {
    const recorded = capturedScore(data, c.key);
    const proposal = proposeScorecardItem(c.key, data);
    const score = recorded != null ? recorded : proposal.score;
    const hasReview = recorded != null;
    const note = capturedNote(data, c.key);
    const weighted = hasReview ? round2((score * Number(c.weight || 0)) / SCORECARD_WEIGHT_TOTAL) : null;
    return {
      key: c.key,
      label: c.label,
      order: c.order,
      weight: Number(c.weight || 0),
      threshold: c.threshold,
      guide: c.guide,
      score,
      recorded,
      has_review: hasReview,
      proposed_score: proposal.score,
      proposed_label: proposal.band,
      proposed_refs: proposal.refs,
      proposed_detail: proposal.detail,
      adjusted: hasReview && recorded !== proposal.score,
      scored: hasReview,
      weighted,
      note,
      field: SCORECARD_FIELDS['score_' + c.key],
      note_field: SCORECARD_FIELDS['note_' + c.key],
    };
  }).sort((a, b) => a.order - b.order);

  const scored = items.filter((i) => i.scored);
  const total = scored.length === items.length
    ? round2(scored.reduce((t, i) => t + i.weighted, 0))
    : (scored.length ? round2(scored.reduce((t, i) => t + (i.score * i.weight) / SCORECARD_WEIGHT_TOTAL, 0)) : null);
  // The proposed scores are a starting point (SCO-03): the scored count covers
  // only criteria the reviewer has confirmed, so a pure proposal set never
  // reads as a passed gate. reviewed is exposure for the UI; complete gates the
  // total and the outcome.
  const reviewed = items.every((i) => i.has_review);
  const complete = scored.length === items.length;

  // The two-lens floor (W3-06 / SCO-04): strategic and financial sub-totals,
  // each with its own floor. A complete scorecard that clears the overall bar
  // but leaves a lens below its floor still requires the CIO override memo.
  const lensResults = evaluateLenses(items, { floor: lensFloor, lenses });
  const lensComplete = lensResults.every((l) => l.complete);
  const lensesBelow = lensResults.filter((l) => l.below_floor).map((l) => l.key);
  const belowLensFloor = complete && lensComplete && lensesBelow.length > 0;

  const override = data[SCORECARD_OVERRIDE_TAG] && typeof data[SCORECARD_OVERRIDE_TAG] === 'object'
    ? data[SCORECARD_OVERRIDE_TAG]
    : null;

  let outcome = null;
  if (complete) {
    const clears = total >= passThreshold && !belowLensFloor;
    if (clears) outcome = 'proceed';
    else outcome = override ? 'proceed_override' : 'override_required';
  }

  let message;
  if (!complete) message = reviewed ? SCORECARD_MESSAGES.incomplete : SCORECARD_MESSAGES.awaiting_review;
  else if (outcome === 'proceed') message = SCORECARD_MESSAGES.proceed;
  else if (outcome === 'proceed_override') message = SCORECARD_MESSAGES.override_provided;
  else message = belowLensFloor ? SCORECARD_MESSAGES.below_lens_floor : SCORECARD_MESSAGES.override_required;

  return {
    version,
    scale: SCORECARD_SCALE,
    min_score: SCORECARD_MIN_SCORE,
    max_score: SCORECARD_MAX_SCORE,
    pass_threshold: passThreshold,
    lens_floor: lensFloor,
    weight_total: weights.total,
    weights_valid: weights.ok,
    items,
    lenses: lensResults,
    item_count: items.length,
    scored_count: scored.length,
    complete,
    reviewed,
    awaiting_review: !reviewed,
    adjusted: items.filter((i) => i.adjusted).map((i) => i.key),
    total,
    below_lens_floor: belowLensFloor,
    lenses_below_floor: lensesBelow,
    outcome,
    override,
    overridden: Boolean(override),
    rejected_below_bar: outcome === 'override_required',
    message,
  };
}

/**
 * Validate a captured Gate-2 scorecard. Pure. Every score is a required whole
 * number 1-5; a criterion may carry a note. Returns the normalised record to
 * persist, or throws a 400-shaped error.
 */
export function buildScorecard(body = {}, { actor = null, at = null, proposals = {}, criteria = SCORECARD_ITEMS, version = SCORECARD_VERSION } = {}) {
  const rawScores = body.scores && typeof body.scores === 'object' ? body.scores : {};
  const rawNotes = body.notes && typeof body.notes === 'object' ? body.notes : {};
  const rawComments = body.comments && typeof body.comments === 'object' ? body.comments : {};
  const scores = {};
  const notes = {};
  const comments = {};
  const proposedScores = {};
  const adjusted = [];
  const keys = criteria.map((c) => c.key);
  for (const key of keys) {
    const n = Number(rawScores[key]);
    if (!Number.isFinite(n) || n < SCORECARD_MIN_SCORE || n > SCORECARD_MAX_SCORE) {
      const e = new Error(SCORECARD_MESSAGES.score_range + ' Missing or invalid: ' + key + '.');
      e.status = 400;
      throw e;
    }
    const final = clampScore(n);
    scores[key] = final;
    const note = String(rawNotes[key] || '').trim();
    notes[key] = note ? note : null;
    const proposed = num(proposals[key]);
    if (proposed !== null) {
      proposedScores[key] = clampScore(proposed);
      if (clampScore(proposed) !== final) {
        // An adjustment away from the system proposal must carry a written
        // comment, so the deviation is explained on the record (SCO-03).
        const comment = String(rawComments[key] || '').trim();
        if (comment.length < SCORECARD_ADJUST_REASON_MIN) {
          const e = new Error(SCORECARD_MESSAGES.adjust_comment_required + ' Criterion: ' + key + '.');
          e.status = 400;
          throw e;
        }
        comments[key] = comment;
        adjusted.push(key);
      }
    }
  }
  return {
    scores,
    notes,
    comments,
    proposed_scores: proposedScores,
    adjusted,
    by: actor?.email || actor?.id || null,
    at: at || new Date().toISOString(),
    version,
  };
}

/**
 * Validate an explicit CIO override memo for a below-bar scorecard. Pure.
 * Requires a named CIO and a written reason (REQ-GATE-02). Returns the record
 * to persist, or throws a 400-shaped error.
 */
export function buildScorecardOverride(body = {}, { actor = null, at = null } = {}) {
  const reason = String(body.reason || '').trim();
  if (reason.length < SCORECARD_REASON_MIN) {
    const e = new Error(SCORECARD_MESSAGES.reason_required);
    e.status = 400;
    throw e;
  }
  const by = String(body.by || actor?.email || actor?.id || '').trim();
  if (!by) {
    const e = new Error('A named CIO is required for the override memo.');
    e.status = 400;
    throw e;
  }
  return { reason, by, at: at || new Date().toISOString() };
}

export default {
  SCORECARD_VERSION, SCORECARD_SCALE, SCORECARD_MIN_SCORE, SCORECARD_MAX_SCORE,
  SCORECARD_WEIGHT_TOTAL, SCORECARD_PASS_THRESHOLD, SCORECARD_LENS_FLOOR, SCORECARD_LENSES, SCORECARD_REASON_MIN,
  SCORECARD_ADJUST_REASON_MIN, SCORECARD_NEUTRAL_SCORE,
  SCORECARD_TAG, SCORECARD_OVERRIDE_TAG, SCORECARD_OUTCOMES, SCORECARD_ITEMS,
  SCORECARD_KEYS, SCORECARD_FIELDS, SCORECARD_MESSAGES,
  validateWeights, capturedScore, capturedNote, proposeScorecardItem, evaluateLenses, evaluateScorecard, buildScorecard, buildScorecardOverride,
  SCORECARD_CONFIG_KEY, SCORECARD_CONFIG_DEFAULT_REVISION, SCORECARD_VERSION_PREFIX,
  defaultScorecardConfig, validateScorecardConfig, resolveScorecardConfig, diffScorecardConfig, buildScorecardConfig,
};
