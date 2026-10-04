// i18n / localisation coverage (W8-02 / BRD PLT-06).
//
// Pure tests: they import the exact same locale tables the browser bundle ships
// (src/lib/i18nMessages.js) and the server vocabulary (server/config/i18n.js) so
// an untranslated chrome string cannot slip past the bundler.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  I18N_VERSION, LOCALES, DEFAULT_LOCALE, CORE_KEYS, RTL_DEMO_SCREEN,
  normaliseLocale, localeByCode, isKnownLocale, directionFor, isRtl,
  missingCoreKeys, localeSummary, buildI18nPayload, publicLocales,
} from '../config/i18n.js';
import { en, ar, LANGUAGES } from '../../src/lib/i18nMessages.js';

describe('i18n vocabulary (PLT-06)', () => {
  test('ships English and Arabic with the default marked', () => {
    assert.equal(I18N_VERSION, 'PLT-06.1');
    assert.deepEqual(LOCALES.map((l) => l.code), ['en', 'ar']);
    assert.equal(DEFAULT_LOCALE, 'en');
    assert.equal(LOCALES.find((l) => l.code === 'ar').dir, 'rtl');
    assert.equal(LOCALES.find((l) => l.code === 'en').dir, 'ltr');
  });

  test('the client language list matches the server locales', () => {
    assert.deepEqual(LANGUAGES.map((l) => l.code), LOCALES.map((l) => l.code));
    assert.deepEqual(LANGUAGES.map((l) => l.dir), LOCALES.map((l) => l.dir));
  });

  test('the RTL demo screen is the Dashboard', () => {
    assert.equal(RTL_DEMO_SCREEN.route, '/Dashboard');
  });
});

describe('locale resolution (PLT-06)', () => {
  test('unknown and empty codes fall back to the default', () => {
    assert.equal(normaliseLocale(''), 'en');
    assert.equal(normaliseLocale('zz'), 'en');
    assert.equal(normaliseLocale(null), 'en');
  });

  test('case and region tags resolve to the base locale', () => {
    assert.equal(normaliseLocale('AR'), 'ar');
    assert.equal(normaliseLocale('ar-AE'), 'ar');
    assert.equal(normaliseLocale('en-GB'), 'en');
    assert.ok(isKnownLocale('ar-AE'));
    assert.ok(!isKnownLocale('fr'));
  });

  test('direction follows the locale', () => {
    assert.equal(directionFor('ar'), 'rtl');
    assert.equal(directionFor('ar-SA'), 'rtl');
    assert.equal(directionFor('en'), 'ltr');
    assert.ok(isRtl('ar'));
    assert.ok(!isRtl('en'));
    assert.equal(localeByCode('ar').native_label, '\u0627\u0644\u0639\u0631\u0628\u064a\u0629');
  });
});

describe('coverage (PLT-06)', () => {
  test('English authors every core key', () => {
    assert.deepEqual(missingCoreKeys(en), []);
  });

  test('Arabic authors every core key (chrome, vocabulary and Dashboard)', () => {
    assert.deepEqual(missingCoreKeys(ar), []);
  });

  test('every core key is a real English string (no key leaks remain in the set)', () => {
    for (const key of CORE_KEYS) {
      assert.equal(typeof en[key], 'string', key + ' missing from English');
      assert.ok(en[key].trim().length > 0, key + ' is blank in English');
    }
  });

  test('the Dashboard RTL screen is fully translated in both locales', () => {
    const dashboardKeys = CORE_KEYS.filter((k) => k.startsWith('dashboard.'));
    assert.ok(dashboardKeys.length >= 10, 'expected a real Dashboard key set');
    for (const key of dashboardKeys) {
      assert.ok(typeof en[key] === 'string' && en[key].length, key + ' missing in en');
      assert.ok(typeof ar[key] === 'string' && ar[key].length, key + ' missing in ar');
      // A translated Dashboard string must differ from English to be meaningful.
      assert.notEqual(ar[key], en[key], key + ' is identical in ar (untranslated)');
    }
  });

  test('localeSummary reports completeness for the shipped tables', () => {
    const arSummary = localeSummary('ar', ar);
    assert.equal(arSummary.complete, true);
    assert.equal(arSummary.missing.length, 0);
    assert.equal(arSummary.core_keys, CORE_KEYS.length);
    assert.equal(arSummary.dir, 'rtl');

    const enSummary = localeSummary('en', en);
    assert.equal(enSummary.complete, true);
  });

  test('a locale with a gap is reported as incomplete, not silently complete', () => {
    const summary = localeSummary('ar', { 'app.name': 'x' });
    assert.equal(summary.complete, false);
    assert.ok(summary.missing.includes('nav.dashboard'));
    assert.equal(summary.authored, 1);
  });

  test('buildI18nPayload attaches completeness to each locale', () => {
    const payload = buildI18nPayload({ en, ar });
    assert.equal(payload.version, I18N_VERSION);
    assert.equal(payload.locales.length, 2);
    for (const locale of payload.locales) {
      assert.equal(locale.complete, true, locale.code + ' should be complete');
    }
    assert.equal(payload.rtl_demo_screen.route, '/Dashboard');
  });

  test('publicLocales exposes descriptors only', () => {
    const pubs = publicLocales();
    assert.equal(pubs.length, 2);
    assert.equal(pubs[1].code, 'ar');
    assert.equal(pubs[1].dir, 'rtl');
    assert.equal(pubs[0].default, true);
    assert.equal(pubs[1].default, false);
  });
});
