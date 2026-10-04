// ---------------------------------------------------------------------------
// Opportunity Overview pack - vocabulary (W7-04 / BRD OUT-02).
//
// The pack is the downloadable form of the Sirius Investment Framework
// "Part B - Submission Template" Opportunity Overview. The template prints as
// six pages, in a fixed running order; this module owns that order so the
// manifest, the print/HTML render and any future PDF render all agree.
//
// Pure data only - no database, no network.
// ---------------------------------------------------------------------------

// The pack format version, minted into every manifest so a downloaded pack can
// be traced back to the layout that produced it.
export const MEMO_PACK_VERSION = '1.0';

export const MEMO_PACK_KEY = 'memo_pack';

// Human label for the pack as a whole.
export const MEMO_PACK_TITLE = 'Sirius Opportunity Overview - submission pack';

// Supported/downloadable formats, in the order the UI offers them.
export const MEMO_PACK_FORMATS = [
  { key: 'html', label: 'Print-ready HTML', extension: 'html', mime: 'text/html; charset=utf-8',
    note: 'Open and print to PDF from the browser; the six pages carry print page breaks in template order.' },
  { key: 'md', label: 'Markdown', extension: 'md', mime: 'text/markdown; charset=utf-8',
    note: 'Plain-text pack for review or diffing in a repository.' },
];

// The six pages of the template, in the exact Part B running order. The keys
// and numbers mirror server/config/siriusMemo.js MEMO_PAGE_TABS; the pack uses
// them only to describe and order what the memo builder already produced.
export const PACK_PAGE_ORDER = [
  { number: 1, key: 'executive_summary', label: 'Executive summary' },
  { number: 2, key: 'overview', label: 'Opportunity overview' },
  { number: 3, key: 'rationale', label: 'Rationale & fit' },
  { number: 4, key: 'financials', label: 'Financials & returns' },
  { number: 5, key: 'funding', label: 'Funding & key asks' },
  { number: 6, key: 'risks', label: 'Risks & compliance' },
];

export const PACK_PAGE_KEYS = PACK_PAGE_ORDER.map((p) => p.key);

export const MEMO_PACK_MESSAGES = {
  source: 'Sirius Investment Framework - Part B - Submission Template (six-page Opportunity Overview)',
  order_note: 'Pages are exported in the template running order: Executive summary, Opportunity overview, Rationale & fit, Financials & returns, Funding & key asks, Risks & compliance.',
  print_note: 'Each page starts on its own printed page, in the order above.',
  disclaimer: 'Provenance is limited to the opportunity record and its attached artefacts; blank template fields print as grey placeholders.',
};

export default {
  MEMO_PACK_VERSION,
  MEMO_PACK_KEY,
  MEMO_PACK_TITLE,
  MEMO_PACK_FORMATS,
  PACK_PAGE_ORDER,
  PACK_PAGE_KEYS,
  MEMO_PACK_MESSAGES,
};
