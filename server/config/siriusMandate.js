// ---------------------------------------------------------------------------
// Sirius group mandate (W4-04 / BRD ENT-03).
//
// The versioned, admin-editable group mandate behind screening: sectors in
// scope, geography posture, stage and instrument policy, ticket band, holding
// horizon, governance stance and the 1bn-people objective. Held in an
// AppSettings record (setting_key = 'sirius_mandate_config'); the shipped
// mandate is the client brief. This module is pure - it holds the default, the
// validation, the resolve fallback, the diff and the revision builder; the
// storage and the HTTP routes live in server/mandate.js.
// ---------------------------------------------------------------------------

import {
  SIRIUS_MANDATE_VERSION, SIRIUS_MANDATE_CONFIG_KEY, SIRIUS_MANDATE_DEFAULT_REVISION,
  SIRIUS_MANDATE_VERSION_PREFIX, SIRIUS_MANDATE_INSTRUMENT_KEYS, SIRIUS_MANDATE_STAGE_KEYS,
  SIRIUS_MANDATE_CLUSTERS, SIRIUS_MANDATE_SECTORS, SIRIUS_MANDATE_GEOGRAPHY,
  SIRIUS_MANDATE_OBJECTIVE, SIRIUS_MANDATE_GROWTH_VECTORS, SIRIUS_MANDATE_LOOK_FORS,
  SIRIUS_MANDATE_TICKET, SIRIUS_MANDATE_HOLDING, SIRIUS_MANDATE_GOVERNANCE,
  SIRIUS_MANDATE_DISCLAIMER,
} from './siriusMandateData.js';

export {
  SIRIUS_MANDATE_VERSION, SIRIUS_MANDATE_CONFIG_KEY, SIRIUS_MANDATE_DEFAULT_REVISION,
  SIRIUS_MANDATE_VERSION_PREFIX, SIRIUS_MANDATE_CLUSTERS, SIRIUS_MANDATE_SECTORS,
  SIRIUS_MANDATE_GEOGRAPHY, SIRIUS_MANDATE_OBJECTIVE, SIRIUS_MANDATE_GROWTH_VECTORS,
  SIRIUS_MANDATE_LOOK_FORS, SIRIUS_MANDATE_TICKET, SIRIUS_MANDATE_HOLDING,
  SIRIUS_MANDATE_GOVERNANCE, SIRIUS_MANDATE_DISCLAIMER,
};

export const SIRIUS_MANDATE_MESSAGES = {
  not_object: 'The mandate payload must be an object.',
  sectors_required: 'The mandate needs at least one sector in scope.',
  geography_required: 'The mandate needs at least one core geography.',
  stage_invalid: 'Unknown stage: ',
  instrument_invalid: 'Unknown instrument: ',
  ticket_min_positive: 'The ticket minimum must be a positive number.',
  ticket_max_above_min: 'The ticket maximum must be greater than the minimum.',
  objective_positive: 'The 1bn-people objective count must be a positive number.',
  target_year_range: 'The objective target year must be a four-digit year.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function toStrArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

// The shipped mandate, built from the client brief.
export function defaultSiriusMandate() {
  return {
    version: SIRIUS_MANDATE_VERSION,
    revision: SIRIUS_MANDATE_DEFAULT_REVISION,
    sectors: [...SIRIUS_MANDATE_SECTORS],
    geography: {
      core: [...SIRIUS_MANDATE_GEOGRAPHY.core],
      posture: SIRIUS_MANDATE_GEOGRAPHY.posture,
      markets_served: SIRIUS_MANDATE_GEOGRAPHY.markets_served,
    },
    stages: [...SIRIUS_MANDATE_STAGE_KEYS],
    instruments: [...SIRIUS_MANDATE_INSTRUMENT_KEYS],
    clusters: SIRIUS_MANDATE_CLUSTERS,
    ticket: { ...SIRIUS_MANDATE_TICKET },
    holding: { ...SIRIUS_MANDATE_HOLDING },
    objective: { ...SIRIUS_MANDATE_OBJECTIVE },
    growth_vectors: [...SIRIUS_MANDATE_GROWTH_VECTORS],
    look_fors: [...SIRIUS_MANDATE_LOOK_FORS],
    governance: SIRIUS_MANDATE_GOVERNANCE,
    disclaimer: SIRIUS_MANDATE_DISCLAIMER,
  };
}

function toTicket(row = {}, base = null) {
  const src = row.ticket || row || {};
  const min = src.min_aed ?? base?.ticket?.min_aed ?? null;
  const max = src.max_aed ?? base?.ticket?.max_aed ?? null;
  return {
    min_aed: min === null || min === '' ? null : Number(min),
    max_aed: max === null || max === '' ? null : Number(max),
    unit: src.unit || base?.ticket?.unit || 'AED m',
    note: src.note ?? base?.ticket?.note ?? null,
  };
}

function toObjective(row = {}, base = null) {
  const src = row.objective || row || {};
  return {
    statement: src.statement || base?.objective?.statement || SIRIUS_MANDATE_OBJECTIVE.statement,
    people_by_2030: src.people_by_2030 != null ? Number(src.people_by_2030) : (base?.objective?.people_by_2030 ?? SIRIUS_MANDATE_OBJECTIVE.people_by_2030),
    target_year: src.target_year != null ? Number(src.target_year) : (base?.objective?.target_year ?? SIRIUS_MANDATE_OBJECTIVE.target_year),
    note: src.note ?? base?.objective?.note ?? null,
  };
}

export function validateSiriusMandate(input, { base = null } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: [SIRIUS_MANDATE_MESSAGES.not_object], config: base || defaultSiriusMandate() };
  }
  const sectors = toStrArray(input.sectors);
  if (sectors.length === 0) errors.push(SIRIUS_MANDATE_MESSAGES.sectors_required);

  const geoIn = input.geography && typeof input.geography === 'object' ? input.geography : {};
  const core = toStrArray(geoIn.core || input.geographies);
  if (core.length === 0) errors.push(SIRIUS_MANDATE_MESSAGES.geography_required);

  const stages = toStrArray(input.stages);
  for (const s of stages) if (!SIRIUS_MANDATE_STAGE_KEYS.includes(norm(s))) errors.push(SIRIUS_MANDATE_MESSAGES.stage_invalid + s);
  const instruments = toStrArray(input.instruments);
  for (const i of instruments) if (!SIRIUS_MANDATE_INSTRUMENT_KEYS.includes(norm(i))) errors.push(SIRIUS_MANDATE_MESSAGES.instrument_invalid + i);

  const ticket = toTicket(input, base);
  if (ticket.min_aed !== null && !(ticket.min_aed > 0)) errors.push(SIRIUS_MANDATE_MESSAGES.ticket_min_positive);
  if (ticket.min_aed !== null && ticket.max_aed !== null && !(ticket.max_aed > ticket.min_aed)) {
    errors.push(SIRIUS_MANDATE_MESSAGES.ticket_max_above_min);
  }

  const objective = toObjective(input, base);
  if (!(objective.people_by_2030 > 0)) errors.push(SIRIUS_MANDATE_MESSAGES.objective_positive);
  if (!(objective.target_year >= 2000 && objective.target_year <= 2100)) errors.push(SIRIUS_MANDATE_MESSAGES.target_year_range);

  const config = {
    version: base?.version || SIRIUS_MANDATE_VERSION,
    revision: base?.revision ?? SIRIUS_MANDATE_DEFAULT_REVISION,
    sectors,
    geography: {
      core,
      posture: geoIn.posture ?? base?.geography?.posture ?? SIRIUS_MANDATE_GEOGRAPHY.posture,
      markets_served: geoIn.markets_served != null ? Number(geoIn.markets_served) : (base?.geography?.markets_served ?? SIRIUS_MANDATE_GEOGRAPHY.markets_served),
    },
    stages: stages.length ? stages.map(norm) : (base?.stages || [...SIRIUS_MANDATE_STAGE_KEYS]),
    instruments: instruments.length ? instruments.map(norm) : (base?.instruments || [...SIRIUS_MANDATE_INSTRUMENT_KEYS]),
    clusters: base?.clusters || SIRIUS_MANDATE_CLUSTERS,
    ticket,
    holding: { ...(base?.holding || SIRIUS_MANDATE_HOLDING), ...(input.holding && typeof input.holding === 'object' ? input.holding : {}) },
    objective,
    growth_vectors: toStrArray(input.growth_vectors).length ? toStrArray(input.growth_vectors) : (base?.growth_vectors || [...SIRIUS_MANDATE_GROWTH_VECTORS]),
    look_fors: toStrArray(input.look_fors).length ? toStrArray(input.look_fors) : (base?.look_fors || [...SIRIUS_MANDATE_LOOK_FORS]),
    governance: blank(input.governance) ? (base?.governance || SIRIUS_MANDATE_GOVERNANCE) : String(input.governance).trim(),
    disclaimer: base?.disclaimer || SIRIUS_MANDATE_DISCLAIMER,
  };
  return { ok: errors.length === 0, errors, config };
}

export function resolveSiriusMandate(stored) {
  if (blank(stored)) return defaultSiriusMandate();
  let parsed = stored;
  if (typeof stored === 'string') {
    try { parsed = JSON.parse(stored); } catch { return defaultSiriusMandate(); }
  }
  const res = validateSiriusMandate(parsed, { base: parsed });
  return res.ok ? res.config : defaultSiriusMandate();
}

// Name the field-level changes between two mandate revisions for the audit.
export function diffSiriusMandate(base, next) {
  const changes = [];
  const listFields = ['sectors', 'stages', 'instruments', 'growth_vectors', 'look_fors'];
  for (const f of listFields) {
    const b = new Set((base?.[f] || []).map((x) => String(x)));
    const n = new Set((next?.[f] || []).map((x) => String(x)));
    for (const x of n) if (!b.has(x)) changes.push({ field: f, op: 'added', value: x });
    for (const x of b) if (!n.has(x)) changes.push({ field: f, op: 'removed', value: x });
  }
  if (JSON.stringify(base?.geography?.core || []) !== JSON.stringify(next?.geography?.core || [])) {
    changes.push({ field: 'geography.core', op: 'changed', value: (next?.geography?.core || []).join(', ') });
  }
  for (const f of ['governance']) {
    if (String(base?.[f] ?? '') !== String(next?.[f] ?? '')) changes.push({ field: f, op: 'changed', value: next?.[f] });
  }
  if (JSON.stringify(base?.ticket || {}) !== JSON.stringify(next?.ticket || {})) {
    changes.push({ field: 'ticket', op: 'changed', value: next?.ticket });
  }
  if (JSON.stringify(base?.objective || {}) !== JSON.stringify(next?.objective || {})) {
    changes.push({ field: 'objective', op: 'changed', value: next?.objective });
  }
  return changes;
}

// Validate and mint the next revision of the mandate. Throws a 400-shaped error
// with the error list when the payload is invalid.
export function buildSiriusMandate(body, { actor = null, at = null, base = null } = {}) {
  const current = base || defaultSiriusMandate();
  const res = validateSiriusMandate(body, { base: current });
  if (!res.ok) {
    const e = new Error('Invalid Sirius mandate: ' + res.errors.join(' '));
    e.status = 400;
    e.errors = res.errors;
    throw e;
  }
  const revision = (current.revision || SIRIUS_MANDATE_DEFAULT_REVISION) + 1;
  return {
    ...res.config,
    revision,
    version: SIRIUS_MANDATE_VERSION_PREFIX + revision,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
}

// --- screening helpers -----------------------------------------------------
// Advisory fit against the mandate: whether a submission's sector and geography
// sit inside the group mandate. Reference data only - never blocks.
export function mandateFit({ sector = null, geography = null, totalCommitmentAed = null } = {}, mandate = null) {
  const m = mandate || defaultSiriusMandate();
  const inSectors = m.sectors || [];
  const coreGeo = m.geography?.core || [];
  const sectorHit = !blank(sector) && inSectors.some((s) => norm(s) === norm(sector));
  const geoHit = !blank(geography) && coreGeo.some((g) => norm(geography).includes(norm(g)));
  const amount = Number(totalCommitmentAed);
  const min = m.ticket?.min_aed;
  const max = m.ticket?.max_aed;
  const sizeHit = Number.isFinite(amount) && amount > 0
    ? (min == null || amount >= Number(min)) && (max == null || amount <= Number(max))
    : null;
  return {
    mandate_version: m.version,
    sector_in_mandate: sectorHit,
    geography_in_core: geoHit,
    size_in_ticket: sizeHit,
    in_scope: sectorHit && geoHit,
  };
}

export default {
  SIRIUS_MANDATE_VERSION, SIRIUS_MANDATE_CONFIG_KEY, SIRIUS_MANDATE_DEFAULT_REVISION,
  SIRIUS_MANDATE_VERSION_PREFIX, SIRIUS_MANDATE_MESSAGES,
  defaultSiriusMandate, validateSiriusMandate, resolveSiriusMandate, diffSiriusMandate,
  buildSiriusMandate, mandateFit,
};

