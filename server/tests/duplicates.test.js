// Unit tests for the duplicate-detection helpers (W1-10 / INT-12).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nameTokens, nameKey, compareOpportunities, findDuplicates } from '../config/duplicates.js';

describe('duplicate detection — name normalisation', () => {
  test('drops legal suffixes, short words and punctuation', () => {
    const tokens = nameTokens('Emircom Cloud Services LLC');
    assert.deepEqual(tokens, ['emircom', 'cloud', 'services']);
  });

  test('a sorted token key ignores word order and punctuation', () => {
    assert.equal(nameKey('Cloud Platforms Consolidation'), nameKey('Consolidation of Cloud Platforms'));
  });
});

describe('duplicate detection — comparison', () => {
  test('the same target / counterparty is a duplicate', () => {
    const v = compareOpportunities(
      { data: { target_name: 'Emircom Cloud Services', opportunity_name: 'Cloud Platforms Consolidation' } },
      { data: { target_name: 'Emircom Cloud Services LLC', opportunity_name: 'Something else entirely' } }
    );
    assert.equal(v.is_duplicate, true);
    assert.equal(v.same_target, true);
  });

  test('a similar opportunity name is a duplicate', () => {
    const v = compareOpportunities(
      { data: { target_name: 'Alpha Holdings', opportunity_name: 'Digital Assets Custody Platform' } },
      { data: { target_name: 'Beta Holdings', opportunity_name: 'Digital Assets Custody Platform' } }
    );
    assert.equal(v.is_duplicate, true);
    assert.equal(v.same_name, true);
    assert.equal(v.same_target, false);
  });

  test('unrelated targets and names do not match', () => {
    const v = compareOpportunities(
      { data: { target_name: 'Emircom Cloud Services', opportunity_name: 'Cloud Platforms Consolidation' } },
      { data: { target_name: 'Coastal Fibre Networks', opportunity_name: 'Telecom Fibre Roll-up' } }
    );
    assert.equal(v.is_duplicate, false);
  });

  test('generic-only names do not create a false match', () => {
    const v = compareOpportunities(
      { data: { target_name: 'The Group Holding Co LLC' } },
      { data: { target_name: 'Group Holdings Ltd' } }
    );
    assert.equal(v.is_duplicate, false, 'only stop-words remain, so no meaningful overlap');
  });
});

describe('duplicate detection — candidate set', () => {
  test('findDuplicates excludes the subject and ranks same-target first', () => {
    const rows = [
      { id: 'a', owner_org_id: 'org-inf', data: { target_name: 'Emircom Cloud Services', opportunity_name: 'Cloud Platforms Consolidation' } },
      { id: 'b', owner_org_id: 'org-fin', data: { target_name: 'Emircom Cloud Services', opportunity_name: 'Finstreet view' } },
      { id: 'c', owner_org_id: 'org-fin', data: { target_name: 'Unrelated Assets', opportunity_name: 'Different deal' } },
    ];
    const matches = findDuplicates(rows[0], rows);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].opportunity_id, 'b');
    assert.equal(matches[0].same_target, true);
  });

  test('findDuplicates tolerates an empty candidate set', () => {
    assert.deepEqual(findDuplicates({ id: 'x', data: {} }, []), []);
  });
});
