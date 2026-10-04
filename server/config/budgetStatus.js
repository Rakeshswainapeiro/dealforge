// ---------------------------------------------------------------------------
// Budget status (W2-07 / FIN-07, REQ-FIN-07).
//
// Source of truth: the Phase-1 BRD, Financials & Returns — "Budget status".
// The preparer confirms whether the opportunity is in the approved budget,
// with a budget line reference or (when it is off-budget) a variance
// justification. Accept criterion: "If 'No', a variance memo upload becomes
// mandatory."
//
// So the rule has two arms:
//   - In budget  ('yes'): the preparer records the budget line reference. A
//     missing reference is an advisory flag, never a block.
//   - Off budget ('no'): a variance justification is required AND the variance
//     memo (the 'budget_confirmation' evidence document) becomes mandatory.
//     Either one missing stops the submission.
//
// The evaluator is pure. It reads the flat capture fields plus the present
// document keys the gate already resolves, and returns the decision the gate,
// the submit route, the capture form and the Sirius memo all read.
// ---------------------------------------------------------------------------

import { INTAKE_FIELDS } from './intakeConfig.js';

// The captured fields. `answer` is the existing required header question; the
// other two are new capture fields owned by this requirement.
export const BUDGET_FIELDS = {
  answer: 'in_approved_budget',
  status: 'budget_status',
  line_reference: 'budget_line_reference',
  justification: 'variance_justification',
};

// The evidence document that becomes mandatory when the deal is off-budget.
// It already exists in the memo document list (memoDocumentList.js) as the
// 'budget_confirmation' artefact feeding the funding section; FIN-07 is what
// makes it mandatory, and only for an off-budget deal.
export const VARIANCE_MEMO_KEY = 'budget_confirmation';
export const VARIANCE_MEMO_LABEL = 'Budget line / variance justification';

// The budget-status select options (kept in step with intakeConfig).
export const BUDGET_STATUS_VALUES = ['in_budget', 'variance_justified'];

export const BUDGET_MESSAGES = {
  answer_required:
    'The budget status must be confirmed: state whether the opportunity is in the approved budget.',
  justification_required:
    'Off-budget: a variance justification is required explaining the budget variance.',
  variance_memo_required:
    'Off-budget: a variance memo upload is mandatory when the opportunity is not in the approved budget.',
  line_reference_advisory:
    'In the approved budget but no budget line reference was recorded; add the reference for the audit trail.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const text = (v) => (blank(v) ? null : String(v).trim());

// Normalise the yes/no answer to a lowercase token ('yes' | 'no' | '').
function normalizeAnswer(value) {
  if (blank(value)) return '';
  const v = String(value).trim().toLowerCase();
  if (v === 'yes' || v === 'true') return 'yes';
  if (v === 'no' || v === 'false') return 'no';
  return v;
}

// Labels looked up from the capture model so the form, the gate and the memo
// name a field identically.
const FIELD_LABELS = new Map(INTAKE_FIELDS.map((f) => [f.key, f.label]));
export const fieldLabel = (key) => FIELD_LABELS.get(key) || key;

/**
 * Evaluate the budget status for an opportunity's data. Pure.
 *
 * @param {object} data       the opportunity data (flat capture fields)
 * @param {object} [options]
 * @param {string[]} [options.documents] present requirement keys, so the
 *   mandatory variance memo can be checked. When omitted the document check is
 *   skipped (document_present === null).
 *
 * Returns:
 *   applies                 - true, this requirement is always evaluated
 *   answered                - yes / no was recorded
 *   in_budget               - true ('yes'), false ('no') or null (unanswered)
 *   off_budget              - true when the answer is 'no'
 *   budget_status           - the recorded status select value (or null)
 *   line_reference          - the budget line reference, or null
 *   justification           - the variance justification, or null
 *   variance_memo_required  - true when the answer is 'no'
 *   variance_memo_key       - the evidence key required when off-budget
 *   variance_memo_present   - whether that evidence is uploaded (or null when
 *                             the document set was not supplied)
 *   satisfied               - every hard test is met, so submission may proceed
 *   stops                   - the unmet hard tests, each with a code and message
 *   flags                   - advisory observations (never block)
 *   message                 - a summary when not satisfied, else null
 */
export function evaluateBudgetStatus(data = {}, { documents } = {}) {
  const answer = normalizeAnswer(data[BUDGET_FIELDS.answer]);
  const answered = answer === 'yes' || answer === 'no';
  const inBudget = answer === 'yes';
  const offBudget = answer === 'no';
  const lineReference = text(data[BUDGET_FIELDS.line_reference]);
  const justification = text(data[BUDGET_FIELDS.justification]);
  const status = text(data[BUDGET_FIELDS.status]);

  const docSet = Array.isArray(documents) ? new Set(documents) : null;
  const varianceMemoPresent = docSet ? docSet.has(VARIANCE_MEMO_KEY) : null;

  const stops = [];
  const flags = [];

  if (!answered) {
    stops.push({
      code: 'budget_answer_required',
      field: BUDGET_FIELDS.answer,
      label: fieldLabel(BUDGET_FIELDS.answer),
      message: BUDGET_MESSAGES.answer_required,
    });
  }

  if (offBudget) {
    if (!justification) {
      stops.push({
        code: 'variance_justification_required',
        field: BUDGET_FIELDS.justification,
        label: fieldLabel(BUDGET_FIELDS.justification),
        message: BUDGET_MESSAGES.justification_required,
      });
    }
    if (varianceMemoPresent === false) {
      stops.push({
        code: 'variance_memo_required',
        key: VARIANCE_MEMO_KEY,
        label: VARIANCE_MEMO_LABEL,
        document: true,
        message: BUDGET_MESSAGES.variance_memo_required,
      });
    } else if (varianceMemoPresent === null && !justification) {
      // No document set was supplied and no inline justification either: treat
      // the missing evidence as the block so the gate and the form agree.
      stops.push({
        code: 'variance_memo_required',
        key: VARIANCE_MEMO_KEY,
        label: VARIANCE_MEMO_LABEL,
        document: true,
        message: BUDGET_MESSAGES.variance_memo_required,
      });
    }
  }

  if (inBudget && !lineReference) {
    flags.push({
      reason: 'budget_line_missing',
      field: BUDGET_FIELDS.line_reference,
      label: fieldLabel(BUDGET_FIELDS.line_reference),
      message: BUDGET_MESSAGES.line_reference_advisory,
    });
  }

  const satisfied = stops.length === 0;
  const message = satisfied
    ? null
    : offBudget
      ? BUDGET_MESSAGES.variance_memo_required
      : BUDGET_MESSAGES.answer_required;

  return {
    applies: true,
    answered,
    in_budget: answered ? inBudget : null,
    off_budget: offBudget,
    budget_status: status,
    line_reference: lineReference,
    justification,
    variance_memo_required: offBudget,
    variance_memo_key: offBudget ? VARIANCE_MEMO_KEY : null,
    variance_memo_label: VARIANCE_MEMO_LABEL,
    variance_memo_present: varianceMemoPresent,
    satisfied,
    stops,
    flags,
    message,
  };
}

export default {
  BUDGET_FIELDS, VARIANCE_MEMO_KEY, VARIANCE_MEMO_LABEL, BUDGET_STATUS_VALUES,
  BUDGET_MESSAGES, fieldLabel, evaluateBudgetStatus,
};
