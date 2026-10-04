import { pool } from './db.js';
import { writeAudit } from './audit.js';
import { addDocumentVersion } from './gate.js';
import { transition } from './pipeline.js';
import { applyRoute } from './workflows.js';
import { upsertTheme, getEffectiveTheme, getThresholds, upsertThresholds } from './themes.js';
import { setRelatedParty } from './relatedParty.js';
import { notify } from './notify.js';
import { upsertUser, upsertMembership } from './users.js';
import { deriveThemeForOrg } from './config/natureOfBusiness.js';
import { evaluateSelfScreen, relatedPartyAnswerFromData } from './config/selfScreen.js';
import {
  siriusTemplateModel,
} from './config/statementModel.js';
import { seedAuthTenants } from './authMigrate.js';
import crypto from 'node:crypto';
import { indexStrategyDocument, deriveStrategyProfile, publishStrategyProfile } from './strategy.js';
import { openThread, addMessage } from './qa.js';

// --- Entity strategy library (W4-02 / ENT-02) ------------------------------
//
// Seed one indexed strategy document per pilot entity so the alignment citation
// (W3-13) has real source passages to quote in the demo. The text mirrors the
// entity's approved theme, so a Technology/UAE target genuinely cites the
// Infinia strategy. Keyed by a stable id and skipped when already present.
const STRATEGY_FIXTURES = [
  {
    id: 'seed-strategy-infinia',
    org: INFINIA_ORG_ID,
    name: 'Infinia Technology Strategy 2026.txt',
    text: [
      'Infinia Technologies Limited investment strategy, 2026.',
      'Mandate: Infinia invests in technology platforms and digital businesses that build recurring revenue.',
      'Target sectors: software, SaaS, digital platforms, artificial intelligence and data infrastructure.',
      'Geography: the United Arab Emirates and the wider GCC, with selective international co-investment.',
      'We prioritise asset-light, capital-efficient models where Infinia can add distribution and scale.',
      'Every investment must demonstrate a clear path to EBITDA positive within three years and portfolio synergy.',
    ].join('\n'),
  },
  {
    id: 'seed-strategy-finstreet',
    org: FINSTREET_ORG_ID,
    name: 'Finstreet Financial Services Mandate 2026.txt',
    text: [
      'Finstreet Limited investment strategy, 2026.',
      'Mandate: Finstreet invests in financial services and adjacent fintech across the GCC.',
      'Target sectors: payments, lending, banking technology, insurance and wealth management.',
      'Geography: the United Arab Emirates and the wider GCC.',
      'We seek licensed or licensable models with a defensible regulatory position and recurring fee income.',
    ].join('\n'),
  },
];

async function ensureFixtureStrategyDocs() {
  let created = 0;
  for (const spec of STRATEGY_FIXTURES) {
    const existing = await pool.query('SELECT id FROM strategy_document WHERE id = $1', [spec.id]);
    if (existing.rows[0]) continue;
    const buffer = Buffer.from(spec.text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    await pool.query(
      `INSERT INTO strategy_document (id, org_id, original_name, mimetype, size, format, status, sha256, uploaded_by)
       VALUES ($1,$2,$3,'text/plain',$4,'.txt','stored',$5,'system@dealforge.local')`,
      [spec.id, spec.org, spec.name, buffer.length, sha256]
    );
    await indexStrategyDocument(spec.id, { buffer, actor: SYSTEM });
    created += 1;
  }
  // Publish an initial versioned strategy profile per pilot entity so the demo
  // screening record has a version in force (W4-03 / ENT-01). Idempotent: only
  // published when the entity has no published version yet.
  for (const spec of STRATEGY_FIXTURES) {
    const existing = await pool.query("SELECT id FROM strategy_profile WHERE org_id = $1 AND status = 'published'", [spec.org]);
    if (existing.rows[0]) continue;
    const profile = await deriveStrategyProfile(spec.org).catch(() => null);
    const sourceDocIds = (await pool.query("SELECT id FROM strategy_document WHERE org_id = $1 AND deleted = false AND status = 'indexed'", [spec.org])).rows.map((r) => r.id);
    await publishStrategyProfile(spec.org, { profile: profile || {}, summary: 'Seeded strategy profile (mvp)', sourceDocumentIds: sourceDocIds, actor: SYSTEM });
  }
  return created;
}

import {
  MVP_FIXTURES, MVP_PERSONAS, REQUIRED_DOCS, DOC_LABELS, SEED_PROVENANCE,
  INFINIA_ORG_ID, FINSTREET_ORG_ID, SIRIUS_ORG_ID, fullFields,
  greenfieldStatementModel, unbalancedStatementModel,
} from './config/mvpSeed.js';

// ---------------------------------------------------------------------------
// MVP sample-data loader (W1-12, REQ-SEED-01).
//
// Loads the deterministic fixtures in config/mvpSeed.js by walking the real
// domain APIs - transition(), applyRoute(), addDocumentVersion(),
// setRelatedParty(), notify() - so every sample record carries the audit trail
// and pipeline history a person would have produced, and the memo/scorecard
// read exactly the data they read for real records.
//
// Everything written here is tagged so cleanup (seedCleanup.js / W1-11) can
// remove it: fixtures are seed:true records with 'seed-' ids, provisioned
// personas carry data_seed = true, and the run leaves a seed_manifest audit
// event.
//
// Idempotent: each fixture and persona is keyed by a stable id and skipped if
// it already exists, so a re-run (or a boot after a partial run) converges.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';
const SYSTEM = { id: 'system', email: 'system@dealforge.local' };

// The fixture key that carries a deliberately unbalanced three-statement model
// so the advisory FIN-02 flag is demonstrable in the demo (an in-review
// submission an analyst would see flagged). Every other fixture with a
// financials pack carries the complete, balanced model; fixtures that have not
// uploaded financials carry none, so the gate honestly reports 'not attached'.
const UNBALANCED_MODEL_FIXTURE = 'seed-in-screening';

// Pick the three-statement model a fixture carries (FIN-02). New ventures get
// the projections-only balanced variant (audited actuals blank, FIN-01); the
// designated fixture gets the unbalanced variant; the rest get the canonical
// balanced Sirius template.
function statementModelForFixture(spec) {
  if (spec.key === UNBALANCED_MODEL_FIXTURE) return unbalancedStatementModel();
  if (spec.fields?.opportunity_type === 'greenfield') return greenfieldStatementModel();
  return siriusTemplateModel();
}

async function buildActorByEmail(email, orgId) {
  const { rows: users } = await pool.query('SELECT * FROM app_user WHERE lower(email) = lower($1)', [email]);
  const user = users[0];
  if (!user) return null;
  const { rows: memberships } = await pool.query(
    'SELECT m.*, o.name AS org_name, o.path AS org_path FROM membership m JOIN organization o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY m.is_primary DESC, o.level',
    [user.id]
  );
  const membership = memberships.find((m) => m.org_id === orgId) || memberships[0];
  if (!membership) return null;
  const descendants = (await pool.query(
    "SELECT id FROM organization WHERE id = $1 OR path LIKE ((SELECT path FROM organization WHERE id = $1) || '/%')",
    [membership.org_id]
  )).rows.map((r) => r.id);
  const granted = (await pool.query('SELECT org_id FROM access_grant WHERE user_id = $1', [user.id])).rows.map((r) => r.org_id);
  return {
    id: user.id, email: user.email, full_name: user.full_name,
    org_id: membership.org_id, org_name: membership.org_name,
    roles: membership.roles || [], groups: membership.groups || [],
    can_sign: membership.can_sign, membership,
    memberships, descendant_ids: descendants, granted_org_ids: granted,
  };
}

// Provision the MVP-only personas on top of the shipped cast. Stamped
// data_seed = true so cleanup removes them and keeps the shipped cast.
async function provisionPersonas() {
  let created = 0;
  for (const persona of MVP_PERSONAS) {
    await upsertUser({
      id: persona.id, email: persona.email, full_name: persona.full_name,
      phone: persona.phone || null, seeded: true,
    });
    const { rows } = await pool.query('SELECT id FROM app_user WHERE lower(email) = lower($1)', [persona.email]);
    const userId = rows[0].id;
    for (const m of persona.memberships || []) {
      await upsertMembership({
        id: m.id, user_id: userId, org_id: m.org_id, roles: m.roles || [],
        groups: m.groups || [], can_sign: !!m.can_sign, is_primary: !!m.is_primary,
      });
    }
    created += 1;
  }
  return created;
}

// Ensure every org a fixture targets has a theme, deriving one from its
// Set an entity WACC for every fixture org (W2-05 / FIN-05) so the demo shows
// a Sirius-set cost of capital per entity rather than the bare system default.
// Idempotent: it writes the same values on every boot.
async function ensureFixtureWacc() {
  const orgIds = [...new Set(MVP_FIXTURES.map((f) => f.org))];
  const byOrg = { [INFINIA_ORG_ID]: 9, [FINSTREET_ORG_ID]: 8.5, [SIRIUS_ORG_ID]: 7.5 };
  let n = 0;
  for (const orgId of orgIds) {
    const { rows: org } = await pool.query('SELECT id FROM organization WHERE id = $1', [orgId]);
    if (!org[0]) continue;
    // Merge onto any existing per-entity thresholds so a re-seed never resets
    // other operator-configured mandate values.
    const existing = await getThresholds(orgId);
    await upsertThresholds({ ...existing, org_id: orgId, wacc_pct: byOrg[orgId] ?? existing.wacc_pct }, { actor: SYSTEM });
    n += 1;
  }
  return n;
}

// Ensure a demonstrable Q&A pair (W6-04 / AUD-03): one shared thread and one
// internal thread on the related-party fixture, so the demo can show that a
// subsidiary role sees the shared thread but never the internal note while the
// group investment layer sees both. Built through openThread()/addMessage() so
// visibility, participant and audit behaviour is identical to a real thread.
// Idempotent by stable thread subject.
async function ensureFixtureThreads() {
  let created = 0;
  const anchorId = 'seed-related-party';
  const anchor = await pool.query(
    "SELECT id, owner_org_id FROM entity_record WHERE entity = 'DealOpportunity' AND id = $1 AND deleted = false",
    [anchorId]
  );
  if (!anchor.rows[0]) return created;
  const ownerOrgId = anchor.rows[0].owner_org_id;
  const groupLead = await buildActorByEmail('deal.lead@sirius.local', SIRIUS_ORG_ID);
  const cio = (await buildActorByEmail('cio@sirius.local', SIRIUS_ORG_ID)) || groupLead;
  const subLead = await buildActorByEmail('deal.lead@infinia.local', ownerOrgId);
  if (!groupLead || !subLead) return created;
  const existing = await pool.query(
    'SELECT subject FROM qa_thread WHERE opportunity_id = $1', [anchorId]
  );
  const have = new Set(existing.rows.map((r) => r.subject));
  // A shared thread: the subsidiary asks, the group lead answers.
  const shared = {
    subject: 'Clarify the custody licensing timeline',
    visibility: 'shared',
    body: 'Please share the expected DFSA licence timeline and any interim custody arrangement.',
    replyBody: 'Application filed; an interim arrangement with the affiliate custodian is documented.',
    raiser: subLead,
    responder: groupLead,
    participants: ['deal.lead@sirius.local'],
  };
  // An internal thread: group-only, and must never surface to the subsidiary.
  const internal = {
    subject: 'INTERNAL: negotiating position on the affiliate referral',
    visibility: 'internal',
    body: 'Keep the affiliate-referral sensitivity and our walk-away price internal to the group team only.',
    replyBody: 'Agreed - do not surface the walk-away price to the subsidiary submitter.',
    raiser: groupLead,
    responder: cio,
    participants: ['cio@sirius.local'],
  };
  for (const t of [shared, internal]) {
    if (have.has(t.subject)) continue;
    const thread = await openThread(
      anchorId,
      { subject: t.subject, body: t.body, visibility: t.visibility, participants: t.participants },
      { actor: t.raiser }
    );
    await addMessage(thread.id, { body: t.replyBody, visibility: t.visibility }, { actor: t.responder });
    created += 1;
  }
  return created;
}

// Ensure every org a fixture targets has a theme, deriving one from its
// registered nature of business when the boot seed has not already created one.
// Only themes this loader writes carry source = 'mvp_seed'.
async function ensureFixtureThemes() {
  const orgIds = [...new Set(MVP_FIXTURES.map((f) => f.org))];
  let created = 0;
  for (const orgId of orgIds) {
    const existing = await getEffectiveTheme(orgId);
    if (existing) continue;
    const { rows } = await pool.query(
      'SELECT id, name, geography, principal_activities FROM organization WHERE id = $1', [orgId]
    );
    const org = rows[0];
    if (!org) continue;
    const theme = deriveThemeForOrg(org);
    if (!theme) continue;
    await upsertTheme({ ...theme, status: 'approved', source: SEED_PROVENANCE }, { actor: SYSTEM });
    created += 1;
  }
  return created;
}

async function attachDocuments(opportunityId, orgId, keys, key) {
  for (const requirementKey of keys || []) {
    await addDocumentVersion({
      opportunityId,
      ownerOrgId: orgId,
      requirementKey,
      file: {
        buffer: Buffer.from(
          'DealForge MVP sample document\n' + (DOC_LABELS[requirementKey] || requirementKey) + '\n' + key + '\n',
          'utf8'
        ),
        originalname: key + '-' + requirementKey + '.pdf',
        mimetype: 'application/pdf',
      },
      actor: SYSTEM,
    });
  }
}

async function seedOne(spec, owners) {
  const id = spec.key.startsWith('seed-') ? spec.key : 'seed-' + spec.key;
  const existing = await pool.query(
    'SELECT id FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, id]
  );
  if (existing.rows[0]) return { key: spec.key, id, skipped: true, state: spec.state };

  const owner = owners.get(spec.ownerEmail);
  if (!owner) throw new Error('Sample fixture ' + spec.key + ' names an unknown owner ' + spec.ownerEmail);

  // Always insert at draft; every later state is reached by walking the real
  // audited transition API below, so pipeline history is genuine for every
  // fixture (never a direct state write).
  const theme = await getEffectiveTheme(spec.org).catch(() => null);
  const selfScreen = evaluateSelfScreen(
    { ...spec.fields, related_party: relatedPartyAnswerFromData(spec.fields) },
    { theme }
  );
  const data = {
    ...fullFields(spec.fields),
    status: 'draft',
    owner_email: spec.ownerEmail,
    seed: true,
    seed_profile: SEED_PROVENANCE,
    seed_note: spec.note || null,
    self_screen_stop: selfScreen.blocked,
    self_screen: { decision: selfScreen.decision, stops: selfScreen.stops, flags: selfScreen.flags },
    self_screen_at: selfScreen.evaluated_at,
    status_entered_at: new Date().toISOString(),
    submitted_at: null,
    submitted_by: null,
  };
  await pool.query(
    "INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by) VALUES ($1,'DealOpportunity',$2,$3,$4,$4)",
    [id, spec.org, JSON.stringify(data), owner.email]
  );
  await writeAudit({
    entity: OPPORTUNITY_ENTITY, entityId: id, action: 'create', actor: owner, orgId: spec.org,
    after: { opportunity_name: data.opportunity_name, seed: true, state: 'draft' },
  });

  await attachDocuments(id, spec.org, spec.documents, spec.key);

  // Seed the three-statement model summary (FIN-02) when the fixture carries
  // the mandatory financials pack, so the gate, the form and the memo read a
  // checked model exactly as they would after a real upload. Stored as parsed
  // data on the record; it is not a separate document requirement.
  if ((spec.documents || []).includes('financials')) {
    const model = statementModelForFixture(spec);
    await pool.query(
      "UPDATE entity_record SET data = jsonb_set(data, '{statement_model}', $2::jsonb), updated_date = now() WHERE entity = 'DealOpportunity' AND id = $1",
      [id, JSON.stringify(model)]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: id, action: 'statement_model_parsed', actor: SYSTEM, orgId: spec.org,
      after: {
        format: model.format, template: model.template,
        balanced: model.balance?.balanced, imbalances: model.balance?.imbalances?.length || 0,
        missing_statements: model.missing_statements, seed: true,
      },
      comment: 'Seeded three-statement model (FIN-02)',
    });
  }

  // Walk the pipeline through the real audited transition API so history and
  // SLA age are genuine, never a direct state write.
  const reviewer = await buildActorByEmail('deal.lead@sirius.local', SIRIUS_ORG_ID);
  const approver = await buildActorByEmail('ic.member@sirius.local', SIRIUS_ORG_ID);
  if (spec.state !== 'draft') {
    // The submit leg is a producing-layer write; record it as such, matching
    // the gate's submit route (submitted_at/by on the record).
    await pool.query(
      "UPDATE entity_record SET data = jsonb_set(jsonb_set(data, '{submitted_at}', to_jsonb($2::text)), '{submitted_by}', to_jsonb($3::text)), updated_date = now() WHERE entity = 'DealOpportunity' AND id = $1",
      [id, new Date().toISOString(), spec.ownerEmail]
    );
    await transition(id, 'submission', { actor: owner, comment: 'Submitted for screening.' });
  }
  if (['screening', 'refinement', 'declined'].includes(spec.state)) {
    await transition(id, 'screening', { actor: reviewer, comment: 'Passed the initial screen.' });
  }
  if (['refinement', 'declined'].includes(spec.state)) {
    await transition(id, 'refinement', { actor: reviewer, comment: 'Moved into investment-team refinement.' });
  }
  if (spec.state === 'declined') {
    await transition(id, 'declined', { actor: approver, comment: 'Return hurdle not met on a risk-adjusted basis.' });
  }
  if (spec.state === 'returned') {
    await transition(id, 'returned', { actor: reviewer, comment: 'Clarify the synergy case and refresh the financials.' });
  }

  if (spec.route) {
    await applyRoute(id, { actor: reviewer, comment: 'Standard org workflow applied for the sample set.' });
  }
  if (spec.relatedParty) {
    await setRelatedParty(id, {
      flagged: true,
      disclosure: data.related_party_disclosure,
      independent_reviewer_email: 'reviewer@sirius.local',
      arm_length_basis: data.arm_length_basis,
      arm_length_note: data.arm_length_note,
    }, { actor: reviewer });
  }

  await notify({
    to: spec.ownerEmail,
    kind: 'seed_fixture',
    subject: 'Sample data: ' + data.opportunity_name,
    body: 'This opportunity was loaded from the MVP sample set (' + spec.state + ').',
    entity: OPPORTUNITY_ENTITY, entityId: id, orgId: spec.org, actor: SYSTEM,
  });

  return { key: spec.key, id, skipped: false, state: spec.state, persona: spec.persona };
}

// Load the MVP fixtures. Returns a summary; idempotent by stable id.
export async function seedMvpData({ force = false } = {}) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM entity_record WHERE entity = 'DealOpportunity' AND deleted = false AND (data->>'seed') = 'true'"
  );
  if (rows[0].n > 0 && !force) {
    // Sample records already exist, but newer fixtures (e.g. strategy documents
    // added in W4-02) still need to be ensured idempotently on every boot.
    const strategyDocs = await ensureFixtureStrategyDocs().catch(() => []);
    const qaThreads = await ensureFixtureThreads().catch((err) => {
      console.error('[mvpSeed] Q&A fixture seed failed:', err.message);
      return 0;
    });
    return { skipped: true, count: rows[0].n, strategy_documents: strategyDocs, qa_threads: qaThreads };
  }

  const themes = await ensureFixtureThemes();
  const waccOrgs = await ensureFixtureWacc();
  const strategyDocs = await ensureFixtureStrategyDocs();
  const personas = await provisionPersonas();
  // Mirror the persona users + memberships into Better Auth so they can sign
  // in with the default password like the rest of the seeded cast.
  await seedAuthTenants().catch((err) => {
    console.error('[mvpSeed] Better Auth mirror failed:', err.message);
  });

  const owners = new Map();
  for (const spec of MVP_FIXTURES) {
    if (!owners.has(spec.ownerEmail)) {
      owners.set(spec.ownerEmail, await buildActorByEmail(spec.ownerEmail, spec.org));
    }
  }

  const results = [];
  for (const spec of MVP_FIXTURES) {
    results.push(await seedOne(spec, owners));
  }
  const qaThreads = await ensureFixtureThreads().catch((err) => {
    console.error('[mvpSeed] Q&A fixture seed failed:', err.message);
    return 0;
  });

  const summary = {
    skipped: false,
    fixtures: results.length,
    created: results.filter((r) => !r.skipped).length,
    skippedExisting: results.filter((r) => r.skipped).length,
    themes,
    wacc_orgs: waccOrgs,
    strategy_documents: strategyDocs,
    qa_threads: qaThreads,
    personas,
    results,
  };
  await writeAudit({
    entity: 'seed', action: 'mvp_seed', actor: SYSTEM,
    after: { profile: SEED_PROVENANCE, fixtures: summary.fixtures, created: summary.created, personas },
    comment: 'Loaded the MVP sample-data set (W1-12)',
  });
  return summary;
}

export const SEED_DOCUMENT_KEYS = REQUIRED_DOCS;
export { INFINIA_ORG_ID, FINSTREET_ORG_ID };
export default seedMvpData;
