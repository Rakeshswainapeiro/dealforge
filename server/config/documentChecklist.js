// ---------------------------------------------------------------------------
// Document checklist (W5-01 / BRD DOC-01).
//
// The pure module behind the type / stage / flag-driven document checklist:
// the shipped default, the validation, the resolve fallback, the diff and the
// revision builder, plus the evaluator the gate, the form and the memo read to
// decide which catalogue artefacts apply to an opportunity and whether they
// block. Storage and HTTP routes live in server/checklist.js.
//
// The checklist is derived from the memo evidence catalogue
// (server/config/memoDocumentList.js) so the checklist, the gate and the memo
// name one document set. The origin of the shipped default reproduces the
// standing MVP gate, so nothing new blocks until an administrator changes it.
// ---------------------------------------------------------------------------

import { fullDocumentRequirements } from './memoDocumentList.js';
import {
  DOCUMENT_CHECKLIST_VERSION, DOCUMENT_CHECKLIST_CONFIG_KEY,
  DOCUMENT_CHECKLIST_DEFAULT_REVISION, DOCUMENT_CHECKLIST_VERSION_PREFIX,
  CHECKLIST_TIERS, CHECKLIST_RULE_KEYS, DOCUMENT_CHECKLIST_RULES,
  DOCUMENT_CHECKLIST_DISCLAIMER,
} from './documentChecklistData.js';

export {
  DOCUMENT_CHECKLIST_VERSION, DOCUMENT_CHECKLIST_CONFIG_KEY,
  DOCUMENT_CHECKLIST_DEFAULT_REVISION, DOCUMENT_CHECKLIST_VERSION_PREFIX,
  CHECKLIST_TIERS, CHECKLIST_RULE_KEYS, DOCUMENT_CHECKLIST_RULES,
  DOCUMENT_CHECKLIST_DISCLAIMER,
};

export const CHECKLIST_MESSAGES = {
  not_object: 'The checklist payload must be an object.',
  items_required: 'The checklist needs at least one item.',
  item_key_required: 'Every checklist item needs a document key.',
  item_key_unknown: 'Unknown document key: ',
  item_duplicate: 'Duplicate checklist item: ',
  tier_invalid: 'Unknown tier: ',
  rule_invalid: 'Unknown rule: ',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function toStrArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

// The catalogue the checklist draws from: the full memo evidence set.
function catalogue() {
  return fullDocumentRequirements();
}

// Build one item's applicability rule from a stored / posted rule object,
// keeping only recognised keys with a non-empty value.
function normalizeRule(input = {}) {
  const rule = {};
  for (const k of CHECKLIST_RULE_KEYS) {
    if (!(k in input)) continue;
    const v = input[k];
    if (k === 'min_commitment_aed' || k === 'max_commitment_aed') {
      const n = Number(v);
      if (Number.isFinite(n)) rule[k] = n;
    } else if (k === 'off_budget' || k === 'in_budget' || k === 'related_party' || k === 'cross_border') {
      rule[k] = v === true;
    } else {
      const list = toStrArray(v);
      if (list.length) rule[k] = list;
    }
  }
  return rule;
}

// The shipped checklist: one item per catalogue artefact, tiered and ruled per
// DOCUMENT_CHECKLIST_RULES.
export function defaultDocumentChecklist() {
  const items = catalogue().map((doc) => {
    const spec = DOCUMENT_CHECKLIST_RULES[doc.key] || {};
    const tier = CHECKLIST_TIERS.includes(spec.tier) ? spec.tier : (doc.required ? 'mandatory' : 'optional');
    const ruleSpec = { ...spec };
    delete ruleSpec.tier;
    const enforce = ruleSpec.enforce;
    delete ruleSpec.enforce;
    return {
      key: doc.key,
      label: doc.label,
      description: doc.description || null,
      tier,
      enforce: enforce === true,
      rule: normalizeRule(ruleSpec),
      sort_order: doc.sort_order,
    };
  });
  return {
    version: DOCUMENT_CHECKLIST_VERSION,
    revision: DOCUMENT_CHECKLIST_DEFAULT_REVISION,
    items,
    disclaimer: DOCUMENT_CHECKLIST_DISCLAIMER,
  };
}

function normalizeItem(input, base) {
  const key = input.key ? String(input.key).trim() : '';
  const fromBase = (base?.items || []).find((i) => i.key === key);
  const doc = catalogue().find((d) => d.key === key);
  return {
    key,
    label: blank(input.label) ? (fromBase?.label || doc?.label || key) : String(input.label).trim(),
    description: input.description !== undefined ? input.description
      : (fromBase ? fromBase.description : (doc?.description || null)),
    tier: blank(input.tier) ? (fromBase?.tier || 'optional') : norm(input.tier),
    enforce: input.enforce !== undefined ? input.enforce === true : (fromBase ? fromBase.enforce : false),
    rule: input.rule !== undefined ? normalizeRule(input.rule) : (fromBase?.rule || {}),
    sort_order: input.sort_order != null ? Number(input.sort_order) : (fromBase?.sort_order ?? (doc?.sort_order ?? 0)),
  };
}

export function validateDocumentChecklist(input, { base = null } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: [CHECKLIST_MESSAGES.not_object], config: base || defaultDocumentChecklist() };
  }
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0) errors.push(CHECKLIST_MESSAGES.items_required);
  const known = new Set(catalogue().map((d) => d.key));
  const seen = new Set();
  const items = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || blank(raw.key)) { errors.push(CHECKLIST_MESSAGES.item_key_required); continue; }
    const key = String(raw.key).trim();
    if (!known.has(key)) { errors.push(CHECKLIST_MESSAGES.item_key_unknown + key); continue; }
    if (seen.has(key)) { errors.push(CHECKLIST_MESSAGES.item_duplicate + key); continue; }
    seen.add(key);
    const item = normalizeItem(raw, base);
    if (!CHECKLIST_TIERS.includes(item.tier)) errors.push(CHECKLIST_MESSAGES.tier_invalid + raw.tier);
    for (const k of Object.keys(raw.rule || {})) {
      if (!CHECKLIST_RULE_KEYS.includes(k)) errors.push(CHECKLIST_MESSAGES.rule_invalid + k);
    }
    items.push(item);
  }
  items.sort((a, b) => (a.sort_order - b.sort_order) || a.key.localeCompare(b.key));
  const config = {
    version: base?.version || DOCUMENT_CHECKLIST_VERSION,
    revision: base?.revision ?? DOCUMENT_CHECKLIST_DEFAULT_REVISION,
    items,
    disclaimer: blank(input.disclaimer) ? (base?.disclaimer || DOCUMENT_CHECKLIST_DISCLAIMER) : String(input.disclaimer).trim(),
  };
  return { ok: errors.length === 0, errors, config };
}

export function resolveDocumentChecklist(stored) {
  if (blank(stored)) return defaultDocumentChecklist();
  let parsed = stored;
  if (typeof stored === 'string') {
    try { parsed = JSON.parse(stored); } catch { return defaultDocumentChecklist(); }
  }
  const res = validateDocumentChecklist(parsed, { base: parsed });
  return res.ok ? res.config : defaultDocumentChecklist();
}

// Name the item-level changes between two checklist revisions for the audit.
export function diffDocumentChecklist(base, next) {
  const changes = [];
  const baseItems = new Map((base?.items || []).map((i) => [i.key, i]));
  const nextItems = new Map((next?.items || []).map((i) => [i.key, i]));
  for (const [key, item] of nextItems) {
    const before = baseItems.get(key);
    if (!before) { changes.push({ field: key, op: 'added', value: item.tier }); continue; }
    if (before.tier !== item.tier) changes.push({ field: key, op: 'tier', value: item.tier, from: before.tier });
    if (before.enforce !== item.enforce) changes.push({ field: key, op: 'enforce', value: item.enforce });
    if (JSON.stringify(before.rule || {}) !== JSON.stringify(item.rule || {})) changes.push({ field: key, op: 'rule', value: item.rule });
  }
  for (const key of baseItems.keys()) if (!nextItems.has(key)) changes.push({ field: key, op: 'removed' });
  return changes;
}

export function buildDocumentChecklist(body, { actor = null, at = null, base = null } = {}) {
  const current = base || defaultDocumentChecklist();
  const res = validateDocumentChecklist(body, { base: current });
  if (!res.ok) {
    const e = new Error('Invalid document checklist: ' + res.errors.join(' '));
    e.status = 400;
    e.errors = res.errors;
    throw e;
  }
  const revision = (current.revision || DOCUMENT_CHECKLIST_DEFAULT_REVISION) + 1;
  return {
    ...res.config,
    revision,
    version: DOCUMENT_CHECKLIST_VERSION_PREFIX + revision,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
}

// --- evaluation ------------------------------------------------------------
// Does a single rule apply to this context? Every present key must be met.
function ruleApplies(rule, ctx) {
  if (!rule || Object.keys(rule).length === 0) return true;
  if (rule.types && !rule.types.map(norm).includes(norm(ctx.opportunity_type))) return false;
  if (rule.exclude_types && rule.exclude_types.map(norm).includes(norm(ctx.opportunity_type))) return false;
  if (rule.greenfield_stages && !rule.greenfield_stages.map(norm).includes(norm(ctx.greenfield_stage))) return false;
  if (rule.exclude_greenfield_stages && rule.exclude_greenfield_stages.map(norm).includes(norm(ctx.greenfield_stage))) return false;
  if (rule.off_budget === true && ctx.off_budget !== true) return false;
  if (rule.in_budget === true && ctx.off_budget === true) return false;
  if (rule.related_party === true && ctx.related_party !== true) return false;
  if (rule.cross_border === true && ctx.cross_border !== true) return false;
  if (rule.min_commitment_aed != null && !(Number(ctx.total_commitment_aed) >= rule.min_commitment_aed)) return false;
  if (rule.max_commitment_aed != null && !(Number(ctx.total_commitment_aed) <= rule.max_commitment_aed)) return false;
  return true;
}

// Normalise the gate's signals into the checklist context.
export function checklistContext(data = {}, { offBudget = null, relatedParty = null, crossBorder = null } = {}) {
  return {
    opportunity_type: data.opportunity_type ?? null,
    greenfield_stage: data.greenfield_stage ?? null,
    off_budget: offBudget != null ? offBudget : norm(data.in_approved_budget) === 'no',
    related_party: relatedParty != null ? relatedParty : norm(data.related_party) === 'yes',
    cross_border: crossBorder === true,
    total_commitment_aed: data.total_commitment_aed ?? null,
  };
}

/**
 * Generate the checklist for one opportunity. Returns each item with its tier,
 * whether it applies, whether it is due (mandatory, or a conditional whose rule
 * applies) and whether it blocks this submission. Pure.
 */
export function evaluateChecklist(ctx = {}, config = null, { documents = [] } = {}) {
  const cfg = config || defaultDocumentChecklist();
  const present = new Set(documents);
  const items = (cfg.items || []).map((item) => {
    const applies = ruleApplies(item.rule, ctx);
    const due = item.tier === 'mandatory' ? applies : (item.tier === 'conditional' ? applies : false);
    const presentNow = present.has(item.key);
    const blocks = item.enforce === true && due && !presentNow;
    return {
      key: item.key,
      label: item.label,
      description: item.description,
      tier: item.tier,
      enforce: item.enforce === true,
      applies,
      due,
      present: presentNow,
      blocking: blocks,
    };
  });
  const dueItems = items.filter((i) => i.due);
  const blocking = items.filter((i) => i.blocking);
  return {
    version: cfg.version,
    revision: cfg.revision,
    items,
    counts: {
      total: items.length,
      mandatory: items.filter((i) => i.tier === 'mandatory').length,
      conditional: items.filter((i) => i.tier === 'conditional').length,
      optional: items.filter((i) => i.tier === 'optional').length,
      due: dueItems.length,
      due_present: dueItems.filter((i) => i.present).length,
      blocking: blocking.length,
    },
    blocking_keys: blocking.map((i) => i.key),
    complete: blocking.length === 0,
  };
}

export default {
  DOCUMENT_CHECKLIST_VERSION, DOCUMENT_CHECKLIST_CONFIG_KEY,
  DOCUMENT_CHECKLIST_DEFAULT_REVISION, DOCUMENT_CHECKLIST_VERSION_PREFIX,
  CHECKLIST_TIERS, CHECKLIST_RULE_KEYS, CHECKLIST_MESSAGES, DOCUMENT_CHECKLIST_DISCLAIMER,
  defaultDocumentChecklist, validateDocumentChecklist, resolveDocumentChecklist,
  diffDocumentChecklist, buildDocumentChecklist, checklistContext, evaluateChecklist,
};
