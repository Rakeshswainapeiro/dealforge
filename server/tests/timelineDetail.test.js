import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineDetail } from '../pipeline.js';

test('a CIO override shows the named CIO, the reason and when it was recorded', () => {
  const d = timelineDetail('scorecard_override', { by: 'cio@sirius.local', reason: 'Strategic fit outweighs the score', at: '2026-11-02T10:00:00.000Z', total: 3.1 });
  assert.match(d, /Named CIO: cio@sirius\.local/);
  assert.match(d, /Reason: Strategic fit outweighs the score/);
  assert.match(d, /Recorded at: 2026-11-02T10:00:00.000Z/);
});

test('a decision transition shows its reason code and text', () => {
  const d = timelineDetail('transition', { status: 'declined', reason_code: 'strategic_misfit', reason_text: 'Outside mandate' });
  assert.match(d, /Reason code: strategic_misfit/);
  assert.match(d, /Reason: Outside mandate/);
});

test('events with nothing extra to say, and unknown events, return null', () => {
  assert.equal(timelineDetail('transition', { status: 'proceed_to_gate2' }), null);
  assert.equal(timelineDetail('something_else', { reason: 'x' }), null);
  assert.equal(timelineDetail('scorecard_override'), null);
});
