import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGES, en, ar } from './i18nMessages';

// ---------------------------------------------------------------------------
// Lightweight i18n (E10.2, W8-02 / BRD PLT-06).
//
// The MVP ships English and Arabic. Every user-facing string on the core
// deal-flow surfaces and the Dashboard (the RTL demonstration screen) is looked
// up through t(key); the document language and direction flip together, and
// adding another locale is a dictionary entry. Page copy that is not yet
// translated falls back to the English value and then to the key itself.
//
// The dictionaries live in ./i18nMessages.js - plain JS so the Node coverage
// test (server/tests/i18n.test.js) asserts the same tables the bundle ships.
// ---------------------------------------------------------------------------

export { LANGUAGES };

const DICTIONARIES = { en, ar };

const STORAGE_KEY = 'dealforge.lang';

function normalise(code) {
  if (!code) return 'en';
  const base = String(code).trim().toLowerCase().split(/[-_]/)[0];
  return DICTIONARIES[base] ? base : 'en';
}

function readInitialLang() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return normalise(stored);
    // Fall back to the browser language when it is one we ship.
    if (typeof navigator !== 'undefined' && navigator.language) {
      const base = navigator.language.toLowerCase().split(/[-_]/)[0];
      if (DICTIONARIES[base]) return base;
    }
  } catch {
    // localStorage may be unavailable (private mode); fall through to default.
  }
  return 'en';
}

const LanguageContext = createContext(null);

// eslint-disable-next-line react/prop-types
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readInitialLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore persistence failures; the session still renders in the locale.
    }
  }, [lang, dir]);

  const setLang = useCallback((code) => setLangState(normalise(code)), []);

  const t = useCallback(
    (key, vars) => {
      const table = DICTIONARIES[lang] || en;
      let value = table[key] ?? en[key] ?? key;
      if (vars && typeof value === 'string') {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.replace(new RegExp('\\{' + name + '\\}', 'g'), String(replacement));
        }
      }
      return value;
    },
    [lang]
  );

  const value = useMemo(() => ({ t, lang, dir, setLang, languages: LANGUAGES }), [t, lang, dir, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // A component rendered outside the provider still works, in English.
    return { t: (key) => en[key] ?? key, lang: 'en', dir: 'ltr', setLang: () => {}, languages: LANGUAGES };
  }
  return ctx;
}

export default LanguageProvider;
