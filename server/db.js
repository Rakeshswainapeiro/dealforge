import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL || 'postgres://dealforge:dealforge@localhost:5432/dealforge';

export const pool = new Pool({ connectionString });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Apply the bundled Better Auth DDL (server/migrations/0001_better_auth.sql).
// Idempotent: every statement is CREATE ... IF NOT EXISTS, so this is safe on
// every boot and on databases that already have the tables.
export async function applyBetterAuthSchema() {
  const sqlPath = path.join(__dirname, 'migrations', '0001_better_auth.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL,
  original_name TEXT,
  mimetype      TEXT,
  size          BIGINT,
  storage       TEXT DEFAULT 'local',
  object_key    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage TEXT DEFAULT 'local';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS object_key TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE TABLE IF NOT EXISTS llm_logs (
  id         SERIAL PRIMARY KEY,
  model      TEXT,
  prompt     TEXT,
  response   TEXT,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI governance columns (W9-01 / NFR-03): who made the call, which provider
-- served it, and whether the payload was redacted before it was stored.
ALTER TABLE llm_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE llm_logs ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE llm_logs ADD COLUMN IF NOT EXISTS redacted    BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS email_logs (
  id         SERIAL PRIMARY KEY,
  to_email   TEXT,
  from_email TEXT,
  subject    TEXT,
  body       TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id         SERIAL PRIMARY KEY,
  to_number  TEXT,
  message    TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_logs (
  id         SERIAL PRIMARY KEY,
  prompt     TEXT,
  url        TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// ---------------------------------------------------------------------------
// M1 — platform foundation schema (org tree, users, memberships, audit, and
// the generic record store behind the `api.entities.*` façade).
// ---------------------------------------------------------------------------
const MVP_SCHEMA = `
CREATE TABLE IF NOT EXISTS organization (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'subsidiary',
  parent_id            TEXT REFERENCES organization(id) ON DELETE SET NULL,
  path                 TEXT NOT NULL DEFAULT '',
  level                INTEGER NOT NULL DEFAULT 0,
  ownership_pct        NUMERIC(7,4),
  geography            TEXT,
  principal_activities TEXT,
  source               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_parent_idx ON organization(parent_id);
CREATE INDEX IF NOT EXISTS organization_path_idx ON organization(path text_pattern_ops);

CREATE TABLE IF NOT EXISTS app_user (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  roles      TEXT[] NOT NULL DEFAULT '{}',
  groups     TEXT[] NOT NULL DEFAULT '{}',
  can_sign   BOOLEAN NOT NULL DEFAULT false,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_user_idx ON membership(user_id);
CREATE INDEX IF NOT EXISTS membership_org_idx ON membership(org_id);

-- Explicit cross-org access grants (REQ-ORG-02: reads/writes scoped to own org
-- and descendants unless a grant exists).
CREATE TABLE IF NOT EXISTS access_grant (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  org_id      TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'read',
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, scope)
);

-- Immutable audit trail (REQ-RBAC-04 / REQ-FLOW-01). UPDATE/DELETE are blocked
-- by a trigger so events can never be rewritten.
CREATE TABLE IF NOT EXISTS audit_event (
  id          BIGSERIAL PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  actor_id    TEXT,
  actor_email TEXT,
  org_id      TEXT,
  role        TEXT,
  before      JSONB,
  after       JSONB,
  comment     TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_event(entity, entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_event(org_id, ts DESC);

-- Generic record store so every existing api.entities.<Name> call keeps working
-- while Postgres becomes the source of truth (E1.1 / REQ-ARCH-01..02).
CREATE TABLE IF NOT EXISTS entity_record (
  id           TEXT PRIMARY KEY,
  entity       TEXT NOT NULL,
  owner_org_id TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_by   TEXT,
  deleted      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS entity_record_entity_idx ON entity_record(entity) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS entity_record_org_idx ON entity_record(owner_org_id) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS entity_record_data_idx ON entity_record USING gin (data jsonb_path_ops);

CREATE OR REPLACE FUNCTION audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
`;

// ---------------------------------------------------------------------------
// M2 — capture + document gate schema (E4.1/E4.2/E4.4, REQ-DOCGATE-01).
//
// document_requirement is the configurable minimum-document set (business plan,
// historicals + projections, ownership/cap table) — config, never hard-coded in
// the routes. submission_document keeps a versioned record per upload (uploader,
// time, hash) so evidence is reproducible.
// ---------------------------------------------------------------------------
const GATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS document_requirement (
  id          TEXT PRIMARY KEY,
  org_id      TEXT,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  required    BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS document_requirement_scope_idx
  ON document_requirement(COALESCE(org_id, '*'), key);
CREATE INDEX IF NOT EXISTS document_requirement_org_idx ON document_requirement(org_id);

CREATE TABLE IF NOT EXISTS submission_document (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL,
  owner_org_id    TEXT NOT NULL,
  requirement_key TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  object_key      TEXT,
  filename        TEXT,
  original_name   TEXT,
  mimetype        TEXT,
  size            BIGINT,
  sha256          TEXT,
  storage         TEXT NOT NULL DEFAULT 'local',
  uploaded_by     TEXT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current      BOOLEAN NOT NULL DEFAULT true,
  deleted         BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS submission_document_opp_idx
  ON submission_document(opportunity_id, requirement_key) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS submission_document_org_idx
  ON submission_document(owner_org_id) WHERE deleted = false;

-- Upload virus-scan verdict (W5-02 / DOC-02). Every upload records the engine
-- used, the verdict (clean / suspicious / infected) and the signatures that
-- tripped, so a reviewer can see that a document was scanned and by what.
ALTER TABLE submission_document ADD COLUMN IF NOT EXISTS scan_verdict TEXT;
ALTER TABLE submission_document ADD COLUMN IF NOT EXISTS scan_engine TEXT;
ALTER TABLE submission_document ADD COLUMN IF NOT EXISTS scan_detail JSONB;
ALTER TABLE submission_document ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
`;

// ---------------------------------------------------------------------------
// M3 — investment themes, mandate thresholds and alignment (E5, REQ-THEME-01).
//
// One approved theme per org defines sector/keyword/geography/size fit. Mandate
// thresholds (AED 10m floor, return hurdles) are configurable per REQ-RULE-10,
// never hard-coded, and surface as non-blocking signals at screening.
// ---------------------------------------------------------------------------
const THEME_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS investment_theme (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  sector       TEXT,
  keywords     TEXT[] NOT NULL DEFAULT '{}',
  geographies  TEXT[] NOT NULL DEFAULT '{}',
  opportunity_types TEXT[] NOT NULL DEFAULT '{}',
  description  TEXT,
  min_aed      NUMERIC,
  max_aed      NUMERIC,
  status       TEXT NOT NULL DEFAULT 'draft',
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  updated_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS investment_theme_org_idx ON investment_theme(org_id);

CREATE TABLE IF NOT EXISTS mandate_threshold (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT,
  floor_aed           NUMERIC NOT NULL DEFAULT 10,
  equity_irr_min      NUMERIC NOT NULL DEFAULT 20,
  greenfield_irr_min  NUMERIC NOT NULL DEFAULT 25,
  roic_wacc_spread    NUMERIC NOT NULL DEFAULT 5,
  payback_max_years   NUMERIC NOT NULL DEFAULT 3.5,
  concentration_max_pct NUMERIC NOT NULL DEFAULT 35,
  leverage_max        NUMERIC NOT NULL DEFAULT 3,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mandate_threshold_scope_idx ON mandate_threshold(COALESCE(org_id, '*'));
`;

// ---------------------------------------------------------------------------
// M3 — pipeline state machine, SLA targets and transition history (E6).
//
// Canonical route: submission -> screening -> refinement -> approval, plus the
// returned / declined branches (REQ-PIPE-01). SLA targets per state drive the
// board's age and breach flags (REQ-GATE-06, partial).
// ---------------------------------------------------------------------------
const PIPELINE_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS pipeline_sla (
  state      TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  days       INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pipeline_transition (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  owner_org_id   TEXT NOT NULL,
  from_state     TEXT,
  to_state       TEXT NOT NULL,
  actor_email    TEXT,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_transition_opp_idx ON pipeline_transition(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_transition_org_idx ON pipeline_transition(owner_org_id, to_state);
`;

// ---------------------------------------------------------------------------
// M4 — submission route: org-scoped reusable workflows, applied routes with
// participants and signatures (E7 / REQ-WF-01..04, 06..08).
//
// A workflow is a named, ordered set of stages; each stage names an action
// (fill/review/sign/approve), the roles that may act, required fields and
// whether the stage needs a captured signature. Applying a workflow to a
// submission snapshots the stages and resolves participants so the signature
// map is stable even if the template changes later.
// ---------------------------------------------------------------------------
const WORKFLOW_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS workflow (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_org_idx ON workflow(org_id, status);

CREATE TABLE IF NOT EXISTS workflow_stage (
  id                 TEXT PRIMARY KEY,
  workflow_id        TEXT NOT NULL,
  stage_key          TEXT NOT NULL,
  name               TEXT NOT NULL,
  action             TEXT NOT NULL,
  roles              TEXT[] NOT NULL DEFAULT '{}',
  required_fields    TEXT[] NOT NULL DEFAULT '{}',
  requires_signature BOOLEAN NOT NULL DEFAULT false,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, stage_key)
);
CREATE INDEX IF NOT EXISTS workflow_stage_wf_idx ON workflow_stage(workflow_id, sort_order);

CREATE TABLE IF NOT EXISTS submission_route (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  owner_org_id   TEXT NOT NULL,
  workflow_id    TEXT,
  workflow_name  TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  current_stage  TEXT,
  applied_by     TEXT,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS submission_route_opp_idx ON submission_route(opportunity_id);

CREATE TABLE IF NOT EXISTS route_stage (
  id                 TEXT PRIMARY KEY,
  route_id           TEXT NOT NULL,
  stage_key          TEXT NOT NULL,
  name               TEXT NOT NULL,
  action             TEXT NOT NULL,
  roles              TEXT[] NOT NULL DEFAULT '{}',
  required_fields    TEXT[] NOT NULL DEFAULT '{}',
  requires_signature BOOLEAN NOT NULL DEFAULT false,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending',
  acted_by           TEXT,
  acted_at           TIMESTAMPTZ,
  comment            TEXT,
  UNIQUE (route_id, stage_key)
);
CREATE INDEX IF NOT EXISTS route_stage_route_idx ON route_stage(route_id, sort_order);

CREATE TABLE IF NOT EXISTS route_participant (
  id            TEXT PRIMARY KEY,
  route_id      TEXT NOT NULL,
  stage_key     TEXT NOT NULL,
  user_id       TEXT,
  user_email    TEXT,
  full_name     TEXT,
  role          TEXT,
  action        TEXT NOT NULL,
  is_signer     BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  signed_at     TIMESTAMPTZ,
  UNIQUE (route_id, stage_key, user_email)
);
CREATE INDEX IF NOT EXISTS route_participant_route_idx ON route_participant(route_id, sort_order);

CREATE TABLE IF NOT EXISTS workflow_event (
  id             TEXT PRIMARY KEY,
  route_id       TEXT,
  opportunity_id TEXT NOT NULL,
  owner_org_id   TEXT NOT NULL,
  stage_key      TEXT,
  action         TEXT NOT NULL,
  actor_email    TEXT,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_event_opp_idx ON workflow_event(opportunity_id, created_at DESC);
`;

// ---------------------------------------------------------------------------
// M4 — Q&A / clarification loop replacing email between the layers (E8 /
// REQ-QA-01, REQ-FLOW-02). Threads belong to an opportunity, are visible only
// to their participants and the owning org, and every event is audited.
// ---------------------------------------------------------------------------
const QA_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS qa_thread (
  id                TEXT PRIMARY KEY,
  opportunity_id    TEXT NOT NULL,
  owner_org_id      TEXT NOT NULL,
  subject           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  requires_response BOOLEAN NOT NULL DEFAULT false,
  response_received BOOLEAN NOT NULL DEFAULT false,
  raised_by         TEXT,
  raised_by_name    TEXT,
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by         TEXT,
  closed_at         TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_thread_opp_idx ON qa_thread(opportunity_id, status);
CREATE INDEX IF NOT EXISTS qa_thread_org_idx ON qa_thread(owner_org_id, status);

CREATE TABLE IF NOT EXISTS qa_message (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL,
  author_email TEXT,
  author_name  TEXT,
  author_id    TEXT,
  body         TEXT NOT NULL,
  is_response  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_message_thread_idx ON qa_message(thread_id, created_at);

CREATE TABLE IF NOT EXISTS qa_participant (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  user_email  TEXT NOT NULL,
  role        TEXT,
  notified_at TIMESTAMPTZ,
  UNIQUE (thread_id, user_email)
);
CREATE INDEX IF NOT EXISTS qa_participant_thread_idx ON qa_participant(thread_id);

-- W6-04 / BRD AUD-03: internal vs shared comment visibility. A thread (and each
-- message) carries a visibility so the group investment layer can keep a note
-- internal to itself; the value is filtered out of every read for a subsidiary
-- role. Existing rows default to shared, so behaviour is unchanged until a
-- comment is deliberately marked internal.
ALTER TABLE qa_thread ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE qa_message ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE qa_message ADD COLUMN IF NOT EXISTS document_id TEXT;

-- External evidence with provenance (BRD v2 INTG-07, INTG-12): every value
-- from a connected tool or desk research, with its source, time, method and
-- confidence. L3+ / AI values wait for a person to confirm them.
CREATE TABLE IF NOT EXISTS evidence_item (
  id            TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  owner_org_id  TEXT NOT NULL,
  field         TEXT NOT NULL,
  value         JSONB NOT NULL,
  source        TEXT NOT NULL,
  source_ref    TEXT,
  method        TEXT NOT NULL DEFAULT 'manual',
  confidence    NUMERIC,
  maturity      TEXT NOT NULL DEFAULT 'L1',
  retrieved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by   TEXT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'confirmed',
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT
);
CREATE INDEX IF NOT EXISTS evidence_item_opp_idx ON evidence_item(opportunity_id, field);

-- Tool entitlement register (ACC-02) and launches (usage evidence, ACC-03).
CREATE TABLE IF NOT EXISTS tool_entitlement (
  id              TEXT PRIMARY KEY,
  user_email      TEXT NOT NULL,
  connector_key   TEXT NOT NULL,
  seat_type       TEXT NOT NULL DEFAULT 'named',
  granted_by      TEXT,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_launched_at TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_entitlement_active_idx ON tool_entitlement(lower(user_email), connector_key) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS tool_launch (
  id             TEXT PRIMARY KEY,
  user_email     TEXT NOT NULL,
  connector_key  TEXT NOT NULL,
  opportunity_id TEXT,
  entitled       BOOLEAN NOT NULL DEFAULT false,
  launched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BRD v2 WF-04 / WF-01: every question has a status (open / answered /
-- closed), a due date and an owner. 'kind' separates a plain clarification
-- from the formal information request that moves the opportunity to
-- Information Requested and back.
ALTER TABLE qa_thread ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'question';
ALTER TABLE qa_thread ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE qa_thread ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE qa_thread ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;
ALTER TABLE qa_thread ADD COLUMN IF NOT EXISTS answered_by TEXT;
CREATE INDEX IF NOT EXISTS qa_thread_kind_idx ON qa_thread(opportunity_id, kind, status);
`;

// ---------------------------------------------------------------------------
// M4 — in-app notifications sink. M5 (E9.4) adds delivery channels; the row
// here is the durable record that a participant was told something.
// ---------------------------------------------------------------------------
const NOTIFY_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS notification (
  id              TEXT PRIMARY KEY,
  recipient_email TEXT,
  kind            TEXT NOT NULL,
  subject         TEXT,
  body            TEXT,
  entity          TEXT,
  entity_id       TEXT,
  org_id          TEXT,
  actor_email     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_recipient_idx ON notification(recipient_email, created_at DESC);
`;

// ---------------------------------------------------------------------------
// M5 — approval path + privacy hardening (E9, E2 / REQ-APPR-01, REQ-RPT-01,
// REQ-FLOW-02).
//
// notification gains delivery-channel columns so email/SMS attempts are part of
// the durable record (E9.4). related_party_review stores the affiliate flag, its
// detection basis and the independent reviewer assignment (E9.5, flag only).
// workflow_event gains the decision verb so Approve/Return rationale is queryable.
// ---------------------------------------------------------------------------
const M5_SCHEMA = String.raw`
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS phone TEXT;

-- Seed provenance (REQ-SEED-02 / W1-11). True only for users the seed
-- provisions (the shipped cast and the sample-data personas); cleanup removes
-- seed-provisioned users and leaves everyone created through the admin console.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS data_seed BOOLEAN NOT NULL DEFAULT false;

-- Theme provenance. 'nature_of_business_map' for boot-derived mandates,
-- 'mvp_seed' for themes the sample-data profile writes, NULL for hand-authored
-- or operator-edited themes. Cleanup only ever removes 'mvp_seed' themes.
ALTER TABLE investment_theme ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE notification ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'in_app';
ALTER TABLE notification ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS provider_detail TEXT;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ;

ALTER TABLE workflow_event ADD COLUMN IF NOT EXISTS decision TEXT;
-- Reason codes on decisions (W6-01 / WF-05). The code from the maintained
-- catalogue plus the optional free-text detail, so declines are comparable.
ALTER TABLE workflow_event ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE workflow_event ADD COLUMN IF NOT EXISTS reason_text TEXT;
ALTER TABLE pipeline_transition ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE pipeline_transition ADD COLUMN IF NOT EXISTS reason_text TEXT;
ALTER TABLE workflow_stage ADD COLUMN IF NOT EXISTS requires_rationale BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE route_stage ADD COLUMN IF NOT EXISTS requires_rationale BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE route_stage ADD COLUMN IF NOT EXISTS decision TEXT;
ALTER TABLE route_stage ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE route_stage ADD COLUMN IF NOT EXISTS reason_text TEXT;

-- Entity-level cost of capital (W2-05 / FIN-05). Sirius sets WACC once per
-- entity; every opportunity inherits it unless a preparer overrides with a
-- reason. NULL means "use the shipped default" so existing rows are untouched.
ALTER TABLE mandate_threshold ADD COLUMN IF NOT EXISTS wacc_pct NUMERIC;

CREATE TABLE IF NOT EXISTS related_party_review (
  id                         TEXT PRIMARY KEY,
  opportunity_id             TEXT NOT NULL UNIQUE,
  owner_org_id               TEXT NOT NULL,
  flagged                    BOOLEAN NOT NULL DEFAULT false,
  detection_basis            TEXT,
  sourcing_channel           TEXT,
  affiliate_org_id           TEXT,
  independent_reviewer_email TEXT,
  independent_reviewer_name  TEXT,
  disclosure                 TEXT,
  set_by                     TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS related_party_org_idx ON related_party_review(owner_org_id, flagged);

-- Related-party overlay enforcement (W6-03 / BRD WF-06). A flagged deal must
-- show an arm's-length basis and evidence, name any conflicted users, and carry
-- an independent, non-conflicted sign-off before the Gate-1 Screening Decision.
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS arm_length_basis TEXT;
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS arm_length_note TEXT;
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS conflicted_users JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS overlay_version TEXT;
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS independent_signed_off_by TEXT;
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS independent_signed_off_at TIMESTAMPTZ;
ALTER TABLE related_party_review ADD COLUMN IF NOT EXISTS signoff_note TEXT;

-- Duplicate-detection review decisions (W1-10 / INT-12). One row per
-- (opportunity, match) pair records whether the Investment Team linked the two
-- as the same target or dismissed the warning, plus who decided and why. The
-- unique pair key makes the decision idempotent.
CREATE TABLE IF NOT EXISTS duplicate_review (
  id                   TEXT PRIMARY KEY,
  opportunity_id       TEXT NOT NULL,
  match_opportunity_id TEXT NOT NULL,
  status               TEXT NOT NULL,
  reason               TEXT,
  reviewed_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, match_opportunity_id)
);
CREATE INDEX IF NOT EXISTS duplicate_review_opp_idx ON duplicate_review(opportunity_id, status);
`;

// ---------------------------------------------------------------------------
// M6 — entity & strategy library (W4-02/W4-03, BRD ENT-01/ENT-02).
//
// strategy_document holds every strategy artefact uploaded against an entity,
// with the extracted passages cached so the alignment engine can cite a source
// passage without re-reading the file. strategy_profile is the versioned,
// structured summary derived from those documents; the published version is
// what a screening records.
// ---------------------------------------------------------------------------
const STRATEGY_SCHEMA = String.raw`;
CREATE TABLE IF NOT EXISTS strategy_document (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  filename      TEXT,
  original_name TEXT NOT NULL,
  mimetype      TEXT,
  size          BIGINT,
  object_key    TEXT,
  sha256        TEXT,
  format        TEXT,
  status        TEXT NOT NULL DEFAULT 'stored',
  index_reason  TEXT,
  char_count    INTEGER NOT NULL DEFAULT 0,
  passage_count INTEGER NOT NULL DEFAULT 0,
  passages      JSONB NOT NULL DEFAULT '[]'::jsonb,
  index_version TEXT,
  uploaded_by   TEXT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_at    TIMESTAMPTZ,
  deleted       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS strategy_document_org_idx ON strategy_document(org_id) WHERE deleted = false;

CREATE TABLE IF NOT EXISTS strategy_profile (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  version      INTEGER NOT NULL,
  profile      JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary      TEXT,
  status       TEXT NOT NULL DEFAULT 'published',
  source_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_by TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_profile_org_idx ON strategy_profile(org_id, version DESC);

-- The strategy profile version actually used for a screening (W4-03 / ENT-01).
-- One row per opportunity holds the latest snapshot; a version change is kept in
-- the audit trail via writeAudit, so the record is self-explanatory.
CREATE TABLE IF NOT EXISTS screening_record (
  id                     TEXT PRIMARY KEY,
  opportunity_id         TEXT NOT NULL UNIQUE,
  owner_org_id           TEXT NOT NULL,
  strategy_profile_id    TEXT,
  strategy_profile_version INTEGER,
  strategy_document_count INTEGER NOT NULL DEFAULT 0,
  alignment_score        INTEGER,
  panel_version          TEXT,
  recommended            TEXT,
  recorded_by            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screening_record_org_idx ON screening_record(owner_org_id);
`;

// ---------------------------------------------------------------------------
// W6-05 - hash-chained, tamper-evident audit (BRD AUD-01).
//
// The append-only audit_event table already refuses UPDATE/DELETE. Hash
// chaining adds a second, independent guarantee: every row stores the hash of
// the row before it plus a canonical hash of its own fields, so the log can be
// re-verified end to end and any alteration is detectable. Columns are added
// with IF NOT EXISTS so an existing database upgrades in place.
const AUDIT_CHAIN_SCHEMA = String.raw`
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audit_event_seq_idx ON audit_event(seq) WHERE seq IS NOT NULL;
`;

// ---------------------------------------------------------------------------
// W6-06 - subsidiary presentation scheduling (BRD WF-07).
//
// A subsidiary presents a live deal to the group before it is screened. Each
// session is captured on the opportunity record: the scheduled date, the
// attendees, and - once held - the outcome and the next steps, so the record
// shows what was discussed and agreed.
const PRESENTATION_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS presentation_session (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  owner_org_id   TEXT NOT NULL,
  scheduled_at   TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  format         TEXT,
  location       TEXT,
  attendees      JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome        TEXT,
  next_steps     TEXT,
  notes          TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presentation_opportunity_idx ON presentation_session(opportunity_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS presentation_org_idx ON presentation_session(owner_org_id);
`;

// ---------------------------------------------------------------------------
// W6-07 - notification email frequency (BRD NTF-01).
//
// A user chooses whether event email is delivered immediately or batched into a
// daily digest. The choice is per user; the digest only ever groups the rows
// addressed to that user.
const NOTIFICATION_FREQUENCY_SCHEMA = String.raw`
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS notification_frequency TEXT;
`;

// ---------------------------------------------------------------------------
// W7-05 - memo QR verification (BRD OUT-03).
//
// Each time a signed verification payload is issued for an exported memo, the
// opportunity id, the memo content version + hash and the verify URL are stored
// so a reviewer can audit exactly what was handed out. The public verify path
// recomputes the live fingerprint and compares it to the scanned hash.
const MEMO_VERIFICATION_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS memo_verification (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  owner_org_id   TEXT,
  version        TEXT NOT NULL,
  hash           TEXT NOT NULL,
  url            TEXT NOT NULL,
  issued_by      TEXT,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memo_verification_opportunity_idx ON memo_verification(opportunity_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS memo_verification_hash_idx ON memo_verification(hash);
`;

// ---------------------------------------------------------------------------
// W8-01 - authentication hardening (BRD PLT-04).
//
// The Better Auth two-factor plugin stores one enrolment per user in a
// 'twoFactor' table (TOTP secret + backup codes, both encrypted with the auth
// secret) and flags the holder on the 'user' row. The table is not created by
// the library (validateSchema is disabled), so it is materialised here. A
// unique index on userId keeps a user to a single active enrolment.
const AUTH_MFA_SCHEMA = String.raw`
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT false;
CREATE TABLE IF NOT EXISTS "twoFactor" (
  id                     TEXT PRIMARY KEY,
  secret                 TEXT NOT NULL,
  "backupCodes"          TEXT NOT NULL,
  "userId"               TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified               BOOLEAN DEFAULT true,
  "failedVerificationCount" INTEGER DEFAULT 0,
  "lockedUntil"          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS two_factor_user_id_idx ON "twoFactor"("userId");
`;

// The Better Auth SSO plugin keeps its providers in an 'ssoProvider' table
// (also library-managed and thus materialised here). tenant -> provider ->
// domain routing is read from this table, so a registered provider is what
// makes "Sign in with SSO" resolve an email to the right tenant.
const AUTH_SSO_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS "ssoProvider" (
  id             TEXT PRIMARY KEY,
  issuer         TEXT NOT NULL,
  "oidcConfig"   TEXT,
  "samlConfig"   TEXT,
  "userId"       TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  "providerId"   TEXT NOT NULL UNIQUE,
  "organizationId" TEXT REFERENCES auth_org(id) ON DELETE CASCADE,
  domain         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sso_provider_domain_idx ON "ssoProvider"(domain);
CREATE INDEX IF NOT EXISTS sso_provider_org_idx ON "ssoProvider"("organizationId");
`;

export async function initDb({ attempts = 15, delayMs = 2000, migrate = process.env.DB_MIGRATE_ON_BOOT !== '0' } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (!migrate) {
        // Least-privilege deployment (NFR-02): the app's database role cannot
        // change the schema, so migrations run separately (npm run migrate,
        // as the owner role) and boot only checks the schema is current.
        const { rows } = await pool.query("SELECT to_regclass('public.evidence_item') AS t, to_regclass('public.tool_entitlement') AS e");
        if (!rows[0]?.t || !rows[0]?.e) throw new Error('database schema is not current; run "npm run migrate" with the owner role');
        console.log('[db] schema check passed (migrations run separately)');
        return true;
      }
      await pool.query(SCHEMA);
      // Better Auth tables are not created by the library (validateSchema is
      // disabled), so a brand-new database needs them before the identity seed
      // can mirror the Sirius org tree and cast into the auth tables.
      await applyBetterAuthSchema();
      await pool.query(MVP_SCHEMA);
      await pool.query(GATE_SCHEMA);
      await pool.query(THEME_SCHEMA);
      await pool.query(PIPELINE_SCHEMA);
      await pool.query(WORKFLOW_SCHEMA);
      await pool.query(QA_SCHEMA);
      await pool.query(NOTIFY_SCHEMA);
      await pool.query(M5_SCHEMA);
      await pool.query(STRATEGY_SCHEMA);
      await pool.query(AUDIT_CHAIN_SCHEMA);
      await pool.query(PRESENTATION_SCHEMA);
      await pool.query(NOTIFICATION_FREQUENCY_SCHEMA);
      await pool.query(MEMO_VERIFICATION_SCHEMA);
      await pool.query(AUTH_MFA_SCHEMA);
      await pool.query(AUTH_SSO_SCHEMA);
      // ABAC rules live in their own module; create the table at boot so that
      // entities reads on a fresh database do not fail before anyone has
      // touched the /api/abac routes (which is where the table used to be
      // created lazily).
      const { ensureAbacSchema } = await import('./abac.js');
      await ensureAbacSchema();
      console.log('[db] schema ready');
      return true;
    } catch (err) {
      console.warn(`[db] not ready (attempt ${attempt}/${attempts}): ${err.message}`);
      if (attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}
