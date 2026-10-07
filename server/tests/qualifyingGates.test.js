// Qualifying gates unit tests (W1-05 / INT-08).
//
// Pure logic only; no database or running server. Proves the ten qualifying
// gates evaluate to complete only when every gate is answered YES with its
// evidence linked, and that a single NO (or missing evidence) blocks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  QUALIFYING_GATES, QUALIFYING_GATE_ANSWERS, QUALIFYING_GATE_NOT_READY,
  QUALIFYING_GATE_FIELD_KEYS, gateAnswerKey, evaluateQualifyingGates, qualifyingGateDefaults,
} from '../config/qualifyingGates.js';

describe('qualifying gates model (INT-08)', () => {
  test('the ten gates are declared in BRD order', () => {
    assert.equal(QUALIFYING_GATES.length, 10);
    assert.deepEqual(
      QUALIFYING_GATES.map((g) => g.key),
      ['right_size', 'eligible_type', 'accretive', 'strategic_fit', 'clears_hurdles',
       'funded', 'budgeted', 'risk_owned', 'clean_governance', 'executable']
    );
    QUALIFYING_GATES.forEach((g, i) => assert.equal(g.number, i + 1, 'number for ' + g.key));
    assert.deepEqual(QUALIFYING_GATE_ANSWERS, ['yes', 'no']);
  });

  test('every gate names at least one evidence field', () => {
    for (const g of QUALIFYING_GATES) {
      assert.ok(Array.isArray(g.evidence) && g.evidence.length > 0, 'evidence for ' + g.key);
      for (const e of g.evidence) assert.ok(typeof e.key === 'string' && e.key.length > 0);
    }
  });

  test('the answer field keys are gate_<key>', () => {
    assert.deepEqual(QUALIFYING_GATE_FIELD_KEYS, QUALIFYING_GATES.map((g) => gateAnswerKey(g.key)));
    assert.equal(gateAnswerKey('accretive'), 'gate_accretive');
  });
});

describe('qualifying gate status payload (UI contract)', () => {
  // Regression: the Submit page renders the gate cards from this payload and
  // saves each answer under g.answer_key. Without it the UI called
  // handleChange(undefined, 'yes'), the answer was dropped, and no opportunity
  // could be submitted through the UI.
  test('every evaluated gate carries the field its answer is saved under', () => {
    const { gates } = evaluateQualifyingGates({});
    assert.equal(gates.length, 10);
    for (const g of gates) assert.equal(g.answer_key, gateAnswerKey(g.key), `gate ${g.key}`);
  });

  test('saving YES under answer_key is read back as that gate\'s answer', () => {
    for (const g of evaluateQualifyingGates({}).gates) {
      const after = evaluateQualifyingGates({ [g.answer_key]: 'yes' }).gates.find((x) => x.key === g.key);
      assert.equal(after.answer, 'yes', `gate ${g.key}`);
    }
  });
});

describe('qualifying gate evaluation', () => {
  test('all ten YES with evidence is complete', () => {
    const result = evaluateQualifyingGates(qualifyingGateDefaults());
    assert.equal(result.complete, true);
    assert.equal(result.blocking.length, 0);
    assert.equal(result.message, null);
    assert.ok(result.gates.every((g) => g.ready));
  });

  test('a single NO blocks with a reason naming the gate', () => {
    const result = evaluateQualifyingGates({ ...qualifyingGateDefaults(), gate_accretive: 'no' });
    assert.equal(result.complete, false);
    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0].key, 'accretive');
    assert.equal(result.message, QUALIFYING_GATE_NOT_READY);
    assert.match(result.blocking[0].reason, /Answered NO/);
  });

  test('an unanswered gate blocks', () => {
    const data = qualifyingGateDefaults();
    delete data.gate_funded;
    const result = evaluateQualifyingGates(data);
    assert.equal(result.complete, false);
    assert.equal(result.answered, false);
    assert.equal(result.blocking[0].key, 'funded');
    assert.match(result.blocking[0].reason, /Not answered/);
  });

  test('a YES with missing evidence blocks and names the field', () => {
    const data = qualifyingGateDefaults();
    data.risk_register = '';
    const result = evaluateQualifyingGates(data);
    assert.equal(result.complete, false);
    const gate = result.gates.find((g) => g.key === 'risk_owned');
    assert.equal(gate.answer, 'yes');
    assert.equal(gate.evidence_complete, false);
    assert.match(gate.reason, /Evidence missing/);
  });

  test('a clean-governance gate needs all three compliance screens', () => {
    const data = qualifyingGateDefaults();
    data.compliance_esg = '';
    const result = evaluateQualifyingGates(data);
    assert.equal(result.complete, false);
    const gate = result.gates.find((g) => g.key === 'clean_governance');
    assert.equal(gate.evidence.length, 3);
    assert.equal(gate.ready, false);
  });

  test('an empty opportunity has all ten gates blocking', () => {
    const result = evaluateQualifyingGates({});
    assert.equal(result.complete, false);
    assert.equal(result.blocking.length, 10);
    assert.equal(result.answered, false);
  });
});
