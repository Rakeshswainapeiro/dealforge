// ---------------------------------------------------------------------------
// Unit tests for the content sufficiency check (W5-03 / BRD DOC-04).
//
//   node --test server/tests/sufficiency.test.js
//
// Pure module: the shipped rule set, validation, resolve fallback, revision
// minting, diff, the per-rule evaluation and the reviewer override.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUFFICIENCY_CONFIG_KEY, SUFFICIENCY_VERSION, SUFFICIENCY_DEFAULT_REVISION,
  SUFFICIENCY_VERSION_PREFIX, SUFFICIENCY_REASON_MIN, SUFFICIENCY_MIN_HISTORY_YEARS,
  SUFFICIENCY_RULES, SUFFICIENCY_RULE_KEYS, SUFFICIENCY_BRD_EXAMPLES,
  SUFFICIENCY_OVERRIDE_TAG, SUFFICIENCY_MESSAGES,
  defaultSufficiencyConfig, validateSufficiencyConfig, resolveSufficiencyConfig,
  diffSufficiencyConfig, buildSufficiencyConfig, evaluateSufficiency,
  buildSufficiencyOverride, sufficiencyOverridesFromData,
} from '../config/sufficiency.js';

// A gate result where everything is present.
const completeGate = () => ({
  financials: {
    matrix: {
      free_cash_flow: { fy3a: 10, fy2a: 12, fy1a: 14 },
      revenue: { fy3a: 100, fy2a: 110, fy1a: 120 },
    },
  },
  statement_model: { attached: true, statements: { cash_flow_statement: true } },
  return_metrics: { downside_present: true },
});

const fullDocs = ['risk_register', 'market_data', 'financials'];

describe('sufficiency - shipped configuration', () => {
  test('carries a version, a revision and the BRD example rules', () => {
    const c = defaultSufficiencyConfig();
    assert.equal(c.version, SUFFICIENCY_VERSION);
    assert.equal(c.revision, SUFFICIENCY_DEFAULT_REVISION);
    assert.equal(c.min_history_years, SUFFICIENCY_MIN_HISTORY_YEARS);
    assert.equal(SUFFICIENCY_CONFIG_KEY, 'sufficiency_config');
    assert.equal(SUFFICIENCY_VERSION_PREFIX, 'SUF-01.');
    for (const key of SUFFICIENCY_BRD_EXAMPLES) {
      assert.ok(SUFFICIENCY_RULE_KEYS.includes(key), key + ' should be a shipped rule');
      assert.ok(c.rules.some((r) => r.key === key && r.enabled), key + ' should be enabled');
    }
  });

  test('every rule is advisory', () => {
    for (const rule of SUFFICIENCY_RULES) {
      assert.equal(rule.severity, 'advisory');
    }
    assert.equal(SUFFICIENCY_RULES.length, SUFFICIENCY_RULE_KEYS.length);
  });

  test('is deterministic so two calls compare equal', () => {
    assert.deepEqual(defaultSufficiencyConfig(), defaultSufficiencyConfig());
  });
});

describe('sufficiency - validation', () => {
  test('accepts the shipped default', () => {
    assert.equal(validateSufficiencyConfig(defaultSufficiencyConfig()).ok, true);
  });

  test('rejects a non-object payload', () => {
    const res = validateSufficiencyConfig(null);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.field === 'config'));
  });

  test('rejects an out-of-range history threshold', () => {
    const c = { ...defaultSufficiencyConfig(), min_history_years: 0 };
    const res = validateSufficiencyConfig(c);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.field === 'min_history_years'));
  });

  test('rejects an unknown rule', () => {
    const c = { ...defaultSufficiencyConfig(), rules: [{ key: 'made_up' }] };
    const res = validateSufficiencyConfig(c);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.key === 'made_up'));
  });
});

describe('sufficiency - resolve and mint', () => {
  test('falls back to the default for a missing config', () => {
    assert.equal(resolveSufficiencyConfig(null).version, SUFFICIENCY_VERSION);
  });

  test('fills a missing rule from the default', () => {
    const stored = { min_history_years: 4, rules: [{ key: 'downside_case', enabled: false }] };
    const resolved = resolveSufficiencyConfig(stored);
    assert.equal(resolved.min_history_years, 4);
    assert.equal(resolved.rules.length, SUFFICIENCY_RULES.length);
    assert.equal(resolved.rules.find((r) => r.key === 'downside_case').enabled, false);
    assert.equal(resolved.rules.find((r) => r.key === 'cash_flow').enabled, true);
  });

  test('mints the next revision and version', () => {
    const base = defaultSufficiencyConfig();
    const next = buildSufficiencyConfig({ min_history_years: 5 }, { base, actor: { email: 'admin@dealforge.local' } });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.version, SUFFICIENCY_VERSION_PREFIX + next.revision);
    assert.equal(next.min_history_years, 5);
    assert.equal(next.updated_by, 'admin@dealforge.local');
  });

  test('toggles a rule through the enabled map', () => {
    const base = defaultSufficiencyConfig();
    const next = buildSufficiencyConfig({ enabled: { cash_flow: false } }, { base, actor: { email: 'a@b.c' } });
    assert.equal(next.rules.find((r) => r.key === 'cash_flow').enabled, false);
    assert.equal(next.rules.find((r) => r.key === 'downside_case').enabled, true);
  });

  test('refuses to mint an invalid configuration', () => {
    assert.throws(
      () => buildSufficiencyConfig({ min_history_years: 99 }, { base: defaultSufficiencyConfig() }),
      /invalid/i
    );
  });

  test('diffs the threshold and the enabled set', () => {
    const a = defaultSufficiencyConfig();
    const b = buildSufficiencyConfig({ min_history_years: 5, enabled: { market_data: false } }, { base: a, actor: { email: 'a@b.c' } });
    const changes = diffSufficiencyConfig(a, b);
    assert.ok(changes.some((c) => c.field === 'min_history_years' && c.after === 5));
    assert.ok(changes.some((c) => c.field === 'enabled' && c.key === 'market_data' && c.after === false));
  });
});

describe('sufficiency - evaluation', () => {
  test('passes when every rule is satisfied', () => {
    const e = evaluateSufficiency({ gate: completeGate(), documents: fullDocs });
    assert.equal(e.sufficient, true);
    assert.equal(e.open_count, 0);
    assert.equal(e.flags.length, 0);
    assert.equal(e.advisory, true);
  });

  test('flags a missing cash flow', () => {
    const gate = completeGate();
    gate.statement_model = { attached: true, statements: { cash_flow_statement: false } };
    const e = evaluateSufficiency({ gate, documents: fullDocs });
    const flag = e.flags.find((f) => f.key === 'cash_flow');
    assert.ok(flag);
    assert.match(flag.observed, /cash flow statement missing/);
    assert.equal(flag.severity, 'advisory');
  });

  test('flags fewer years of history than the policy expects', () => {
    const gate = {
      ...completeGate(),
      financials: { matrix: { free_cash_flow: { fy3a: 10, fy2a: null, fy1a: null } } },
    };
    const e = evaluateSufficiency({ gate, documents: fullDocs });
    const flag = e.flags.find((f) => f.key === 'history_years');
    assert.ok(flag);
    assert.match(flag.observed, /1 year/);
    assert.match(flag.expected, /3 years/);
  });

  test('honours a raised history threshold from configuration', () => {
    const gate = {
      ...completeGate(),
      financials: { matrix: { free_cash_flow: { fy3a: 1, fy2a: 1, fy1a: 1 } } },
    };
    const config = buildSufficiencyConfig({ min_history_years: 5 }, { base: defaultSufficiencyConfig(), actor: { email: 'a@b.c' } });
    const e = evaluateSufficiency({ gate, documents: fullDocs, config });
    assert.ok(e.flags.some((f) => f.key === 'history_years'));
    assert.equal(e.min_history_years, 5);
  });

  test('flags a missing downside case', () => {
    const gate = { ...completeGate(), return_metrics: { downside_present: false } };
    const e = evaluateSufficiency({ gate, documents: fullDocs });
    assert.ok(e.flags.some((f) => f.key === 'downside_case'));
  });

  test('flags an absent supporting pack', () => {
    const gate = { ...completeGate(), statement_model: { attached: false, statements: {} } };
    const e = evaluateSufficiency({ gate, documents: [] });
    const keys = e.flags.map((f) => f.key);
    assert.ok(keys.includes('model_attached'));
    assert.ok(keys.includes('risk_register'));
    assert.ok(keys.includes('market_data'));
  });

  test('never reports a blocking flag', () => {
    const e = evaluateSufficiency({ gate: { financials: {}, statement_model: {}, return_metrics: {} }, documents: [] });
    assert.equal(e.sufficient, false);
    assert.equal(e.advisory, true);
    assert.ok(e.open_flags.every((f) => f.severity === 'advisory'));
    assert.equal(e.open_count > 0, true);
  });

  test('skips a disabled rule', () => {
    const config = buildSufficiencyConfig({ enabled: { market_data: false } }, { base: defaultSufficiencyConfig(), actor: { email: 'a@b.c' } });
    const e = evaluateSufficiency({ gate: completeGate(), documents: [], config });
    assert.ok(!e.flags.some((f) => f.key === 'market_data'));
    assert.equal(e.rules.find((r) => r.key === 'market_data').enabled, false);
  });

  test('a reviewer override clears the flag from the open set', () => {
    const overrides = { downside_case: { reason: 'Downside modelled in the appendix', by: 'rev@x', at: 'now' } };
    const gate = { ...completeGate(), return_metrics: { downside_present: false } };
    const e = evaluateSufficiency({ gate, documents: fullDocs, overrides });
    const flag = e.flags.find((f) => f.key === 'downside_case');
    assert.equal(flag.overridden, true);
    assert.ok(!e.open_flags.some((f) => f.key === 'downside_case'));
    assert.equal(e.resolved_count, 1);
  });

  test('reports per-category counts', () => {
    const e = evaluateSufficiency({ gate: completeGate(), documents: [] });
    const documents = e.categories.find((c) => c.key === 'documents');
    assert.ok(documents.flagged > 0);
    assert.ok(e.categories.some((c) => c.key === 'financials'));
  });
});

describe('sufficiency - reviewer override', () => {
  test('requires a written reason', () => {
    assert.throws(() => buildSufficiencyOverride({ reason: 'short' }, { actor: { email: 'r@x' } }), /reason/i);
  });

  test('builds an override with a named reviewer', () => {
    const o = buildSufficiencyOverride({ reason: 'History is short because the company is new' }, { actor: { email: 'rev@dealforge.local' } });
    assert.ok(o.reason.length >= SUFFICIENCY_REASON_MIN);
    assert.equal(o.by, 'rev@dealforge.local');
    assert.ok(o.at);
  });

  test('reads the override block from opportunity data', () => {
    const clean = sufficiencyOverridesFromData({});
    assert.deepEqual(clean, {});
    const data = { [SUFFICIENCY_OVERRIDE_TAG]: { cash_flow: { reason: 'x', by: 'y' } } };
    assert.equal(sufficiencyOverridesFromData(data).cash_flow.by, 'y');
  });

  test('keeps the advisory disclaimer in the message', () => {
    assert.ok(SUFFICIENCY_MESSAGES.disclaimer.includes('never blocks'));
  });
});
