// Presentation model for the reviewer's AI validation card.
//
// Pure functions over the stored validation result. Nothing here changes a
// status, a stored title or detail, or anything sent to the server: it only
// decides how the existing checks are grouped and worded on screen.
//
// Each check is shown as "Headline - reason". The headline is a short business
// phrase chosen from the check, its status and (where one check can fail for
// different reasons) the stored wording of its reason. The reason is the stored
// detail, with the technical lead-in removed. A check this file does not know
// falls back to its stored title and detail, so a new backend check still shows.

export const VALIDATION_STATUS_ORDER = ["fail", "review", "pass"];

export const VALIDATION_STATUS_LABEL = {
  fail: "Failed",
  review: "Needs review",
  pass: "Passed",
};

/** Checks split by status, in display order. An unknown status counts as "review", as elsewhere. */
export function groupChecks(checks = []) {
  const groups = { fail: [], review: [], pass: [] };
  for (const c of Array.isArray(checks) ? checks : []) {
    (groups[c?.status] || groups.review).push(c);
  }
  return groups;
}

/** "2 failed · 1 needs review · 4 passed" (zero counts are left out). */
export function summariseChecks(groups) {
  const parts = [];
  if (groups.fail.length) parts.push(`${groups.fail.length} failed`);
  if (groups.review.length) parts.push(`${groups.review.length} needs review`);
  if (groups.pass.length) parts.push(`${groups.pass.length} passed`);
  return parts.join(" · ");
}

const INCOMPLETE = "Incomplete information";
const MISMATCH = "Financial mismatch";
const INCONSISTENT = "Information inconsistency";
const SCREENING = "Screening concern";
const TO_CONFIRM = "Screening to be confirmed";
const NOT_ASSESSED = "Not assessed";

const NOT_ASSESSED_DETAIL = /^the ai did not assess this check\.?$/i;
// The consistency check, when a rule check on the tab failed, starts with a
// technical sentence. It is dropped from the default view (it stays in Details).
const RULE_LEAD_IN = /^a rule-based check failed \([^)]*\), so the content cannot be called consistent\.\s*/i;

const MISSING_DOCS = /\b(no documents?|not attached|none attached|not been (uploaded|attached|provided)|missing|absent|not provided|nothing (is )?attached)\b/i;
const UNREADABLE_DOC = /\b(not readable|cannot be read|could not be read|unreadable|scanned|password|corrupt)\b/i;

const cleanText = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** The stored reason without technical lead-ins. Empty when nothing useful is left. */
export function plainReason(detail) {
  const t = cleanText(detail).replace(RULE_LEAD_IN, "").trim();
  return /^no detail given\.?$/i.test(t) ? "" : t;
}

// One entry per check key: (status, detail) => headline, or { headline, reason }.
const HEADLINES = {
  checklist: (s) => (s === "pass" ? "Required information provided" : INCOMPLETE),
  headline_returns: (s) => (s === "pass" ? "Summary matches the returns table" : s === "fail" ? INCONSISTENT : INCOMPLETE),
  commitment_split: (s) => (s === "pass" ? "Funding matches the total commitment" : s === "fail" ? MISMATCH : INCOMPLETE),
  sources_uses: (s) => (s === "pass" ? "Sources equal uses" : MISMATCH),
  ask_within_total: (s) => (s === "pass" ? "Ask is within the total commitment" : MISMATCH),
  periods: (s) => (s === "pass" ? "Financial periods complete" : INCOMPLETE),
  statements_balance: (s) => (s === "pass" ? "Financial statements balance" : MISMATCH),
  returns_captured: (s) => (s === "pass" ? "Returns provided for every scenario" : INCOMPLETE),
  downside_hurdles: (s) => (s === "pass" ? "Downside case meets the hurdles" : "Downside case misses return hurdles"),
  sufficiency: (s) => (s === "pass" ? "Supporting information sufficient" : "Insufficient supporting information"),
  mandate_rules: (s) => (s === "pass" ? "Fits the group mandate" : "Group mandate mismatch"),
  hard_filters: (s) => (s === "pass" ? "No hard filter failed" : s === "fail" ? SCREENING : TO_CONFIRM),
  disqualifiers: (s) => (s === "pass" ? "No disqualifier raised" : s === "fail" ? SCREENING : TO_CONFIRM),
  sanctions_consistency: (s) => (s === "pass" ? "Screening answers agree" : SCREENING),
  sanctions_note: () => INCOMPLETE,
  risk_register: (s, d) => (s === "pass" ? "Risk register complete" : /could not be read/i.test(d) ? "Risk register not readable" : INCOMPLETE),
  embedded_instructions: () => "Unusual wording in the submission",
  right_document: (s, d) => {
    if (s === "pass") return "Right supporting documents attached";
    if (NOT_ASSESSED_DETAIL.test(d)) return NOT_ASSESSED;
    if (s === "fail") return "Incorrect supporting document";
    if (UNREADABLE_DOC.test(d)) return "Supporting document could not be read";
    if (MISSING_DOCS.test(d)) return "Supporting documents missing";
    return "Supporting document to be confirmed";
  },
  intent_fit: (s, d) => {
    if (s === "pass") return "Fits the investment mandate";
    if (NOT_ASSESSED_DETAIL.test(d)) return NOT_ASSESSED;
    return s === "fail" ? "Investment mandate mismatch" : "Investment mandate to be confirmed";
  },
  consistency: (s, d) => {
    if (s === "pass") return "Information consistent";
    if (NOT_ASSESSED_DETAIL.test(d)) return NOT_ASSESSED;
    if (s === "fail") return INCONSISTENT;
    // Review because a rule check failed, or because the model was unsure: either
    // way consistency is not confirmed, which is not the same as inconsistent.
    return { headline: "Consistency not confirmed", reason: RULE_LEAD_IN.test(cleanText(d)) && !plainReason(d) ? "Resolve the failed finding above first." : undefined };
  },
};

/**
 * How one check reads in the default view and in Details:
 * { headline, reason, title, detail, source }. `reason` is empty for a passed
 * check (its headline already says it), `title` and `detail` are the stored text.
 */
export function describeCheck(check) {
  const status = check?.status === "pass" || check?.status === "fail" ? check.status : "review";
  const detail = cleanText(check?.detail);
  const rule = HEADLINES[check?.key];
  let headline;
  let reason;
  if (rule) {
    const out = rule(status, detail);
    headline = typeof out === "string" ? out : out.headline;
    reason = typeof out === "string" ? undefined : out.reason;
  }
  if (!headline) headline = check?.title || check?.key || "Check";
  if (reason === undefined) {
    reason = NOT_ASSESSED_DETAIL.test(detail) ? "The AI did not return an assessment. Re-run to try again." : plainReason(detail);
  }
  return {
    headline,
    reason: status === "pass" ? "" : reason,
    title: check?.title || "",
    detail,
    source: check?.source === "ai" ? "AI" : "Rules",
  };
}

export default { VALIDATION_STATUS_ORDER, VALIDATION_STATUS_LABEL, groupChecks, summariseChecks, plainReason, describeCheck };
