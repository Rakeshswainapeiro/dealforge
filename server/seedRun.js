import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { seedOrganizations } from './org.js';
import { seedUsersAndMemberships } from './seed.js';
import { seedDocumentRequirements } from './gate.js';
import { seedThemes } from './themes.js';
import { seedPipelineSla } from './pipeline.js';
import { seedWorkflows } from './workflows.js';
import { seedAuthTenants } from './authMigrate.js';
import { seedMvpData } from './mvpSeed.js';
import { cleanSeedData, inspectSeedData } from './seedCleanup.js';
import { resolveSeedProfile, profileLoadsBase, profileLoadsMvp, describeSeedProfiles } from './seedProfiles.js';
import { SIRIUS_ORGANIZATIONS } from '../src/data/siriusOrgTree.js';

// ---------------------------------------------------------------------------
// Seed orchestrator (W1-11 / W1-12).
//
// The one path that loads reference + sample data, shared by server boot, the
// CLI (server/seedCli.js) and the admin API. It owns the ordering (org tree
// before users before auth mirror) and the cleanup-then-load sequence so a
// deployment can move between profiles deterministically.
//
// Applying SEED_CLEAN=1 (or passing clean:true) removes the existing seed set
// before loading, which is how a re-seed from scratch is done without dropping
// the database.
// ---------------------------------------------------------------------------

const SYSTEM = { id: 'system', email: 'system@dealforge.local' };

// Load only the shipped reference data (org subtree, cast, roles, config).
export async function loadBase({ force = false } = {}) {
  const out = {};
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM organization');
  if (rows[0].n === 0 || force) {
    out.organizations = await seedOrganizations(SIRIUS_ORGANIZATIONS);
  }
  out.users = await seedUsersAndMemberships({ force });
  out.documentRequirements = await seedDocumentRequirements({ force });
  out.themes = await seedThemes({ force });
  out.pipelineSla = await seedPipelineSla({ force });
  out.workflows = await seedWorkflows({ force });
  // Mirror into Better Auth last so the auth tables always reflect the app.
  out.auth = await seedAuthTenants().catch((err) => {
    console.error('[seed] Better Auth mirror failed:', err.message);
    return { orgs: 0, users: 0, accounts: 0, members: 0, error: err.message };
  });
  return out;
}

// Resolve the profile, optionally clean, then load the requested layers.
export async function runSeed({ profile, clean = false, force = false, env = process.env } = {}) {
  const resolved = resolveSeedProfile({ env, profile });
  const result = { profile: resolved, cleaned: null, base: null, mvp: null };

  if (clean) {
    result.cleaned = await cleanSeedData({ includeConfig: false });
  }

  if (profileLoadsBase(resolved)) {
    result.base = await loadBase({ force: force || Boolean(clean) });
  }

  if (profileLoadsMvp(resolved)) {
    // mvp composes on top of base; if base is not in the profile the fixtures
    // still need the org tree + cast, so ensure it is present first.
    if (!result.base) result.base = await loadBase({ force });
    result.mvp = await seedMvpData({ force: force || Boolean(clean) });
  }

  if (resolved === 'off' && !clean) {
    result.note = 'Profile "off": nothing loaded. Use SEED_CLEAN=1 to remove existing seed rows.';
  }

  await writeAudit({
    entity: 'seed', action: 'run',
    actor: SYSTEM,
    after: {
      profile: resolved,
      cleaned: result.cleaned ? true : false,
      base: Boolean(result.base),
      mvp: result.mvp ? { created: result.mvp.created ?? 0, fixtures: result.mvp.fixtures ?? 0 } : null,
    },
    comment: 'Seed run via profile ' + resolved + (clean ? ' (clean first)' : ''),
  }).catch(() => {});

  return result;
}

// Report the resolved profile and what seed data is currently present.
export async function seedStatus({ env = process.env } = {}) {
  let profile = null;
  let error = null;
  try { profile = resolveSeedProfile({ env }); } catch (err) { error = err.message; }
  return {
    profile,
    error,
    config: describeSeedProfiles(),
    inventory: await inspectSeedData().catch((err) => ({ error: err.message })),
  };
}

export default runSeed;
