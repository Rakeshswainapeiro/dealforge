// ---------------------------------------------------------------------------
// Unit tests for the Gate-1 soft filters (W3-03 / SCR-04).
//
//   node --test server/tests/softFilters.test.js
//
// Pure module: the tests pass the theme, the portfolio register and the
// national-priority configuration by hand and assert the three proposed scores,
// the aggregate band and the reviewer decision. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSoftFilters, buildSoftFilterReview, SOFT_FILTER_KEYS, SOFT_FILTER_ITEMS,
  SOFT_FILTER_OUTCOMES, SOFT_FILTER_REVIEW_DECISIONS, SOFT_FILTER_REVIEW_TAG,
  SOFT_FILTER_SCALE,
  proposePortfolioAdjacency, proposeNationalPriorities, proposeManagementOpenness,
} from '../config/softFilters.js';

const THEME = { sector: 'Technology', keywords: ['data centre', 'cloud'], min_aed: 10, max_aed: 500 };
const CLEAN = {
  sector: 'Technology',
  geography: 'UAE',
  total_commitment_aed: 120,
  soft_filter_management_openness: 'open',
};
const byKey = (sf) => Object.fromEntries(sf.items.map((i) => [i.key, i]));

describe('soft filter vocabulary (SCR-04)', () => {
  test('names the three BRD filters in order with a 1-5 scale', () => {
    assert.deepEqual(SOFT_FILTER_KEYS, ['portfolio_adjacency', 'national_priorities', 'management_openness']);
    assert.deepEqual(SOFT_FILTER_ITEMS.map((i) => i.order), [1, 2, 3]);
    assert.deepEqual(SOFT_FILTER_OUTCOMES, ['strong', 'moderate', 'weak']);
    assert.deepEqual(SOFT_FILTER_REVIEW_DECISIONS, ['confirmed', 'adjusted']);
    assert.deepEqual(SOFT_FILTER_SCALE.map((s) => s.value), [1, 2, 3, 4, 5]);
  });
});

describe('soft filter proposals (SCR-04)', () => {
  test('adjacency prefers the portfolio register and scores a direct sector match 4-5', () => {
    const one = proposePortfolioAdjacency({ sector: 'Technology' }, { portfolio: [{ name: 'A', sector: 'Technology' }] });
    assert.equal(one.score, 4);
    const two = proposePortfolioAdjacency({ sector: 'Technology' }, { portfolio: [{ name: 'A', sector: 'Technology' }, { name: 'B', sector: 'technology' }] });
    assert.equal(two.score, 5);
    const none = proposePortfolioAdjacency({ sector: 'Technology' }, { portfolio: [{ name: 'A', sector: 'Energy' }] });
    assert.equal(none.score, 2);
  });

  test('adjacency falls back to the mandate theme when no register is loaded', () => {
    const p = proposePortfolioAdjacency({ sector: 'Technology' }, { theme: THEME });
    assert.equal(p.score, 4);
    assert.ok(p.rationale.includes('Technology'));
  });

  test('national priorities score a UAE priority sector 5 and an outside-UAE deal 2', () => {
    assert.equal(proposeNationalPriorities({ geography: 'UAE', sector: 'Technology' }).score, 5);
    assert.equal(proposeNationalPriorities({ geography: 'United Arab Emirates', sector: 'Consumer Goods' }).score, 5);
    assert.equal(proposeNationalPriorities({ geography: 'UAE', sector: 'Unknown' }).score, 4);
    assert.equal(proposeNationalPriorities({ geography: 'Saudi Arabia', sector: 'Technology' }).score, 3);
    assert.equal(proposeNationalPriorities({ geography: 'United Kingdom', sector: 'Technology' }).score, 2);
  });

  test('management openness reads the captured verdict and defaults neutral', () => {
    assert.equal(proposeManagementOpenness({ soft_filter_management_openness: 'open' }).score, 5);
    assert.equal(proposeManagementOpenness({ soft_filter_management_openness: 'neutral' }).score, 3);
    assert.equal(proposeManagementOpenness({ soft_filter_management_openness: 'resistant' }).score, 2);
    assert.equal(proposeManagementOpenness({}).score, 3);
  });
});

describe('soft filter evaluation (SCR-04)', () => {
  test('a clean UAE technology deal proposes strong scores and awaits review', () => {
    const sf = evaluateSoftFilters(CLEAN, { theme: THEME });
    assert.equal(sf.item_count, 3);
    assert.equal(sf.awaiting_review, true);
    assert.equal(sf.confirmed, false);
    assert.equal(sf.outcome, 'strong');
    assert.deepEqual(sf.weak, []);
    for (const item of sf.items) assert.ok(item.proposed_score >= 1 && item.proposed_score <= 5, item.key);
    assert.ok(sf.message.length > 0);
  });

  test('a weak set reads as weak and lists the weak filters without blocking', () => {
    const sf = evaluateSoftFilters({ sector: 'Unknown', geography: 'United Kingdom', soft_filter_management_openness: 'resistant' }, { theme: null });
    assert.equal(sf.items.find((i) => i.key === 'management_openness').proposed_score, 2);
    assert.ok(sf.weak.includes('management_openness'));
    assert.ok(['weak', 'moderate'].includes(sf.outcome));
    // A soft filter never fails the set: there is no 'fail' concept here.
    assert.equal(sf.complete, false);
  });

  test('a confirmed review sets the effective scores and the outcome', () => {
    const data = {
      ...CLEAN,
      [SOFT_FILTER_REVIEW_TAG]: {
        decision: 'adjusted',
        scores: { portfolio_adjacency: 2, national_priorities: 3, management_openness: 2 },
        rationales: {
          portfolio_adjacency: 'No adjacent holding after diligence.',
          national_priorities: 'Indirect national-agenda support only.',
          management_openness: 'Management prefers a passive holder.',
        },
      },
    };
    const sf = evaluateSoftFilters(data, { theme: THEME });
    assert.equal(sf.confirmed, true);
    assert.equal(sf.awaiting_review, false);
    const k = byKey(sf);
    assert.equal(k.portfolio_adjacency.score, 2);
    assert.equal(k.portfolio_adjacency.proposed_score, 4);
    assert.equal(k.portfolio_adjacency.adjusted, true);
    assert.ok(k.portfolio_adjacency.rationale.includes('No adjacent holding'));
    assert.ok(sf.average <= 3);
  });
});

describe('soft filter review validation (SCR-04)', () => {
  const scores = { portfolio_adjacency: 4, national_priorities: 5, management_openness: 3 };
  const rationales = {
    portfolio_adjacency: 'Direct adjacency to the technology holdings.',
    national_priorities: 'UAE priority sector and national agenda.',
    management_openness: 'Management is neutral pending terms.',
  };

  test('accepts a fully scored, reasoned decision', () => {
    const review = buildSoftFilterReview({ decision: 'confirmed', scores, rationales }, { actor: { email: 'cio@sirius.local' } });
    assert.equal(review.decision, 'confirmed');
    assert.deepEqual(review.scores, scores);
    assert.equal(review.by, 'cio@sirius.local');
  });

  test('rejects an unknown decision, a missing score and a short rationale', () => {
    assert.throws(() => buildSoftFilterReview({ decision: 'maybe', scores, rationales }), /decision must be one of/);
    assert.throws(() => buildSoftFilterReview({ decision: 'confirmed', scores: { ...scores, management_openness: 9 }, rationales }), /whole number from 1 to 5/);
    assert.throws(() => buildSoftFilterReview({ decision: 'confirmed', scores, rationales: { ...rationales, management_openness: 'no' } }), /rationale of at least/);
  });
});
