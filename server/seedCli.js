#!/usr/bin/env node
import 'dotenv/config';
import { initDb, pool } from './db.js';
import { runSeed, seedStatus } from './seedRun.js';
import { SEED_PROFILES } from './seedProfiles.js';

// ---------------------------------------------------------------------------
// Seed CLI (W1-11 / W1-12).
//
//   node server/seedCli.js                     # apply the resolved profile
//   node server/seedCli.js --profile=mvp       # load the MVP sample set
//   node server/seedCli.js --profile=off --clean
//   node server/seedCli.js --status            # show profile + current inventory
//   node server/seedCli.js --profile=mvp --clean --force
//
// Exit code is non-zero on failure so it can gate a deployment step.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { profile: undefined, clean: false, force: false, status: false, help: false };
  for (const raw of argv) {
    if (raw === '--clean') args.clean = true;
    else if (raw === '--force') args.force = true;
    else if (raw === '--status') args.status = true;
    else if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw.startsWith('--profile=')) args.profile = raw.slice('--profile='.length);
    else if (raw.startsWith('--profile')) args.profile = argv[argv.indexOf(raw) + 1];
  }
  return args;
}

function usage() {
  console.log('DealForge seed CLI\n');
  console.log('  node server/seedCli.js --profile=<' + SEED_PROFILES.join('|') + '> [--clean] [--force]');
  console.log('  node server/seedCli.js --status');
  console.log('\nProfiles: base | mvp | off. Without --profile the env (SEED_PROFILE /');
  console.log('SEED_DEMO_DATA) resolves it, defaulting to base.');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { usage(); process.exit(0); }

try {
  await initDb({ attempts: 5, delayMs: 1000 });
  if (args.status) {
    const status = await seedStatus();
    console.log(JSON.stringify(status, null, 2));
  } else {
    const result = await runSeed({ profile: args.profile, clean: args.clean, force: args.force });
    console.log(JSON.stringify(result, null, 2));
  }
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('[seed] failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
