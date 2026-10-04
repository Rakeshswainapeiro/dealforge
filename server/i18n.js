// ---------------------------------------------------------------------------
// i18n / localisation (W8-02 / BRD PLT-06).
//
// Exposes the locale catalogue and, for each locale, how much of the shared
// chrome vocabulary is authored. Reads are open to any signed-in user (the
// language switcher needs them); there is nothing tenant-specific here.
// ---------------------------------------------------------------------------

import express from 'express';
import { buildI18nPayload, publicLocales } from './config/i18n.js';
import { en, ar } from '../src/lib/i18nMessages.js';

const TABLES = { en, ar };

export const i18nRouter = express.Router();

// GET /api/i18n - the locale catalogue with per-locale completeness plus the
// RTL demonstration target.
i18nRouter.get('/', (_req, res) => {
  res.json(buildI18nPayload(TABLES));
});

// GET /api/i18n/locales - descriptors only, for the language switcher.
i18nRouter.get('/locales', (_req, res) => {
  res.json({ locales: publicLocales() });
});

export default i18nRouter;
