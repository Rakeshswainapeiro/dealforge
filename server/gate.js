import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { pool } from './db.js';
import { writeAudit, listAuditEvents } from './audit.js';
import { resolveActor } from './users.js';
import { canViewOrg, canWriteOrg, isCrossOrgReader, canConfigure } from './rbac.js';
import { saveFile, storageInfo, scopedObjectKey } from './storage.js';
import { UPLOAD_MAX_BYTES, uploadFilter } from './security.js';
import { loadDocumentPolicyConfig } from './documentPolicy.js';
import { checkUpload, scanUpload, scanBlocksUpload } from './config/documentPolicy.js';
import { loadSufficiencyConfig } from './sufficiency.js';
import {
  evaluateSufficiency, sufficiencyOverridesFromData,
  buildSufficiencyOverride, SUFFICIENCY_RULE_KEYS, SUFFICIENCY_OVERRIDE_TAG,
  SUFFICIENCY_CATEGORIES, SUFFICIENCY_BRD_EXAMPLES,
} from './config/sufficiency.js';
import { fullDocumentRequirements } from './config/memoDocumentList.js';
import {
  INTAKE_FIELDS, sectionProgress, sectionsWithFields, RETURN_HURDLES,
  MIN_COMMITMENT_AED_MN, ELIGIBLE_TYPES, OUTSIDE_APPETITE_TYPES, SOURCING_CHANNELS,
} from './config/intakeConfig.js';
import {
  SELF_SCREEN_QUESTIONS, evaluateSelfScreen, relatedPartyAnswerFromData,
} from './config/selfScreen.js';
import { getEffectiveTheme, getThresholds } from './themes.js';
import { evaluateBelowFloor, BELOW_FLOOR_ESCALATION } from './config/belowFloor.js';
import { QUALIFYING_GATES, QUALIFYING_GATE_NOT_READY, evaluateQualifyingGates } from './config/qualifyingGates.js';
import {
  ATTESTATION_ROLES, ATTESTATION_SETTING_KEY, resolveAttestationTexts,
  evaluateAttestations, ATTESTATION_REQUIRED_MESSAGE,
} from './config/attestations.js';
import {
  GREENFIELD_STAGES, CONCEPT_NOTE_MAX_PAGES, evaluateGreenfield, GREENFIELD_NOT_READY,
} from './config/greenfield.js';
import {
  evaluateSourcingChannel, SOURCING_CHANNEL_MESSAGES,
  COMPRESSED_TIMELINE_CHANNEL,
} from './config/sourcingChannel.js';
import {
  FINANCIAL_ROWS, FINANCIAL_PERIODS, FINANCIAL_PERIOD_KEYS, ACTUAL_PERIOD_KEYS,
  PROJECTION_PERIOD_KEYS, evaluateFinancials,
} from './config/financials.js';
import {
  THREE_STATEMENTS, STATEMENT_MODEL_REQUIREMENT_KEY,
  parseStatementModel, evaluateStatementModel, BALANCE_SHEET_TOTALS, BALANCE_TOLERANCE_PCT,
} from './config/statementModel.js';
import {
  RETURN_SCENARIOS, RETURN_METRICS, evaluateReturnMetrics,
} from './config/returnMetrics.js';
import {
  WACC_OVERRIDE_FIELD, WACC_OVERRIDE_REASON_FIELD, WACC_OVERRIDE_REASON_MESSAGE,
  resolveWacc,
} from './config/wacc.js';
import { computeHurdles, HURDLE_META, HURDLE_TABLE_VERSION } from './config/hurdleTable.js';
import {
  evaluateSourcesUses, SOURCE_ROWS, USE_ROWS, FUNDING_STATUSES,
  BALANCE_TOLERANCE_PCT as SOURCES_USES_TOLERANCE_PCT,
} from './config/sourcesUses.js';
import {
  evaluateBudgetStatus, BUDGET_FIELDS, VARIANCE_MEMO_KEY, VARIANCE_MEMO_LABEL,
  BUDGET_MESSAGES, BUDGET_STATUS_VALUES,
} from './config/budgetStatus.js';
import {
  evaluateValuation, VALUATION_BASIS, VALUATION_METHODS, VALUATION_FIELDS,
  COMPARABLE_MIN, COMPARABLE_MAX,
} from './config/valuation.js';
import {
  evaluateCrossBorder, CROSS_BORDER_ITEMS, CROSS_BORDER_FIELDS,
} from './config/crossBorder.js';
import {
  evaluateCurrency, REPORTING_CURRENCIES, CURRENCY_FIELDS,
} from './config/currency.js';
import {
  HARD_FILTER_ITEMS, HARD_FILTER_FIELDS,
  HARD_FILTER_REVIEW_DECISIONS, HARD_FILTER_REVIEW_REASON_MIN, HARD_FILTER_REVIEW_TAG,
  evaluateHardFilters, buildHardFilterReview,
} from './config/hardFilters.js';
import {
  SOFT_FILTER_VERSION, SOFT_FILTER_ITEMS, SOFT_FILTER_FIELDS, SOFT_FILTER_SCALE,
  SOFT_FILTER_REVIEW_DECISIONS, SOFT_FILTER_REVIEW_REASON_MIN, SOFT_FILTER_REVIEW_TAG,
  SOFT_FILTER_OUTCOME_MIN_STRONG, SOFT_FILTER_OUTCOME_MIN_MODERATE, UAE_PRIORITY_SECTORS,
  evaluateSoftFilters, buildSoftFilterReview,
} from './config/softFilters.js';
import {
  DISQUALIFIER_VERSION, DISQUALIFIER_ITEMS, DISQUALIFIER_FIELDS,
  DISQUALIFIER_CLEAR_REASON_MIN, DISQUALIFIER_REVIEW_TAG,
  DISQUALIFIER_VALUATION_PREMIUM_MIN, DISQUALIFIER_VALUATION_PREMIUM_MAX,
  DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD,
  evaluateDisqualifiers, buildDisqualifierReview,
} from './config/disqualifiers.js';
import {
  ADVERSE_MEDIA_VERSION, ADVERSE_MEDIA_STATUSES, ADVERSE_MEDIA_NOTES_MIN,
  ADVERSE_MEDIA_EVIDENCE_DOC_KEY, ADVERSE_MEDIA_FIELDS, ADVERSE_MEDIA_MESSAGES,
  evaluateAdverseMedia,
} from './config/adverseMedia.js';
import {
  SCORECARD_FIELDS, SCORECARD_SCALE,
  SCORECARD_REASON_MIN, SCORECARD_ADJUST_REASON_MIN, SCORECARD_NEUTRAL_SCORE,
  SCORECARD_TAG, SCORECARD_OVERRIDE_TAG,
  SCORECARD_CONFIG_KEY, defaultScorecardConfig, resolveScorecardConfig,
  validateScorecardConfig, diffScorecardConfig, buildScorecardConfig,
  evaluateScorecard, buildScorecard, buildScorecardOverride,
} from './config/scorecard.js';
import { getOrganization } from './org.js';
import { notify } from './notify.js';
import {
  QUALITY_SCORE_CONFIG_KEY, QUALITY_WEIGHT_TOTAL,
  defaultQualityScoreConfig, resolveQualityScoreConfig, validateQualityScoreConfig,
  buildQualityScoreConfig,
} from './config/qualityScore.js';
import { loadPortfolioRegisterConfig } from './portfolioRegister.js';
import { loadSiriusMandateConfig } from './mandate.js';
import { mandateFit } from './config/siriusMandate.js';
import { loadDocumentChecklistConfig } from './checklist.js';
import { checklistContext, evaluateChecklist } from './config/documentChecklist.js';
import { CHECKLIST_TIERS, CHECKLIST_RULE_KEYS } from './config/documentChecklistData.js';
import {
  PORTFOLIO_CLUSTERS, PORTFOLIO_CAPABILITY_VOCABULARY, PORTFOLIO_STATUSES,
} from './config/portfolioRegister.js';
import {
  PORTFOLIO_ANALYSIS_VERSION, CONCENTRATION_MAX_SECTOR_PCT, SYNERGY_MAX_RESULTS,
  SYNERGY_SIGNOFF_MARKER, SYNERGY_KINDS, CONFLICT_KINDS,
  evaluatePortfolioSynergy, evaluatePortfolioConflict,
} from './config/portfolioAnalysis.js';

// ---------------------------------------------------------------------------
// Capture + document gate (E3, E4 / REQ-SCREEN-01, REQ-DOCGATE-01).
//
// A submission cannot leave draft until (a) the §3.1 header fields and the
// narrative essentials are present and (b) every required document for the
// owning org has at least one current version. Both rule sets are configuration
// (document_requirement + OPPORTUNITY_FIELDS), never hard-coded at the call site.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ENTITY = 'DealOpportunity';

// The full six-section Opportunity Overview capture model (REQ-SUB-01,
// REQ-SUB-02, INT-06/INT-07). The ordered fields, their §-section and which of
// them block the gate come from config/intakeConfig.js so the form, gate and
// memo stay in step. `required: true` fields are the documented minimum that
// blocks submission; the rest are captured and scored per section but do not
// (yet) block — that arrives with the qualifying-gate checklist (W1-05).
export const OPPORTUNITY_FIELDS = INTAKE_FIELDS.map((f) => ({
  key: f.key,
  label: f.label,
  section: f.section,
  required: f.required === true,
}));

// Default minimum-document set (REQ-DOCGATE-01), derived from the memo evidence
// catalogue so the gate and the generated memo stay in step (REQ-MEMO-01).
// Overridable per org; see server/config/memoDocumentList.js for the full list.
// The full memo evidence catalogue: the gate tier is required, the supporting
// evidence (e.g. adverse-media screening, W3-12) is offered for upload but
// never blocks a submission.
export const DEFAULT_DOCUMENT_REQUIREMENTS = fullDocumentRequirements();

// Canonical pipeline states (REQ-PIPE-01). M2 drives draft -> submission.
export const PIPELINE_STATES = ['draft', 'submission', 'screening', 'refinement', 'approval', 'returned', 'declined'];
export const SUBMITTABLE_STATES = ['draft', 'returned'];

const uuid = () => crypto.randomUUID();

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// Document requirements
// ---------------------------------------------------------------------------
export async function seedDocumentRequirements({ force = false } = {}) {
  // The shipped catalogue is the source of truth and is upserted idempotently
  // on every boot so a deployed database picks up newly added evidence
  // requirements (e.g. adverse-media screening, W3-12) without a manual
  // re-seed. `force` is retained for callers that want a clean report.
  const { rows } = await pool.query('SELECT key FROM document_requirement');
  const existing = new Set(rows.map((r) => r.key));
  for (const req of DEFAULT_DOCUMENT_REQUIREMENTS) {
    await pool.query(
     `INSERT INTO document_requirement (id, org_id, key, label, description, required, sort_order)
       VALUES ($1, NULL, $2, $3, $4, $5, $6)
      ON CONFLICT (COALESCE(org_id, '*'), key) DO UPDATE SET
        label = EXCLUDED.label, description = EXCLUDED.description,
        required = EXCLUDED.required, sort_order = EXCLUDED.sort_order`,
      ['req-' + req.key, req.key, req.label, req.description, req.required === true, req.sort_order]
    );
  }
  const added = DEFAULT_DOCUMENT_REQUIREMENTS.filter((r) => !existing.has(r.key)).length;
  return { skipped: false, count: DEFAULT_DOCUMENT_REQUIREMENTS.length, added, forced: force };
}

// Org-specific requirements override the defaults for that org; the effective
// set is the union keyed by `key` (org row wins).
export async function listRequirements(orgId) {
  const { rows } = await pool.query(
    'SELECT * FROM document_requirement WHERE is_active = true AND (org_id IS NULL OR org_id = $1) ORDER BY sort_order, key',
    [orgId || null]
  );
  const byKey = new Map();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    if (!existing || (row.org_id && !existing.org_id)) byKey.set(row.key, row);
  }
  return [...byKey.values()].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

export async function upsertRequirement({ id, orgId = null, key, label, description, required = true, sortOrder = 0 }, { actor } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO document_requirement (id, org_id, key, label, description, required, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (COALESCE(org_id, '*'), key) DO UPDATE SET
       label = EXCLUDED.label, description = EXCLUDED.description,
       required = EXCLUDED.required, sort_order = EXCLUDED.sort_order, is_active = true
     RETURNING *`,
    [id || uuid(), orgId, key, label, description || null, required, sortOrder]
  );
  await writeAudit({ entity: 'document_requirement', entityId: rows[0].id, action: 'upsert', actor, orgId, after: rows[0] });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Submission documents (versioned; E4.4)
// ---------------------------------------------------------------------------
function docToRecord(row) {
  return {
    id: row.id,
    opportunity_id: row.opportunity_id,
    owner_org_id: row.owner_org_id,
    requirement_key: row.requirement_key,
    version: row.version,
    filename: row.filename,
    original_name: row.original_name,
    mimetype: row.mimetype,
    size: row.size != null ? Number(row.size) : null,
    sha256: row.sha256,
    storage: row.storage,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
    is_current: row.is_current,
    scan_verdict: row.scan_verdict,
    scan_engine: row.scan_engine,
    scan_detail: row.scan_detail,
    scanned_at: row.scanned_at,
    // The openable source URL: object-store keys stream through /api/files, the
    // local-disk fallback serves the stored filename from /uploads (W5-04 /
    // DOC-05 relies on this to let a reviewer open the linked source).
    file_url: row.object_key
      ? '/api/files/' + String(row.object_key).split('/').map(encodeURIComponent).join('/')
      : (row.filename ? '/uploads/' + encodeURIComponent(row.filename) : null),
  };
}

export async function listDocuments(opportunityId, { currentOnly = false } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM submission_document WHERE opportunity_id = $1 AND deleted = false' +
      (currentOnly ? ' AND is_current = true' : '') + ' ORDER BY uploaded_at DESC',
    [opportunityId]
  );
  return rows.map(docToRecord);
}

export async function addDocumentVersion({
  opportunityId,
  ownerOrgId,
  requirementKey,
  file,
  actor,
}) {
  if (!file || !file.buffer) {
    const err = new Error('A file is required');
    err.status = 400;
    throw err;
  }
  if (!requirementKey) {
    const err = new Error('requirement_key is required');
    err.status = 400;
    throw err;
  }
  // Upload policy (W5-02 / DOC-02): the effective size cap and accepted-type
  // allow-list, then the virus scan. A blocked scan never writes a row, so an
  // infected upload cannot become evidence.
  const policy = await loadDocumentPolicyConfig();
  const violations = checkUpload({ filename: file.originalname, size: file.buffer.length }, policy);
  if (violations.length) {
    const v = violations[0];
    const err = new Error(v.code === 'too_large'
      ? 'File is larger than the ' + v.limit_mb + ' MB limit'
      : 'Unsupported file type: ' + (file.originalname || 'unknown'));
    err.status = v.code === 'too_large' ? 413 : 415;
    err.violations = violations;
    throw err;
  }
  const scan = await scanUpload(file.buffer, policy, { filename: file.originalname });
  if (scanBlocksUpload(scan, policy)) {
    const err = new Error(scan.verdict === 'infected'
      ? 'The file was flagged by the virus scan and was not uploaded'
      : 'The file was flagged as suspicious by the virus scan and was not uploaded');
    err.status = 422;
    err.scan = scan;
    throw err;
  }
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const key = scopedObjectKey({ orgId: ownerOrgId, opportunityId, originalName: file.originalname });
  const saved = await saveFile({
    buffer: file.buffer,
    originalName: file.originalname,
    mimetype: file.mimetype,
    key,
  });
  const { rows: prior } = await pool.query(
    'SELECT COALESCE(MAX(version), 0)::int AS v FROM submission_document WHERE opportunity_id = $1 AND requirement_key = $2',
    [opportunityId, requirementKey]
  );
  const version = prior[0].v + 1;
  // Supersede the previous current version for this requirement.
  await pool.query(
    'UPDATE submission_document SET is_current = false WHERE opportunity_id = $1 AND requirement_key = $2 AND is_current = true',
    [opportunityId, requirementKey]
  );
  const { rows } = await pool.query(
    `INSERT INTO submission_document
       (id, opportunity_id, owner_org_id, requirement_key, version, object_key, filename,
        original_name, mimetype, size, sha256, storage, uploaded_by, is_current,
        scan_verdict, scan_engine, scan_detail, scanned_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,now())
     RETURNING *`,
    [
      uuid(), opportunityId, ownerOrgId, requirementKey, version, saved.key, saved.filename,
      saved.original_name, saved.mimetype, saved.size, sha256, saved.storage, actor?.email || null,
      scan.verdict, scan.engine, JSON.stringify(scan.signatures || (scan.detail ? { detail: scan.detail } : {})),
    ]
  );
  const record = docToRecord(rows[0]);
  await writeAudit({
    entity: 'submission_document', entityId: record.id, action: 'upload',
    actor, orgId: ownerOrgId,
    after: { requirement_key: requirementKey, version, sha256, original_name: record.original_name, scan_verdict: scan.verdict, scan_engine: scan.engine },
  });
  return record;
}

export async function deleteDocument(id, { actor } = {}) {
  const { rows } = await pool.query('SELECT * FROM submission_document WHERE id = $1 AND deleted = false', [id]);
  const row = rows[0];
  if (!row) return { id };
  if (!canWriteOrg(actor?.membership, row.owner_org_id, { descendantIds: actor?.descendant_ids || [], grantedOrgIds: actor?.granted_org_ids || [] })) {
    const err = new Error('Not permitted to delete this document');
    err.status = 403;
    throw err;
  }
  await pool.query('UPDATE submission_document SET deleted = true, is_current = false WHERE id = $1', [id]);
  await writeAudit({ entity: 'submission_document', entityId: id, action: 'delete', actor, orgId: row.owner_org_id, before: docToRecord(row) });
  return { id };
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

// The configurable attestation wording (W1-06 / INT-09). Operators may replace
// the shipped text at runtime through the AppSettings entity (setting_key =
// 'attestation_text'); a missing or unreadable setting falls back to the
// defaults in config/attestations.js, so the gate never depends on a row.
export async function loadAttestationTexts() {
  try {
    const { rows } = await pool.query(
      `SELECT data->>'setting_value' AS setting_value FROM entity_record
        WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
      [ATTESTATION_SETTING_KEY]
    );
    if (!rows[0]?.setting_value) return resolveAttestationTexts();
    let runtime = {};
    try { runtime = JSON.parse(rows[0].setting_value); } catch { runtime = {}; }
    return resolveAttestationTexts(runtime);
  } catch {
    return resolveAttestationTexts();
  }
}

// The effective Gate 2 scorecard configuration (W3-08 / SCO-05). Operators may
// recalibrate the criteria, weights, pass bar, lenses and lens floor at runtime
// through the AppSettings entity (setting_key = 'scorecard_config'). A missing
// or invalid setting falls back to the shipped defaults, so the gate never
// depends on a row. Every assessment keeps the version it was scored under.
export async function loadScorecardConfig() {
  try {
    const { rows } = await pool.query(
      `SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
      [SCORECARD_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultScorecardConfig();
    return resolveScorecardConfig(rows[0].setting_value);
  } catch {
    return defaultScorecardConfig();
  }
}

// The effective pre-screening quality-score configuration (W3-09 / SCO-01). The
// component weights and band thresholds sit in the AppSettings entity
// (setting_key = 'quality_score_config'); a missing or invalid row falls back to
// the shipped defaults. Advisory only - the score never takes a decision.
export async function loadQualityScoreConfig() {
  try {
    const { rows } = await pool.query(
      `SELECT data->>'setting_value' AS setting_value FROM entity_record WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
      [QUALITY_SCORE_CONFIG_KEY]
    );
    if (!rows[0]?.setting_value) return defaultQualityScoreConfig();
    return resolveQualityScoreConfig(rows[0].setting_value);
  } catch {
    return defaultQualityScoreConfig();
  }
}

// Sirius group mandate fit (W4-04 / ENT-03): the advisory test of whether a
// submission sits inside the versioned group mandate - its sector, its
// geography and its ticket size. Reference data only; it never blocks.
function evaluateMandateFit(data, mandate) {
  return mandateFit({
    sector: data?.sector ?? null,
    geography: data?.geography ?? null,
    totalCommitmentAed: data?.total_commitment_aed ?? data?.ask_aed ?? null,
  }, mandate);
}

export async function evaluateGate(opportunity, { orgId, theme = null, portfolio = null, nationalPriorities = null, scorecardConfig = null, mandate = null, checklist = null } = {}) {
  const data = opportunity?.data || opportunity || {};
  const ownerOrg = orgId || data.owner_org_id || null;
  const missing = [];

  // The entity cost of capital (W2-05 / FIN-05): Sirius sets WACC once per
  // entity; a preparer may override it for this deal only with a reason. The
  // effective rate feeds the ROIC hurdle (FIN-04, evaluated separately).
  const thresholds = await getThresholds(ownerOrg).catch(() => null);
  const wacc = resolveWacc(data, { orgWacc: thresholds?.wacc_pct ?? null });
  wacc.roic_base = data.return_roic_base != null ? Number(data.return_roic_base) : null;
  // The automatic hurdle test (W2-04 / FIN-04) evaluates every hurdle per
  // scenario from the same thresholds and the resolved WACC, so each Meets?
  // verdict is derived once and shared by the gate, the form and the memo.
  const hurdleTable = computeHurdles({
    data,
    financials: data.financials,
    thresholds: thresholds || {},
    wacc,
  });
  wacc.roic_hurdle = hurdleTable.thresholds.roic;
  wacc.roic_vs_wacc = wacc.roic_base !== null && wacc.roic_hurdle !== null
    ? { hurdle: wacc.roic_hurdle, meets: wacc.roic_base >= wacc.roic_hurdle, roic: wacc.roic_base, wacc: wacc.effective_wacc, spread: thresholds?.roic_wacc_spread ?? null }
    : null;

  for (const field of OPPORTUNITY_FIELDS) {
    if (field.required && isBlank(data[field.key])) {
      missing.push({ type: 'field', key: field.key, label: field.label, section: field.section, required: true });
    }
  }

  const requirements = await listRequirements(ownerOrg);
  const docs = opportunity?.id ? await listDocuments(opportunity.id, { currentOnly: true }) : [];
  const presentKeys = new Set(docs.map((d) => d.requirement_key));
  const documents = requirements.map((req) => ({
    key: req.key,
    label: req.label,
    description: req.description,
    required: req.required,
    present: presentKeys.has(req.key),
  }));

  // Budget status (W2-07 / FIN-07). Off-budget ('No') makes a variance-memo
  // upload mandatory and a variance justification required; in-budget records a
  // line reference (advisory if missing). Evaluated against the present document
  // keys so the evidence requirement is enforced on the real upload set.
  const budgetStatus = evaluateBudgetStatus(data, { documents: [...presentKeys] });

  // Cross-border considerations (W2-09 / FIN-08). The four considerations are
  // conditional on geography: they apply only when the target's geography names
  // a different country from the owning subsidiary's registered geography. The
  // home country comes from the owner org record, so the same opportunity is
  // evaluated consistently by the form, the gate and the memo. Advisory only —
  // a missing consideration is flagged, never blocked.
  const ownerOrgRow = ownerOrg ? await getOrganization(ownerOrg).catch(() => null) : null;
  const crossBorder = evaluateCrossBorder(data, { homeCountry: ownerOrgRow?.geography || null });

  // The greenfield extra tests (W1-07 / INT-10). Evaluated before the document
  // loop because a Concept-stage greenfield is a two-page note: the full
  // required-document pack is waived until the stage reaches Feasibility or
  // Initiate (documents_required = false at Concept).
  const greenfield = evaluateGreenfield(data);
  const documentsRequired = !greenfield || greenfield.documents_required;

  // Document checklist (W5-01 / DOC-01). The effective checklist is generated
  // from the opportunity's type, stage and flags, and each item is mandatory,
  // conditional or optional. An item blocks only when its tier is due for this
  // opportunity, its rule applies and it is marked enforced; the shipped default
  // reproduces the standing gate, so nothing new blocks until an administrator
  // changes the checklist. A Concept-stage greenfield still waives the pack.
  const checklistConfig = checklist || await loadDocumentChecklistConfig().catch(() => null);
  const checklistEval = evaluateChecklist(
    checklistContext(data, {
      offBudget: budgetStatus.off_budget === true || undefined,
      relatedParty: relatedPartyAnswerFromData(data) === 'yes' ? true : undefined,
      crossBorder: crossBorder?.applies === true,
    }),
    checklistConfig,
    { documents: [...presentKeys] }
  );
  if (documentsRequired) {
    for (const item of checklistEval.items) {
      if (item.blocking) {
        missing.push({ type: 'document', key: item.key, label: item.label, section: 'documents' });
      }
    }
  }

  const requiredDocs = documentsRequired ? documents.filter((d) => d.required) : [];
  const presentRequired = requiredDocs.filter((d) => d.present).length;
  const completeness = requiredDocs.length === 0 ? 100 : Math.round((presentRequired / requiredDocs.length) * 100);

  // Content sufficiency check (W5-03 / DOC-04). The advisory rule set is read
  // from configuration and evaluated against the evidence the gate already
  // assembled (the financial summary, the three-statement model, the return
  // metrics and the attached documents). Every finding is a flag with its
  // observed and expected value; a reviewer override with a reason clears it.
  // Nothing here blocks a submission.
  const sufficiencyConfig = await loadSufficiencyConfig().catch(() => null);
  const sufficiency = evaluateSufficiency({
    gate: {
      financials: evaluateFinancials(data),
      statement_model: evaluateStatementModel(data.statement_model),
      return_metrics: evaluateReturnMetrics(data),
    },
    documents: presentKeys,
    config: sufficiencyConfig,
    overrides: sufficiencyOverridesFromData(data),
  });

  // The off-budget variance memo (W2-07 / FIN-07): when the deal is not in the
  // approved budget, its variance memo becomes a required document even though
  // it is not part of the standing required set. Added to `missing` here so the
  // document gate blocks it exactly like a standing requirement.
  if (budgetStatus.variance_memo_required && !presentKeys.has(VARIANCE_MEMO_KEY)) {
    missing.push({
      type: 'document', key: VARIANCE_MEMO_KEY, label: VARIANCE_MEMO_LABEL,
      section: 'documents', required: true, reason: 'off_budget_variance_memo',
    });
  }

  // The CEO + CFO attestation gate (W1-06 / INT-09). Two named attestations,
  // each with person, timestamp and IP; both are required before submission.
  const attestationTexts = await loadAttestationTexts();

  // Gate 1 hard filters (W3-02 / SCR-03): the five standing filters. A failed
  // filter sets the outcome to 'Recommended decline' with the reason, but the
  // system never rejects on its own (SCR-09) - a reviewer confirms or overrides
  // with a written reason. The effective theme is resolved here when the caller
  // did not pass one, so the panel, the form and the memo all read the same
  // mandate.
  const effectiveTheme = theme || (ownerOrg ? await getEffectiveTheme(ownerOrg).catch(() => null) : null);
  const hardFilters = evaluateHardFilters(data, { theme: effectiveTheme, thresholds });

  // Gate 1 soft filters (W3-03 / SCR-04): three scored filters - adjacency to
  // portfolio companies, alignment with UAE national priorities and management
  // openness to an active investor. The system proposes each score from the
  // structured data; the reviewer confirms or adjusts with a written rationale.
  // Scored, never used to kill a deal (SCR-04). The portfolio register (W4-01 /
  // ENT-04) now supplies the adjacency matches; when no register is passed the
  // evaluator falls back to the mandate theme, so a caller that has not loaded
  // it still gets a defensible proposal.
  const register = portfolio || await loadPortfolioRegisterConfig().then((r) => r?.companies || null).catch(() => null);
  const softFilters = evaluateSoftFilters(data, {
    theme: effectiveTheme,
    portfolio: register,
    nationalPriorities: nationalPriorities || null,
  });

  // Portfolio conflict / concentration (W3-10 / SCR-07) and synergy (W3-11 /
  // SCR-06): the analysis against the same versioned register the soft filters
  // read. It names each overlapping portfolio company, gives the post-deal
  // sector concentration where data exists and lists the top synergies, every
  // one of them marked as requiring the operating company's sign-off. Advisory
  // throughout (SCR-09): it surfaces matches and a figure, never a rejection.
  const portfolioSynergy = evaluatePortfolioSynergy(data, { portfolio: register });
  const portfolioConflict = evaluatePortfolioConflict(data, { portfolio: register });

  // Sirius group mandate fit (W4-04 / ENT-03): the advisory test of whether the
  // submission's sector and geography sit inside the versioned group mandate
  // the entity is investing against, and whether the commitment sits in the
  // ticket band. Reference data only (SCR-09): it informs the reviewer, never
  // blocks a submission. A caller may pass the mandate it already loaded; when
  // it does not, the shipped / stored mandate is read.
  const effectiveMandate = mandate || await loadSiriusMandateConfig().catch(() => null);
  const mandateFitResult = evaluateMandateFit(data, effectiveMandate);

  // Automatic disqualifier flags (W3-04 / SCR-05): the five automatic
  // disqualifiers. A present disqualifier raises a named flag that is prominent
  // on the record and in the memo; clearing it requires a named reviewer and a
  // reason, recorded through the review route. The related-party signal is
  // derived so an undisclosed related party found after Gate 1 trips the fourth
  // disqualifier without a separate capture.
  const relatedPartySignal = relatedPartyAnswerFromData(data) === 'yes' && isBlank(data.related_party_disclosure)
    ? { status: 'detected', disclosed: false }
    : null;
  const disqualifiers = evaluateDisqualifiers(data, { relatedParty: relatedPartySignal });

  // Gate 2 weighted scorecard (W3-05 / SCO-02, REQ-GATE-02): seven 1-5 criteria
  // with weights summing to 100%. The weighted total clears a 3.5 pass bar; a
  // below-bar total needs an explicit CIO override memo. The criteria and
  // weights are configuration (SCO-05), scored on the same 1-5 scale as the
  // soft filters.
  const scConfig = scorecardConfig || await loadScorecardConfig();
  const scorecard = evaluateScorecard(data, {
    criteria: scConfig.criteria,
    lenses: scConfig.lenses,
    passThreshold: scConfig.pass_threshold,
    lensFloor: scConfig.lens_floor,
    version: scConfig.version,
  });

  return {
    complete: missing.length === 0,
    missing,
    fields: OPPORTUNITY_FIELDS.map((f) => ({ ...f, present: !isBlank(data[f.key]) })),
    // Per-section capture progress across the whole six-section pack (INT-06),
    // so the preparer sees how complete each page is before submission.
    sections: sectionProgress(data),
    // The pre-form self-screen result (W1-01 / INT-02), so the form and the
    // submission route agree on whether the opportunity may proceed at all.
    self_screen: evaluateSelfScreen(
      { ...data, related_party: data.related_party || relatedPartyAnswerFromData(data) },
      { theme }
    ),
    // The below-floor exception route (W1-02 / INT-03), evaluated only for a
    // sub-floor ticket; null otherwise.
    below_floor: evaluateBelowFloor(data),
    // The ten qualifying gates (W1-05 / INT-08): each needs a YES plus linked
    // evidence; any gate not ready blocks submission with the not-ready message.
    qualifying_gates: evaluateQualifyingGates(data),
    // The two named attestations (W1-06 / INT-09): the subsidiary CEO and CFO
    // each confirm the gates are cleared and the figures and funding are sound.
    attestations: evaluateAttestations(data, { texts: attestationTexts }),
    // The greenfield extra tests (W1-07 / INT-10), evaluated only for a
    // greenfield / new-venture opportunity; null otherwise.
    greenfield,
    // The sourcing-channel side-effects (W1-08 / INT-05): the channel is
    // mandatory, an IHC / affiliate referral auto-sets the related-party flag,
    // and a banker / advisor-led process sets the compressed-timeline indicator.
    sourcing_channel: evaluateSourcingChannel(data),
    // The Part B page-4 financial summary (W2-01 / FIN-01): the eight-row AED
    // mn matrix with Growth %, EBITDA margin % and free cash flow derived from
    // the captured rows. New ventures may leave the actual columns blank.
    financials: evaluateFinancials(data),
    // The three-statement model check (W2-02 / FIN-02): the linked P&L, balance
    // sheet and cash flow are a mandatory upload; presence and the balance-sheet
    // equality are checked, and a non-template / unbalanced model is flagged for
    // manual review rather than silently discarded.
    statement_model: evaluateStatementModel(data.statement_model),
    // The three-scenario return metrics (W2-03 / FIN-03): Equity IRR, ROIC and
    // payback must be present for base, upside and downside, with a survivable
    // downside mandatory; MOIC is captured where relevant. Advisory only —
    // completeness is surfaced as flags and a missing list, never a hard block.
    return_metrics: evaluateReturnMetrics(data),
    // The automatic hurdle test (W2-04 / FIN-04): each hurdle evaluated per
    // scenario against the entity thresholds (ROIC against WACC + spread),
    // with a Meets? verdict per case, the policy revision and the advisory
    // flags. Always advisory — a below-hurdle case is flagged, never blocked.
    hurdle_table: hurdleTable,
    // The entity WACC and any per-opportunity override (W2-05 / FIN-05): the
    // effective cost of capital, its source, and whether an override carries
    // the mandatory reason. An override without a reason is flagged, never
    // applied silently.
    wacc,
    // The funding sources and uses table (W2-06 / FIN-06): each source and use
    // with its amount and percentage, the sources = uses balance and the
    // funding-hierarchy signal. Advisory — an imbalance or an early Sirius draw
    // is flagged, never blocked.
    sources_uses: evaluateSourcesUses(data),
    // Budget status (W2-07 / FIN-07): whether the deal is in the approved
    // budget, the line reference or the variance justification, and whether the
    // mandatory variance memo is present when off-budget. A hard block when
    // off-budget evidence is missing; advisory when an in-budget line reference
    // is absent.
    budget_status: budgetStatus,
    // Entry valuation and exit (W2-08 / FIN-09): the structured entry figure
    // (amount, EV/equity basis, multiple, method), the 3-5 name comparable set
    // and the exit route / timing / target multiple. Advisory — a partial
    // capture is flagged, never blocked.
    valuation: evaluateValuation(data),
    // Cross-border considerations (W2-09 / FIN-08): FX exposure, withholding
    // tax, transfer pricing and repatriation restrictions, captured only when
    // the target geography differs from the subsidiary's home country. Advisory
    // — a missing consideration is flagged, never blocked.
    cross_border: crossBorder,
    // Reporting currency and FX (W2-10 / NFR-08): figures are AED mn by
    // default; a USD-reported deal records the AED-per-USD rate used so every
    // figure is reproducible against the base. Advisory — a missing rate on a
    // USD deal is flagged, never blocked.
    currency: evaluateCurrency(data),
    // Gate 1 hard filters (W3-02 / SCR-03): five standing filters, the failed
    // set, and the recommended outcome with its reason. Advisory to the
    // decision - a person confirms or overrides, never an automatic rejection.
    hard_filters: hardFilters,
    // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08): the
    // analyst's verdict, the supporting note and the evidence on the record. A
    // clear verdict needs its note and evidence; an adverse finding is a flag
    // that escalates to a reviewer, never an automatic rejection (SCR-09).
    adverse_media: evaluateAdverseMedia(data, { documents: presentKeys }),
    // Gate 1 soft filters (W3-03 / SCR-04): three 1-5 scored filters with a
    // proposed score, a rationale and the reviewer record. Scored, never used
    // to kill a deal; the reviewer confirms or adjusts each score.
    soft_filters: softFilters,
    // Portfolio conflict & concentration (W3-10 / SCR-07): the overlap flags
    // against the register, each naming the affected company, and the post-deal
    // sector concentration against the ceiling. Advisory - the reviewer judges
    // whether any overlap is un-mitigable.
    portfolio_conflict: portfolioConflict,
    // Sirius group mandate fit (W4-04 / ENT-03): the advisory in-scope test
    // against the versioned group mandate (sector, geography, ticket). It rides
    // along as its own section so the board and the memo can show it; it never
    // contributes to the recommendation.
    mandate_fit: mandateFitResult,
    // Portfolio synergy (W3-11 / SCR-06): the top synergies against the
    // register, each naming the company and its rationale, every claim marked as
    // requiring the operating company's sign-off.
    portfolio_synergy: portfolioSynergy,
    // Automatic disqualifier flags (W3-04 / SCR-05): the five automatic
    // disqualifiers, the flagged and open-flag sets and the reviewer clears. A
    // flag is raised, never cleared, by the system.
    disqualifiers,
    // Gate 2 weighted scorecard (W3-05 / SCO-02): the seven weighted criteria,
    // the weighted total on the 1-5 scale and the pass / override outcome.
    scorecard,
    documents,
  // Document checklist (W5-01 / DOC-01): the generated checklist with each
  // item's tier, whether it applies and is due for this opportunity, whether
  // it is present and whether it blocks. The form renders it; the gate blocks
  // on the same evaluation.
  document_checklist: checklistEval,
  // Content sufficiency check (W5-03 / DOC-04): the advisory rule set that
  // flags thin content - a missing cash flow, fewer years of history than the
  // policy expects, no downside case and an absent supporting pack. Each flag
  // carries its observed and expected value and a reviewer override, and never
  // blocks: a person resolves it or records a reason.
  sufficiency,
  completeness,
  };
}

// ---------------------------------------------------------------------------
// HTTP routes — /api/gate
// ---------------------------------------------------------------------------
export const gateRouter = express.Router();

// Uploads are held in memory only long enough to hash and persist them, and
// are limited by size and by an extension allow-list (E10.1, NFR security).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: uploadFilter,
});

gateRouter.use(async (req, res, next) => {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor) return res.status(401).json({ error: 'No authenticated user could be resolved' });
    next();
  } catch (err) { next(err); }
});

function sendErr(res, err) { res.status(err.status || 500).json({ error: err.message }); }

// The capture model, served from configuration so the client form, the gate and
// the memo render the same six-section Opportunity Overview (INT-06). Readable
// by any authenticated user; no data is exposed, only the schema.
gateRouter.get('/fields', async (_req, res) => {
  const attestationTexts = await loadAttestationTexts();
  const scorecardConfig = await loadScorecardConfig();
  const qualityScoreConfig = await loadQualityScoreConfig();
  const portfolioRegister = await loadPortfolioRegisterConfig();
  const mandateConfig = await loadSiriusMandateConfig();
  const checklistConfig = await loadDocumentChecklistConfig();
  const sufficiencyConfig = await loadSufficiencyConfig();
  res.json({
    sections: sectionsWithFields(),
    hurdles: RETURN_HURDLES,
    financials: {
      periods: FINANCIAL_PERIODS,
      period_keys: FINANCIAL_PERIOD_KEYS,
      actual_period_keys: ACTUAL_PERIOD_KEYS,
      projection_period_keys: PROJECTION_PERIOD_KEYS,
      rows: FINANCIAL_ROWS,
    },
    floor_aed_mn: MIN_COMMITMENT_AED_MN,
    eligible_types: ELIGIBLE_TYPES,
    outside_appetite_types: OUTSIDE_APPETITE_TYPES,
    self_screen: SELF_SCREEN_QUESTIONS,
    qualifying_gates: QUALIFYING_GATES.map((g) => ({
      number: g.number, key: g.key, label: g.label, question: g.question,
      answer_key: 'gate_' + g.key, evidence: g.evidence,
    })),
    greenfield: {
      stages: GREENFIELD_STAGES,
      concept_note_max_pages: CONCEPT_NOTE_MAX_PAGES,
    },
    statement_model: {
      statements: THREE_STATEMENTS.map((s) => ({ key: s.key, label: s.label, markers: s.markers })),
      balance_sheet_totals: BALANCE_SHEET_TOTALS,
      requirement_key: STATEMENT_MODEL_REQUIREMENT_KEY,
      tolerance_pct: BALANCE_TOLERANCE_PCT,
    },
    returns: {
      scenarios: RETURN_SCENARIOS.map((s) => ({ key: s.key, label: s.label, required: s.required })),
      metrics: RETURN_METRICS.map((m) => ({
        key: m.key, label: m.label, unit: m.unit, required: m.required,
        where_relevant: !!m.where_relevant, fields: m.fields,
      })),
    },
    wacc: {
      override_field: WACC_OVERRIDE_FIELD,
      reason_field: WACC_OVERRIDE_REASON_FIELD,
      reason_message: WACC_OVERRIDE_REASON_MESSAGE,
    },
    sources_uses: {
      sources: SOURCE_ROWS.map((s) => ({ key: s.key, label: s.label, rank: s.rank })),
      uses: USE_ROWS.map((u) => ({ key: u.key, label: u.label })),
      statuses: FUNDING_STATUSES.map((s) => ({ value: s.value, label: s.label })),
      tolerance_pct: SOURCES_USES_TOLERANCE_PCT,
    },
    budget_status: {
      answer_field: BUDGET_FIELDS.answer,
      status_field: BUDGET_FIELDS.status,
      line_reference_field: BUDGET_FIELDS.line_reference,
      justification_field: BUDGET_FIELDS.justification,
      variance_memo_key: VARIANCE_MEMO_KEY,
      variance_memo_label: VARIANCE_MEMO_LABEL,
      statuses: BUDGET_STATUS_VALUES.map((v) => ({ value: v, label: v === 'in_budget' ? 'In approved budget' : 'Off-budget, variance justified' })),
    },
    valuation: {
      basis_field: VALUATION_FIELDS.basis,
      amount_field: VALUATION_FIELDS.amount,
      multiple_field: VALUATION_FIELDS.multiple,
      method_field: VALUATION_FIELDS.method,
      comparables_field: VALUATION_FIELDS.comparables,
      exit_route_field: VALUATION_FIELDS.exit_route,
      exit_timing_field: VALUATION_FIELDS.exit_timing,
      exit_multiple_field: VALUATION_FIELDS.exit_multiple,
      basis: VALUATION_BASIS.map((b) => ({ value: b.value, label: b.label })),
      methods: VALUATION_METHODS.map((m) => ({ value: m.value, label: m.label })),
      comparable_min: COMPARABLE_MIN,
      comparable_max: COMPARABLE_MAX,
    },
    cross_border: {
      applies_condition: 'target geography differs from the subsidiary home country',
      items: CROSS_BORDER_ITEMS.map((i) => ({ key: i.key, label: i.label, short: i.short })),
      fields: CROSS_BORDER_FIELDS,
    },
    currency: {
      base_currency: 'AED',
      currency_field: CURRENCY_FIELDS.currency,
      fx_rate_field: CURRENCY_FIELDS.fx_rate,
      currencies: REPORTING_CURRENCIES.map((c) => ({ value: c.value, label: c.label })),
    },
    // Gate 1 hard filters (W3-02 / SCR-03): the five standing filters and the
    // reviewer decisions. Served from configuration so the form, the gate and
    // the tests read one source.
    hard_filters: {
      reason_min: HARD_FILTER_REVIEW_REASON_MIN,
      decisions: HARD_FILTER_REVIEW_DECISIONS.map((d) => ({
        value: d, label: d === 'confirmed' ? 'Confirm the recommended decline' : 'Override the recommended decline',
      })),
      items: HARD_FILTER_ITEMS.map((i) => ({
        key: i.key, label: i.label, group: i.group, order: i.order,
        manual: Boolean(i.manual), description: i.description, field: i.field || null,
      })),
      fields: HARD_FILTER_FIELDS,
    },
    // Gate 1 soft filters (W3-03 / SCR-04): the three scored filters, the 1-5
    // scale and the reviewer decisions. Served from configuration so the form,
    // the gate and the tests read one source.
    soft_filters: {
      version: SOFT_FILTER_VERSION,
      scale: SOFT_FILTER_SCALE.map((s) => ({ value: s.value, label: s.label })),
      reason_min: SOFT_FILTER_REVIEW_REASON_MIN,
      outcome_min_strong: SOFT_FILTER_OUTCOME_MIN_STRONG,
      outcome_min_moderate: SOFT_FILTER_OUTCOME_MIN_MODERATE,
      decisions: SOFT_FILTER_REVIEW_DECISIONS.map((d) => ({
        value: d, label: d === 'confirmed' ? 'Confirm the proposed scores' : 'Adjust the scores',
      })),
      national_priority_sectors: UAE_PRIORITY_SECTORS,
      items: SOFT_FILTER_ITEMS.map((i) => ({
        key: i.key, label: i.label, group: i.group, order: i.order,
        description: i.description, field: i.field || null, note_field: i.note_field || null,
      })),
      fields: SOFT_FILTER_FIELDS,
    },
    // Automatic disqualifiers (W3-04 / SCR-05): the five flags, the clear
    // reason minimum and the valuation-premium band. Served from configuration
    // so the form, the gate and the tests read one source.
    disqualifiers: {
      version: DISQUALIFIER_VERSION,
      reason_min: DISQUALIFIER_CLEAR_REASON_MIN,
      valuation_premium_min: DISQUALIFIER_VALUATION_PREMIUM_MIN,
      valuation_premium_max: DISQUALIFIER_VALUATION_PREMIUM_MAX,
      valuation_premium_threshold: DISQUALIFIER_VALUATION_PREMIUM_THRESHOLD,
      items: DISQUALIFIER_ITEMS.map((i) => ({
        key: i.key, label: i.label, group: i.group, order: i.order,
        manual: Boolean(i.manual), description: i.description,
        field: i.field || null, note_field: i.note_field || null,
      })),
      fields: DISQUALIFIER_FIELDS,
    },
    // Gate 2 weighted scorecard (W3-05 / SCO-02): the seven criteria, their
    // weights, the 1-5 scale, the pass bar and the scoring guide. Served from
    // configuration so the board, the gate and the tests read one source.
    scorecard: (() => {
      const cfg = scorecardConfig || defaultScorecardConfig();
      return {
      version: cfg.version,
      scale: SCORECARD_SCALE.map((s) => ({ value: s.value, label: s.label })),
      min_score: 1,
      max_score: 5,
      pass_threshold: cfg.pass_threshold,
      lens_floor: cfg.lens_floor,
      revision: cfg.revision,
      lenses: cfg.lenses.map((l) => ({
        key: l.key, label: l.label, description: l.description,
        criteria: l.criteria.slice(),
      })),
      weight_total: 100,
      reason_min: SCORECARD_REASON_MIN,
      adjust_reason_min: SCORECARD_ADJUST_REASON_MIN,
      neutral_score: SCORECARD_NEUTRAL_SCORE,
      items: cfg.criteria.map((i) => ({
        key: i.key, label: i.label, weight: i.weight, order: i.order,
        threshold: i.threshold, guide: i.guide,
        field: SCORECARD_FIELDS['score_' + i.key], note_field: SCORECARD_FIELDS['note_' + i.key],
      })),
      fields: SCORECARD_FIELDS,
      };
    })(),
    hurdle_table: {
      version: HURDLE_TABLE_VERSION,
      rows: HURDLE_META.map((h) => ({
        key: h.key, label: h.label, unit: h.unit, comparator: h.comparator, basis: h.basis,
      })),
    },
    // Overall pre-screening quality score (W3-09 / SCO-01): the six components,
    // their weights, the band thresholds and the revision. Advisory only.
    quality_score: (() => {
      const qcfg = qualityScoreConfig || defaultQualityScoreConfig();
      return {
        version: qcfg.version,
        revision: qcfg.revision,
        weight_total: QUALITY_WEIGHT_TOTAL,
        advisory: true,
        components: qcfg.components.map((c) => ({ key: c.key, label: c.label, weight: c.weight, source: c.source, description: c.description })),
        bands: qcfg.bands.map((b) => ({ key: b.key, label: b.label, min: b.min, tone: b.tone })),
      };
    })(),
    sourcing_channels: SOURCING_CHANNELS.map((c) => ({
      value: c.value, label: c.label, related_by_default: c.related_by_default,
      compressed_timeline: c.value === COMPRESSED_TIMELINE_CHANNEL,
    })),
    // Portfolio register (W4-01 / ENT-04): the cluster taxonomy, capability
    // vocabulary and version in force, so the register UI and the advisory
    // synergy / conflict checks read one source.
    portfolio_register: {
      version: portfolioRegister.version,
      revision: portfolioRegister.revision,
      company_count: (portfolioRegister.companies || []).length,
      clusters: (portfolioRegister.clusters || PORTFOLIO_CLUSTERS).map((c) => ({ key: c.key, label: c.label })),
      capability_vocabulary: portfolioRegister.capability_vocabulary || PORTFOLIO_CAPABILITY_VOCABULARY,
      statuses: PORTFOLIO_STATUSES,
    },
    // Sirius group mandate (W4-04 / ENT-03): the versioned mandate in force -
    // sectors in scope, geography posture, stage / instrument policy, ticket band
    // and the 1bn-people objective - served so the form, the panel and the memo
    // read one source. Advisory reference data; it never gates a submission.
    mandate: {
      version: mandateConfig.version,
      revision: mandateConfig.revision,
      sectors: mandateConfig.sectors,
      geography: mandateConfig.geography,
      stages: mandateConfig.stages,
      instruments: mandateConfig.instruments,
      ticket: mandateConfig.ticket,
      objective: mandateConfig.objective,
      clusters: (mandateConfig.clusters || []).map((c) => ({ key: c.key, label: c.label, portfolio: c.portfolio })),
    },
    // Document checklist (W5-01 / DOC-01): the tier vocabulary and the version
    // in force, so the admin checklist UI and the generated per-opportunity
    // checklist read one source.
    document_checklist: {
      version: checklistConfig.version,
      revision: checklistConfig.revision,
      tiers: CHECKLIST_TIERS,
      rule_keys: CHECKLIST_RULE_KEYS,
      item_count: (checklistConfig.items || []).length,
    },
    // Content sufficiency check (W5-03 / DOC-04): the advisory rule vocabulary
    // and the revision in force, so the preparer card, the reviewer card and
    // the admin editor read one source.
    sufficiency: {
      version: sufficiencyConfig.version,
      revision: sufficiencyConfig.revision,
      min_history_years: sufficiencyConfig.min_history_years,
      categories: SUFFICIENCY_CATEGORIES,
      rules: sufficiencyConfig.rules,
      brd_examples: SUFFICIENCY_BRD_EXAMPLES,
    },
    // Portfolio conflict / concentration (W3-10 / SCR-07) and synergy (W3-11 /
    // SCR-06): the concentration ceiling, the synergy cap, the terminology and
    // the sign-off marker, served from configuration so the board, the panel
    // and the tests read one source.
    portfolio_analysis: {
      version: PORTFOLIO_ANALYSIS_VERSION,
      concentration_max_sector_pct: CONCENTRATION_MAX_SECTOR_PCT,
      synergy_max_results: SYNERGY_MAX_RESULTS,
      signoff_marker: SYNERGY_SIGNOFF_MARKER,
      synergy_kinds: SYNERGY_KINDS.map((k) => ({ key: k.key, label: k.label })),
      conflict_kinds: CONFLICT_KINDS.map((k) => ({ key: k.key, label: k.label, severity: k.severity })),
    },
    attestations: ATTESTATION_ROLES.map((a) => ({
      key: a.key, role: a.role, label: a.label, short: a.short,
      text: attestationTexts[a.key],
    })),
    // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08): the
    // verdicts, the evidence document key, the note minimum and the captured
    // fields, served from configuration so the form, the panel and the tests
    // read one source.
    adverse_media: {
      version: ADVERSE_MEDIA_VERSION,
      statuses: ADVERSE_MEDIA_STATUSES.map((s) => ({ value: s, label: s })),
      notes_min: ADVERSE_MEDIA_NOTES_MIN,
      evidence_doc_key: ADVERSE_MEDIA_EVIDENCE_DOC_KEY,
      fields: ADVERSE_MEDIA_FIELDS,
      messages: ADVERSE_MEDIA_MESSAGES,
    },
  });
});

// Evaluate the pre-form self-screen (W1-01 / INT-02) for an opportunity's org,
// enriching with the owning org's effective theme so the advisory sector flag is
// grounded in the mandate. Read-only; never writes.
async function evaluateSelfScreenFor(data, ownerOrgId) {
  const theme = ownerOrgId ? await getEffectiveTheme(ownerOrgId).catch(() => null) : null;
  const input = { ...data, related_party: (data && data.related_party) || relatedPartyAnswerFromData(data || {}) };
  return evaluateSelfScreen(input, { theme });
}

async function loadOpportunity(id, actor) {
  const { rows } = await pool.query(
    'SELECT * FROM entity_record WHERE entity = $1 AND id = $2 AND deleted = false',
    [OPPORTUNITY_ENTITY, id]
  );
  const row = rows[0];
  if (!row) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  if (!canViewOrg(actor.membership, row.owner_org_id, { descendantIds: actor.descendant_ids, grantedOrgIds: actor.granted_org_ids })) {
    const e = new Error('Not permitted to view this opportunity'); e.status = 403; throw e;
  }
  return row;
}

gateRouter.get('/requirements', async (req, res) => {
  try {
    const orgId = req.query.org_id || req.actor.org_id;
    if (!isCrossOrgReader(req.actor.membership) && orgId !== req.actor.org_id && !req.actor.descendant_ids.includes(orgId)) {
      return res.status(403).json({ error: 'Not permitted to view those requirements' });
    }
    res.json({ org_id: orgId, storage: storageInfo(), requirements: await listRequirements(orgId) });
  } catch (err) { sendErr(res, err); }
});

gateRouter.post('/requirements', async (req, res) => {
  try {
    if (!isCrossOrgReader(req.actor.membership) && req.actor.roles?.[0] !== 'admin') {
      // Only admins/cross-org configurers may edit the requirement set.
      if (!req.actor.roles?.includes('admin')) return res.status(403).json({ error: 'Admin role required' });
    }
    const body = req.body || {};
    if (!body.key || !body.label) return res.status(400).json({ error: 'key and label are required' });
    const saved = await upsertRequirement({
      orgId: body.org_id || null,
      key: body.key,
      label: body.label,
      description: body.description,
      required: body.required !== false,
      sortOrder: body.sort_order || 0,
    }, { actor: req.actor });
    res.status(201).json(saved);
  } catch (err) { sendErr(res, err); }
});

gateRouter.get('/opportunities/:id/documents', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    res.json(await listDocuments(opp.id));
  } catch (err) { sendErr(res, err); }
});

gateRouter.post('/opportunities/:id/documents', upload.single('file'), async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!canWriteOrg(req.actor.membership, opp.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to add documents to this opportunity' });
    }
    const requirementKey = req.body?.requirement_key;
    const doc = await addDocumentVersion({
      opportunityId: opp.id,
      ownerOrgId: opp.owner_org_id,
      requirementKey,
      file: req.file,
      actor: req.actor,
    });
    // When the mandatory financials pack is uploaded, parse the three-statement
    // model (W2-02 / FIN-02) and persist the summary on the opportunity so the
    // gate can check presence and the balance-sheet equality without re-reading
    // the file. A non-template / unbalanced model is stored flagged, never
    // rejected, so the upload still succeeds and an analyst reviews it.
    if (requirementKey === STATEMENT_MODEL_REQUIREMENT_KEY && req.file?.buffer) {
      try {
        const parsed = parseStatementModel({
          buffer: req.file.buffer,
          filename: req.file.originalname || '',
          mimetype: req.file.mimetype || '',
        });
        const patched = { ...(opp.data || {}), statement_model: parsed };
        await pool.query(
          'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
          [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
        );
        await writeAudit({
          entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'statement_model_parsed',
          actor: req.actor, orgId: opp.owner_org_id,
          after: {
            format: parsed.format, template: parsed.template,
            balanced: parsed.balance?.balanced, imbalances: parsed.balance?.imbalances?.length || 0,
            missing_statements: parsed.missing_statements,
          },
          comment: 'Three-statement model parsed on upload (W2-02)',
        });
      } catch (err) {
        // Parsing must never fail the upload; record and continue.
        console.warn('[gate] statement-model parse failed:', err.message);
      }
    }
    res.status(201).json(doc);
  } catch (err) { sendErr(res, err); }
});

gateRouter.delete('/documents/:id', async (req, res) => {
  try { res.json(await deleteDocument(req.params.id, { actor: req.actor })); }
  catch (err) { sendErr(res, err); }
});

gateRouter.get('/opportunities/:id/status', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    const theme = await getEffectiveTheme(opp.owner_org_id).catch(() => null);
    const gate = await evaluateGate(opp, { orgId: opp.owner_org_id, theme });
    res.json({ opportunity_id: opp.id, state: opp.data?.status || 'draft', gate });
  } catch (err) { sendErr(res, err); }
});

// Pre-form self-screen (W1-01 / INT-02). Evaluates the six answers against the
// floor/appetite rules for the requesting user's org; when an opportunity id is
// supplied its owning org's theme grounds the advisory sector flag. Read-only, so
// the preparer can see the decision and stop reason before opening the form.
gateRouter.post('/self-screen', async (req, res) => {
  try {
    const body = req.body || {};
    let ownerOrgId = body.org_id || req.actor.org_id;
    if (body.opportunity_id) {
      const opp = await loadOpportunity(body.opportunity_id, req.actor);
      ownerOrgId = opp.owner_org_id;
    }
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : body;
    const result = await evaluateSelfScreenFor(answers, ownerOrgId);
    res.json(result);
  } catch (err) { sendErr(res, err); }
});

// Submit for screening — the document gate is enforced here, server-side.
// The CEO + CFO attestation gate (W1-06 / INT-09). Each named attestation is
// recorded separately: it stores the person who signed, the role they signed
// in, the timestamp and the source IP, and is written to the immutable audit
// trail. Any user who holds the matching role for the owning org (or an admin)
// may record their own attestation; nobody may record another person's.
gateRouter.post('/opportunities/:id/attestations/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').toLowerCase();
    const spec = ATTESTATION_ROLES.find((a) => a.key === key);
    if (!spec) return res.status(404).json({ error: 'Unknown attestation "' + req.params.key + '"' });

    const opp = await loadOpportunity(req.params.id, req.actor);
    const canWrite = canWriteOrg(req.actor.membership, opp.owner_org_id, {
      descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids,
    });
    const holdsRole = (req.actor.roles || []).includes(spec.role) || (req.actor.roles || []).includes('admin');
    if (!canWrite || !holdsRole) {
      return res.status(403).json({
        error: 'Only the ' + spec.label + ' for this subsidiary may record this attestation',
      });
    }
    const state = opp.data?.status || 'draft';
    if (!SUBMITTABLE_STATES.includes(state)) {
      return res.status(409).json({ error: 'Attestations can only be recorded on a draft or returned opportunity', state });
    }

    const texts = await loadAttestationTexts();
    const body = req.body || {};
    // The stored wording is the configurable text at the moment of signing, so
    // a later change to the wording cannot rewrite history.
    const text = typeof body.text === 'string' && body.text.trim() !== '' ? body.text : texts[spec.key];
    const record = {
      by: req.actor.email,
      name: req.actor.full_name || req.actor.email,
      role: spec.role,
      at: new Date().toISOString(),
      ip: req.ip || req.actor.ip || null,
      text,
    };
    const existing = opp.data?.attestations && typeof opp.data.attestations === 'object' ? opp.data.attestations : {};
    const attestations = { ...existing, [spec.key]: record };
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify({ ...opp.data, attestations }), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'attestation_recorded',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { key: spec.key, role: spec.role, at: record.at, ip: record.ip },
      comment: spec.label + ' attestation recorded (W1-06)',
    });
    const evaluated = evaluateAttestations({ ...opp.data, attestations }, { texts });
    res.status(201).json({ ok: true, attestations: evaluated, record });
  } catch (err) { sendErr(res, err); }
});

// Submit for screening — the document gate is enforced here, server-side.
gateRouter.post('/opportunities/:id/submit', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!canWriteOrg(req.actor.membership, opp.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to submit this opportunity' });
    }
    const state = opp.data?.status || 'draft';
    if (!SUBMITTABLE_STATES.includes(state)) {
      return res.status(409).json({ error: 'Only a draft or returned opportunity can be submitted', state });
    }
    const theme = await getEffectiveTheme(opp.owner_org_id).catch(() => null);
    const gate = await evaluateGate(opp, { orgId: opp.owner_org_id, theme });

    // The pre-form self-screen is a hard gate (W1-01 / INT-02, REQ-RULE-02/04):
    // an outside-appetite type, or a ticket below the floor without the
    // exception route, cannot be submitted at all.
    if (gate.self_screen?.blocked) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { self_screen_stops: gate.self_screen.stops.map((s) => s.code) },
        comment: 'Self-screen halted the submission (W1-01)',
      });
      return res.status(422).json({
        error: 'Submission blocked: the opportunity did not pass the self-screen',
        gate,
        self_screen: gate.self_screen,
      });
    }
    if (!gate.complete) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state }, after: { missing: gate.missing.map((m) => m.key) },
        comment: 'Document gate blocked submission',
      });
      return res.status(422).json({ error: 'Submission blocked: required information is missing', gate });
    }
    // The below-floor exception route (W1-02 / INT-03): a sub-floor ticket that
    // chose the exception must also carry a synergy statement and a base IRR at
    // or above the 35% bar before it may be submitted.
    if (gate.below_floor?.applies && !gate.below_floor.satisfied) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { below_floor_stops: gate.below_floor.stops.map((s) => s.code) },
        comment: 'Below-floor exception route not satisfied',
      });
      return res.status(422).json({
        error: 'Submission blocked: the below-floor exception route needs a synergy statement and an IRR of at least ' + gate.below_floor.irr_threshold + '%',
        gate,
        below_floor: gate.below_floor,
      });
    }
    // The ten qualifying gates (W1-05 / INT-08): every gate must be answered YES
    // with its evidence linked. A single NO - or missing evidence - blocks the
    // submission with the not-ready message naming the gates still open.
    if (!gate.qualifying_gates?.complete) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { qualifying_gates_blocking: gate.qualifying_gates.blocking.map((g) => g.key) },
        comment: 'Qualifying gates not ready (W1-05)',
      });
      return res.status(422).json({
        error: QUALIFYING_GATE_NOT_READY,
        gate,
        qualifying_gates: gate.qualifying_gates,
      });
    }
    // The CEO + CFO attestation gate (W1-06 / INT-09): both named attestations
    // must be recorded before submission. Each carries the person, the
    // timestamp and the IP captured when it was signed.
    if (!gate.attestations?.complete) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { attestations_missing: gate.attestations.missing },
        comment: 'CEO/CFO attestations not recorded (W1-06)',
      });
      return res.status(422).json({
        error: ATTESTATION_REQUIRED_MESSAGE,
        gate,
        attestations: gate.attestations,
      });
    }
    // The greenfield extra tests (W1-07 / INT-10): a greenfield / new venture
    // without a secured funding source (or missing its stage / benefit / thesis)
    // cannot be submitted. This runs last so the more specific gates above name
    // their own blockers first.
    if (gate.greenfield?.applies && !gate.greenfield.satisfied) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { greenfield_stops: gate.greenfield.stops.map((s) => s.code) },
        comment: 'Greenfield extra tests not cleared (W1-07)',
      });
      return res.status(422).json({
        error: GREENFIELD_NOT_READY,
        gate,
        greenfield: gate.greenfield,
      });
    }
    // The sourcing channel is mandatory (W1-08 / INT-05): without a recognised
    // channel the submission cannot proceed, because the channel drives the
    // related-party auto-flag and the compressed-timeline indicator.
    if (!gate.sourcing_channel?.satisfied) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { sourcing_channel_stops: gate.sourcing_channel.stops.map((s) => s.code) },
        comment: 'Sourcing channel missing or unrecognised (W1-08)',
      });
      return res.status(422).json({
        error: SOURCING_CHANNEL_MESSAGES.required,
        gate,
        sourcing_channel: gate.sourcing_channel,
      });
    }
    // Budget status (W2-07 / FIN-07): an off-budget deal must carry its variance
    // justification (the variance memo is enforced through the document gate
    // above). Runs after the more specific gates so they name their own blockers
    // first.
    if (!gate.budget_status?.satisfied) {
      await writeAudit({
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit_blocked',
        actor: req.actor, orgId: opp.owner_org_id,
        before: { status: state },
        after: { budget_status_stops: gate.budget_status.stops.map((s) => s.code) },
        comment: 'Budget status not satisfied (W2-07)',
      });
      return res.status(422).json({
        error: gate.budget_status.message || BUDGET_MESSAGES.answer_required,
        gate,
        budget_status: gate.budget_status,
      });
    }
    const now = new Date().toISOString();
    const belowFloorTagged = Boolean(gate.below_floor?.satisfied);
    const sourcingTags = Array.isArray(gate.sourcing_channel?.tags) ? gate.sourcing_channel.tags : [];
    const patched = {
      ...opp.data,
      status: 'submission', status_entered_at: now, submitted_at: now, submitted_by: req.actor.email,
      ...(sourcingTags.length
        ? {
            sourcing_tags: sourcingTags,
            related_party_auto_flag: gate.sourcing_channel.related_party_auto_flag ? true : undefined,
            compressed_timeline: gate.sourcing_channel.compressed_timeline ? true : undefined,
          }
        : {}),
      ...(belowFloorTagged
        ? {
            below_floor_exception: true,
            below_floor_tag: gate.below_floor.tag,
            below_floor_escalated: true,
            below_floor_escalated_at: now,
          }
        : {}),
    };
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await pool.query(
      'INSERT INTO pipeline_transition (id, opportunity_id, owner_org_id, from_state, to_state, actor_email, comment) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uuid(), opp.id, opp.owner_org_id, state, 'submission', req.actor.email,
       belowFloorTagged ? 'Below-floor exception route' : null]
    );
    // Escalate a below-floor exception to Sirius so it cannot close at
    // subsidiary level (INT-03). Delivery is best-effort; the notification is
    // recorded regardless.
    if (belowFloorTagged) {
      await notify({
        to: 'deal.lead@sirius.local',
        kind: 'below_floor_escalation',
        subject: 'Below-floor exception: ' + (patched.opportunity_name || opp.id),
        body: BELOW_FLOOR_ESCALATION.note + ' Synergy: ' + (patched.below_floor_synergy_case || '(not supplied)'),
        entity: OPPORTUNITY_ENTITY, entityId: opp.id, orgId: opp.owner_org_id, actor: req.actor,
        deliver: false,
      }).catch((err) => console.warn('[gate] below-floor escalation notify failed:', err.message));
    }
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'submit',
      actor: req.actor, orgId: opp.owner_org_id,
      before: { status: state },
      after: { status: 'submission', ...(belowFloorTagged ? { below_floor_tag: gate.below_floor.tag, escalated: true } : {}) },
    });
    res.json({ ok: true, state: 'submission', below_floor: gate.below_floor || null, opportunity: { ...patched, id: opp.id } });
  } catch (err) { sendErr(res, err); }
});

// Gate 1 hard-filter reviewer decision (W3-02 / SCR-03, SCR-09). The system
// recommends decline when a hard filter fails; it never rejects on its own. A
// reviewer with write access to the owning org either confirms the decline or
// overrides it, and both require a written reason. The decision is stored on the
// opportunity and audited so the memo and the history can show who decided what.
gateRouter.post('/opportunities/:id/hard-filter-review', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!canWriteOrg(req.actor.membership, opp.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to review the hard filters for this opportunity' });
    }
    const review = buildHardFilterReview(req.body || {}, { actor: req.actor });
    const theme = await getEffectiveTheme(opp.owner_org_id).catch(() => null);
    const patched = { ...opp.data, [HARD_FILTER_REVIEW_TAG]: review };
    const gate = await evaluateGate({ ...opp, data: patched }, { orgId: opp.owner_org_id, theme });
    if (gate.hard_filters?.recommended_outcome !== 'recommended_decline') {
      return res.status(409).json({ error: 'No hard filter failed, so there is no recommended decline to confirm or override' });
    }
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'hard_filter_' + review.decision,
      actor: req.actor, orgId: opp.owner_org_id,
      after: { decision: review.decision, reason: review.reason, failed: (gate.hard_filters.failed || []).map((f) => f.key) },
    });
    res.json({ ok: true, opportunity_id: opp.id, review, hard_filters: { ...gate.hard_filters, review } });
  } catch (err) { sendErr(res, err); }
});

// The hard-filter reviewer decision history for an opportunity (audit trail).
gateRouter.get('/opportunities/:id/hard-filter-review/history', async (req, res) => {
  try {
    await loadOpportunity(req.params.id, req.actor);
    const events = await listAuditEvents({ entity: OPPORTUNITY_ENTITY, entityId: req.params.id, limit: 50 });
    res.json(events.filter((e) => String(e.action || '').startsWith('hard_filter_')));
  } catch (err) { sendErr(res, err); }
});

// Gate 1 soft-filter reviewer decision (W3-03 / SCR-04). The system proposes a
// 1-5 score for each of the three soft filters from the structured data; the
// reviewer confirms or adjusts each score and every score carries a written
// rationale. Soft filters are scored, never used to kill a deal, so there is no
// recommended-decline branch here. The decision is stored on the opportunity
// and audited so the memo and the history can show who decided what.
gateRouter.post('/opportunities/:id/soft-filter-review', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!canWriteOrg(req.actor.membership, opp.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to review the soft filters for this opportunity' });
    }
    const review = buildSoftFilterReview(req.body || {}, { actor: req.actor });
    const patched = { ...opp.data, [SOFT_FILTER_REVIEW_TAG]: review };
    const gate = await evaluateGate({ ...opp, data: patched }, { orgId: opp.owner_org_id });
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'soft_filter_' + review.decision,
      actor: req.actor, orgId: opp.owner_org_id,
      after: { decision: review.decision, scores: review.scores, outcome: gate.soft_filters?.outcome },
    });
    res.json({ ok: true, opportunity_id: opp.id, review, soft_filters: { ...gate.soft_filters, review } });
  } catch (err) { sendErr(res, err); }
});

// The soft-filter reviewer decision history for an opportunity (audit trail).
gateRouter.get('/opportunities/:id/soft-filter-review/history', async (req, res) => {
  try {
    await loadOpportunity(req.params.id, req.actor);
    const events = await listAuditEvents({ entity: OPPORTUNITY_ENTITY, entityId: req.params.id, limit: 50 });
    res.json(events.filter((e) => String(e.action || '').startsWith('soft_filter_')));
  } catch (err) { sendErr(res, err); }
});

// Automatic disqualifier clear (W3-04 / SCR-05). The system raises a named flag
// and never clears it on its own. A reviewer with write access to the owning org
// clears one or more flags, each with a named reviewer and a reason, and the
// clear is stored on the opportunity and audited.
gateRouter.post('/opportunities/:id/disqualifier-review', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!canWriteOrg(req.actor.membership, opp.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to clear the disqualifier flags for this opportunity' });
    }
    const review = buildDisqualifierReview(req.body || {}, { actor: req.actor });
    const relatedPartySignal = relatedPartyAnswerFromData(opp.data) === 'yes' && isBlank(opp.data.related_party_disclosure)
      ? { status: 'detected', disclosed: false }
      : null;
    const current = evaluateDisqualifiers(opp.data, { relatedParty: relatedPartySignal });
    const flags = current.flagged.map((f) => f.key);
    const unknown = review.clears.map((c) => c.key).filter((k) => !flags.includes(k));
    if (unknown.length) {
      return res.status(409).json({ error: 'No flag is raised for: ' + unknown.join(', ') });
    }
    // Merge with any earlier clears so a second call adds rather than replaces.
    const prior = Array.isArray(opp.data[DISQUALIFIER_REVIEW_TAG]?.cleared) ? opp.data[DISQUALIFIER_REVIEW_TAG].cleared : [];
    const merged = prior.filter((c) => !review.clears.some((n) => n.key === c.key)).concat(review.clears);
    const tagged = { clears: merged, cleared: merged, by: review.by, at: review.at };
    const patched = { ...opp.data, [DISQUALIFIER_REVIEW_TAG]: tagged };
    const gate = await evaluateGate({ ...opp, data: patched }, { orgId: opp.owner_org_id });
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'disqualifier_cleared',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { cleared: review.clears.map((c) => c.key), remaining: gate.disqualifiers?.open_flags?.map((f) => f.key) || [], by: review.by },
    });
    res.json({ ok: true, opportunity_id: opp.id, review: tagged, disqualifiers: { ...gate.disqualifiers, review: tagged } });
  } catch (err) { sendErr(res, err); }
});

// The disqualifier clear history for an opportunity (audit trail).
gateRouter.get('/opportunities/:id/disqualifier-review/history', async (req, res) => {
  try {
    await loadOpportunity(req.params.id, req.actor);
    const events = await listAuditEvents({ entity: OPPORTUNITY_ENTITY, entityId: req.params.id, limit: 50 });
    res.json(events.filter((e) => String(e.action || '').startsWith('disqualifier_')));
  } catch (err) { sendErr(res, err); }
});

// Gate 2 weighted scorecard capture (W3-05 / SCO-02). The seven criteria are
// scored 1-5; the weighted total clears a 3.5 pass bar. The capture is stored on
// the opportunity and audited so the board and the memo show who scored what.
gateRouter.post('/opportunities/:id/scorecard', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!canWriteOrg(req.actor.membership, opp.owner_org_id, { descendantIds: req.actor.descendant_ids, grantedOrgIds: req.actor.granted_org_ids })) {
      return res.status(403).json({ error: 'Not permitted to score the Gate 2 scorecard for this opportunity' });
    }
    // The system proposals are computed from the data already on the record so
    // the capture can keep both the proposal and the final score and enforce a
    // written comment on any adjustment (W3-07 / SCO-03).
    const gateProposed = await evaluateGate(opp, { orgId: opp.owner_org_id });
    const proposals = Object.fromEntries((gateProposed.scorecard?.items || []).map((i) => [i.key, i.proposed_score]));
    const scConfig = await loadScorecardConfig();
    const capture = buildScorecard(req.body || {}, { actor: req.actor, proposals, criteria: scConfig.criteria, version: scConfig.version });
    const patched = { ...opp.data, [SCORECARD_TAG]: capture };
    const gate = await evaluateGate({ ...opp, data: patched }, { orgId: opp.owner_org_id });
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'scorecard_scored',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { scores: capture.scores, proposed_scores: capture.proposed_scores, adjusted: capture.adjusted, total: gate.scorecard?.total, outcome: gate.scorecard?.outcome, version: capture.version },
    });
    res.json({ ok: true, opportunity_id: opp.id, scorecard: { ...gate.scorecard, capture } });
  } catch (err) { sendErr(res, err); }
});

// The Gate 2 CIO override memo (W3-05 / SCO-02, REQ-GATE-02). A below-bar
// weighted total cannot proceed to Gate 3 without an explicit CIO override
// memo: a named CIO and a written reason. Requires the CIO (or admin) role.
gateRouter.post('/opportunities/:id/scorecard-override', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    if (!(req.actor.roles || []).some((r) => r === 'cio' || r === 'admin')) {
      return res.status(403).json({ error: 'The CIO override memo requires the CIO role' });
    }
    const gateBefore = await evaluateGate(opp, { orgId: opp.owner_org_id });
    if (gateBefore.scorecard?.complete && gateBefore.scorecard.outcome === 'proceed') {
      return res.status(409).json({ error: 'The weighted total clears the pass bar; no override memo is required' });
    }
    const override = buildScorecardOverride(req.body || {}, { actor: req.actor });
    const patched = { ...opp.data, [SCORECARD_OVERRIDE_TAG]: override };
    const gate = await evaluateGate({ ...opp, data: patched }, { orgId: opp.owner_org_id });
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'scorecard_override',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { total: gate.scorecard?.total, outcome: gate.scorecard?.outcome, by: override.by, reason: override.reason },
    });
    res.json({ ok: true, opportunity_id: opp.id, override, scorecard: { ...gate.scorecard, override } });
  } catch (err) { sendErr(res, err); }
});

// The Gate 2 scorecard and override history for an opportunity (audit trail).
gateRouter.get('/opportunities/:id/scorecard/history', async (req, res) => {
  try {
    await loadOpportunity(req.params.id, req.actor);
    const events = await listAuditEvents({ entity: OPPORTUNITY_ENTITY, entityId: req.params.id, limit: 50 });
    res.json(events.filter((e) => String(e.action || '').startsWith('scorecard_')));
  } catch (err) { sendErr(res, err); }
});

// The content sufficiency check for an opportunity (W5-03 / DOC-04). Advisory:
// it returns the per-rule status, the flagged and open sets and the reviewer
// overrides. Read by the preparer pre-submit and the reviewer post.
gateRouter.get('/opportunities/:id/sufficiency', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    const gate = await evaluateGate(opp, { orgId: opp.owner_org_id });
    res.json(gate.sufficiency);
  } catch (err) { sendErr(res, err); }
});

// A reviewer override of a sufficiency flag (W5-03 / DOC-04, REQ-DOCGATE). A
// flag is advisory, so a reviewer may clear it with a written reason; the
// override is stored on the opportunity and recorded on the audit trail. Any
// reviewer, CIO or admin may override, matching the reviewer-post step.
gateRouter.post('/opportunities/:id/sufficiency-override', async (req, res) => {
  try {
    const opp = await loadOpportunity(req.params.id, req.actor);
    const roles = req.actor.roles || [];
    if (!roles.some((r) => ['independent_reviewer', 'reviewer', 'cio', 'admin', 'leadership'].includes(r)) && !canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'A reviewer role is required to override a sufficiency flag' });
    }
    const key = String(req.body?.key || '').trim();
    if (!SUFFICIENCY_RULE_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Unknown sufficiency rule: ' + (key || '(none)') });
    }
    const gateBefore = await evaluateGate(opp, { orgId: opp.owner_org_id });
    const flagged = (gateBefore.sufficiency?.flags || []).find((f) => f.key === key);
    if (!flagged) {
      return res.status(409).json({ error: 'That sufficiency rule is not currently flagged, so there is nothing to override' });
    }
    const override = buildSufficiencyOverride(req.body || {}, { actor: req.actor });
    const existing = sufficiencyOverridesFromData(opp.data);
    const patched = {
      ...opp.data,
      [SUFFICIENCY_OVERRIDE_TAG]: { ...existing, [key]: { ...override, key } },
    };
    const gate = await evaluateGate({ ...opp, data: patched }, { orgId: opp.owner_org_id });
    await pool.query(
      'UPDATE entity_record SET data = $3, updated_date = now(), updated_by = $4 WHERE entity = $1 AND id = $2',
      [OPPORTUNITY_ENTITY, opp.id, JSON.stringify(patched), req.actor.email]
    );
    await writeAudit({
      entity: OPPORTUNITY_ENTITY, entityId: opp.id, action: 'sufficiency_override',
      actor: req.actor, orgId: opp.owner_org_id,
      after: { key, by: override.by, reason: override.reason, open_flags: gate.sufficiency?.open_count ?? 0 },
    });
    res.json({ ok: true, opportunity_id: opp.id, override, sufficiency: gate.sufficiency });
  } catch (err) { sendErr(res, err); }
});

// The sufficiency override history for an opportunity (audit trail).
gateRouter.get('/opportunities/:id/sufficiency/history', async (req, res) => {
  try {
    await loadOpportunity(req.params.id, req.actor);
    const events = await listAuditEvents({ entity: OPPORTUNITY_ENTITY, entityId: req.params.id, limit: 50 });
    res.json(events.filter((e) => String(e.action || '').startsWith('sufficiency_')));
  } catch (err) { sendErr(res, err); }
});

// The effective Gate 2 scorecard configuration (W3-08 / SCO-05). Any
// authenticated reader can inspect the criteria, weights, pass bar, lenses and
// revision currently in force; the validation report is returned alongside so
// the admin editor can show why a draft is invalid.
gateRouter.get('/scorecard-config', async (_req, res) => {
  try {
    const config = await loadScorecardConfig();
    const { ok, errors } = validateScorecardConfig(config);
    res.json({ config, valid: ok, errors, defaults: defaultScorecardConfig() });
  } catch (err) { sendErr(res, err); }
});

// Recalibrate the Gate 2 scorecard (W3-08 / SCO-05). Requires the admin /
// configurator role. A valid payload mints a new revision and is persisted to
// AppSettings; opportunities captured under an earlier revision keep that
// version, so historical scores are never silently recalculated.
gateRouter.put('/scorecard-config', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the scorecard configuration' });
    }
    const base = await loadScorecardConfig();
    const config = buildScorecardConfig(req.body || {}, { actor: req.actor, base });
    const changes = diffScorecardConfig(base, config);
    const payload = {
      setting_key: SCORECARD_CONFIG_KEY,
      setting_value: JSON.stringify(config),
      description: 'Gate 2 scorecard criteria, weights, thresholds and lenses',
      last_updated_by: req.actor.email,
    };
    const { rows: existing } = await pool.query(
      `SELECT id FROM entity_record
       WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
      [SCORECARD_CONFIG_KEY]
    );
    let record;
    if (existing[0]) {
      record = await pool.query(
        `UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3
         WHERE id = $1 RETURNING *`,
        [existing[0].id, JSON.stringify(payload), req.actor.email]
      );
    } else {
      record = await pool.query(
        `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
         VALUES ($1,'AppSettings',$2,$3,$4,$4) RETURNING *`,
        ['scorecard-config-' + Date.now().toString(36), req.actor.org_id, JSON.stringify(payload), req.actor.email]
      );
    }
    await writeAudit({
      entity: 'AppSettings',
      entityId: existing[0]?.id || record.rows[0].id,
      action: 'scorecard_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version, changes },
    });
    res.json({ ok: true, config, changes, saved: true });
  } catch (err) { sendErr(res, err); }
});

// The scorecard-configuration revision history (audit trail).
gateRouter.get('/scorecard-config/history', async (req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'scorecard_config_updated'));
  } catch (err) { sendErr(res, err); }
});

// The effective pre-screening quality-score configuration (W3-09 / SCO-01). Any
// authenticated reader can inspect the component weights and bands in force.
gateRouter.get('/quality-score-config', async (_req, res) => {
  try {
    const config = await loadQualityScoreConfig();
    const { ok, errors } = validateQualityScoreConfig(config);
    res.json({ config, valid: ok, errors, defaults: defaultQualityScoreConfig() });
  } catch (err) { sendErr(res, err); }
});

// Recalibrate the quality-score weights and bands (W3-09 / SCO-01). Requires the
// admin / configurator role. A valid payload mints a new revision and is
// persisted to AppSettings; the score is advisory and never takes a decision.
gateRouter.put('/quality-score-config', async (req, res) => {
  try {
    if (!canConfigure(req.actor.membership)) {
      return res.status(403).json({ error: 'Administrator role required to change the quality-score configuration' });
    }
    const base = await loadQualityScoreConfig();
    const config = buildQualityScoreConfig(req.body || {}, { actor: req.actor, base });
    const payload = {
      setting_key: QUALITY_SCORE_CONFIG_KEY,
      setting_value: JSON.stringify(config),
      description: 'Pre-screening quality-score component weights and bands',
      last_updated_by: req.actor.email,
    };
    const { rows: existing } = await pool.query(
      `SELECT id FROM entity_record
       WHERE entity = 'AppSettings' AND data->>'setting_key' = $1 AND deleted = false LIMIT 1`,
      [QUALITY_SCORE_CONFIG_KEY]
    );
    let record;
    if (existing[0]) {
      record = await pool.query(
        `UPDATE entity_record SET data = $2, updated_date = now(), updated_by = $3
         WHERE id = $1 RETURNING *`,
        [existing[0].id, JSON.stringify(payload), req.actor.email]
      );
    } else {
      record = await pool.query(
        `INSERT INTO entity_record (id, entity, owner_org_id, data, created_by, updated_by)
         VALUES ($1,'AppSettings',$2,$3,$4,$4) RETURNING *`,
        ['quality-score-config-' + Date.now().toString(36), req.actor.org_id, JSON.stringify(payload), req.actor.email]
      );
    }
    await writeAudit({
      entity: 'AppSettings',
      entityId: existing[0]?.id || record.rows[0].id,
      action: 'quality_score_config_updated',
      actor: req.actor, orgId: req.actor.org_id,
      before: { revision: base.revision, version: base.version },
      after: { revision: config.revision, version: config.version },
    });
    res.json({ ok: true, config, saved: true });
  } catch (err) { sendErr(res, err); }
});

gateRouter.get('/quality-score-config/history', async (req, res) => {
  try {
    const events = await listAuditEvents({ entity: 'AppSettings', limit: 50 });
    res.json(events.filter((e) => e.action === 'quality_score_config_updated'));
  } catch (err) { sendErr(res, err); }
});

export default gateRouter;
