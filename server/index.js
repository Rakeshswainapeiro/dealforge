import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, pool } from './db.js';
import integrationsRouter, { UPLOAD_DIR, filesRouter } from './integrations.js';
import dataroomRouter, { dataroomInfo } from './dataroom.js';
import { storageInfo, s3Enabled, ensureBucket } from './storage.js';
import { classifyResidency } from './config/residency.js';
import { entitiesRouter, auditRouter } from './entities.js';
import orgRouter from './orgApi.js';
import gateRouter, { seedDocumentRequirements } from './gate.js';
import themesRouter, { seedThemes } from './themes.js';
import pipelineRouter, { seedPipelineSla } from './pipeline.js';
import workflowRouter, { seedWorkflows } from './workflows.js';
import qaRouter from './qa.js';
import notificationsRouter from './notify.js';
import featuresRouter, { resolveAppFeatures } from './features.js';
import relatedPartyRouter from './relatedParty.js';
import commentVisibilityRouter from './commentVisibility.js';
import auditChainRouter from './auditChain.js';
import presentationsRouter from './presentationSessions.js';
import notificationFrequencyRouter from './notificationFrequency.js';
import reportingRouter from './reporting.js';
import pipelineDashboardRouter from './pipelineDashboard.js';
import pipelineMetricsRouter from './pipelineMetrics.js';
import memoPackRouter from './memoPack.js';
import memoVerificationRouter from './memoVerification.js';
import duplicatesRouter from './duplicates.js';
import portfolioRegisterRouter from './portfolioRegister.js';
import mandateRouter from './mandate.js';
import checklistRouter from './checklist.js';
import i18nRouter from './i18n.js';
import documentPolicyRouter from './documentPolicy.js';
import sufficiencyRouter from './sufficiency.js';
import dataSourceRouter from './dataSource.js';
import templatesRouter from './templates.js';
import decisionReasonsRouter from './decisionReasons.js';
import doaRouter from './doa.js';
import routingRouter from './routing.js';
import { strategyRouter } from './strategy.js';
import { authHandler, auth, AUTH_BASE_PATH, loadAuthPolicy } from './auth.js';
import authPolicyRouter from './authPolicy.js';
import adminConfigRouter from './adminConfig.js';
import bulkImportRouter from './bulkImport.js';
import aiGovernanceRouter, { purgeExpiredLLMLogs } from './aiGovernance.js';
import { seedAuthTenants } from './authMigrate.js';
import { mfaRequiredForRoles } from './config/authPolicy.js';
import abacRouter from './abac.js';
import adminRouter from './admin.js';
import { runSeed } from './seedRun.js';
import { securityHeaders, rateLimit } from './security.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import {
  isPublicApiRoute, startupConfigErrors, allowedCorsOrigins, isCorsOriginAllowed, headerIdentityEnabled,
} from './config/identityPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);

const app = express();
app.set('trust proxy', true);
app.use(securityHeaders());
// Strict CORS allow-list (NFR-02). Disallowed origins get no CORS headers, so
// the browser blocks the response. Credentials (session cookie) are allowed
// only for the listed origins.
const CORS_ORIGINS = allowedCorsOrigins(process.env);
app.use(cors({
  origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin, CORS_ORIGINS)),
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));
// Broad API ceiling; the expensive integration routes add their own tighter
// limits inside their router (E10.1).
// Ceiling is env-tunable so the integration suite (which replays many requests
// from a handful of shared actors inside one window) can raise it without
// weakening the shipped default. The per-route limits in integrations.js are
// unaffected, so rate-limit coverage still exercises a real ceiling.
app.use('/api', rateLimit({ name: 'api', windowMs: 60_000, max: Number(process.env.API_RATE_LIMIT_MAX || 600) }));
// Better Auth - the identity layer. Its sub-routes (/sign-in, /sign-up,
// /get-session, /admin, /organization, ...) are mounted here so cookies and
// bearer sessions are issued + validated by Better Auth.
// Public, unauthenticated settings consumed by login/splash and the menu
// before any user session exists. Includes the app name and the effective
// feature map so navigation/routing can be configured without a session.
app.get('/api/auth/public-settings', async (_req, res) => {
  try {
    const features = await resolveAppFeatures();
    res.json({ appName: 'DealForge', features, authProvider: 'better-auth' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use(AUTH_BASE_PATH, authHandler);
// Deny by default (BRD PLT-02 / NFR-02). Every /api route except the short
// public list in config/identityPolicy.js requires an authenticated user. This
// is the single choke point; routers keep their own checks as a second layer.
// It also covers routers that never checked identity (e.g. /api/integrations).
async function requireAuthenticatedUser(req, res, next) {
  try {
    if (req.originalUrl.startsWith('/api/') && isPublicApiRoute(req.method, req.originalUrl)) return next();
    const actor = req.actor || await resolveActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required' });
    req.actor = actor;
    next();
  } catch (err) { next(err); }
}
app.use('/api', requireAuthenticatedUser);
// Every cross-org / permission denial inside the application API is written to
// the immutable audit trail, so J6 ('denied at every layer; the attempt is
// logged') holds end to end rather than only at the business-action layer.
// Integration and data-room routes are excluded: they authenticate against
// third parties and would otherwise flood the trail with transport noise.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // req.path is router-relative once a mounted router handles the response,
    // so the full request path must be read from originalUrl.
    const fullPath = req.originalUrl || req.url || '';
    const isAppDenial = res.statusCode === 403 && fullPath.startsWith('/api/')
      && !fullPath.startsWith('/api/integrations') && !fullPath.startsWith('/api/dataroom');
    if (!isAppDenial) return originalJson(body);
    Promise.resolve(req.actor || resolveActor(req))
      .then((actor) => writeAudit({
        entity: 'access_control',
        action: 'access_denied',
        actor,
        orgId: actor?.org_id || null,
        after: { method: req.method, path: fullPath, ip: req.ip },
        comment: (body && body.error) || 'Permission denied',
      }))
      .catch((err) => { console.error('[audit] access_denied write failed:', err?.message || err); })
      .finally(() => originalJson(body));
    return res;
  };
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    ai_backend_configured: Boolean(process.env.OPENAI_BASE_URL),
    storage: storageInfo(),
    dataroom: dataroomInfo(),
    residency: classifyResidency(),
  });
});

// Multi-factor enforcement (W8-01 / BRD PLT-04). When an administrator turns
// enforcement on, a session whose role is covered by the MFA policy but which
// has not enrolled a second factor is refused the protected application API
// with 403 {error:'mfa_required'}. The check is a no-op by default (policy
// default enforce_mfa=false), and it never blocks the identity endpoints a user
// needs to enrol - Better Auth's own /api/auth/* routes and the read surface of
// the auth-policy route remain reachable so the UI can prompt enrolment.
app.use(async (req, res, next) => {
  try {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/health')) return next();
    const policy = await loadAuthPolicy();
    if (!policy.enforce_mfa) return next();
    // The viewer must at least be able to read their own MFA standing.
    const actor = req.actor || await resolveActor(req);
    if (!actor) return next();
    req.actor = actor;
    const required = mfaRequiredForRoles(actor.roles || [], policy);
    if (!required) return next();
    const { rows } = await pool.query('SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1', [actor.id]);
    if (rows[0]?.enabled) return next();
    if (req.path.startsWith('/api/auth-policy')) return next();
    return res.status(403).json({ error: 'mfa_required', mfa_required: true });
  } catch (err) {
    next(err);
  }
});




// Uploaded files are served by opaque (uuid) names and never listed; block
// dotfiles and directory indexes so the local-disk mode cannot be walked.
// Local-disk uploads require a signed-in user (NFR-02). Per-organisation
// access checks for local files are a known gap tracked under DOC-02.
app.use('/uploads', requireAuthenticatedUser, express.static(UPLOAD_DIR, { dotfiles: 'deny', index: false }));
app.use('/api/files', filesRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/dataroom', dataroomRouter);
app.use('/api/entities', entitiesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/org', orgRouter);
app.use('/api/gate', gateRouter);
app.use('/api/themes', themesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/workflows', workflowRouter);
app.use('/api/qa', qaRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/features', featuresRouter);
app.use('/api/related-party', relatedPartyRouter);
app.use('/api/comment-visibility', commentVisibilityRouter);
app.use('/api/audit-chain', auditChainRouter);
app.use('/api/presentations', presentationsRouter);
app.use('/api/notification-frequency', notificationFrequencyRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/pipeline-dashboard', pipelineDashboardRouter);
app.use('/api/pipeline-metrics', pipelineMetricsRouter);
app.use('/api/memo-pack', memoPackRouter);
app.use('/api/memo-verification', memoVerificationRouter);
app.use('/api/i18n', i18nRouter);
app.use('/api/duplicates', duplicatesRouter);
app.use('/api/portfolio-register', portfolioRegisterRouter);
app.use('/api/mandate', mandateRouter);
app.use('/api/checklist', checklistRouter);
app.use('/api/document-policy', documentPolicyRouter);
app.use('/api/sufficiency', sufficiencyRouter);
app.use('/api/data-sources', dataSourceRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/decision-reasons', decisionReasonsRouter);
app.use('/api/doa', doaRouter);
app.use('/api/routing', routingRouter);
app.use('/api/strategy', strategyRouter);
app.use('/api/abac', abacRouter);
app.use('/api/admin', adminRouter);
app.use('/api/auth-policy', authPolicyRouter);
app.use('/api/admin-config', adminConfigRouter);
app.use('/api/bulk-import', bulkImportRouter);
app.use('/api/ai-governance', aiGovernanceRouter);

// Serve the built SPA when it exists (production image / `npm run build`).
const distDir = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).send('DealForge API is running. Build the frontend with `npm run build`.');
  });
}

// Central error handler. Multer and other middleware raise errors that would
// otherwise surface as an opaque 500; translate the security-relevant ones
// into meaningful status codes (E10.1) and never leak a stack to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is larger than the permitted upload size' });
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE' || err?.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Only a single file may be uploaded at a time' });
  }
  const status = err?.status || 500;
  if (status >= 500) console.error('[server]', err?.message || err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

async function start() {
  // Fail fast on unsafe configuration (NFR-02). In production any problem stops
  // the process; elsewhere it is a warning so local setups keep working.
  const configErrors = startupConfigErrors(process.env);
  if (configErrors.length && process.env.NODE_ENV === 'production') {
    for (const e of configErrors) console.error('[config] ' + e);
    console.error('[config] refusing to start in production with an unsafe configuration');
    process.exit(1);
  }
  for (const e of configErrors) console.warn('[config] warning: ' + e);
  if (headerIdentityEnabled(process.env)) {
    console.warn('[auth] header identity (x-user-id / x-user-email) is ENABLED - local testing only');
  }
  // Initialize the database without blocking HTTP startup; the DB may still be
  // booting (docker-compose) or intentionally absent in local frontend-only dev.
  initDb()
    .then(async () => {
      // Seeding is profile-driven (W1-11/W1-12): the Sirius org subtree, the
      // seeded cast and app config are the 'base' layer, and the deterministic
      // MVP sample fixtures (SEED_PROFILE=mvp) compose on top. SEED_CLEAN=1
      // removes the existing seed set first. Tests resolve to 'base' by
      // default, so no sample rows appear unless a profile asks for them.
      try {
        const ran = await runSeed({
          profile: process.env.SEED_PROFILE || undefined,
          clean: process.env.SEED_CLEAN === '1',
          // The baseline boot never force-overwrites rows an operator may have
          // edited; a clean re-seed does.
        });
        console.log(`[seed] profile '${ran.profile}'${ran.cleaned ? ' (cleaned first)' : ''}`);
        if (ran.base) {
          const b = ran.base;
          if (b.organizations) console.log(`[db] seeded ${b.organizations} organisations from the Sirius subtree`);
          if (b.documentRequirements && !b.documentRequirements.skipped) console.log(`[db] seeded ${b.documentRequirements.count} document requirements`);
          if (b.themes && !b.themes.skipped) console.log(`[db] seeded ${b.themes.count} investment themes`);
          if (b.auth) console.log(`[auth] Better Auth: ${b.auth.orgs} orgs / ${b.auth.users} users / ${b.auth.accounts} accounts / ${b.auth.members} members ensured`);
        }
        if (ran.mvp) {
          if (ran.mvp.skipped) console.log(`[db] MVP sample data already present (${ran.mvp.count} fixtures)`);
          else console.log(`[db] seeded ${ran.mvp.created} MVP sample fixtures (${ran.mvp.personas} personas)`);
        }
      } catch (seedErr) {
        console.error('[seed] seeding failed:', seedErr.message);
      }
    })
    .catch((err) => {
      console.error('[db] initialization failed, continuing without persistence:', err.message);
    });
  if (s3Enabled) {
    (async () => {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const ok = await ensureBucket().catch(() => false);
        if (ok) {
          console.log(`[storage] ObjectIO/S3 ready (${storageInfo().endpoint})`);
          return;
        }
        console.warn(`[storage] waiting for object storage (attempt ${attempt}/10)…`);
        await new Promise((r) => setTimeout(r, 2000));
      }
      console.warn('[storage] object storage unreachable — uploads will fail until it is up');
    })();
  } else {
    console.log('[storage] using local filesystem (set S3_ENDPOINT to enable object storage)');
  }
  // AI governance retention (W9-01 / NFR-03): prune governed AI logs past the
  // policy window once at boot and then daily. Unref'd so it never holds the
  // process open; failures are swallowed inside the helper.
  const aiLogSweep = setInterval(() => {
    purgeExpiredLLMLogs().then((n) => { if (n) console.log(`[ai-governance] pruned ${n} expired AI log rows`); }).catch(() => {});
  }, 24 * 60 * 60 * 1000);
  if (typeof aiLogSweep.unref === 'function') aiLogSweep.unref();
  purgeExpiredLLMLogs().catch(() => {});
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  });
}

start();
