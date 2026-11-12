// Shared model for the read-only Reviewer Workspace: the tabs, which fields each
// tab shows as plain rows, and how a stored value is displayed. Nothing here
// invents data: a field with no value is simply not shown.

// The seven section tabs, in form order. `key` matches the AI-review tab keys on
// the server, so validation results and section-scoped Q&A line up with them.
export const REVIEW_TABS = [
  { key: "executive_summary", label: "Executive summary", sections: ["header", "executive_summary"] },
  { key: "opportunity_overview", label: "Opportunity overview", sections: ["opportunity_overview"] },
  { key: "rationale", label: "Rationale and fit", sections: ["rationale"] },
  { key: "financials", label: "Financials and returns", sections: ["financials", "accretion"] },
  { key: "funding", label: "Funding and key asks", sections: ["funding"] },
  { key: "risks", label: "Risks and compliance", sections: ["risks"] },
  { key: "documents", label: "Documents", sections: [] },
];

// Tabs that belong to the reviewer's own work (Step B).
export const REVIEW_ACTION_TABS = [
  { key: "scorecard", label: "Scorecard" },
  { key: "decision", label: "Decision" },
  { key: "audit", label: "Audit trail" },
];

// Fields shown by a purpose-built table or list instead of a plain row.
const STRUCTURED_PREFIXES = [
  "return_", "wacc_", "entry_", "exit_",
  "hard_filter_", "soft_filter_", "disqualifier_", "adverse_media_",
  "gate_",
];
const STRUCTURED_KEYS = new Set([
  "financials_summary_attached", "statements_3_attached", "below_floor_synergy_case",
]);

export function isStructuredKey(key) {
  return STRUCTURED_KEYS.has(key) || STRUCTURED_PREFIXES.some((p) => key.startsWith(p));
}

// Friendlier labels where the design uses different words for an existing field.
export const LABEL_OVERRIDES = {
  narrative_what: "The opportunity",
  related_party_disclosure: "Related party / affiliate involvement",
  decision_sought: "Decision sought",
};

// Shown after the header rows on the first tab: the budget line reference, which
// the form captures on the funding tab.
export const EXTRA_HEADER_ROWS = [{ key: "budget_line_reference", label: "Budget reference" }];

const blank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// The text a plain row shows, or null when there is nothing to show.
export function displayValue(field, value) {
  if (blank(value) || typeof value === "object") return null;
  if (field?.type === "select" && Array.isArray(field.options)) {
    const hit = field.options.find((o) => String(o.value) === String(value));
    if (hit) return hit.label;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// Long answers read as paragraphs, short ones as a single line.
export const isLongText = (field, text) => field?.type === "textarea" || String(text).length > 90;

export function numberText(value, decimals = 1) {
  if (blank(value) || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(decimals).replace(/\.?0+$/, "");
}

// The headline banner: the stated headline value, else the first sentence of
// what is being proposed.
export function headlineText(record = {}) {
  if (!blank(record.exec_summary_headline_value)) return String(record.exec_summary_headline_value);
  const what = String(record.narrative_what || "").trim();
  if (!what) return null;
  const first = what.split(/(?<=[.!?])\s/)[0];
  return first.length > 220 ? first.slice(0, 217).trimEnd() + "…" : first;
}

export function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
