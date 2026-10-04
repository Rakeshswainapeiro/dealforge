// Usability UAT gate (W9-07 / NFR-07) — pure scoring of recorded pilot sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PILOT_TASKS, USABILITY_CRITERIA, USABILITY_VERSION,
  scoreTask, scorePilot, evaluateUsabilityUat,
} from '../config/usability.js';

const GATE_IDS = PILOT_TASKS.filter((t) => t.unaided).map((t) => t.id);

function fullSession(pilot, { assisted = [], sus = 80, issues = [] } = {}) {
  const tasks = PILOT_TASKS.map((t) => ({
    id: t.id,
    success: true,
    assisted: assisted.includes(t.id),
  }));
  return { pilot, tasks, sus, issues };
}

test('catalog: every gate task is a known pilot task', () => {
  assert.ok(PILOT_TASKS.length >= 5);
  assert.equal(USABILITY_VERSION, 'NFR-07.1');
  assert.ok(GATE_IDS.length >= 4);
});

test('scoreTask: only success without assistance counts as unaided', () => {
  assert.equal(scoreTask({ id: 'x', success: true, assisted: false }).unaided, true);
  assert.equal(scoreTask({ id: 'x', success: true, assisted: true }).unaided, false);
  assert.equal(scoreTask({ id: 'x', success: false }).unaided, false);
});

test('scorePilot: a pilot is unaided only when every gate task is unaided', () => {
  const clean = scorePilot(fullSession('p1'));
  assert.equal(clean.unaided, true);
  assert.equal(clean.gate_tasks_unaided, GATE_IDS.length);
  const helped = scorePilot(fullSession('p2', { assisted: [GATE_IDS[0]] }));
  assert.equal(helped.unaided, false);
});

test('evaluate: fewer than the minimum pilots blocks the gate', () => {
  const r = evaluateUsabilityUat({ pilots: [fullSession('p1'), fullSession('p2')] });
  assert.equal(r.pass, false);
  assert.match(r.blocked_reason, /fewer than/);
  assert.equal(r.criteria.min_pilots, USABILITY_CRITERIA.min_pilots);
});

test('evaluate: three unaided pilots with no critical issues pass', () => {
  const r = evaluateUsabilityUat({
    pilots: [fullSession('p1'), fullSession('p2'), fullSession('p3')],
  });
  assert.equal(r.pass, true);
  assert.equal(r.unaided_rate, 1);
  assert.equal(r.blocked_reason, null);
});

test('evaluate: a critical issue fails the gate even with enough pilots', () => {
  const r = evaluateUsabilityUat({
    pilots: [fullSession('p1'), fullSession('p2'), fullSession('p3')],
    issues: [{ severity: 'critical', note: 'pilot could not submit' }],
  });
  assert.equal(r.pass, false);
  assert.equal(r.critical_issues, 1);
});

test('evaluate: an assisted pilot drags the unaided rate below the threshold', () => {
  const r = evaluateUsabilityUat({
    pilots: [fullSession('p1'), fullSession('p2', { assisted: [GATE_IDS[1]] }), fullSession('p3')],
  });
  assert.equal(r.unaided_rate, 0.667);
  assert.equal(r.pass, false);
});

test('evaluate: a below-target SUS mean fails the gate', () => {
  const r = evaluateUsabilityUat({
    pilots: [
      fullSession('p1', { sus: 60 }),
      fullSession('p2', { sus: 55 }),
      fullSession('p3', { sus: 58 }),
    ],
  });
  assert.equal(r.pass, false);
  assert.ok(r.sus_mean < USABILITY_CRITERIA.sus_target);
});
