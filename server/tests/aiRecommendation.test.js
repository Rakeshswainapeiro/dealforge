// ---------------------------------------------------------------------------
// Draft recommendation (BRD AI-04 / AI-05) and the reviewer-workspace helpers.
//
//   node --test server/tests/aiRecommendation.test.js
//
// Pure: no database, no network.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildRecommendation, CONDITION_OWNERS, RECOMMENDATION_RATINGS } from '../config/aiRecommendation.js';
import { checkedAgainst, withCheckedAgainst, CHECK_INPUTS, tabFields } from '../config/aiReview.js';
import { REVIEWER_ROLES } from '../config/workflowStates.js';

const row = (key, label, unit, comparator, threshold, base, upside, downside) => ({
  key, label, unit, comparator, threshold,
  scenarios: {
    base: { value: base, present: base !== null, meets: base === null ? null : (comparator === 'lte' ? base <= threshold : base >= threshold) },
    upside: { value: upside, present: upside !== null, meets: upside === null ? null : (comparator === 'lte' ? upside <= threshold : upside >= threshold) },
    downside: { value: downside, present: downside !== null, meets: downside === null ? null : (comparator === 'lte' ? downside <= threshold : downside >= threshold) },
  },
});

// A clean gate: everything passes and the scorecard is reviewed above the bar.
const cleanGate = () => ({
  hard_filters: { items: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, status: 'pass' })) },
  hurdle_table: {
    rows: [
      row('equity_irr', 'Equity IRR', '%', 'gte', 20, 27, 33, 24),
      row('roic', 'ROIC', '%', 'gte', 14, 18, 21, 15),
      row('payback', 'Payback period', 'yrs', 'lte', 3.5, 3.0, 2.5, 3.4),
    ],
  },
  disqualifiers: { items: [{ key: 'sanctions_pep', status: 'clear' }] },
  portfolio_conflict: { concentration: { sector: 'Technology', post_deal_pct: 20, max_pct: 35, breach: false } },
  sufficiency: { open_flags: [] },
  scorecard: { complete: true, total: 3.8, pass_threshold: 3.5, below_lens_floor: false, overridden: false },
});

describe('draft recommendation', () => {
  test('every rule passing and a reviewed score above the bar is a Go', () => {
    const r = buildRecommendation(cleanGate());
    assert.equal(r.rating, 'Go');
    assert.equal(r.conditions.length, 0);
    assert.equal(r.score, 3.8);
    assert.ok(r.rules.every((x) => x.status === 'pass'));
  });

  test('open warnings make it a Conditional Go and each becomes a named condition with an owner', () => {
    const g = cleanGate();
    g.hurdle_table.rows[0].scenarios.downside = { value: 14, present: true, meets: false };
    g.portfolio_conflict.concentration = { sector: 'Technology', post_deal_pct: 37.5, max_pct: 35, breach: true };
    g.sufficiency.open_flags = [{ key: 'risk_register', message: 'No risk register was attached.', overridden: false }];
    g.scorecard = { complete: false, total: null, pass_threshold: 3.5 };
    const r = buildRecommendation(g);
    assert.equal(r.rating, 'Conditional Go');
    assert.deepEqual(r.conditions.map((c) => c.key).sort(), ['concentration', 'downside_hurdles', 'scorecard', 'sufficiency']);
    for (const c of r.conditions) assert.ok(c.owner && c.text, c.key);
    assert.equal(r.conditions.find((c) => c.key === 'concentration').owner, CONDITION_OWNERS.concentration);
    assert.match(r.rules.find((x) => x.key === 'concentration').detail, /37\.5%/);
    assert.match(r.summary, /named conditions/);
  });

  test('a score that is not yet recorded never reads as a pass', () => {
    const g = cleanGate();
    g.scorecard = { complete: false, total: 4.2, pass_threshold: 3.5 };
    const r = buildRecommendation(g);
    assert.equal(r.rating, 'Conditional Go');
    assert.equal(r.rules.find((x) => x.key === 'scorecard').status, 'warn');
  });

  test('a disqualifier, a failed hard filter, a base-case miss or a score below the bar is a No-Go', () => {
    const dq = cleanGate(); dq.disqualifiers.items = [{ key: 'sanctions_pep', status: 'flagged', label: 'Sanctions / PEP' }];
    const hf = cleanGate(); hf.hard_filters.items[0] = { key: 'a', status: 'fail', label: 'Vertical' };
    const base = cleanGate(); base.hurdle_table.rows[0].scenarios.base = { value: 12, present: true, meets: false };
    const low = cleanGate(); low.scorecard = { complete: true, total: 3.1, pass_threshold: 3.5, overridden: false };
    const lens = cleanGate(); lens.scorecard = { complete: true, total: 3.9, pass_threshold: 3.5, below_lens_floor: true, lenses_below_floor: ['financial'] };
    for (const g of [dq, hf, base, low, lens]) assert.equal(buildRecommendation(g).rating, 'No-Go');
  });

  test('a score below the bar with a CIO override on file is a condition, not a stop', () => {
    const g = cleanGate(); g.scorecard = { complete: true, total: 3.1, pass_threshold: 3.5, overridden: true };
    assert.equal(buildRecommendation(g).rating, 'Conditional Go');
  });

  test('a lens below its floor with a CIO override on file is a named condition with the override recorded', () => {
    const g = cleanGate();
    g.scorecard = { complete: true, total: 3.6, pass_threshold: 3.5, below_lens_floor: true, lenses_below_floor: ['strategic'], overridden: true,
      override: { by: 'cio@sirius.local', reason: 'Strategic fit', at: '2026-11-02T13:50:22.949Z' } };
    const r = buildRecommendation(g);
    assert.equal(r.rating, 'Conditional Go');
    assert.ok(r.conditions.some((c) => /cio@sirius\.local, 2026-11-02/.test(c.condition || c.text || JSON.stringify(c))));
  });

  test('a lens below its floor with no override is still a stop', () => {
    const g = cleanGate();
    g.scorecard = { complete: true, total: 3.6, pass_threshold: 3.5, below_lens_floor: true, lenses_below_floor: ['strategic'], overridden: false };
    assert.equal(buildRecommendation(g).rating, 'No-Go');
  });

  test('an overridden sufficiency flag is no longer open', () => {
    const g = cleanGate(); g.sufficiency.open_flags = [{ key: 'risk_register', overridden: true }];
    assert.equal(buildRecommendation(g).rating, 'Go');
  });

  test('hard filters still to confirm by hand are a condition', () => {
    const g = cleanGate(); g.hard_filters.items[2] = { key: 'c', status: 'flag', label: 'Sanctions' };
    const r = buildRecommendation(g);
    assert.equal(r.rating, 'Conditional Go');
    assert.match(r.rules.find((x) => x.key === 'hard_filters').detail, /4 of 5 passed/);
  });

  test('an empty or missing gate never throws and is never a Go', () => {
    for (const g of [null, undefined, {}]) {
      const r = buildRecommendation(g);
      assert.ok(RECOMMENDATION_RATINGS.includes(r.rating));
      assert.notEqual(r.rating, 'Go');
    }
  });

  test('the draft is labelled and advisory', () => {
    const r = buildRecommendation(cleanGate());
    assert.equal(r.label, 'Rule-based draft');
    assert.match(r.advisory, /Advisory only/);
  });
});

describe('checked against', () => {
  test('lists the submitted values a check was judged on, with option labels, and skips empties', () => {
    const rows = checkedAgainst('mandate_rules', { sector: 'Technology', geography: 'UAE', total_commitment_aed: 85 });
    assert.deepEqual(rows.map((r) => r.value), ['Technology', 'UAE', '85']);
    assert.ok(rows.every((r) => r.label && r.label !== r.value));
    assert.deepEqual(checkedAgainst('mandate_rules', { sector: '', geography: null }), []);
    assert.deepEqual(checkedAgainst('right_document', { sector: 'X' }), []);
    assert.deepEqual(checkedAgainst('unknown_check', { sector: 'X' }), []);
  });

  test('a select value is shown by its label and long text is truncated', () => {
    const rows = checkedAgainst('hard_filters', { hard_filter_sanctions: 'clear' });
    assert.match(rows[0].value, /Clear/);
    const long = checkedAgainst('intent_fit', { narrative_what: 'x'.repeat(500) });
    assert.ok(long[0].value.length <= 140);
  });

  test('every mapped field really exists on the intake form', () => {
    const known = new Set(tabFields('executive_summary').concat(tabFields('financials'), tabFields('funding'), tabFields('risks'), tabFields('rationale'), tabFields('opportunity_overview')).map((f) => f.key));
    for (const [check, keys] of Object.entries(CHECK_INPUTS)) for (const k of keys) assert.ok(known.has(k), `${check} -> ${k}`);
  });

  test('withCheckedAgainst decorates every check and tolerates an empty result', () => {
    const out = withCheckedAgainst({ checks: [{ key: 'mandate_rules' }, { key: 'right_document' }] }, { sector: 'Technology' });
    assert.equal(out.checks[0].checked_against.length, 1);
    assert.deepEqual(out.checks[1].checked_against, []);
    assert.equal(withCheckedAgainst(null), null);
  });
});

describe('reviewer workspace roles', () => {
  test('the browser role list mirrors the server reviewer roles (admin excluded on purpose)', () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/reviewerWorkspace.js');
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/REVIEWER_WORKSPACE_ROLES\s*=\s*\[([^\]]*)\]/);
    assert.ok(m, 'REVIEWER_WORKSPACE_ROLES must be declared in src/lib/reviewerWorkspace.js');
    const roles = [...m[1].matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((x) => x[1] || x[2]);
    assert.deepEqual([...roles].sort(), [...REVIEWER_ROLES].sort());
    assert.ok(!roles.includes('admin'));
  });
});
