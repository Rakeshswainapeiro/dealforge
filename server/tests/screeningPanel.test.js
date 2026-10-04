// ---------------------------------------------------------------------------
// Unit tests for the single screening panel (W3-01 / SCR-01).
//
//   node --test server/tests/screeningPanel.test.js
//
// Pure module: the tests build the already-computed gate and alignment blocks
// by hand and assert the composed panel, so no server is needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateScreeningPanel, SCREENING_CHECKS, SCREENING_CHECK_KEYS,
  SCREENING_SLA_MINUTES, SCREENING_RESULTS,
} from '../config/screeningPanel.js';

const AT = '2026-02-01T09:00:00.000Z';

// A gate block as evaluateGate() returns it, satisfied and passing.
function passingGate(overrides = {}) {
  return {
    complete: true,
    missing: [],
    self_screen: { decision: 'pass', complete: true, blocked: false, stops: [], flags: [], answers: { opportunity_type: 'M&A', total_commitment_aed: 120, sector: 'Energy', geography: 'UAE' } },
    below_floor: null,
    hurdle_table: {
      version: 'HURDLE-1', scenarios: ['base', 'upside', 'downside'],
      rows: [{ key: 'equity_irr', label: 'Equity IRR', scenarios: { base: { value: 24, present: true, meets: true }, upside: { value: 30, present: true, meets: true }, downside: { value: 12, present: true, meets: true } } }],
      pass_rate: { base: 1, upside: 1, downside: 1 }, thresholds: { equity_irr: 20 }, flags: [], meets_all: true,
      message: 'All captured hurdles meet their thresholds across the evaluated scenarios.',
    },
    statement_model: { attached: true, complete: true },
    currency: { currency: 'AED', complete: true },
    // Gate-1 hard filters (W3-02 / SCR-03), all five passing.
    hard_filters: {
      version: 'HF-01.1', item_count: 5, recommended_outcome: 'proceed', effective_outcome: 'proceed',
      review: null, awaiting_review: false, complete: true, failed: [], pending: [],
      message: 'No hard filter failed. The opportunity may proceed to the screening decision.',
      items: [
        { key: 'designated_vertical', label: 'Designated vertical', status: 'pass' },
        { key: 'check_size', label: 'Check size within the deployment band', status: 'pass' },
        { key: 'sanctions_export', label: 'No sanctions / export-control / reputational exposure', status: 'pass' },
        { key: 'structuring', label: 'ADGM / DIFC-compatible structuring', status: 'pass' },
        { key: 'portfolio_conflict', label: 'No un-mitigable portfolio conflict', status: 'pass' },
      ],
    },
    completeness: 100,
    ...overrides,
  };
}

const alignedTheme = {
  theme_org_id: 'org-infinia', has_theme: true, theme_status: 'approved',
  aligned: true, score: 70, matched: ['sector'], reasons: ['Sector matches.'], signals: [],
};

describe('screening panel vocabulary (SCR-01)', () => {
  test('names the six BRD checks in display order', () => {
    assert.deepEqual(SCREENING_CHECK_KEYS, ['eligibility', 'hard_filters', 'hurdle_tests', 'alignment', 'synergy_conflict', 'completeness']);
    const orders = SCREENING_CHECKS.map((c) => c.order);
    assert.deepEqual(orders, [1, 2, 3, 4, 5, 6]);
    assert.equal(SCREENING_SLA_MINUTES, 15, 'the screen runs within 15 minutes of submission');
  });

  test('every check declares whether it is advisory', () => {
    for (const c of SCREENING_CHECKS) assert.equal(typeof c.advisory, 'boolean', c.key);
  });
});

describe('screening panel composition (SCR-01)', () => {
  test('a clean opportunity passes every configured check', () => {
    const p = evaluateScreeningPanel({ gate: passingGate(), alignment: alignedTheme, evaluated_at: AT });
    assert.equal(p.generated_at, AT);
    assert.equal(p.check_count, 6);
    assert.equal(p.complete, true);
    assert.equal(p.summary.recommended, 'pass');
    const byKey = Object.fromEntries(p.checks.map((c) => [c.key, c]));
    assert.equal(byKey.eligibility.result, 'pass');
    assert.equal(byKey.hurdle_tests.result, 'pass');
    assert.equal(byKey.alignment.result, 'pass');
    assert.equal(byKey.completeness.result, 'pass');
    // The hard filters are now a real rule set (W3-02): all five pass.
    assert.equal(byKey.hard_filters.result, 'pass');
    assert.equal(byKey.synergy_conflict.result, 'pass');
  });

  test('a failed hard filter fails the check and recommends decline (W3-02)', () => {
    const hf = passingGate().hard_filters;
    const gate = passingGate({
      hard_filters: {
        ...hf, recommended_outcome: 'recommended_decline', effective_outcome: 'recommended_decline',
        awaiting_review: true, failed: [{ key: 'check_size', label: 'Check size within the deployment band', rationale: 'Below the band floor.' }],
        message: 'One or more hard filters failed. The system recommends decline; a reviewer confirms or overrides with a written reason. Below the band floor.',
        items: hf.items.map((i) => (i.key === 'check_size' ? { ...i, status: 'fail' } : i)),
      },
    });
    const p = evaluateScreeningPanel({ gate, alignment: alignedTheme, evaluated_at: AT });
    const h = p.checks.find((c) => c.key === 'hard_filters');
    assert.equal(h.result, 'fail');
    assert.deepEqual(h.detail.failed, ['check_size']);
    assert.equal(p.summary.recommended, 'stop');
    assert.ok(p.summary.blocking.includes('hard_filters'));
  });

  test('every check carries a result, a rationale and evidence references', () => {
    const p = evaluateScreeningPanel({ gate: passingGate(), alignment: alignedTheme, evaluated_at: AT });
    for (const c of p.checks) {
      assert.ok(SCREENING_RESULTS.includes(c.result), c.key + ' result');
      assert.equal(typeof c.rationale, 'string');
      assert.ok(c.rationale.length > 0, c.key + ' rationale');
      assert.ok(Array.isArray(c.evidence_refs), c.key + ' evidence_refs');
      assert.ok(['completed', 'completed_with_flags', 'blocked', 'pending'].includes(c.status));
    }
  });

  test('a stopped self-screen fails eligibility with the stop as evidence', () => {
    const gate = passingGate({
      self_screen: { decision: 'stop', complete: true, blocked: true, stops: [{ code: 'outside_appetite', message: 'Outside appetite.' }], flags: [], answers: { opportunity_type: 'Venture capital fund' } },
    });
    const p = evaluateScreeningPanel({ gate, alignment: alignedTheme, evaluated_at: AT });
    const el = p.checks.find((c) => c.key === 'eligibility');
    assert.equal(el.result, 'fail');
    assert.ok(el.rationale.includes('Outside appetite'));
    assert.ok(el.evidence_refs.some((e) => e.type === 'self_screen_stop'));
    assert.equal(p.summary.recommended, 'stop');
    assert.equal(p.complete, true, 'a failing configured check is still a completed check');
    assert.ok(p.summary.blocking.includes('eligibility'));
  });

  test('a below-hurdle case flags the hurdle test but never blocks', () => {
    const gate = passingGate({
      hurdle_table: {
        version: 'HURDLE-1', scenarios: ['base'],
        rows: [{ key: 'equity_irr', label: 'Equity IRR', scenarios: { base: { value: 12, present: true, meets: false } } }],
        pass_rate: { base: 0 }, thresholds: { equity_irr: 20 },
        flags: [{ key: 'equity_irr', scenario: 'base', reason: 'below_hurdle', label: 'Equity IRR', message: 'Equity IRR 12% does not meet the 20% hurdle in the base case.' }],
        meets_all: false, message: 'One or more hurdles are not met; the memo flags each case for review.',
      },
    });
    const p = evaluateScreeningPanel({ gate, alignment: alignedTheme, evaluated_at: AT });
    const h = p.checks.find((c) => c.key === 'hurdle_tests');
    assert.equal(h.result, 'flag');
    assert.ok(h.evidence_refs.some((e) => e.type === 'hurdle'));
    assert.equal(p.summary.recommended, 'review');
    assert.equal(p.summary.counts.fail, 0);
  });

  test('missing fields and documents fail completeness and name each one', () => {
    const gate = passingGate({
      complete: false, completeness: 60,
      missing: [
        { type: 'field', key: 'target_name', label: 'Target name' },
        { type: 'document', key: 'business_plan', label: 'Business plan' },
      ],
    });
    const p = evaluateScreeningPanel({ gate, alignment: alignedTheme, evaluated_at: AT });
    const c = p.checks.find((x) => x.key === 'completeness');
    assert.equal(c.result, 'fail');
    assert.deepEqual(c.detail.missing_fields, ['target_name']);
    assert.deepEqual(c.detail.missing_documents, ['business_plan']);
    assert.ok(c.rationale.includes('60%'));
  });

  test('duplicate and related-party signals flag the synergy & conflict check', () => {
    const gate = passingGate({
      self_screen: { decision: 'pass_with_flags', complete: true, blocked: false, stops: [], flags: [{ code: 'related_party', message: 'Related-party involvement declared.' }], answers: { opportunity_type: 'M&A' } },
    });
    const duplicates = { count: 2, matches: [{ opportunity_id: 'opp-2', opportunity_name: 'Twin Co' }] };
    const p = evaluateScreeningPanel({ gate, alignment: alignedTheme, duplicates, evaluated_at: AT });
    const s = p.checks.find((c) => c.key === 'synergy_conflict');
    assert.equal(s.result, 'flag');
    assert.equal(s.detail.duplicate_count, 2);
    assert.equal(s.detail.related_party, true);
    assert.ok(s.evidence_refs.some((e) => e.type === 'duplicate'));
    assert.ok(s.evidence_refs.some((e) => e.type === 'flag'));
    assert.equal(p.summary.recommended, 'review');
  });

  test('a missing theme makes alignment pending, not a false pass', () => {
    const p = evaluateScreeningPanel({ gate: passingGate(), alignment: { has_theme: false, aligned: false, score: 0, matched: [], reasons: [], signals: [] }, evaluated_at: AT });
    const a = p.checks.find((c) => c.key === 'alignment');
    assert.equal(a.result, 'not_applicable');
    assert.equal(a.pending, true);
    assert.ok(a.rationale.includes('No approved investment theme'));
    assert.equal(p.complete, false, 'a pending configured check makes the panel incomplete');
  });

  test('the panel is advisory and carries no rejection', () => {
    const p = evaluateScreeningPanel({ gate: passingGate(), alignment: alignedTheme, evaluated_at: AT });
    assert.ok(p.disclaimer.toLowerCase().includes('never rejects'));
    assert.ok(['pass', 'review', 'stop'].includes(p.summary.recommended));
    assert.equal(typeof p.message, 'string');
  });

  test('the scored soft filters ride along as a section, not a check (W3-03)', () => {
    const gate = passingGate({
      soft_filters: {
        version: 'SF-01.1', item_count: 3, outcome: 'strong', average: 4.33,
        awaiting_review: true, confirmed: false, weak: [],
        items: [
          { key: 'portfolio_adjacency', label: 'Adjacency to portfolio companies', proposed_score: 4, score: 4 },
          { key: 'national_priorities', label: 'Alignment with UAE national priorities', proposed_score: 5, score: 5 },
          { key: 'management_openness', label: 'Management openness to an active investor', proposed_score: 4, score: 4 },
        ],
      },
    });
    const p = evaluateScreeningPanel({ gate, alignment: alignedTheme, evaluated_at: AT });
    assert.ok(p.soft_filters, 'soft filters exposed on the panel');
    assert.equal(p.soft_filters.item_count, 3);
    assert.equal(p.soft_filters.outcome, 'strong');
    // Soft filters are not one of the six BRD checks and never change the outcome.
    assert.equal(p.check_count, 6);
    assert.equal(p.checks.some((c) => c.key === 'soft_filters'), false);
  });
});
