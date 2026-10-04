// ---------------------------------------------------------------------------
// Sanctions / adverse-media manual confirmation (W3-12 / BRD SCR-08).
//
// The BRD asks for a manual confirmation field for sanctions / adverse-media
// exposure with the supporting evidence held on the record. Sanctions and
// adverse-media screening is a manual, human-verified step (open decision Q7
// names the provider, if any): the platform captures the analyst's verdict, the
// supporting note and the evidence, and keeps it on the opportunity so the
// screening panel and the memo can show it.
//
// This module is pure - no database, no network. It normalises the captured
// fields into a single status, decides whether the confirmation is satisfied
// (a clear verdict with its supporting note or uploaded evidence), and lists
// the reasons it is not. It never decides on its own: an adverse finding is a
// flag that escalates to a reviewer, never an automatic rejection (SCR-09).
// ---------------------------------------------------------------------------

export const ADVERSE_MEDIA_VERSION = 'AM-01.1';

// The analyst's verdict.
export const ADVERSE_MEDIA_STATUSES = ['clear', 'adverse', 'pending'];

// A clear verdict has to carry a supporting note of at least this many
// characters, or an uploaded evidence file, before it is satisfied.
export const ADVERSE_MEDIA_NOTES_MIN = 10;

// The evidence document key the confirmation rides on. It is an evidence-only
// requirement (not a Gate-1 minimum-document requirement), so uploading it
// never changes submission completeness.
export const ADVERSE_MEDIA_EVIDENCE_DOC_KEY = 'adverse_media_evidence';

export const ADVERSE_MEDIA_FIELDS = {
  confirmation: 'adverse_media_confirmation',
  note: 'adverse_media_note',
  evidence_reference: 'adverse_media_evidence_reference',
  source: 'adverse_media_source',
  reviewed_by: 'adverse_media_reviewed_by',
};

export const ADVERSE_MEDIA_MESSAGES = {
  missing: 'Sanctions / adverse-media exposure has not been confirmed yet. Record a verdict with its supporting evidence.',
  unrecognised: 'The adverse-media verdict is not recognised; record clear, adverse or pending.',
  clear: 'Sanctions / adverse-media exposure confirmed clear against the supporting evidence.',
  clear_no_note: 'A clear verdict is recorded but the supporting note is missing or too short.',
  clear_no_evidence: 'A clear verdict is recorded but no supporting evidence is on the record.',
  adverse: 'Adverse media / sanctions exposure identified; the finding escalates to a reviewer.',
  pending: 'The sanctions / adverse-media confirmation is recorded as pending.',
};

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const CLEAR_VALUES = ['clear', 'no', 'none', 'clean', 'no_exposure', 'clear_no_exposure'];
const ADVERSE_VALUES = ['adverse', 'exposure', 'flag', 'flagged', 'yes', 'identified', 'adverse_media'];
const PENDING_VALUES = ['pending', 'in_progress', 'awaiting'];

// The supporting-evidence document requirement, shaped for the document
// requirement catalogue. Not a gate requirement: evidence-only.
export const ADVERSE_MEDIA_DOC_REQUIREMENTS = [
  {
    key: ADVERSE_MEDIA_EVIDENCE_DOC_KEY,
    label: 'Sanctions / adverse-media evidence',
    description: 'The screening report or evidence supporting the sanctions / adverse-media confirmation.',
    sections: ['risk_assessment'],
    gate: false,
    sort_order: 121,
  },
];

/**
 * Evaluate the sanctions / adverse-media manual confirmation. Pure.
 *
 * @param {object} data       the opportunity data
 * @param {object} options
 * @param {Iterable<string>|Array<string>} options.documents  present document keys
 *
 * Returns the normalised status, the completeness / satisfaction verdicts, the
 * evidence position and the plain-text message. The system never rejects: an
 * adverse finding is a flag for a reviewer.
 */
export function evaluateAdverseMedia(data = {}, { documents = [] } = {}) {
  const confirmationRaw = data[ADVERSE_MEDIA_FIELDS.confirmation];
  const note = data[ADVERSE_MEDIA_FIELDS.note];
  const evidenceReference = data[ADVERSE_MEDIA_FIELDS.evidence_reference];
  const source = data[ADVERSE_MEDIA_FIELDS.source] || null;
  const reviewedBy = data[ADVERSE_MEDIA_FIELDS.reviewed_by] || null;

  const raw = typeof confirmationRaw === 'string' ? confirmationRaw.trim().toLowerCase() : confirmationRaw;
  let status = 'missing';
  if (!blank(raw)) {
    if (CLEAR_VALUES.includes(raw)) status = 'clear';
    else if (ADVERSE_VALUES.includes(raw)) status = 'adverse';
    else if (PENDING_VALUES.includes(raw)) status = 'pending';
    else status = 'unrecognised';
  }

  const docKeys = new Set(Array.from(documents || []).map((d) => (typeof d === 'string' ? d : d?.key || d?.requirement_key)).filter(Boolean));
  const evidencePresent = docKeys.has(ADVERSE_MEDIA_EVIDENCE_DOC_KEY);
  const evidenceReferenceOk = !blank(evidenceReference);
  const evidenceOnRecord = evidencePresent || evidenceReferenceOk;
  const noteOk = typeof note === 'string' && note.trim().length >= ADVERSE_MEDIA_NOTES_MIN;

  const flags = [];
  let message;
  let satisfied = false;

  if (status === 'missing' || status === 'unrecognised') {
    message = status === 'missing' ? ADVERSE_MEDIA_MESSAGES.missing : ADVERSE_MEDIA_MESSAGES.unrecognised;
    flags.push({ code: 'adverse_media_unconfirmed', label: message });
  } else if (status === 'adverse') {
    message = ADVERSE_MEDIA_MESSAGES.adverse;
    flags.push({ code: 'adverse_media_exposure', label: message });
  } else if (status === 'pending') {
    message = ADVERSE_MEDIA_MESSAGES.pending;
    flags.push({ code: 'adverse_media_pending', label: message });
  } else {
    // status === 'clear'
    if (!noteOk) flags.push({ code: 'adverse_media_note_missing', label: ADVERSE_MEDIA_MESSAGES.clear_no_note });
    if (!evidenceOnRecord) flags.push({ code: 'adverse_media_evidence_missing', label: ADVERSE_MEDIA_MESSAGES.clear_no_evidence });
    satisfied = noteOk && evidenceOnRecord;
    message = flags.length === 0 ? ADVERSE_MEDIA_MESSAGES.clear : flags.map((f) => f.label).join(' ');
  }

  return {
    version: ADVERSE_MEDIA_VERSION,
    status,
    confirmation: confirmationRaw || null,
    complete: status === 'clear' || status === 'adverse',
    satisfied,
    note_ok: noteOk,
    note_min: ADVERSE_MEDIA_NOTES_MIN,
    evidence_required: true,
    evidence_present: evidencePresent,
    evidence_reference: evidenceReference || null,
    evidence_on_record: evidenceOnRecord,
    source,
    reviewed_by: reviewedBy,
    fields: ADVERSE_MEDIA_FIELDS,
    flags,
    message,
  };
}

export default {
  ADVERSE_MEDIA_VERSION, ADVERSE_MEDIA_STATUSES, ADVERSE_MEDIA_NOTES_MIN,
  ADVERSE_MEDIA_EVIDENCE_DOC_KEY, ADVERSE_MEDIA_FIELDS, ADVERSE_MEDIA_MESSAGES,
  ADVERSE_MEDIA_DOC_REQUIREMENTS, evaluateAdverseMedia,
};
