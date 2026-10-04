// ---------------------------------------------------------------------------
// Unit tests for the WACC input and per-opportunity override (W2-05 / FIN-05).
// Pure functions only — no server, no database.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WACC_DEFAULT_PCT, WACC_OVERRIDE_FIELD, WACC_OVERRIDE_REASON_FIELD,
  WACC_OVERRIDE_REASON_MESSAGE, resolveWacc, meetsWaccSpread,
} from '../config/wacc.js';

describe('resolveWacc', () => {
  test('falls back to the system default when no entity value is configured', () => {
    const r = resolveWacc({}, { orgWacc: null });
    assert.equal(r.effective_wacc, WACC_DEFAULT_PCT);
    assert.equal(r.source, 'system_default');
    assert.equal(r.has_override, false);
  });

  test('uses the entity WACC as the default', () => {
    const r = resolveWacc({}, { orgWacc: 9.5 });
    assert.equal(r.entity_wacc, 9.5);
    assert.equal(r.effective_wacc, 9.5);
    assert.equal(r.source, 'entity_default');
  });

  test('applies a per-opportunity override with a reason', () => {
    const r = resolveWacc({ [WACC_OVERRIDE_FIELD]: 11.5, [WACC_OVERRIDE_REASON_FIELD]: 'Higher country risk premium.' }, { orgWacc: 9 });
    assert.equal(r.effective_wacc, 11.5);
    assert.equal(r.source, 'opportunity_override');
    assert.equal(r.has_override, true);
    assert.equal(r.override_reason_present, true);
    assert.equal(r.override_valid, true);
    assert.match(r.message, /override/i);
  });

  test('flags an override that carries no reason', () => {
    const r = resolveWacc({ [WACC_OVERRIDE_FIELD]: 11 }, { orgWacc: 9 });
    assert.equal(r.has_override, true);
    assert.equal(r.override_reason_present, false);
    assert.equal(r.override_valid, false);
    assert.equal(r.message, WACC_OVERRIDE_REASON_MESSAGE);
  });

  test('treats a blank reason as missing', () => {
    const r = resolveWacc({ [WACC_OVERRIDE_FIELD]: 11, [WACC_OVERRIDE_REASON_FIELD]: '   ' }, {});
    assert.equal(r.override_reason_present, false);
    assert.equal(r.override_valid, false);
  });
});

describe('meetsWaccSpread', () => {
  test('compares ROIC against WACC plus the spread', () => {
    const r = meetsWaccSpread(19, 8, 5);
    assert.equal(r.hurdle, 13);
    assert.equal(r.meets, true);
    const below = meetsWaccSpread(12, 8, 5);
    assert.equal(below.meets, false);
  });

  test('returns null when an input is missing', () => {
    assert.equal(meetsWaccSpread(null, 8, 5), null);
    assert.equal(meetsWaccSpread(19, null, 5), null);
    assert.equal(meetsWaccSpread(19, 8, null), null);
  });
});
