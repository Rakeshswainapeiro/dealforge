// Intake configuration tests (INT-06, INT-07, REQ-SUB-01/02, REQ-RULE-02/05).
//
// Pure functions plus the derivation of the gate's field model; no server needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  OVERVIEW_SECTIONS, INTAKE_FIELDS, SECTION_KEYS, RETURN_HURDLES,
  MIN_COMMITMENT_AED_MN, BELOW_FLOOR_EXCEPTION_IRR, ELIGIBLE_TYPES,
  OUTSIDE_APPETITE_TYPES, sectionsWithFields, sectionProgress,
  isOutsideAppetite, clearsFloor,
} from '../config/intakeConfig.js';
import { OPPORTUNITY_FIELDS } from '../gate.js';

// The documented minimum that blocks submission (E4.1 / REQ-DOCGATE-01).
const REQUIRED_KEYS = [
  'opportunity_name', 'opportunity_type', 'target_name', 'sector', 'geography',
  'total_commitment_aed', 'ask_aed', 'funding_source', 'in_approved_budget',
  'target_signing_close', 'narrative_what', 'narrative_why_now',
  'narrative_why_us', 'decision_sought',
];

describe('Opportunity Overview intake model', () => {
  test('sections are the BRD page order, header first then the six pages plus accretion', () => {
    assert.deepEqual(SECTION_KEYS, [
      'header', 'executive_summary', 'opportunity_overview', 'rationale',
      'financials', 'funding', 'risks', 'accretion',
    ]);
    assert.equal(OVERVIEW_SECTIONS[0].key, 'header');
    assert.equal(OVERVIEW_SECTIONS.at(-1).key, 'accretion');
  });

  test('every field belongs to a known section', () => {
    const known = new Set(SECTION_KEYS);
    for (const field of INTAKE_FIELDS) {
      assert.ok(known.has(field.section), field.key + ' has unknown section ' + field.section);
      assert.ok(field.label, field.key + ' needs a label');
    }
  });

  test('every section carries at least one field and select fields carry options', () => {
    for (const section of sectionsWithFields()) {
      assert.ok(section.fields.length > 0, 'section ' + section.key + ' is empty');
    }
    for (const field of INTAKE_FIELDS.filter((f) => f.type === 'select')) {
      assert.ok(Array.isArray(field.options) && field.options.length > 0, field.key + ' needs options');
    }
  });

  test('the gate blocks only the documented minimum set', () => {
    const required = OPPORTUNITY_FIELDS.filter((f) => f.required).map((f) => f.key);
    assert.deepEqual(required.sort(), [...REQUIRED_KEYS].sort());
    // The six-section enrichment is captured but does not block (W1-05 owns that).
    assert.ok(OPPORTUNITY_FIELDS.length > required.length, 'expected non-blocking fields');
  });

  test('gate OPPORTUNITY_FIELDS mirror the config field keys and sections', () => {
    assert.deepEqual(OPPORTUNITY_FIELDS.map((f) => f.key), INTAKE_FIELDS.map((f) => f.key));
    for (const field of OPPORTUNITY_FIELDS) {
      const source = INTAKE_FIELDS.find((f) => f.key === field.key);
      assert.equal(field.section, source.section);
      assert.equal(field.label, source.label);
    }
  });

  test('the Accretion Statement captures two-level accretion (REQ-SUB-02)', () => {
    const keys = INTAKE_FIELDS.filter((f) => f.section === 'accretion').map((f) => f.key);
    assert.ok(keys.includes('accretion_net_earnings_aed'));
    assert.ok(keys.includes('accretion_bps'));
    assert.ok(keys.includes('sirius_accretion_rationale'));
  });

  test('section progress counts filled fields per section', () => {
    const data = {
      opportunity_name: 'X', opportunity_type: 'strategic_acquisition', target_name: 'T',
      sector: 'Energy', geography: 'UAE', total_commitment_aed: 120, ask_aed: 60,
      funding_source: 'Balance sheet', in_approved_budget: 'yes', target_signing_close: '2027-06',
    };
    const progress = sectionProgress(data);
    const header = progress.find((s) => s.key === 'header');
    assert.equal(header.present, header.total - 2); // sourcing + disclosure still blank
    assert.ok(!header.complete);
    const accretion = progress.find((s) => s.key === 'accretion');
    assert.equal(accretion.present, 0);
    assert.equal(accretion.progress, 0);
  });

  test('floor and appetite rules (REQ-RULE-02/03/04)', () => {
    assert.equal(MIN_COMMITMENT_AED_MN, 10);
    assert.equal(BELOW_FLOOR_EXCEPTION_IRR, 35);
    assert.equal(clearsFloor(10), true);
    assert.equal(clearsFloor(9.99), false);
    assert.equal(clearsFloor(undefined), false);
    assert.equal(isOutsideAppetite('passive_punt'), true);
    assert.equal(isOutsideAppetite('strategic_acquisition'), false);
    assert.ok(ELIGIBLE_TYPES.length >= 7);
    assert.ok(OUTSIDE_APPETITE_TYPES.length >= 3);
  });

  test('return hurdles carry the BRD thresholds (REQ-RULE-05)', () => {
    const byKey = Object.fromEntries(RETURN_HURDLES.map((h) => [h.key, h]));
    assert.equal(byKey.equity_irr.threshold, 20);
    assert.equal(byKey.equity_irr.greenfield, 25);
    assert.equal(byKey.payback.threshold, 3.5);
    assert.equal(byKey.concentration.threshold, 35);
    assert.equal(byKey.leverage.threshold, 3);
  });
});
