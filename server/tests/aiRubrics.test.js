// ---------------------------------------------------------------------------
// Rubric scaffolding (Phase 1): switches, per-tab versions and the conditional
// rubric version in the stale-result hash.
//
//   node --test server/tests/aiRubrics.test.js
//
// The GOLDEN fingerprints were captured from the review module BEFORE the
// rubric scaffolding existed (fixture: helpers/aiRubricFixture.js). They prove
// that nothing changed for any tab while the rubrics are off, and that the
// Executive summary, Risks and compliance and Documents tabs can never change.
// No database and no network.
// ---------------------------------------------------------------------------
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../config/aiReview.js';
import {
  RUBRIC_TABS, RUBRIC_DEFAULT_ENABLED, RUBRIC_VERSIONS, RUBRIC_ENV_VAR, RUBRIC_SOURCES, RUBRIC_TOLERANCES,
  isRubricTab, isRubricEnabled, rubricVersion, rubricHashFragment,
  _setRubricStateForTesting, _resetRubricStateForTesting,
} from '../config/aiRubrics.js';
import { snapshotTab, FIXTURE_DATA, FIXTURE_DOCS } from './helpers/aiRubricFixture.js';
import GOLDEN from './helpers/aiRubricGolden.js';


const UNTOUCHED = ['executive_summary', 'risks', 'documents'];
const hashOf = (tab, data = FIXTURE_DATA) => review.hashTabInputs(tab, data, FIXTURE_DOCS);

let savedEnv;
beforeEach(() => { savedEnv = process.env[RUBRIC_ENV_VAR]; delete process.env[RUBRIC_ENV_VAR]; _resetRubricStateForTesting(); });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[RUBRIC_ENV_VAR]; else process.env[RUBRIC_ENV_VAR] = savedEnv;
  _resetRubricStateForTesting();
});

describe('rubric scaffolding - configuration', () => {
  test('exactly Opportunity overview, Rationale, Financials and Funding can carry a rubric', () => {
    assert.deepEqual([...RUBRIC_TABS], ['opportunity_overview', 'rationale', 'financials', 'funding']);
    for (const t of UNTOUCHED) assert.equal(isRubricTab(t), false, t);
    for (const t of RUBRIC_TABS) assert.ok(review.AI_TAB_KEYS.includes(t), t + ' is a real tab');
  });

  test('every rubric tab has an independent positive version and a recorded source, and ships on', () => {
    const LIVE = [...RUBRIC_TABS];
    for (const t of RUBRIC_TABS) {
      assert.ok(Number.isInteger(RUBRIC_VERSIONS[t]) && RUBRIC_VERSIONS[t] > 0, t);
      assert.equal(RUBRIC_DEFAULT_ENABLED[t], LIVE.includes(t), t);
      assert.ok(RUBRIC_SOURCES[t], t);
      assert.equal(RUBRIC_SOURCES[t].status, LIVE.includes(t) ? 'active' : 'scaffold', t);
    }
    for (const t of LIVE) assert.equal(RUBRIC_VERSIONS[t], 2, t);
  });

  test('Tab 4 is original work: no third-party repository is recorded for it', () => {
    assert.equal(RUBRIC_SOURCES.financials.origin, 'original');
    assert.equal(RUBRIC_SOURCES.financials.repo, null);
    assert.equal(RUBRIC_SOURCES.financials.path, null);
  });

  test('Tab 5 is original work; the skill that was reviewed is recorded with a courtesy credit, not as a source', () => {
    assert.equal(RUBRIC_SOURCES.funding.origin, 'original');
    assert.equal(RUBRIC_SOURCES.funding.repo, null);
    assert.equal(RUBRIC_SOURCES.funding.path, null);
    assert.equal(RUBRIC_SOURCES.funding.reviewed.repo, 'theneoai/awesome-skills');
    assert.match(RUBRIC_SOURCES.funding.reviewed.courtesy_credit, /Awesome Skills by neo\.ai/);
    assert.match(RUBRIC_SOURCES.funding.reviewed.courtesy_credit, /no text used/);
  });

  test('tolerances are present, advisory starting values', () => {
    assert.equal(RUBRIC_TOLERANCES.fx.peg_aed_per_usd, 3.6725);
    assert.ok(RUBRIC_TOLERANCES.fx.peg_tolerance_pct > 0);
    assert.ok(RUBRIC_TOLERANCES.returns.implied_hold_years_min < RUBRIC_TOLERANCES.returns.implied_hold_years_max);
    assert.ok(Object.isFrozen(RUBRIC_TOLERANCES) && Object.isFrozen(RUBRIC_TOLERANCES.fx));
  });

  test('the defaults: the four rubric tabs on, Executive summary, Risks and Documents off', () => {
    for (const t of review.AI_TAB_KEYS) assert.equal(isRubricEnabled(t), RUBRIC_TABS.includes(t), t);
  });
});

describe('rubric scaffolding - per-tab switches', () => {
  test('AI_RUBRIC_TABS: a list, "all", "none", blanks and junk', () => {
    const on = (v) => RUBRIC_TABS.filter((t) => isRubricEnabled(t, { [RUBRIC_ENV_VAR]: v }));
    assert.deepEqual(on('financials,funding'), ['financials', 'funding']);
    assert.deepEqual(on(' Financials , FUNDING '), ['financials', 'funding']);
    assert.deepEqual(on('all'), [...RUBRIC_TABS]);
    assert.deepEqual(on('none'), []);
    assert.deepEqual(on('all,none'), []);
    assert.deepEqual(on('nonsense,,'), []);
    // A blank value means "unset": the defaults apply.
    assert.deepEqual(on(''), [...RUBRIC_TABS]);
  });

  test('the environment is read at call time', () => {
    assert.equal(isRubricEnabled('opportunity_overview'), true);
    process.env[RUBRIC_ENV_VAR] = 'rationale';
    assert.equal(isRubricEnabled('opportunity_overview'), false);
    assert.equal(isRubricEnabled('rationale'), true);
    assert.equal(isRubricEnabled('financials'), false);
    process.env[RUBRIC_ENV_VAR] = 'none';
    assert.equal(isRubricEnabled('financials'), false);
  });

  test('a test override beats the environment', () => {
    process.env[RUBRIC_ENV_VAR] = 'all';
    _setRubricStateForTesting({ enabled: { financials: false } });
    assert.equal(isRubricEnabled('financials'), false);
    assert.equal(isRubricEnabled('funding'), true);
  });

  test('Executive summary, Risks and Documents can never be switched on', () => {
    process.env[RUBRIC_ENV_VAR] = 'all';
    _setRubricStateForTesting({ enabled: { executive_summary: true, risks: true, documents: true } });
    for (const t of UNTOUCHED) {
      assert.equal(isRubricEnabled(t), false, t);
      assert.equal(rubricVersion(t), 0, t);
      assert.deepEqual(rubricHashFragment(t), {}, t);
    }
    process.env[RUBRIC_ENV_VAR] = 'executive_summary,risks,documents';
    for (const t of UNTOUCHED) assert.equal(isRubricEnabled(t), false, t);
  });
});

describe('rubric scaffolding - the hash fragment', () => {
  test('disabled tabs add nothing; an enabled tab adds only its version', () => {
    assert.deepEqual(rubricHashFragment('risks'), {});
    for (const t of RUBRIC_TABS) assert.deepEqual(rubricHashFragment(t), { rubric: 2 }, t);
    _setRubricStateForTesting({ enabled: { financials: true }, versions: { financials: 3 } });
    assert.deepEqual(rubricHashFragment('financials'), { rubric: 3 });
    assert.deepEqual(rubricHashFragment('rationale'), { rubric: 2 });
    _setRubricStateForTesting({ enabled: { rationale: false } });
    assert.deepEqual(rubricHashFragment('rationale'), {});
    _setRubricStateForTesting({ enabled: { financials: false } });
    assert.deepEqual(rubricHashFragment('financials'), {});
  });

  test('a version that is not a positive integer adds nothing', () => {
    for (const bad of [0, -1, 1.5, null, undefined, '2']) {
      _setRubricStateForTesting({ enabled: { rationale: true }, versions: { rationale: bad } });
      assert.deepEqual(rubricHashFragment('rationale'), {}, String(bad));
    }
  });
});

describe('rubric scaffolding - hashes, prompts and checks are byte-identical while off', () => {
  test('with every rubric off, every tab matches the pre-scaffolding fingerprints', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    for (const tab of review.AI_TAB_KEYS) {
      assert.deepEqual(snapshotTab(review, tab), GOLDEN[tab], tab);
    }
  });

  test('with the shipped defaults, only the four rubric tabs differ from the pre-scaffolding fingerprints', () => {
    const live = [...RUBRIC_TABS];
    for (const tab of review.AI_TAB_KEYS.filter((t) => !live.includes(t))) {
      assert.deepEqual(snapshotTab(review, tab), GOLDEN[tab], tab);
    }
    for (const tab of live) assert.notDeepEqual(snapshotTab(review, tab), GOLDEN[tab], tab);
  });

  test('Executive summary, Risks and Documents are identical even with every switch forced on', () => {
    process.env[RUBRIC_ENV_VAR] = 'all';
    _setRubricStateForTesting({
      enabled: { executive_summary: true, risks: true, documents: true, opportunity_overview: true, rationale: true, financials: true, funding: true },
      versions: { executive_summary: 9, risks: 9, documents: 9, opportunity_overview: 9, rationale: 9, financials: 9, funding: 9 },
    });
    for (const tab of UNTOUCHED) assert.deepEqual(snapshotTab(review, tab), GOLDEN[tab], tab);
  });

  test('switching one rubric on changes only that tab: every other tab stays at its pre-scaffolding fingerprint', () => {
    process.env[RUBRIC_ENV_VAR] = 'rationale';
    assert.notDeepEqual(snapshotTab(review, 'rationale'), GOLDEN.rationale);
    for (const tab of review.AI_TAB_KEYS.filter((t) => t !== 'rationale')) {
      // the env list replaces the defaults, so the other rubric tabs are off here
      assert.deepEqual(snapshotTab(review, tab), GOLDEN[tab], tab);
    }
  });

  test('switching a rubric off again restores the original hash exactly', () => {
    process.env[RUBRIC_ENV_VAR] = 'none';
    for (const t of RUBRIC_TABS) assert.equal(hashOf(t), GOLDEN[t].hash, t);
    delete process.env[RUBRIC_ENV_VAR];
    for (const t of RUBRIC_TABS) assert.notEqual(hashOf(t), GOLDEN[t].hash, t);
  });
});

describe('rubric scaffolding - only the relevant tab becomes stale', () => {
  test('raising one tab\'s version stales that tab and no other', () => {
    _setRubricStateForTesting({ enabled: Object.fromEntries(RUBRIC_TABS.map((t) => [t, true])), versions: Object.fromEntries(RUBRIC_TABS.map((t) => [t, 1])) });
    // Results stored under version 1 for all seven tabs.
    const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: hashOf(t) }]));
    for (const t of review.AI_TAB_KEYS) assert.equal(review.isStale(stored[t], hashOf(t)), false, t + ' fresh');

    // The guidance for Rationale changes.
    _setRubricStateForTesting({ enabled: Object.fromEntries(RUBRIC_TABS.map((t) => [t, true])), versions: { opportunity_overview: 1, rationale: 2, financials: 1, funding: 1 } });
    const stale = review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], hashOf(t)));
    assert.deepEqual(stale, ['rationale']);
  });

  test('each of the four tabs can be staled on its own', () => {
    for (const target of RUBRIC_TABS) {
      const enabled = Object.fromEntries(RUBRIC_TABS.map((t) => [t, true]));
      _setRubricStateForTesting({ enabled, versions: Object.fromEntries(RUBRIC_TABS.map((t) => [t, 1])) });
      const stored = Object.fromEntries(review.AI_TAB_KEYS.map((t) => [t, { input_hash: hashOf(t) }]));
      _setRubricStateForTesting({ enabled, versions: Object.fromEntries(RUBRIC_TABS.map((t) => [t, t === target ? 2 : 1])) });
      assert.deepEqual(review.AI_TAB_KEYS.filter((t) => review.isStale(stored[t], hashOf(t))), [target], target);
    }
  });

  test('a version bump on a disabled tab stales nothing', () => {
    _setRubricStateForTesting({ enabled: { financials: false } });
    const stored = { input_hash: hashOf('financials') };
    _setRubricStateForTesting({ enabled: { financials: false }, versions: { financials: 7 } });
    assert.equal(review.isStale(stored, hashOf('financials')), false);
  });

  test('editing a field still stales its own tab and not another, with rubrics on', () => {
    _setRubricStateForTesting({ enabled: Object.fromEntries(RUBRIC_TABS.map((t) => [t, true])) });
    const before = hashOf('funding');
    assert.notEqual(hashOf('funding', { ...FIXTURE_DATA, ask_aed: 61 }), before);
    assert.equal(hashOf('rationale', { ...FIXTURE_DATA, ask_aed: 61 }), hashOf('rationale'));
  });

  test('the hash stays stable and key-order independent with a rubric on', () => {
    _setRubricStateForTesting({ enabled: { financials: true } });
    const reordered = Object.fromEntries(Object.entries(FIXTURE_DATA).reverse());
    assert.equal(hashOf('financials', reordered), hashOf('financials'));
  });
});
