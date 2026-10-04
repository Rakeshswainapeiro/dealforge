import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure, canViewOrg, canWriteOrg } from './rbac.js';
import { DERIVED_THEMES } from './config/derivedThemes.js';
import { WACC_DEFAULT_PCT } from './config/wacc.js';
import { computeHurdles, HURDLE_DEFAULTS } from './config/hurdleTable.js';
import { rankPassages } from './config/strategyIndex.js';

// ---------------------------------------------------------------------------
// Investment themes & mandate alignment (E5 / REQ-THEME-01).
//
// Each org may hold one theme (sector, keywords, geographies, size band). An
// opportunity is scored against its owning org's approved theme; a mismatch is a
// flag plus a reasoned exception path, never a silent block. Mandate thresholds
// (AED 10m floor, return hurdles) are configurable (REQ-RULE-10) and surface as
// non-blocking signals.
// ---------------------------------------------------------------------------

const uuid = () => crypto.randomUUID();

export const THEME_STATUSES = ['draft', 'approved', 'archived'];

// Illustrative defaults from the plan (D2), overridable per org. The AED 10m
// floor and return hurdles are signals, not hard blocks (E5.4).
export const DEFAULT_THRESHOLDS = {
  floor_aed: 10,
  ...HURDLE_DEFAULTS,
  wacc_pct: WACC_DEFAULT_PCT,
};

// Seed themes for the pilot subsidiaries named in the requirements (Esyasoft =
// Energy, FinStreet = Financial Services, medical cluster = healthcare).
export const DEFAULT_THEMES = [
  {
    org_id: 'org-infinia-technologies-limited',
    sector: 'Technology',
    keywords: ['software', 'saas', 'digital', 'technology', 'platform', 'ai'],
    geographies: ['UAE', 'GCC'],
    description: 'Technology platforms and digital businesses aligned to Infinia.',
  },
  {
    org_id: 'org-finstreet-limited',
    sector: 'Financial Services',
    keywords: ['financial services', 'payments', 'lending', 'fintech', 'banking', 'insurance'],
    geographies: ['UAE', 'GCC'],
    description: 'Financial services, payments and adjacent fintech.',
  },
];

function toTheme(row) {
  if (!row) return null;
  return {
    ...row,
    keywords: row.keywords || [],
    geographies: row.geographies || [],
    opportunity_types: row.opportunity_types || [],
    min_aed: row.min_aed != null ? Number(row.min_aed) : null,
    max_aed: row.max_aed != null ? Number(row.max_aed) : null,
  };
}

export async function getTheme(orgId) {
  if (!orgId) return null;
  const { rows } = await pool.query('SELECT * FROM investment_theme WHERE org_id = $1', [orgId]);
  return toTheme(rows[0]);
}

export async function getEffectiveTheme(orgId) {
  // Walk up the org tree so a descendant inherits its ancestor's theme when it
  // has not defined one of its own.
  let cursor = orgId;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const theme = await getTheme(cursor);
    if (theme && theme.status !== 'archived') return theme;
    const { rows } = await pool.query('SELECT parent_id FROM organization WHERE id = $1', [cursor]);
    cursor = rows[0]?.parent_id || null;
  }
  return null;
}

export async function upsertTheme(input, { actor } = {}) {
  const orgId = input.org_id;
  if (!orgId) { const e = new Error('org_id is required'); e.status = 400; throw e; }
  const before = await getTheme(orgId);
  const status = THEME_STATUSES.includes(input.status) ? input.status : 'draft';
  const approved = status === 'approved';
  const { rows } = await pool.query(
    `INSERT INTO investment_theme
       (id, org_id, sector, keywords, geographies, opportunity_types, description,
        min_aed, max_aed, status, approved_by, approved_at, updated_by, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (org_id) DO UPDATE SET
       sector = EXCLUDED.sector, keywords = EXCLUDED.keywords,
       geographies = EXCLUDED.geographies, opportunity_types = EXCLUDED.opportunity_types,
       description = EXCLUDED.description, min_aed = EXCLUDED.min_aed,
       max_aed = EXCLUDED.max_aed, status = EXCLUDED.status,
       approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at,
       updated_by = EXCLUDED.updated_by,
       -- Provenance is sticky: an operator edit must not erase how the theme
       -- was originally derived, so only a non-null source overwrites.
       source = COALESCE(EXCLUDED.source, investment_theme.source), updated_at = now()
     RETURNING *`,
    [
      before?.id || uuid(), orgId, input.sector || null,
      input.keywords || [], input.geographies || [], input.opportunity_types || [],
      input.description || null,
      input.min_aed ?? null, input.max_aed ?? null, status,
      approved ? actor?.email || null : null,
      approved ? new Date().toISOString() : null,
      actor?.email || null, input.source || null,
    ]
  );
  const after = toTheme(rows[0]);
  await writeAudit({
    entity: 'investment_theme', entityId: after.id, action: before ? 'update' : 'create',
    actor, orgId, before, after,
  });
  return after;
}

export async function getThresholds(orgId) {
  const { rows } = await pool.query(
    'SELECT * FROM mandate_threshold WHERE org_id = $1 OR org_id IS NULL ORDER BY org_id NULLS LAST LIMIT 1',
    [orgId || null]
  );
  const row = rows[0];
  const source = row || DEFAULT_THRESHOLDS;
  const num = (v) => (v != null ? Number(v) : null);
  return {
    org_id: row?.org_id || null,
    floor_aed: num(source.floor_aed) ?? DEFAULT_THRESHOLDS.floor_aed,
    equity_irr_min: num(source.equity_irr_min) ?? DEFAULT_THRESHOLDS.equity_irr_min,
    greenfield_irr_min: num(source.greenfield_irr_min) ?? DEFAULT_THRESHOLDS.greenfield_irr_min,
    roic_wacc_spread: num(source.roic_wacc_spread) ?? DEFAULT_THRESHOLDS.roic_wacc_spread,
    wacc_pct: num(source.wacc_pct) ?? DEFAULT_THRESHOLDS.wacc_pct,
    payback_max_years: num(source.payback_max_years) ?? DEFAULT_THRESHOLDS.payback_max_years,
    concentration_max_pct: num(source.concentration_max_pct) ?? DEFAULT_THRESHOLDS.concentration_max_pct,
    leverage_max: num(source.leverage_max) ?? DEFAULT_THRESHOLDS.leverage_max,
  };
}

export async function upsertThresholds(input, { actor } = {}) {
  const orgId = input.org_id || null;
  const t = { ...DEFAULT_THRESHOLDS, ...input };
  const { rows } = await pool.query(
    `INSERT INTO mandate_threshold
       (id, org_id, floor_aed, equity_irr_min, greenfield_irr_min, roic_wacc_spread,
        wacc_pct, payback_max_years, concentration_max_pct, leverage_max, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (COALESCE(org_id, '*')) DO UPDATE SET
       floor_aed = EXCLUDED.floor_aed, equity_irr_min = EXCLUDED.equity_irr_min,
       greenfield_irr_min = EXCLUDED.greenfield_irr_min, roic_wacc_spread = EXCLUDED.roic_wacc_spread,
       wacc_pct = EXCLUDED.wacc_pct,
       payback_max_years = EXCLUDED.payback_max_years,
       concentration_max_pct = EXCLUDED.concentration_max_pct,
       leverage_max = EXCLUDED.leverage_max, updated_at = now()
     RETURNING *`,
    [uuid(), orgId, t.floor_aed, t.equity_irr_min, t.greenfield_irr_min, t.roic_wacc_spread,
     t.wacc_pct, t.payback_max_years, t.concentration_max_pct, t.leverage_max]
  );
  await writeAudit({ entity: 'mandate_threshold', entityId: rows[0].id, action: 'update', actor, orgId, after: rows[0] });
  return getThresholds(orgId);
}

// The effective hurdle policy for an org, as a table the admin screen and the
// audit trail can show (W2-04 / FIN-04). Recomputed from the org's mandate
// thresholds and stamped with the hurdle-table revision, so a change is
// traceable to the policy version it produced.
export async function getHurdlePolicy(orgId) {
  const thresholds = await getThresholds(orgId);
  const table = computeHurdles({
    data: {},
    thresholds,
    wacc: { effective_wacc: thresholds.wacc_pct },
  });
  return {
    version: table.version,
    scope_org_id: thresholds.org_id || null,
    thresholds: table.thresholds,
    equity_irr_threshold: table.equity_irr_threshold,
    rows: table.rows.map((r) => ({
      key: r.key, label: r.label, threshold: r.threshold, unit: r.unit,
      comparator: r.comparator, basis: r.basis, threshold_kind: r.threshold_kind,
    })),
  };
}

// Alignment check (E5.2/E5.3). Returns a flag, a 0-100 strength and the reasons,
// plus the non-blocking AED floor / hurdle signals (E5.4).
export async function evaluateAlignment(opportunity, { orgId, strategy = null } = {}) {
  const data = opportunity?.data || opportunity || {};
  const blankish = (v) => v == null || String(v).trim() === '';
  const ownerOrg = orgId || data.owner_org_id || null;
  const theme = await getEffectiveTheme(ownerOrg);
  const thresholds = await getThresholds(ownerOrg);

  const haystack = [data.opportunity_name, data.sector, data.geography, data.target_name,
    data.narrative_what, data.narrative_why_now, data.narrative_why_us, data.decision_sought]
    .filter(Boolean).join(' ').toLowerCase();

  const matched = [];
  const reasons = [];
  // Per-dimension verdicts with a cited source passage (W3-13 / SCR-02). Each
  // dimension is graded Aligned / Partly / Not aligned, and the rationale quotes
  // the strategy passage the verdict rests on when the entity has an indexed
  // corpus. Dimensions without a corpus or a matching passage still carry a
  // verdict; the citation is simply absent.
  const dimensions = [];
  const cite = (query) => {
    const passages = strategy?.passages || [];
    if (!passages.length || !query) return null;
    const [top] = rankPassages(passages, query, { limit: 1 });
    return top ? { document_id: top.document_id, document_name: top.document_name, text: top.text, score: top.score, matched_terms: top.matched_terms } : null;
  };
  let score = 0;

  if (theme) {
    if (theme.sector && data.sector && String(data.sector).toLowerCase() === String(theme.sector).toLowerCase()) {
      matched.push('sector');
      score += 40;
      reasons.push(`Sector '${data.sector}' matches the theme sector '${theme.sector}'.`);
      dimensions.push({ key: 'sector', label: 'Sector', verdict: 'aligned', rationale: `Sector '${data.sector}' matches the theme sector '${theme.sector}'.`, citation: cite(`${theme.sector} ${data.sector}`) });
    } else if (theme.sector) {
      reasons.push(`Sector '${data.sector || 'unspecified'}' differs from the theme sector '${theme.sector}'.`);
      dimensions.push({ key: 'sector', label: 'Sector', verdict: blankish(data.sector) ? 'not_aligned' : 'partly', rationale: `Sector '${data.sector || 'unspecified'}' differs from the theme sector '${theme.sector}'.`, citation: cite(`${theme.sector}`) });
    }

    const geoHit = (theme.geographies || []).find((g) => haystack.includes(String(g).toLowerCase()));
    if (geoHit) {
      matched.push('geography'); score += 20; reasons.push(`Geography '${geoHit}' is within the theme's geographies.`);
      dimensions.push({ key: 'geography', label: 'Geography', verdict: 'aligned', rationale: `Geography '${geoHit}' is within the theme's geographies.`, citation: cite(`${geoHit} geography`) });
    } else if ((theme.geographies || []).length) {
      dimensions.push({ key: 'geography', label: 'Geography', verdict: blankish(data.geography) ? 'not_aligned' : 'partly', rationale: `Geography '${data.geography || 'unspecified'}' is outside the theme's geographies (${theme.geographies.join(', ')}).`, citation: cite(theme.geographies.join(' ')) });
    }

    const keywordHits = (theme.keywords || []).filter((k) => haystack.includes(String(k).toLowerCase()));
    if (keywordHits.length) {
      matched.push('keywords');
      score += Math.min(40, keywordHits.length * 15);
      reasons.push(`Matched theme keywords: ${keywordHits.join(', ')}.`);
      dimensions.push({ key: 'keywords', label: 'Focus areas', verdict: 'aligned', rationale: `Matched theme keywords: ${keywordHits.join(', ')}.`, citation: cite(keywordHits.join(' ')) });
    } else if ((theme.keywords || []).length) {
      dimensions.push({ key: 'keywords', label: 'Focus areas', verdict: 'not_aligned', rationale: `No theme keyword matched (${theme.keywords.join(', ')}).`, citation: cite(theme.keywords.join(' ')) });
    }

    const amount = Number(data.total_commitment_aed);
    if (Number.isFinite(amount) && amount > 0) {
      if (theme.min_aed != null && amount < Number(theme.min_aed)) {
        reasons.push('Below the theme size floor.');
        dimensions.push({ key: 'size', label: 'Size band', verdict: 'not_aligned', rationale: 'Below the theme size floor.', citation: null });
      } else if (theme.max_aed != null && amount > Number(theme.max_aed)) {
        reasons.push('Above the theme size ceiling.');
        dimensions.push({ key: 'size', label: 'Size band', verdict: 'not_aligned', rationale: 'Above the theme size ceiling.', citation: null });
      } else {
        score += 10; matched.push('size'); reasons.push('Commitment is within the theme size band.');
        dimensions.push({ key: 'size', label: 'Size band', verdict: 'aligned', rationale: 'Commitment is within the theme size band.', citation: null });
      }
    }
  } else {
    reasons.push('No approved investment theme is configured for this organisation.');
  }

  score = Math.max(0, Math.min(100, score));
  const aligned = Boolean(theme) && score >= 40;

  // Non-blocking signals (E5.4 / REQ-RULE-02/05).
  const signals = [];
  const amount = Number(data.total_commitment_aed);
  if (Number.isFinite(amount) && amount > 0 && amount < thresholds.floor_aed) {
    signals.push({ type: 'floor', severity: 'warn', label: 'Below AED ' + thresholds.floor_aed + 'm floor', detail: 'Total commitment is below the configured minimum; requires a portfolio-synergy + IRR exception and Sirius escalation.' });
  }
  signals.push({ type: 'hurdle', severity: 'info', label: 'Returns to demonstrate', detail: 'Equity IRR >=' + thresholds.equity_irr_min + '% (greenfield >=' + thresholds.greenfield_irr_min + '%), payback <= ' + thresholds.payback_max_years + ' yrs, leverage <= ' + thresholds.leverage_max + 'x.' });

  return {
    theme_org_id: theme?.org_id || null,
    has_theme: Boolean(theme),
    theme_status: theme?.status || null,
    aligned,
    score,
    matched,
    reasons,
    // Per-dimension graded verdicts with a cited source passage (W3-13 /
    // SCR-02). Verdicts are aligned / partly / not_aligned; the citation names
    // the strategy document a passage was quoted from when the corpus had one.
    dimensions,
    dimension_summary: {
      aligned: dimensions.filter((d) => d.verdict === 'aligned').length,
      partly: dimensions.filter((d) => d.verdict === 'partly').length,
      not_aligned: dimensions.filter((d) => d.verdict === 'not_aligned').length,
      cited: dimensions.filter((d) => d.citation).length,
    },
    signals,
    thresholds,
    // The entity's indexed strategy corpus (W4-02 / ENT-02) is carried through
    // so the panel and the rationale can cite a source passage. Counts only;
    // the passages themselves are quoted by the citation step (W3-13).
    strategy_sources: strategy ? {
      documents: strategy.documents || 0,
      passages: (strategy.passages || []).length,
      available: (strategy.passages || []).length > 0,
    } : null,
  };
}

export async function seedThemes({ force = false } = {}) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM investment_theme');
  const empty = rows[0].n === 0;
  let n = 0;
  if (empty || force) {
    for (const theme of DEFAULT_THEMES) {
      const { rows: org } = await pool.query('SELECT id FROM organization WHERE id = $1', [theme.org_id]);
      if (!org[0]) continue;
      await upsertTheme({ ...theme, status: 'approved' }, { actor: { id: 'system', email: 'system' } });
      n += 1;
    }
  }
  // Fill a nature-of-business-derived theme for every mandate-holding
  // subsidiary that the curated pilot list did not already cover, so each
  // cluster screens against a defensible mandate (REQ-THEME-01, E5). This runs
  // on every boot: it is idempotent and backfills orgs added since the last run.
  n += await seedDerivedThemes();
  const { rows: thr } = await pool.query('SELECT count(*)::int AS n FROM mandate_threshold');
  if (thr[0].n === 0) await upsertThresholds({ org_id: null }, { actor: { id: 'system', email: 'system' } });
  return { skipped: n === 0, count: n };
}

// Seed the derived themes, skipping orgs that already hold one. Idempotent:
// safe to call on every boot. Returns the number of themes written.
export async function seedDerivedThemes() {
  const actor = { id: 'system', email: 'system' };
  let n = 0;
  for (const theme of DERIVED_THEMES) {
    const existing = await getTheme(theme.org_id);
    if (existing) continue;
    const { rows: org } = await pool.query('SELECT id FROM organization WHERE id = $1', [theme.org_id]);
    if (!org[0]) continue;
    await upsertTheme({ ...theme, status: 'approved', source: 'nature_of_business_map' }, { actor });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// HTTP routes — /api/themes
// ---------------------------------------------------------------------------
export const themesRouter = express.Router();

themesRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

themesRouter.get('/', async (req, res) => {
  try {
    const orgId = req.query.org_id || req.actor.org_id;
    if (!canViewOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view that theme' });
    }
    const theme = await getTheme(orgId);
    const thresholds = await getThresholds(orgId);
    res.json({ org_id: orgId, theme, thresholds });
  } catch (err) { sendErr(res, err); }
});

themesRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Admin role required' });
    const body = req.body || {};
    const orgId = body.org_id || req.actor.org_id;
    const theme = await upsertTheme({ ...body, org_id: orgId }, { actor: req.actor });
    res.json(theme);
  } catch (err) { sendErr(res, err); }
});

themesRouter.put('/thresholds', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) return res.status(403).json({ error: 'Admin role required' });
    res.json(await upsertThresholds(req.body || {}, { actor: req.actor }));
  } catch (err) { sendErr(res, err); }
});

// The effective hurdle policy: every threshold the automatic hurdle test reads,
// resolved for the org and stamped with the policy revision (W2-04 / FIN-04).
themesRouter.get('/hurdles', async (req, res) => {
  try {
    const orgId = req.query.org_id || req.actor.org_id;
    if (!canViewOrg(req.actor.membership, orgId, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view those hurdles' });
    }
    res.json(await getHurdlePolicy(orgId));
  } catch (err) { sendErr(res, err); }
});

// Alignment for an existing opportunity (E5.2).
themesRouter.get('/alignment/:opportunityId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      ['DealOpportunity', req.params.opportunityId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canViewOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to view this opportunity' });
    }
    res.json({ opportunity_id: row.id, alignment: await evaluateAlignment(row, { orgId: row.owner_org_id }) });
  } catch (err) { sendErr(res, err); }
});

// Record a reasoned exception for a misaligned submission (E5.2 / J3).
themesRouter.post('/exceptions/:opportunityId', async (req, res) => {
  try {
    const reason = (req.body?.reason || '').trim();
    if (reason.length < 10) return res.status(400).json({ error: 'A reasoned exception of at least 10 characters is required' });
    const { rows } = await pool.query(
      'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
      ['DealOpportunity', req.params.opportunityId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Opportunity not found' });
    if (!canWriteOrg(req.actor.membership, row.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to record an exception for this opportunity' });
    }
    const patched = {
      ...row.data,
      theme_exception_reason: reason,
      theme_exception_by: req.actor.email,
      theme_exception_at: new Date().toISOString(),
    };
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      ['DealOpportunity', row.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: 'DealOpportunity', entityId: row.id, action: 'theme_exception',
      actor: req.actor, orgId: row.owner_org_id, after: { reason },
    });
    res.json({ ok: true, opportunity_id: row.id, theme_exception_reason: reason });
  } catch (err) { sendErr(res, err); }
});

// Alignment audit trail for an opportunity.
themesRouter.get('/exceptions/:opportunityId/history', async (req, res) => {
  try {
    res.json(await listAuditEvents({ entity: 'DealOpportunity', entityId: req.params.opportunityId, limit: 50 }));
  } catch (err) { sendErr(res, err); }
});

export default themesRouter;
