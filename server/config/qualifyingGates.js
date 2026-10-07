// ---------------------------------------------------------------------------
// Ten qualifying gates (W1-05 / BRD INT-08).
//
// Every opportunity is screened against the ten qualifying gates before it may
// leave draft. Each gate needs an explicit YES and a linked piece of evidence
// (a captured field or an uploaded document). A single NO - or a YES with the
// evidence missing - blocks submission with an "not ready" message naming the
// gates still open.
//
// The ten gates and their evidence mapping are configuration (REQ-RULE-10): the
// capture form, the gate, the submit route and the tests all read this module.
// Evidence is taken from the structured fields the six-section pack already
// captures, so the checklist adds no parallel data entry.
// ---------------------------------------------------------------------------

import { INTAKE_FIELDS } from './intakeConfig.js';

// The stored answer field for a gate: gate_<key> = 'yes' | 'no'.
export const gateAnswerKey = (key) => 'gate_' + key;

// The ten gates in BRD order. `evidence` lists the captured fields that prove
// the gate; every listed field must be present for the gate to be ready.
export const QUALIFYING_GATES = [
  {
    number: 1, key: 'right_size', label: 'Right size',
    question: 'Is the ticket the right size for the group (clears the AED 10mn floor or carries the approved exception)?',
    evidence: [{ key: 'total_commitment_aed' }],
  },
  {
    number: 2, key: 'eligible_type', label: 'Eligible type',
    question: 'Is the opportunity an eligible type (not on the outside-appetite list)?',
    evidence: [{ key: 'opportunity_type' }],
  },
  {
    number: 3, key: 'accretive', label: 'Accretive',
    question: 'Is the deal accretive at the subsidiary and the Sirius-portfolio level?',
    evidence: [{ key: 'accretion_net_earnings_aed' }, { key: 'accretion_bps' }],
  },
  {
    number: 4, key: 'strategic_fit', label: 'Strategic fit',
    question: 'Does it fit the owning subsidiary mandate and the Sirius strategy?',
    evidence: [{ key: 'strategy_link' }],
  },
  {
    number: 5, key: 'clears_hurdles', label: 'Clears hurdles',
    question: 'Does the base case clear the return hurdles (IRR, ROIC, payback)?',
    evidence: [{ key: 'return_irr_base' }],
  },
  {
    number: 6, key: 'funded', label: 'Funded',
    question: 'Is the funding named and secured under the funding hierarchy?',
    evidence: [{ key: 'funding_source' }],
  },
  {
    number: 7, key: 'budgeted', label: 'Budgeted',
    question: 'Is the deal in the approved budget, or does it carry a variance justification?',
    evidence: [{ key: 'in_approved_budget' }],
  },
  {
    number: 8, key: 'risk_owned', label: 'Risk owned',
    question: 'Does every material risk have a named owner?',
    evidence: [{ key: 'risk_register' }],
  },
  {
    number: 9, key: 'clean_governance', label: 'Clean governance',
    question: 'Are legal, related-party and ESG screens clear (or resolved)?',
    evidence: [
      { key: 'compliance_legal' },
      { key: 'compliance_related_party' },
      { key: 'compliance_esg' },
    ],
  },
  {
    number: 10, key: 'executable', label: 'Executable',
    question: 'Can it be executed to the stated decision-by date?',
    evidence: [{ key: 'next_steps' }],
  },
];

// Human labels for the evidence fields, looked up from the capture model so the
// checklist and the form name a field identically.
const FIELD_LABELS = new Map(INTAKE_FIELDS.map((f) => [f.key, f.label]));
const fieldLabel = (key) => FIELD_LABELS.get(key) || key;

export const QUALIFYING_GATE_ANSWERS = ['yes', 'no'];

// The message shown when a gate is answered NO, per BRD INT-08.
export const QUALIFYING_GATE_NOT_READY =
  'Not ready: this opportunity is not ready to submit. Every qualifying gate must be answered YES with its evidence linked.';

const BLANK = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function truthy(value) {
  if (value === true) return true;
  if (typeof value === 'string') return ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
  return false;
}

/**
 * Evaluate the ten qualifying gates for an opportunity's data. Pure.
 *
 * Returns per-gate detail plus `complete` (all ten ready) and `blocking` (the
 * gates that are not ready). A gate is ready only when it is answered YES AND
 * every evidence field it names is present.
 */
export function evaluateQualifyingGates(data = {}) {
  const gates = QUALIFYING_GATES.map((gate) => {
    const answerRaw = data[gateAnswerKey(gate.key)];
    const answer = BLANK(answerRaw) ? null : (truthy(answerRaw) ? 'yes' : 'no');
    const evidence = gate.evidence.map((e) => ({
      key: e.key,
      label: e.label || fieldLabel(e.key),
      present: !BLANK(data[e.key]),
    }));
    const evidenceComplete = evidence.every((e) => e.present);
    const ready = answer === 'yes' && evidenceComplete;

    let reason = null;
    if (answer === null) reason = 'Not answered: answer YES with the gate evidence linked.';
    else if (answer === 'no') reason = 'Answered NO: the opportunity is not ready on "' + gate.label + '".';
    else if (!evidenceComplete) reason = 'Evidence missing: ' + evidence.filter((e) => !e.present).map((e) => e.label).join(', ') + '.';

    return {
      number: gate.number,
      key: gate.key,
      // The opportunity field the answer is saved under. The Submit page renders
      // the gate cards from this payload and writes the answer to this key.
      answer_key: gateAnswerKey(gate.key),
      label: gate.label,
      question: gate.question,
      answer,
      evidence,
      evidence_complete: evidenceComplete,
      ready,
      reason,
    };
  });

  const blocking = gates.filter((g) => !g.ready);
  return {
    complete: blocking.length === 0,
    answered: gates.every((g) => g.answer !== null),
    gates,
    blocking,
    message: blocking.length === 0 ? null : QUALIFYING_GATE_NOT_READY,
  };
}

// The answer fields for every gate, defaulted to YES with the evidence fields
// the checklist requires. Exported so the seed loader and the tests can satisfy
// the checklist without re-listing each key.
export function qualifyingGateDefaults(overrides = {}) {
  const answers = {};
  for (const gate of QUALIFYING_GATES) answers[gateAnswerKey(gate.key)] = 'yes';
  return {
    ...answers,
    // The header evidence the gates read (right size, type, funding, budget).
    total_commitment_aed: 120,
    opportunity_type: 'strategic_acquisition',
    funding_source: 'Sirius balance sheet + operating cash flow',
    in_approved_budget: 'yes',
    // The remaining evidence fields the checklist links.
    strategy_link: 'Directly advances the Sirius strategy for this vertical.',
    accretion_net_earnings_aed: 18,
    accretion_bps: 120,
    return_irr_base: 26,
    risk_register: '1. Customer concentration (owner: Deal Lead). 2. Integration execution (owner: COO).',
    compliance_legal: 'clear',
    compliance_related_party: 'clear',
    compliance_esg: 'clear',
    next_steps: 'Complete confirmatory diligence and close within two quarters.',
    ...overrides,
  };
}

// The gate answer field keys, so the form and the model agree on what to save.
export const QUALIFYING_GATE_FIELD_KEYS = QUALIFYING_GATES.map((g) => gateAnswerKey(g.key));

export default {
  QUALIFYING_GATES, QUALIFYING_GATE_ANSWERS, QUALIFYING_GATE_NOT_READY, QUALIFYING_GATE_FIELD_KEYS,
  gateAnswerKey, evaluateQualifyingGates, qualifyingGateDefaults,
};
