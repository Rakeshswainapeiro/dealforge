# W8-02 - i18n completion: externalised strings + RTL demonstration (BRD PLT-06)

## What this delivers

The interface is bilingual-ready: every string on the shared chrome and the
Dashboard (the RTL demonstration screen) is looked up through a translation
function, the language and text direction flip together, and the coverage of
each locale is verifiable rather than assumed.

- `src/lib/i18nMessages.js` - the shared locale dictionaries (English and
  Arabic), extracted into plain JS so the browser bundle and the Node coverage
  test import the exact same tables. Arabic now authors the application chrome,
  the shared deal-flow vocabulary and the full Dashboard screen.
- `server/config/i18nData.js` - the locale catalogue: the two locales with their
  direction and native label, the default locale, the RTL demonstration target
  (`/Dashboard`) and `CORE_KEYS`, the chrome key set every locale is checked
  against.
- `server/config/i18n.js` - pure lookups: `normaliseLocale` (case- and
  region-tolerant), `directionFor` / `isRtl`, `missingCoreKeys`,
  `localeSummary` (authored / missing / complete) and `buildI18nPayload`.
- `server/i18n.js` - `/api/i18n` (the catalogue with per-locale completeness and
  the RTL demo target) and `/api/i18n/locales` (descriptors for the switcher).
- `src/lib/i18n.jsx` - the provider now reads the shared dictionaries, resolves
  a locale from storage or the browser language, and flips
  `document.documentElement` `lang` and `dir` together.
- `src/pages/Dashboard.jsx` and its three panels - every caption (title,
  subtitle, the four metrics, Recent Scenarios, Quick Stats, Market Share
  Trends) is looked up through `t()`.

## How the acceptance criteria are met

- **No hard-coded strings** - the Dashboard and the shared chrome no longer
  contain literal user-facing English; the coverage test asserts every core key
  resolves to a real string in both locales.
- **RTL demo screen** - switching to Arabic sets `dir="rtl"` on the document
  root, and the Dashboard mirrors right-to-left (navigation, cards, charts and
  the language switcher). The evidence harness asserts the flipped direction
  before it screenshots, so the shot cannot silently regress to LTR.
- **Verifiable coverage** - `/api/i18n` reports 53 of 53 core keys authored for
  both English and Arabic, and flags any locale that falls back to English.

## Evidence

1. `admin_dashboard_ltr.png` - the Dashboard in English (LTR); every caption is
   resolved through `t()`.
2. `admin_dashboard_rtl.png` - the same Dashboard in Arabic (RTL); the whole
   screen mirrors right-to-left and the Arabic chrome strings render.
