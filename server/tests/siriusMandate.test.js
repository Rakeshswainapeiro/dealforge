// ---------------------------------------------------------------------------
// Unit tests for the Sirius group mandate (W4-04 / BRD ENT-03).
//
//   node --test server/tests/siriusMandate.test.js
//
// Pure module: the shipped mandate shape, the validation rules, revision
// minting, the resolve fallback, the diff naming and the advisory mandate-fit
// helper. No server.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIRIUS_MANDATE_VERSION, SIRIUS_MANDATE_CONFIG_KEY, SIRIUS_MANDATE_DEFAULT_REVISION,
  SIRIUS_MANDATE_VERSION_PREFIX,
  defaultSiriusMandate, validateSiriusMandate, resolveSiriusMandate, diffSiriusMandate,
  buildSiriusMandate, mandateFit, SIRIUS_MANDATE_MESSAGES,
} from '../config/siriusMandate.js';
import {
  SIRIUS_MANDATE_INSTRUMENT_KEYS, SIRIUS_MANDATE_STAGE_KEYS,
} from '../config/siriusMandateData.js';

describe('sirius mandate - shipped mandate', () => {
  test('carries a version, a revision and the brief vocabulary', () => {
    const m = defaultSiriusMandate();
    assert.equal(m.version, SIRIUS_MANDATE_VERSION);
    assert.equal(m.revision, SIRIUS_MANDATE_DEFAULT_REVISION);
    assert.ok(SIRIUS_MANDATE_CONFIG_KEY);
    assert.ok(SIRIUS_MANDATE_VERSION_PREFIX);
  });

  test('ships sectors, core geography, stage / instrument policy and the objective', () => {
    const m = defaultSiriusMandate();
    assert.ok(m.sectors.length >= 5);
    assert.ok(m.geography.core.includes('UAE'));
    assert.deepEqual(m.stages, SIRIUS_MANDATE_STAGE_KEYS);
    assert.deepEqual(m.instruments, SIRIUS_MANDATE_INSTRUMENT_KEYS);
    assert.equal(m.objective.people_by_2030, 1000000000);
    assert.equal(m.objective.target_year, 2030);
  });

  test('the seven operating clusters line up with the portfolio taxonomy', () => {
    const m = defaultSiriusMandate();
    assert.equal(m.clusters.length, 7);
    for (const c of m.clusters) assert.ok(c.key && c.label);
  });
});

describe('sirius mandate - validation', () => {
  const base = defaultSiriusMandate();

  test('refuses a non-object payload', () => {
    const res = validateSiriusMandate(null);
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(SIRIUS_MANDATE_MESSAGES.not_object));
  });

  test('requires at least one sector and one core geography', () => {
    const res = validateSiriusMandate({ sectors: [], geography: { core: [] } }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(SIRIUS_MANDATE_MESSAGES.sectors_required));
    assert.ok(res.errors.includes(SIRIUS_MANDATE_MESSAGES.geography_required));
  });

  test('rejects unknown stages and instruments', () => {
    const res = validateSiriusMandate({ sectors: ['Technology'], geography: { core: ['UAE'] }, stages: ['moon_shot'], instruments: ['free_money'] }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.startsWith(SIRIUS_MANDATE_MESSAGES.stage_invalid)));
    assert.ok(res.errors.some((e) => e.startsWith(SIRIUS_MANDATE_MESSAGES.instrument_invalid)));
  });

  test('rejects a non-positive ticket floor and an inverted band', () => {
    const bad = validateSiriusMandate({ sectors: ['Technology'], geography: { core: ['UAE'] }, ticket: { min_aed: 0 } }, { base });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.includes(SIRIUS_MANDATE_MESSAGES.ticket_min_positive));
    const inverted = validateSiriusMandate({ sectors: ['Technology'], geography: { core: ['UAE'] }, ticket: { min_aed: 50, max_aed: 10 } }, { base });
    assert.equal(inverted.ok, false);
    assert.ok(inverted.errors.includes(SIRIUS_MANDATE_MESSAGES.ticket_max_above_min));
  });

  test('rejects a non-positive objective count and an out-of-range year', () => {
    const res = validateSiriusMandate({ sectors: ['Technology'], geography: { core: ['UAE'] }, objective: { people_by_2030: 0, target_year: 99 } }, { base });
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(SIRIUS_MANDATE_MESSAGES.objective_positive));
    assert.ok(res.errors.includes(SIRIUS_MANDATE_MESSAGES.target_year_range));
  });

  test('accepts a valid payload and keeps the base revision', () => {
    const res = validateSiriusMandate({ sectors: ['Technology', 'Healthcare'], geography: { core: ['UAE', 'KSA'] } }, { base });
    assert.equal(res.ok, true);
    assert.deepEqual(res.config.sectors, ['Technology', 'Healthcare']);
    assert.equal(res.config.revision, base.revision);
  });
});

describe('sirius mandate - resolve fallback', () => {
  test('falls back to the shipped mandate for blank or unparseable input', () => {
    assert.equal(resolveSiriusMandate(null).version, SIRIUS_MANDATE_VERSION);
    assert.equal(resolveSiriusMandate('{not json').version, SIRIUS_MANDATE_VERSION);
    assert.equal(resolveSiriusMandate('').revision, SIRIUS_MANDATE_DEFAULT_REVISION);
  });

  test('round-trips a stored mandate', () => {
    const stored = JSON.stringify({ ...defaultSiriusMandate(), sectors: ['Energy'], revision: 4 });
    const resolved = resolveSiriusMandate(stored);
    assert.deepEqual(resolved.sectors, ['Energy']);
    assert.equal(resolved.revision, 4);
  });
});

describe('sirius mandate - revision minting', () => {
  test('mints revision + 1 and the matching version string', () => {
    const base = defaultSiriusMandate();
    const next = buildSiriusMandate({ sectors: ['Energy'], geography: { core: ['UAE'] } }, { actor: { email: 'admin@x' }, at: '2026-01-01T00:00:00Z', base });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.version, SIRIUS_MANDATE_VERSION_PREFIX + next.revision);
    assert.equal(next.updated_by, 'admin@x');
  });

  test('throws a 400-shaped error on an invalid payload', () => {
    assert.throws(() => buildSiriusMandate({ sectors: [] }, { base: defaultSiriusMandate() }), (err) => err.status === 400 && Array.isArray(err.errors));
  });
});

describe('sirius mandate - diff', () => {
  test('names added and removed sectors', () => {
    const base = defaultSiriusMandate();
    const next = { ...base, sectors: [...base.sectors.filter((s) => s !== 'Energy'), 'Space'] };
    const changes = diffSiriusMandate(base, next);
    assert.ok(changes.some((c) => c.field === 'sectors' && c.op === 'added' && c.value === 'Space'));
    assert.ok(changes.some((c) => c.field === 'sectors' && c.op === 'removed' && c.value === 'Energy'));
  });

  test('names a geography-core change', () => {
    const base = defaultSiriusMandate();
    const changes = diffSiriusMandate(base, { ...base, geography: { ...base.geography, core: [...base.geography.core, 'KSA'] } });
    assert.ok(changes.some((c) => c.field === 'geography.core'));
  });
});

describe('sirius mandate - advisory fit', () => {
  const m = defaultSiriusMandate();

  test('marks an in-scope sector and core geography', () => {
    const fit = mandateFit({ sector: 'Technology', geography: 'UAE' }, m);
    assert.equal(fit.sector_in_mandate, true);
    assert.equal(fit.geography_in_core, true);
    assert.equal(fit.in_scope, true);
    assert.equal(fit.mandate_version, m.version);
  });

  test('marks an out-of-scope sector', () => {
    const fit = mandateFit({ sector: 'Space Tourism', geography: 'UAE' }, m);
    assert.equal(fit.sector_in_mandate, false);
    assert.equal(fit.in_scope, false);
  });

  test('measures the ticket band and leaves it null when unknown', () => {
    assert.equal(mandateFit({ sector: 'Energy', geography: 'UAE', totalCommitmentAed: 50 }, m).size_in_ticket, true);
    assert.equal(mandateFit({ sector: 'Energy', geography: 'UAE', totalCommitmentAed: 5 }, m).size_in_ticket, false);
    assert.equal(mandateFit({ sector: 'Energy', geography: 'UAE' }, m).size_in_ticket, null);
  });
});
