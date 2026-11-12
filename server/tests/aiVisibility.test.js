import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSeeInternalAssessment, projectGate, projectOpportunityRecord, projectAuditEvents, isInternalEntity,
  INTERNAL_GATE_BLOCKS, INTERNAL_OPPORTUNITY_FIELDS,
} from '../config/aiVisibility.js';
import { validateDecision, buildOverview, latestDecisions, aiStatusOf, effectiveValidation } from '../config/aiReviewDecisions.js';

const preparer = { email: 'p@x', roles: ['subsidiary_deal_lead'] };
const sirius = { email: 's@x', roles: ['sirius_deal_lead'] };
const admin = { email: 'a@x', roles: ['admin'] };

test('only Sirius reviewer roles and administrators see the internal assessment', () => {
  assert.equal(canSeeInternalAssessment(sirius), true);
  assert.equal(canSeeInternalAssessment(admin), true);
  assert.equal(canSeeInternalAssessment(preparer), false);
  assert.equal(canSeeInternalAssessment({ email: 'c', roles: ['subsidiary_ceo'] }), false);
  assert.equal(canSeeInternalAssessment(null), false);
});

test('gate projection nulls every internal block for a Preparer and nothing else', () => {
  const gate = { missing: [], complete: true, attestations: {}, ...Object.fromEntries(INTERNAL_GATE_BLOCKS.map((k) => [k, { x: 1 }])) };
  const mine = projectGate(gate, preparer);
  for (const k of INTERNAL_GATE_BLOCKS) assert.equal(mine[k], null);
  assert.deepEqual(mine.missing, []);
  assert.equal(mine.complete, true);
  assert.deepEqual(projectGate(gate, sirius), gate);
  assert.notEqual(gate.scorecard, null, 'the input is not mutated');
});

test('record projection removes reviewer fields for a Preparer without mutating', () => {
  const rec = { name: 'n', ...Object.fromEntries(INTERNAL_OPPORTUNITY_FIELDS.map((k) => [k, 1])) };
  const mine = projectOpportunityRecord(rec, preparer);
  assert.deepEqual(Object.keys(mine), ['name']);
  assert.equal(Object.keys(rec).length, INTERNAL_OPPORTUNITY_FIELDS.length + 1);
  assert.equal(projectOpportunityRecord(rec, sirius), rec);
});

test('audit projection hides internal assessment actions from a Preparer', () => {
  const ev = ['submit', 'ai_validation_run', 'scorecard_scored', 'hard_filter_override', 'update', 'ai_review_override'].map((action) => ({ action }));
  assert.deepEqual(projectAuditEvents(ev, preparer).map((e) => e.action), ['submit', 'update']);
  assert.equal(projectAuditEvents(ev, sirius).length, 6);
});

test('internal entities are named', () => {
  assert.equal(isInternalEntity('AIReviewResult'), true);
  assert.equal(isInternalEntity('AIReviewDecision'), true);
  assert.equal(isInternalEntity('DealOpportunity'), false);
});

const result = { status: 'review', checks: [{ key: 'a', status: 'fail' }], analysis: { items: [{ rating: 'Weak' }] }, ran_at: 't' };

test('decision validation', () => {
  assert.equal(validateDecision({ kind: 'validation', action: 'accept' }, { result }).ok, true);
  assert.equal(validateDecision({ kind: 'validation', action: 'accept' }, { result: null }).ok, false);
  assert.equal(validateDecision({ kind: 'validation', action: 'override', to_status: 'pass', reason: 'short' }, { result }).ok, false);
  assert.equal(validateDecision({ kind: 'validation', action: 'override', to_status: 'pass', reason: 'a proper written reason' }, { result }).ok, true);
  assert.equal(validateDecision({ kind: 'analysis', action: 'override', to_status: 'pass', reason: 'a proper written reason' }, { result }).ok, false);
  assert.equal(validateDecision({ kind: 'analysis', action: 'override', to_status: 'Strong', reason: 'a proper written reason' }, { result }).ok, true);
  assert.equal(validateDecision({ kind: 'validation', action: 'clarify', question: 'why?' }, { result }).ok, false);
});

test('status lookup, latest decision and effective status', () => {
  assert.equal(aiStatusOf(result, 'validation', '__tab__'), 'review');
  assert.equal(aiStatusOf(result, 'validation', 'a'), 'fail');
  assert.equal(aiStatusOf(result, 'analysis', 'item-0'), 'Weak');
  const rows = [{ tab: 't', kind: 'validation', finding_key: '__tab__', at: '2', action: 'override', to_status: 'pass', input_hash: 'h' },
    { tab: 't', kind: 'validation', finding_key: '__tab__', at: '1', action: 'override', to_status: 'fail', input_hash: 'h' }];
  const latest = latestDecisions(rows);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].to_status, 'pass');
  assert.equal(effectiveValidation(result, latest[0], 'h').status, 'pass');
  assert.equal(effectiveValidation(result, latest[0], 'changed').status, 'review');
});

test('overview: worst status wins, overrides apply, unrun and failed tabs are counted', () => {
  const tabs = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
  const results = {
    a: { validation: { status: 'pass', ai_status: 'ok' }, analysis: { analysis: { recommendation: { rating: 'Weak' } }, ai_status: 'ok' } },
    b: { validation: { status: 'fail', ai_status: 'unavailable' }, analysis: null },
    c: { validation: null, analysis: null },
  };
  const o = buildOverview({ tabs, results, hashes: { a: 'h', b: 'h' }, decisions: [{ tab: 'b', kind: 'validation', finding_key: '__tab__', action: 'override', to_status: 'pass', input_hash: 'h' }] });
  assert.equal(o.overall_validation, 'pass');
  assert.equal(o.counts.overridden, 1);
  assert.equal(o.counts.not_run, 1);
  assert.equal(o.counts.weak_analysis, 1);
  assert.equal(o.counts.failed_runs, 1);
  // The analysis-based assessment sits beside the validation counts and does not alter them.
  assert.equal(o.tabs.find((t) => t.tab === 'a').analysis_score, 1);
  assert.equal(o.tabs.find((t) => t.tab === 'c').analysis_score_state, 'not_run');
  assert.equal(o.analysis_assessment.basis, 'analysis');
  // "Not configured" is a deployment choice, not a failed run.
  const nc = buildOverview({ tabs: [{ key: 'a', label: 'A' }], results: { a: { validation: { status: 'review', ai_status: 'not_configured' }, analysis: null } }, hashes: {}, decisions: [] });
  assert.equal(nc.counts.failed_runs, 0);
  assert.equal(nc.counts.ai_not_configured, 1);
  const o2 = buildOverview({ tabs, results, hashes: {}, decisions: [] });
  assert.equal(o2.overall_validation, 'fail');
});
