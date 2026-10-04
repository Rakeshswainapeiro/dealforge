// ---------------------------------------------------------------------------
// CEO + CFO attestation gate (W1-06 / BRD INT-09).
//
// Before a submission can leave draft the subsidiary CEO and CFO each sign a
// named attestation confirming that every qualifying gate is cleared and that
// the figures and funding are accurate and secured. Two separate attestations
// are required; each records the person, the timestamp and the source IP, and
// each is written to the immutable audit trail. Submission is impossible until
// both are recorded.
//
// The two roles and the attestation wording are configuration (REQ-RULE-10):
// the wording can be overridden at runtime through the AppSettings entity
// (setting_key = 'attestation_text'), and this module is the single source the
// gate, the form, the seed loader and the tests read.
// ---------------------------------------------------------------------------

// The two named attestations, in BRD order. `role` is the RBAC role that may
// sign the attestation; `key` is the stored slot on the opportunity data.
export const ATTESTATION_ROLES = [
  { key: 'ceo', role: 'subsidiary_ceo', label: 'Subsidiary CEO', short: 'CEO' },
  { key: 'cfo', role: 'subsidiary_cfo', label: 'Subsidiary CFO', short: 'CFO' },
];

export const ATTESTATION_ROLE_KEYS = ATTESTATION_ROLES.map((a) => a.key);

// The runtime setting key that overrides the default wording.
export const ATTESTATION_SETTING_KEY = 'attestation_text';

// Shipped wording. Operators may replace either text at runtime; the default is
// what the seedling and a fresh deployment use.
export const DEFAULT_ATTESTATION_TEXTS = {
  ceo:
    'I confirm that the opportunity clears every qualifying gate, that the figures and ' +
    'assumptions presented are accurate to the best of my knowledge, and that the funding ' +
    'is secured as stated.',
  cfo:
    'I confirm that the opportunity clears every qualifying gate, that the financial ' +
    'figures are accurate, and that the funding is secured and reflected in the approved ' +
    'budget.',
};

export const ATTESTATION_REQUIRED_MESSAGE =
  'Not ready: submission requires both the CEO and CFO attestations. Each must be recorded '
  + 'with the person, timestamp and IP before the opportunity can be submitted.';

// Merge runtime overrides onto the defaults, ignoring blank / unknown keys.
export function resolveAttestationTexts(runtime = {}) {
  const out = { ...DEFAULT_ATTESTATION_TEXTS };
  if (runtime && typeof runtime === 'object') {
    for (const key of ATTESTATION_ROLE_KEYS) {
      const value = runtime[key];
      if (typeof value === 'string' && value.trim() !== '') out[key] = value;
    }
  }
  return out;
}

const BLANK = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Evaluate the two attestations for an opportunity's data. Pure.
 *
 * A slot is complete only when it names the person who signed and the moment
 * they signed. Returns per-role detail plus `complete` (both recorded) and
 * `missing` (the roles still outstanding), and the resolved wording so the UI
 * can render exactly what was attested to.
 */
export function evaluateAttestations(data = {}, { texts } = {}) {
  const stored = data && typeof data.attestations === 'object' && data.attestations ? data.attestations : {};
  const wording = resolveAttestationTexts(texts);

  const roles = ATTESTATION_ROLES.map((spec) => {
    const record = stored[spec.key] || null;
    const attested = Boolean(record && !BLANK(record.by) && !BLANK(record.at));
    return {
      key: spec.key,
      role: spec.role,
      label: spec.label,
      short: spec.short,
      text: wording[spec.key],
      attested,
      record: attested ? record : null,
    };
  });

  const missing = roles.filter((r) => !r.attested);
  return {
    complete: missing.length === 0,
    roles,
    missing: missing.map((r) => r.key),
    message: missing.length === 0 ? null : ATTESTATION_REQUIRED_MESSAGE,
  };
}

// The stored attestations for every role, defaulted to signed by the shipped
// founder cast. Exported so the seed loader and the tests can satisfy the gate
// without re-listing each slot, matching qualifyingGateDefaults().
export function attestationDefaults({ at = '2026-01-05T09:00:00.000Z', ip = '10.0.0.1' } = {}) {
  const people = {
    ceo: { name: 'Infinia CEO', email: 'ceo@infinia.local' },
    cfo: { name: 'Infinia CFO', email: 'cfo@infinia.local' },
  };
  const out = {};
  for (const spec of ATTESTATION_ROLES) {
    const person = people[spec.key];
    out[spec.key] = {
      by: person.email,
      name: person.name,
      role: spec.role,
      at,
      ip,
      text: DEFAULT_ATTESTATION_TEXTS[spec.key],
    };
  }
  return out;
}

export default {
  ATTESTATION_ROLES, ATTESTATION_ROLE_KEYS, ATTESTATION_SETTING_KEY,
  DEFAULT_ATTESTATION_TEXTS, ATTESTATION_REQUIRED_MESSAGE,
  resolveAttestationTexts, evaluateAttestations, attestationDefaults,
};
