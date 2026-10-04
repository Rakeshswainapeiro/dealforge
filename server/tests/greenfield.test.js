// Greenfield extra tests unit tests (W1-07 / INT-10).
//
// Pure logic only; no database or running server. Proves the extra tests apply
// only to greenfield / new ventures, that a greenfield without a secured funding
// source is blocked, and that a Concept-stage entry requires no full document
// pack (the two-page concept note is enough).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  GREENFIELD_TYPE, GREENFIELD_STAGES, GREENFIELD_STAGE_KEYS, CONCEPT_NOTE_MAX_PAGES,
  GREENFIELD_FIELDS, GREENFIELD_NOT_READY, SECURED_FUNDING_STATUS,
  isGreenfield, evaluateGreenfield, greenfieldDefaults,
} from '../config/greenfield.js';

describe('greenfield extra tests model (INT-10)', () => {
  test('the three stages are Concept, Feasibility and Initiate', () => {
    assert.deepEqual(GREENFIELD_STAGE_KEYS, ['concept', 'feasibility', 'initiate']);
    assert.equal(GREENFIELD_STAGES.length, 3);
    assert.equal(GREENFIELD_TYPE, 'greenfield');
  });

  test('only Concept waives the full document pack', () => {
    const byKey = Object.fromEntries(GREENFIELD_STAGES.map((s) => [s.value, s]));
    assert.equal(byKey.concept.documents_required, false);
    assert.equal(byKey.feasibility.documents_required, true);
    assert.equal(byKey.initiate.documents_required, true);
    assert.equal(CONCEPT_NOTE_MAX_PAGES, 2);
  });

  test('the captured field names are stable', () => {
    assert.equal(GREENFIELD_FIELDS.stage, 'greenfield_stage');
    assert.equal(GREENFIELD_FIELDS.benefit, 'greenfield_benefit');
    assert.equal(GREENFIELD_FIELDS.secured_source, 'greenfield_secured_funding_source');
    assert.equal(SECURED_FUNDING_STATUS, 'secured');
  });
});

describe('greenfield evaluation', () => {
  test('a non-greenfield opportunity returns null (tests do not apply)', () => {
    assert.equal(isGreenfield('strategic_acquisition'), false);
    assert.equal(evaluateGreenfield({ opportunity_type: 'bolt_on' }), null);
    assert.equal(evaluateGreenfield({}), null);
  });

  test('a fully-specified greenfield is satisfied', () => {
    const data = {
      opportunity_type: 'greenfield',
      ...greenfieldDefaults(),
      narrative_what: 'Build a new platform.',
      narrative_why_now: 'The window is open.',
      narrative_why_us: 'We hold the adjacent stack.',
    };
    const result = evaluateGreenfield(data);
    assert.equal(result.applies, true);
    assert.equal(result.satisfied, true);
    assert.equal(result.stops.length, 0);
    assert.equal(result.message, null);
    assert.equal(result.secured, true);
    assert.equal(result.stage, 'feasibility');
  });

  test('an unsecured greenfield is blocked with the funding message', () => {
    const data = {
      opportunity_type: 'greenfield',
      ...greenfieldDefaults({ funding_sources_status: 'indicative', greenfield_secured_funding_source: '' }),
      narrative_what: 'Build a new platform.',
      narrative_why_now: 'The window is open.',
      narrative_why_us: 'We hold the adjacent stack.',
    };
    const result = evaluateGreenfield(data);
    assert.equal(result.satisfied, false);
    const codes = result.stops.map((s) => s.code);
    assert.ok(codes.includes('funding_not_secured'));
    assert.ok(codes.includes('funding_source_required'));
    assert.equal(result.message, GREENFIELD_NOT_READY);
  });

  test('a Concept-stage greenfield waives the full document pack', () => {
    const data = {
      opportunity_type: 'greenfield',
      ...greenfieldDefaults({ greenfield_stage: 'concept' }),
      narrative_what: 'Build a new platform.',
      narrative_why_now: 'The window is open.',
      narrative_why_us: 'We hold the adjacent stack.',
    };
    const result = evaluateGreenfield(data);
    assert.equal(result.stage, 'concept');
    assert.equal(result.documents_required, false);
    assert.equal(result.satisfied, true);
  });

  test('a missing stage blocks and defaults documents to required', () => {
    const data = {
      opportunity_type: 'greenfield',
      ...greenfieldDefaults({ greenfield_stage: '' }),
      narrative_what: 'Build a new platform.',
      narrative_why_now: 'The window is open.',
      narrative_why_us: 'We hold the adjacent stack.',
    };
    const result = evaluateGreenfield(data);
    assert.equal(result.stage_valid, false);
    assert.equal(result.documents_required, true);
    assert.ok(result.stops.some((s) => s.code === 'stage_required'));
  });

  test('a missing benefit or thesis blocks', () => {
    const result = evaluateGreenfield({
      opportunity_type: 'greenfield',
      ...greenfieldDefaults({ greenfield_benefit: '' }),
    });
    assert.ok(result.stops.some((s) => s.code === 'benefit_required'));
    assert.ok(result.stops.some((s) => s.code === 'thesis_required'));
  });
});
