import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultDecisionReasonConfig,
  validateDecisionReasonConfig,
  resolveDecisionReasonConfig,
  diffDecisionReasonConfig,
  buildDecisionReasonConfig,
  reasonOptions,
  isReasonCodeValid,
  classRequiresText,
  recordDecisionReason,
  DECISION_REASON_CONFIG_KEY,
} from '../config/decisionReasons.js';
import { DECISION_CLASS_KEYS, decisionClassForState, reasonsForClass } from '../config/decisionReasonsData.js';

describe('decision reason codes (W6-01 / WF-05)', () => {
  test('the shipped default carries every decision class', () => {
    const cfg = defaultDecisionReasonConfig();
    assert.equal(cfg.version, 'DRC-01.1');
    assert.equal(cfg.revision, 1);
    assert.equal(cfg.source, 'default');
    assert.deepEqual(cfg.classes.map((c) => c.key), DECISION_CLASS_KEYS);
    assert.equal(DECISION_REASON_CONFIG_KEY, 'decision_reason_config');
  });

  test('each class ships at least four reason codes, all enabled', () => {
    const cfg = defaultDecisionReasonConfig();
    for (const cls of cfg.classes) {
      assert.ok(cls.reasons.length >= 4, cls.key + ' should ship at least four codes');
      assert.ok(cls.reasons.every((r) => r.enabled === true));
    }
  });

  test('decline requires free text and its codes are flagged as decline comparables', () => {
    const cfg = defaultDecisionReasonConfig();
    assert.equal(classRequiresText(cfg, 'decline'), true);
    assert.equal(classRequiresText(cfg, 'approve'), false);
    const declineCodes = cfg.classes.find((c) => c.key === 'decline').reasons;
    assert.ok(declineCodes.every((r) => r.counts_as_decline === true));
  });

  test('pipeline states map to their decision class', () => {
    assert.equal(decisionClassForState('declined').key, 'decline');
    assert.equal(decisionClassForState('proceed_to_gate2').key, 'proceed');
    assert.equal(decisionClassForState('on_hold').key, 'hold');
    assert.equal(decisionClassForState('withdrawn').key, 'withdraw');
    assert.equal(decisionClassForState('information_requested'), null, 'an information request carries a question, not a reason code');
    assert.equal(decisionClassForState('screening_review'), null);
  });

  test('validation rejects an unknown class', () => {
    const { ok, errors } = validateDecisionReasonConfig({ classes: [{ key: 'explode' }] });
    assert.equal(ok, false);
    assert.match(errors[0].message, /invalid/i);
  });

  test('validation rejects a blank or duplicate reason code', () => {
    assert.equal(validateDecisionReasonConfig({ classes: [{ key: 'approve', reasons: [{ id: '  ' }] }] }).ok, false);
    const dup = validateDecisionReasonConfig({ classes: [{ key: 'approve', reasons: [{ id: 'x' }, { id: 'x' }] }] });
    assert.equal(dup.ok, false);
    assert.match(dup.errors[0].message, /Duplicate/);
  });

  test('resolve fills classes a partial store omits and keeps custom codes', () => {
    const resolved = resolveDecisionReasonConfig({
      classes: [
        { key: 'decline', reasons: [{ id: 'outside_mandate', label: 'Not our mandate' }, { id: 'custom_code', label: 'Custom' }] },
      ],
    });
    assert.equal(resolved.classes.length, DECISION_CLASS_KEYS.length);
    const decline = resolved.classes.find((c) => c.key === 'decline');
    assert.equal(decline.reasons.find((r) => r.id === 'outside_mandate').label, 'Not our mandate');
    assert.ok(decline.reasons.some((r) => r.id === 'custom_code' && r.custom === true));
    assert.equal(resolved.source, 'stored');
  });

  test('resolve parses a stored JSON string', () => {
    const stored = JSON.stringify({ revision: 4, classes: [{ key: 'approve', require_text: true }] });
    const resolved = resolveDecisionReasonConfig(stored);
    assert.equal(resolved.revision, 4);
    assert.equal(classRequiresText(resolved, 'approve'), true);
  });

  test('build mints the next revision and records the actor', () => {
    const next = buildDecisionReasonConfig(
      { classes: [{ key: 'decline', reasons: [{ id: 'outside_mandate', enabled: false }] }] },
      { actor: { email: 'admin@dealforge.local' }, at: '2026-01-01T00:00:00.000Z' }
    );
    assert.equal(next.revision, 2);
    assert.equal(next.version, 'DRC-01.2');
    assert.equal(next.updated_by, 'admin@dealforge.local');
    const code = next.classes.find((c) => c.key === 'decline').reasons.find((r) => r.id === 'outside_mandate');
    assert.equal(code.enabled, false);
  });

  test('reasonOptions hides disabled codes and respects a disabled class', () => {
    const cfg = resolveDecisionReasonConfig({
      classes: [{ key: 'decline', reasons: [{ id: 'outside_mandate', enabled: false }] }],
    });
    assert.ok(!reasonOptions(cfg, 'decline').some((r) => r.id === 'outside_mandate'));
    const off = resolveDecisionReasonConfig({ classes: [{ key: 'decline', enabled: false }] });
    assert.deepEqual(reasonOptions(off, 'decline'), []);
  });

  test('isReasonCodeValid rejects unknown and blank codes', () => {
    const cfg = defaultDecisionReasonConfig();
    assert.equal(isReasonCodeValid(cfg, 'decline', 'outside_mandate'), true);
    assert.equal(isReasonCodeValid(cfg, 'decline', 'nope'), false);
    assert.equal(isReasonCodeValid(cfg, 'decline', ''), false);
  });

  test('recordDecisionReason requires a code and, for declines, free text', () => {
    const cfg = defaultDecisionReasonConfig();
    assert.equal(recordDecisionReason(cfg, { decisionClass: 'decline', code: '', text: 'because' }).ok, false);
    assert.equal(recordDecisionReason(cfg, { decisionClass: 'decline', code: 'unacceptable_risk', text: '' }).ok, false);
    const ok = recordDecisionReason(cfg, {
      decisionClass: 'decline', code: 'unacceptable_risk', text: 'Residual risk too high',
      actor: { email: 'reviewer@dealforge.local' }, at: '2026-02-02T00:00:00.000Z',
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.decision_reason, 'unacceptable_risk');
    assert.equal(ok.data.decision_reason_label, 'Unacceptable risk');
    assert.equal(ok.data.decision_reason_class, 'decline');
    assert.equal(ok.data.decision_reason_by, 'reviewer@dealforge.local');
    assert.equal(ok.data.decision_reason_text, 'Residual risk too high');
  });

  test('approve accepts a code without free text', () => {
    const cfg = defaultDecisionReasonConfig();
    const ok = recordDecisionReason(cfg, { decisionClass: 'approve', code: 'strategic_fit' });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.decision_reason_text, null);
  });

  test('diff reports a label and enablement change on a code', () => {
    const before = defaultDecisionReasonConfig();
    const after = buildDecisionReasonConfig(
      { classes: [{ key: 'decline', reasons: [{ id: 'outside_mandate', label: 'Outside our mandate', enabled: false }] }] },
      { base: before }
    );
    const changes = diffDecisionReasonConfig(before, after);
    assert.ok(changes.some((c) => c.id === 'outside_mandate' && c.field === 'label'));
    assert.ok(changes.some((c) => c.id === 'outside_mandate' && c.field === 'enabled'));
  });

  test('reasonsForClass returns the shipped codes for a class', () => {
    const codes = reasonsForClass('withdraw').map((r) => r.id);
    assert.ok(codes.includes('budget_pulled'));
  });
});
