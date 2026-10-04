// Seed cleanup + MVP fixture integration tests (W1-11 / W1-12, REQ-SEED-02).
//
// These hit a live database, so they are opt-in: set SEED_TEST=1 (and
// DATABASE_URL) to run them. They mutate the database, so run them against a
// disposable stack (the demo compose project), never a database holding work
// you care about.
//
//   SEED_TEST=1 DATABASE_URL=... node --test server/tests/seedCleanup.test.js
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const ENABLED = process.env.SEED_TEST === '1';

let pool;
let cleanSeedData;
let seedMvpData;
let runSeed;
let PROTECTED_EMAILS;
let MVP_FIXTURES;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = await import('../db.js'));
  ({ cleanSeedData } = await import('../seedCleanup.js'));
  ({ seedMvpData } = await import('../mvpSeed.js'));
  ({ runSeed } = await import('../seedRun.js'));
  ({ PROTECTED_EMAILS } = await import('../config/seededUsers.js'));
  ({ MVP_FIXTURES } = await import('../config/mvpSeed.js'));
  // Start from a clean slate regardless of the server's boot profile.
  await runSeed({ profile: 'mvp', clean: true, force: true });
});

after(async () => {
  if (pool) await pool.end();
});

async function counts() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM entity_record WHERE entity = 'DealOpportunity' AND data->>'seed' = 'true') AS opps,
       (SELECT count(*)::int FROM app_user WHERE data_seed = true) AS seed_users,
       (SELECT count(*)::int FROM investment_theme WHERE source = 'mvp_seed') AS themes,
       (SELECT count(*)::int FROM organization WHERE id = 'org-sirius-international-holding-limited') AS sirius_org`
  );
  return rows[0];
}

describe('seed cleanup and MVP fixtures', { skip: !ENABLED && 'set SEED_TEST=1 with a live database' }, () => {
  test('a fresh mvp load creates the twenty fixtures and the seed persona', async () => {
    const c = await counts();
    assert.equal(c.opps, 20, 'twenty seed opportunities');
    assert.ok(c.seed_users >= 13, 'shipped cast plus the seed persona');
    assert.equal(c.sirius_org, 1, 'the Sirius org tree survives');
  });

  test('the fixtures land in exactly the states the catalogue declares', async () => {
    const expected = {};
    for (const f of MVP_FIXTURES) expected[f.state] = (expected[f.state] || 0) + 1;
    const { rows } = await pool.query(
      `SELECT data->>'status' AS state, count(*)::int AS n FROM entity_record
        WHERE entity = 'DealOpportunity' AND data->>'seed' = 'true' GROUP BY data->>'status'`
    );
    const actual = Object.fromEntries(rows.map((r) => [r.state, r.n]));
    assert.deepEqual(actual, expected);
  });

  test('a clean removes every seed tier and leaves the protected cast intact', async () => {
    const { removed, after } = await cleanSeedData();
      assert.ok(removed.opportunities >= 20, 'seed opportunities removed');
    assert.equal(after.opportunities, 0, 'no seed opportunities remain');
    assert.equal(after.seedUsers, 0, 'no non-protected seed users remain');
    assert.equal(after.seedMemberships, 0, 'no seed memberships remain');
    assert.equal(after.authMembers, 0, 'no seed auth members remain');
    const c = await counts();
    assert.equal(c.sirius_org, 1, 'the Sirius org tree still survives');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM app_user
        WHERE lower(email) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)`,
      [PROTECTED_EMAILS]
    );
    assert.equal(rows[0].n, PROTECTED_EMAILS.length, 'the whole protected cast is still present');
  });

  test('a second clean is idempotent and removes nothing', async () => {
    const { removed } = await cleanSeedData();
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    assert.equal(total, 0, 'second clean removes zero rows');
  });

  test('a re-load after a clean restores the fixtures deterministically', async () => {
    const out = await seedMvpData({ force: true });
    assert.equal(out.created, 20);
    const c = await counts();
    assert.equal(c.opps, 20);
  });
});
