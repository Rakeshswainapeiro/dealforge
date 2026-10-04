import { pool } from './db.js';
import { deleteObject } from './storage.js';
import { PROTECTED_EMAILS } from './config/seededUsers.js';

// -------------------------------------------------------------------------
// Seed data cleanup (REQ-SEED-02 / W1-11).
//
// Everything the sample/MVP seed creates is tagged so it can be removed
// again: opportunities and portfolio records carry `seed: true` in their
// JSONB, the recruit-app users it provisions carry `seeded: true`, and the
// theme/notification/etc. rows it makes are recognised by their stable id
// prefix or by the `seed`/`demo_seed` audit marker. None of these tags are
// set by ordinary use, so cleanup can never touch a record a person created.
//
// The pass is split into tiers and each tier is measured before and after, so
// the caller gets an auditable before/after count. It is idempotent: a second
// run finds nothing to remove.
//
// What is never removed:
//   * the Sirius organisation subtree (boot-seeded reference data),
//   * the protected seeded cast (config/seededUsers.js),
//   * configuration the app seeds once (document_requirement, pipeline_sla,
//     workflow templates) unless `includeConfig` is explicitly set.
// -------------------------------------------------------------------------

const PROTECTED = new Set(PROTECTED_EMAILS.map((e) => e.toLowerCase()));

// Entity tables that hold a stable primary id and may be seed-created. The
// pipeline/route tables below these are keyed by opportunity id, so they are
// cleaned by subquery rather than by their own marker.
const OPPORTUNITY_KEYS = ['seed-', 'opp-demo-'];

function isSeedOpportunityId(id) {
  return OPPORTUNITY_KEYS.some((p) => String(id || '').startsWith(p));
}

async function count(query, params = []) {
  const { rows } = await pool.query(query, params);
  return Number(rows[0]?.n || 0);
}

// Delete the object bytes for a set of submission_document rows, then hard-
// delete the rows. Bytes are removed best-effort so a missing object never
// blocks the DB cleanup.
async function purgeDocumentsWhere(whereSql, params = []) {
  const { rows } = await pool.query(
    `SELECT id, object_key FROM submission_document WHERE ${whereSql}`,
    params
  );
  for (const row of rows) {
    if (!row.object_key) continue;
    try { await deleteObject(row.object_key); } catch { /* best effort */ }
  }
  await pool.query(`DELETE FROM submission_document WHERE ${whereSql}`, params);
  return rows.length;
}

// Opportunities owned by the seed: either the `seed: true` marker or the
// historical `demo: true` marker, or one of the historical demo id prefixes.
const SEED_OPP_WHERE = `(
  (data->>'seed') = 'true'
  OR (data->>'demo') = 'true'
  OR id LIKE 'seed-%'
  OR id LIKE 'opp-demo-%'
)`;

async function inspectOpportunities() {
  const n = await count(
    `SELECT count(*)::int AS n FROM entity_record WHERE entity = 'DealOpportunity' AND deleted = false AND ${SEED_OPP_WHERE}`
  );
  return n;
}

function emptyCounts() {
  return {
    opportunities: 0, documents: 0, documentBytes: 0, pipelineTransitions: 0,
    routes: 0, routeStages: 0, routeParticipants: 0, workflowEvents: 0,
    qaThreads: 0, qaMessages: 0, qaParticipants: 0, relatedPartyReviews: 0,
    notifications: 0, portfolioRecords: 0, seededThemes: 0, seedUsers: 0,
    seedMemberships: 0, accessGrants: 0, authSessions: 0, authMembers: 0,
  };
}

// Measure how much seed data is currently present, without changing anything.
export async function inspectSeedData() {
  const counts = emptyCounts();
  counts.opportunities = await inspectOpportunities();
  counts.documents = await count(
    `SELECT count(*)::int AS n FROM submission_document d
      WHERE d.opportunity_id IN (
        SELECT id FROM entity_record WHERE entity = 'DealOpportunity' AND ${SEED_OPP_WHERE})
      OR d.opportunity_id LIKE 'seed-%' OR d.opportunity_id LIKE 'opp-demo-%'`
  );
  counts.pipelineTransitions = await count(
    `SELECT count(*)::int AS n FROM pipeline_transition WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  );
  counts.routes = await count(
    `SELECT count(*)::int AS n FROM submission_route WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  );
  counts.portfolioRecords = await count(
    `SELECT count(*)::int AS n FROM entity_record WHERE deleted = false AND (data->>'seed') = 'true'
       AND entity <> 'DealOpportunity'`
  );
  counts.seedUsers = await count(
    `SELECT count(*)::int AS n FROM app_user
      WHERE (data_seed = true OR id LIKE 'user-demo-%')
        AND lower(email) NOT IN (SELECT lower(x) FROM unnest($1::text[]) x)`,
    [PROTECTED_EMAILS]
  ).catch(() => 0);
  counts.seedMemberships = await count(
    `SELECT count(*)::int AS n FROM membership WHERE
       (user_id IN (SELECT id FROM app_user
          WHERE (data_seed = true OR id LIKE 'user-demo-%')
            AND lower(email) NOT IN (SELECT lower(x) FROM unnest($1::text[]) x))
        OR id LIKE 'mem-demo-%' OR id LIKE 'mem-finstreet-lead')
       AND user_id NOT IN (SELECT id FROM app_user WHERE lower(email) IN (SELECT lower(x) FROM unnest($1::text[]) x))`,
    [PROTECTED_EMAILS]
  ).catch(() => 0);
  counts.routeStages = await count(
    `SELECT count(*)::int AS n FROM route_stage WHERE route_id IN
       (SELECT id FROM submission_route WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%')`
  ).catch(() => 0);
  counts.routeParticipants = await count(
    `SELECT count(*)::int AS n FROM route_participant WHERE route_id IN
       (SELECT id FROM submission_route WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%')`
  ).catch(() => 0);
  counts.workflowEvents = await count(
    `SELECT count(*)::int AS n FROM workflow_event WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  ).catch(() => 0);
  counts.seededThemes = await count(
    `SELECT count(*)::int AS n FROM investment_theme WHERE source = 'mvp_seed'`
  ).catch(() => 0);
  counts.notifications = await count(
    `SELECT count(*)::int AS n FROM notification WHERE kind IN ('seed_fixture','demo_seed')`
  );
  counts.authMembers = await count(
    `SELECT count(*)::int AS n FROM auth_member m JOIN app_user u ON u.id = m."userId"
      WHERE (u.data_seed = true OR u.id LIKE 'user-demo-%')
        AND lower(u.email) NOT IN (SELECT lower(x) FROM unnest($1::text[]) x)`,
    [PROTECTED_EMAILS]
  ).catch(() => 0);
  return counts;
}

// Remove all seed data. Returns { removed, before, after }.
export async function cleanSeedData({ includeConfig = false, actor = null } = {}) {
  void actor;
  const before = await inspectSeedData();
  const removed = emptyCounts();

  // 1. Document bytes + rows for seed opportunities.
  removed.documentBytes = await purgeDocumentsWhere(
    `opportunity_id IN (SELECT id FROM entity_record WHERE entity = 'DealOpportunity' AND ${SEED_OPP_WHERE})
       OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  );
  removed.documents = removed.documentBytes;

  // 2. Child rows keyed by seed opportunity id (order: leaves first).
  const seedOpps = `(SELECT id FROM entity_record WHERE entity = 'DealOpportunity' AND ${SEED_OPP_WHERE})`;
  removed.qaParticipants = (await pool.query(
    `DELETE FROM qa_participant WHERE thread_id IN (SELECT id FROM qa_thread WHERE opportunity_id IN (SELECT id FROM entity_record WHERE entity = 'DealOpportunity' AND ${SEED_OPP_WHERE}) OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%')`
  )).rowCount;
  removed.qaMessages = (await pool.query(
    `DELETE FROM qa_message WHERE thread_id IN (SELECT id FROM qa_thread WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%')`
  )).rowCount;
  removed.qaThreads = (await pool.query(
    `DELETE FROM qa_thread WHERE opportunity_id IN ${seedOpps} OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  )).rowCount;
  removed.workflowEvents = (await pool.query(
    `DELETE FROM workflow_event WHERE opportunity_id IN ${seedOpps} OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  )).rowCount;
  removed.routeParticipants = (await pool.query(
    `DELETE FROM route_participant WHERE route_id IN (SELECT id FROM submission_route WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%')`
  )).rowCount;
  removed.routeStages = (await pool.query(
    `DELETE FROM route_stage WHERE route_id IN (SELECT id FROM submission_route WHERE opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%')`
  )).rowCount;
  removed.routes = (await pool.query(
    `DELETE FROM submission_route WHERE opportunity_id IN ${seedOpps} OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  )).rowCount;
  removed.relatedPartyReviews = (await pool.query(
    `DELETE FROM related_party_review WHERE opportunity_id IN ${seedOpps} OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  )).rowCount;
  removed.pipelineTransitions = (await pool.query(
    `DELETE FROM pipeline_transition WHERE opportunity_id IN ${seedOpps} OR opportunity_id LIKE 'seed-%' OR opportunity_id LIKE 'opp-demo-%'`
  )).rowCount;

  // 3. Notifications the seed raised.
  removed.notifications = (await pool.query(
    `DELETE FROM notification WHERE kind IN ('seed_fixture','demo_seed')
       OR entity_id IN ${seedOpps}`
  )).rowCount;

  // 4. The opportunities themselves.
  removed.opportunities = (await pool.query(
    `DELETE FROM entity_record WHERE entity = 'DealOpportunity' AND ${SEED_OPP_WHERE}`
  )).rowCount;

  // 5. Other seed-marked entity records (portfolio register, etc.).
  removed.portfolioRecords = (await pool.query(
    `DELETE FROM entity_record WHERE deleted = false AND (data->>'seed') = 'true' AND entity <> 'DealOpportunity'`
  )).rowCount;

  // 6. Seed-provisioned recruit-app users and their memberships (never the
  //    protected seeded cast).
  const hasSeedCol = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'app_user' AND column_name = 'data_seed'`
  );
  if (Number(hasSeedCol.rows[0].n) > 0) {
    // A seed-provisioned user is one the seed stamped (data_seed = true) or a
    // legacy sample placeholder from the retired demoData.js naming scheme
    // (user-demo-*). Neither is ever created by hand in the console. The
    // protected seeded cast (config/seededUsers.js) is boot reference data, so
    // it is excluded here and keeps its memberships and sessions across a clean.
    const PROTECTED_USER =
      `(SELECT id FROM app_user WHERE lower(email) IN (SELECT lower(x) FROM unnest($1::text[]) x))`;
    const SEED_USER_WHERE = `(
      (data_seed = true OR id LIKE 'user-demo-%')
      AND lower(email) NOT IN (SELECT lower(x) FROM unnest($1::text[]) x)
    )`;
    removed.seedMemberships = (await pool.query(
      `DELETE FROM membership WHERE
         (user_id IN (SELECT id FROM app_user WHERE ${SEED_USER_WHERE})
          OR id LIKE 'mem-demo-%' OR id LIKE 'mem-finstreet-lead')
         AND user_id NOT IN ${PROTECTED_USER}`,
      [PROTECTED_EMAILS]
    )).rowCount;
    removed.authMembers = (await pool.query(
      `DELETE FROM auth_member WHERE "userId" IN (SELECT id FROM app_user WHERE ${SEED_USER_WHERE})
         AND "userId" NOT IN ${PROTECTED_USER}`,
      [PROTECTED_EMAILS]
    ).catch(() => ({ rowCount: 0 }))).rowCount;
    removed.authSessions = (await pool.query(
      `DELETE FROM session WHERE "userId" IN (SELECT id FROM app_user WHERE ${SEED_USER_WHERE})
         AND "userId" NOT IN ${PROTECTED_USER}`,
      [PROTECTED_EMAILS]
    ).catch(() => ({ rowCount: 0 }))).rowCount;
    removed.accessGrants = (await pool.query(
      `DELETE FROM access_grant WHERE user_id IN (SELECT id FROM app_user WHERE ${SEED_USER_WHERE})
         AND user_id NOT IN ${PROTECTED_USER}`,
      [PROTECTED_EMAILS]
    )).rowCount;
    removed.seedUsers = (await pool.query(
      `DELETE FROM app_user WHERE ${SEED_USER_WHERE}`,
      [PROTECTED_EMAILS]
    )).rowCount;
    await pool.query(
      `DELETE FROM account WHERE "userId" NOT IN (SELECT id FROM "user")`
    ).catch(() => {});
    await pool.query(`DELETE FROM "user" WHERE id NOT IN (SELECT id FROM app_user)`).catch(() => {});
  }

  // 7. Seed-authored themes.
  removed.seededThemes = (await pool.query(
    `DELETE FROM investment_theme WHERE source = 'mvp_seed'`
  ).catch(() => ({ rowCount: 0 }))).rowCount;

  // 8. Optionally, app configuration the boot seed created (off by default so
  //    the operational baseline survives a data clean).
  if (includeConfig) {
    await pool.query(
      `DELETE FROM pipeline_sla WHERE state IN (SELECT state FROM pipeline_sla)`
    ).catch(() => {});
  }

  const after = await inspectSeedData();
  return { removed, before, after };
}

export { isSeedOpportunityId };
export default cleanSeedData;
