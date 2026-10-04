import express from 'express';
import { pool } from './db.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { writeAudit, listAuditEvents } from './audit.js';
import {
  PORTFOLIO_REGISTER_CONFIG_KEY,
  PORTFOLIO_REGISTER_MESSAGES,
  defaultPortfolioRegister,
  validatePortfolioRegister,
  resolvePortfolioRegister,
  diffPortfolioRegister,
  buildPortfolioRegister,
  portfolioRegisterTemplateCsv,
  parsePortfolioRegisterCsv,
  registerMatchesSector,
  registerMatchesGeography,
  registerCapabilityOverlap,
} from './config/portfolioRegister.js';

// ---------------------------------------------------------------------------
// Portfolio register API (W4-01 / BRD ENT-04).
//
// The register is versioned configuration held in an AppSettings record
// (setting_key = 'portfolio_register_config'). Reads fall back to the shipped
// register, so the advisory synergy / conflict checks always have data. Writes
// require the admin / configurator role and mint the next revision.
// ---------------------------------------------------------------------------

export async function loadPortfolioRegisterConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [PORTFOLIO_REGISTER_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultPortfolioRegister();
    return resolvePortfolioRegister(rows[0].setting_value);
  } catch {
    return defaultPortfolioRegister();
  }
}

async function persistRegister(config, actor) {
  const payload = {
    setting_key: PORTFOLIO_REGISTER_CONFIG_KEY,
    setting_value: JSON.stringify(config),
    description: 'Portfolio register (cluster, sector, geography, capability tags)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [PORTFOLIO_REGISTER_CONFIG_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'portfolio-register-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

export const portfolioRegisterRouter = express.Router();

portfolioRegisterRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// GET /api/portfolio-register - the effective register (any authenticated reader).
portfolioRegisterRouter.get('/', async (_req, res) => {
  try {
    const config = await loadPortfolioRegisterConfig();
    const { ok, errors } = validatePortfolioRegister(config);
    res.json({ config, valid: ok, errors, defaults: defaultPortfolioRegister() });
  } catch (err) { sendErr(res, err); }
});

// GET /api/portfolio-register/template.csv - the load template (BRD ENT-04).
portfolioRegisterRouter.get('/template.csv', (_req, res) => {
  res.type('text/csv').send(portfolioRegisterTemplateCsv());
});

// PUT /api/portfolio-register - replace the register and mint a revision.
portfolioRegisterRouter.put('/', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the portfolio register' });
    }
    const base = await loadPortfolioRegisterConfig();
    const config = buildPortfolioRegister(req.body || {}, { actor: req.actor, base });
    const changes = diffPortfolioRegister(base, config);
    const id = await persistRegister(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'portfolio_register_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// POST /api/portfolio-register/import - load the register from the CSV template.
portfolioRegisterRouter.post('/import', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to import the portfolio register' });
    }
    const csv = typeof req.body?.csv === 'string' ? req.body.csv
      : (typeof req.body?.text === 'string' ? req.body.text : null);
    if (!csv) return res.status(400).json({ error: 'A CSV body is required (field "csv").' });
    const payload = parsePortfolioRegisterCsv(csv);
    const base = await loadPortfolioRegisterConfig();
    const config = buildPortfolioRegister(payload, { actor: req.actor, base });
    const changes = diffPortfolioRegister(base, config);
    const id = await persistRegister(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'portfolio_register_imported',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision }, after: { revision: config.revision, changes },
    });
    res.json({ ok: true, config, changes, imported: config.companies.length, saved: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/portfolio-register/history - the revision history (audit trail).
portfolioRegisterRouter.get('/history', async (req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'portfolio_register_updated' || e.action === 'portfolio_register_imported'));
  } catch (err) { sendErr(res, err); }
});

// GET /api/portfolio-register/matches?sector=&geography=&capabilities=a,b
// The advisory matches the synergy / conflict checks use, exposed so the
// screening board can show the affected companies with their tags.
portfolioRegisterRouter.get('/matches', async (req, res) => {
  try {
    const config = await loadPortfolioRegisterConfig();
    const companies = config.companies || [];
    const sector = req.query.sector || null;
    const geography = req.query.geography || null;
    const capabilities = String(req.query.capabilities || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json({
      version: config.version,
      sector: registerMatchesSector(companies, sector).map((c) => ({ id: c.id, name: c.name, cluster: c.cluster })),
      geography: registerMatchesGeography(companies, geography).map((c) => ({ id: c.id, name: c.name, cluster: c.cluster })),
      capability: registerCapabilityOverlap(companies, capabilities).map((c) => ({ id: c.id, name: c.name, cluster: c.cluster })),
    });
  } catch (err) { sendErr(res, err); }
});

export { PORTFOLIO_REGISTER_MESSAGES };
export default portfolioRegisterRouter;

