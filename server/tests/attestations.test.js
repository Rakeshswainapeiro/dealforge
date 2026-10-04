// CEO + CFO attestation gate unit tests (W1-06 / INT-09).
//
// Pure logic only; no database or running server. Proves the gate needs two
// separate named attestations (person + timestamp) and that one alone blocks,
// and that the wording is configurable with a safe default.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTESTATION_ROLES, ATTESTATION_ROLE_KEYS, ATTESTATION_REQUIRED_MESSAGE,
  DEFAULT_ATTESTATION_TEXTS, resolveAttestationTexts, evaluateAttestations,
  attestationDefaults,
} from '../config/attestations.js';

describe('attestation model (INT-09)', () => {
  test('there are exactly two named attestations, CEO then CFO', () => {
    assert.equal(ATTESTATION_ROLES.length, 2);
    assert.deepEqual(ATTESTATION_ROLE_KEYS, ['ceo', 'cfo']);
    assert.deepEqual(
      ATTESTATION_ROLES.map((a) => a.role),
      ['subsidiary_ceo', 'subsidiary_cfo']
    );
  });

  test('each role ships default wording', () => {
    for (const key of ATTESTATION_ROLE_KEYS) {
      assert.ok(typeof DEFAULT_ATTESTATION_TEXTS[key] === 'string' && DEFAULT_ATTESTATION_TEXTS[key].length > 20);
    }
  });

  test('wording is configurable and falls back to the default', () => {
    const overridden = resolveAttestationTexts({ ceo: 'Custom CEO text' });
    assert.equal(overridden.ceo, 'Custom CEO text');
    assert.equal(overridden.cfo, DEFAULT_ATTESTATION_TEXTS.cfo);
    // Blank overrides are ignored rather than blanking the default.
    const blanked = resolveAttestationTexts({ ceo: '   ' });
    assert.equal(blanked.ceo, DEFAULT_ATTESTATION_TEXTS.ceo);
  });
});

describe('attestation evaluation', () => {
  test('both recorded is complete', () => {
    const result = evaluateAttestations({ attestations: attestationDefaults() });
    assert.equal(result.complete, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.message, null);
    assert.ok(result.roles.every((r) => r.attested));
  });

  test('no attestations is incomplete and names both roles', () => {
    const result = evaluateAttestations({});
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['ceo', 'cfo']);
    assert.equal(result.message, ATTESTATION_REQUIRED_MESSAGE);
  });

  test('one attestation alone still blocks', () => {
    const defaults = attestationDefaults();
    const result = evaluateAttestations({ attestations: { ceo: defaults.ceo } });
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['cfo']);
  });

  test('an attestation without a person or timestamp does not count', () => {
    const partial = evaluateAttestations({ attestations: { ceo: { by: '' }, cfo: { at: '2026-01-01' } } });
    assert.equal(partial.complete, false);
    assert.deepEqual(partial.missing, ['ceo', 'cfo']);
  });

  test('the resolved wording is carried onto each role', () => {
    const result = evaluateAttestations({}, { texts: { ceo: 'Custom' } });
    assert.equal(result.roles.find((r) => r.key === 'ceo').text, 'Custom');
  });
});
