// ---------------------------------------------------------------------------
// Document template library vocabulary and shipped catalogue (W5-05 / DOC-06).
//
// Source of truth: the Phase-1 BRD, Documents & Completeness - "Document
// templates" with accept criterion "Current versions downloadable,
// Investment-Team maintained".
//
// The Investment Team maintains a small set of standard templates the intake
// squad should work from when preparing a submission: the Opportunity Overview
// layout the memo mirrors, a three-statement financial-model skeleton, the risk
// register and the ten-gate qualifying checklist. Each template has a format
// (docx or csv), a named owner and a revision, so a reviewer always downloads
// the current version.
//
// This module is vocabulary only - the shipped catalogue and the category /
// format lists. The pure resolution functions live in templateLibrary.js and
// the renderers in templateDocx.js / templateCsv.js.
// ---------------------------------------------------------------------------

export const TEMPLATE_LIBRARY_CONFIG_KEY = 'template_library_config';
export const TEMPLATE_LIBRARY_VERSION = 'TPL-01.1';
export const TEMPLATE_LIBRARY_VERSION_PREFIX = 'TPL-01.';
export const TEMPLATE_LIBRARY_DEFAULT_REVISION = 1;

// Who owns the library by default (accept criterion: Investment-Team maintained).
export const TEMPLATE_LIBRARY_OWNER = 'Sirius Investment Team';

// The artefact formats a template can be delivered in.
export const TEMPLATE_FORMATS = [
  { key: 'docx', label: 'Word document (.docx)', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { key: 'csv', label: 'Spreadsheet (.csv)', contentType: 'text/csv; charset=utf-8' },
];

export const TEMPLATE_FORMAT_KEYS = TEMPLATE_FORMATS.map((f) => f.key);

// Grouping for the library screen, in running order.
export const TEMPLATE_CATEGORIES = [
  { key: 'opportunity', label: 'Opportunity Overview' },
  { key: 'financial', label: 'Financial model' },
  { key: 'governance', label: 'Risk & governance' },
];

export const TEMPLATE_CATEGORY_KEYS = TEMPLATE_CATEGORIES.map((c) => c.key);

// The shipped library. Each entry names the artefact it renders to, who owns
// it and a one-line description of what the intake squad uses it for.
export const TEMPLATE_LIBRARY = [
  {
    id: 'opportunity_overview',
    label: 'Opportunity Overview',
    category: 'opportunity',
    format: 'docx',
    filename: 'Sirius_Opportunity_Overview.docx',
    description:
      'The six-page Opportunity Overview the memo mirrors, with the header key-facts ' +
      'block and the per-page guidance the Investment Team expects a submission to follow.',
    owner: TEMPLATE_LIBRARY_OWNER,
  },
  {
    id: 'financial_model',
    label: 'Three-statement financial model',
    category: 'financial',
    format: 'csv',
    filename: 'Sirius_Financial_Model.csv',
    description:
      'The Part B page-4 financials grid (FY-3 A to Y5 P) as an editable skeleton, ' +
      'so historicals and projections are captured in the same shape the memo prints.',
    owner: TEMPLATE_LIBRARY_OWNER,
  },
  {
    id: 'risk_register',
    label: 'Risk register',
    category: 'governance',
    format: 'csv',
    filename: 'Sirius_Risk_Register.csv',
    description:
      'A register skeleton (5-8 material risks with a named owner each) that feeds ' +
      'the memo risk section and the "Risk owned" qualifying gate.',
    owner: TEMPLATE_LIBRARY_OWNER,
  },
  {
    id: 'gate_checklist',
    label: 'Qualifying-gate checklist',
    category: 'opportunity',
    format: 'csv',
    filename: 'Sirius_Gate_Checklist.csv',
    description:
      'The ten qualifying gates with the evidence each one needs, so the squad can ' +
      'self-check against the same rules the system enforces before submission.',
    owner: TEMPLATE_LIBRARY_OWNER,
  },
];

export const TEMPLATE_LIBRARY_IDS = TEMPLATE_LIBRARY.map((t) => t.id);

const TEMPLATE_INDEX = new Map(TEMPLATE_LIBRARY.map((t) => [t.id, t]));

export function findTemplate(id) {
  return TEMPLATE_INDEX.get(id) || null;
}

// Columns of the risk-register template (aligned to the memo risk section).
export const RISK_REGISTER_COLUMNS = [
  'Risk ID', 'Risk description', 'Category', 'Likelihood (1-5)',
  'Impact (1-5)', 'Mitigation / control', 'Risk owner (named)', 'Status',
];

// Columns of the qualifying-gate checklist template.
export const GATE_CHECKLIST_COLUMNS = [
  'Gate #', 'Gate', 'Question', 'Evidence required', 'Answer (Y/N)', 'Owner', 'Notes',
];

export const TEMPLATE_LIBRARY_MESSAGES = {
  config_invalid: 'The template library configuration is invalid.',
  unknown_template: 'Unknown template id',
  unknown_format: 'Unknown template format',
  unknown_category: 'Unknown template category',
  disclaimer:
    'Standard templates maintained by the Investment Team. They are guidance only: ' +
    'downloading one never changes an opportunity and never blocks a submission.',
};

export default {
  TEMPLATE_LIBRARY_CONFIG_KEY, TEMPLATE_LIBRARY_VERSION, TEMPLATE_LIBRARY_VERSION_PREFIX,
  TEMPLATE_LIBRARY_DEFAULT_REVISION, TEMPLATE_LIBRARY_OWNER, TEMPLATE_FORMATS,
  TEMPLATE_FORMAT_KEYS, TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_KEYS, TEMPLATE_LIBRARY,
  TEMPLATE_LIBRARY_IDS, RISK_REGISTER_COLUMNS, GATE_CHECKLIST_COLUMNS,
  TEMPLATE_LIBRARY_MESSAGES, findTemplate,
};
