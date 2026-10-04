// ---------------------------------------------------------------------------
// Reporting currency and per-opportunity FX rate unit tests (W2-10 / NFR-08).
//
// The accept criterion: "Currency and unit shown on every financial field; FX
// rate recorded." The page-4 matrix is captured in millions, so the unit is
// always 'mn'. AED is the Sirius base; when a deal is reported in USD the
// preparer records the AED-per-USD rate used. Advisory only — a USD deal
// without a rate is flagged, never blocked. Pure — no server needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCurrency, normaliseCurrency, toBaseCurrency,
  BASE_CURRENCY, BASE_UNIT, REPORTING_CURRENCIES, REPORTING_CURRENCY_VALUES,
  CURRENCY_FIELDS, FX_RATE_MISSING_MESSAGE, FX_RATE_INVALID_MESSAGE,
} from '../config/currency.js';

describe('reporting currency and FX (NFR-08)', () => {
  test('the capture keys and base defaults are exposed', () => {
    assert.equal(BASE_CURRENCY, 'AED');
    assert.equal(BASE_UNIT, 'mn');
    assert.equal(CURRENCY_FIELDS.currency, 'reporting_currency');
    assert.equal(CURRENCY_FIELDS.fx_rate, 'fx_rate_usd_aed');
    assert.deepEqual(REPORTING_CURRENCY_VALUES, ['AED', 'USD']);
    assert.deepEqual(REPORTING_CURRENCIES.map((c) => c.value), ['AED', 'USD']);
  });

  test('a default (unset) deal reports in AED mn with no flags', () => {
    const r = evaluateCurrency({});
    assert.equal(r.currency, 'AED');
    assert.equal(r.unit, 'mn');
    assert.equal(r.label, 'AED mn');
    assert.equal(r.is_base, true);
    assert.equal(r.fx_required, false);
    assert.equal(r.complete, true);
    assert.deepEqual(r.flags, []);
    assert.equal(r.message, null);
  });

  test('an explicit AED deal reports in AED mn with no flags', () => {
    const r = evaluateCurrency({ reporting_currency: 'AED' });
    assert.equal(r.currency, 'AED');
    assert.equal(r.complete, true);
    assert.deepEqual(r.flags, []);
  });

  test('a USD deal with no rate is flagged but not blocked', () => {
    const r = evaluateCurrency({ reporting_currency: 'USD' });
    assert.equal(r.currency, 'USD');
    assert.equal(r.label, 'USD mn');
    assert.equal(r.fx_required, true);
    assert.equal(r.fx_present, false);
    assert.equal(r.complete, false);
    assert.equal(r.flags.length, 1);
    assert.equal(r.flags[0].reason, 'fx_rate_missing');
    assert.equal(r.flags[0].message, FX_RATE_MISSING_MESSAGE);
    assert.equal(r.message, FX_RATE_MISSING_MESSAGE);
  });

  test('a USD deal with a recorded rate is complete', () => {
    const r = evaluateCurrency({ reporting_currency: 'USD', fx_rate_usd_aed: 3.6725 });
    assert.equal(r.currency, 'USD');
    assert.equal(r.fx_rate, 3.6725);
    assert.equal(r.fx_required, true);
    assert.equal(r.fx_valid, true);
    assert.equal(r.complete, true);
    assert.deepEqual(r.flags, []);
    assert.equal(r.rate_label, 'USD mn (@ 3.6725 AED/USD)');
  });

  test('a USD deal with a non-positive rate is invalid', () => {
    for (const bad of [0, -1, 'abc']) {
      const r = evaluateCurrency({ reporting_currency: 'USD', fx_rate_usd_aed: bad });
      assert.equal(r.complete, false, 'rate ' + bad + ' should be invalid');
      assert.equal(r.flags.length, 1);
      assert.equal(r.flags[0].reason, 'fx_rate_invalid');
      assert.equal(r.message, FX_RATE_INVALID_MESSAGE);
    }
  });

  test('normaliseCurrency canonicalises and defaults to the base', () => {
    assert.equal(normaliseCurrency('usd'), 'USD');
    assert.equal(normaliseCurrency('aed'), 'AED');
    assert.equal(normaliseCurrency(' USD '), 'USD');
    assert.equal(normaliseCurrency('GBP'), 'AED');
    assert.equal(normaliseCurrency(''), 'AED');
    assert.equal(normaliseCurrency(undefined), 'AED');
    assert.equal(normaliseCurrency(null), 'AED');
  });

  test('toBaseCurrency converts to the AED base only when possible', () => {
    assert.equal(toBaseCurrency(100, { currency: 'AED' }), 100);
    assert.equal(toBaseCurrency(100, { currency: 'USD', fx_rate: 3.6725 }), 367.25);
    assert.equal(toBaseCurrency(100, { currency: 'USD' }), null);
    assert.equal(toBaseCurrency(100, { currency: 'USD', fx_rate: 0 }), null);
    assert.equal(toBaseCurrency(null, { currency: 'AED' }), null);
  });
});

