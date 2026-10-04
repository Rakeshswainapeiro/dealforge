// ---------------------------------------------------------------------------
// i18n / localisation (W8-02 / BRD PLT-06).
//
// Pure functions only - no database, no network. The locale catalogue and the
// shared chrome vocabulary live in ./i18nData.js; this module owns the lookups
// (locale resolution, text direction) and the completeness check that proves
// the shipped chrome is fully translated for every locale.
// ---------------------------------------------------------------------------

import {
  I18N_VERSION, I18N_KEY, DIRECTIONS, LOCALES, DEFAULT_LOCALE, RTL_DEMO_SCREEN,
  CORE_KEYS, I18N_MESSAGES, i18nVocabulary,
} from './i18nData.js';

export {
  I18N_VERSION, I18N_KEY, DIRECTIONS, LOCALES, DEFAULT_LOCALE, RTL_DEMO_SCREEN,
  CORE_KEYS, I18N_MESSAGES,
};

// Resolve a locale code to a known locale, falling back to the default. The
// match is case-insensitive and also accepts a full tag like ar-AE.
export function normaliseLocale(code) {
  const raw = String(code || '').trim().toLowerCase();
  if (!raw) return DEFAULT_LOCALE;
  const base = raw.split(/[-_]/)[0];
  const hit = LOCALES.find((l) => l.code === base);
  return hit ? hit.code : DEFAULT_LOCALE;
}

// The locale record for a code (or the default when unknown).
export function localeByCode(code) {
  const normalised = normaliseLocale(code);
  return LOCALES.find((l) => l.code === normalised) || LOCALES[0];
}

// Whether a code is one the platform actually ships.
export function isKnownLocale(code) {
  const raw = String(code || '').trim().toLowerCase();
  if (!raw) return false;
  return LOCALES.some((l) => l.code === raw.split(/[-_]/)[0]);
}

// The UI direction for a locale: rtl for Arabic, ltr elsewhere.
export function directionFor(code) {
  return localeByCode(code).dir;
}

export function isRtl(code) {
  return directionFor(code) === 'rtl';
}

// The set of supported directions, in the order they can appear.
export function directions() {
  return [...DIRECTIONS];
}

// Which of the core chrome keys a locale table does not author. A non-empty
// result means the locale still falls back to English for that key.
export function missingCoreKeys(table = {}) {
  const authored = table && typeof table === 'object' ? table : {};
  return CORE_KEYS.filter((key) => {
    const value = authored[key];
    return typeof value !== 'string' || value.trim() === '';
  });
}

// A per-locale completeness summary: how many core keys are authored, which are
// missing, and whether the locale is fully covered.
export function localeSummary(code, table = {}) {
  const locale = localeByCode(code);
  const missing = missingCoreKeys(table);
  const authored = CORE_KEYS.length - missing.length;
  return {
    code: locale.code,
    label: locale.label,
    native_label: locale.native_label,
    dir: locale.dir,
    core_keys: CORE_KEYS.length,
    authored,
    missing,
    complete: missing.length === 0,
  };
}

// Build the payload the settings screen and the API return: the locale list
// with each locale's completeness (from the supplied tables) plus the RTL demo
// target. The tables argument maps a locale code to its dictionary.
export function buildI18nPayload(tables = {}) {
  return {
    ...i18nVocabulary(),
    locales: LOCALES.map((l) => ({
      ...l,
      ...localeSummary(l.code, tables[l.code] || {}),
    })),
  };
}

// The public locale descriptor list (no dictionaries), for the client switcher.
export function publicLocales() {
  return LOCALES.map((l) => ({
    code: l.code, label: l.label, native_label: l.native_label, dir: l.dir, default: Boolean(l.default),
  }));
}
