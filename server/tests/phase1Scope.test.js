// Phase 1 screen scope (DealForge_Phase1_BRD_v2).
//
// Pure checks - no server or database required:
//   node --test server/tests/phase1Scope.test.js
//
// Guards three things:
//   1. the server and browser feature defaults never drift apart (the browser
//      copy is what applies when the API is unreachable);
//   2. later-phase pages ship switched off but can be switched back on without
//      a code change;
//   3. every routable page has a feature flag, and pages removed as out of
//      scope stay removed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FEATURE_GROUPS, FEATURE_GROUPS_META, resolveFeatureFlags } from '../config/featureFlags.js';
import { CLIENT_FEATURE_DEFAULTS, normalizeFeatures, isPageEnabled } from '../../src/lib/features.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE_FILES = fs.readdirSync(path.join(ROOT, 'src', 'pages'))
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => f.replace(/\.jsx$/, ''));

// Pages that are always reachable outside the feature map (public routes).
const PUBLIC_PAGES = ['Login', 'VerifyMemo'];
// Feature keys that toggle a capability rather than a page of their own.
const NON_PAGE_FEATURES = ['MemoPack', 'MemoVerification'];
const LATER_PHASE = ['DueDiligence', 'Portfolios'];
// Screens from the generic M&A application that have no Phase 1 requirement.
const REMOVED = ['Home', 'Analytics', 'Companies', 'DealPipeline', 'DealRecommendations',
  'MarketAnalysis', 'MergerSimulator', 'Scenarios', 'CRM', 'UserManagement'];

describe('feature defaults', () => {
  test('server and browser defaults are identical', () => {
    assert.deepEqual(CLIENT_FEATURE_DEFAULTS, FEATURE_GROUPS);
  });

  test('later-phase pages are off by default on both sides', () => {
    for (const key of LATER_PHASE) {
      assert.equal(FEATURE_GROUPS[key], false, key + ' (server)');
      assert.equal(isPageEnabled(normalizeFeatures(null), key), false, key + ' (browser, API unreachable)');
    }
  });

  test('every other feature is on by default', () => {
    for (const [key, enabled] of Object.entries(FEATURE_GROUPS)) {
      if (!LATER_PHASE.includes(key)) assert.equal(enabled, true, key);
    }
  });

  test('a later-phase page can be switched on by an admin override or by FEATURE_FLAGS', () => {
    assert.equal(resolveFeatureFlags({ runtime: { Portfolios: true }, env: '' }).Portfolios, true);
    assert.equal(resolveFeatureFlags({ runtime: {}, env: '+DueDiligence' }).DueDiligence, true);
    assert.equal(resolveFeatureFlags({ runtime: {}, env: '' }).DueDiligence, false);
  });
});

describe('page inventory', () => {
  test('every routable page has a feature flag', () => {
    for (const page of PAGE_FILES) {
      if (PUBLIC_PAGES.includes(page)) continue;
      assert.ok(page in FEATURE_GROUPS, page + ' has no entry in FEATURE_GROUPS');
    }
  });

  test('every page flag points at a page that exists', () => {
    for (const key of Object.keys(FEATURE_GROUPS)) {
      if (NON_PAGE_FEATURES.includes(key)) continue;
      assert.ok(PAGE_FILES.includes(key), key + ' is flagged but src/pages/' + key + '.jsx does not exist');
    }
  });

  test('out-of-scope screens stay removed', () => {
    for (const page of REMOVED) {
      assert.equal(PAGE_FILES.includes(page), false, page + '.jsx should not exist');
      assert.equal(page in FEATURE_GROUPS, false, page + ' should not be a feature');
    }
  });

  test('admin feature groups only reference known features, each exactly once', () => {
    const seen = FEATURE_GROUPS_META.flatMap((g) => g.pages);
    assert.equal(new Set(seen).size, seen.length, 'a page appears in two groups');
    for (const key of seen) assert.ok(key in FEATURE_GROUPS, key + ' in a group but not a feature');
    const later = FEATURE_GROUPS_META.find((g) => g.key === 'later_phase');
    assert.deepEqual([...later.pages].sort(), [...LATER_PHASE].sort());
  });
});
