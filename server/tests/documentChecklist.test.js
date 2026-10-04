// ---------------------------------------------------------------------------
// Unit tests for the document checklist (W5-01 / BRD DOC-01).
//
//   node --test server/tests/documentChecklist.test.js
//
// Pure module: the shipped checklist shape, the validation rules, the resolve
// fallback, revision minting, the diff naming, the applicability rule and the
// evaluator. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_CHECKLIST_VERSION, DOCUMENT_CHECKLIST_CONFIG_KEY, DOCUMENT_CHECKLIST_DEFAULT_REVISION,
  DOCUMENT_CHECKLIST_VERSION_PREFIX,
  defaultDocumentChecklist, validateDocumentChecklist, resolveDocumentChecklist,
  diffDocumentChecklist, buildDocumentChecklist, checklistContext, evaluateChecklist,
  CHECKLIST_MESSAGES,
} from '../config/documentChecklist.js';
import { CHECKLIST_TIERS, CHECKLIST_RULE_KEYS } from '../config/documentChecklistData.js';

describe('document checklist - shipped checklist', () => {
  test('carries a version, a revision and the tier vocabulary', () => {
    const c = defaultDocumentChecklist();
    assert.equal(c.version, DOCUMENT_CHECKLIST_VERSION);
    assert.equal(c.revision, DOCUMENT_CHECKLIST_DEFAULT_REVISION);
    assert.deepEqual(CHECKLIST_TIERS, ['mandatory', 'conditional', 'optional']);
    assert.ok(CHECKLIST_RULE_KEYS.includes('off_budget'));
    assert.ok(DOCUMENT_CHECKLIST_CONFIG_KEY);
    assert.ok(DOCUMENT_CHECKLIST_VERSION_PREFIX);
  });

  test('ships one item per catalogue artefact, each with a recognised tier', () => {
    const c = defaultDocumentChecklist();
    assert.ok(c.items.length >= 14);
    for (const item of c.items) {
      assert.ok(item.key);
      assert.ok(CHECKLIST_TIERS.includes(item.tier), 'bad tier for ' + item.key);
    }
  });

  test('reproduces the standing MVP gate: business plan, financials and cap table block', () => {
    const c = defaultDocumentChecklist();
    for (const key of ['business_plan', 'financials', 'cap_table']) {
      const item = c.items.find((i) => i.key === key);
      assert.equal(item.tier, 'mandatory', key + ' should be mandatory');
      assert.equal(item.enforce, true, key + ' should enforce');
    }
  });

  test('offers the conditional items without blocking by default', () => {
    const c = defaultDocumentChecklist();
    const budget = c.items.find((i) => i.key === 'budget_confirmation');
    assert.equal(budget.tier, 'conditional');
    assert.equal(budget.rule.off_budget, true);
    const compliance = c.items.find((i) => i.key === 'compliance_screen');
    assert.equal(compliance.tier, 'conditional');
    assert.equal(compliance.rule.related_party, true);
    assert.equal(compliance.enforce, false);
  });

  test('waives the mandatory pack at the greenfield Concept stage', () => {
    const c = defaultDocumentChecklist();
    const bp = c.items.find((i) => i.key === 'business_plan');
    assert.deepEqual(bp.rule.exclude_greenfield_stages, ['concept']);
  });
});

describe('document checklist - validation', () => {
  const base = defaultDocumentChecklist();

  test('refuses a non-object payload', () => {
    const res = validateDocumentChecklist(null);
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(CHECKLIST_MESSAGES.not_object));
  });

  test('requires at least one item', () => {
    const res = validateDocumentChecklist({ items: [] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(CHECKLIST_MESSAGES.items_required));
  });

  test('rejects an unknown document key', () => {
    const res = validateDocumentChecklist({ items: [{ key: 'nope_artifact', tier: 'optional' }] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.startsWith(CHECKLIST_MESSAGES.item_key_unknown)));
  });

  test('rejects a duplicate item', () => {
    const res = validateDocumentChecklist({ items: [
      { key: 'financials', tier: 'mandatory' }, { key: 'financials', tier: 'optional' },
    ] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.startsWith(CHECKLIST_MESSAGES.item_duplicate)));
  });

  test('rejects an unknown tier', () => {
    const res = validateDocumentChecklist({ items: [{ key: 'financials', tier: 'critical' }] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.startsWith(CHECKLIST_MESSAGES.tier_invalid)));
  });

  test('rejects an unknown rule key', () => {
    const res = validateDocumentChecklist({ items: [{ key: 'financials', tier: 'mandatory', rule: { phase_of_moon: true } }] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.startsWith(CHECKLIST_MESSAGES.rule_invalid)));
  });

  test('accepts an edited tier and sorts by sort_order', () => {
    const res = validateDocumentChecklist({ items: [
      { key: 'financials', tier: 'optional' },
      { key: 'business_plan', tier: 'mandatory' },
    ] }, { base });
    assert.equal(res.ok, true);
    assert.equal(res.config.items.length, 2);
    assert.ok(res.config.items[0].sort_order <= res.config.items[1].sort_order);
  });
});

describe('document checklist - resolve and mint', () => {
  test('resolve falls back to the shipped default on blank or bad stored value', () => {
    assert.equal(resolveDocumentChecklist(null).version, DOCUMENT_CHECKLIST_VERSION);
    assert.equal(resolveDocumentChecklist('{ not json').version, DOCUMENT_CHECKLIST_VERSION);
    assert.equal(resolveDocumentChecklist('{"items":[]}').version, DOCUMENT_CHECKLIST_VERSION);
  });

  test('resolve returns a stored checklist when valid', () => {
    const stored = JSON.stringify({ items: [{ key: 'financials', tier: 'optional' }], revision: 4 });
    const c = resolveDocumentChecklist(stored);
    assert.equal(c.items.length, 1);
    assert.equal(c.items[0].tier, 'optional');
  });

  test('build mints the next revision and a CL-01.N version', () => {
    const base = defaultDocumentChecklist();
    const next = buildDocumentChecklist({ items: base.items.map((i) => ({ key: i.key, tier: i.key === 'financials' ? 'optional' : i.tier, enforce: i.enforce, rule: i.rule })) }, { base, actor: { email: 'admin@dealforge.local' } });
    assert.equal(next.revision, DOCUMENT_CHECKLIST_DEFAULT_REVISION + 1);
    assert.equal(next.version, DOCUMENT_CHECKLIST_VERSION_PREFIX + next.revision);
    assert.equal(next.updated_by, 'admin@dealforge.local');
  });

  test('build throws a 400 on an invalid payload', () => {
    assert.throws(() => buildDocumentChecklist({ items: [] }), (e) => e.status === 400);
  });

  test('diff names an added, a removed and a tier change', () => {
    const base = { items: [{ key: 'financials', tier: 'mandatory', enforce: true, rule: {} }, { key: 'market_data', tier: 'optional', enforce: false, rule: {} }] };
    const next = { items: [{ key: 'financials', tier: 'optional', enforce: false, rule: {} }, { key: 'cap_table', tier: 'mandatory', enforce: true, rule: {} }] };
    const changes = diffDocumentChecklist(base, next);
    assert.ok(changes.some((c) => c.field === 'financials' && c.op === 'tier'));
    assert.ok(changes.some((c) => c.field === 'cap_table' && c.op === 'added'));
    assert.ok(changes.some((c) => c.field === 'market_data' && c.op === 'removed'));
  });
});

describe('document checklist - evaluation', () => {
  const cfg = defaultDocumentChecklist();

  test('context reads type, stage and flags from the opportunity data', () => {
    const ctx = checklistContext({ opportunity_type: 'M&A', greenfield_stage: 'feasibility', in_approved_budget: 'No', related_party: 'Yes' });
    assert.equal(ctx.opportunity_type, 'M&A');
    assert.equal(ctx.greenfield_stage, 'feasibility');
    assert.equal(ctx.off_budget, true);
    assert.equal(ctx.related_party, true);
  });

  test('mandatory enforced items block when absent and clear when present', () => {
    const ctx = checklistContext({ opportunity_type: 'M&A' });
    const empty = evaluateChecklist(ctx, cfg, { documents: [] });
    assert.ok(empty.blocking_keys.includes('business_plan'));
    assert.equal(empty.complete, false);
    const full = evaluateChecklist(ctx, cfg, { documents: ['business_plan', 'financials', 'cap_table'] });
    assert.ok(!full.blocking_keys.includes('business_plan'));
    assert.equal(full.complete, true);
  });

  test('conditional items are due only when their rule applies', () => {
    const inBudget = evaluateChecklist(checklistContext({ opportunity_type: 'M&A' }), cfg, { documents: [] });
    const budgetItem = inBudget.items.find((i) => i.key === 'budget_confirmation');
    assert.equal(budgetItem.applies, false);
    assert.equal(budgetItem.due, false);

    const offBudget = evaluateChecklist(checklistContext({ opportunity_type: 'M&A', in_approved_budget: 'No' }), cfg, { documents: [] });
    const dueItem = offBudget.items.find((i) => i.key === 'budget_confirmation');
    assert.equal(dueItem.applies, true);
    assert.equal(dueItem.due, true);
    assert.equal(dueItem.blocking, true);
  });

  test('an unenforced conditional is due but never blocks', () => {
    const ctx = checklistContext({ opportunity_type: 'M&A', related_party: 'Yes' });
    const res = evaluateChecklist(ctx, cfg, { documents: [] });
    const item = res.items.find((i) => i.key === 'compliance_screen');
    assert.equal(item.due, true);
    assert.equal(item.blocking, false);
  });

  test('a Concept-stage greenfield waives the mandatory pack', () => {
    const ctx = checklistContext({ opportunity_type: 'Greenfield', greenfield_stage: 'concept' });
    const res = evaluateChecklist(ctx, cfg, { documents: [] });
    const bp = res.items.find((i) => i.key === 'business_plan');
    assert.equal(bp.applies, false);
    assert.equal(bp.blocking, false);
    assert.equal(res.complete, true);
  });

  test('optional items are collected but never due or blocking', () => {
    const res = evaluateChecklist(checklistContext({ opportunity_type: 'M&A' }), cfg, { documents: [] });
    const opt = res.items.filter((i) => i.tier === 'optional');
    assert.ok(opt.length > 0);
    for (const i of opt) { assert.equal(i.due, false); assert.equal(i.blocking, false); }
  });

  test('counts summarise the generated checklist', () => {
    const res = evaluateChecklist(checklistContext({ opportunity_type: 'M&A' }), cfg, { documents: ['business_plan'] });
    assert.equal(res.counts.total, res.items.length);
    assert.equal(res.counts.mandatory + res.counts.conditional + res.counts.optional, res.counts.total);
    assert.ok(res.counts.blocking >= 1);
  });
});
