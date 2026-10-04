// ---------------------------------------------------------------------------
// Unit tests for the sanctions / adverse-media manual confirmation
// (W3-12 / BRD SCR-08).
//
//   node --test server/tests/adverseMedia.test.js
//
// Pure module: the tests pass the captured fields and the document keys by
// hand and assert the status normalisation, the clear-with-evidence rule and
// the advisory posture (an adverse finding is a flag, never a rejection).
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVERSE_MEDIA_VERSION, ADVERSE_MEDIA_NOTES_MIN, ADVERSE_MEDIA_EVIDENCE_DOC_KEY,
  ADVERSE_MEDIA_MESSAGES, ADVERSE_MEDIA_DOC_REQUIREMENTS, evaluateAdverseMedia,
} from '../config/adverseMedia.js';

const note = 'Screened the target and its owners; no sanctions or adverse-media matches.';

describe('adverse-media confirmation (W3-12 / SCR-08)', () => {
  test('an unconfirmed record is a flag, not a pass', () => {
    const r = evaluateAdverseMedia({}, { documents: [] });
    assert.equal(r.version, ADVERSE_MEDIA_VERSION);
    assert.equal(r.status, 'missing');
    assert.equal(r.complete, false);
    assert.equal(r.satisfied, false);
    assert.equal(r.flags[0].code, 'adverse_media_unconfirmed');
    assert.equal(r.message, ADVERSE_MEDIA_MESSAGES.missing);
  });

  test('a clear verdict with a note and evidence is satisfied', () => {
    const r = evaluateAdverseMedia(
      { adverse_media_confirmation: 'clear', adverse_media_note: note, adverse_media_source: 'DJ', adverse_media_reviewed_by: 'a@b.c' },
      { documents: [ADVERSE_MEDIA_EVIDENCE_DOC_KEY] },
    );
    assert.equal(r.status, 'clear');
    assert.equal(r.satisfied, true);
    assert.equal(r.note_ok, true);
    assert.equal(r.evidence_present, true);
    assert.equal(r.evidence_on_record, true);
    assert.equal(r.source, 'DJ');
    assert.equal(r.flags.length, 0);
  });

  test('a clear verdict with a short note and no evidence is flagged on both counts', () => {
    const r = evaluateAdverseMedia({ adverse_media_confirmation: 'clear', adverse_media_note: 'short' }, { documents: [] });
    assert.equal(r.status, 'clear');
    assert.equal(r.satisfied, false);
    assert.equal(r.note_ok, false);
    assert.deepEqual(r.flags.map((f) => f.code).sort(), ['adverse_media_evidence_missing', 'adverse_media_note_missing']);
    assert.equal(ADVERSE_MEDIA_NOTES_MIN, 10);
  });

  test('an evidence reference alone satisfies the evidence requirement', () => {
    const r = evaluateAdverseMedia(
      { adverse_media_confirmation: 'clear', adverse_media_note: note, adverse_media_evidence_reference: 'DJR-2026-1' },
      { documents: [] },
    );
    assert.equal(r.evidence_present, false);
    assert.equal(r.evidence_reference, 'DJR-2026-1');
    assert.equal(r.evidence_on_record, true);
    assert.equal(r.satisfied, true);
  });

  test('an adverse finding is a flag that escalates, never a rejection', () => {
    const r = evaluateAdverseMedia({ adverse_media_confirmation: 'adverse' }, { documents: [] });
    assert.equal(r.status, 'adverse');
    assert.equal(r.complete, true);
    assert.equal(r.satisfied, false);
    assert.equal(r.flags[0].code, 'adverse_media_exposure');
  });

  test('a pending verdict is flagged as outstanding', () => {
    const r = evaluateAdverseMedia({ adverse_media_confirmation: 'pending' }, { documents: [] });
    assert.equal(r.status, 'pending');
    assert.equal(r.complete, false);
    assert.equal(r.flags[0].code, 'adverse_media_pending');
  });

  test('an unrecognised verdict is reported, not silently passed', () => {
    const r = evaluateAdverseMedia({ adverse_media_confirmation: 'banana' }, { documents: [] });
    assert.equal(r.status, 'unrecognised');
    assert.equal(r.message, ADVERSE_MEDIA_MESSAGES.unrecognised);
  });

  test('the evidence document requirement is not gate-enforced', () => {
    assert.equal(ADVERSE_MEDIA_DOC_REQUIREMENTS.length, 1);
    assert.equal(ADVERSE_MEDIA_DOC_REQUIREMENTS[0].key, ADVERSE_MEDIA_EVIDENCE_DOC_KEY);
    assert.equal(ADVERSE_MEDIA_DOC_REQUIREMENTS[0].gate, false);
  });
});
