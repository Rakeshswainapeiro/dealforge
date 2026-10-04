// ---------------------------------------------------------------------------
// Cross-border considerations unit tests (W2-09 / FIN-08, REQ-FIN-08).
//
// The accept criterion: "Fields appear when target geography differs from the
// subsidiary's home country." For a cross-border deal, FX exposure, withholding
// tax, transfer pricing and repatriation restrictions are captured. Advisory
// only — a missing consideration raises flags, it never blocks. Pure — no
// server needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCrossBorder, canonicalCountry, isCrossBorder,
  CROSS_BORDER_FIELDS, CROSS_BORDER_ITEMS, CROSS_BORDER_MISSING_MESSAGE,
} from '../config/crossBorder.js';

const CROSS_BORDER = {
  geography: 'Republic of India',
  [CROSS_BORDER_FIELDS.fx]: 'USD-linked revenue; 60% of cost base in INR; partial hedge via forward cover.',
  [CROSS_BORDER_FIELDS.wht]: '10% withholding on dividends under the UAE-India treaty.',
  [CROSS_BORDER_FIELDS.transfer_pricing]: 'Intercompany management fee at arm\'s length; transfer-pricing study on file.',
  [CROSS_BORDER_FIELDS.repatriation]: 'Capital and dividends freely repatriable after tax clearance.',
};

describe('cross-border considerations (FIN-08)', () => {
  test('the four considerations are exposed in BRD order', () => {
    assert.equal(CROSS_BORDER_ITEMS.length, 4);
    assert.deepEqual(CROSS_BORDER_ITEMS.map((i) => i.key), [
      CROSS_BORDER_FIELDS.fx,
      CROSS_BORDER_FIELDS.wht,
      CROSS_BORDER_FIELDS.transfer_pricing,
      CROSS_BORDER_FIELDS.repatriation,
    ]);
  });

  test('a same-country deal (UAE vs United Arab Emirates) does not apply', () => {
    const r = evaluateCrossBorder({ geography: 'UAE' }, { homeCountry: 'United Arab Emirates' });
    assert.equal(r.applies, false);
    assert.equal(r.complete, true);
    assert.equal(r.flags.length, 0);
    assert.equal(r.message, null);
    assert.equal(r.captured, 0);
  });

  test('a different country applies and flags the outstanding considerations', () => {
    const r = evaluateCrossBorder({ geography: 'Republic of India' }, { homeCountry: 'United Arab Emirates' });
    assert.equal(r.applies, true);
    assert.equal(r.complete, false);
    assert.equal(r.captured, 0);
    assert.equal(r.total, 4);
    assert.equal(r.flags.length, 4);
    assert.equal(r.message, CROSS_BORDER_MISSING_MESSAGE);
  });

  test('a cross-country deal with all four captured is complete with no flags', () => {
    const r = evaluateCrossBorder(CROSS_BORDER, { homeCountry: 'United Arab Emirates' });
    assert.equal(r.applies, true);
    assert.equal(r.captured, 4);
    assert.equal(r.complete, true);
    assert.equal(r.flags.length, 0);
    assert.equal(r.message, null);
    assert.equal(r.target_country, 'Republic of India');
    assert.equal(r.home_country, 'United Arab Emirates');
  });

  test('a partial capture flags only the missing considerations', () => {
    const r = evaluateCrossBorder({
      geography: 'Republic of India',
      [CROSS_BORDER_FIELDS.fx]: 'USD-linked revenue.',
      [CROSS_BORDER_FIELDS.wht]: '10% treaty rate.',
    }, { homeCountry: 'United Arab Emirates' });
    assert.equal(r.applies, true);
    assert.equal(r.captured, 2);
    assert.equal(r.complete, false);
    const reasons = r.flags.map((f) => f.reason).sort();
    assert.deepEqual(reasons, ['repatriation_missing', 'tp_missing']);
  });

  test('a blank consideration counts as missing', () => {
    const r = evaluateCrossBorder({
      geography: 'Republic of India',
      [CROSS_BORDER_FIELDS.fx]: '   ',
      [CROSS_BORDER_FIELDS.wht]: '10%',
      [CROSS_BORDER_FIELDS.transfer_pricing]: 'ALP',
      [CROSS_BORDER_FIELDS.repatriation]: 'Free',
    }, { homeCountry: 'United Arab Emirates' });
    assert.equal(r.captured, 3);
    assert.equal(r.flags.length, 1);
    assert.equal(r.flags[0].reason, 'fx_missing');
  });

  test('UAE and United Arab Emirates resolve to the same country', () => {
    assert.equal(canonicalCountry('UAE'), canonicalCountry('United Arab Emirates'));
    assert.equal(canonicalCountry('uae'), canonicalCountry('United Arab Emirates'));
    assert.equal(isCrossBorder('UAE', 'United Arab Emirates'), false);
  });

  test('an unknown geography falls back to its lower-case form', () => {
    assert.equal(canonicalCountry('  Atlantis '), 'atlantis');
    assert.equal(isCrossBorder('Atlantis', 'Atlantis'), false);
    assert.equal(isCrossBorder('Atlantis', 'United Arab Emirates'), true);
  });

  test('empty data never applies', () => {
    const r = evaluateCrossBorder({}, { homeCountry: 'United Arab Emirates' });
    assert.equal(r.applies, false);
    assert.equal(r.complete, true);
    assert.equal(r.flags.length, 0);
  });

  test('a missing home country never applies', () => {
    const r = evaluateCrossBorder({ geography: 'Republic of India' }, { homeCountry: null });
    assert.equal(r.applies, false);
    assert.equal(r.complete, true);
  });
});

