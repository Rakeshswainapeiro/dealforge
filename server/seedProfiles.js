// ---------------------------------------------------------------------------
// Seed profiles (W1-11 / W1-12, REQ-SEED-01).
//
// One place resolves "which sample data should this deployment hold" so boot,
// the CLI and the admin API all agree. Profiles:
//
//   base  the shipped reference data only: the Sirius org subtree, the seeded
//         cast (config/seededUsers.js), roles, document requirements, themes,
//         SLA targets and workflow templates. Safe in every environment.
//   mvp   base plus the deterministic MVP fixtures (config/mvpSeed.js) and the
//         portfolio register. This is what a demo / UAT deployment runs.
//   off   nothing is loaded beyond what the schema needs. SEED_DEMO_DATA=false
//         maps here and leaves zero seeded rows.
//
// Resolution order: an explicit SEED_PROFILE always wins; otherwise the legacy
// SEED_DEMO_DATA boolean is honoured ('1' -> mvp, '0' -> off); otherwise base.
// ---------------------------------------------------------------------------

export const SEED_PROFILES = ['base', 'mvp', 'off'];

// How each profile composes out of the building blocks.
export const PROFILE_COMPOSITION = {
  base: { base: true, mvp: false },
  mvp: { base: true, mvp: true },
  off: { base: false, mvp: false },
};

export function isSeedProfile(value) {
  return SEED_PROFILES.includes(value);
}

// Resolve the effective profile from the environment (or an explicit override).
export function resolveSeedProfile({ env = process.env, profile } = {}) {
  const explicit = profile ?? env.SEED_PROFILE;
  if (explicit != null && String(explicit).trim() !== '') {
    const normalized = String(explicit).trim().toLowerCase();
    if (isSeedProfile(normalized)) return normalized;
    // An unknown value is a configuration error the operator must see, not a
    // silent fallback to a profile that would load data they did not ask for.
    throw new Error(`Unknown SEED_PROFILE '${explicit}'. Expected one of: ${SEED_PROFILES.join(', ')}`);
  }
  const legacy = env.SEED_DEMO_DATA;
  if (legacy === '1' || legacy === 'true') return 'mvp';
  if (legacy === '0' || legacy === 'false') return 'off';
  return 'base';
}

// Whether sample data (the mvp fixtures) should be loaded for this profile.
export function profileLoadsMvp(profile) {
  return PROFILE_COMPOSITION[profile]?.mvp === true;
}

// Whether the base reference data should be loaded for this profile.
export function profileLoadsBase(profile) {
  return PROFILE_COMPOSITION[profile]?.base === true;
}

// Human-readable description for the boot log and the admin API.
export function describeSeedProfiles() {
  return {
    profiles: SEED_PROFILES,
    composition: PROFILE_COMPOSITION,
    env: ['SEED_PROFILE', 'SEED_DEMO_DATA', 'SEED_CLEAN'],
    description: {
      base: 'Sirius org tree, seeded cast, roles and app configuration only.',
      mvp: 'Base plus the deterministic MVP sample fixtures and portfolio register.',
      off: 'Load nothing; leaves zero seeded rows.',
    },
  };
}

export default { resolveSeedProfile, describeSeedProfiles, profileLoadsMvp, profileLoadsBase, SEED_PROFILES };
