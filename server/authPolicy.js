import express from 'express';
import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { resolveActor } from './users.js';
import { canConfigure } from './rbac.js';
import { invalidateAuthPolicyCache, syncSsoProviders } from './auth.js';
import {
  AUTH_POLICY_KEY,
  MFA_MODES,
  SSO_PROVIDER_KINDS,
  AUTH_POLICY_MESSAGES,
  defaultAuthPolicy,
  resolveAuthPolicy,
  validateAuthPolicy,
  diffAuthPolicy,
  buildAuthPolicy,
  validateProvider,
  normalizeProvider,
  redactProvider,
  providersFromEnv,
  mergeProviders,
  mfaRequiredForRoles,
} from './config/authPolicy.js';

// ---------------------------------------------------------------------------
// Authentication policy route (W8-01 / BRD PLT-04).
//
// The group authentication policy (MFA mode + enforcement, the approved local
// account domains, and the registered SSO providers) lives in an AppSettings
// record (setting_key = 'auth_policy_config') so an administrator can retune it
// without a deploy; reads fall back to the shipped default. Deployment-time
// providers can also be supplied through SSO_* environment variables and are
// merged over the stored set. The enforcement itself is applied by Better Auth
// (server/auth.js) and the app-route middleware (server/index.js).
// ---------------------------------------------------------------------------

export const authPolicyRouter = express.Router();

authPolicyRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message, ...(err.data || {}) }); }

// The stored (runtime) policy, or the shipped default when nothing is stored.
export async function loadStoredAuthPolicy() {
  try {
    const { rows } = await pool.query(
      "SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
      [AUTH_POLICY_KEY]
    );
    if (!rows[0]?.setting_value) return defaultAuthPolicy();
    return resolveAuthPolicy(rows[0].setting_value);
  } catch {
    return defaultAuthPolicy();
  }
}

// The effective policy: stored overlaid with deployment-time providers.
export async function effectiveAuthPolicy() {
  const stored = await loadStoredAuthPolicy();
  const env = providersFromEnv(process.env);
  if (!env.length) return stored;
  return { ...stored, providers: mergeProviders(stored.providers, env) };
}

async function persistAuthPolicy(config, actor) {
  const payload = {
    setting_key: AUTH_POLICY_KEY,
    setting_value: JSON.stringify(config),
    description: 'Authentication policy: MFA mode, local account domains, SSO providers (PLT-04)',
    last_updated_by: actor.email,
  };
  const { rows: existing } = await pool.query(
    "SELECT id FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1",
    [AUTH_POLICY_KEY]
  );
  if (existing[0]) {
    await pool.query(
      'UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3 WHERE id = $1',
      [existing[0].id, JSON.stringify(payload), actor.email]
    );
    return existing[0].id;
  }
  const id = 'auth-policy-config-' + Date.now().toString(36);
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'AppSettings',$2,$3,$4,$4)",
    [id, actor.org_id, JSON.stringify(payload), actor.email]
  );
  return id;
}

async function hasMfaEnrolled(userId) {
  try {
    const { rows } = await pool.query('SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1', [userId]);
    return Boolean(rows[0]?.enabled);
  } catch { return false; }
}

// GET /api/auth-policy - the effective policy plus the vocabulary and the
// viewer's own MFA standing.
authPolicyRouter.get('/', async (req, res) => {
  try {
    const config = await effectiveAuthPolicy();
    const { ok, errors } = validateAuthPolicy(config);
    const hasMfa = await hasMfaEnrolled(req.actor.id);
    res.json({
      config: { ...config, providers: (config.providers || []).map(redactProvider) },
      defaults: defaultAuthPolicy(),
      mfa_modes: MFA_MODES,
      provider_kinds: SSO_PROVIDER_KINDS,
      valid: ok,
      errors,
      viewer: {
        has_mfa: hasMfa,
        mfa_required: mfaRequiredForRoles(req.actor.roles, config),
      },
      disclaimer: AUTH_POLICY_MESSAGES.disclaimer,
    });
  } catch (err) { sendErr(res, err); }
});

// GET /api/auth-policy/providers - the registered providers (secrets redacted).
authPolicyRouter.get('/providers', async (_req, res) => {
  try {
    const config = await effectiveAuthPolicy();
    res.json((config.providers || []).map(redactProvider));
  } catch (err) { sendErr(res, err); }
});

// GET /api/auth-policy/policy-history - the audited policy edits.
authPolicyRouter.get('/policy-history', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, entity, entity_id, action, actor_email, org_id, before, after, comment, ts " +
      "FROM audit_event WHERE action IN ('auth_policy_config_updated','sso_provider_registered','sso_provider_removed') " +
      'ORDER BY id DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) { sendErr(res, err); }
});

// PUT /api/auth-policy/policy - an administrator replaces the group policy.
authPolicyRouter.put('/policy', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the authentication policy' });
    }
    const base = await loadStoredAuthPolicy();
    const config = buildAuthPolicy(req.body || {}, { actor: req.actor, base });
    const { ok, errors } = validateAuthPolicy(config);
    if (!ok) return res.status(422).json({ error: AUTH_POLICY_MESSAGES.config_invalid, errors });
    const changes = diffAuthPolicy(base, config);
    const id = await persistAuthPolicy(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'auth_policy_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    invalidateAuthPolicyCache();
    // Mirror any runtime providers into Better Auth so sign-in can resolve them.
    await syncSsoProviders(config);
    const redacted = { ...config, providers: config.providers.map(redactProvider) };
    res.json({ ok: true, config: redacted, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// POST /api/auth-policy/providers - register or update an SSO provider. The
// provider is validated then added to the stored policy (bumping the revision)
// and mirrored into Better Auth's ssoProvider table.
authPolicyRouter.post('/providers', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to register an SSO provider' });
    }
    const provider = normalizeProvider(req.body || {});
    const errors = validateProvider(provider);
    if (errors.length) return res.status(422).json({ error: AUTH_POLICY_MESSAGES.config_invalid, errors });
    const base = await loadStoredAuthPolicy();
    const others = base.providers.filter((p) => p.provider_id.toLowerCase() !== provider.provider_id.toLowerCase());
    const nextProviders = [...others, provider];
    const config = buildAuthPolicy({ providers: nextProviders }, { actor: req.actor, base });
    const id = await persistAuthPolicy(config, req.actor);
    await writeAudit({
      entity: 'AppSettings', entityId: id, action: 'auth_policy_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      after: { revision: config.revision, changes: [{ field: 'providers', after: [provider.provider_id] }] },
    });
    await writeAudit({
      entity: 'auth', entityId: provider.provider_id, action: 'sso_provider_registered',
      actor: req.actor, orgId: provider.org_id || req.actor.org_id,
      after: redactProvider(provider),
    });
    invalidateAuthPolicyCache();
    await syncSsoProviders(config);
    res.status(201).json({ ok: true, provider: redactProvider(provider), revision: config.revision });
  } catch (err) { sendErr(res, err); }
});

// DELETE /api/auth-policy/providers/:providerId - remove a runtime provider.
authPolicyRouter.delete('/providers/:providerId', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to remove an SSO provider' });
    }
    const target = String(req.params.providerId || '').toLowerCase();
    const base = await loadStoredAuthPolicy();
    const removed = base.providers.find((p) => p.provider_id.toLowerCase() === target);
    if (!removed) return res.status(404).json({ error: 'No SSO provider with that id' });
    const nextProviders = base.providers.filter((p) => p.provider_id.toLowerCase() !== target);
    const config = buildAuthPolicy({ providers: nextProviders }, { actor: req.actor, base });
    await persistAuthPolicy(config, req.actor);
    await pool.query('DELETE FROM "ssoProvider" WHERE "providerId" = $1', [removed.provider_id]);
    await writeAudit({
      entity: 'auth', entityId: removed.provider_id, action: 'sso_provider_removed',
      actor: req.actor, orgId: removed.org_id || req.actor.org_id, before: redactProvider(removed),
    });
    invalidateAuthPolicyCache();
    res.json({ ok: true, removed: redactProvider(removed), revision: config.revision });
  } catch (err) { sendErr(res, err); }
});

export default authPolicyRouter;
