import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCheck, groupChecks, summariseChecks, plainReason } from '../../src/components/review/validationModel.js';

// The wording the reviewer's AI Validation card shows. Pure functions; the
// inputs use the exact stored titles and details the backend produces.
const c = (key, status, detail, extra = {}) => ({ key, title: 'Stored title', status, detail, source: 'rules', ...extra });

test('groups checks by status and summarises them', () => {
  const g = groupChecks([c('a', 'fail', ''), c('b', 'review', ''), c('c', 'review', ''), c('d', 'pass', ''), c('e', 'weird', '')]);
  assert.deepEqual([g.fail.length, g.review.length, g.pass.length], [1, 3, 1], 'an unknown status counts as review');
  assert.equal(summariseChecks(g), '1 failed · 3 needs review · 1 passed');
  assert.equal(summariseChecks(groupChecks([c('d', 'pass', '')])), '1 passed');
  assert.equal(summariseChecks(groupChecks([])), '');
});

test('funding and financial mismatches use "Financial mismatch" and keep the reason', () => {
  const d = describeCheck(c('commitment_split', 'fail', 'Sources total AED 100 mn but the total commitment is AED 120 mn (difference 20 mn).'));
  assert.equal(d.headline, 'Financial mismatch');
  assert.match(d.reason, /Sources total AED 100 mn/);
  for (const key of ['sources_uses', 'ask_within_total', 'statements_balance']) {
    assert.equal(describeCheck(c(key, 'fail', 'x')).headline, 'Financial mismatch', key);
  }
});

test('missing information reads "Incomplete information"', () => {
  assert.equal(describeCheck(c('checklist', 'review', 'Missing: Decision sought, Next steps.')).headline, 'Incomplete information');
  assert.equal(describeCheck(c('commitment_split', 'review', 'The sources and uses table is not filled in.')).headline, 'Incomplete information');
  assert.equal(describeCheck(c('periods', 'review', '2 period figure(s) are missing from the summary.')).headline, 'Incomplete information');
  assert.equal(describeCheck(c('returns_captured', 'review', 'Some returns are missing.')).headline, 'Incomplete information');
  assert.equal(describeCheck(c('sufficiency', 'review', 'Missing: downside case.')).headline, 'Insufficient supporting information');
});

test('missing documents are told apart from incorrect and unreadable ones', () => {
  const ai = (status, detail) => describeCheck(c('right_document', status, detail, { source: 'ai' })).headline;
  assert.equal(ai('review', 'No documents are attached to this tab yet, so the right-document check could not be made.'), 'Supporting documents missing');
  assert.equal(ai('fail', 'The file uploaded as the cap table is a marketing brochure.'), 'Incorrect supporting document');
  assert.equal(ai('review', 'The file content is not readable here; judged on name only.'), 'Supporting document could not be read');
  assert.equal(ai('review', 'The file name does not clearly match the slot.'), 'Supporting document to be confirmed');
  assert.equal(ai('pass', 'Matches.'), 'Right supporting documents attached');
  assert.equal(ai('review', 'The AI did not assess this check.'), 'Not assessed');
});

test('mandate conflicts name the mandate that was breached', () => {
  assert.equal(describeCheck(c('intent_fit', 'fail', 'Activity is outside the mandate.', { source: 'ai' })).headline, 'Investment mandate mismatch');
  assert.equal(describeCheck(c('intent_fit', 'review', 'Unclear.', { source: 'ai' })).headline, 'Investment mandate to be confirmed');
  assert.equal(describeCheck(c('mandate_rules', 'review', 'The sector is outside the group mandate.')).headline, 'Group mandate mismatch');
});

test('consistency: a real conflict is an inconsistency, an unconfirmed one is not', () => {
  assert.equal(describeCheck(c('consistency', 'fail', 'Revenue differs between the summary and the model.', { source: 'ai' })).headline, 'Information inconsistency');
  assert.equal(describeCheck(c('consistency', 'review', 'Cannot tell.', { source: 'ai' })).headline, 'Consistency not confirmed');
});

test('the technical rule-check lead-in is not shown in the default view', () => {
  const stored = 'A rule-based check failed (Commitment split adds up), so the content cannot be called consistent. Figures look aligned otherwise.';
  const d = describeCheck(c('consistency', 'review', stored, { source: 'ai' }));
  assert.equal(d.headline, 'Consistency not confirmed');
  assert.doesNotMatch(d.reason, /rule-based/i);
  assert.equal(d.reason, 'Figures look aligned otherwise.');
  assert.equal(d.detail, stored, 'the full stored note stays available for Details');
  // Nothing useful after the lead-in.
  const bare = describeCheck(c('consistency', 'review', 'A rule-based check failed (Sources equal uses), so the content cannot be called consistent. No detail given.', { source: 'ai' }));
  assert.equal(bare.reason, 'Resolve the failed finding above first.');
  assert.equal(plainReason('No detail given.'), '');
});

test('screening checks read as screening concerns', () => {
  assert.equal(describeCheck(c('hard_filters', 'fail', 'Failed: Sanctions.')).headline, 'Screening concern');
  assert.equal(describeCheck(c('hard_filters', 'review', 'To confirm: Structuring.')).headline, 'Screening to be confirmed');
  assert.equal(describeCheck(c('disqualifiers', 'fail', 'Raised: Sanctions / PEP.')).headline, 'Screening concern');
  assert.equal(describeCheck(c('disqualifiers', 'review', '2 of 4 disqualifiers not yet evaluated: A, B.')).headline, 'Screening to be confirmed');
  assert.equal(describeCheck(c('sanctions_consistency', 'review', 'x')).headline, 'Screening concern');
});

test('the risk register headline follows its actual problem', () => {
  assert.equal(describeCheck(c('risk_register', 'review', '3 risks listed; expected 5-8; no named owner on risk 2.')).headline, 'Incomplete information');
  assert.equal(describeCheck(c('risk_register', 'review', 'The risk register could not be read as a list of risks with owners, severities and mitigations, so it was not checked.')).headline, 'Risk register not readable');
});

test('a passed check shows its headline only; the stored note stays in Details', () => {
  const d = describeCheck(c('checklist', 'pass', '11 of 11 required fields filled.'));
  assert.equal(d.headline, 'Required information provided');
  assert.equal(d.reason, '');
  assert.equal(d.detail, '11 of 11 required fields filled.');
});

test('an unknown check falls back to its stored title and detail', () => {
  const d = describeCheck({ key: 'brand_new', title: 'Brand new check', status: 'review', detail: 'Something to look at.', source: 'ai' });
  assert.equal(d.headline, 'Brand new check');
  assert.equal(d.reason, 'Something to look at.');
  assert.equal(d.source, 'AI');
  // No title at all: the key is shown rather than nothing.
  assert.equal(describeCheck({ key: 'x', status: 'fail', detail: '' }).headline, 'x');
});

test('describeCheck never changes the stored check', () => {
  const check = Object.freeze(c('commitment_split', 'fail', 'Sources total AED 100 mn.'));
  assert.doesNotThrow(() => describeCheck(check));
  assert.equal(check.status, 'fail');
});
