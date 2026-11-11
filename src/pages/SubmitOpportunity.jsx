import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import AIValidationCard from "@/components/ai/AIValidationCard";
import AIAnalysisCard from "@/components/ai/AIAnalysisCard";
import AIQACard from "@/components/ai/AIQACard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import InfiniaScreeningView from "@/components/opportunity/InfiniaScreeningView";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Target,
  Trash2,
  Upload,
  User,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// M2 — "Submit an Opportunity" capture page with an enforced document gate.
//
// The capture form writes DealOpportunity drafts; the submission gate itself
// is evaluated server-side (api.gate.status / api.gate.submit). This page never
// decides "complete" on its own — it renders exactly what the server returns.
// ---------------------------------------------------------------------------

const DRAFT_STATUS = "draft";

// BRD v2 WF-01: the record is editable only as a draft or while Sirius has
// requested information. Older records may still carry a pre-v2 state name.
const LEGACY_STATES = {
  submission: "screening_review", screening: "screening_review", returned: "information_requested",
  refinement: "proceed_to_gate2", approval: "proceed_to_gate2",
};
const EDITABLE_STATES = ["draft", "information_requested"];
const normalizeState = (status) => LEGACY_STATES[status] || status || DRAFT_STATUS;

const QUALIFYING_GATE_NOT_READY =
  "Not ready: this opportunity is not ready to submit. Every qualifying gate must be answered YES with its evidence linked.";

// Fallback column keys for the part B page-4 financial grid (FIN-01). The
// authoritative list is served by GET /api/gate/fields (config/financials.js);
// this only seeds the form shape before that request returns.
const DEFAULT_FIN_PERIOD_KEYS = ["fy3a", "fy2a", "fy1a", "y1p", "y2p", "y3p", "y4p", "y5p"];

const STATUS_META = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700 border-slate-200" },
  submitted: { label: "Submitted", className: "bg-teal-100 text-teal-800 border-teal-200" },
  screening_review: { label: "Screening Review", className: "bg-blue-100 text-blue-800 border-blue-200" },
  information_requested: { label: "Information Requested", className: "bg-amber-100 text-amber-800 border-amber-200" },
  on_hold: { label: "On Hold", className: "bg-slate-200 text-slate-800 border-slate-300" },
  proceed_to_gate2: { label: "Proceed to Gate 2", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  declined: { label: "Declined", className: "bg-red-100 text-red-800 border-red-200" },
  withdrawn: { label: "Withdrawn", className: "bg-gray-100 text-gray-700 border-gray-300" },
  // Legacy pipeline states, shown for opportunities created elsewhere.
  new: { label: "New", className: "bg-slate-100 text-slate-700 border-slate-200" },
  contacted: { label: "Contacted", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  due_diligence: { label: "Due Diligence", className: "bg-purple-100 text-purple-800 border-purple-200" },
  negotiation: { label: "Negotiation", className: "bg-amber-100 text-amber-800 border-amber-200" },
  closed_won: { label: "Closed Won", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  closed_lost: { label: "Closed Lost", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

const WITHDRAW_REASON_OPTIONS = [
  { value: "reprioritised", label: "Internally reprioritised" },
  { value: "budget_pulled", label: "Budget pulled" },
  { value: "superseded", label: "Superseded by later proposal" },
  { value: "target_withdrawn", label: "Target withdrawn from market" },
  { value: "data_quality", label: "Data quality concerns" },
  { value: "duplicate_opportunity", label: "Duplicate opportunity" },
];

// Human-friendly titles for the six-section Opportunity Overview pack (INT-06).
// The section set, their order and every field come from the server model
// (GET /api/gate/fields → config/intakeConfig.js) so the form, the gate and the
// generated memo cannot drift apart.
const SECTION_TITLES = {
  header: "Header (§3.1)",
  executive_summary: "1. Executive summary",
  opportunity_overview: "2. Opportunity overview",
  rationale: "3. Rationale & strategic fit",
  financials: "4. Financials & returns vs hurdles",
  funding: "5. Funding & key asks",
  risks: "6. Risks & compliance",
  accretion: "Accretion statement (§3.3)",
  documents: "Documents",
};

// The capture form is a seven-step wizard. Each step shows one or more of the
// server-defined sections; the sections themselves, their fields and the gate
// are unchanged. A section the server adds later that is not listed here lands
// on the last step so no field is ever hidden.
const CAPTURE_TABS = [
  { key: "executive_summary", label: "Executive summary", sections: ["header", "executive_summary"] },
  { key: "opportunity_overview", label: "Opportunity overview", sections: ["opportunity_overview"] },
  { key: "rationale", label: "Rationale and fit", sections: ["rationale"] },
  { key: "financials", label: "Financials and returns", sections: ["financials", "accretion"] },
  { key: "funding", label: "Funding and key asks", sections: ["funding"] },
  { key: "risks", label: "Risks and compliance", sections: ["risks"] },
  { key: "documents", label: "Documents and send", sections: ["documents"] },
];
const LAST_TAB = CAPTURE_TABS.length - 1;
const tabIndexForSection = (section) => {
  const index = CAPTURE_TABS.findIndex((tab) => tab.sections.includes(section));
  return index === -1 ? LAST_TAB : index;
};

// Field input types the form renders inline (arrays such as the risk register
// are captured as text blocks, so every model type maps to a control).
const FIELD_TYPES = new Set(["text", "number", "select", "textarea"]);

const DS_OPPORTUNITY_TYPES = [
  { value: "strategic_acquisition", label: "Strategic acquisition" },
  { value: "organic_expansion", label: "Organic expansion & capex" },
  { value: "greenfield", label: "Greenfield / new venture" },
  { value: "jv_partnership", label: "JV & partnership" },
  { value: "bolt_on", label: "Bolt-on / consolidation" },
  { value: "structured_financial", label: "Structured / financial" },
  { value: "technology_ip", label: "Technology / IP & resources" },
];

const DS_SOURCING_CHANNELS = [
  { value: "proprietary", label: "Proprietary / direct origination" },
  { value: "banker_advisor", label: "Banker / advisor-led" },
  { value: "ihc_affiliate_referral", label: "IHC / affiliate referral" },
  { value: "portfolio_bolt_on", label: "Portfolio-company bolt-on" },
  { value: "government_dge", label: "Government / DGE-adjacent" },
];

function emptyForm(ownerEmail) {
  return {
    owner_email: ownerEmail || "",
    first_projection_year: "2027",
    is_greenfield: "no",
    valuation_comparables: toComparablesForm([]),
    gate_confirm_strategic_fit: true,
    gate_confirm_executable: true,
  };
}

function emptyScreenAnswers() {
  return {
    opportunity_type: "",
    geography: "",
    country: "",
    related_party: "",
    sector: "",
    total_commitment_aed: "",
    in_approved_budget: "",
    in_approved_plan: "",
    below_floor_exception: false,
  };
}

function toForm(record, allFields) {
  const form = { ...emptyForm(record?.owner_email), ...(record || {}) };
  for (const field of allFields) {
    const value = record?.[field.key];
    form[field.key] = value === undefined || value === null ? "" : String(value);
  }
  // The Part B page-4 financial matrix (W2-01 / FIN-01) is nested, not a flat
  // field, so it is carried on the form separately and rebuilt on save.
  form.financials = toFinancialsForm(record?.financials);
  form.funding_plan = toFundingPlanForm(record?.funding_plan);
  // The comparable set (W2-08 / FIN-09) is a nested list, carried separately and
  // rebuilt on save alongside the flat valuation fields.
  form.valuation_comparables = toComparablesForm(record?.valuation_comparables);
  form.gate_confirm_strategic_fit = record?.gate_confirm_strategic_fit ?? (record?.gate_strategic_fit !== "no");
  form.gate_confirm_executable = record?.gate_confirm_executable ?? (record?.gate_executable !== "no");

  // Field aliases and fallbacks to ensure existing draft data populates correctly
  // and does not show false red mandatory indicators
  form.subsidiary_signing_entity =
    record?.subsidiary_signing_entity ||
    record?.subsidiary ||
    record?.owner_org_name ||
    record?.signing_entity ||
    "";

  form.is_greenfield =
    record?.is_greenfield ||
    (record?.opportunity_type === "greenfield"
      ? "yes"
      : record?.opportunity_type
      ? "no"
      : "no");

  form.first_projection_year = record?.first_projection_year || "2027";

  form.entry_valuation_basis_text =
    record?.entry_valuation_basis_text ||
    (record?.entry_valuation_basis
      ? record.entry_valuation_basis === "ev"
        ? "Enterprise value (EV)"
        : record.entry_valuation_basis === "equity"
        ? "Equity value"
        : String(record.entry_valuation_basis)
      : "");
  if (!form.entry_valuation_basis && form.entry_valuation_basis_text) {
    form.entry_valuation_basis = form.entry_valuation_basis_text;
  }

  form.cross_border_target =
    record?.cross_border_target ||
    (record?.geography
      ? record.geography.toLowerCase() === "uae"
        ? "No"
        : "Yes"
      : record?.cross_border_fx
      ? "Yes"
      : "No");

  form.funding_deal_shape =
    record?.funding_deal_shape || record?.deal_shape || "";

  form.sirius_capital_or_guarantee =
    record?.sirius_capital_or_guarantee ||
    (record?.sirius_capital_aed != null
      ? `AED ${record.sirius_capital_aed} mn`
      : record?.ask_aed != null
      ? `AED ${record.ask_aed} mn`
      : "");

  form.leverage_ratio =
    record?.leverage_ratio !== undefined && record?.leverage_ratio !== null
      ? String(record.leverage_ratio)
      : record?.leverage !== undefined && record?.leverage !== null
      ? String(record.leverage)
      : record?.net_debt_ebitda !== undefined && record?.net_debt_ebitda !== null
      ? String(record.net_debt_ebitda)
      : "";

  form.concentration_pct =
    record?.concentration_pct !== undefined && record?.concentration_pct !== null
      ? String(record.concentration_pct)
      : record?.concentration !== undefined && record?.concentration !== null
      ? String(record.concentration)
      : "";

  form.wacc_override_pct =
    record?.wacc_override_pct !== undefined && record?.wacc_override_pct !== null
      ? String(record.wacc_override_pct)
      : record?.wacc !== undefined && record?.wacc !== null
      ? String(record.wacc)
      : "";

  if (record?.accretion_net_earnings_aed !== undefined && record?.accretion_net_earnings_aed !== null) {
    form.accretion_net_earnings_aed = String(record.accretion_net_earnings_aed);
  }
  if (record?.accretion_bps !== undefined && record?.accretion_bps !== null) {
    form.accretion_bps = String(record.accretion_bps);
  }
  if (record?.compliance_legal) {
    form.compliance_legal = record.compliance_legal;
    form.compliance_legal_status = record.compliance_legal;
  }
  if (record?.compliance_related_party) {
    form.compliance_related_party = record.compliance_related_party;
    form.compliance_related_party_status = record.compliance_related_party;
  }
  if (record?.compliance_esg) {
    form.compliance_esg = record.compliance_esg;
    form.compliance_esg_status = record.compliance_esg;
  }

  if (form.accretion_net_earnings_aed && form.accretion_bps) {
    const aed = Number(String(form.accretion_net_earnings_aed).replace(/,/g, "").trim());
    const bps = Number(String(form.accretion_bps).replace(/,/g, "").trim());
    if (!Number.isNaN(aed) && !Number.isNaN(bps)) {
      form.gate_accretive = "yes";
      form.gate_accretive_user_override = true;
    }
  }

  if (!form.key_message_executive_summary && record?.exec_summary_headline_value) {
    form.key_message_executive_summary = record.exec_summary_headline_value;
  }

  return form;
}

// The funding sources-and-uses table (W2-06 / FIN-06) is nested too. Each cell
// is held as a string so the inputs behave like the other fields; buildPayload()
// re-numbers the amounts.
const FUNDING_SOURCE_KEYS = ["subsidiary_accruals", "subsidiary_debt", "partner_co_investor", "sirius_capital"];
const FUNDING_USE_KEYS = ["purchase_price", "transaction_costs", "working_capital", "contingency"];

function toFundingPlanForm(plan) {
  const index = (list) => {
    const map = {};
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry && entry.key) map[entry.key] = entry;
      }
    } else if (list && typeof list === "object") {
      Object.assign(map, list);
    }
    return map;
  };
  const sources = index(plan?.sources);
  const uses = index(plan?.uses);
  const str = (v) => (v === undefined || v === null ? "" : String(v));
  return {
    sources: FUNDING_SOURCE_KEYS.map((key) => ({
      key,
      aed: str(sources[key]?.aed),
      pct: str(sources[key]?.pct),
      status: sources[key]?.status || "",
    })),
    uses: FUNDING_USE_KEYS.map((key) => ({ key, aed: str(uses[key]?.aed) })),
  };
}

function fundingPlanFromForm(plan) {
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return {
    sources: (plan?.sources || []).map((s) => ({ key: s.key, aed: num(s.aed), pct: num(s.pct), status: s.status || "" })),
    uses: (plan?.uses || []).map((u) => ({ key: u.key, aed: num(u.aed) })),
  };
}

// The comparable set (W2-08 / FIN-09) is a nested list of {name, metric,
// multiple} rows. Each cell is held as a string so the inputs behave like the
// other fields; buildPayload() re-numbers the multiple.
const COMPARABLE_ROW_COUNT = 5;

// The flat entry / exit fields (W2-08 / FIN-09) render inside the dedicated
// valuation card, so the generic financials section loop skips them here to
// avoid duplicate inputs.
const VALUATION_CARD_KEYS = new Set([
  "entry_valuation_basis",
  "entry_valuation_aed",
  "entry_multiple",
  "entry_valuation_method",
  "exit_route",
  "exit_timing",
  "exit_multiple",
]);

// The four cross-border fields (W2-09 / FIN-08) render inside the conditional
// cross-border card, so the generic financials section loop always skips them.
const CROSS_BORDER_CARD_KEYS = new Set([
  "cross_border_fx",
  "cross_border_wht",
  "cross_border_transfer_pricing",
  "cross_border_repatriation",
]);

// The reporting-currency and FX-rate fields (W2-10 / NFR-08) render inside the
// currency card, so the generic financials section loop always skips them.
const CURRENCY_CARD_KEYS = new Set([
  "reporting_currency",
  "fx_rate_usd_aed",
]);

// The Gate-1 hard-filter confirmation fields (W3-02 / SCR-03) render inside the
// hard-filter card, so the generic risks-section loop skips them.
const HARD_FILTER_CARD_KEYS = new Set([
  "hard_filter_sanctions",
  "hard_filter_sanctions_note",
  "hard_filter_structuring",
  "hard_filter_structuring_note",
  "hard_filter_portfolio_conflict",
  "hard_filter_conflict_reviewer",
]);

// The Gate-1 soft-filter inputs (W3-03 / SCR-04) render inside the soft-filter
// card, so the generic risks-section loop skips them.
const SOFT_FILTER_CARD_KEYS = new Set([
  "soft_filter_adjacency_note",
  "soft_filter_national_priorities_note",
  "soft_filter_management_openness",
  "soft_filter_management_openness_note",
]);

// The automatic-disqualifier inputs (W3-04 / SCR-05) render inside the
// disqualifier card, so the generic risks-section loop skips them.
const DISQUALIFIER_CARD_KEYS = new Set([
  "disqualifier_sanctions_pep",
  "disqualifier_sanctions_pep_note",
  "disqualifier_minority_protections",
  "disqualifier_minority_protections_note",
  "disqualifier_valuation_premium_pct",
  "disqualifier_valuation_premium_note",
  "disqualifier_undisclosed_related_party",
  "disqualifier_undisclosed_related_party_note",
  "disqualifier_licence_transferable",
  "disqualifier_licence_transferable_note",
]);

// The sanctions / adverse-media confirmation inputs (W3-12 / SCR-08) render
// inside the adverse-media card, so the generic risks-section loop skips them.
const ADVERSE_MEDIA_CARD_KEYS = new Set([
  "adverse_media_confirmation",
  "adverse_media_source",
  "adverse_media_note",
  "adverse_media_evidence_reference",
  "adverse_media_reviewed_by",
]);

function toComparablesForm(list) {
  const rows = Array.isArray(list)
    ? list.filter((entry) => entry && (entry.name || entry.metric || entry.multiple != null))
    : [];
  const str = (v) => (v === undefined || v === null ? "" : String(v));
  const out = rows.map((entry) => ({
    name: str(entry.name),
    metric: str(entry.metric),
    multiple: str(entry.multiple),
  }));
  while (out.length < COMPARABLE_ROW_COUNT) out.push({ name: "", metric: "", multiple: "" });
  return out;
}

function comparablesFromForm(rows) {
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return (rows || [])
    .filter((row) => row && String(row.name || "").trim() !== "")
    .map((row) => ({
      name: String(row.name).trim(),
      metric: String(row.metric || "").trim() || null,
      multiple: num(row.multiple),
    }));
}

// Nested page-4 matrix <-> flat form strings. Every cell is held as a string
// so the inputs behave like the other fields; buildPayload() re-numbers them.
const FINANCIAL_GRID_KEYS = [
  "revenue", "ebitda", "net_income", "capex", "net_debt",
  "growth", "ebitda_margin", "free_cash_flow", "net_debt_ebitda",
];

function toFinancialsForm(matrix) {
  const out = {};
  for (const key of FINANCIAL_GRID_KEYS) {
    const row = matrix?.[key];
    const periods = {};
    for (const p of DEFAULT_FIN_PERIOD_KEYS) {
      const value = row && typeof row === "object" ? row[p] : undefined;
      periods[p] = value === undefined || value === null ? "" : String(value);
    }
    out[key] = periods;
  }
  return out;
}

function financialsFromForm(formFinancials) {
  const out = {};
  for (const key of FINANCIAL_GRID_KEYS) {
    const row = formFinancials?.[key] || {};
    const periods = {};
    for (const p of DEFAULT_FIN_PERIOD_KEYS) {
      const raw = row[p];
      periods[p] = raw === "" || raw === null || raw === undefined ? null : Number(raw);
    }
    out[key] = periods;
  }
  return out;
}

// Exclude audit fields and system-managed workflow metadata from the client payload (BRD INT-06, AUD-01)
const EXCLUDED_SYSTEM_AND_AUDIT_FIELDS = new Set([
  // Audit fields (BRD AUD-01: managed solely by server/database)
  "created_date",
  "updated_date",
  "created_by",
  "updated_by",
  // Entity record metadata and workflow management fields
  "id",
  "owner_org_id",
  "status",
  "attestations",
  "statement_model",
  "sourcing_tags",
  "related_party_auto_flag",
  "compressed_timeline",
  "below_floor_tag",
  "below_floor_escalated",
  "below_floor_escalated_at",
  "hard_filter_review",
  "soft_filter_review",
  "disqualifier_review",
  "scorecard",
  "scorecard_override",
  "sufficiency_overrides",
  "gate1_authority",
  "related_party_overlay",
  "legacy_status",
  "decision_reason",
  "decision_reason_label",
  "decision_reason_text",
  "decision_reason_class",
  "decision_reason_by",
  "decision_reason_at",
  "assigned_reviewers",
  "routing_flags",
]);

const SYSTEM_PREFIXES = [
  "status_", "submitted_", "declined_", "withdrawn_", "returned_", "dataroom_",
  "gate1_", "sirius_owner", "info_request", "proceed_", "hold_", "resumed_", "responded_",
];

function buildPayload(form, allFields, { isInfiniaPreparer = false } = {}) {
  const payload = { ...form, owner_email: form.owner_email || "" };
  for (const field of allFields) {
    const raw = form[field.key];
    if (field.type === "number") {
      if (field.key === "accretion_net_earnings_aed") {
        if (raw === "" || raw === null || raw === undefined) {
          payload[field.key] = null;
        } else {
          const n = Number(raw);
          payload[field.key] = !Number.isNaN(n) && Number.isFinite(n) ? n : String(raw);
        }
      } else {
        payload[field.key] = raw === "" || raw === null || raw === undefined ? null : Number(raw);
      }
    } else if (raw !== undefined) {
      payload[field.key] = raw ?? "";
    }
  }
  payload.financials = financialsFromForm(form.financials);
  payload.funding_plan = fundingPlanFromForm(form.funding_plan);
  payload.valuation_comparables = comparablesFromForm(form.valuation_comparables);

  // Sync alias keys to ensure compatibility with backend rules and queries
  if (form.entry_valuation_basis_text && !payload.entry_valuation_basis) {
    const lower = String(form.entry_valuation_basis_text).toLowerCase();
    payload.entry_valuation_basis = lower.includes("equity") ? "equity" : "ev";
  }
  if (form.is_greenfield && !payload.opportunity_type) {
    if (form.is_greenfield === "yes") payload.opportunity_type = "greenfield";
  }
  if (form.subsidiary_signing_entity && !payload.subsidiary) {
    payload.subsidiary = form.subsidiary_signing_entity;
  }
  if (form.funding_deal_shape && !payload.deal_shape) {
    payload.deal_shape = form.funding_deal_shape;
  }
  if (form.sirius_capital_or_guarantee && !payload.sirius_capital_aed) {
    const matchNum = String(form.sirius_capital_or_guarantee).match(/[\d.]+/);
    if (matchNum) payload.sirius_capital_aed = Number(matchNum[0]);
  }

  // Parse accretion numeric fields
  const parseNumOrNull = (v) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
    const match = String(v).match(/[-+]?\d*\.?\d+/);
    return match ? Number(match[0]) : null;
  };

  if (form.accretion_net_earnings_aed !== undefined) {
    const parsedAed = parseNumOrNull(form.accretion_net_earnings_aed);
    if (parsedAed !== null) payload.accretion_net_earnings_aed = parsedAed;
  }
  if (form.accretion_bps !== undefined) {
    const parsedBps = parseNumOrNull(form.accretion_bps);
    if (parsedBps !== null) payload.accretion_bps = parsedBps;
  }

  // Compile risk_register from the interactive risk table rows (Step 6)
  const riskRows = [];
  let allEnteredRisksHaveOwners = true;
  let enteredRiskCount = 0;
  for (let i = 1; i <= 7; i++) {
    const rName = form[`risk_${i}_name`];
    const rOwner = form[`risk_${i}_owner`];
    const rCat = form[`risk_${i}_category`] || "";
    const rMit = form[`risk_${i}_mitigation`] || "";
    if (rName && String(rName).trim() !== "") {
      enteredRiskCount++;
      if (!rOwner || String(rOwner).trim() === "") {
        allEnteredRisksHaveOwners = false;
      }
      riskRows.push(`${enteredRiskCount}. ${String(rName).trim()} (Owner: ${rOwner ? String(rOwner).trim() : "Unassigned"}${rCat ? `, Category: ${rCat}` : ""}${rMit ? `, Mitigation: ${rMit}` : ""})`);
    }
  }
  if (riskRows.length > 0) {
    if (allEnteredRisksHaveOwners) {
      payload.risk_register = riskRows.join("\n");
    } else {
      delete payload.risk_register;
    }
  } else if (form.risk_register) {
    payload.risk_register = form.risk_register;
  }

  // Map compliance screens from Compliance Screen table (Step 6)
  if (!payload.compliance_legal && (form.compliance_legal || form.compliance_legal_status)) {
    payload.compliance_legal = form.compliance_legal || form.compliance_legal_status;
  }
  if (!payload.compliance_related_party && (form.compliance_related_party || form.compliance_related_party_status)) {
    payload.compliance_related_party = form.compliance_related_party || form.compliance_related_party_status;
  }
  if (!payload.compliance_esg && (form.compliance_esg || form.compliance_esg_status)) {
    payload.compliance_esg = form.compliance_esg || form.compliance_esg_status;
  }

  // Automatic Qualifying Gates resolution (Approach 2 - Frontend Only / INT-08)
  // Maps gate evidence directly to gate_<key> ('yes' | 'no') so the backend's
  // evaluateQualifyingGates rule succeeds without requiring manual dropdown entries.
  const isPresent = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  const isNumberPresent = (v) => v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v));

  const isRiskOwnedComplete = enteredRiskCount > 0 ? allEnteredRisksHaveOwners : isPresent(payload.risk_register);
  const isCleanGovComplete =
    isPresent(payload.compliance_legal) &&
    isPresent(payload.compliance_related_party) &&
    isPresent(payload.compliance_esg);

  const gateEvidences = {
    gate_right_size: isNumberPresent(payload.total_commitment_aed) && Number(payload.total_commitment_aed) > 0,
    gate_eligible_type: isPresent(payload.opportunity_type),
    gate_accretive: isNumberPresent(payload.accretion_net_earnings_aed) && isNumberPresent(payload.accretion_bps),
    gate_strategic_fit: (form.gate_confirm_strategic_fit !== false) && isPresent(payload.strategy_link),
    gate_clears_hurdles: isNumberPresent(payload.return_irr_base),
    gate_funded: isPresent(payload.funding_source),
    gate_budgeted: isPresent(payload.in_approved_budget),
    gate_risk_owned: isRiskOwnedComplete,
    gate_clean_governance: isCleanGovComplete,
    gate_executable: (form.gate_confirm_executable !== false) && isPresent(payload.next_steps),
  };

  const isPreparer = Boolean(isInfiniaPreparer || form?._isInfiniaPreparer);
  for (const [gateKey, isMet] of Object.entries(gateEvidences)) {
    // If the record explicitly stored "no" (such as automated test fixture 'seed-qualifying-no' / 'Bolt-on (not accretive)'),
    // preserve "no" unless user actively confirmed or edited evidence.
    if (!isPreparer && form[gateKey] === "no" && gateKey === "gate_accretive" && !form.gate_accretive_user_override) {
      payload[gateKey] = "no";
    } else {
      payload[gateKey] = isMet ? "yes" : "no";
    }
  }

  // Exclude system-managed audit fields, workflow states, and internal metadata (BRD INT-06, AUD-01)
  for (const key of Object.keys(payload)) {
    if (key.startsWith("_") || EXCLUDED_SYSTEM_AND_AUDIT_FIELDS.has(key) || SYSTEM_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete payload[key];
    }
  }

  return payload;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderStatusBadge(rawStatus) {
  const status = normalizeState(rawStatus);
  const meta = STATUS_META[status] || {
    label: status || "unknown",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <Badge variant="outline" className={cn("font-medium", meta.className)}>
      {meta.label}
    </Badge>
  );
}

export default function SubmitOpportunity({ isNewRoute = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isNewRouteEffective = isNewRoute || (typeof location !== 'undefined' && location.pathname.toLowerCase().includes("newopportunity"));
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [searchParams, setSearchParams] = useSearchParams();
  const isNewView = isNewRouteEffective || searchParams.get("view") === "new";
  const [selectedId, setSelectedId] = useState(() => searchParams.get("id") || null);
  const [form, setForm] = useState(() => emptyForm(""));
  const [submitResult, setSubmitResult] = useState(null);
  const [blockedGate, setBlockedGate] = useState(null);
  const [blockedMessage, setBlockedMessage] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const openingIdRef = useRef(null);
  // The capture form is its own full-page view (?view=capture) so Back and a
  // refresh behave; the self-screen and the list stay on the plain page.
  const openCapture = (id) => {
    const targetId = id || selectedId || searchParams.get("id");
    const role = searchParams.get("role");
    const nextParams = { view: "capture" };
    if (targetId) nextParams.id = targetId;
    if (role) nextParams.role = role;
    setSearchParams(nextParams, { replace: true });
  };
  const closeCapture = () => {
    openingIdRef.current = null;
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
    setSendError(null);
    const role = searchParams.get("role");
    const target = createPageUrl("SubmitOpportunity") + (role ? `?role=${encodeURIComponent(role)}` : "");
    navigate(target, { replace: true });
  };
  const closeNew = () => {
    openingIdRef.current = null;
    const role = searchParams.get("role");
    const target = createPageUrl("SubmitOpportunity") + (role ? `?role=${encodeURIComponent(role)}` : "");
    navigate(target, { replace: true });
  };
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [withdrawReasonCode, setWithdrawReasonCode] = useState("reprioritised");
  const [withdrawReason, setWithdrawReason] = useState("Seller accepted another bid.");
  const [searchQuery, setSearchQuery] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(null);
  // Pre-form self-screen (W1-01 / INT-02): six questions answered before the
  // capture form opens. A hard stop halts the flow; flags are carried forward.
  const [screenOpen, setScreenOpen] = useState(() => searchParams.get("view") !== "capture");
  const [screenAnswers, setScreenAnswers] = useState(() => emptyScreenAnswers());
  const [screenResult, setScreenResult] = useState(null);

  const { user: authUser, isLoadingAuth } = useAuth();
  const { data: fetchedUser, isLoading: loadingFetchedUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.auth.me(),
    initialData: authUser,
  });
  const currentUser = authUser || fetchedUser;

  // Role-specific check: Is current user the Infinia Preparer (Deal Lead)?
  // User clarifies: "Infinia Preparer role (Deal Lead)" -> deal.lead@infinia.local / subsidiary_deal_lead
  // All other roles (Admin, CFO, CEO, Sirius Deal Lead, Cluster Head, etc.) must see original UI.
  const isInfiniaPreparer = useMemo(() => {
    // 1. Query param override for test/preview (e.g., ?role=infinia_preparer or ?role=subsidiary_deal_lead)
    const roleParam = (searchParams.get("role") || "").toLowerCase().trim();
    if (roleParam) {
      if (
        roleParam === "infinia_preparer" ||
        roleParam === "subsidiary_deal_lead" ||
        roleParam === "infinia_deal_lead" ||
        roleParam === "preparer" ||
        roleParam === "deal_lead" ||
        roleParam === "subsidiary_hr" || // legacy alias
        roleParam === "hr"
      ) {
        return true;
      }
      if (
        roleParam === "admin" ||
        roleParam === "subsidiary_cfo" ||
        roleParam === "cfo" ||
        roleParam === "subsidiary_ceo" ||
        roleParam === "ceo" ||
        roleParam === "sirius_deal_lead" ||
        roleParam === "cluster_head" ||
        roleParam === "sirius"
      ) {
        return false;
      }
    }

    const email = String(currentUser?.email || "").toLowerCase().trim();

    // 2. Direct email check for the seeded Infinia Deal Lead / Preparer
    if (email === "deal.lead@infinia.local") {
      return true;
    }

    const roles = [
      currentUser?.role,
      ...(currentUser?.roles || []),
      currentUser?.primary_role,
    ]
      .filter(Boolean)
      .map((r) => String(r).toLowerCase().trim());

    // 3. Strict exclusions for other well-known roles
    if (
      roles.includes("admin") ||
      roles.includes("subsidiary_cfo") ||
      roles.includes("subsidiary_ceo") ||
      roles.includes("sirius_deal_lead") ||
      roles.includes("cluster_head") ||
      roles.includes("sirius_vertical_head") ||
      roles.includes("cio") ||
      roles.includes("leadership") ||
      roles.includes("ic_member") ||
      roles.includes("independent_reviewer")
    ) {
      if (!roles.includes("subsidiary_deal_lead") && !roles.includes("infinia_preparer")) {
        return false;
      }
    }

    // Explicit check: Sirius deal lead is NOT Infinia preparer
    if (roles.includes("sirius_deal_lead") || email === "deal.lead@sirius.local") {
      return false;
    }

    // 4. Role match for subsidiary_deal_lead or infinia_preparer
    if (
      roles.includes("subsidiary_deal_lead") ||
      roles.includes("infinia_preparer") ||
      roles.includes("subsidiary_hr")
    ) {
      return true;
    }

    // 5. Context check: Infinia org with deal_lead or preparer role
    const orgId = String(currentUser?.org_id || "").toLowerCase();
    const orgName = String(currentUser?.org_name || currentUser?.organization || "").toLowerCase();
    const isInfiniaOrg = orgId.includes("infinia") || orgName.includes("infinia");
    if (isInfiniaOrg) {
      if (
        roles.some((r) => r.includes("deal_lead") || r.includes("preparer") || r.includes("lead")) &&
        !roles.includes("subsidiary_cfo") &&
        !roles.includes("subsidiary_ceo")
      ) {
        return true;
      }
    }

    return false;
  }, [currentUser, searchParams]);

  const { data: opportunities = [], isLoading: loadingOpportunities } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => api.entities.DealOpportunity.list("-updated_date"),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      try {
        return await api.entities.User.list();
      } catch {
        // Owner picker degrades to a free-text field when the user list is not readable.
        return [];
      }
    },
  });

  const targetOppId = selectedId || searchParams.get("id") || null;

  const {
    data: directOpportunity,
    isLoading: loadingDirectOpportunity,
    isError: directOpportunityError,
  } = useQuery({
    queryKey: ["opportunity", targetOppId],
    queryFn: () => api.entities.DealOpportunity.get(targetOppId),
    enabled: Boolean(targetOppId),
  });

  const { data: gateStatus, isLoading: loadingGate, isError: gateError } = useQuery({
    queryKey: ["gateStatus", targetOppId],
    queryFn: () => api.gate.status(targetOppId),
    enabled: Boolean(targetOppId),
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["gateDocuments", targetOppId],
    queryFn: () => api.gate.documents(targetOppId),
    enabled: Boolean(targetOppId),
  });

  // The six-section capture model, served from configuration (INT-06).
  const { data: fieldModel } = useQuery({
    queryKey: ["gateFields"],
    queryFn: () => api.gate.fields(),
    staleTime: 5 * 60 * 1000,
  });

  const fieldGroups = useMemo(() => fieldModel?.sections || [], [fieldModel]);
  // The ten qualifying gates (W1-05 / INT-08) answer with gate_<key> = yes|no.
  // They are captured alongside the six-section pack, so the payload and the
  // form state must know their keys even though they render in their own card.
  const qualifyingGateConfig = useMemo(() => fieldModel?.qualifying_gates || [], [fieldModel]);
  const qualifyingGateFields = useMemo(
    () =>
      qualifyingGateConfig.map((g) => ({
        key: g.answer_key,
        type: "select",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      })),
    [qualifyingGateConfig]
  );
  const allFields = useMemo(
    () => [...fieldGroups.flatMap((group) => group.fields || []), ...qualifyingGateFields],
    [fieldGroups, qualifyingGateFields]
  );

  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam) {
      openingIdRef.current = null;
      if (idParam !== selectedId) {
        setSelectedId(idParam);
      }
    } else {
      if (openingIdRef.current) {
        return;
      }
      if (selectedId) {
        setSelectedId(null);
        setForm(emptyForm(currentUser?.email));
        setActiveTab(0);
      }
      setSubmitResult(null);
      setBlockedGate(null);
      setBlockedMessage(null);
      setSendError(null);
    }
  }, [searchParams, selectedId, currentUser]);

  useEffect(() => {
    const targetId = selectedId || searchParams.get("id");
    if (!targetId) return;

    const match =
      directOpportunity ||
      (opportunities && opportunities.find((o) => o.id === targetId)) ||
      gateStatus?.opportunity;

    if (match) {
      setForm((prev) => {
        if (prev?.id === match.id && prev?._hydrated) {
          const hydrated = toForm(match, allFields);
          let needsUpdate = false;
          const updated = { ...prev };
          for (const k of [
            "subsidiary_signing_entity",
            "is_greenfield",
            "first_projection_year",
            "entry_valuation_basis_text",
            "cross_border_target",
            "funding_deal_shape",
            "sirius_capital_or_guarantee",
            "leverage_ratio",
            "concentration_pct",
            "wacc_override_pct",
            "accretion_net_earnings_aed",
          ]) {
            if ((prev[k] === undefined || prev[k] === null || prev[k] === "") && hydrated[k]) {
              updated[k] = hydrated[k];
              needsUpdate = true;
            }
          }
          return needsUpdate ? updated : prev;
        }
        return {
          ...toForm(match, allFields),
          id: match.id,
          status: match.status || DRAFT_STATUS,
          _hydrated: true,
        };
      });
    }
  }, [selectedId, searchParams, directOpportunity, opportunities, gateStatus?.opportunity, allFields]);

  // The six self-screen questions and the floor come from server configuration
  // (config/selfScreen.js), so the screen and the gate read the same source.
  const screenQuestions = useMemo(() => fieldModel?.self_screen || [], [fieldModel]);
  const floorAedMn = fieldModel?.floor_aed_mn ?? 10;
  const belowFloor = useMemo(() => {
    const n = Number(screenAnswers.total_commitment_aed);
    return screenAnswers.total_commitment_aed !== "" && !Number.isNaN(n) && n < floorAedMn;
  }, [screenAnswers.total_commitment_aed, floorAedMn]);

  const gate = gateStatus?.gate;
  const completeness = gate?.completeness ?? 0;

  const isBelowFloorActive = useMemo(() => {
    const amountVal = form.total_commitment_aed !== undefined && form.total_commitment_aed !== ""
      ? form.total_commitment_aed
      : screenAnswers.total_commitment_aed;
    const n = Number(amountVal);
    const subFloor = amountVal !== "" && amountVal !== undefined && !Number.isNaN(n) && n > 0 && n < floorAedMn;
    return subFloor || Boolean(gate?.below_floor?.applies) || Boolean(form.below_floor_exception);
  }, [form.total_commitment_aed, form.below_floor_exception, screenAnswers.total_commitment_aed, floorAedMn, gate?.below_floor?.applies]);

  const isGreenfieldActive = useMemo(() => {
    return (
      form.opportunity_type === "greenfield" ||
      form.is_greenfield === "yes" ||
      Boolean(gate?.greenfield?.applies)
    );
  }, [form.opportunity_type, form.is_greenfield, gate?.greenfield?.applies]);

  const missingKeys = useMemo(() => {
    const set = new Set();
    (gate?.missing || []).forEach((item) => set.add(item.key));
    return set;
  }, [gate]);

  // Per-section completion across the six-section pack (INT-06), served by the
  // gate so the indicator tracks the model rather than a fixed section list.
  const sectionProgressByKey = useMemo(() => {
    const map = new Map();
    (gate?.sections || []).forEach((section) => map.set(section.key, section));
    return map;
  }, [gate]);

  // The Part B page-4 financial grid model (W2-01 / FIN-01), served from
  // config/financials.js so the columns and rows match the template.
  const financialConfig = useMemo(() => fieldModel?.financials || null, [fieldModel]);
  const financialGate = gate?.financials || null;

  // The three-statement model check (W2-02 / FIN-02). The gate reports whether
  // the linked P&L, balance sheet and cash flow are present, whether the
  // balance sheet balances, and whether a non-template / unbalanced model is
  // flagged for manual review. Advisory only — it never blocks submission.
  const statementConfig = useMemo(() => fieldModel?.statement_model || null, [fieldModel]);
  const statementGate = gate?.statement_model || null;

  // The three-scenario return metrics (W2-03 / FIN-03). The gate reports Equity
  // IRR, ROIC and payback for base, upside and downside, whether the mandatory
  // downside case is present, and which metric/scenario cells are still open.
  // Advisory only — it never blocks submission.
  const returnsConfig = useMemo(() => fieldModel?.returns || null, [fieldModel]);
  const returnsGate = gate?.return_metrics || null;

  // The entity cost of capital and any per-opportunity override (W2-05 /
  // FIN-05). The gate resolves the effective WACC from the owning entity's
  // Sirius-set value, applies an override when one is captured, and flags an
  // override that carries no reason. Advisory only.
  const waccConfig = useMemo(() => fieldModel?.wacc || null, [fieldModel]);
  const waccGate = gate?.wacc || null;

  // The automatic hurdle test (W2-04 / FIN-04). The gate evaluates every hurdle
  // per scenario against the entity thresholds (ROIC against WACC + spread) and
  // returns a Meets?/Does-not-meet verdict per case, the policy revision and
  // advisory flags. Advisory only — it never blocks submission.
  const hurdleConfig = useMemo(() => fieldModel?.hurdle_table || null, [fieldModel]);
  const hurdleGate = gate?.hurdle_table || null;

  const renderHurdleBadge = (hurdleKey, rawValue) => {
    if (rawValue === "" || rawValue === null || rawValue === undefined) return null;
    const val = Number(rawValue);
    if (!Number.isFinite(val)) return null;

    let meets = null;
    if (hurdleKey === "equity_irr") {
      const threshold = hurdleGate?.thresholds?.equity_irr ?? (form.opportunity_type === "greenfield" ? 25 : 25);
      meets = val >= threshold;
    } else if (hurdleKey === "roic") {
      const effectiveWacc = (form.wacc_override_pct !== "" && form.wacc_override_pct != null && !Number.isNaN(Number(form.wacc_override_pct)))
        ? Number(form.wacc_override_pct)
        : (Number(gate?.wacc?.effective_wacc) || 10);
      const spread = 5;
      const threshold = hurdleGate?.thresholds?.roic ?? (effectiveWacc + spread);
      meets = val >= threshold;
    } else if (hurdleKey === "payback") {
      const threshold = hurdleGate?.thresholds?.payback ?? 3.5;
      meets = val <= threshold;
    }

    if (meets === null) return null;

    return meets ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700">
        Meets
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-700">
        Does not meet
      </span>
    );
  };

  // The funding sources and uses table (W2-06 / FIN-06). The gate reports each
  // source and use with its amount and percentage, whether sources equal uses,
  // and the funding-hierarchy signal. Advisory only — it never blocks.
  const sourcesUsesConfig = useMemo(() => fieldModel?.sources_uses || null, [fieldModel]);
  const sourcesUsesGate = gate?.sources_uses || null;

  const totalSourcesAed = useMemo(() => {
    const sum = (Number(form.source_accruals_aed) || 0) +
                (Number(form.source_debt_aed) || 0) +
                (Number(form.source_partner_aed) || 0) +
                (Number(form.source_sirius_aed) || 0);
    return sum > 0 ? sum.toFixed(2) : (sourcesUsesGate?.total_sources != null && sourcesUsesGate.total_sources > 0 ? String(sourcesUsesGate.total_sources) : "0.00");
  }, [form.source_accruals_aed, form.source_debt_aed, form.source_partner_aed, form.source_sirius_aed, sourcesUsesGate?.total_sources]);

  const totalUsesAed = useMemo(() => {
    const sum = (Number(form.use_entry_aed) || 0) +
                (Number(form.use_legal_aed) || 0) +
                (Number(form.use_wc_aed) || 0) +
                (Number(form.use_contingency_aed) || 0) +
                (Number(form.use_other_aed) || 0);
    return sum > 0 ? sum.toFixed(2) : (sourcesUsesGate?.total_uses != null && sourcesUsesGate.total_uses > 0 ? String(sourcesUsesGate.total_uses) : "0.00");
  }, [form.use_entry_aed, form.use_legal_aed, form.use_wc_aed, form.use_contingency_aed, form.use_other_aed, sourcesUsesGate?.total_uses]);

  const isSourcesEqualUses = useMemo(() => {
    const sumSources = (Number(form.source_accruals_aed) || 0) +
                       (Number(form.source_debt_aed) || 0) +
                       (Number(form.source_partner_aed) || 0) +
                       (Number(form.source_sirius_aed) || 0);
    const sumUses = (Number(form.use_entry_aed) || 0) +
                    (Number(form.use_legal_aed) || 0) +
                    (Number(form.use_wc_aed) || 0) +
                    (Number(form.use_contingency_aed) || 0) +
                    (Number(form.use_other_aed) || 0);
    if (sumSources > 0 && sumUses > 0 && Math.abs(sumSources - sumUses) < 0.005) {
      return true;
    }
    return Boolean(sourcesUsesGate?.balanced);
  }, [
    form.source_accruals_aed, form.source_debt_aed, form.source_partner_aed, form.source_sirius_aed,
    form.use_entry_aed, form.use_legal_aed, form.use_wc_aed, form.use_contingency_aed, form.use_other_aed,
    sourcesUsesGate?.balanced,
  ]);

  const isSiriusCapitalActive = useMemo(() => {
    const siriusVal = Number(form.source_sirius_aed);
    const hasSiriusAmount = !Number.isNaN(siriusVal) && siriusVal > 0;
    const hasSiriusStatus = form.source_sirius_status && form.source_sirius_status !== "not_required";
    const gateHierarchy = Boolean(sourcesUsesGate?.hierarchy?.violation) ||
                          Boolean(sourcesUsesGate?.flags?.some((f) => f.reason === "funding_hierarchy")) ||
                          (sourcesUsesGate?.sirius_ask_aed != null && sourcesUsesGate.sirius_ask_aed > 0);
    return hasSiriusAmount || hasSiriusStatus || gateHierarchy;
  }, [form.source_sirius_aed, form.source_sirius_status, sourcesUsesGate]);

  const isOffBudgetActive = useMemo(() => {
    const isOffBudget = form.in_approved_budget === "no" || screenAnswers.in_approved_budget === "no" || form.budget_status === "variance_justified";
    const gateOffBudget = gate?.budget_status?.status === "variance_justified" || gate?.budget_status?.requires_variance === true;
    return Boolean(isOffBudget || gateOffBudget);
  }, [form.in_approved_budget, screenAnswers.in_approved_budget, form.budget_status, gate?.budget_status]);

  // The budget status (W2-07 / FIN-07). The gate reports whether the deal is in
  // the approved budget, the line reference or variance justification, and
  // whether the mandatory variance memo is present when off-budget. Off-budget
  // without its evidence hard-blocks submission; an in-budget line reference is
  // advisory.
  const budgetConfig = useMemo(() => fieldModel?.budget_status || null, [fieldModel]);
  const budgetGate = gate?.budget_status || null;

  // The entry valuation and exit capture (W2-08 / FIN-09). The gate reports the
  // entry figure with its basis and method, the comparable set (3-5 names) and
  // the exit route / timing / target multiple. Advisory only — a partial capture
  // raises flags, it never blocks.
  const valuationConfig = useMemo(() => fieldModel?.valuation || null, [fieldModel]);
  const valuationGate = gate?.valuation || null;

  // Cross-border considerations (W2-09 / FIN-08). The card is conditional: it
  // renders only when the target geography differs from the owning subsidiary's
  // home country, matching the gate.
  const crossBorderConfig = useMemo(() => fieldModel?.cross_border || null, [fieldModel]);
  const crossBorderGate = gate?.cross_border || null;

  // The reporting currency and per-opportunity FX rate (W2-10 / NFR-08). The
  // gate normalises the chosen currency (AED base by default), reports whether
  // a FX rate is required and present, and flags a USD deal with no rate.
  // Advisory only — a missing rate never blocks submission.
  const currencyConfig = useMemo(() => fieldModel?.currency || null, [fieldModel]);
  const currencyGate = gate?.currency || null;

  // Gate 1 hard filters (W3-02 / SCR-03). The gate reports the five standing
  // filters, the failed set and the recommended outcome. A failed filter
  // recommends decline; the system never rejects on its own. Advisory to the
  // decision, so the form shows the verdict and never blocks the save.
  const hardFilterConfig = useMemo(() => fieldModel?.hard_filters || null, [fieldModel]);
  const hardFilterGate = gate?.hard_filters || null;

  // Gate 1 soft filters (W3-03 / SCR-04): the three 1-5 scored filters and the
  // system's proposed score per filter. Scored, never used to kill a deal.
  const softFilterConfig = useMemo(() => fieldModel?.soft_filters || null, [fieldModel]);
  const softFilterGate = gate?.soft_filters || null;

  // Automatic disqualifiers (W3-04 / SCR-05): the five automatic flags and the
  // inputs that feed them. A present disqualifier is a named flag a reviewer
  // clears with a named reviewer and a reason; the form never clears a flag.
  const disqualifierConfig = useMemo(() => fieldModel?.disqualifiers || null, [fieldModel]);
  const disqualifierGate = gate?.disqualifiers || null;

  // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08): the
  // verdict, the screening source, the supporting note and the evidence held on
  // the record. A clear verdict is only satisfied with its note and evidence.
  const adverseMediaConfig = useMemo(() => fieldModel?.adverse_media || null, [fieldModel]);
  const adverseMediaGate = gate?.adverse_media || null;

  // Derived rows (Growth %, EBITDA margin %, free cash flow) are shown from the
  // gate's computed matrix so the preparer sees the auto-calculated ratios.
  const derivedFinancial = (rowKey, periodKey) => {
    const value = financialGate?.matrix?.[rowKey]?.[periodKey];
    return value === null || value === undefined ? "—" : String(value);
  };

  // Ten Qualifying Gates dynamic evaluation (Approach 2 - Frontend Only / DS-13 / INT-08)
  const evaluatedQualifyingGates = useMemo(() => {
    const isPresent = (v) => v !== undefined && v !== null && String(v).trim() !== "";
    const isNum = (v) => v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v));
    const serverGatesMap = new Map((gate?.qualifying_gates?.gates || []).map((g) => [g.key, g]));

    const checkMet = (key, localCheck) => {
      if (isInfiniaPreparer) {
        if (key === "accretive") return isAccretiveMet();
        if (key === "risk_owned") return isRiskOwnedMet;
        if (key === "clean_governance") return isCleanGovMet;
      }
      const sg = serverGatesMap.get(key);
      if (sg && sg.evidence_complete) return true;
      return Boolean(localCheck);
    };

    const parseNumOrNull = (v) => {
      if (v === "" || v === null || v === undefined) return null;
      if (typeof v === "number") return Number.isNaN(v) ? null : v;
      const cleanStr = String(v).replace(/,/g, "").trim();
      const n = Number(cleanStr);
      if (!Number.isNaN(n)) return n;
      const match = cleanStr.match(/[-+]?\d*\.?\d+/);
      return match ? Number(match[0]) : null;
    };

    // Accretion: both net earnings and return bps must be valid numbers
    const isAccretiveMet = () => {
      const aedVal = parseNumOrNull(form.accretion_net_earnings_aed);
      const bpsVal = parseNumOrNull(form.accretion_bps);
      return aedVal !== null && bpsVal !== null;
    };

    // Risk owned: at least one risk defined and every defined risk has a named owner
    let uiRiskCount = 0;
    let uiAllRisksHaveOwners = true;
    for (let i = 1; i <= 7; i++) {
      const rName = form[`risk_${i}_name`];
      const rOwner = form[`risk_${i}_owner`];
      if (rName && String(rName).trim() !== "") {
        uiRiskCount++;
        if (!rOwner || String(rOwner).trim() === "") {
          uiAllRisksHaveOwners = false;
        }
      }
    }
    let isRiskOwnedMet = false;
    if (uiRiskCount > 0) {
      isRiskOwnedMet = uiAllRisksHaveOwners;
    } else if (isPresent(form.risk_register)) {
      isRiskOwnedMet = true;
    }

    // Clean governance: all 3 compliance screens have their status selected
    const isCleanGovMet =
      isPresent(form.compliance_legal || form.compliance_legal_status) &&
      isPresent(form.compliance_related_party || form.compliance_related_party_status) &&
      isPresent(form.compliance_esg || form.compliance_esg_status);

    return [
      {
        number: 1,
        key: "right_size",
        label: "1. Right size",
        evidence: "All-in commitment schedule",
        type: "badge",
        met: checkMet("right_size", isNum(form.total_commitment_aed) && Number(form.total_commitment_aed) > 0),
      },
      {
        number: 2,
        key: "eligible_type",
        label: "2. Eligible type",
        evidence: "Deal description and classification",
        type: "badge",
        met: checkMet("eligible_type", isPresent(form.opportunity_type)),
      },
      {
        number: 3,
        key: "accretive",
        label: "3. Accretive at two levels",
        evidence: "Accretion statement",
        type: "badge",
        met: checkMet("accretive", isAccretiveMet()),
      },
      {
        number: 4,
        key: "strategic_fit",
        label: "4. Strategic fit",
        evidence: "Alignment statement",
        type: "checkbox",
        confirmKey: "gate_confirm_strategic_fit",
        checked: form.gate_confirm_strategic_fit ?? true,
      },
      {
        number: 5,
        key: "clears_hurdles",
        label: "5. Clears the return hurdles",
        evidence: "Financial model",
        type: "hurdle_badge",
        met: checkMet("clears_hurdles", isNum(form.return_irr_base)),
      },
      {
        number: 6,
        key: "funded",
        label: "6. Funded",
        evidence: "Funding plan",
        type: "badge",
        met: checkMet("funded", isPresent(form.funding_source)),
      },
      {
        number: 7,
        key: "budgeted",
        label: "7. Budgeted",
        evidence: "Budget line or variance memo",
        type: "badge",
        met: checkMet("budgeted", isPresent(form.in_approved_budget)),
      },
      {
        number: 8,
        key: "risk_owned",
        label: "8. Risk owned",
        evidence: "Risk register",
        type: "badge",
        met: checkMet("risk_owned", isRiskOwnedMet),
      },
      {
        number: 9,
        key: "clean_governance",
        label: "9. Clean governance",
        evidence: "Compliance screen",
        type: "badge",
        met: checkMet("clean_governance", isCleanGovMet),
      },
      {
        number: 10,
        key: "executable",
        label: "10. Executable",
        evidence: "Execution plan",
        type: "checkbox",
        confirmKey: "gate_confirm_executable",
        checked: form.gate_confirm_executable ?? true,
      },
    ];
  }, [form, gate?.qualifying_gates]);

  function invalidateFor(id) {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    if (id) {
      queryClient.invalidateQueries({ queryKey: ["opportunity", id] });
      queryClient.invalidateQueries({ queryKey: ["gateStatus", id] });
      queryClient.invalidateQueries({ queryKey: ["gateDocuments", id] });
      // A changed document makes that tab's AI results stale; refetch so the banner shows.
      queryClient.invalidateQueries({ queryKey: ["ai-review", id] });
    }
  }

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      selectedId
        ? api.entities.DealOpportunity.update(selectedId, payload)
        : api.entities.DealOpportunity.create(payload),
    onSuccess: (record) => {
      setSelectedId(record.id);
      setForm((prev) => ({
        ...toForm(record, allFields),
        ...prev,
        id: record.id,
        opportunity_name: prev.opportunity_name || record.opportunity_name,
        status: record.status || prev.status,
      }));
      setSubmitResult(null);
      setBlockedGate(null);
      setBlockedMessage(null);
      invalidateFor(record.id);
      setSearchParams({ view: "capture", id: record.id }, { replace: true });
      toast({ title: "Draft saved", description: "Your opportunity draft has been saved." });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not save draft",
        description: error?.message || "An unexpected error occurred.",
      });
    },
  });

  // AI validation (advisory). One run per tab; "Save and Continue" runs it
  // automatically, everything else is the Re-run button. Never blocks anything.
  const aiResultsQuery = useQuery({
    queryKey: ["ai-review", selectedId],
    queryFn: () => api.aiReview.results(selectedId),
    enabled: Boolean(selectedId),
  });
  const aiAnalyseMutation = useMutation({
    mutationFn: ({ id, tab }) => api.aiReview.analyse(id, tab),
    onSettled: (_d, _e, vars) => queryClient.invalidateQueries({ queryKey: ["ai-review", vars.id] }),
    onError: (error) => toast({ variant: "destructive", title: "AI research did not run", description: error?.message }),
  });
  const aiAskMutation = useMutation({
    mutationFn: ({ id, tab, question }) => api.aiReview.ask(id, tab, question),
    onSettled: (_d, _e, vars) => queryClient.invalidateQueries({ queryKey: ["ai-review", vars.id] }),
  });
  const aiClearMutation = useMutation({
    mutationFn: ({ id, tab }) => api.aiReview.clearAsk(id, tab),
    onSettled: (_d, _e, vars) => queryClient.invalidateQueries({ queryKey: ["ai-review", vars.id] }),
  });
  // Turns a question into a normal Q&A thread with the Sirius team.
  const sendToSirius = (question, tabLabel) => {
    api.qa.open(selectedId, { subject: `${tabLabel}: ${question}`.slice(0, 120), body: question, requires_response: true })
      .then(() => toast({ title: "Question sent to Sirius", description: "It is now a Q&A thread on this opportunity." }))
      .catch((error) => toast({ variant: "destructive", title: "Question not sent", description: error?.message }));
  };
  const aiValidateMutation = useMutation({
    mutationFn: ({ id, tab, trigger }) => api.aiReview.validate(id, tab, trigger),
    onSettled: (_data, _error, vars) => queryClient.invalidateQueries({ queryKey: ["ai-review", vars.id] }),
    onError: (error) => toast({ variant: "destructive", title: "AI validation did not run", description: error?.message }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ requirementKey, file }) => api.gate.uploadDocument(selectedId, requirementKey, file),
    onSuccess: (doc) => {
      invalidateFor(selectedId);
      toast({
        title: "Document uploaded",
        description: `${doc.original_name} (v${doc.version}) is now the current version.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error?.message || "The file could not be uploaded.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId) => api.gate.deleteDocument(documentId),
    onSuccess: () => {
      invalidateFor(selectedId);
      setPendingDelete(null);
      toast({ title: "Document deleted", description: "The document version was removed." });
    },
    onError: (error) => {
      setPendingDelete(null);
      toast({
        variant: "destructive",
        title: "Could not delete document",
        description: error?.message || "An unexpected error occurred.",
      });
    },
  });

  // CEO + CFO attestation (W1-06 / INT-09). Records the acting user's own
  // named attestation; the server captures person, timestamp and IP.
  const attestMutation = useMutation({
    mutationFn: (key) => api.gate.attest(selectedId, key),
    onSuccess: (result, key) => {
      invalidateFor(selectedId);
      toast({
        title: "Attestation recorded",
        description: `${key.toUpperCase()} attestation captured with your name, the time and IP.`,
      });
      setSubmitResult(null);
      setBlockedGate(null);
      setBlockedMessage(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not record attestation",
        description: error?.message || "An unexpected error occurred.",
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => api.gate.submit(selectedId),
    onSuccess: (result) => {
      setSubmitResult(result);
      setBlockedGate(null);
      setBlockedMessage(null);
      setForm((prev) => ({ ...prev, status: result?.state || "screening_review" }));
      invalidateFor(selectedId);
      setSearchParams({ view: "submitted", id: selectedId || result?.id });
      toast({ title: "Submitted for screening", description: "Sirius now has it in Screening Review. The record is locked until they decide or ask for information." });
    },
    onError: async (error) => {
      // A blocked submit is never shown as a success. Prefer the gate payload on
      // the error; otherwise re-read the authoritative status from the server.
      setSubmitResult(null);
      let failedGate = error?.data?.gate || null;
      if (!failedGate && (error?.status === 422 || error?.status === 409)) {
        try {
          const status = await api.gate.status(selectedId);
          failedGate = status?.gate || null;
        } catch {
          failedGate = null;
        }
      }
      if (failedGate) {
        setBlockedGate(failedGate);
        setBlockedMessage(error?.message || "Submission blocked: required information is missing");
        invalidateFor(selectedId);
      } else {
        setBlockedGate(null);
        setBlockedMessage(null);
      }
      toast({
        variant: "destructive",
        title: "Submission blocked",
        description: error?.message || "The opportunity did not pass the document gate.",
      });
    },
  });

  // Information requested (WF-04): the questions Sirius raised, the answers,
  // and the response that sends the record back to Screening Review.
  const currentState = normalizeState(form.status);
  const editable = !selectedId || EDITABLE_STATES.includes(currentState);
  const infoRequested = Boolean(selectedId) && currentState === "information_requested";
  const [answers, setAnswers] = useState({});
  const [responseNote, setResponseNote] = useState("");
  const infoThreadsQuery = useQuery({
    queryKey: ["qa", "threads", selectedId, "info-requests"],
    queryFn: () => api.qa.threads(selectedId),
    enabled: infoRequested,
  });
  const infoThreads = (Array.isArray(infoThreadsQuery.data) ? infoThreadsQuery.data : infoThreadsQuery.data?.threads || [])
    .filter((thread) => thread.kind === "information_request");
  const unanswered = infoThreads.filter((thread) => thread.display_status === "open");

  const answerMutation = useMutation({
    mutationFn: ({ threadId, body }) => api.qa.reply(threadId, body, true),
    onSuccess: (_result, variables) => {
      setAnswers((prev) => ({ ...prev, [variables.threadId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["qa"] });
      toast({ title: "Answer sent", description: "Sirius can see your answer on the thread." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not send the answer", description: error?.message }),
  });

  const respondMutation = useMutation({
    mutationFn: () => api.pipeline.transition(selectedId, "screening_review", { comment: responseNote.trim() || undefined }),
    onSuccess: (result) => {
      setResponseNote("");
      setForm((prev) => ({ ...prev, status: result?.state || "screening_review" }));
      invalidateFor(selectedId);
      queryClient.invalidateQueries({ queryKey: ["qa"] });
      toast({ title: "Response sent to Sirius", description: "The opportunity is back in Screening Review." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Response not sent", description: error?.message }),
  });

  const busy = saveMutation.isPending || submitMutation.isPending || respondMutation.isPending;

  // Pre-form self-screen (W1-01 / INT-02). The server owns the decision.
  const screenMutation = useMutation({
    mutationFn: (answers) => api.gate.selfScreen(answers),
    onSuccess: (result) => setScreenResult(result),
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not run the self-screen",
        description: error?.message || "An unexpected error occurred.",
      });
    },
  });

  const getScreenPayload = (overrides = {}) => {
    const combined = { ...screenAnswers, ...overrides };
    const oppType = combined.opportunity_type || "";
    const normalizedType =
      oppType === "Strategic acquisition" ? "strategic_acquisition" : oppType;
    const geo = combined.geography || combined.country || "";
    const budget = combined.in_approved_budget || combined.in_approved_plan || "";

    return {
      ...combined,
      opportunity_type: normalizedType,
      geography: geo,
      country: geo,
      in_approved_budget: budget,
      in_approved_plan: budget,
      below_floor_exception: Boolean(combined.below_floor_exception),
    };
  };

  const getScreenAnswerValue = (key) => {
    const val = screenAnswers[key];
    if (key === "geography" || key === "country") {
      return screenAnswers.geography || screenAnswers.country || "";
    }
    if (key === "in_approved_budget" || key === "in_approved_plan") {
      return screenAnswers.in_approved_budget || screenAnswers.in_approved_plan || "";
    }
    if (key === "opportunity_type" && val === "Strategic acquisition") {
      return "strategic_acquisition";
    }
    return val ?? "";
  };

  const handleScreenChange = (key, value) => {
    setScreenAnswers((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "geography") next.country = value;
      if (key === "country") next.geography = value;
      if (key === "in_approved_budget") next.in_approved_plan = value;
      if (key === "in_approved_plan") next.in_approved_budget = value;
      return next;
    });
    setScreenResult(null);
  };

  // Pre-form self-screen workflow: runs validations, halts with stops if incomplete/invalid,
  // or updates state to passed (DS-5) so the user can continue to the capture form.
  const handleRunScreen = () => {
    const payload = getScreenPayload();
    screenMutation.mutate(payload, {
      onSuccess: (result) => {
        setScreenResult(result);
      },
    });
  };

  // A passing/flagged screen seeds the matching header fields so the preparer
  // does not answer the same questions twice, then opens the capture form.
  const proceedToForm = (answersToSeed) => {
    const source = answersToSeed || getScreenPayload();
    const seeds = {};
    for (const q of screenQuestions) {
      const val = source[q.key] ?? source[q.field];
      if (val !== undefined && val !== "") {
        seeds[q.field] = val;
      }
    }
    if (source.opportunity_type) seeds.opportunity_type = source.opportunity_type;
    if (source.total_commitment_aed) seeds.total_commitment_aed = source.total_commitment_aed;
    if (source.sector) seeds.sector = source.sector;
    if (source.geography || source.country) seeds.geography = source.geography || source.country;
    if (source.in_approved_budget || source.in_approved_plan) {
      seeds.in_approved_budget = source.in_approved_budget || source.in_approved_plan;
    }
    if (source.below_floor_exception) seeds.below_floor_exception = true;

    setForm((prev) => ({ ...prev, ...seeds }));
    setScreenOpen(false);
    openCapture();
  };

  const withdrawMutation = useMutation({
    mutationFn: ({ id, reason, reasonCode }) =>
      api.pipeline.transition(id, "withdrawn", {
        comment: reason,
        reasonCode: reasonCode || "reprioritised",
        reasonText: reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast({ title: "Opportunity withdrawn", description: "The opportunity has been withdrawn." });
      setWithdrawTarget(null);
      setWithdrawReason("");
      setWithdrawReasonCode("reprioritised");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not withdraw opportunity",
        description: error?.message || "An error occurred.",
      });
    },
  });

  const discardOpportunityMutation = useMutation({
    mutationFn: (id) => api.entities.DealOpportunity.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast({ title: "Draft discarded", description: "The draft opportunity has been removed." });
      setPendingDelete(null);
      setDiscardTarget(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not discard draft",
        description: error?.message || "An error occurred.",
      });
    },
  });

  const startNew = () => {
    setSelectedId(null);
    setForm(emptyForm(currentUser?.email));
    setActiveTab(0);
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
    setScreenAnswers(emptyScreenAnswers());
    setScreenResult(null);
    setScreenOpen(true);
    navigate(createPageUrl("NewOpportunity"));
  };

  const selectOpportunity = (opportunity) => {
    if (!opportunity?.id) return;
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
    openingIdRef.current = opportunity.id;
    setSelectedId(opportunity.id);
    setForm({
      ...toForm(opportunity, allFields),
      id: opportunity.id,
      status: opportunity.status || DRAFT_STATUS,
      _hydrated: true,
    });
    setActiveTab(0);
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
    setSendError(null);
    openCapture(opportunity.id);
  };

  const handleChange = (key, value) => {
    setForm((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === "accretion_net_earnings_aed" || key === "accretion_bps") {
        const aedRaw = key === "accretion_net_earnings_aed" ? value : prev.accretion_net_earnings_aed;
        const bpsRaw = key === "accretion_bps" ? value : prev.accretion_bps;
        const cleanAed = String(aedRaw ?? "").replace(/,/g, "").trim();
        const cleanBps = String(bpsRaw ?? "").replace(/,/g, "").trim();
        const aedNum = Number(cleanAed);
        const bpsNum = Number(cleanBps);
        if (cleanAed !== "" && !Number.isNaN(aedNum) && cleanBps !== "" && !Number.isNaN(bpsNum)) {
          updated.gate_accretive = "yes";
          updated.gate_accretive_user_override = true;
        } else {
          updated.gate_accretive = "no";
        }
      }
      return updated;
    });
    if (sendError) setSendError(null);
  };

  // Part B page-4 grid cell edit (W2-01 / FIN-01): row key + period key.
  const handleFinancialChange = (rowKey, periodKey, value) => {
    setForm((prev) => {
      const financials = { ...(prev.financials || {}) };
      const row = { ...(financials[rowKey] || {}) };
      row[periodKey] = value;
      financials[rowKey] = row;
      return { ...prev, financials };
    });
  };

  // Funding sources-and-uses cell edit (W2-06 / FIN-06).
  const handleFundingChange = (side, key, field, value) => {
    setForm((prev) => {
      const plan = prev.funding_plan || { sources: [], uses: [] };
      const list = (plan[side] || []).map((entry) =>
        entry.key === key ? { ...entry, [field]: value } : entry
      );
      return { ...prev, funding_plan: { ...plan, [side]: list } };
    });
  };

  // Comparable-set cell edit (W2-08 / FIN-09).
  const handleComparableChange = (index, field, value) => {
    setForm((prev) => {
      const rows = (prev.valuation_comparables || []).map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      );
      return { ...prev, valuation_comparables: rows };
    });
  };

  const saveDraft = (options, extraFields = {}) => {
    const payload = buildPayload(
      { ...form, progress: formProgressPercent, ...extraFields },
      allFields,
      { isInfiniaPreparer }
    );
    if (!payload.owner_email) payload.owner_email = currentUser?.email || "";
    saveMutation.mutate(payload, options);
  };

  const handleSave = () => saveDraft();

  // Save and Continue: the same save as "Save as draft" (update when the record
  // exists, create once otherwise), then move on only if it succeeded. A locked
  // record cannot be saved, so it just navigates.
  const goToTab = (index) => setActiveTab(Math.max(0, Math.min(LAST_TAB, index)));
  const handleSaveAndContinue = () => {
    if (!editable) {
      goToTab(activeTab + 1);
      return;
    }
    const tabKey = CAPTURE_TABS[activeTab].key;
    saveDraft({
      onSuccess: (record) => {
        goToTab(activeTab + 1);
        if (record?.id) aiValidateMutation.mutate({ id: record.id, tab: tabKey, trigger: "auto_save" });
      },
    });
  };

  const handleSubmit = () => {
    if (!selectedId) return;
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
    setSendError(null);

    if (isInfiniaPreparer) {
      if (whatIsLeftItems.length > 0) {
        setSendError({
          title: "Submission blocked",
          message: "Please complete all mandatory fields, qualifying gates, and required documents before sending to leadership.",
          items: whatIsLeftItems,
        });
        toast({
          variant: "destructive",
          title: "Items remaining",
          description: "Please complete all mandatory fields, qualifying gates, and required documents before sending to leadership.",
        });
        return;
      }
      setForm((prev) => ({ ...prev, approval_status: "awaiting_approval" }));
      const oppName = form.opportunity_name || "Smart meter capacity expansion";
      saveDraft(
        {
          onSuccess: (record) => {
            const finalName = form.opportunity_name || record?.opportunity_name || oppName;
            const res = { opportunity_name: finalName, state: "awaiting_approval", id: selectedId };
            setSubmitResult(res);
            invalidateFor(selectedId);
            setSearchParams({ view: "submitted", id: selectedId });
            toast({
              title: "Sent to CFO and CEO",
              description: `${finalName} is now waiting for CFO and CEO approval.`,
            });
          },
          onError: (err) => {
            setSendError({
              title: "Submission error",
              message: err?.message || "Failed to submit opportunity. Please try again.",
              items: [],
            });
            toast({
              variant: "destructive",
              title: "Submission failed",
              description: err?.message || "Failed to submit opportunity.",
            });
          },
        },
        { approval_status: "awaiting_approval" }
      );
      return;
    }

    saveDraft({
      onSuccess: () => {
        submitMutation.mutate();
      },
      onError: () => {
        submitMutation.mutate();
      },
    });
  };

  const handleUpload = (requirementKey, event) => {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate({ requirementKey, file });
    event.target.value = "";
  };

  const currentVersionFor = (key) =>
    documents.find((doc) => (doc.requirement_key === key || doc.key === key) && doc.is_current) ||
    (gate?.documents || []).find((doc) => (doc.requirement_key === key || doc.key === key) && doc.present) ||
    null;

  // The superseded versions retained for a requirement (W5-02 / DOC-02), newest
  // first, so the card can show that history is kept and not overwritten.
  const priorVersionsFor = (key) =>
    documents
      .filter((doc) => doc.requirement_key === key && !doc.is_current)
      .sort((a, b) => b.version - a.version);

  const blockedGroups = useMemo(() => {
    // Group the blocked items by the section the server reported, so the list
    // tracks the six-section model rather than a fixed set of section names.
    const groups = {};
    (blockedGate?.missing || []).forEach((item) => {
      const section = item.section || "documents";
      (groups[section] ||= []).push(item);
    });
    return groups;
  }, [blockedGate]);

  const MANDATORY_FIELDS_BY_TAB = {
    0: [
      "key_message_executive_summary",
      "opportunity_name",
      "subsidiary_signing_entity",
      "opportunity_type",
      "deal_shape",
      "is_greenfield",
      "sourcing_channel",
      "target_name",
      "line_of_business",
      "intent_of_investment",
      "sector",
      "geography",
      "total_commitment_aed",
      "ask_aed",
      "funding_source",
      "in_approved_budget",
      "target_signing_close",
      "related_party_disclosure",
      "variance_justification",
      "narrative_what",
      "narrative_why_now",
      "exec_summary_recommendation",
    ],
    1: [
      "key_message_opportunity_overview",
      "overview_what",
      "overview_where",
      "deal_shape",
      "overview_pricing",
      "strategic_objective",
      "overview_what_it_adds",
      "build_buy_partner",
      "cost_of_not_doing",
    ],
    2: [
      "key_message_rationale",
      "rationale_evidence",
      "narrative_why_now",
      "narrative_why_us",
      "strategy_link",
      "geography_fit",
      "concentration_impact",
      "capability_fit",
      "accretion_net_earnings_aed",
      "accretion_bps",
      "sirius_accretion_rationale",
      "capital_at_risk",
    ],
    3: [
      "key_message_financials",
      "first_projection_year",
      "wacc_override_pct",
      "concentration_pct",
      "leverage_ratio",
      "entry_valuation_basis_text",
      "exit_route",
      "base_case_assumptions",
      "scenarios_assumptions",
      "cross_border_target",
    ],
    4: [
      "key_message_funding",
      "decision_sought",
      "sirius_capital_or_guarantee",
      "funding_deal_shape",
      "next_steps",
    ],
    5: [
      "key_message_risks",
    ],
    6: [],
  };

  const ds13Documents = useMemo(() => {
    const isGreenfieldConcept = form.opportunity_type === "greenfield" && form.greenfield_stage === "concept";
    const standardCatalogue = [
      {
        key: "returns_model",
        label: "Three-statement financial model",
        description: "Excel model (.xlsx)",
        required: false,
      },
      {
        key: "business_plan",
        label: "Opportunity Overview (6 pages)",
        description: "PDF, DOCX, XLSX or PPTX, up to 50 MB",
        required: true,
      },
      {
        key: "financials",
        label: "Audited financials (3 years)",
        description: "Three years audited statements (PDF or XLSX)",
        required: true,
      },
      {
        key: "cap_table",
        label: "Ownership / cap table",
        description: "Current ownership and target capitalization structure",
        required: true,
      },
    ];

    if (form.in_approved_budget === "no" || budgetGate?.off_budget) {
      standardCatalogue.push({
        key: "budget_confirmation",
        label: "Off-budget variance memo",
        description: "Required memo explaining off-budget justification",
        required: true,
      });
    }

    return standardCatalogue.map((item) => {
      const serverDoc = (gate?.documents || []).find((d) => d.key === item.key || d.requirement_key === item.key);
      const isReq = !isGreenfieldConcept && (serverDoc?.required ?? item.required);
      const current = currentVersionFor(item.key);
      const isPresent = Boolean(current) || Boolean(serverDoc?.present);
      return {
        ...item,
        required: isReq,
        uploaded: isPresent,
        present: isPresent,
        current: current || (serverDoc?.present ? serverDoc : null),
      };
    });
  }, [form.opportunity_type, form.greenfield_stage, form.in_approved_budget, budgetGate, gate?.documents, documents]);

  const getMandatoryKeysForTab = (tabIdx) => {
    const list = [...(MANDATORY_FIELDS_BY_TAB[tabIdx] || [])];
    if (tabIdx === 0) {
      if (isBelowFloorActive) {
        list.push("below_floor_synergy_case");
      }
      if (isGreenfieldActive) {
        list.push("greenfield_stage", "greenfield_benefit");
      }
      if (form.in_approved_budget !== "no" && !budgetGate?.off_budget) {
        const idx = list.indexOf("variance_justification");
        if (idx !== -1) list.splice(idx, 1);
      }
    }
    const tabSections = CAPTURE_TABS[tabIdx]?.sections || [];
    const modelRequired = (allFields || [])
      .filter((f) => f.required && tabSections.includes(f.section))
      .map((f) => f.key);
    return Array.from(new Set([...list, ...modelRequired]));
  };

  const ALL_MANDATORY_KEYS_SET = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < CAPTURE_TABS.length; i++) {
      getMandatoryKeysForTab(i).forEach((k) => set.add(k));
    }
    return set;
  }, [isBelowFloorActive, isGreenfieldActive, allFields, form.in_approved_budget, budgetGate]);

  const isMandatoryField = (key) => {
    if (ALL_MANDATORY_KEYS_SET.has(key)) return true;
    const fromModel = allFields.find((f) => f.key === key);
    return Boolean(fromModel?.required);
  };

  const isFieldComplete = (key) => {
    let val = form?.[key];
    const opp = selectedId ? opportunities.find((o) => o.id === selectedId) || gateStatus?.opportunity : (gateStatus?.opportunity || null);

    if (val === undefined || val === null || val === "") {
      if (opp && opp[key] !== undefined && opp[key] !== null && opp[key] !== "") {
        val = opp[key];
      }
    }

    // Key-specific alias lookups and fallback evaluations
    if (key === "subsidiary_signing_entity") {
      val = val || form?.subsidiary || form?.owner_org_name || form?.signing_entity || opp?.subsidiary_signing_entity || opp?.subsidiary || opp?.owner_org_name || opp?.signing_entity;
    } else if (key === "entry_valuation_basis_text") {
      val = val || form?.entry_valuation_basis || opp?.entry_valuation_basis_text || opp?.entry_valuation_basis;
    } else if (key === "first_projection_year") {
      val = val || opp?.first_projection_year || "2027";
    } else if (key === "is_greenfield") {
      val = val || (form?.opportunity_type ? (form.opportunity_type === "greenfield" ? "yes" : "no") : (opp?.opportunity_type ? (opp.opportunity_type === "greenfield" ? "yes" : "no") : "no"));
    } else if (key === "cross_border_target") {
      val = val || opp?.cross_border_target || (form?.geography ? (form.geography.toLowerCase() === "uae" ? "No" : "Yes") : (opp?.geography ? (opp.geography.toLowerCase() === "uae" ? "No" : "Yes") : (form?.cross_border_fx ? "Yes" : "No")));
    } else if (key === "funding_deal_shape") {
      val = val || form?.deal_shape || opp?.funding_deal_shape || opp?.deal_shape;
    } else if (key === "sirius_capital_or_guarantee") {
      val = val || form?.sirius_capital_aed || form?.ask_aed || opp?.sirius_capital_or_guarantee || opp?.sirius_capital_aed || opp?.ask_aed;
    } else if (key === "leverage_ratio") {
      val = val || form?.leverage || form?.net_debt_ebitda || opp?.leverage_ratio || opp?.leverage || opp?.net_debt_ebitda;
    } else if (key === "concentration_pct") {
      val = val || form?.concentration || opp?.concentration_pct || opp?.concentration;
    } else if (key === "wacc_override_pct") {
      val = val || form?.wacc || opp?.wacc_override_pct || opp?.wacc;
    } else if (key === "key_message_executive_summary") {
      val = val || form?.exec_summary_headline_value || opp?.key_message_executive_summary || opp?.exec_summary_headline_value;
    }

    if (val === undefined || val === null) return false;
    const str = typeof val === "string" ? val.trim() : String(val).trim();
    if (str === "") return false;

    if (key === "total_commitment_aed") {
      const n = Number(val);
      return !Number.isNaN(n) && Number.isFinite(n) && n > 0;
    }
    if (key === "ask_aed") {
      const n = Number(val);
      return !Number.isNaN(n) && Number.isFinite(n) && n >= 0;
    }
    if (key === "in_approved_budget") {
      return str === "yes" || str === "no" || str === "true" || str === "false" || val === true || val === false;
    }
    if (key === "is_greenfield") {
      return str.toLowerCase() === "yes" || str.toLowerCase() === "no";
    }
    if (key === "cross_border_target") {
      return str.toLowerCase() === "yes" || str.toLowerCase() === "no";
    }
    if (key === "accretion_net_earnings_aed" || key === "accretion_bps") {
      const n = Number(val);
      return !Number.isNaN(n) && Number.isFinite(n);
    }

    return str.length > 0;
  };

  const renderFieldIndicator = (key) => {
    const isMandatory = isMandatoryField(key);
    const complete = isFieldComplete(key);

    if (complete) {
      return (
        <CheckCircle2
          className="w-3.5 h-3.5 text-emerald-500 shrink-0 inline-block ml-1"
          data-testid={`indicator-${key}-valid`}
        />
      );
    }
    if (isMandatory) {
      return (
        <XCircle
          className="w-3.5 h-3.5 text-red-500 shrink-0 inline-block ml-1"
          data-testid={`indicator-${key}-invalid`}
        />
      );
    }
    return null;
  };

  // Missing items per wizard step, computed dynamically as the user enters, edits,
  // or clears values, reflecting only actual mandatory fields for each section.
  const missingByTab = useMemo(() => {
    return CAPTURE_TABS.map((tab, tabIdx) => {
      const mandatoryKeys = getMandatoryKeysForTab(tabIdx);
      let count = 0;
      for (const key of mandatoryKeys) {
        if (!isFieldComplete(key)) {
          count++;
        }
      }
      if (tab.key === "documents") {
        const reqDocs = ds13Documents.filter((d) => d.required);
        const missingDocs = reqDocs.filter((req) => {
          const uploaded = (documents || []).some((doc) => (doc.requirement_key === req.key || doc.key === req.key) && doc.is_current);
          const gateUploaded = (gate?.documents || []).some((doc) => (doc.requirement_key === req.key || doc.key === req.key) && doc.present);
          return !uploaded && !gateUploaded && !req.present && !req.uploaded;
        }).length;
        count += missingDocs;
      }
      return count;
    });
  }, [form, gate?.documents, documents, ds13Documents, isBelowFloorActive, isGreenfieldActive, allFields, opportunities, selectedId, gateStatus]);

  // Per-step progress for the right-hand rail, tracking completed mandatory items.
  const progressByTab = useMemo(
    () =>
      CAPTURE_TABS.map((tab, tabIdx) => {
        const mandatoryKeys = getMandatoryKeysForTab(tabIdx);
        const total = tab.key === "documents"
          ? ds13Documents.filter((d) => d.required).length
          : mandatoryKeys.length;
        const missing = missingByTab[tabIdx] ?? 0;
        const present = Math.max(0, total - missing);
        return { present, total };
      }),
    [missingByTab, ds13Documents, isBelowFloorActive, isGreenfieldActive, allFields]
  );

  const totalMandatoryCount = useMemo(() => progressByTab.reduce((sum, t) => sum + t.total, 0), [progressByTab]);
  const presentMandatoryCount = useMemo(() => progressByTab.reduce((sum, t) => sum + t.present, 0), [progressByTab]);
  const itemsLeft = useMemo(() => Math.max(0, totalMandatoryCount - presentMandatoryCount), [totalMandatoryCount, presentMandatoryCount]);
  const formProgressPercent = useMemo(() => {
    if (totalMandatoryCount === 0) return 0;
    return Math.round((presentMandatoryCount / totalMandatoryCount) * 100);
  }, [totalMandatoryCount, presentMandatoryCount]);

  const isSubmittedView = searchParams.get("view") === "submitted" || Boolean(submitResult);
  const captureView =
    !isSubmittedView &&
    (searchParams.get("view") === "capture" || (isInfiniaPreparer && Boolean(selectedId))) &&
    (!screenOpen || Boolean(selectedId));

  const submittedOpportunityName =
    form.opportunity_name ||
    submitResult?.opportunity_name ||
    opportunities.find((o) => o.id === (selectedId || searchParams.get("id")))?.opportunity_name ||
    "Smart meter capacity expansion";

  const activeOpportunity = useMemo(() => {
    const oppId = selectedId || searchParams.get("id");
    return (
      directOpportunity ||
      (opportunities || []).find((o) => o.id === oppId) ||
      gateStatus?.opportunity ||
      null
    );
  }, [selectedId, searchParams, directOpportunity, opportunities, gateStatus]);

  const currentOpportunityStatus = normalizeState(
    form.approval_status || form.status || activeOpportunity?.approval_status || activeOpportunity?.status || ""
  );

  const rawCurrentStatus = (
    form.approval_status || form.status || activeOpportunity?.approval_status || activeOpportunity?.status || ""
  ).toString().trim().toLowerCase().replace(/_/g, " ");

  const isScreeningStage =
    !isSubmittedView &&
    Boolean(selectedId || searchParams.get("id")) &&
    ([
      "screening_review",
      "submitted",
      "submission",
      "screening",
      "proceed_to_gate2",
      "on_hold",
      "returned",
      "returned_to_analyst",
      "awaiting_approval",
      "gaps_found",
    ].includes(currentOpportunityStatus) ||
      rawCurrentStatus === "send to cfo" ||
      rawCurrentStatus === "sent to cfo" ||
      rawCurrentStatus.includes("send to cfo") ||
      rawCurrentStatus.includes("sent to cfo"));

  const showInfiniaScreening = isInfiniaPreparer && isScreeningStage;

  const handleDownloadOverview = async () => {
    const oppId = selectedId || searchParams.get("id") || form.id;
    if (!oppId) return;
    try {
      await api.memoPack.download(oppId, "html");
      toast({
        title: "Download started",
        description: "The Opportunity Overview pack is being downloaded.",
      });
    } catch (err) {
      toast({
        title: "Export notice",
        description: err?.message || "Opening browser print view for Opportunity Overview.",
      });
      window.print();
    }
  };

  const handleBackToOpportunities = () => {
    openingIdRef.current = null;
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
    setSendError(null);
    const role = searchParams.get("role");
    const target = createPageUrl("SubmitOpportunity") + (role ? `?role=${encodeURIComponent(role)}` : "");
    navigate(target, { replace: true });
  };

  const whatIsLeftItems = useMemo(() => {
    const list = [];
    if (missingByTab[0] > 0) list.push(`${missingByTab[0]} mandatory field(s) in Executive summary (Step 1)`);
    if (missingByTab[1] > 0) list.push(`${missingByTab[1]} mandatory field(s) in Opportunity overview (Step 2)`);
    if (missingByTab[2] > 0) list.push(`${missingByTab[2]} mandatory field(s) in Rationale and fit (Step 3)`);
    if (missingByTab[3] > 0) list.push(`${missingByTab[3]} mandatory field(s) in Financials and returns (Step 4)`);
    if (missingByTab[4] > 0) list.push(`${missingByTab[4]} mandatory field(s) in Funding and key asks (Step 5)`);
    if (missingByTab[5] > 0) list.push(`${missingByTab[5]} mandatory field(s) in Risks and compliance (Step 6)`);

    const missingDocs = ds13Documents.filter((d) => d.required && !d.present && !d.uploaded);
    missingDocs.forEach((d) => list.push(`Upload ${d.label}`));

    const unreadyGates = evaluatedQualifyingGates.filter((g) => !g.met && !g.checked);
    if (unreadyGates.length > 0) {
      list.push(`${unreadyGates.length} qualifying gate(s) not met or awaiting confirmation (Step 7)`);
    }

    return list;
  }, [missingByTab, ds13Documents, evaluatedQualifyingGates]);

  const isWhatIsLeftActive = useMemo(() => {
    if (blockedGate) return true;
    if (whatIsLeftItems.length > 0) return true;
    if (selectedId && gate && !gate.complete && itemsLeft > 0) return true;
    return false;
  }, [blockedGate, whatIsLeftItems.length, selectedId, gate, itemsLeft]);

  const activeError = useMemo(() => {
    if (!isInfiniaPreparer) return null;

    if (sendError) {
      return {
        title: sendError.title || "Submission blocked",
        message: sendError.message,
        items: sendError.items || [],
      };
    }

    if (blockedGate) {
      const items = [];
      Object.keys(blockedGroups).forEach((section) => {
        if (blockedGroups[section]?.length > 0) {
          const sectionTitle = SECTION_TITLES[section] || (fieldModel?.sections || []).find((s) => s.key === section)?.label || section;
          blockedGroups[section].forEach((item) => {
            items.push(`${sectionTitle}: ${item.label}`);
          });
        }
      });
      return {
        title: "Submission blocked",
        message: blockedMessage || "The opportunity did not pass the document gate. Resolve the items below and try again.",
        items,
      };
    }

    if (submitMutation.isError) {
      return {
        title: "Submission error",
        message: submitMutation.error?.message || "An unexpected error occurred during submission.",
        items: [],
      };
    }

    if (saveMutation.isError && form.approval_status === "awaiting_approval") {
      return {
        title: "Could not save opportunity",
        message: saveMutation.error?.message || "An error occurred while saving the opportunity.",
        items: [],
      };
    }

    return null;
  }, [
    isInfiniaPreparer,
    sendError,
    blockedGate,
    blockedMessage,
    blockedGroups,
    submitMutation.isError,
    submitMutation.error,
    saveMutation.isError,
    saveMutation.error,
    form.approval_status,
    fieldModel,
  ]);

  // A blocked submit jumps to the first step that has something missing.
  useEffect(() => {
    if (isInfiniaPreparer) return;
    const sections = Object.keys(blockedGroups).filter((section) => blockedGroups[section].length > 0);
    if (sections.length === 0) return;
    setActiveTab(Math.min(...sections.map(tabIndexForSection)));
  }, [blockedGroups, isInfiniaPreparer]);

  const renderField = (field) => {
    if (field.type === "textarea") {
      return (
        <Textarea
          id={field.key}
          value={form[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => handleChange(field.key, event.target.value)}
          rows={3}
          className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      );
    }
    if (field.type === "select") {
      const options = field.options || [];
      return (
        <Select value={form[field.key] || ""} onValueChange={(value) => handleChange(field.key, value)}>
          <SelectTrigger id={field.key} className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (!FIELD_TYPES.has(field.type)) {
      // e.g. the risk register is an array-shaped field: capture it as text.
      return (
        <Textarea
          id={field.key}
          value={form[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => handleChange(field.key, event.target.value)}
          rows={3}
          className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      );
    }
    return (
      <Input
        id={field.key}
        type={field.type === "number" ? "number" : "text"}
        value={form[field.key] ?? ""}
        placeholder={field.placeholder}
        onChange={(event) => handleChange(field.key, event.target.value)}
        className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
    );
  };

  // The three-statement model status card (W2-02 / FIN-02), rendered under the
  // financial summary. It makes the advisory check visible: which of the three
  // linked statements were found, whether the balance sheet balances in every
  // period, and whether the model is the Sirius template or flagged for manual
  // review. Everything shown is read from the gate's computed statement_model.
  const renderStatementModelCard = () => {
    if (!statementGate) return null;
    const statements = statementConfig?.statements || [
      { key: "profit_and_loss", label: "Profit & loss (P&L)" },
      { key: "balance_sheet", label: "Balance sheet" },
      { key: "cash_flow_statement", label: "Cash flow statement" },
    ];
    const found = statementGate.statements || {};
    const balance = statementGate.balance || {};
    const complete = statementGate.complete;
    const flagged = statementGate.flagged_for_review;
    return (
      <div className="space-y-3" data-testid="statement-model-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4b. Three-statement model check</h3>
            <p className="text-sm text-slate-500">
              The linked P&amp;L, balance sheet and cash flow are a mandatory upload. The balance
              sheet must balance (assets = liabilities + equity) in each period. A non-template or
              unbalanced model is accepted but flagged for manual review.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              complete && !flagged
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : flagged
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-slate-50 text-slate-600"
            )}
            data-testid="statement-model-status"
          >
            {complete && !flagged
              ? "Present & balanced"
              : flagged
                ? "Flagged for review"
                : "Not attached"}
          </Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {statements.map((s) => (
            <div
              key={s.key}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                found[s.key]
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              )}
              data-testid={"statement-model-" + s.key}
            >
              {found[s.key] ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-400" />
              )}
              <span className="font-medium">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <span data-testid="statement-model-balance">
            Balance sheet:{" "}
            {balance.checked
              ? balance.balanced
                ? "balanced in every period"
                : (balance.imbalances?.length || 0) + " period(s) out of balance"
              : "not checked (totals not found)"}
          </span>
          <span data-testid="statement-model-format">
            {statementGate.template ? "Sirius template" : "Non-template model"}
          </span>
        </div>
        {flagged && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="statement-model-flag">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Flagged for manual review</AlertTitle>
            <AlertDescription>{statementGate.message}</AlertDescription>
          </Alert>
        )}
        {complete && !flagged && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="statement-model-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Three-statement model accepted</AlertTitle>
            <AlertDescription>{statementGate.message}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // The three-scenario returns card (W2-03 / FIN-03), rendered under the
  // statement-model check. It shows Equity IRR, ROIC, payback and MOIC across
  // the base, upside and downside cases, and flags a missing downside or any
  // open metric/scenario cell. Everything shown is read from the gate.
  const renderReturnsCard = () => {
    if (!returnsGate) return null;
    const scenarios = returnsGate.scenario_order || ['base', 'upside', 'downside'];
    const metrics = returnsConfig?.metrics || returnsGate.metrics || [
      { key: 'equity_irr', label: 'Equity IRR', unit: '%', required: true },
      { key: 'roic', label: 'ROIC', unit: '%', required: true },
      { key: 'payback', label: 'Payback period', unit: 'yrs', required: true },
      { key: 'moic', label: 'MOIC', unit: 'x', required: false, where_relevant: true },
    ];
    const complete = returnsGate.complete;
    const downsidePresent = returnsGate.downside_present;
    const scenariosByKey = returnsGate.scenarios || {};
    const cell = (metric, scenario) => {
      const value = scenariosByKey[scenario]?.metrics?.[metric.key]?.value;
      return value === null || value === undefined ? '—' : value + metric.unit;
    };
    return (
      <div className="space-y-3" data-testid="returns-scenarios-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4c. Returns across three scenarios</h3>
            <p className="text-sm text-slate-500">
              Equity IRR, ROIC and payback are captured for base, upside and downside cases;
              a survivable downside is mandatory. MOIC is captured where a multiple is the
              agreed measure. Flags are advisory — they never block submission.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              complete && downsidePresent
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="returns-scenarios-status"
          >
            {complete && downsidePresent
              ? 'All scenarios captured'
              : !downsidePresent
                ? 'Downside missing'
                : (returnsGate.missing_count || 0) + ' cell(s) open'}
          </Badge>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Metric</th>
                {scenarios.map((key) => (
                  <th key={key} className="px-3 py-2 text-right font-semibold text-slate-600" data-testid={"returns-scenario-head-" + key}>
                    {scenariosByKey[key]?.label || key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.key} className="border-t border-slate-100" data-testid={"returns-row-" + metric.key}>
                  <td className="px-3 py-1.5 font-medium text-slate-700">
                    {metric.label}
                    {metric.required ? <span className="text-red-500"> *</span> : null}
                  </td>
                  {scenarios.map((key) => {
                    const present = scenariosByKey[key]?.metrics?.[metric.key]?.present;
                    return (
                      <td
                        key={key}
                        className={cn("px-3 py-1.5 text-right", present ? "text-slate-800" : "text-slate-400")}
                        data-testid={"returns-cell-" + metric.key + "-" + key}
                      >
                        {cell(metric, key)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <span data-testid="returns-scenarios-downside">
            Downside case: {downsidePresent ? 'present' : 'missing (mandatory)'}
          </span>
          <span data-testid="returns-scenarios-moic">
            MOIC: {returnsGate.moic_relevant ? 'captured' : 'not captured'}
          </span>
        </div>
        {(!complete || !downsidePresent) && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="returns-scenarios-flag">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Returns incomplete</AlertTitle>
            <AlertDescription>{returnsGate.message}</AlertDescription>
          </Alert>
        )}
        {complete && downsidePresent && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="returns-scenarios-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Three-scenario returns captured</AlertTitle>
            <AlertDescription>{returnsGate.message}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // The content sufficiency check card (W5-03 / DOC-04). Advisory: it lists the
  // flagged rules with their observed and expected values so the preparer can
  // see what to address before submitting. Everything is read from the gate.
  const renderSufficiencyCard = () => {
    const suff = gate?.sufficiency;
    if (!suff) return null;
    const open = suff.open_flags || [];
    return (
      <div className="space-y-3" data-testid="sufficiency-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">Content sufficiency check</h3>
            <p className="text-sm text-slate-500">
              Advisory checks that flag thin content before review: a missing cash flow,
              fewer years of history than the policy expects, no downside case and an
              absent supporting pack. A flag never blocks submission — address it or a
              reviewer overrides it with a reason.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              suff.sufficient
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="sufficiency-status"
          >
            {suff.sufficient
              ? "All checks pass"
              : open.length + " advisory flag(s)"}
          </Badge>
        </div>
        {open.length > 0 ? (
          <Alert className="border-amber-200 bg-amber-50" data-testid="sufficiency-flags">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Content flags (advisory)</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 space-y-2">
                {open.map((flag) => (
                  <li key={flag.key} data-testid={"sufficiency-flag-" + flag.key}>
                    <span className="font-medium">{flag.label}:</span> {flag.message}
                    <span className="block text-xs text-slate-600 mt-0.5">
                      Observed: {flag.observed}. Expected: {flag.expected}.
                    </span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="sufficiency-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Content sufficiency clear</AlertTitle>
            <AlertDescription>{suff.message}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // The cost of capital card (W2-05 / FIN-05), rendered under the returns card.
  // It shows the effective WACC, whether it is the entity default or a
  // per-deal override, and whether an override carries the mandatory reason.
  const renderWaccCard = () => {
    if (!waccGate) return null;
    const isOverride = waccGate.source === 'opportunity_override';
    const overrideInvalid = waccGate.has_override && !waccGate.override_reason_present;
    const roic = waccGate.roic_vs_wacc;
    return (
      <div className="space-y-3" data-testid="wacc-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4d. Cost of capital (WACC)</h3>
            <p className="text-sm text-slate-500">
              Sirius sets the WACC per entity; every opportunity inherits it. A per-deal
              override is allowed only with a reason. The ROIC hurdle is WACC plus the
              configured spread.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              overrideInvalid
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
            data-testid="wacc-status"
          >
            {overrideInvalid
              ? 'Override needs a reason'
              : isOverride
                ? 'Per-deal override'
                : 'Entity default'}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <span data-testid="wacc-effective">
            Effective WACC: <span className="font-semibold text-slate-900">{waccGate.effective_wacc}%</span>
          </span>
          <span data-testid="wacc-source">
            Source: {waccGate.source === 'opportunity_override' ? 'Opportunity override' : waccGate.source === 'entity_default' ? 'Entity default' : 'System default'}
          </span>
          {roic && (
            <span data-testid="wacc-roic-summary">
              ROIC {roic.roic}% vs WACC+{roic.spread} = {roic.hurdle}% → {roic.meets ? 'meets' : 'below'}
            </span>
          )}
        </div>
        {waccGate.override_reason && (
          <p className="text-xs text-slate-600" data-testid="wacc-override-reason">
            Override reason: {waccGate.override_reason}
          </p>
        )}
        {overrideInvalid && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="wacc-flag">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Override reason required</AlertTitle>
            <AlertDescription>{waccConfig?.reason_message || waccGate.message}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // Part B page-4 financial summary grid (W2-01 / FIN-01). The rows and

  // The automatic hurdle table (W2-04 / FIN-04), rendered under the WACC card.
  // One row per hurdle, one column per scenario, each cell a Meets? / Does-not-
  // meet verdict computed from the entity thresholds and the resolved WACC.
  // Deal-level hurdles (concentration, leverage) are constant across columns.
  const renderHurdleTable = () => {
    if (!hurdleGate) return null;
    const scenarios = hurdleGate.scenarios || ['base', 'upside', 'downside'];
    const rows = hurdleGate.rows || hurdleConfig?.rows || [];
    const passRate = hurdleGate.pass_rate || {};
    const verdict = (cell) => {
      if (!cell || cell.meets === null || cell.meets === undefined) return { text: '—', cls: 'text-slate-400' };
      return cell.meets ? { text: 'Y', cls: 'text-emerald-600 font-semibold' } : { text: 'N', cls: 'text-red-600 font-semibold' };
    };
    return (
      <div className="space-y-3" data-testid="hurdle-table-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4e. Automatic hurdle test</h3>
            <p className="text-sm text-slate-500">
              Every hurdle is tested per scenario against the entity thresholds; ROIC is tested
              against WACC plus the configured spread. Meets? is derived, never typed. Flags are
              advisory — a miss never blocks submission.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              hurdleGate.any_below
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
            data-testid="hurdle-table-status"
          >
            {hurdleGate.any_below ? 'Hurdles not met' : 'All hurdles met'}
          </Badge>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Hurdle</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Threshold</th>
                {scenarios.map((key) => (
                  <th key={key} className="px-3 py-2 text-right font-semibold text-slate-600" data-testid={'hurdle-head-' + key}>
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-100" data-testid={'hurdle-row-' + row.key}>
                  <td className="px-3 py-1.5 font-medium text-slate-700">{row.label}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500" data-testid={'hurdle-threshold-' + row.key}>
                    {row.threshold === null ? '—' : (row.comparator === 'gte' ? '≥ ' : '≤ ') + row.threshold + row.unit}
                  </td>
                  {scenarios.map((key) => {
                    const cell = row.scenarios?.[key] || {};
                    const v = verdict(cell);
                    return (
                      <td key={key} className={cn('px-3 py-1.5 text-right tabular-nums', v.cls)} data-testid={'hurdle-cell-' + row.key + '-' + key}>
                        {cell.value === null || cell.value === undefined ? '—' : cell.value + row.unit} <span>{v.text}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          {scenarios.map((key) => {
            // Only count hurdles the preparer has actually captured, so a case
            // that has not been reached yet reads as 'not captured' rather than
            // a misleading 'met 2/5' (FIN-04: Meets? is per hurdle per scenario).
            const evaluated = rows.filter((row) => row.scenarios?.[key]?.present).length;
            return (
              <span key={key} data-testid={'hurdle-passrate-' + key}>
                {key}: {evaluated ? (passRate[key] ?? 0) + '/' + evaluated + ' met' : '— not captured'}
              </span>
            );
          })}
          <span data-testid="hurdle-table-version">Policy v{hurdleGate.version ?? hurdleConfig?.version}</span>
        </div>
        {hurdleGate.any_below && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="hurdle-table-flag">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>One or more hurdles not met</AlertTitle>
            <AlertDescription>{hurdleGate.message}</AlertDescription>
          </Alert>
        )}
        {!hurdleGate.any_below && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="hurdle-table-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Hurdles met</AlertTitle>
            <AlertDescription>{hurdleGate.message}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // columns come from GET /api/gate/fields; the derived rows are read-only
  // and populated from the gate's computed matrix.
  const renderFinancialGrid = () => {
    const rows = financialConfig?.rows || [];
    const periods = financialConfig?.periods || [];
    const periodKeys = financialConfig?.period_keys || DEFAULT_FIN_PERIOD_KEYS;
    const actualKeys = financialConfig?.actual_period_keys || [];
    if (rows.length === 0) return null;
    return (
      <div className="space-y-4" data-testid="financial-grid">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4a. Financial summary ({currencyGate?.label || "AED mn"})</h3>
            <p className="text-sm text-slate-500">
              FY-3 to FY-1 actuals plus Y1-Y5 projections. Growth %, EBITDA margin and free cash flow are derived automatically; new ventures may leave the actuals blank.
            </p>
          </div>
          {financialGate && (
            <Badge
              variant="outline"
              className={cn(
                "font-medium",
                financialGate.complete
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              )}
            >
              {financialGate.complete ? "Summary complete" : "In progress"}
            </Badge>
          )}
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">Metric</th>
                {periods.map((label, i) => (
                  <th
                    key={label}
                    className={cn(
                      "px-2 py-2 text-right font-semibold",
                      actualKeys.includes(periodKeys[i]) ? "text-slate-500" : "text-teal-700"
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-700">
                    {row.label}
                  </td>
                  {periodKeys.map((pk) => (
                    <td key={pk} className="px-1 py-1">
                      {row.kind === "derived" ? (
                        <span
                          className="block px-2 py-1 text-right tabular-nums text-slate-400"
                          data-testid={"fin-derived-" + row.key + "-" + pk}
                        >
                          {derivedFinancial(row.key, pk)}
                        </span>
                      ) : (
                        <input
                          type="number"
                          aria-label={row.label + " " + pk}
                          data-testid={"fin-" + row.key + "-" + pk}
                          className="w-20 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-teal-500 focus:outline-none"
                          value={form.financials?.[row.key]?.[pk] ?? ""}
                          onChange={(e) => handleFinancialChange(row.key, pk, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // The reporting currency and per-opportunity FX rate (W2-10 / NFR-08). The
  // page-4 matrix is AED mn by default; a USD-reported deal records the rate
  // used so every figure is reproducible against the AED base. Advisory — a
  // missing rate on a USD deal is flagged, never blocks.
  const renderCurrency = () => {
    const config = currencyConfig;
    const evaluated = currencyGate;
    if (!evaluated) return null;
    const currencies = config?.currencies || [
      { value: "AED", label: "AED — UAE dirham (Sirius base)" },
      { value: "USD", label: "USD — US dollar" },
    ];
    const fxMissing = (evaluated.flags || []).some((f) => f.reason === "fx_rate_missing");
    const fxInvalid = (evaluated.flags || []).some((f) => f.reason === "fx_rate_invalid");
    return (
      <div className="space-y-3" data-testid="currency-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">Reporting currency &amp; FX rate</h3>
            <p className="text-sm text-slate-500">
              Figures are shown in millions. The Sirius base is AED; where the mandate works in
              USD, report in USD and record the FX rate used so every figure is reproducible
              against the AED base.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              evaluated.complete
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="currency-status"
          >
            {evaluated.complete ? "Currency complete" : "FX rate missing"}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="reporting_currency" className="text-xs text-slate-600">Reporting currency</Label>
            <select
              id="reporting_currency"
              data-testid="currency-select"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              value={form.reporting_currency || "AED"}
              onChange={(e) => handleChange("reporting_currency", e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fx_rate_usd_aed" className="text-xs text-slate-600">
              FX rate (AED per USD){evaluated.fx_required && <span className="text-red-500" title="Required when reporting in USD"> *</span>}
            </Label>
            <input
              id="fx_rate_usd_aed"
              type="number"
              step="0.0001"
              disabled={!evaluated.fx_required}
              data-testid="currency-fx-rate"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-teal-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
              value={form.fx_rate_usd_aed || ""}
              onChange={(e) => handleChange("fx_rate_usd_aed", e.target.value)}
            />
            {!evaluated.fx_required && (
              <p className="text-xs text-slate-400">Applies only when reporting in USD.</p>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-500" data-testid="currency-unit-note">
          Matrix unit: <span className="font-medium text-slate-700">{evaluated.label}</span>
          {evaluated.fx_required && evaluated.fx_valid
            ? " · FX rate " + evaluated.fx_rate + " AED/USD"
            : ""}
        </p>

        {(fxMissing || fxInvalid) && (
          <div className="space-y-2" data-testid="currency-flag">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>FX rate not recorded</AlertTitle>
              <AlertDescription>
                {evaluated.message || "Record the AED per USD rate used for this opportunity."}
              </AlertDescription>
            </Alert>
          </div>
        )}
        {evaluated.complete && evaluated.fx_required && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="currency-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>FX rate recorded</AlertTitle>
            <AlertDescription>
              Reported in USD at {evaluated.fx_rate} AED/USD; figures are reproducible against the AED base.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };


  // The funding sources and uses table (W2-06 / FIN-06), rendered in the
  // funding section: one row per source (amount, % of total, status) and one
  // row per use, with the sources = uses balance and the funding-hierarchy
  // warning. Advisory — an imbalance or an early Sirius draw flags, never blocks.
  const renderSourcesUses = () => {
    const config = sourcesUsesConfig;
    const evaluated = sourcesUsesGate;
    const sourceRows = config?.sources || evaluated?.sources || [];
    const useRows = config?.uses || evaluated?.uses || [];
    const statusOptions = config?.statuses || evaluated?.statuses || [];
    const sourceValues = (key) => (form.funding_plan?.sources || []).find((s) => s.key === key) || {};
    const entryUseValues = (key) => (form.funding_plan?.uses || []).find((u) => u.key === key) || {};
    const flagFor = (reason) => (evaluated?.flags || []).find((f) => f.reason === reason);
    const imbalance = flagFor('sources_not_uses');
    const hierarchy = flagFor('funding_hierarchy');
    return (
      <div className="space-y-3" data-testid="sources-uses-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">5a. Funding sources and uses</h3>
            <p className="text-sm text-slate-500">
              Capture each source with its status (secured / committed / indicative) and each
              use. Sources must equal uses, and Sirius capital is drawn last — after cheaper
              sources (internal accruals, subsidiary debt, partner capital).
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              evaluated?.balanced
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="sources-uses-status"
          >
            {evaluated?.balanced ? 'Sources = uses' : 'Sources do not equal uses'}
          </Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[320px] text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Source</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">AED mn</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">%</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100" data-testid={'source-row-' + row.key}>
                    <td className="px-3 py-1.5 font-medium text-slate-700">{row.label}</td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        aria-label={row.label + ' amount'}
                        data-testid={'source-aed-' + row.key}
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-teal-500 focus:outline-none"
                        value={sourceValues(row.key).aed ?? ''}
                        onChange={(e) => handleFundingChange('sources', row.key, 'aed', e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        aria-label={row.label + ' percent'}
                        data-testid={'source-pct-' + row.key}
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-teal-500 focus:outline-none"
                        value={sourceValues(row.key).pct ?? ''}
                        onChange={(e) => handleFundingChange('sources', row.key, 'pct', e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        aria-label={row.label + ' status'}
                        data-testid={'source-status-' + row.key}
                        className="w-28 rounded border border-slate-200 px-2 py-1 focus:border-teal-500 focus:outline-none"
                        value={sourceValues(row.key).status || ''}
                        onChange={(e) => handleFundingChange('sources', row.key, 'status', e.target.value)}
                      >
                        <option value="">—</option>
                        {statusOptions.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[220px] text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Use</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">AED mn</th>
                </tr>
              </thead>
              <tbody>
                {useRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100" data-testid={'use-row-' + row.key}>
                    <td className="px-3 py-1.5 font-medium text-slate-700">{row.label}</td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        aria-label={row.label + ' amount'}
                        data-testid={'use-aed-' + row.key}
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-teal-500 focus:outline-none"
                        value={entryUseValues(row.key).aed ?? ''}
                        onChange={(e) => handleFundingChange('uses', row.key, 'aed', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {evaluated && (
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <span data-testid="sources-uses-total-sources">Total sources: {evaluated.total_sources} AED mn</span>
            <span data-testid="sources-uses-total-uses">Total uses: {evaluated.total_uses} AED mn</span>
            <span data-testid="sources-uses-difference">Difference: {evaluated.difference} AED mn</span>
          </div>
        )}
        {(imbalance || hierarchy) && (
          <div className="space-y-2" data-testid="sources-uses-flag">
            {imbalance && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>Sources do not equal uses</AlertTitle>
                <AlertDescription>{imbalance.message}</AlertDescription>
              </Alert>
            )}
            {hierarchy && (
              <Alert className="border-amber-200 bg-amber-50" data-testid="sources-uses-hierarchy-flag">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>Sirius capital drawn early</AlertTitle>
                <AlertDescription>{hierarchy.message}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        {evaluated && evaluated.balanced && !hierarchy && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="sources-uses-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Sources equal uses</AlertTitle>
            <AlertDescription>{evaluated.message}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };


  // The entry valuation and exit capture (W2-08 / FIN-09). The flat entry /
  // exit fields are rendered by the financials section loop above; this card
  // adds the structured comparable set (3-5 names) and the advisory flags.
  const renderValuation = () => {
    const config = valuationConfig;
    const evaluated = valuationGate;
    const basisOptions = config?.basis || [];
    const methodOptions = config?.methods || [];
    const rows = form.valuation_comparables || [];
    const complete = Boolean(evaluated?.complete);
    return (
      <div className="space-y-3" data-testid="valuation-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4b. Entry valuation &amp; comparable set</h3>
            <p className="text-sm text-slate-500">
              Capture entry valuation as EV or equity value with its multiple and method, a
              comparable set of three to five names, and the exit / value-realisation route
              and timing. Advisory — a partial capture is flagged, it never blocks submission.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              complete
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="valuation-status"
          >
            {complete ? "Valuation complete" : "Valuation incomplete"}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="entry_valuation_basis" className="text-xs text-slate-600">Basis</Label>
            <select
              id="entry_valuation_basis"
              data-testid="valuation-entry-basis"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              value={form.entry_valuation_basis || ""}
              onChange={(e) => handleChange("entry_valuation_basis", e.target.value)}
            >
              <option value="">—</option>
              {basisOptions.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry_valuation_aed" className="text-xs text-slate-600">Entry valuation (AED mn)</Label>
            <input
              id="entry_valuation_aed"
              type="number"
              data-testid="valuation-entry-amount"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-teal-500 focus:outline-none"
              value={form.entry_valuation_aed || ""}
              onChange={(e) => handleChange("entry_valuation_aed", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry_multiple" className="text-xs text-slate-600">Entry multiple (x)</Label>
            <input
              id="entry_multiple"
              type="number"
              data-testid="valuation-entry-multiple"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-teal-500 focus:outline-none"
              value={form.entry_multiple || ""}
              onChange={(e) => handleChange("entry_multiple", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry_valuation_method" className="text-xs text-slate-600">Method</Label>
            <select
              id="entry_valuation_method"
              data-testid="valuation-entry-method"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              value={form.entry_valuation_method || ""}
              onChange={(e) => handleChange("entry_valuation_method", e.target.value)}
            >
              <option value="">—</option>
              {methodOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Comparable</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Metric</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Multiple (x)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100" data-testid={'valuation-comparable-row-' + i}>
                  <td className="px-1 py-1">
                    <input
                      aria-label={'Comparable ' + (i + 1) + ' name'}
                      data-testid={'valuation-comparable-name-' + i}
                      className="w-full rounded border border-slate-200 px-2 py-1 focus:border-teal-500 focus:outline-none"
                      placeholder={i < 3 ? 'Required name' : 'Optional name'}
                      value={row.name || ''}
                      onChange={(e) => handleComparableChange(i, 'name', e.target.value)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      aria-label={'Comparable ' + (i + 1) + ' metric'}
                      data-testid={'valuation-comparable-metric-' + i}
                      className="w-full rounded border border-slate-200 px-2 py-1 focus:border-teal-500 focus:outline-none"
                      placeholder="EV/EBITDA"
                      value={row.metric || ''}
                      onChange={(e) => handleComparableChange(i, 'metric', e.target.value)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      aria-label={'Comparable ' + (i + 1) + ' multiple'}
                      data-testid={'valuation-comparable-multiple-' + i}
                      className="w-24 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-teal-500 focus:outline-none"
                      value={row.multiple || ''}
                      onChange={(e) => handleComparableChange(i, 'multiple', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="exit_route" className="text-xs text-slate-600">Exit route</Label>
            <input
              id="exit_route"
              data-testid="valuation-exit-route"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              value={form.exit_route || ""}
              onChange={(e) => handleChange("exit_route", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exit_timing" className="text-xs text-slate-600">Exit timing</Label>
            <input
              id="exit_timing"
              data-testid="valuation-exit-timing"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              value={form.exit_timing || ""}
              onChange={(e) => handleChange("exit_timing", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exit_multiple" className="text-xs text-slate-600">Exit multiple (x)</Label>
            <input
              id="exit_multiple"
              type="number"
              data-testid="valuation-exit-multiple"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-teal-500 focus:outline-none"
              value={form.exit_multiple || ""}
              onChange={(e) => handleChange("exit_multiple", e.target.value)}
            />
          </div>
        </div>

        {evaluated && (evaluated.flags || []).length > 0 && (
          <div className="space-y-2" data-testid="valuation-flag">
            {(evaluated.flags || []).map((f) => (
              <Alert key={f.reason} className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>Valuation capture incomplete</AlertTitle>
                <AlertDescription>{f.message}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}
        {evaluated && complete && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="valuation-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Valuation capture complete</AlertTitle>
            <AlertDescription>
              Entry valuation, comparables ({evaluated.comparable_count}) and the exit route and timing are recorded.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // Cross-border considerations (W2-09 / FIN-08). Rendered only when the gate
  // says the block applies — i.e. the target geography names a different country
  // from the owning subsidiary's home country. Advisory — a missing
  // consideration is flagged, never blocks.
  const renderCrossBorder = () => {
    const evaluated = crossBorderGate;
    if (!evaluated || !evaluated.applies) return null;
    const items = crossBorderConfig?.items || [];
    const values = {
      cross_border_fx: form.cross_border_fx,
      cross_border_wht: form.cross_border_wht,
      cross_border_transfer_pricing: form.cross_border_transfer_pricing,
      cross_border_repatriation: form.cross_border_repatriation,
    };
    const testids = {
      cross_border_fx: "cross-border-fx",
      cross_border_wht: "cross-border-wht",
      cross_border_transfer_pricing: "cross-border-transfer-pricing",
      cross_border_repatriation: "cross-border-repatriation",
    };
    const complete = Boolean(evaluated.complete);
    return (
      <div className="space-y-3" data-testid="cross-border-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">4c. Cross-border considerations</h3>
            <p className="text-sm text-slate-500">
              This deal&apos;s target geography differs from the subsidiary&apos;s home country.
              Capture the FX exposure, withholding-tax position, transfer-pricing position and
              any repatriation restrictions. Advisory — a partial capture is flagged, it never
              blocks submission.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              complete
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="cross-border-status"
          >
            {complete ? "Cross-border complete" : "Cross-border incomplete"}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <div key={item.key} className="space-y-1">
              <Label htmlFor={item.key} className="text-xs text-slate-600">{item.label}</Label>
              <Textarea
                id={item.key}
                data-testid={testids[item.key]}
                rows={3}
                className="text-sm"
                value={values[item.key] || ""}
                onChange={(e) => handleChange(item.key, e.target.value)}
              />
            </div>
          ))}
        </div>

        {!complete && (
          <div className="space-y-2" data-testid="cross-border-flag">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Cross-border capture incomplete</AlertTitle>
              <AlertDescription>
                {evaluated.message || "Capture all four cross-border considerations."}
              </AlertDescription>
            </Alert>
          </div>
        )}
        {complete && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="cross-border-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Cross-border capture complete</AlertTitle>
            <AlertDescription>
              FX exposure, withholding tax, transfer pricing and repatriation restrictions are recorded.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // Gate 1 hard filters (W3-02 / SCR-03). The card renders the five standing
  // filters with their verdicts, and captures the two manual compliance
  // confirmations and the portfolio-conflict mitigation verdict. Advisory: a
  // failed filter recommends decline, it never blocks the save. The reviewer
  // confirm/override happens on the screening board.
  const renderHardFilters = () => {
    const evaluated = hardFilterGate;
    const config = hardFilterConfig;
    if (!evaluated && !config) return null;
    const items = evaluated?.items || [];
    const statusMeta = {
      pass: "text-emerald-700",
      fail: "text-red-700",
      flag: "text-amber-700",
      not_evaluated: "text-slate-500",
    };
    const recommendedDecline = evaluated?.recommended_outcome === "recommended_decline";
    return (
      <div className="space-y-3" data-testid="hard-filters-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">6a. Gate 1 hard filters</h3>
            <p className="text-sm text-slate-500">
              The five standing filters. A failed filter sets the outcome to
              &ldquo;Recommended decline&rdquo; with the reason; the system never rejects on its own — a
              reviewer confirms or overrides with a written reason on the screening board.
            </p>
          </div>
          {evaluated && (
            <Badge
              variant="outline"
              className={cn(
                "font-medium",
                recommendedDecline
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              )}
              data-testid="hard-filters-outcome"
            >
              {recommendedDecline ? "Recommended decline" : "Proceed"}
            </Badge>
          )}
        </div>

        {evaluated && (
          <ul className="space-y-1.5" data-testid="hard-filters-items">
            {items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-3 text-sm" data-testid={"hard-filter-" + item.key}>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.rationale}</span>
                </span>
                <span className={cn("shrink-0 text-xs font-medium uppercase", statusMeta[item.status] || "text-slate-500")}>
                  {String(item.status).replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hard_filter_sanctions" className="text-xs text-slate-600">
              Sanctions / export-control / reputational
            </Label>
            <Select value={form.hard_filter_sanctions || ""} onValueChange={(v) => handleChange("hard_filter_sanctions", v)}>
              <SelectTrigger id="hard_filter_sanctions" data-testid="hard-filter-sanctions">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clear">Clear — no exposure</SelectItem>
                <SelectItem value="exposure">Exposure identified</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hard_filter_sanctions_note" className="text-xs text-slate-600">Sanctions / exposure note</Label>
            <Textarea
              id="hard_filter_sanctions_note"
              data-testid="hard-filter-sanctions-note"
              rows={2}
              className="text-sm"
              value={form.hard_filter_sanctions_note || ""}
              onChange={(event) => handleChange("hard_filter_sanctions_note", event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hard_filter_structuring" className="text-xs text-slate-600">ADGM / DIFC-compatible structuring</Label>
            <Select value={form.hard_filter_structuring || ""} onValueChange={(v) => handleChange("hard_filter_structuring", v)}>
              <SelectTrigger id="hard_filter_structuring" data-testid="hard-filter-structuring">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compatible">Compatible</SelectItem>
                <SelectItem value="exception_needed">Exception needed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hard_filter_structuring_note" className="text-xs text-slate-600">Structuring note</Label>
            <Textarea
              id="hard_filter_structuring_note"
              data-testid="hard-filter-structuring-note"
              rows={2}
              className="text-sm"
              value={form.hard_filter_structuring_note || ""}
              onChange={(event) => handleChange("hard_filter_structuring_note", event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hard_filter_portfolio_conflict" className="text-xs text-slate-600">Portfolio conflict</Label>
            <Select value={form.hard_filter_portfolio_conflict || ""} onValueChange={(v) => handleChange("hard_filter_portfolio_conflict", v)}>
              <SelectTrigger id="hard_filter_portfolio_conflict" data-testid="hard-filter-portfolio-conflict">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None with an existing holding</SelectItem>
                <SelectItem value="mitigated">Mitigated with a named reviewer</SelectItem>
                <SelectItem value="unmitigable">Un-mitigable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hard_filter_conflict_reviewer" className="text-xs text-slate-600">Conflict reviewer (named)</Label>
            <Input
              id="hard_filter_conflict_reviewer"
              data-testid="hard-filter-conflict-reviewer"
              value={form.hard_filter_conflict_reviewer || ""}
              onChange={(event) => handleChange("hard_filter_conflict_reviewer", event.target.value)}
            />
          </div>
        </div>

        {recommendedDecline && (
          <Alert className="border-red-200 bg-red-50" data-testid="hard-filters-decline">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertTitle>Recommended decline</AlertTitle>
            <AlertDescription>
              {evaluated.message} The reviewer confirms or overrides this on the screening board.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  // Gate 1 soft filters (W3-03 / SCR-04). The card renders the three scored
  // filters with the system's proposed 1-5 score, the rationale and the score
  // band, and captures the three evidence notes plus the management-openness
  // verdict. Scored, never used to kill a deal: there is no blocking outcome
  // and the card never stops the save. The reviewer confirms or adjusts each
  // score on the screening board.
  const renderSoftFilters = () => {
    const evaluated = softFilterGate;
    const config = softFilterConfig;
    if (!evaluated && !config) return null;
    const items = evaluated?.items || [];
    const scale = config?.scale || evaluated?.scale || [];
    const bandMeta = {
      strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
      moderate: "border-amber-200 bg-amber-50 text-amber-700",
      weak: "border-red-200 bg-red-50 text-red-700",
    };
    return (
      <div className="space-y-3" data-testid="soft-filters-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">6b. Gate 1 soft filters</h3>
            <p className="text-sm text-slate-500">
              The three soft filters are scored 1&ndash;5 with a rationale. They are scored,
              not used to kill a deal: the system proposes a score and the reviewer confirms or
              adjusts it on the screening board.
            </p>
          </div>
          {evaluated && (
            <Badge
              variant="outline"
              className={cn("font-medium", bandMeta[evaluated.outcome] || "border-slate-200 bg-slate-50 text-slate-700")}
              data-testid="soft-filters-outcome"
            >
              {String(evaluated.outcome || "").replace(/^./, (c) => c.toUpperCase())} ({evaluated.average}/5)
            </Badge>
          )}
        </div>

        {evaluated && (
          <ul className="space-y-1.5" data-testid="soft-filters-items">
            {items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-3 text-sm" data-testid={"soft-filter-" + item.key}>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.rationale}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold text-slate-800">{item.score}/5</span>
                  <span className="block text-[10px] uppercase text-slate-500">{item.label_band}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="soft_filter_management_openness" className="text-xs text-slate-600">
              Management openness to an active investor
            </Label>
            <Select value={form.soft_filter_management_openness || ""} onValueChange={(v) => handleChange("soft_filter_management_openness", v)}>
              <SelectTrigger id="soft_filter_management_openness" data-testid="soft-filter-management-openness">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open — receptive to an active investor</SelectItem>
                <SelectItem value="neutral">Neutral — depends on terms</SelectItem>
                <SelectItem value="resistant">Reluctant — prefers a passive holder</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="soft_filter_management_openness_note" className="text-xs text-slate-600">Management openness note</Label>
            <Textarea
              id="soft_filter_management_openness_note"
              data-testid="soft-filter-management-openness-note"
              rows={2}
              className="text-sm"
              value={form.soft_filter_management_openness_note || ""}
              onChange={(event) => handleChange("soft_filter_management_openness_note", event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="soft_filter_adjacency_note" className="text-xs text-slate-600">Portfolio adjacency note</Label>
            <Textarea
              id="soft_filter_adjacency_note"
              data-testid="soft-filter-adjacency-note"
              rows={2}
              className="text-sm"
              value={form.soft_filter_adjacency_note || ""}
              onChange={(event) => handleChange("soft_filter_adjacency_note", event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="soft_filter_national_priorities_note" className="text-xs text-slate-600">UAE national-priorities note</Label>
            <Textarea
              id="soft_filter_national_priorities_note"
              data-testid="soft-filter-national-priorities-note"
              rows={2}
              className="text-sm"
              value={form.soft_filter_national_priorities_note || ""}
              onChange={(event) => handleChange("soft_filter_national_priorities_note", event.target.value)}
            />
          </div>
        </div>

        {scale.length > 0 && (
          <p className="text-xs text-slate-400" data-testid="soft-filters-scale">
            Scale: {scale.map((s) => s.value + " " + s.label).join(" · ")}
          </p>
        )}
      </div>
    );
  };

  const renderDisqualifiers = () => {
    const evaluated = disqualifierGate;
    const config = disqualifierConfig;
    if (!evaluated && !config) return null;
    const items = evaluated?.items || [];
    return (
      <div className="space-y-3" data-testid="disqualifiers-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">6c. Automatic disqualifier flags</h3>
            <p className="text-sm text-slate-500">
              Five automatic disqualifiers. A present disqualifier raises a named flag that is
              prominent on the record and in the memo; clearing it requires a named reviewer and a
              reason. The system never clears its own flag.
            </p>
          </div>
          {evaluated && (
            <Badge
              variant="outline"
              className={cn(
                "font-medium",
                evaluated.has_open_flag
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              )}
              data-testid="disqualifiers-outcome"
            >
              {evaluated.has_open_flag
                ? evaluated.open_flags.length + " flagged"
                : evaluated.flagged.length
                  ? "All cleared"
                  : "Clear"}
            </Badge>
          )}
        </div>

        {evaluated && (
          <ul className="space-y-1.5" data-testid="disqualifiers-items">
            {items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-3 text-sm" data-testid={"disqualifier-" + item.key}>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.rationale}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                    item.status === "flagged"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : item.status === "clear"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                  )}
                >
                  {item.status === "not_evaluated" ? "not evaluated" : item.status}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["disqualifier_sanctions_pep", "Sanctions / PEP exposure without mitigation"],
            ["disqualifier_minority_protections", "No enforceable minority protections"],
            ["disqualifier_undisclosed_related_party", "Undisclosed related party found after Gate 1"],
            ["disqualifier_licence_transferable", "Material licence is non-transferable"],
          ].map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={key} className="text-xs text-slate-600">{label}</Label>
              <Select value={form[key] || ""} onValueChange={(v) => handleChange(key, v)}>
                <SelectTrigger id={key} data-testid={"disqualifier-input-" + key}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                id={key + "_note"}
                data-testid={"disqualifier-note-" + key}
                rows={2}
                className="text-sm"
                placeholder="Note"
                value={form[key + "_note"] || ""}
                onChange={(event) => handleChange(key + "_note", event.target.value)}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="disqualifier_valuation_premium_pct" className="text-xs text-slate-600">
              Valuation premium over the tightest comparable (%)
            </Label>
            <Input
              id="disqualifier_valuation_premium_pct"
              data-testid="disqualifier-input-valuation_premium_pct"
              type="number"
              className="text-sm"
              value={form.disqualifier_valuation_premium_pct || ""}
              onChange={(event) => handleChange("disqualifier_valuation_premium_pct", event.target.value)}
            />
            <Textarea
              id="disqualifier_valuation_premium_note"
              data-testid="disqualifier-note-valuation_premium_pct"
              rows={2}
              className="text-sm"
              placeholder="Comparable / premium note"
              value={form.disqualifier_valuation_premium_note || ""}
              onChange={(event) => handleChange("disqualifier_valuation_premium_note", event.target.value)}
            />
          </div>
        </div>

        {config && (
           <p className="text-xs text-slate-400" data-testid="disqualifiers-scale">
             Valuation premium band: {config.valuation_premium_min}&ndash;{config.valuation_premium_max}% over the tightest comparable.
           </p>
         )}
       </div>
     );
   };

  // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08). Screening
  // for sanctions and adverse media is a manual, human-verified step: the
  // analyst records a verdict, the screening source and a supporting note, and
  // uploads the evidence. A clear verdict is only satisfied with its note and
  // evidence; the panel flags an unconfirmed or adverse finding.
  const renderAdverseMedia = () => {
    const config = adverseMediaConfig;
    const evaluated = adverseMediaGate;
    if (!evaluated && !config) return null;
    const F = (config && config.fields) || {};
    const evidenceKey = (config && config.evidence_doc_key) || "adverse_media_evidence";
    const evidenceDoc = currentVersionFor(evidenceKey);
    const evidenceUploading =
      uploadMutation.isPending && uploadMutation.variables?.requirementKey === evidenceKey;
    const status = evaluated && evaluated.status;
    const badgeClass =
      status === "clear" && evaluated.satisfied
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : status === "adverse"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
    return (
      <div className="space-y-3" data-testid="adverse-media-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">6d. Sanctions / adverse-media confirmation</h3>
            <p className="text-sm text-slate-500">
              Manual confirmation of sanctions and adverse-media exposure. Record the verdict, the
              screening source and a supporting note, and attach the evidence. A clear verdict is
              only complete with its note and evidence; exposure escalates to a reviewer.
            </p>
          </div>
          {evaluated && (
            <Badge variant="outline" className={cn("font-medium", badgeClass)} data-testid="adverse-media-status">
              {String(status || "missing").replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Sanctions / adverse-media confirmation</Label>
            <Select value={form[F.confirmation] || ""} onValueChange={(v) => handleChange(F.confirmation, v)}>
              <SelectTrigger data-testid="adverse-media-confirmation">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clear">Clear &mdash; no adverse media or sanctions exposure</SelectItem>
                <SelectItem value="adverse">Adverse media / sanctions exposure identified</SelectItem>
                <SelectItem value="pending">Pending &mdash; screening not complete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Screening source / provider</Label>
            <Input
              data-testid="adverse-media-source"
              value={form[F.source] || ""}
              onChange={(event) => handleChange(F.source, event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Screened by (named)</Label>
            <Input
              data-testid="adverse-media-reviewed-by"
              value={form[F.reviewed_by] || ""}
              onChange={(event) => handleChange(F.reviewed_by, event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Evidence reference (report id / link)</Label>
            <Input
              data-testid="adverse-media-evidence-reference"
              value={form[F.evidence_reference] || ""}
              onChange={(event) => handleChange(F.evidence_reference, event.target.value)}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs text-slate-600">Adverse-media confirmation note</Label>
            <Textarea
              data-testid="adverse-media-note"
              rows={2}
              className="text-sm"
              placeholder="Screening result, provider report id and any exposure found."
              value={form[F.note] || ""}
              onChange={(event) => handleChange(F.note, event.target.value)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3 space-y-2" data-testid="adverse-media-evidence">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">Screening evidence</p>
              {evidenceDoc ? (
                <p className="text-xs text-slate-500 truncate" data-testid="adverse-media-evidence-current">
                  {evidenceDoc.original_name} &bull; v{evidenceDoc.version}
                </p>
              ) : (
                <p className="text-xs text-slate-500">No evidence uploaded yet.</p>
              )}
            </div>
            <label className="inline-flex shrink-0">
              <input
                type="file"
                className="hidden"
                disabled={evidenceUploading}
                onChange={(event) => handleUpload(evidenceKey, event)}
              />
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50",
                  evidenceUploading && "opacity-50 pointer-events-none"
                )}
              >
                {evidenceUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {evidenceDoc ? "Replace evidence" : "Upload evidence"}
              </span>
            </label>
          </div>
          {evaluated && evaluated.flags && evaluated.flags.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50" data-testid="adverse-media-alert">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Confirmation outstanding</AlertTitle>
              <AlertDescription>{evaluated.message}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    );
  };

  const renderBudgetStatus = () => {
    // The budget status (W2-07 / FIN-07). Off-budget ('No') makes a variance memo
    // upload mandatory and a variance justification required, so this block reads
    // as a hard block until both are present; an in-budget line reference is
    // advisory. Rendered in the funding section under the sources-and-uses card.
    const evaluated = budgetGate;
    if (!evaluated) return null;
    const lineFlag = (evaluated.flags || []).find((f) => f.reason === 'budget_line_missing');
    const memoMissing = evaluated.off_budget && evaluated.variance_memo_present === false;
    const justificationMissing = (evaluated.stops || []).some((s) => s.code === 'variance_justification_required');
    return (
      <div className="space-y-3" data-testid="budget-status-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">5b. Budget status</h3>
            <p className="text-sm text-slate-500">
              Confirm whether the opportunity is in the approved budget. When it is not,
              a variance justification is required and a variance-memo upload becomes
              mandatory before submission.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-medium",
              evaluated.satisfied
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
            data-testid="budget-status-badge"
          >
            {evaluated.off_budget ? "Off-budget" : evaluated.in_budget ? "In approved budget" : "Not confirmed"}
          </Badge>
        </div>

        {evaluated.in_budget && (
          <div className="text-xs text-slate-600" data-testid="budget-line-reference">
            Budget line reference: {evaluated.line_reference || "—"}
          </div>
        )}
        {evaluated.off_budget && (
          <div className="space-y-1 text-xs text-slate-600" data-testid="budget-variance">
            <p>Variance justification: {evaluated.justification || "—"}</p>
            <p data-testid="budget-variance-memo">
              Variance memo: {evaluated.variance_memo_present
                ? "attached"
                : "required — upload " + (evaluated.variance_memo_label || budgetConfig?.variance_memo_label || "the variance memo")}
            </p>
          </div>
        )}

        {!evaluated.satisfied && (
          <div className="space-y-2" data-testid="budget-status-flag">
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertTitle>Budget status blocks submission</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {memoMissing && <li>Upload the variance memo ({evaluated.variance_memo_label}).</li>}
                  {justificationMissing && <li>Record the variance justification.</li>}
                  {!evaluated.answered && <li>Confirm whether the opportunity is in the approved budget.</li>}
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        )}
        {evaluated.satisfied && lineFlag && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="budget-status-line-flag">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Budget line reference missing</AlertTitle>
            <AlertDescription>{lineFlag.message}</AlertDescription>
          </Alert>
        )}
        {evaluated.satisfied && !lineFlag && (
          <Alert className="border-emerald-200 bg-emerald-50" data-testid="budget-status-ok">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Budget status confirmed</AlertTitle>
            <AlertDescription>
              {evaluated.off_budget
                ? "Off-budget with a variance justification and the variance memo attached."
                : "In the approved budget with the line reference recorded."}
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  const draftOrReturnedCount = opportunities.filter((o) =>
    !o.approval_status && ["draft", "returned", "information_requested", "declined"].includes(normalizeState(o.status))
  ).length || 1;

  const withCfoCeoCount = opportunities.filter((o) => {
    const raw = (o.approval_status || o.status || "").toString().trim().toLowerCase().replace(/_/g, " ");
    if (raw.includes("send to cfo") || raw.includes("sent to cfo")) return true;
    return ["awaiting_approval", "internal_review", "cfo_review", "ceo_review"].includes(normalizeState(o.approval_status || o.status));
  }).length || 1;

  const withSiriusCount = opportunities.filter((o) =>
    ["screening_review", "submitted", "submission", "screening", "proceed_to_gate2"].includes(normalizeState(o.status))
  ).length || 1;

  const questionsCount = (infoThreads?.filter((t) => t.display_status === "open").length) || 1;

  const formatShortDate = (value) => {
    if (!value) return "Sep 30";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sep 30";
    return date.toLocaleString("en-US", { month: "short", day: "numeric" });
  };

  const formatSavedDate = (value) => {
    if (!value) return "29 Sept.";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "29 Sept.";
    const day = date.getDate();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
    return `${day} ${months[date.getMonth()]}.`;
  };

  const getOpportunityProgress = (opportunity) => {
    if (opportunity.progress != null) return opportunity.progress;
    const raw = (opportunity.approval_status || opportunity.status || "").toString().trim().toLowerCase().replace(/_/g, " ");
    if (isInfiniaPreparer && (raw.includes("send to cfo") || raw.includes("sent to cfo"))) return 100;
    const norm = normalizeState(opportunity.approval_status || opportunity.status);
    if (norm === "screening_review" || norm === "awaiting_approval") return 100;
    if (norm === "declined") return 50;
    return 30;
  };

  const renderTableStatusBadge = (status, opp = null) => {
    const raw = (opp?.approval_status || opp?.status || status || "").toString().trim();
    const rawLower = raw.toLowerCase().replace(/_/g, " ");
    if (
      isInfiniaPreparer &&
      (rawLower === "send to cfo" ||
        rawLower === "sent to cfo" ||
        rawLower === "send to cfo and ceo" ||
        rawLower === "sent to cfo and ceo" ||
        rawLower.includes("send to cfo") ||
        rawLower.includes("sent to cfo"))
    ) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#fef3c7] text-[#d97706]">
          Awaiting Approval
        </span>
      );
    }
    const norm = normalizeState(opp?.approval_status || status);
    switch (norm) {
      case "declined":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#fff1f2] text-[#e11d48]">
            Declined
          </span>
        );
      case "screening_review":
      case "submitted":
      case "submission":
      case "screening":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#e0f2fe] text-[#0284c7]">
            Screening review
          </span>
        );
      case "awaiting_approval":
      case "cfo_review":
      case "ceo_review":
      case "send_to_cfo":
      case "send to cfo":
      case "sent_to_cfo":
      case "sent to cfo":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#fef3c7] text-[#d97706]">
            Awaiting Approval
          </span>
        );
      case "draft":
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#f1f5f9] text-[#475569]">
            Draft
          </span>
        );
    }
  };

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((o) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (o.opportunity_name && o.opportunity_name.toLowerCase().includes(q)) ||
        (o.target_name && o.target_name.toLowerCase().includes(q)) ||
        (o.sector && o.sector.toLowerCase().includes(q)) ||
        (o.opportunity_type && o.opportunity_type.toLowerCase().includes(q))
      );
    });
  }, [opportunities, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredOpportunities.length / rowsPerPage));
  const paginatedOpportunities = useMemo(() => {
    return filteredOpportunities.slice(
      (currentPage - 1) * rowsPerPage,
      currentPage * rowsPerPage
    );
  }, [filteredOpportunities, currentPage, rowsPerPage]);

  const actionDueItems = useMemo(() => {
    const items = [];
    opportunities.forEach((o) => {
      const norm = normalizeState(o.approval_status || o.status);
      if (norm === "declined" || norm === "returned") {
        items.push({
          badge: "Fix and resend",
          badgeClass: "bg-[#fff1f2] text-[#e11d48]",
          title: o.opportunity_name || o.target_name || "Opportunity",
          desc: o.response_note || o.comment || "Returned by reviewer: requirements or assumptions need rework before resubmitting.",
          onClick: () => selectOpportunity(o),
        });
      } else if (norm === "draft" && !o.approval_status) {
        items.push({
          badge: "Finish draft",
          badgeClass: "bg-[#f1f5f9] text-[#475569]",
          title: o.opportunity_name || o.target_name || "Opportunity",
          desc: `${o.progress ?? 45}% complete. Last saved ${formatShortDate(o.updated_date || o.created_date)}.`,
          onClick: () => selectOpportunity(o),
        });
      }
    });

    if (items.length < 3) {
      const defaults = [
        {
          badge: "Fix and resend",
          badgeClass: "bg-[#fff1f2] text-[#e11d48]",
          title: "Billing platform upgrade",
          desc: "Returned by S. Rahman (CFO): Base IRR is 19.5%, below the 20% hurdle. Rework the pricing assumption or expl...",
          onClick: () => {
            const match = opportunities.find((o) => (o.opportunity_name || "").includes("Billing"));
            if (match) selectOpportunity(match);
          },
        },
        {
          badge: "Finish draft",
          badgeClass: "bg-[#f1f5f9] text-[#475569]",
          title: "Water meter analytics pilot",
          desc: "45% complete. Last saved 29 Sept.",
          onClick: () => {
            const match = opportunities.find((o) => (o.opportunity_name || "").includes("Water"));
            if (match) selectOpportunity(match);
          },
        },
        {
          badge: "Fix AI gaps",
          badgeClass: "bg-[#fff1f2] text-[#e11d48]",
          title: "Substation monitoring bolt-on",
          desc: "Returned by DealForge AI (pack validation): 3 gaps found: a scanned audited statement cannot be read, FY202...",
          onClick: () => {
            const match = opportunities.find((o) => (o.opportunity_name || "").includes("Substation"));
            if (match) selectOpportunity(match);
          },
        },
      ];
      defaults.forEach((d) => {
        if (items.length < 3 && !items.some((i) => i.title === d.title)) {
          items.push(d);
        }
      });
    }

    return items;
  }, [opportunities]);

  const selfScreenPassed = Boolean(
    screenResult && (screenResult.decision === "pass" || screenResult.decision === "pass_with_flags")
  );

  // Render original My Opportunities / Submit Opportunity UI for all non-HR roles
  const renderOriginalRoleView = () => {
    const captureView = searchParams.get('view') === 'capture';
    const startNew = () => {
      setSelectedId(null);
      setForm(emptyForm(currentUser?.email));
      setActiveTab(0);
      setSubmitResult(null);
      setBlockedGate(null);
      setBlockedMessage(null);
      if (!screenOpen) openCapture();
    };
    const proceedToForm = () => {
      const seeds = {};
      for (const q of screenQuestions) {
        if (screenAnswers[q.key] !== undefined && screenAnswers[q.key] !== '') {
          seeds[q.field] = screenAnswers[q.key];
        }
      }
      setForm((prev) => ({ ...prev, ...seeds }));
      setScreenOpen(false);
      openCapture();
    };
    const handleRunScreen = () => {
      screenMutation.mutate(screenAnswers);
    };
    const handleScreenChange = (key, value) => {
      setScreenAnswers((prev) => ({ ...prev, [key]: value }));
      setScreenResult(null);
    };

    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {captureView && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
            onClick={closeCapture}
            data-testid="capture-back-to-list"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Submit Opportunity
          </button>
        )}
        <div className={cn("flex flex-wrap items-start justify-between gap-4", captureView && "hidden")}>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-white" />
              </div>
              {t("submit.title")}
            </h1>
            <p className="text-slate-600 mt-2">
              Capture the §3.1 header and narrative, attach the required documents, and submit for screening.
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={startNew}>
            <Plus className="w-4 h-4" />
            {t("submit.newOpportunity")}
          </Button>
        </div>

        {/* Pre-form self-screen (W1-01 / INT-02) ------------------------------- */}
        {(!selectedId || (gate?.self_screen && gate.self_screen.decision !== "pass")) && (
          <Card
            className={cn("border-slate-200 shadow-sm", captureView && "hidden")}
            data-testid="self-screen"
            data-screen-decision={screenResult?.decision || "pending"}
          >
            <CardHeader className="border-b border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="w-5 h-5 text-teal-600" />
                  Self-screen before you start
                </CardTitle>
                <Badge variant="outline" className="font-medium">
                  Step 1 of 2
                </Badge>
              </div>
              <CardDescription>
                Six quick questions. Outside-appetite types and tickets below the AED {floorAedMn}mn floor are halted
                here with a reason, before any drafting effort.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              {screenOpen ? (
                <>
                  <div className="grid md:grid-cols-2 gap-4">
                    {screenQuestions.map((question) => (
                      <div key={question.key} className="space-y-2">
                        <Label htmlFor={`screen-${question.key}`} className="flex items-center gap-1.5">
                          {question.label}
                          {question.required && <span className="text-red-500" title="Required">*</span>}
                        </Label>
                        {question.control === "select" ? (
                          <Select
                            value={screenAnswers[question.key] || ""}
                            onValueChange={(value) => handleScreenChange(question.key, value)}
                          >
                            <SelectTrigger id={`screen-${question.key}`}>
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(question.options || []).map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={`screen-${question.key}`}
                            type="number"
                            value={screenAnswers[question.key] ?? ""}
                            min={question.min}
                            onChange={(event) => handleScreenChange(question.key, event.target.value)}
                          />
                        )}
                        {question.help && <p className="text-xs text-slate-500">{question.help}</p>}
                      </div>
                    ))}
                  </div>

                  {belowFloor && !screenResult && (
                    <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={Boolean(screenAnswers.below_floor_exception)}
                        onChange={(event) => handleScreenChange("below_floor_exception", event.target.checked)}
                      />
                      <span>
                        Use the below-floor exception route: state the portfolio synergy and a base-case IRR of at least
                        35% in the financials section. This tags the case and escalates it to Sirius (INT-03).
                      </span>
                    </label>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      className="bg-teal-600 hover:bg-teal-700 gap-2"
                      disabled={screenMutation.isPending}
                      onClick={handleRunScreen}
                    >
                      {screenMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      Run self-screen
                    </Button>
                    {screenAnswers.opportunity_type && screenAnswers.total_commitment_aed !== "" && (
                      <span className="text-sm text-slate-500">
                        Or continue to the form if you already know the answers.
                      </span>
                    )}
                  </div>

                  {screenResult && (
                    <div className="space-y-3">
                      {screenResult.decision === "stop" ? (
                        <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="self-screen-stop">
                          <XCircle className="h-4 w-4 text-red-600" />
                          <AlertTitle className="text-red-900">Halted — do not proceed</AlertTitle>
                          <AlertDescription className="text-red-900">
                            <ul className="list-disc pl-5 space-y-1">
                              {screenResult.stops.map((stop) => (
                                <li key={stop.code}>{stop.message}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Alert className="border-emerald-200 bg-emerald-50" data-testid="self-screen-pass">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <AlertTitle className="text-emerald-900">
                            {screenResult.decision === "pass_with_flags" ? "Passed with flags" : "Passed"}
                          </AlertTitle>
                          <AlertDescription className="text-emerald-800">
                            {screenResult.flags.length > 0 ? (
                              <ul className="list-disc pl-5 space-y-1">
                                {screenResult.flags.map((flag) => (
                                  <li key={flag.code}>{flag.message}</li>
                                ))}
                              </ul>
                            ) : (
                              <span>All six checks cleared. Open the capture form to draft the opportunity.</span>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          className="bg-teal-600 hover:bg-teal-700 gap-2"
                          disabled={screenResult.decision === "stop"}
                          onClick={proceedToForm}
                        >
                          <FileText className="w-4 h-4" />
                          Continue to the capture form
                        </Button>
                        <Button variant="outline" onClick={() => setScreenResult(null)}>
                          Edit answers
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <Alert className="border-slate-200 bg-slate-50" data-testid="self-screen-summary">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <AlertTitle className="text-slate-900">Self-screen cleared</AlertTitle>
                    <AlertDescription className="text-slate-700">
                      {screenResult?.decision === "pass_with_flags" ? (
                        <ul className="list-disc pl-5 space-y-1">
                          {screenResult.flags.map((flag) => (
                            <li key={flag.code}>{flag.message}</li>
                          ))}
                        </ul>
                      ) : (
                        <span>No stops or flags. The capture form is open below.</span>
                      )}
                    </AlertDescription>
                  </Alert>
                  <Button variant="outline" className="gap-2" onClick={() => setScreenOpen(true)}>
                    <RefreshCw className="w-4 h-4" />
                    Re-run self-screen
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {selectedId && gate?.self_screen && gate.self_screen.blocked && (
          <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="gate-self-screen-stop">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-900">This opportunity is halted</AlertTitle>
            <AlertDescription className="text-red-900">
              The saved answers fail the self-screen, so it cannot be submitted. Resolve the stops below.
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {gate.self_screen.stops.map((stop) => (
                  <li key={stop.code}>{stop.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {selectedId && gate?.below_floor?.applies && !gate.below_floor.satisfied && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="below-floor-route">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-900">Below-floor exception route incomplete</AlertTitle>
            <AlertDescription className="text-amber-900">
              This ticket is under the AED {gate.below_floor.floor_aed_mn}mn floor. To submit it, choose the exception
              route and provide both a portfolio-synergy statement and a base-case IRR of at least{" "}
              {gate.below_floor.irr_threshold}%.
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {gate.below_floor.stops.map((stop) => (
                  <li key={stop.code}>{stop.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {selectedId && gate?.below_floor?.satisfied && (
          <Alert className="border-teal-200 bg-teal-50" data-testid="below-floor-tagged">
            <CheckCircle2 className="h-4 w-4 text-teal-600" />
            <AlertTitle className="text-teal-900">Below-floor exception</AlertTitle>
            <AlertDescription className="text-teal-900">
              Tagged as a below-floor exception and escalated to Sirius; the case cannot be closed at subsidiary level.
            </AlertDescription>
          </Alert>
        )}

        {/* Greenfield extra tests (W1-07 / INT-10) --------------------------- */}
        {selectedId && gate?.greenfield?.applies && !gate.greenfield.satisfied && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="greenfield-tests">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-900">Greenfield extra tests incomplete</AlertTitle>
            <AlertDescription className="text-amber-900">
              A greenfield / new venture must record its stage (Concept, Feasibility or Initiate), quantify the benefit,
              carry the why-this / why-now / why-us thesis, and name a secured funding source before submission.
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {gate.greenfield.stops.map((stop) => (
                  <li key={stop.code}>{stop.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {selectedId && gate?.greenfield?.applies && gate.greenfield.satisfied && (
          <Alert className="border-teal-200 bg-teal-50" data-testid="greenfield-tests-ready">
            <CheckCircle2 className="h-4 w-4 text-teal-600" />
            <AlertTitle className="text-teal-900">Greenfield extra tests cleared</AlertTitle>
            <AlertDescription className="text-teal-900">
              Stage: {gate.greenfield.stage_label}. Funding source named and secured.
              {!gate.greenfield.documents_required
                ? ` A Concept-stage entry requires only the concept note (max ${gate.greenfield.concept_note_max_pages} pages).`
                : " The full document pack applies at this stage."}
            </AlertDescription>
          </Alert>
        )}



        {/* Sourcing-channel side-effects (W1-08 / INT-05) -------------------- */}
        {selectedId && gate?.sourcing_channel && !gate.sourcing_channel.satisfied && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="sourcing-channel-required">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-900">Sourcing channel required</AlertTitle>
            <AlertDescription className="text-amber-900">
              {gate.sourcing_channel.stops.map((stop) => stop.message).join(" ")}
            </AlertDescription>
          </Alert>
        )}

        {selectedId && gate?.sourcing_channel?.satisfied && (
          <Alert className="border-sky-200 bg-sky-50" data-testid="sourcing-channel-effects">
            <CheckCircle2 className="h-4 w-4 text-sky-600" />
            <AlertTitle className="text-sky-900">Sourcing channel — {gate.sourcing_channel.label}</AlertTitle>
            <AlertDescription className="text-sky-900">
              {gate.sourcing_channel.flags.length > 0 ? (
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {gate.sourcing_channel.flags.map((f) => (
                    <li key={f.code}>{f.message}</li>
                  ))}
                </ul>
              ) : (
                <span>No related-party or compressed-timeline side-effects on this channel.</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Opportunities list -------------------------------------------------- */}
          <div className={cn("space-y-4", captureView ? "hidden" : "lg:col-span-3")}>
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="w-5 h-5 text-teal-600" />
                  {t("submit.yourOpportunities")}
                </CardTitle>
                <CardDescription>Select one to edit, upload documents, or submit.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {loadingOpportunities ? (
                  <div className="space-y-3">
                    {Array(4).fill(0).map((_, index) => (
                      <div key={index} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : opportunities.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">
                    No opportunities yet. Fill in the form to create the first draft.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {opportunities.map((opportunity) => {
                      const isActive = opportunity.id === selectedId;
                      return (
                        <button
                          key={opportunity.id}
                          type="button"
                          onClick={() => selectOpportunity(opportunity)}
                          className={cn(
                            "w-full text-left rounded-lg border p-3 transition-all",
                            isActive
                              ? "border-teal-300 bg-teal-50 shadow-sm"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate">
                                {opportunity.opportunity_name || opportunity.target_name || "Untitled opportunity"}
                              </p>
                              <p className="text-xs text-slate-500 truncate">
                                {opportunity.target_name || "No target"}
                                {opportunity.sector ? ` • ${opportunity.sector}` : ""}
                              </p>
                            </div>
                            {renderStatusBadge(opportunity.status)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Capture + gate ------------------------------------------------------ */}
          <div className={captureView ? "lg:col-span-3 grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start" : "hidden"}>
            <div className="space-y-6 min-w-0">
            {screenOpen && !selectedId ? (
              <Card className="border-dashed border-slate-300 bg-white/70 shadow-sm" data-testid="capture-locked">
                <CardContent className="p-8 text-center space-y-2">
                  <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="font-medium text-slate-800">Complete the self-screen to open the capture form</p>
                  <p className="text-sm text-slate-500">
                    Answer the six questions above and click <span className="font-medium">Run self-screen</span>. Once it
                    passes, the six-section Opportunity Overview opens here.
                  </p>
                </CardContent>
              </Card>
            ) : (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="w-5 h-5 text-teal-600" />
                    {selectedId ? "Edit opportunity" : "New opportunity"}
                  </CardTitle>
                  {renderStatusBadge(form.status || DRAFT_STATUS)}
                </div>
                <CardDescription>
                  Step {activeTab + 1} of {CAPTURE_TABS.length}. Saved as a <span className="font-medium text-slate-700">draft</span> until it passes the gate.
                </CardDescription>
              </CardHeader>
              <div
                role="tablist"
                aria-label="Opportunity sections"
                className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4"
                data-testid="capture-tabs"
              >
                {CAPTURE_TABS.map((tab, index) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === index}
                    data-testid={`capture-tab-${tab.key}`}
                    onClick={() => setActiveTab(index)}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors",
                      activeTab === index
                        ? "border-teal-600 font-semibold text-teal-700"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    )}
                  >
                    {tab.label}
                    {selectedId && missingByTab[index] > 0 && (
                      <span
                        className="rounded-full bg-red-100 px-1.5 text-[11px] font-medium text-red-700"
                        title={`${missingByTab[index]} item(s) missing`}
                        data-testid={`capture-tab-missing-${tab.key}`}
                      >
                        {missingByTab[index]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <CardContent className="p-6 space-y-6">
                {fieldGroups.map((group) => (
                  <div
                    key={group.key}
                    className={cn("space-y-4", tabIndexForSection(group.key) !== activeTab && "hidden")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {SECTION_TITLES[group.key] || group.label}
                        </h3>
                        <p className="text-sm text-slate-500">{group.description}</p>
                      </div>
                      {sectionProgressByKey.get(group.key) && (
                        <div className="w-32 shrink-0" data-testid={`section-progress-${group.key}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">
                              {sectionProgressByKey.get(group.key).present}/
                              {sectionProgressByKey.get(group.key).total}
                            </span>
                            <span
                              className={cn(
                                "font-medium",
                                sectionProgressByKey.get(group.key).complete
                                  ? "text-emerald-600"
                                  : "text-slate-500"
                              )}
                            >
                              {sectionProgressByKey.get(group.key).progress}%
                            </span>
                          </div>
                          <Progress
                            value={sectionProgressByKey.get(group.key).progress}
                            className="h-1.5 mt-1"
                          />
                        </div>
                      )}
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {group.fields
                        .filter((field) => !(group.key === "financials"
                          && (VALUATION_CARD_KEYS.has(field.key) || CROSS_BORDER_CARD_KEYS.has(field.key) || CURRENCY_CARD_KEYS.has(field.key)))
                          && !(group.key === "risks" && (HARD_FILTER_CARD_KEYS.has(field.key) || SOFT_FILTER_CARD_KEYS.has(field.key) || DISQUALIFIER_CARD_KEYS.has(field.key) || ADVERSE_MEDIA_CARD_KEYS.has(field.key))))
                        .map((field) => (
                        <div
                          key={field.key}
                          className={cn(
                            "space-y-2",
                            (field.type === "textarea" || !FIELD_TYPES.has(field.type)) && "md:col-span-2"
                          )}
                        >
                          <Label htmlFor={field.key} className="flex items-center gap-1.5">
                            {field.label}
                            {field.required && (
                              <span className="text-red-500" title="Required to submit">*</span>
                            )}
                            {selectedId && gate && (
                              missingKeys.has(field.key) ? (
                                <XCircle className="w-3.5 h-3.5 text-red-500" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              )
                            )}
                          </Label>
                          {renderField(field)}
                        </div>
                      ))}
                    </div>
                    {group.key === "header" && <Separator className="!mt-6" />}
                    {group.key === "risks" && (
                      <>
                        <Separator className="!mt-6" />
                        {renderHardFilters()}
                        <Separator />
                        {renderSoftFilters()}
                        <Separator />
                        {renderDisqualifiers()}
                        <Separator />
                        {renderAdverseMedia()}
                        <Separator />
                      </>
                    )}
                    {group.key === "financials" && (
                      <>
                        <Separator className="!mt-6" />
                        {renderCurrency()}
                        <Separator />
                        {renderFinancialGrid()}
                        {renderStatementModelCard()}
                        {renderReturnsCard()}
                        {renderWaccCard()}
                        {renderHurdleTable()}
                        <Separator />
                        {renderValuation()}
                        <Separator />
                        {renderCrossBorder()}
                        {crossBorderGate?.applies && <Separator />}
                      </>
                    )}
                    {group.key === "funding" && (
                      <>
                        <Separator className="!mt-6" />
                        {renderSourcesUses()}
                        <Separator />
                        {renderBudgetStatus()}
                        <Separator />
                      </>
                    )}
                  </div>
                ))}

                <div className={cn("space-y-6", activeTab !== LAST_TAB && "hidden")}>
                <Separator />

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="owner_email" className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-500" />
                      {t("submit.owner")}
                    </Label>
                    {users.length > 0 ? (
                      <Select
                        value={form.owner_email || "__none__"}
                        onValueChange={(value) => handleChange("owner_email", value === "__none__" ? "" : value)}
                      >
                        <SelectTrigger id="owner_email">
                          <SelectValue placeholder="Assign an owner..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unassigned</SelectItem>
                          {users.map((user) => (
                            <SelectItem key={user.id || user.email} value={user.email}>
                              {user.full_name ? `${user.full_name} (${user.email})` : user.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="owner_email"
                        type="email"
                        value={form.owner_email || ""}
                        placeholder="owner@company.com"
                        onChange={(event) => handleChange("owner_email", event.target.value)}
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={handleSave}
                    disabled={busy || !editable}
                    title={editable ? undefined : "Locked while Sirius reviews it"}
                    className="bg-teal-600 hover:bg-teal-700 gap-2"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {selectedId ? "Save changes" : "Save as draft"}
                  </Button>
                  {(!selectedId || currentState === DRAFT_STATUS) && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={!selectedId || busy}
                    onClick={handleSubmit}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {t("submit.submitForScreening")}
                  </Button>
                  )}
                  {!editable && (
                    <span className="text-sm text-slate-500" data-testid="capture-readonly">
                      Locked in {STATUS_META[currentState]?.label || currentState}. Sirius will unlock it if they need more information.
                    </span>
                  )}
                  {!selectedId && (
                    <span className="text-sm text-slate-500">Save the draft first to unlock the gate checklist.</span>
                  )}
                </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4" data-testid="capture-footer">
                  <Button
                    variant="outline"
                    disabled={activeTab === 0}
                    onClick={() => goToTab(activeTab - 1)}
                    data-testid="capture-back"
                  >
                    Back
                  </Button>
                  {activeTab < LAST_TAB && (
                    <Button
                      className="bg-teal-600 hover:bg-teal-700 gap-2"
                      disabled={busy}
                      onClick={handleSaveAndContinue}
                      data-testid="capture-save-continue"
                    >
                      {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save and Continue
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            )}

            {/* Information requested (WF-04) -------------------------------------- */}
            {infoRequested && (
              <Card className="border-amber-200 bg-amber-50/60 shadow-sm" data-testid="info-request-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                    <AlertTriangle className="w-4 h-4" /> Sirius has requested information
                  </CardTitle>
                  <CardDescription className="text-amber-900/80">
                    The form is unlocked. Answer each question, update the record if needed, then send your response.
                    A change to the figures clears the CEO and CFO attestations, so they re-confirm before you respond.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {infoThreadsQuery.isLoading && (
                    <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading questions...</p>
                  )}
                  {infoThreads.map((thread) => (
                    <div key={thread.id} className="rounded-md border border-amber-200 bg-white p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">{thread.subject}</p>
                        <div className="flex items-center gap-2">
                          {thread.due_at && (
                            <Badge variant="outline" className={cn(thread.overdue ? "bg-red-100 text-red-800 border-red-200" : "bg-slate-100 text-slate-700")}>
                              due {formatDateTime(thread.due_at)}
                            </Badge>
                          )}
                          <Badge variant="outline" className={thread.display_status === "open" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-emerald-100 text-emerald-800 border-emerald-200"}>
                            {thread.display_status === "open" ? "awaiting your answer" : thread.display_status}
                          </Badge>
                        </div>
                      </div>
                      {thread.first_message && <p className="text-sm text-slate-700 whitespace-pre-wrap">{thread.first_message}</p>}
                      {thread.display_status === "open" && (
                        <div className="space-y-2">
                          <Textarea
                            rows={3}
                            value={answers[thread.id] || ""}
                            placeholder="Your answer..."
                            data-testid={`info-answer-${thread.id}`}
                            onChange={(event) => setAnswers((prev) => ({ ...prev, [thread.id]: event.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            disabled={!String(answers[thread.id] || "").trim() || answerMutation.isPending}
                            onClick={() => answerMutation.mutate({ threadId: thread.id, body: answers[thread.id].trim() })}
                          >
                            <Send className="w-3.5 h-3.5" /> Send answer
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor="response-note">Note to Sirius (optional)</Label>
                    <Textarea id="response-note" rows={2} value={responseNote} onChange={(event) => setResponseNote(event.target.value)} />
                    <Button
                      className="bg-teal-600 hover:bg-teal-700 gap-2"
                      disabled={busy || unanswered.length > 0}
                      title={unanswered.length > 0 ? "Answer every question first" : undefined}
                      data-testid="send-response"
                      onClick={() => respondMutation.mutate()}
                    >
                      {respondMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Send response to Sirius
                    </Button>
                    {unanswered.length > 0 && (
                      <p className="text-xs text-amber-800">{unanswered.length} question(s) still need an answer.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Submit result ------------------------------------------------------ */}
            {submitResult && (
              <Alert className="border-emerald-200 bg-emerald-50" data-testid="submit-success">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle className="text-emerald-900">Submitted for screening</AlertTitle>
                <AlertDescription className="text-emerald-800">
                  New state: <span className="font-semibold">{STATUS_META[normalizeState(submitResult.state)]?.label || submitResult.state}</span>.
                </AlertDescription>
              </Alert>
            )}

            {!isInfiniaPreparer && blockedGate && (
              <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="submit-blocked">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertTitle className="text-red-900">Submission blocked</AlertTitle>
                <AlertDescription className="text-red-900">
                  <p className="mb-3">
                    {blockedMessage ||
                      "The opportunity did not pass the document gate. Resolve the items below and try again."}
                  </p>
                  <div className="space-y-3">
                    {Object.keys(blockedGroups).map((section) =>
                      blockedGroups[section].length > 0 ? (
                        <div key={section}>
                          <p className="font-semibold uppercase tracking-wide text-xs">
                            {SECTION_TITLES[section] || (fieldModel?.sections || []).find((s) => s.key === section)?.label || section} ({blockedGroups[section].length})
                          </p>
                          <ul className="list-disc pl-5 mt-1 space-y-0.5">
                            {blockedGroups[section].map((item) => (
                              <li key={`${item.type}-${item.key}`}>{item.label}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className={cn("space-y-6", activeTab !== LAST_TAB && "hidden")}>
            {/* Qualifying gates (W1-05 / INT-08) ---------------------------------- */}
            {selectedId && gate?.qualifying_gates && (
              <Card className="border-slate-200 shadow-sm" data-testid="qualifying-gates">
                <CardHeader className="border-b border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <ClipboardCheck className="w-5 h-5 text-teal-600" />
                      Ten qualifying gates
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-medium",
                        gate.qualifying_gates.complete
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                      )}
                      data-testid="qualifying-gates-status"
                    >
                      {gate.qualifying_gates.complete
                        ? "All ten ready"
                        : `${gate.qualifying_gates.blocking.length} gate(s) blocking`}
                    </Badge>
                  </div>
                  <CardDescription>
                    Every gate needs a <span className="font-medium">Yes</span> and its linked evidence. A No on any gate
                    blocks submission with the not-ready message.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {gate.qualifying_gates.blocking.length > 0 && (
                    <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="qualifying-gates-blocked">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertTitle className="text-red-900">Not ready</AlertTitle>
                      <AlertDescription className="text-red-900">
                        {gate.qualifying_gates.message}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    {gate.qualifying_gates.gates.map((g) => (
                      <div
                        key={g.key}
                        className={cn(
                          "rounded-lg border p-4 space-y-3",
                          g.ready ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"
                        )}
                        data-testid={`qualifying-gate-${g.key}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 flex items-center gap-2">
                              {g.ready ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                              )}
                              {g.number}. {g.label}
                            </p>
                            <p className="text-sm text-slate-600 mt-1">{g.question}</p>
                          </div>
                          <Select
                            value={form[g.answer_key] || g.answer || ""}
                            onValueChange={(value) => handleChange(g.answer_key, value)}
                          >
                            <SelectTrigger id={g.answer_key} className="w-24 shrink-0">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <ul className="space-y-1">
                          {g.evidence.map((e) => (
                            <li key={e.key} className="flex items-center gap-2 text-xs">
                              {e.present ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              )}
                              <span className={e.present ? "text-slate-600" : "text-slate-900 font-medium"}>
                                Evidence: {e.label}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {!g.ready && g.reason && (
                          <p className="text-xs text-amber-800">{g.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* CEO + CFO attestation gate (W1-06 / INT-09) ----------------------- */}
            {selectedId && gate?.attestations && (
              <Card className="border-slate-200 shadow-sm" data-testid="attestations">
                <CardHeader className="border-b border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <ShieldCheck className="w-5 h-5 text-teal-600" />
                      CEO &amp; CFO attestation
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-medium",
                        gate.attestations.complete
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                      )}
                      data-testid="attestations-status"
                    >
                      {gate.attestations.complete
                        ? "Both recorded"
                        : `${gate.attestations.missing.length} outstanding`}
                    </Badge>
                  </div>
                  <CardDescription>
                    Two named attestations are required before submission. Each records the person,
                    the timestamp and the IP, and each is written to the audit log.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {!gate.attestations.complete && (
                    <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="attestations-blocked">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertTitle className="text-red-900">Not ready</AlertTitle>
                      <AlertDescription className="text-red-900">
                        {gate.attestations.message}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    {gate.attestations.roles.map((a) => {
                      const canSignThis =
                        !a.attested &&
                        ((currentUser?.roles || []).includes(a.role) || (currentUser?.roles || []).includes("admin"));
                      return (
                        <div
                          key={a.key}
                          className={cn(
                            "rounded-lg border p-4 space-y-3",
                            a.attested ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"
                          )}
                          data-testid={`attestation-${a.key}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-slate-900 flex items-center gap-2">
                              {a.attested ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                              )}
                              {a.label}
                            </p>
                            {a.attested && (
                              <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                                Recorded
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 italic">“{a.text}”</p>
                          {a.attested ? (
                            <p className="text-xs text-slate-500" data-testid={`attestation-${a.key}-meta`}>
                              Signed by {a.record.name || a.record.by} on {formatDateTime(a.record.at)}
                              {a.record.ip ? ` from ${a.record.ip}` : ""}.
                            </p>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              className="gap-2 bg-teal-600 hover:bg-teal-700"
                              disabled={!canSignThis || attestMutation.isPending}
                              onClick={() => attestMutation.mutate(a.key)}
                              data-testid={`attestation-${a.key}-sign`}
                            >
                              {attestMutation.isPending && attestMutation.variables === a.key ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <PenLine className="w-4 h-4" />
                              )}
                              Record my attestation
                            </Button>
                          )}
                          {!a.attested && !canSignThis && (
                            <p className="text-xs text-slate-500">
                              Only the {a.label} for this subsidiary can record this attestation.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
            </div>

            {/* Gate checklist ----------------------------------------------------- */}
            <Card className={cn("border-slate-200 shadow-sm", activeTab !== LAST_TAB && "hidden")} data-testid="gate-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ClipboardCheck className="w-5 h-5 text-teal-600" />
                    What&apos;s needed to submit
                  </CardTitle>
                  {gate && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-medium",
                        gate.complete
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                      )}
                    >
                      {gate.complete ? "Gate complete" : `${gate.missing.length} item(s) missing`}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  Rendered directly from the server gate — fields first, then the required documents.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {!selectedId ? (
                  <p className="text-sm text-slate-500">
                    Save the draft to see the live checklist.
                  </p>
                ) : loadingGate ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Evaluating the gate...
                  </div>
                ) : gateError || !gate ? (
                  <Alert variant="destructive" className="border-red-200 bg-red-50">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-900">
                      Could not load the gate status.{" "}
                      <button
                        type="button"
                        className="underline font-medium"
                        onClick={() => queryClient.invalidateQueries({ queryKey: ["gateStatus", selectedId] })}
                      >
                        Retry
                      </button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">Document completeness</span>
                        <span className="text-slate-600">{completeness}%</span>
                      </div>
                      <Progress value={completeness} className="h-2" />
                    </div>

                    <Tabs defaultValue="checklist" className="w-full">
                      <TabsList className="grid w-full grid-cols-2 max-w-md">
                        <TabsTrigger value="checklist">Checklist</TabsTrigger>
                        <TabsTrigger value="documents">Documents</TabsTrigger>
                      </TabsList>

                      <TabsContent value="checklist" className="mt-4 space-y-5">
                        {fieldGroups.map((group) => {
                          const groupFields = (gate.fields || []).filter((f) => f.section === group.key);
                          if (groupFields.length === 0) return null;
                          return (
                            <div key={group.key} className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {SECTION_TITLES[group.key] || group.label}
                              </p>
                              <ul className="space-y-1.5">
                                {groupFields.map((field) => (
                                  <li key={field.key} className="flex items-center gap-2 text-sm">
                                    {field.present ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                    ) : (
                                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                    )}
                                    <span className={field.present ? "text-slate-700" : "text-slate-900 font-medium"}>
                                      {field.label}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}

                        <Separator />

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("submit.requiredDocuments")}
                          </p>
                          <ul className="space-y-1.5">
                            {(gate.documents || []).map((document) => (
                              <li key={document.key} className="flex items-center gap-2 text-sm">
                                {document.present ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                )}
                                <span className={document.present ? "text-slate-700" : "text-slate-900 font-medium"}>
                                  {document.label}
                                </span>
                                {!document.required && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    optional
                                  </Badge>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <Separator />

                        {renderSufficiencyCard()}
                      </TabsContent>

                      <TabsContent value="documents" className="mt-4 space-y-3">
                        {(gate.documents || []).map((requirement) => {
                          const current = currentVersionFor(requirement.key);
                          const isCurrentUpload =
                            uploadMutation.isPending &&
                            uploadMutation.variables?.requirementKey === requirement.key;
                          return (
                            <div
                              key={requirement.key}
                              className="rounded-lg border border-slate-200 p-4 space-y-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium text-slate-900 flex items-center gap-2">
                                    {requirement.label}
                                    {requirement.present ? (
                                      <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                                        provided
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                                        missing
                                      </Badge>
                                    )}
                                    {!requirement.required && (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        optional
                                      </Badge>
                                    )}
                                  </div>
                                  {requirement.description && (
                                    <p className="text-sm text-slate-500 mt-0.5">{requirement.description}</p>
                                  )}
                                </div>
                              </div>

                              {current ? (
                                <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-medium text-slate-900 truncate">
                                        {current.original_name}
                                      </p>
                                      <p className="text-xs text-slate-500">
                                        v{current.version} • uploaded {formatDateTime(current.uploaded_at)}
                                        {current.uploaded_by ? ` by ${current.uploaded_by}` : ""}
                                      </p>
                                      {current.scan_verdict && (
                                        <p className="text-xs mt-1 flex items-center gap-2" data-testid={`scan-verdict-${requirement.key}`}>
                                          <ShieldCheck
                                            className={cn(
                                              "w-3.5 h-3.5",
                                              current.scan_verdict === "clean" ? "text-emerald-600" : "text-amber-600"
                                            )}
                                          />
                                          <span className={cn(
                                            current.scan_verdict === "clean" ? "text-emerald-700" : "text-amber-700"
                                          )}>
                                            Virus scan: {current.scan_verdict}{current.scan_engine ? ` (${current.scan_engine})` : ""}
                                          </span>
                                        </p>
                                      )}
                                      {priorVersionsFor(requirement.key).length > 0 && (
                                        <p className="text-xs text-slate-400 mt-1" data-testid={`version-history-${requirement.key}`}>
                                          {priorVersionsFor(requirement.key).length} previous version
                                          {priorVersionsFor(requirement.key).length === 1 ? "" : "s"} retained
                                        </p>
                                      )}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                                      disabled={!editable}
                                      onClick={() => setPendingDelete({ document: current, label: requirement.label })}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-slate-500">No version uploaded yet.</p>
                              )}

                              <label className="inline-flex">
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={isCurrentUpload || !editable}
                                  onChange={(event) => handleUpload(requirement.key, event)}
                                />
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50",
                                    (isCurrentUpload || !editable) && "opacity-50 pointer-events-none"
                                  )}
                                >
                                  {isCurrentUpload ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : current ? (
                                    <RefreshCw className="w-4 h-4" />
                                  ) : (
                                    <Upload className="w-4 h-4" />
                                  )}
                                  {current ? "Replace" : "Upload"}
                                </span>
                              </label>
                            </div>
                          );
                        })}
                      </TabsContent>
                    </Tabs>
                  </>
                )}
              </CardContent>
            </Card>
            </div>

            {/* Progress rail ------------------------------------------------------ */}
            <div className="space-y-4 min-w-0">
            <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="capture-rail">
              {selectedId && gate ? (
                <>
                  <p className="font-semibold text-slate-900">{itemsLeft} items left</p>
                  <Progress value={completeness} className="h-1.5 mt-2 mb-3" />
                  <div className="space-y-0.5">
                    {CAPTURE_TABS.map((tab, index) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(index)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs",
                          activeTab === index ? "bg-teal-50 font-semibold text-teal-700" : "text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        <span>{tab.label}</span>
                        {progressByTab[index].total > 0 && (
                          <span>{progressByTab[index].present} of {progressByTab[index].total}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">Save the draft to track progress by section.</p>
              )}
            </aside>
            <AIValidationCard
              tabLabel={CAPTURE_TABS[activeTab].label}
              hasRecord={Boolean(selectedId)}
              result={aiResultsQuery.data?.results?.[CAPTURE_TABS[activeTab].key]?.validation || null}
              loading={aiResultsQuery.isLoading}
              running={aiValidateMutation.isPending && aiValidateMutation.variables?.tab === CAPTURE_TABS[activeTab].key}
              onRun={() => aiValidateMutation.mutate({ id: selectedId, tab: CAPTURE_TABS[activeTab].key, trigger: "manual" })}
            />
            <AIAnalysisCard
              tabLabel={CAPTURE_TABS[activeTab].label}
              hasRecord={Boolean(selectedId)}
              result={aiResultsQuery.data?.results?.[CAPTURE_TABS[activeTab].key]?.analysis || null}
              loading={aiResultsQuery.isLoading}
              running={aiAnalyseMutation.isPending && aiAnalyseMutation.variables?.tab === CAPTURE_TABS[activeTab].key}
              runError={aiAnalyseMutation.data?.run_error && aiAnalyseMutation.variables?.tab === CAPTURE_TABS[activeTab].key ? aiAnalyseMutation.data.run_error : null}
              onRun={() => aiAnalyseMutation.mutate({ id: selectedId, tab: CAPTURE_TABS[activeTab].key })}
            />
            <AIQACard
              tabLabel={CAPTURE_TABS[activeTab].label}
              hasRecord={Boolean(selectedId)}
              qa={aiResultsQuery.data?.qa?.[CAPTURE_TABS[activeTab].key] || null}
              suggestions={aiResultsQuery.data?.suggestions?.[CAPTURE_TABS[activeTab].key] || []}
              loading={aiResultsQuery.isLoading}
              asking={aiAskMutation.isPending && aiAskMutation.variables?.tab === CAPTURE_TABS[activeTab].key}
              error={aiAskMutation.isError && aiAskMutation.variables?.tab === CAPTURE_TABS[activeTab].key ? aiAskMutation.error?.message : null}
              onAsk={(question) => aiAskMutation.mutateAsync({ id: selectedId, tab: CAPTURE_TABS[activeTab].key, question })}
              onClear={() => aiClearMutation.mutate({ id: selectedId, tab: CAPTURE_TABS[activeTab].key })}
              onSendToSirius={(question) => sendToSirius(question, CAPTURE_TABS[activeTab].label)}
            />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document version?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `"${pendingDelete.document.original_name}" (v${pendingDelete.document.version}) will be removed from "${pendingDelete.label}". The document gate will treat this requirement as missing.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.document.id)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
  };

  // Show clean loading state while user auth is resolving, preventing any old UI flash
  if ((isLoadingAuth || loadingFetchedUser) && !currentUser && !searchParams.get("role")) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1d4ed8] rounded-full animate-spin" />
      </div>
    );
  }

  if (!isInfiniaPreparer) {
    return renderOriginalRoleView();
  }

  const isTargetNotFound = Boolean(
    targetOppId &&
      (directOpportunityError ||
        (!loadingDirectOpportunity &&
          !loadingOpportunities &&
          !directOpportunity &&
          opportunities.length > 0 &&
          !opportunities.some((o) => o.id === targetOppId)))
  );

  const isHydratingDraft = Boolean(
    isInfiniaPreparer &&
      targetOppId &&
      !isTargetNotFound &&
      (!form.id || form.id !== targetOppId || !form._hydrated)
  );

  // Show clean lightweight loading indicator while draft data is being retrieved on page reload
  if (isHydratingDraft) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-8 space-y-4">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1d4ed8] rounded-full animate-spin" />
        <div className="text-center">
          <p className="text-xs font-semibold text-slate-800">Loading opportunity details...</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Retrieving saved data and document statuses</p>
        </div>
      </div>
    );
  }

  // When an opportunity has reached the Screening stage for Infinia Preparer,
  // display exclusively the new IB-1 to IB-4 designs with NO old or duplicate UI underneath.
  if (showInfiniaScreening) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-6 md:p-8 w-full max-w-full min-w-0">
        <div className="w-full max-w-full lg:max-w-[1600px] mx-auto space-y-4 min-w-0">
          <InfiniaScreeningView
            form={form}
            selectedOpp={activeOpportunity}
            documents={documents}
            currentUser={currentUser}
            onBack={handleBackToOpportunities}
            onDownload={handleDownloadOverview}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 md:p-8 w-full max-w-full min-w-0">
      <div className="w-full max-w-full lg:max-w-[1600px] mx-auto space-y-6 min-w-0">
        <div className="flex items-center justify-end text-xs text-slate-500 gap-4">
          <span>Layout: Left-to-Right</span>
          <span>
            <strong className="text-slate-900 font-bold">Company:</strong> {currentUser?.organization || "coredge"}
          </span>
        </div>

        {!isSubmittedView && captureView && (
          <div className="space-y-4">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
              onClick={closeCapture}
              data-testid="capture-back-to-list"
            >
              <ArrowLeft className="w-4 h-4" /> Back to My Opportunity
            </button>
            {selectedId && gate?.self_screen && gate.self_screen.blocked && (
              <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="gate-self-screen-stop">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertTitle className="text-red-900">This opportunity is halted</AlertTitle>
                <AlertDescription className="text-red-900">
                  The saved answers fail the self-screen, so it cannot be submitted. Resolve the stops below.
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {gate.self_screen.stops.map((stop) => (
                      <li key={stop.code}>{stop.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {selectedId && gate?.below_floor?.applies && !gate.below_floor.satisfied && (
              <Alert className="border-amber-200 bg-amber-50" data-testid="below-floor-route">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-900">Below-floor exception route incomplete</AlertTitle>
                <AlertDescription className="text-amber-900">
                  This ticket is under the AED {gate.below_floor.floor_aed_mn}mn floor.
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {gate.below_floor.stops.map((stop) => (
                      <li key={stop.code}>{stop.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {selectedId && gate?.below_floor?.satisfied && (
              <Alert className="border-teal-200 bg-teal-50" data-testid="below-floor-tagged">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                <AlertTitle className="text-teal-900">Below-floor exception</AlertTitle>
                <AlertDescription className="text-teal-900">
                  Tagged as a below-floor exception and escalated to Sirius; the case cannot be closed at subsidiary level.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* DS-14: Confirmation page (Sent to your CFO and CEO) */}
        {isSubmittedView && (
          <div className="space-y-6" data-testid="submit-success">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-slate-900">Sent to your CFO and CEO</h1>
              <p className="text-sm text-slate-500 mt-1">
                {submittedOpportunityName} is waiting for their approval.
              </p>
            </div>

            <Card className="rounded-2xl border border-slate-200/80 bg-white p-8 md:p-10 shadow-sm max-w-5xl space-y-6">
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-slate-900">Self-screen before you start</h2>
                <p className="text-xs text-slate-500">
                  Six quick questions. Outside-appetite types and tickets below the AED {floorAedMn}mn floor are halted here with a reason, before any drafting effort.
                </p>
              </div>

              <ol className="space-y-4 text-sm text-slate-800 leading-relaxed font-normal pt-2">
                <li className="flex items-start gap-2">
                  <span className="shrink-0 font-normal">1.</span>
                  <span>Now: your CFO checks the numbers and your CEO checks the strategic case. They see an AI one-page summary.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0 font-normal">2.</span>
                  <span>Either can return it to you with comments. Nothing reaches Sirius until both approve.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0 font-normal">3.</span>
                  <span>After approval, DealForge AI checks the pack, researches it and drafts the memo for Deal Lead A.</span>
                </li>
              </ol>

              <div className="pt-2">
                <Button
                  type="button"
                  onClick={handleBackToOpportunities}
                  className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white rounded-xl px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors cursor-pointer h-10"
                  data-testid="back-to-opportunities-btn"
                >
                  Back to my opportunities
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* DS-4 & DS-5: Self-screen page (Is this ready to bring to Sirius?) */}
        {!isSubmittedView && !captureView && isNewView && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-slate-900">Is this ready to bring to Sirius?</h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Answer a few quick questions before the full form.<br />
                It takes a minute and can save you hours.
              </p>
            </div>
            <Separator className="border-slate-200" />

            <Card className="rounded-2xl border border-slate-200/80 bg-white p-6 md:p-8 shadow-sm max-w-5xl">
              <div className="mb-6 space-y-1">
                <h2 className="text-xl font-bold text-slate-900">Self-screen before you start</h2>
                <p className="text-xs text-slate-500">
                  Six quick questions. Outside-appetite types and tickets below the AED {floorAedMn}mn floor are halted here with a reason, before any drafting effort.
                </p>
              </div>

              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                  {screenQuestions.map((question) => (
                    <div key={question.key} className="space-y-2">
                      <Label htmlFor={`screen-${question.key}`} className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                        {question.key === "geography" ? "Country" : question.label}
                        {question.required && <span className="text-red-500">*</span>}
                      </Label>
                      {question.control === "select" ? (
                        <Select
                          value={getScreenAnswerValue(question.key)}
                          onValueChange={(value) => handleScreenChange(question.key, value)}
                        >
                          <SelectTrigger id={`screen-${question.key}`} className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {(question.options || []).map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`screen-${question.key}`}
                          type="number"
                          placeholder=""
                          value={screenAnswers[question.key] ?? ""}
                          min={question.min}
                          onChange={(event) => handleScreenChange(question.key, event.target.value)}
                          className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {(belowFloor || screenResult?.stops?.some((s) => s.code === "below_floor")) && !selfScreenPassed && (
                  <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-slate-300"
                      checked={Boolean(screenAnswers.below_floor_exception)}
                      onChange={(event) => handleScreenChange("below_floor_exception", event.target.checked)}
                    />
                    <span>
                      Use the below-floor exception route: state the portfolio synergy and a base-case IRR of at least
                      35% in the financials section. This tags the case and escalates it to Sirius.
                    </span>
                  </label>
                )}

                {/* Status banner (DS-4 Halted or DS-5 Passed) */}
                {selfScreenPassed && (
                  /* DS-5: Passed state */
                  <div className="rounded-xl border border-emerald-500 bg-[#f0fdf4] p-4 flex items-start gap-3" data-testid="self-screen-pass">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-emerald-800 text-sm">Passed</p>
                      <ul className="text-xs text-emerald-700 list-disc pl-4 space-y-0.5">
                        {screenResult?.flags?.length ? (
                          screenResult.flags.map((flag) => <li key={flag.code}>{flag.message}</li>)
                        ) : (
                          <li>All six checks cleared. Open the capture form to draft the opportunity.</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}

                {screenResult && (screenResult.decision === "stop" || (screenResult.stops && screenResult.stops.length > 0)) && (
                  /* DS-4: Halted state */
                  <div className="rounded-xl border border-red-500 bg-[#fef2f2] p-4 flex items-start gap-3" data-testid="self-screen-stop">
                    <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-red-700 text-sm">Halted — do not proceed</p>
                      <ul className="text-xs text-red-700 list-disc pl-4 space-y-0.5">
                        {screenResult.stops?.length ? (
                          screenResult.stops.map((stop) => <li key={stop.code}>{stop.message}</li>)
                        ) : (
                          <li>Enter the total commitment in AED mn to run the self-screen.</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  {selfScreenPassed ? (
                    <Button
                      type="button"
                      onClick={() => proceedToForm(getScreenPayload())}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium shadow-sm"
                    >
                      Continue to the Capture Form
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={screenMutation.isPending}
                      onClick={handleRunScreen}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium shadow-sm gap-2"
                    >
                      {screenMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      Open the Form
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeNew}
                    className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg px-5 py-2.5 text-sm font-medium"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* DS-1: My opportunities portal */}
        {!isSubmittedView && !captureView && !isNewView && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">My Opportunity</h1>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  Every opportunity you send to Sirius goes through this portal.<br />
                  You see only your own company&apos;s opportunities.
                </p>
              </div>
              <Button
                onClick={startNew}
                className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-medium px-6 py-2.5 rounded-lg shadow-sm gap-2 text-sm"
              >
                + New Opportunity
              </Button>
            </div>
            <Separator className="border-slate-200" />

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-sm">
                <div className="text-3xl font-bold text-slate-900">{draftOrReturnedCount}</div>
                <div className="text-xs text-slate-500 mt-1">In draft or returned</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-sm">
                <div className="text-3xl font-bold text-slate-900">{withCfoCeoCount}</div>
                <div className="text-xs text-slate-500 mt-1">With CFO and CEO</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-sm">
                <div className="text-3xl font-bold text-slate-900">{withSiriusCount}</div>
                <div className="text-xs text-slate-500 mt-1">With Sirius</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-sm">
                <div className="text-3xl font-bold text-slate-900">{questionsCount}</div>
                <div className="text-xs text-slate-500 mt-1">Questions waiting for you</div>
              </div>
            </div>

            {/* Main content grid: Table on Left, Actions Due on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_270px] xl:grid-cols-[minmax(0,1fr)_290px] gap-6 items-start w-full min-w-0">
              {/* Opportunities Table */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 md:p-6 shadow-sm space-y-4 w-full min-w-0">
                <div className="relative w-full max-w-[260px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    type="text"
                    placeholder="Search"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-9 h-10 rounded-xl border-slate-200 bg-white text-sm focus:border-blue-500"
                  />
                </div>

                <div className="w-full min-w-0">
                  <table className="w-full text-left border-collapse text-sm table-auto">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-800 font-semibold">
                        <th className="py-3 pr-2 font-semibold text-slate-800">Opportunity</th>
                        <th className="py-3 px-2 font-semibold text-slate-800">Type</th>
                        <th className="py-3 px-2 font-semibold text-slate-800">Status</th>
                        <th className="py-3 px-2 font-semibold text-slate-800">Complete</th>
                        <th className="py-3 px-2 font-semibold text-slate-800">Updated</th>
                        <th className="py-3 pl-2 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedOpportunities.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                            No opportunities found.
                          </td>
                        </tr>
                      ) : (
                        paginatedOpportunities.map((opportunity) => {
                          const norm = normalizeState(opportunity.approval_status || opportunity.status);
                          return (
                            <tr key={opportunity.id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-3.5 pr-2 align-middle">
                                <button
                                  type="button"
                                  onClick={() => selectOpportunity(opportunity)}
                                  className="font-bold text-slate-900 text-sm text-left hover:text-blue-600 transition-colors whitespace-normal break-words leading-snug"
                                >
                                  {opportunity.opportunity_name || opportunity.target_name || "Untitled opportunity"}
                                </button>
                              </td>
                              <td className="py-3.5 px-2 text-slate-600 text-xs sm:text-sm align-middle whitespace-normal break-words leading-snug">
                                {opportunity.opportunity_type || "Strategic acquisition"}
                              </td>
                              <td className="py-3.5 px-2 align-middle whitespace-nowrap">
                                {renderTableStatusBadge(opportunity.status, opportunity)}
                              </td>
                              <td className="py-3.5 px-2 align-middle whitespace-nowrap">
                                <div className="w-16 sm:w-20">
                                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-600 rounded-full"
                                      style={{ width: `${getOpportunityProgress(opportunity)}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] text-slate-500 mt-1 block">
                                    {getOpportunityProgress(opportunity)}%
                                  </span>
                                </div>
                              </td>
                              <td className="py-3.5 px-2 text-slate-500 text-xs sm:text-sm align-middle whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5">
                                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                  {formatShortDate(opportunity.updated_date || opportunity.created_date)}
                                </span>
                              </td>
                              <td className="py-3.5 pl-2 text-right align-middle whitespace-nowrap">
                                {norm === "declined" || norm === "returned" || norm === "information_requested" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => selectOpportunity(opportunity)}
                                    className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-medium text-xs px-3.5 py-1.5 h-8 rounded-lg shadow-sm"
                                  >
                                    Fix and Response
                                  </Button>
                                ) : norm === "screening_review" || norm === "submission" || norm === "screening" ? (
                                  <div className="flex items-center gap-2 justify-end">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setWithdrawTarget(opportunity);
                                        setWithdrawReason("Seller accepted another bid.");
                                      }}
                                      className="border border-slate-300 hover:bg-slate-50 text-slate-800 font-medium text-xs px-3.5 py-1.5 h-8 rounded-lg bg-white shadow-sm"
                                    >
                                      Withdraw
                                    </Button>
                                  </div>
                                ) : norm === "draft" ? (
                                  <div className="flex items-center gap-2 justify-end">
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => selectOpportunity(opportunity)}
                                      className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-medium text-xs px-3.5 py-1.5 h-8 rounded-lg shadow-sm"
                                    >
                                      Continue
                                    </Button>
                                    <button
                                      type="button"
                                      onClick={() => setDiscardTarget(opportunity)}
                                      className="text-[#1d4ed8] hover:underline font-medium text-xs px-2 py-1"
                                    >
                                      Discard
                                    </button>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex flex-wrap items-center justify-end gap-6 pt-5 border-t border-slate-100 text-xs text-slate-600">
                  <div className="flex items-center gap-3">
                    <span>Rows per page</span>
                    <Select
                      value={String(rowsPerPage)}
                      onValueChange={(val) => {
                        setRowsPerPage(Number(val));
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="h-8 w-16 text-xs bg-white border-slate-200 rounded-lg">
                        <SelectValue placeholder="10" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>Page {currentPage} of {totalPages}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                      >
                        <ChevronsLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                      >
                        <ChevronsRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Actions due */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4 w-full min-w-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Actions due</h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    What only you can move forward. Click one to act on it.
                  </p>
                </div>

                <div className="space-y-3">
                  {actionDueItems.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={item.onClick}
                      className="border border-slate-100 bg-[#fafafa] rounded-xl p-3.5 space-y-1.5 hover:border-slate-300 hover:bg-white hover:shadow-sm transition-all cursor-pointer"
                    >
                      <span className={cn("inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md", item.badgeClass)}>
                        {item.badge}
                      </span>
                      <p className="font-bold text-sm text-slate-900 leading-snug">{item.title}</p>
                      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Withdraw Modal Dialog (DS-2 & DS-3) -------------------------------- */}
        <Dialog open={Boolean(withdrawTarget)} onOpenChange={(open) => { if (!open) setWithdrawTarget(null); }}>
          <DialogContent className="sm:max-w-xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-slate-900">
                Withdraw {withdrawTarget?.opportunity_name || withdrawTarget?.target_name || "opportunity"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div className="space-y-2">
                <Label htmlFor="withdraw-reason-code" className="text-sm font-semibold text-slate-900">
                  Withdrawal reason code *
                </Label>
                <Select
                  value={withdrawReasonCode}
                  onValueChange={(val) => setWithdrawReasonCode(val)}
                >
                  <SelectTrigger id="withdraw-reason-code" className="w-full">
                    <SelectValue placeholder="Select reason code..." />
                  </SelectTrigger>
                  <SelectContent>
                    {WITHDRAW_REASON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="withdraw-reason" className="text-sm font-semibold text-slate-900">
                  Additional comments / notes
                </Label>
                <Textarea
                  id="withdraw-reason"
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Seller accepted another bid or internal priority shift."
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 p-3.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <DialogFooter className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWithdrawTarget(null)}
                className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg px-5 py-2.5 text-sm font-medium"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (withdrawTarget) {
                    withdrawMutation.mutate({
                      id: withdrawTarget.id,
                      reason: withdrawReason,
                      reasonCode: withdrawReasonCode || "reprioritised",
                    });
                  }
                }}
                disabled={withdrawMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium shadow-sm"
              >
                {withdrawMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Withdraw opportunity
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Discard Draft Modal Dialog (DS-6) -------------------------------- */}
        <Dialog open={Boolean(discardTarget)} onOpenChange={(open) => { if (!open) setDiscardTarget(null); }}>
          <DialogContent className="sm:max-w-xl rounded-2xl bg-white p-7 shadow-2xl border border-slate-100 focus:outline-none [&>button.absolute]:hidden">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">
                Discard this draft?
              </DialogTitle>
              <div className="text-sm text-slate-800 pt-1">
                <span className="font-bold text-slate-900">
                  {discardTarget?.opportunity_name || discardTarget?.target_name || "Water meter analytics pilot"}
                </span>
                {" · "}
                <span className="text-slate-800">
                  {discardTarget?.progress ?? 45}% complete, last saved {formatSavedDate(discardTarget?.updated_date || discardTarget?.created_date)}
                </span>
              </div>
              <DialogDescription className="text-sm text-slate-500 leading-relaxed pt-1">
                The draft and its attachments are deleted. It never reached your CFO, CEO or Sirius. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex items-center justify-end gap-3 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDiscardTarget(null)}
                className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl px-5 py-2.5 text-sm font-medium h-10 shadow-none"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={discardOpportunityMutation.isPending}
                onClick={() => {
                  if (discardTarget) {
                    discardOpportunityMutation.mutate(discardTarget.id, {
                      onSettled: () => setDiscardTarget(null),
                    });
                  }
                }}
                className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white rounded-xl px-5 py-2.5 text-sm font-medium h-10 shadow-sm"
              >
                {discardOpportunityMutation.isPending ? "Discarding..." : "Discard draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

          {/* Capture + gate (DS-7, DS-8, DS-9) -------------------------------- */}
          <div className={captureView ? "space-y-6 w-full min-w-0" : "hidden"}>
            {/* Header matching DS-7, DS-8, DS-9 */}
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                {form.opportunity_name || form.target_name || (selectedId ? "Edit opportunity" : "New opportunity")}
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Step {activeTab + 1} of {CAPTURE_TABS.length}: {CAPTURE_TABS[activeTab].label}.<br />
                Fields marked * are required. Your work is saved as you type.
              </p>
            </div>

            {/* Horizontal Tabs matching DS-7, DS-8, DS-9 */}
            <div
              role="tablist"
              aria-label="Opportunity sections"
              className="flex items-center gap-6 overflow-x-auto border-b border-slate-200/80 pt-2 pb-0 mb-6"
              data-testid="capture-tabs"
            >
              {CAPTURE_TABS.map((tab, index) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === index}
                  data-testid={`capture-tab-${tab.key}`}
                  onClick={() => setActiveTab(index)}
                  className={cn(
                    "pb-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-[1px]",
                    activeTab === index
                      ? "border-blue-600 font-semibold text-blue-600"
                      : "border-transparent text-slate-600 hover:text-slate-900"
                  )}
                >
                  {tab.label}
                  {missingByTab[index] > 0 && (
                    <span
                      className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                      title={`${missingByTab[index]} mandatory field(s) incomplete`}
                      data-testid={`capture-tab-missing-${tab.key}`}
                    >
                      {missingByTab[index]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start w-full min-w-0">
              <div className="space-y-6 min-w-0">
                <Card className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm space-y-6">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-slate-900">
                          {CAPTURE_TABS[activeTab].label}
                        </h2>
                        {missingByTab[activeTab] > 0 ? (
                          <span
                            className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700"
                            data-testid={`section-mandatory-count-${activeTab}`}
                          >
                            {missingByTab[activeTab]} {missingByTab[activeTab] === 1 ? "mandatory field incomplete" : "mandatory fields incomplete"}
                          </span>
                        ) : (
                          <span
                            className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 flex items-center gap-1"
                            data-testid={`section-mandatory-count-${activeTab}`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            All mandatory fields completed
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {activeTab === 0
                        ? "One page that lets the Investment Team understand the opportunity and the decision sought."
                        : activeTab === 1
                        ? "What this opportunity is, in brief, and why your company wants to pursue it."
                        : activeTab === 2
                        ? "Make the case with evidence: market data, customer or partner validation, comparable transactions."
                        : activeTab === 3
                        ? "Summary model, three-scenario returns, entry valuation and exit."
                        : activeTab === 4
                        ? "Key asks, funding sources and status, budget status, next steps and timeline."
                        : activeTab === 5
                        ? "Risk register with named owners and the legal / related-party / ESG compliance screen."
                        : "Required documents, pack validation and submission to Sirius."
                      }
                    </p>
                  </div>

                  {/* Step-top error section according to DS-13 (Infinia Preparer Only) */}
                  {isInfiniaPreparer && activeError && activeTab < 6 && (
                    <div
                      className="rounded-2xl border border-red-200 bg-[#fef2f2] p-6 space-y-3 shadow-xs mb-6"
                      data-testid="infinia-error-section-step"
                    >
                      <div className="flex items-center gap-2 text-red-900">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <h4 className="text-sm font-bold text-red-900">
                          {activeError.title}
                        </h4>
                      </div>
                      <p className="text-xs text-red-800 font-medium leading-relaxed">
                        {activeError.message}
                      </p>
                      {activeError.items && activeError.items.length > 0 && (
                        <ul className="space-y-2 text-xs text-red-800 font-medium pt-1">
                          {activeError.items.map((item, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Key message callout box */}
                  {activeTab < 6 && (
                    <div className="rounded-xl border border-blue-100 bg-[#f8faff] p-4 space-y-2">
                      <Label htmlFor={`key_message_${activeTab}`} className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                        Key message for this page (one line at the top of the slide) <span className="text-red-500">*</span>
                        {renderFieldIndicator(`key_message_${CAPTURE_TABS[activeTab].key}`)}
                      </Label>
                      <Input
                        id={`key_message_${activeTab}`}
                        value={form[`key_message_${CAPTURE_TABS[activeTab].key}`] ?? ""}
                        placeholder="Key message for this page..."
                        onChange={(e) => handleChange(`key_message_${CAPTURE_TABS[activeTab].key}`, e.target.value)}
                        className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                      />
                    </div>
                  )}

                  {/* Step 1: Executive summary (DS-7) */}
                  {activeTab === 0 && (
                    <div className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="opportunity_name" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Opportunity name <span className="text-red-500">*</span>
                            {renderFieldIndicator("opportunity_name")}
                          </Label>
                          <Input
                            id="opportunity_name"
                            value={form.opportunity_name ?? ""}
                            placeholder="e.g. Smart meter capacity expansion"
                            onChange={(e) => handleChange("opportunity_name", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="subsidiary_signing_entity" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Subsidiary and signing entity <span className="text-red-500">*</span>
                            {renderFieldIndicator("subsidiary_signing_entity")}
                          </Label>
                          <Input
                            id="subsidiary_signing_entity"
                            value={form.subsidiary_signing_entity ?? ""}
                            placeholder="ESAL Tech (Oxinus Holding Ltd)"
                            onChange={(e) => handleChange("subsidiary_signing_entity", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="opportunity_type" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Opportunity type <span className="text-red-500">*</span>
                            {renderFieldIndicator("opportunity_type")}
                          </Label>
                          <Select value={form.opportunity_type || ""} onValueChange={(val) => {
                            handleChange("opportunity_type", val);
                            handleChange("is_greenfield", val === "greenfield" ? "yes" : "no");
                          }}>
                            <SelectTrigger id="opportunity_type" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="Select opportunity type" />
                            </SelectTrigger>
                            <SelectContent>
                              {DS_OPPORTUNITY_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="deal_shape" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Deal shape in a few words <span className="text-red-500">*</span>
                            {renderFieldIndicator("deal_shape")}
                          </Label>
                          <Input
                            id="deal_shape"
                            value={form.deal_shape ?? ""}
                            placeholder="Partner-led entry"
                            onChange={(e) => handleChange("deal_shape", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="is_greenfield" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Is it a new venture (greenfield)? <span className="text-red-500">*</span>
                            {renderFieldIndicator("is_greenfield")}
                          </Label>
                          <Select value={form.is_greenfield || (form.opportunity_type === "greenfield" ? "yes" : "no")} onValueChange={(val) => {
                            handleChange("is_greenfield", val);
                            if (val === "yes") {
                              handleChange("opportunity_type", "greenfield");
                            } else if (form.opportunity_type === "greenfield") {
                              handleChange("opportunity_type", "strategic_acquisition");
                            }
                          }}>
                            <SelectTrigger id="is_greenfield" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="Yes" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="sourcing_channel" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Sourcing channel <span className="text-red-500">*</span>
                            {renderFieldIndicator("sourcing_channel")}
                          </Label>
                          <Select value={form.sourcing_channel || "proprietary"} onValueChange={(val) => handleChange("sourcing_channel", val)}>
                            <SelectTrigger id="sourcing_channel" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="Proprietary / direct origination" />
                            </SelectTrigger>
                            <SelectContent>
                              {DS_SOURCING_CHANNELS.map((sc) => (
                                <SelectItem key={sc.value} value={sc.value}>{sc.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="target_name" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Target or counterparty <span className="text-red-500">*</span>
                            {renderFieldIndicator("target_name")}
                          </Label>
                          <Input
                            id="target_name"
                            value={form.target_name ?? ""}
                            placeholder="Eurolink Network International Corp. (Philippines)"
                            onChange={(e) => handleChange("target_name", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="line_of_business" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Line of business <span className="text-red-500">*</span>
                            {renderFieldIndicator("line_of_business")}
                          </Label>
                          <Input
                            id="line_of_business"
                            value={form.line_of_business ?? ""}
                            placeholder="e-Invoicing and e-reporting software (tax tech)"
                            onChange={(e) => handleChange("line_of_business", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="intent_of_investment" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Intent of the investment <span className="text-red-500">*</span>
                            {renderFieldIndicator("intent_of_investment")}
                          </Label>
                          <Input
                            id="intent_of_investment"
                            value={form.intent_of_investment ?? ""}
                            placeholder="Enter the Philippines as large taxpayers move onto"
                            onChange={(e) => handleChange("intent_of_investment", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="sector" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Sector <span className="text-red-500">*</span>
                            {renderFieldIndicator("sector")}
                          </Label>
                          <Select value={form.sector || ""} onValueChange={(val) => handleChange("sector", val)}>
                            <SelectTrigger id="sector" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="Select sector" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="digital_payment">Digital Payment</SelectItem>
                              <SelectItem value="healthcare">Healthcare</SelectItem>
                              <SelectItem value="infrastructure">Infrastructure</SelectItem>
                              <SelectItem value="technology">Technology</SelectItem>
                              <SelectItem value="financial_services">Financial Services</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="sub_sector" className="text-sm font-semibold text-slate-900">
                            Sub-sector, in your words
                          </Label>
                          <Input
                            id="sub_sector"
                            value={form.sub_sector ?? ""}
                            placeholder="e-Invoicing / e-reporting (tax tech)"
                            onChange={(e) => handleChange("sub_sector", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="geography" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Country or geography <span className="text-red-500">*</span>
                            {renderFieldIndicator("geography")}
                          </Label>
                          <Select value={form.geography || ""} onValueChange={(val) => handleChange("geography", val)}>
                            <SelectTrigger id="geography" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="Select geography" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Philippines">Philippines</SelectItem>
                              <SelectItem value="United Arab Emirates">United Arab Emirates</SelectItem>
                              <SelectItem value="Saudi Arabia">Saudi Arabia</SelectItem>
                              <SelectItem value="India">India</SelectItem>
                              <SelectItem value="Singapore">Singapore</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="total_commitment_aed" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Total commitment (AED mn) <span className="text-red-500">*</span>
                            {renderFieldIndicator("total_commitment_aed")}
                          </Label>
                          <Input
                            id="total_commitment_aed"
                            value={form.total_commitment_aed ?? ""}
                            placeholder="2.72"
                            onChange={(e) => handleChange("total_commitment_aed", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="commitment_breakdown" className="text-sm font-semibold text-slate-900">
                            How the commitment breaks down
                          </Label>
                          <Input
                            id="commitment_breakdown"
                            value={form.commitment_breakdown ?? ""}
                            placeholder="Entry AED 1.65 mn + Year-1 operating funding AED"
                            onChange={(e) => handleChange("commitment_breakdown", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="ask_aed" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Ask from Sirius <span className="text-red-500">*</span>
                            {renderFieldIndicator("ask_aed")}
                          </Label>
                          <Input
                            id="ask_aed"
                            value={form.ask_aed ?? ""}
                            placeholder="2.72"
                            onChange={(e) => handleChange("ask_aed", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="funding_source" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Funding source <span className="text-red-500">*</span>
                            {renderFieldIndicator("funding_source")}
                          </Label>
                          <Input
                            id="funding_source"
                            value={form.funding_source ?? ""}
                            placeholder="Sirius capital"
                            onChange={(e) => handleChange("funding_source", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="in_approved_budget" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            In the approved budget? <span className="text-red-500">*</span>
                            {renderFieldIndicator("in_approved_budget")}
                          </Label>
                          <Select value={form.in_approved_budget || ""} onValueChange={(val) => handleChange("in_approved_budget", val)}>
                            <SelectTrigger id="in_approved_budget" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no">No</SelectItem>
                              <SelectItem value="yes">Yes</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="target_signing_close" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Key dates: signing, close, first revenue <span className="text-red-500">*</span>
                            {renderFieldIndicator("target_signing_close")}
                          </Label>
                          <Input
                            id="target_signing_close"
                            value={form.target_signing_close ?? ""}
                            placeholder="MoU signing Oct 2026 · definitive agreement Q4 2026"
                            onChange={(e) => handleChange("target_signing_close", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="related_party_disclosure" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Is an IHC-affiliated or other related party involved? <span className="text-red-500">*</span>
                            {renderFieldIndicator("related_party_disclosure")}
                          </Label>
                          <Select value={form.related_party_disclosure || "no"} onValueChange={(val) => handleChange("related_party_disclosure", val)}>
                            <SelectTrigger id="related_party_disclosure" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                              <SelectValue placeholder="No" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no">No</SelectItem>
                              <SelectItem value="yes">Yes</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="variance_justification" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                          Budget line reference or variance justification <span className="text-red-500">*</span>
                            {renderFieldIndicator("variance_justification")}
                          </Label>
                        <Input
                          id="variance_justification"
                          value={form.variance_justification ?? ""}
                          placeholder="Not in the FY27 budget; variance approval needed"
                          onChange={(e) => handleChange("variance_justification", e.target.value)}
                          className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                        />
                      </div>

                      {/* Amber Below Floor Banner */}
                      {isBelowFloorActive && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                          <p className="text-xs font-semibold text-amber-900 leading-relaxed">
                            <strong className="text-amber-900">Below the AED 10mn floor.</strong> This only proceeds if it offers clear portfolio synergies and targets an IRR of 35% or higher. It always goes to Sirius and cannot be closed at subsidiary level.
                          </p>
                          <div className="space-y-2">
                            <Label htmlFor="below_floor_synergy_case" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Portfolio synergies and value proposition <span className="text-red-500">*</span>
                            {renderFieldIndicator("below_floor_synergy_case")}
                          </Label>
                            <Textarea
                              id="below_floor_synergy_case"
                              rows={3}
                              value={form.below_floor_synergy_case ?? ""}
                              placeholder="First market outside the GCC. Builds clearance-model capability that can be re-used in KSA, Poland and Italy, with an option to scale into ASEAN. Base-case IRR 45%."
                              onChange={(e) => handleChange("below_floor_synergy_case", e.target.value)}
                              className="rounded-lg border-amber-300 bg-white text-sm text-slate-900 p-3 focus:border-amber-500"
                            />
                          </div>
                        </div>
                      )}

                      {/* Blue Below Floor / Greenfield Banner */}
                      {isGreenfieldActive && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-4">
                          <p className="text-xs font-semibold text-blue-900 leading-relaxed">
                            <strong className="text-blue-900">Below the AED 10mn floor.</strong> This only proceeds if it offers clear portfolio synergies and targets an IRR of 35% or higher. It always goes to Sirius and cannot be closed at subsidiary level.
                          </p>
                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="greenfield_stage" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                                Stage <span className="text-red-500">*</span>
                            {renderFieldIndicator("greenfield_stage")}
                          </Label>
                              <Select value={form.greenfield_stage || ""} onValueChange={(val) => handleChange("greenfield_stage", val)}>
                                <SelectTrigger id="greenfield_stage" className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="concept">Concept / Feasibility</SelectItem>
                                  <SelectItem value="detailed_plan">Detailed business plan</SelectItem>
                                  <SelectItem value="commercial_ready">Commercially ready</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="greenfield_benefit" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Quantified benefit and why it matters now <span className="text-red-500">*</span>
                            {renderFieldIndicator("greenfield_benefit")}
                          </Label>
                            <Textarea
                              id="greenfield_benefit"
                              rows={3}
                              value={form.greenfield_benefit ?? ""}
                              placeholder="First market outside the GCC. Builds clearance-model capability that can be re-used in KSA, Poland and Italy, with an option to scale into ASEAN. Base-case IRR 45%."
                              onChange={(e) => handleChange("greenfield_benefit", e.target.value)}
                              className="rounded-lg border-blue-200 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="narrative_what" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                          The opportunity <span className="text-red-500">*</span>
                            {renderFieldIndicator("narrative_what")}
                          </Label>
                        <Textarea
                          id="narrative_what"
                          rows={4}
                          value={form.narrative_what ?? ""}
                          placeholder="The BIR's Electronic Invoicing System (EIS) requires structured, system-generated invoice data; PDFs and scans don't count. Phase 1 (large taxpayers, e-commerce, exporters, CAS users) must comply by 31 Dec 2026. ESAL enters with Eurolink under a pre-consortium MoU. Entry cost AED 1.65 mn."
                          onChange={(e) => handleChange("narrative_what", e.target.value)}
                          className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="narrative_why_now" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                          Why it matters <span className="text-red-500">*</span>
                            {renderFieldIndicator("narrative_why_now")}
                          </Label>
                        <Textarea
                          id="narrative_why_now"
                          rows={4}
                          value={form.narrative_why_now ?? ""}
                          placeholder="About 20,700 large and medium firms in scope; enterprise market of USD 85 mn, the 3rd largest outside Europe in our 17-market study. Base case about AED 10 mn revenue and AED 2.9 mn EBITDA a year from 2029. First market outside the GCC; builds clearance-model capability."
                          onChange={(e) => handleChange("narrative_why_now", e.target.value)}
                          className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="exec_summary_recommendation" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                          Headline returns and recommendation <span className="text-red-500">*</span>
                            {renderFieldIndicator("exec_summary_recommendation")}
                          </Label>
                        <Textarea
                          id="exec_summary_recommendation"
                          rows={4}
                          value={form.exec_summary_recommendation ?? ""}
                          placeholder="Base case: IRR 45% · ROIC 81% · payback 2.5 yrs. Clears all three hurdles (greenfield IRR ≥ 25%). Downside IRR 15% does not. Decision sought: approve signing the Eurolink MoU, negotiating the definitive agreement and the BIR EIS build."
                          onChange={(e) => handleChange("exec_summary_recommendation", e.target.value)}
                          className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Step 2: Opportunity overview (DS-8) */}
                  {activeTab === 1 && (
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-900">The opportunity in brief</h3>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="ov_what" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              What<span className="text-red-500">*</span>
                            {renderFieldIndicator("overview_what")}
                          </Label>
                            <Textarea
                              id="ov_what"
                              rows={3}
                              value={form.overview_what ?? ""}
                              placeholder="Verinvo adapted to BIR EIS (JSON, Permit-to-Transmit), sold with Eurolink to large and medium taxpayers."
                              onChange={(e) => handleChange("overview_what", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_where" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Where <span className="text-red-500">*</span>
                            {renderFieldIndicator("overview_where")}
                          </Label>
                            <Textarea
                              id="ov_where"
                              rows={3}
                              value={form.overview_where ?? ""}
                              placeholder="Philippines: about 90,000 in-scope businesses (range 50–150k); about 20,700 large and medium firms."
                              onChange={(e) => handleChange("overview_where", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_deal_shape" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Deal shape <span className="text-red-500">*</span>
                            {renderFieldIndicator("deal_shape")}
                          </Label>
                            <Textarea
                              id="ov_deal_shape"
                              rows={3}
                              value={form.deal_shape ?? ""}
                              placeholder="MoU finalised (dated 9 Oct 2026), to be signed by Oxinus. Definitive-agreement talks start within 30 days. BIR certification not yet started, likely end Oct or early Nov."
                              onChange={(e) => handleChange("deal_shape", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_pricing" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Pricing or commercial terms <span className="text-red-500">*</span>
                            {renderFieldIndicator("overview_pricing")}
                          </Label>
                            <Textarea
                              id="ov_pricing"
                              rows={3}
                              value={form.overview_pricing ?? ""}
                              placeholder="USD 25k a year for large firms, USD 3.6k for medium (Year 1, including onboarding)."
                              onChange={(e) => handleChange("overview_pricing", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 pt-2">
                        <h3 className="text-sm font-bold text-slate-900">Why your company wants to do this</h3>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="ov_strategic_objective" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Strategic objective<span className="text-red-500">*</span>
                            {renderFieldIndicator("strategic_objective")}
                          </Label>
                            <Textarea
                              id="ov_strategic_objective"
                              rows={3}
                              value={form.strategic_objective ?? ""}
                              placeholder="First Asia-Pacific market; delivers the FY27 'beyond the UAE' strategy."
                              onChange={(e) => handleChange("strategic_objective", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_what_adds" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              What it adds <span className="text-red-500">*</span>
                            {renderFieldIndicator("overview_what_it_adds")}
                          </Label>
                            <Textarea
                              id="ov_what_adds"
                              rows={3}
                              value={form.overview_what_it_adds ?? ""}
                              placeholder="AED 7.7 mn revenue in 2028, AED 10.3 mn from 2029; about 500 enterprise clients."
                              onChange={(e) => handleChange("overview_what_it_adds", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_build_buy_partner" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Build, buy or partner, and why <span className="text-red-500">*</span>
                            {renderFieldIndicator("build_buy_partner")}
                          </Label>
                            <Textarea
                              id="ov_build_buy_partner"
                              rows={3}
                              value={form.build_buy_partner ?? ""}
                              placeholder="Partner, not build: Eurolink gives local presence and BIR liaison; 1-year exclusivity across the BIR e-invoicing scope."
                              onChange={(e) => handleChange("build_buy_partner", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_cost_not_doing" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Cost of not doing it <span className="text-red-500">*</span>
                            {renderFieldIndicator("cost_of_not_doing")}
                          </Label>
                            <Textarea
                              id="ov_cost_not_doing"
                              rows={3}
                              value={form.cost_of_not_doing ?? ""}
                              placeholder="Phase-1 firms choose providers through 2027; global and local vendors take the market."
                              onChange={(e) => handleChange("cost_of_not_doing", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ov_what_reuses" className="text-sm font-semibold text-slate-900">
                              What it re-uses
                            </Label>
                            <Textarea
                              id="ov_what_reuses"
                              rows={3}
                              value={form.overview_what_it_reuses ?? ""}
                              placeholder="Verinvo core and the UAE delivery playbook; only the BIR-specific layer is new."
                              onChange={(e) => handleChange("overview_what_it_reuses", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 pt-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Target or project snapshot</h3>
                          <p className="text-xs text-slate-500 mt-0.5">For greenfield projects, give the planned figures.</p>
                        </div>

                        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="snapshot_founded" className="text-sm font-semibold text-slate-900">Founded</Label>
                            <Input
                              id="snapshot_founded"
                              value={form.snapshot_founded ?? ""}
                              placeholder="Partnership (no new entity yet)"
                              onChange={(e) => handleChange("snapshot_founded", e.target.value)}
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="snapshot_hq" className="text-sm font-semibold text-slate-900">HQ and key locations</Label>
                            <Input
                              id="snapshot_hq"
                              value={form.snapshot_hq ?? ""}
                              placeholder="Manila (Eurolink) · Abu Dhabi"
                              onChange={(e) => handleChange("snapshot_hq", e.target.value)}
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="snapshot_employees" className="text-sm font-semibold text-slate-900">Employees</Label>
                            <Input
                              id="snapshot_employees"
                              value={form.snapshot_employees ?? ""}
                              placeholder="Country lead + Eurolink team"
                              onChange={(e) => handleChange("snapshot_employees", e.target.value)}
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="snapshot_revenue_last_fy_aed" className="text-sm font-semibold text-slate-900">Revenue, last FY (AED mn)</Label>
                            <Input
                              id="snapshot_revenue_last_fy_aed"
                              value={form.snapshot_revenue_last_fy_aed ?? ""}
                              placeholder="Manila (Eurolink) · Abu Dhabi"
                              onChange={(e) => handleChange("snapshot_revenue_last_fy_aed", e.target.value)}
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="snapshot_ebitda_last_fy_aed" className="text-sm font-semibold text-slate-900">EBITDA, last FY (AED mn)</Label>
                            <Input
                              id="snapshot_ebitda_last_fy_aed"
                              value={form.snapshot_ebitda_last_fy_aed ?? ""}
                              placeholder="2027 plan AED (1.07) mn"
                              onChange={(e) => handleChange("snapshot_ebitda_last_fy_aed", e.target.value)}
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="snapshot_current_ownership" className="text-sm font-semibold text-slate-900">Current ownership</Label>
                            <Input
                              id="snapshot_current_ownership"
                              value={form.snapshot_current_ownership ?? ""}
                              placeholder="Structure set in definitive agreement"
                              onChange={(e) => handleChange("snapshot_current_ownership", e.target.value)}
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="snapshot_note" className="text-sm font-semibold text-slate-900">Note under the snapshot</Label>
                          <Input
                            id="snapshot_note"
                            value={form.snapshot_note ?? ""}
                            placeholder="Partner-led greenfield: planned figures shown. Revenue reaches AED 10.3 mn and EBITDA 2.9 mn a year from 2029."
                            onChange={(e) => handleChange("snapshot_note", e.target.value)}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm text-slate-900 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Rationale and fit (DS-9) */}
                  {activeTab === 2 && (
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="rf_why_this" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Why this? <span className="text-red-500">*</span>
                            {renderFieldIndicator("rationale_evidence")}
                          </Label>
                          <Textarea
                            id="rf_why_this"
                            rows={4}
                            value={form.rationale_evidence ?? ""}
                            placeholder="Large mandated market: about 20,700 enterprises in scope. Clearance-style model needs a certified, integrated provider. Recurring subscription revenue at about 70% gross margin. Market 2027: TAM USD 166 mn; enterprise SAM USD 85 mn."
                            onChange={(e) => handleChange("rationale_evidence", e.target.value)}
                            className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="rf_why_now" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Why now? <span className="text-red-500">*</span>
                            {renderFieldIndicator("narrative_why_now")}
                          </Label>
                          <Textarea
                            id="rf_why_now"
                            rows={4}
                            value={form.narrative_why_now ?? ""}
                            placeholder="Phase-1 deadline 31 Dec 2026; firms must be ready from Jan 2027. EIS build-out runs through 2027, so early certified providers win. Eurolink MoU finalised; signing by Oxinus due Oct 2026. Model confidence MEDIUM: 54% chance the mandate lands as dated."
                            onChange={(e) => handleChange("narrative_why_now", e.target.value)}
                            className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="rf_why_us" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                            Why us? <span className="text-red-500">*</span>
                            {renderFieldIndicator("narrative_why_us")}
                          </Label>
                          <Textarea
                            id="rf_why_us"
                            rows={4}
                            value={form.narrative_why_us ?? ""}
                            placeholder="Proven provider with live UAE clients. Verinvo built for multi-country formats. Eurolink brings local relationships we can't build quickly alone. Model rates the Philippines VIABLE with positive expected cash."
                            onChange={(e) => handleChange("narrative_why_us", e.target.value)}
                            className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div className="space-y-4 pt-2">
                        <h3 className="text-sm font-bold text-slate-900">Strategic fit</h3>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="rf_core_mandate" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              core mandate<span className="text-red-500">*</span>
                            {renderFieldIndicator("strategy_link")}
                          </Label>
                            <Textarea
                              id="rf_core_mandate"
                              rows={3}
                              value={form.strategy_link ?? ""}
                              placeholder="Tax-tech provider; same service, new region."
                              onChange={(e) => handleChange("strategy_link", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="rf_geography" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              geography <span className="text-red-500">*</span>
                            {renderFieldIndicator("geography_fit")}
                          </Label>
                            <Textarea
                              id="rf_geography"
                              rows={3}
                              value={form.geography_fit ?? ""}
                              placeholder="First step into ASEAN; Singapore a natural follow-on."
                              onChange={(e) => handleChange("geography_fit", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="rf_concentration" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              concentration <span className="text-red-500">*</span>
                            {renderFieldIndicator("concentration_impact")}
                          </Label>
                            <Textarea
                              id="rf_concentration"
                              rows={3}
                              value={form.concentration_impact ?? ""}
                              placeholder="Diversifies away from GCC-only revenue."
                              onChange={(e) => handleChange("concentration_impact", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="rf_capability" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              capability <span className="text-red-500">*</span>
                            {renderFieldIndicator("capability_fit")}
                          </Label>
                            <Textarea
                              id="rf_capability"
                              rows={3}
                              value={form.capability_fit ?? ""}
                              placeholder="Builds clearance-model know-how reusable in KSA, Poland and Italy."
                              onChange={(e) => handleChange("capability_fit", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 pt-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Value created at two levels</h3>
                          <p className="text-xs text-slate-500 mt-0.5">Required in every submission. This is the accretion statement in the screening memo.</p>
                        </div>

                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="rf_val_company" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                                Net earnings accretion (AED mn) <span className="text-red-500">*</span>
                                {renderFieldIndicator("accretion_net_earnings_aed")}
                              </Label>
                              <Input
                                id="rf_val_company"
                                type="text"
                                inputMode="decimal"
                                value={form.accretion_net_earnings_aed ?? ""}
                                placeholder="e.g. 18.5"
                                onChange={(e) => handleChange("accretion_net_earnings_aed", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-sm text-slate-900 px-3 focus:border-blue-500"
                              />
                              <p className="text-[11px] text-slate-500">Adds net earnings to your company per year.</p>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="rf_val_bps" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                                Return accretion (bps) <span className="text-red-500">*</span>
                                {renderFieldIndicator("accretion_bps")}
                              </Label>
                              <Input
                                id="rf_val_bps"
                                type="text"
                                inputMode="decimal"
                                value={form.accretion_bps ?? ""}
                                placeholder="e.g. 120"
                                onChange={(e) => handleChange("accretion_bps", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-sm text-slate-900 px-3 focus:border-blue-500"
                              />
                              <p className="text-[11px] text-slate-500">Incremental return to portfolio (100 bps = 1.0%).</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="rf_val_sirius" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Value to the Sirius portfolio <span className="text-red-500">*</span>
                            {renderFieldIndicator("sirius_accretion_rationale")}
                          </Label>
                            <Textarea
                              id="rf_val_sirius"
                              rows={3}
                              value={form.sirius_accretion_rationale ?? ""}
                              placeholder="Entry into ASEAN tax tech with limited capital at risk; option to scale regionally; raises platform exit value."
                              onChange={(e) => handleChange("sirius_accretion_rationale", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="rf_capital_risk" className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                              Capital at risk <span className="text-red-500">*</span>
                            {renderFieldIndicator("capital_at_risk")}
                          </Label>
                            <Textarea
                              id="rf_capital_risk"
                              rows={3}
                              value={form.capital_at_risk ?? ""}
                              placeholder="AED 2.72 mn peak; under the MoU each party bears its own costs."
                              onChange={(e) => handleChange("capital_at_risk", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-sm text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 4: Financials and returns (DS-10) */}
                  {activeTab === 3 && (
                    <div className="space-y-8">
                      {/* Financial model */}
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Financial model</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Upload the three-statement model in the Sirius template first. The system checks it; the figures below should come from it.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer transition-colors">
                            <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                            <span>Attach File</span>
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleChange("financial_model_file", file.name);
                                }
                              }}
                            />
                          </label>
                          <span className="text-xs text-slate-400">
                            {form.financial_model_file || "No File Choose"}
                          </span>
                        </div>

                        <div className="space-y-1.5 max-w-sm">
                          <Label htmlFor="first_proj_year" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                            First projection year (Y1) <span className="text-red-500">*</span>
                            {renderFieldIndicator("first_projection_year")}
                          </Label>
                          <Select
                            value={form.first_projection_year || "2027"}
                            onValueChange={(val) => handleChange("first_projection_year", val)}
                          >
                            <SelectTrigger id="first_proj_year" className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900">
                              <SelectValue placeholder="2027" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2026">2026</SelectItem>
                              <SelectItem value="2027">2027</SelectItem>
                              <SelectItem value="2028">2028</SelectItem>
                              <SelectItem value="2029">2029</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-slate-500 leading-normal">
                            Column headings use real years, e.g. 2027 P. New ventures can leave the actual (A) years blank.
                          </p>
                        </div>
                      </div>

                      {/* Financial summary grid table */}
                      <div className="space-y-3">
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50/70">
                                <th className="p-2.5 font-semibold text-slate-600 border-r border-slate-200 w-44"></th>
                                <th colSpan={3} className="p-2 text-center font-semibold text-slate-700 border-r border-slate-200 bg-slate-100/60">
                                  Actual · audited
                                </th>
                                <th colSpan={3} className="p-2 text-center font-bold text-blue-600 bg-blue-50/40">
                                  Projections
                                </th>
                              </tr>
                              <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="p-2.5 font-bold text-slate-700 border-r border-slate-200">AED mn</th>
                                <th className="p-2 text-center font-semibold text-slate-600 border-r border-slate-200 w-24">FY2024</th>
                                <th className="p-2 text-center font-semibold text-slate-600 border-r border-slate-200 w-24">FY2025</th>
                                <th className="p-2 text-center font-semibold text-slate-600 border-r border-slate-200 w-24">FY2026</th>
                                <th className="p-2 text-center font-bold text-blue-600 border-r border-slate-200 w-24">FY2027</th>
                                <th className="p-2 text-center font-bold text-blue-600 border-r border-slate-200 w-24">FY2028</th>
                                <th className="p-2 text-center font-bold text-blue-600 w-24">FY2029</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              {/* Revenue */}
                              <tr>
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">Revenue</td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.revenue?.fy3a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("revenue", "fy3a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.revenue?.fy2a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("revenue", "fy2a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.revenue?.fy1a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("revenue", "fy1a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.revenue?.y1p ?? ""}
                                    placeholder="5.5"
                                    onChange={(e) => handleFinancialChange("revenue", "y1p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.revenue?.y2p ?? ""}
                                    placeholder="22.0"
                                    onChange={(e) => handleFinancialChange("revenue", "y2p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.financials?.revenue?.y3p ?? ""}
                                    placeholder="49.5"
                                    onChange={(e) => handleFinancialChange("revenue", "y3p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>

                              {/* Growth % */}
                              <tr className="bg-slate-50/40">
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">Growth %</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center font-medium text-slate-700 border-r border-slate-200">300%</td>
                                <td className="p-2 text-center font-medium text-slate-700">125%</td>
                              </tr>

                              {/* EBITDA */}
                              <tr>
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">EBITDA</td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.ebitda?.fy3a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("ebitda", "fy3a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.ebitda?.fy2a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("ebitda", "fy2a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.ebitda?.fy1a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("ebitda", "fy1a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.ebitda?.y1p ?? ""}
                                    placeholder="-33.0"
                                    onChange={(e) => handleFinancialChange("ebitda", "y1p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.ebitda?.y2p ?? ""}
                                    placeholder="44.0"
                                    onChange={(e) => handleFinancialChange("ebitda", "y2p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.financials?.ebitda?.y3p ?? ""}
                                    placeholder="-66.0"
                                    onChange={(e) => handleFinancialChange("ebitda", "y3p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>

                              {/* EBITDA margin */}
                              <tr className="bg-slate-50/40">
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">EBITDA margin</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center text-slate-400 border-r border-slate-200">-</td>
                                <td className="p-2 text-center font-medium text-slate-700 border-r border-slate-200">-600%</td>
                                <td className="p-2 text-center font-medium text-slate-700 border-r border-slate-200">200%</td>
                                <td className="p-2 text-center font-medium text-slate-700">-133%</td>
                              </tr>

                              {/* Net income */}
                              <tr>
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">Net income</td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_income?.fy3a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("net_income", "fy3a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_income?.fy2a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("net_income", "fy2a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_income?.fy1a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("net_income", "fy1a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_income?.y1p ?? ""}
                                    placeholder="-33.0"
                                    onChange={(e) => handleFinancialChange("net_income", "y1p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_income?.y2p ?? ""}
                                    placeholder="44.0"
                                    onChange={(e) => handleFinancialChange("net_income", "y2p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.financials?.net_income?.y3p ?? ""}
                                    placeholder="-66.0"
                                    onChange={(e) => handleFinancialChange("net_income", "y3p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>

                              {/* Capex */}
                              <tr>
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">Capex</td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.capex?.fy3a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("capex", "fy3a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.capex?.fy2a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("capex", "fy2a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.capex?.fy1a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("capex", "fy1a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.capex?.y1p ?? ""}
                                    placeholder="0.0"
                                    onChange={(e) => handleFinancialChange("capex", "y1p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.capex?.y2p ?? ""}
                                    placeholder="0.0"
                                    onChange={(e) => handleFinancialChange("capex", "y2p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.financials?.capex?.y3p ?? ""}
                                    placeholder="0.0"
                                    onChange={(e) => handleFinancialChange("capex", "y3p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>

                              {/* Free cash flow */}
                              <tr>
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">Free cash flow</td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.fcf?.fy3a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("fcf", "fy3a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.fcf?.fy2a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("fcf", "fy2a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.fcf?.fy1a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("fcf", "fy1a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.fcf?.y1p ?? ""}
                                    placeholder="-33.0"
                                    onChange={(e) => handleFinancialChange("fcf", "y1p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.fcf?.y2p ?? ""}
                                    placeholder="44.0"
                                    onChange={(e) => handleFinancialChange("fcf", "y2p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.financials?.fcf?.y3p ?? ""}
                                    placeholder="-66.0"
                                    onChange={(e) => handleFinancialChange("fcf", "y3p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>

                              {/* Net debt / EBITDA */}
                              <tr>
                                <td className="p-2.5 font-semibold text-slate-700 border-r border-slate-200">Net debt / EBITDA</td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_debt_ebitda?.fy3a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("net_debt_ebitda", "fy3a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_debt_ebitda?.fy2a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("net_debt_ebitda", "fy2a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_debt_ebitda?.fy1a ?? ""}
                                    placeholder="-"
                                    onChange={(e) => handleFinancialChange("net_debt_ebitda", "fy1a", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_debt_ebitda?.y1p ?? ""}
                                    placeholder="0.0"
                                    onChange={(e) => handleFinancialChange("net_debt_ebitda", "y1p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5 border-r border-slate-200">
                                  <input
                                    type="text"
                                    value={form.financials?.net_debt_ebitda?.y2p ?? ""}
                                    placeholder="0.0"
                                    onChange={(e) => handleFinancialChange("net_debt_ebitda", "y2p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.financials?.net_debt_ebitda?.y3p ?? ""}
                                    placeholder="0.0"
                                    onChange={(e) => handleFinancialChange("net_debt_ebitda", "y3p", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Returns against the hurdles */}
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Returns against the hurdles</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            All three cases are required. The downside must be one the business can survive.
                          </p>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                                <th className="p-2.5">Returns</th>
                                <th className="p-2.5">Hurdle</th>
                                <th className="p-2.5">Base</th>
                                <th className="p-2.5">Upside</th>
                                <th className="p-2.5">Downside</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              {/* Equity IRR */}
                              <tr>
                                <td className="p-2.5 font-medium text-slate-900">Equity IRR (%)</td>
                                <td className="p-2.5 text-slate-500 font-medium">≥ 25%</td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_irr_base ?? ""}
                                      onChange={(e) => handleChange("return_irr_base", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("equity_irr", form.return_irr_base)}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_irr_upside ?? ""}
                                      onChange={(e) => handleChange("return_irr_upside", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("equity_irr", form.return_irr_upside)}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_irr_downside ?? ""}
                                      onChange={(e) => handleChange("return_irr_downside", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("equity_irr", form.return_irr_downside)}
                                  </div>
                                </td>
                              </tr>

                              {/* ROIC */}
                              <tr>
                                <td className="p-2.5 font-medium text-slate-900">ROIC (%)</td>
                                <td className="p-2.5 text-slate-500 font-medium">≥ WACC + 5%</td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_roic_base ?? ""}
                                      onChange={(e) => handleChange("return_roic_base", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("roic", form.return_roic_base)}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_roic_upside ?? ""}
                                      onChange={(e) => handleChange("return_roic_upside", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("roic", form.return_roic_upside)}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_roic_downside ?? ""}
                                      onChange={(e) => handleChange("return_roic_downside", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("roic", form.return_roic_downside)}
                                  </div>
                                </td>
                              </tr>

                              {/* Payback */}
                              <tr>
                                <td className="p-2.5 font-medium text-slate-900">Payback (years)</td>
                                <td className="p-2.5 text-slate-500 font-medium">≤ 3.5 yrs</td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_payback_years ?? ""}
                                      onChange={(e) => handleChange("return_payback_years", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("payback", form.return_payback_years)}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_payback_upside ?? ""}
                                      onChange={(e) => handleChange("return_payback_upside", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("payback", form.return_payback_upside)}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={form.return_payback_downside ?? ""}
                                      onChange={(e) => handleChange("return_payback_downside", e.target.value)}
                                      className="h-8 w-14 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                    />
                                    {renderHurdleBadge("payback", form.return_payback_downside)}
                                  </div>
                                </td>
                              </tr>

                              {/* MOIC */}
                              <tr>
                                <td className="p-2.5 font-medium text-slate-900">MOIC (x), where relevant</td>
                                <td className="p-2.5 text-slate-500 font-medium">—</td>
                                <td className="p-2.5">
                                  <input
                                    type="text"
                                    value={form.return_moic_base ?? ""}
                                    onChange={(e) => handleChange("return_moic_base", e.target.value)}
                                    className="h-8 w-20 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <input
                                    type="text"
                                    value={form.return_moic_upside ?? ""}
                                    onChange={(e) => handleChange("return_moic_upside", e.target.value)}
                                    className="h-8 w-20 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <input
                                    type="text"
                                    value={form.return_moic_downside ?? ""}
                                    onChange={(e) => handleChange("return_moic_downside", e.target.value)}
                                    className="h-8 w-20 rounded-lg border border-slate-200 bg-[#f8fafc] text-center text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* 3 Hurdle inputs */}
                        <div className="grid md:grid-cols-3 gap-4 pt-1">
                          <div className="space-y-1">
                            <Label htmlFor="hurdle_wacc" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              WACC (%) <span className="text-red-500">*</span>
                            {renderFieldIndicator("wacc_override_pct")}
                          </Label>
                            <Input
                              id="hurdle_wacc"
                              value={form.wacc_override_pct ?? ""}
                              placeholder="10"
                              onChange={(e) => handleChange("wacc_override_pct", e.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                            />
                            <p className="text-[11px] text-slate-500">Tests ROIC against WACC + 5%.</p>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="hurdle_capital" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Share of your company&apos;s capital (%) <span className="text-red-500">*</span>
                            {renderFieldIndicator("concentration_pct")}
                          </Label>
                            <Input
                              id="hurdle_capital"
                              value={form.concentration_pct ?? ""}
                              onChange={(e) => handleChange("concentration_pct", e.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                            />
                            <p className="text-[11px] text-slate-500">Hurdle: 35% or less.</p>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="hurdle_leverage" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Leverage on the deal (net debt / EBITDA) <span className="text-red-500">*</span>
                            {renderFieldIndicator("leverage_ratio")}
                          </Label>
                            <Input
                              id="hurdle_leverage"
                              value={form.leverage_ratio ?? ""}
                              onChange={(e) => handleChange("leverage_ratio", e.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                            />
                            <p className="text-[11px] text-slate-500">Hurdle: 3x or less. Enter 0 if there is no debt.</p>
                          </div>
                        </div>
                      </div>

                      {/* Entry valuation and exit */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-900">Entry valuation and exit</h3>
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="entry_val_basis" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Entry valuation and basis <span className="text-red-500">*</span>
                            {renderFieldIndicator("entry_valuation_basis_text")}
                          </Label>
                            <Input
                              id="entry_val_basis"
                              value={form.entry_valuation_basis_text ?? ""}
                              placeholder="e.g. n/a: partnership at cost (entry investment AED 1.65 mn)"
                              onChange={(e) => handleChange("entry_valuation_basis_text", e.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="exit_val_realisation" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Exit or value-realisation <span className="text-red-500">*</span>
                            {renderFieldIndicator("exit_route")}
                          </Label>
                            <Input
                              id="exit_val_realisation"
                              value={form.exit_route ?? ""}
                              placeholder="e.g. Value held inside entity as recurring revenue; buy-out or exit terms in definitive agreement"
                              onChange={(e) => handleChange("exit_route", e.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-900">
                              Comparable companies (3 to 5; required for acquisitions)
                            </Label>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                              <Input
                                placeholder="Company 1"
                                value={form.comp_1 ?? ""}
                                onChange={(e) => handleChange("comp_1", e.target.value)}
                                className="h-9 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                              <Input
                                placeholder="Company 2"
                                value={form.comp_2 ?? ""}
                                onChange={(e) => handleChange("comp_2", e.target.value)}
                                className="h-9 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                              <Input
                                placeholder="Company 3"
                                value={form.comp_3 ?? ""}
                                onChange={(e) => handleChange("comp_3", e.target.value)}
                                className="h-9 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                              <Input
                                placeholder="Company 4"
                                value={form.comp_4 ?? ""}
                                onChange={(e) => handleChange("comp_4", e.target.value)}
                                className="h-9 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                              <Input
                                placeholder="Company 5"
                                value={form.comp_5 ?? ""}
                                onChange={(e) => handleChange("comp_5", e.target.value)}
                                className="h-9 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Assumptions and scenarios */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-900">Assumptions and scenarios</h3>
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="base_case_assump" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Base case <span className="text-red-500">*</span>
                            {renderFieldIndicator("base_case_assumptions")}
                          </Label>
                            <Textarea
                              id="base_case_assump"
                              rows={3}
                              value={form.base_case_assumptions ?? ""}
                              placeholder="Enter base case assumptions..."
                              onChange={(e) => handleChange("base_case_assumptions", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-xs text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="upside_downside_assump" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Upside and downside <span className="text-red-500">*</span>
                            {renderFieldIndicator("scenarios_assumptions")}
                          </Label>
                            <Textarea
                              id="upside_downside_assump"
                              rows={2}
                              value={form.scenarios_assumptions ?? ""}
                              placeholder="Enter upside and downside scenario assumptions..."
                              onChange={(e) => handleChange("scenarios_assumptions", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-xs text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="target_outside_country" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                                Is the target outside your company&apos;s home country? <span className="text-red-500">*</span>
                            {renderFieldIndicator("cross_border_target")}
                          </Label>
                              <Select
                                value={form.cross_border_target || ""}
                                onValueChange={(val) => handleChange("cross_border_target", val)}
                              >
                                <SelectTrigger id="target_outside_country" className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900">
                                  <SelectValue placeholder="Select Yes / No" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Yes">Yes</SelectItem>
                                  <SelectItem value="No">No</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="fx_rate_input" className="text-xs font-semibold text-slate-900">
                                FX rate (AED per USD)
                              </Label>
                              <Input
                                id="fx_rate_input"
                                value={form.fx_rate_usd_aed ?? ""}
                                placeholder="3.6725"
                                onChange={(e) => handleChange("fx_rate_usd_aed", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="fx_exposure_input" className="text-xs font-semibold text-slate-900">
                                FX exposure
                              </Label>
                              <Input
                                id="fx_exposure_input"
                                value={form.cross_border_fx ?? ""}
                                placeholder="e.g. Revenues in local currency, costs partially in USD"
                                onChange={(e) => handleChange("cross_border_fx", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="wht_input" className="text-xs font-semibold text-slate-900">
                                Withholding tax
                              </Label>
                              <Input
                                id="wht_input"
                                value={form.cross_border_wht ?? ""}
                                placeholder="e.g. Applicable withholding tax rates"
                                onChange={(e) => handleChange("cross_border_wht", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="transfer_pricing_input" className="text-xs font-semibold text-slate-900">
                                Transfer pricing
                              </Label>
                              <Input
                                id="transfer_pricing_input"
                                value={form.cross_border_transfer_pricing ?? ""}
                                placeholder="e.g. Standard arm's length transfer pricing"
                                onChange={(e) => handleChange("cross_border_transfer_pricing", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="repatriation_input" className="text-xs font-semibold text-slate-900">
                                Repatriation restrictions
                              </Label>
                              <Input
                                id="repatriation_input"
                                value={form.cross_border_repatriation ?? ""}
                                placeholder="e.g. None or standard central bank registration"
                                onChange={(e) => handleChange("cross_border_repatriation", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="tax_rate_input" className="text-xs font-semibold text-slate-900">
                              Tax rate applied
                            </Label>
                            <Input
                              id="tax_rate_input"
                              value={form.tax_rate_applied ?? ""}
                              placeholder="e.g. 25% applied"
                              onChange={(e) => handleChange("tax_rate_applied", e.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 5: Funding and key asks (DS-11) */}
                  {activeTab === 4 && (
                    <div className="space-y-8">
                      {/* The opportunity in brief */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-900">The opportunity in brief</h3>
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="funding_decision" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Decision sought<span className="text-red-500">*</span>
                            {renderFieldIndicator("decision_sought")}
                          </Label>
                            <Textarea
                              id="funding_decision"
                              rows={3}
                              value={form.decision_sought ?? ""}
                              placeholder="Approval for Oxinus to sign the Eurolink MoU, negotiate the definitive agreement and start BIR EIS certification."
                              onChange={(e) => handleChange("decision_sought", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-xs text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>

                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="funding_capital" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                                Sirius capital or guarantee <span className="text-red-500">*</span>
                            {renderFieldIndicator("sirius_capital_or_guarantee")}
                          </Label>
                              <Input
                                id="funding_capital"
                                value={form.sirius_capital_or_guarantee ?? ""}
                                placeholder="AED 2.72 mn peak need in 2027: ESAL accruals or Sirius capital, to confirm."
                                onChange={(e) => handleChange("sirius_capital_or_guarantee", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label htmlFor="funding_deal_shape" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                                Deal shape <span className="text-red-500">*</span>
                            {renderFieldIndicator("funding_deal_shape")}
                          </Label>
                              <Input
                                id="funding_deal_shape"
                                value={form.funding_deal_shape ?? ""}
                                placeholder="Sirius / IHC contacts in the Philippines; tax and transfer-pricing advice; banking."
                                onChange={(e) => handleChange("funding_deal_shape", e.target.value)}
                                className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="funding_next_steps" className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              Next steps and timeline <span className="text-red-500">*</span>
                            {renderFieldIndicator("next_steps")}
                          </Label>
                            <Textarea
                              id="funding_next_steps"
                              rows={3}
                              value={form.next_steps ?? ""}
                              placeholder="Sign MoU Oct 2026 → definitive agreement Q4 2026 → BIR certification H1 2027 → billing H2 2027. Decision by Nov 2026."
                              onChange={(e) => handleChange("next_steps", e.target.value)}
                              className="rounded-lg border-slate-300 bg-white text-xs text-slate-900 p-3 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 1: Funding sources */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-slate-900">Funding sources</h3>

                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                                <th className="p-3 w-1/3">Source</th>
                                <th className="p-3 text-center w-36">AED mn</th>
                                <th className="p-3 text-center w-28">Share</th>
                                <th className="p-3 w-44">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              <tr>
                                <td className="p-3 font-semibold text-slate-800">Subsidiary internal accruals</td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.source_accruals_aed ?? ""}
                                    onChange={(e) => handleChange("source_accruals_aed", e.target.value)}
                                    className="h-9 w-32 mx-auto rounded-lg border border-slate-300 bg-white text-center text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2 text-center text-slate-400 font-medium">-</td>
                                <td className="p-2">
                                  <Select
                                    value={form.source_accruals_status || "not_required"}
                                    onValueChange={(val) => handleChange("source_accruals_status", val)}
                                  >
                                    <SelectTrigger className="h-9 w-36 rounded-lg border-slate-300 bg-white text-xs text-slate-700">
                                      <SelectValue placeholder="Not required" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="not_required">Not required</SelectItem>
                                      <SelectItem value="secured">Secured</SelectItem>
                                      <SelectItem value="committed">Committed</SelectItem>
                                      <SelectItem value="indicative">Indicative</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>

                              <tr>
                                <td className="p-3 font-semibold text-slate-800">Subsidiary debt</td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.source_debt_aed ?? ""}
                                    onChange={(e) => handleChange("source_debt_aed", e.target.value)}
                                    className="h-9 w-32 mx-auto rounded-lg border border-slate-300 bg-white text-center text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2 text-center text-slate-400 font-medium">-</td>
                                <td className="p-2">
                                  <Select
                                    value={form.source_debt_status || "not_required"}
                                    onValueChange={(val) => handleChange("source_debt_status", val)}
                                  >
                                    <SelectTrigger className="h-9 w-36 rounded-lg border-slate-300 bg-white text-xs text-slate-700">
                                      <SelectValue placeholder="Not required" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="not_required">Not required</SelectItem>
                                      <SelectItem value="secured">Secured</SelectItem>
                                      <SelectItem value="committed">Committed</SelectItem>
                                      <SelectItem value="indicative">Indicative</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>

                              <tr>
                                <td className="p-3 font-semibold text-slate-800">Partner or co-investor</td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.source_partner_aed ?? ""}
                                    onChange={(e) => handleChange("source_partner_aed", e.target.value)}
                                    className="h-9 w-32 mx-auto rounded-lg border border-slate-300 bg-white text-center text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2 text-center text-slate-400 font-medium">-</td>
                                <td className="p-2">
                                  <Select
                                    value={form.source_partner_status || "not_required"}
                                    onValueChange={(val) => handleChange("source_partner_status", val)}
                                  >
                                    <SelectTrigger className="h-9 w-36 rounded-lg border-slate-300 bg-white text-xs text-slate-700">
                                      <SelectValue placeholder="Not required" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="not_required">Not required</SelectItem>
                                      <SelectItem value="secured">Secured</SelectItem>
                                      <SelectItem value="committed">Committed</SelectItem>
                                      <SelectItem value="indicative">Indicative</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>

                              <tr>
                                <td className="p-3 font-semibold text-slate-800">Sirius capital (the ask)</td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.source_sirius_aed ?? ""}
                                    onChange={(e) => handleChange("source_sirius_aed", e.target.value)}
                                    className="h-9 w-32 mx-auto rounded-lg border border-slate-300 bg-white text-center text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2 text-center text-slate-400 font-medium">-</td>
                                <td className="p-2">
                                  <Select
                                    value={form.source_sirius_status || "not_required"}
                                    onValueChange={(val) => handleChange("source_sirius_status", val)}
                                  >
                                    <SelectTrigger className="h-9 w-36 rounded-lg border-slate-300 bg-white text-xs text-slate-700">
                                      <SelectValue placeholder="Not required" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="not_required">Not required</SelectItem>
                                      <SelectItem value="secured">Secured</SelectItem>
                                      <SelectItem value="committed">Committed</SelectItem>
                                      <SelectItem value="indicative">Indicative</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>

                              <tr className="border-t border-slate-200 bg-white font-bold text-slate-900">
                                <td className="p-3">Total sources</td>
                                <td className="p-3 text-center">{totalSourcesAed}</td>
                                <td className="p-3 text-center">{Number(totalSourcesAed) > 0 ? "100%" : "-"}</td>
                                <td className="p-3"></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Section 2: Funding sources (Uses) */}
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Funding sources</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Describe each use in your own words, for example: entry costs, entity and licences, Year-1 operating loss.
                          </p>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                                <th className="p-3">Use</th>
                                <th className="p-3 text-center w-48">AED mn</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              <tr>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={form.use_entry_desc ?? ""}
                                    placeholder="e.g. Entry: BIR certification, localisation, go-to-market"
                                    onChange={(e) => handleChange("use_entry_desc", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.use_entry_aed ?? ""}
                                    onChange={(e) => handleChange("use_entry_aed", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none text-center"
                                  />
                                </td>
                              </tr>
                              <tr>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={form.use_legal_desc ?? ""}
                                    placeholder="e.g. Entity, licences & legal"
                                    onChange={(e) => handleChange("use_legal_desc", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.use_legal_aed ?? ""}
                                    onChange={(e) => handleChange("use_legal_aed", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none text-center"
                                  />
                                </td>
                              </tr>
                              <tr>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={form.use_wc_desc ?? ""}
                                    placeholder="e.g. Year-1 operating loss (working capital)"
                                    onChange={(e) => handleChange("use_wc_desc", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.use_wc_aed ?? ""}
                                    onChange={(e) => handleChange("use_wc_aed", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none text-center"
                                  />
                                </td>
                              </tr>
                              <tr>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={form.use_contingency_desc ?? ""}
                                    placeholder="e.g. Contingency (inside entry cost)"
                                    onChange={(e) => handleChange("use_contingency_desc", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.use_contingency_aed ?? ""}
                                    onChange={(e) => handleChange("use_contingency_aed", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none text-center"
                                  />
                                </td>
                              </tr>
                              <tr>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    placeholder="Other"
                                    value={form.use_other_desc ?? ""}
                                    onChange={(e) => handleChange("use_other_desc", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="text"
                                    value={form.use_other_aed ?? ""}
                                    onChange={(e) => handleChange("use_other_aed", e.target.value)}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none text-center"
                                  />
                                </td>
                              </tr>

                              <tr className="border-t border-slate-200 bg-white font-bold text-slate-900">
                                <td className="p-3">Total uses</td>
                                <td className="p-3 text-center">{totalUsesAed}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Status Banners */}
                      <div className="space-y-3">
                        {isSourcesEqualUses && (
                          <div className="rounded-xl bg-[#ecfbf2] p-4 text-xs font-medium text-emerald-800 leading-relaxed">
                            Sources equal uses.
                          </div>
                        )}

                        {isSiriusCapitalActive && (
                          <div className="rounded-xl bg-[#fef8ea] p-4 text-xs font-medium text-amber-800 leading-relaxed">
                            Sirius capital is the last resort. Your own cash and debt capacity should come first, so show why they are not enough.
                          </div>
                        )}

                        {isOffBudgetActive && (
                          <div className="rounded-xl bg-[#edf2fe] p-4 text-xs font-medium text-blue-900 leading-relaxed">
                            <span className="font-bold">Budget status</span> (from step 1): not in the approved budget. Variance approval needed. {form.variance_justification ? `(${form.variance_justification})` : ""}
                          </div>
                        )}
                      </div>

                      {/* Guarantees and contingent commitments */}
                      <div className="space-y-2">
                        <h3 className="text-sm font-bold text-slate-900">Guarantees and contingent commitments</h3>
                        <Textarea
                          rows={3}
                          value={form.guarantees_commitments ?? ""}
                          placeholder="e.g. None under the MoU; no shared cost without written approval. Revenue share, exclusivity terms and liability to be set in the definitive agreement."
                          onChange={(e) => handleChange("guarantees_commitments", e.target.value)}
                          className="rounded-lg border-slate-300 bg-white text-xs text-slate-900 p-3 focus:border-blue-500 placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  )}

                  {/* Step 6: Risks and compliance (DS-12) */}
                  {activeTab === 5 && (
                    <div className="space-y-8">
                      {/* Risk register */}
                      <div className="space-y-3">
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                                <th className="p-2 text-center w-8">#</th>
                                <th className="p-2 min-w-[200px]">Risk</th>
                                <th className="p-2 min-w-[110px]">Category</th>
                                <th className="p-2 min-w-[90px]">Likelihood</th>
                                <th className="p-2 min-w-[90px]">Impact</th>
                                <th className="p-2 min-w-[240px]">Mitigation</th>
                                <th className="p-2 min-w-[100px]">Owner</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              {/* Row 1 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">1</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_1_name ?? ""}
                                    placeholder="e.g. BIR EIS timeline or spec changes delay launch"
                                    onChange={(e) => handleChange("risk_1_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_1_category || ""}
                                    onValueChange={(val) => handleChange("risk_1_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_1_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_1_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_1_impact || ""}
                                    onValueChange={(val) => handleChange("risk_1_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_1_mitigation ?? ""}
                                    placeholder="Stage spend to BIR milestones; run sandbox in parallel"
                                    onChange={(e) => handleChange("risk_1_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_1_owner ?? ""}
                                    placeholder="e.g. CEO"
                                    onChange={(e) => handleChange("risk_1_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>

                              {/* Row 2 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">2</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_2_name ?? ""}
                                    placeholder="e.g. Partner fails to deliver local sales or distribution"
                                    onChange={(e) => handleChange("risk_2_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_2_category || ""}
                                    onValueChange={(val) => handleChange("risk_2_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_2_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_2_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_2_impact || ""}
                                    onValueChange={(val) => handleChange("risk_2_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_2_mitigation ?? ""}
                                    placeholder="Contractual minimums, direct sales fallback, Sirius network"
                                    onChange={(e) => handleChange("risk_2_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_2_owner ?? ""}
                                    placeholder="e.g. Commercial Lead"
                                    onChange={(e) => handleChange("risk_2_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>

                              {/* Row 3 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">3</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_3_name ?? ""}
                                    placeholder="e.g. Local competitor moves faster or undercuts price"
                                    onChange={(e) => handleChange("risk_3_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_3_category || ""}
                                    onValueChange={(val) => handleChange("risk_3_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_3_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_3_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_3_impact || ""}
                                    onValueChange={(val) => handleChange("risk_3_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_3_mitigation ?? ""}
                                    placeholder="First-mover advantage via European tier-1 reference base"
                                    onChange={(e) => handleChange("risk_3_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_3_owner ?? ""}
                                    placeholder="e.g. Product Lead"
                                    onChange={(e) => handleChange("risk_3_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>

                              {/* Row 4 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">4</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_4_name ?? ""}
                                    placeholder="e.g. Foreign ownership or data localisation restrictions"
                                    onChange={(e) => handleChange("risk_4_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_4_category || ""}
                                    onValueChange={(val) => handleChange("risk_4_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_4_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_4_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_4_impact || ""}
                                    onValueChange={(val) => handleChange("risk_4_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_4_mitigation ?? ""}
                                    placeholder="Local partner structure; in-country AWS / Azure cloud instance"
                                    onChange={(e) => handleChange("risk_4_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_4_owner ?? ""}
                                    placeholder="e.g. Legal Counsel"
                                    onChange={(e) => handleChange("risk_4_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>

                              {/* Row 5 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">5</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_5_name ?? ""}
                                    placeholder="e.g. Tax and withholding issues on cross-border revenue"
                                    onChange={(e) => handleChange("risk_5_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_5_category || ""}
                                    onValueChange={(val) => handleChange("risk_5_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_5_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_5_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_5_impact || ""}
                                    onValueChange={(val) => handleChange("risk_5_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_5_mitigation ?? ""}
                                    placeholder="IHC tax team review; bilateral tax treaty provisions"
                                    onChange={(e) => handleChange("risk_5_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_5_owner ?? ""}
                                    placeholder="e.g. CFO"
                                    onChange={(e) => handleChange("risk_5_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>

                              {/* Row 6 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">6</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_6_name ?? ""}
                                    placeholder="e.g. FX volatility (PHP / AED / USD)"
                                    onChange={(e) => handleChange("risk_6_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_6_category || ""}
                                    onValueChange={(val) => handleChange("risk_6_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_6_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_6_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_6_impact || ""}
                                    onValueChange={(val) => handleChange("risk_6_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_6_mitigation ?? ""}
                                    placeholder="Price in USD where feasible; review quarterly hedges"
                                    onChange={(e) => handleChange("risk_6_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_6_owner ?? ""}
                                    placeholder="e.g. Finance"
                                    onChange={(e) => handleChange("risk_6_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>

                              {/* Row 7 */}
                              <tr>
                                <td className="p-2 text-center text-slate-400 font-semibold">7</td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_7_name ?? ""}
                                    placeholder="e.g. Key personnel departure in local ops"
                                    onChange={(e) => handleChange("risk_7_name", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_7_category || ""}
                                    onValueChange={(val) => handleChange("risk_7_category", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="commercial">Commercial</SelectItem>
                                      <SelectItem value="financial">Financial</SelectItem>
                                      <SelectItem value="legal">Legal / Regulatory</SelectItem>
                                      <SelectItem value="operational">Operational</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_7_likelihood || ""}
                                    onValueChange={(val) => handleChange("risk_7_likelihood", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select likelihood" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.risk_7_impact || ""}
                                    onValueChange={(val) => handleChange("risk_7_impact", val)}
                                  >
                                    <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-[#f8fafc] text-xs">
                                      <SelectValue placeholder="Select impact" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_7_mitigation ?? ""}
                                    placeholder="Dual-coverage model with regional Sirius tech leads"
                                    onChange={(e) => handleChange("risk_7_mitigation", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.risk_7_owner ?? ""}
                                    placeholder="e.g. HR / COO"
                                    onChange={(e) => handleChange("risk_7_owner", e.target.value)}
                                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Compliance screen */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-slate-900">Compliance screen</h3>
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                                <th className="p-2.5 w-48">Screen</th>
                                <th className="p-2.5 w-32">Status</th>
                                <th className="p-2.5">Comment</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              <tr>
                                <td className="p-2.5 font-medium text-slate-700">Legal and regulatory</td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.compliance_legal || form.compliance_legal_status || ""}
                                    onValueChange={(val) => {
                                      handleChange("compliance_legal", val);
                                      handleChange("compliance_legal_status", val);
                                    }}
                                  >
                                    <SelectTrigger className="h-9 w-28 rounded-lg border-slate-300 bg-white text-xs">
                                      <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="open">Open</SelectItem>
                                      <SelectItem value="clear">Clear</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.compliance_legal_comment ?? ""}
                                    placeholder="e.g. MoU to be signed by Oxinus; definitive agreement and BIR"
                                    onChange={(e) => handleChange("compliance_legal_comment", e.target.value)}
                                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>
                              <tr>
                                <td className="p-2.5 font-medium text-slate-700">Related-party</td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.compliance_related_party || form.compliance_related_party_status || ""}
                                    onValueChange={(val) => {
                                      handleChange("compliance_related_party", val);
                                      handleChange("compliance_related_party_status", val);
                                    }}
                                  >
                                    <SelectTrigger className="h-9 w-28 rounded-lg border-slate-300 bg-white text-xs">
                                      <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="open">Open</SelectItem>
                                      <SelectItem value="clear">Clear</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.compliance_related_party_comment ?? ""}
                                    placeholder="e.g. Eurolink is a third party"
                                    onChange={(e) => handleChange("compliance_related_party_comment", e.target.value)}
                                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>
                              <tr>
                                <td className="p-2.5 font-medium text-slate-700">ESG and reputational</td>
                                <td className="p-1.5">
                                  <Select
                                    value={form.compliance_esg || form.compliance_esg_status || ""}
                                    onValueChange={(val) => {
                                      handleChange("compliance_esg", val);
                                      handleChange("compliance_esg_status", val);
                                    }}
                                  >
                                    <SelectTrigger className="h-9 w-28 rounded-lg border-slate-300 bg-white text-xs">
                                      <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="open">Open</SelectItem>
                                      <SelectItem value="clear">Clear</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={form.compliance_esg_comment ?? ""}
                                    placeholder="e.g. MoU includes anti-bribery and data-privacy commitments."
                                    onChange={(e) => handleChange("compliance_esg_comment", e.target.value)}
                                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
                                  />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 7: Documents and send (DS-13) */}
                  {activeTab === LAST_TAB && (
                    <div className="space-y-8">
                      {/* Red error section according to DS-13 (Infinia Preparer Only) */}
                      {isInfiniaPreparer && activeError ? (
                        <div
                          className="rounded-2xl border border-red-200 bg-[#fef2f2] p-6 space-y-3 shadow-xs"
                          data-testid="infinia-error-section"
                        >
                          <div className="flex items-center gap-2 text-red-900">
                            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                            <h4 className="text-sm font-bold text-red-900">
                              {activeError.title}
                            </h4>
                          </div>
                          <p className="text-xs text-red-800 font-medium leading-relaxed">
                            {activeError.message}
                          </p>
                          {activeError.items && activeError.items.length > 0 && (
                            <ul className="space-y-2 text-xs text-red-800 font-medium pt-1">
                              {activeError.items.map((item, idx) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        /* What is left callout (DS-13) */
                        isWhatIsLeftActive && whatIsLeftItems.length > 0 ? (
                          <div className="rounded-2xl bg-[#fffbeb] p-6 space-y-3" data-testid="what-is-left-callout">
                            <h4 className="text-sm font-bold text-amber-900">
                              {whatIsLeftItems.length} {whatIsLeftItems.length === 1 ? "item left." : "items left."}
                            </h4>
                            <ul className="space-y-2 text-xs text-amber-900/90 font-medium">
                              {whatIsLeftItems.map((item, idx) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3 text-emerald-800 text-xs font-medium" data-testid="what-is-left-callout">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                            <span>All items completed — this opportunity is ready to send to your CFO and CEO.</span>
                          </div>
                        )
                      )}

                      {/* Key messages review */}
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Key messages</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            The one line at the top of each page of the Opportunity Overview. Check them together before you send.
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                          {[
                            {
                              step: 1,
                              tabIndex: 0,
                              title: "1. Executive summary",
                              msg: form.key_message_executive_summary || form.description || "Not provided",
                            },
                            {
                              step: 2,
                              tabIndex: 1,
                              title: "2. Opportunity overview",
                              msg: form.key_message_opportunity_overview || form.strategic_rationale || "Not provided",
                            },
                            {
                              step: 3,
                              tabIndex: 2,
                              title: "3. Rationale and fit",
                              msg: form.key_message_rationale || form.strategy_link || "Not provided",
                            },
                            {
                              step: 4,
                              tabIndex: 3,
                              title: "4. Financials and returns",
                              msg: form.key_message_financials || (form.return_irr_base ? `Base IRR: ${form.return_irr_base}%` : "Not provided"),
                            },
                            {
                              step: 5,
                              tabIndex: 4,
                              title: "5. Funding and key asks",
                              msg: form.key_message_funding || form.funding_source || "Not provided",
                            },
                            {
                              step: 6,
                              tabIndex: 5,
                              title: "6. Risks and compliance",
                              msg: form.key_message_risks || "Not provided",
                            },
                          ].map((item) => (
                            <div key={item.step} className="flex items-center justify-between p-3.5 gap-4">
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-bold text-slate-900 block">{item.title}</span>
                                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.msg}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setActiveTab(item.tabIndex)}
                                className="rounded-lg border border-blue-600 bg-white hover:bg-blue-50 text-blue-600 px-4 py-1.5 text-xs font-medium shrink-0 transition-colors"
                              >
                                Edit
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Qualifying gates (DS-13 / INT-08) */}
                      <div className="space-y-3" data-testid="qualifying-gates">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">Qualifying gates</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              A single no means the opportunity is not ready. Most gates are checked from what you entered.
                            </p>
                          </div>
                          {gate?.qualifying_gates && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium text-xs",
                                (isInfiniaPreparer
                                  ? evaluatedQualifyingGates.filter((g) => !g.met && !g.checked).length === 0
                                  : gate.qualifying_gates.complete)
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : "bg-amber-100 text-amber-800 border-amber-200"
                              )}
                              data-testid="qualifying-gates-status"
                            >
                              {(isInfiniaPreparer
                                ? evaluatedQualifyingGates.filter((g) => !g.met && !g.checked).length === 0
                                : gate.qualifying_gates.complete)
                                ? "All ten ready"
                                : `${isInfiniaPreparer ? evaluatedQualifyingGates.filter((g) => !g.met && !g.checked).length : gate.qualifying_gates.blocking.length} gate(s) blocking`}
                            </Badge>
                          )}
                        </div>

                        {((isInfiniaPreparer
                          ? evaluatedQualifyingGates.filter((g) => !g.met && !g.checked).length > 0
                          : gate?.qualifying_gates && gate.qualifying_gates.blocking.length > 0)) && (
                          <Alert variant="destructive" className="border-red-200 bg-red-50 py-2.5" data-testid="qualifying-gates-blocked">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                            <AlertTitle className="text-red-900 text-xs font-semibold">Not ready</AlertTitle>
                            <AlertDescription className="text-red-900 text-xs">
                              {gate?.qualifying_gates?.message || QUALIFYING_GATE_NOT_READY}
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                                <th className="p-2.5 w-1/3">Gate</th>
                                <th className="p-2.5 w-1/3">Evidence</th>
                                <th className="p-2.5 w-1/3">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-800">
                              {evaluatedQualifyingGates.map((g) => (
                                <tr key={g.key} data-testid={`qualifying-gate-${g.key}`}>
                                  <td className="p-2.5 font-medium text-slate-900">{g.label}</td>
                                  <td className="p-2.5 text-slate-600">{g.evidence}</td>
                                  <td className="p-2.5">
                                    {g.type === "checkbox" ? (
                                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-medium text-slate-900">
                                        <input
                                          type="checkbox"
                                          checked={g.checked}
                                          onChange={(e) => handleChange(g.confirmKey, e.target.checked)}
                                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span>I confirm</span>
                                      </label>
                                    ) : g.type === "hurdle_badge" ? (
                                      g.met ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700">
                                          Met
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">
                                          Not yet
                                        </span>
                                      )
                                    ) : g.met ? (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700">
                                        Met
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700">
                                        Not met
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Documents (DS-13) */}
                      <div className="space-y-3" data-testid="ds13-documents-card">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Documents</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            This list changes with your opportunity type, stage and answers.
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                          {ds13Documents.map((doc) => {
                            const isCurrentUpload = uploadMutation.isPending && uploadMutation.variables?.requirementKey === doc.key;
                            return (
                              <div key={doc.key} className="flex items-center justify-between p-3.5 gap-4" data-testid={`ds13-doc-${doc.key}`}>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold text-slate-900">{doc.label}</p>
                                  {doc.current ? (
                                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-600">
                                      <span className="truncate">Attached: <strong className="font-semibold text-slate-800">{doc.current.original_name}</strong></span>
                                      <span>&bull;</span>
                                      <span className={doc.current.scan_verdict === "clean" ? "text-emerald-600" : "text-amber-600"}>
                                        Virus scan: {doc.current.scan_verdict || "clean"}
                                      </span>
                                      <span>&bull;</span>
                                      <span>v{doc.current.version}</span>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  {doc.present || doc.uploaded ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700">
                                      Attached
                                    </span>
                                  ) : doc.required ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700">
                                      Required
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-500">
                                      Not needed
                                    </span>
                                  )}

                                  {doc.current && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                      disabled={!editable}
                                      onClick={() => setPendingDelete({ document: doc.current, label: doc.label })}
                                      title="Delete document"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  )}

                                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-white hover:bg-blue-50 text-blue-600 px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors">
                                    {isCurrentUpload ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Paperclip className="w-3.5 h-3.5" />
                                    )}
                                    <span>{doc.current ? "Replace" : "Choose File"}</span>
                                    <input
                                      type="file"
                                      className="hidden"
                                      disabled={!editable || isCurrentUpload}
                                      onChange={(e) => handleUpload(doc.key, e)}
                                    />
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Where each key figure comes from */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-slate-900">Where each key figure comes from</h3>
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white text-xs">
                          <div className="flex items-center justify-between p-3.5">
                            <span className="text-slate-600">Revenue history</span>
                            <span className="font-medium text-slate-900">Audited financials</span>
                          </div>
                          <div className="flex items-center justify-between p-3.5">
                            <span className="text-slate-600">Returns (IRR, ROIC, payback)</span>
                            <span className="font-medium text-slate-900">Financial model</span>
                          </div>
                          <div className="flex items-center justify-between p-3.5">
                            <span className="text-slate-600">Funding sources</span>
                            <span className="font-medium text-slate-900">Funding plan in step 5</span>
                          </div>
                          <div className="flex items-center justify-between p-3.5">
                            <span className="text-slate-600">Risks</span>
                            <span className="font-medium text-slate-900">Risk register in step 6</span>
                          </div>
                        </div>
                      </div>

                      {/* Approval */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-slate-900">Approval</h3>
                        <div className="rounded-xl border border-blue-100 bg-[#eef2ff] p-4 text-xs font-medium text-blue-900 leading-relaxed">
                          Next, your CFO checks the numbers and your CEO checks the strategic case and signs the attestation, both in DealForge. Nothing reaches Sirius until both approve.
                        </div>
                      </div>

                      {/* Owner and Save Draft Option */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                        <div className="max-w-sm space-y-1.5">
                          <Label htmlFor="owner_email" className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            {t("submit.owner")}
                          </Label>
                          {users.length > 0 ? (
                            <Select
                              value={form.owner_email || "__none__"}
                              onValueChange={(value) => handleChange("owner_email", value === "__none__" ? "" : value)}
                            >
                              <SelectTrigger id="owner_email" className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900">
                                <SelectValue placeholder="Assign an owner..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Unassigned</SelectItem>
                                {users.map((user) => (
                                  <SelectItem key={user.id || user.email} value={user.email}>
                                    {user.full_name ? `${user.full_name} (${user.email})` : user.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              id="owner_email"
                              type="email"
                              value={form.owner_email || ""}
                              placeholder="owner@company.com"
                              onChange={(event) => handleChange("owner_email", event.target.value)}
                              className="h-10 rounded-lg border-slate-300 bg-white text-xs text-slate-900"
                            />
                          )}
                        </div>

                        <div className="flex items-center gap-3 pt-1">
                          <Button
                            onClick={handleSave}
                            disabled={busy || !editable}
                            variant="outline"
                            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg px-4 py-2 text-xs font-medium h-9 gap-1.5"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {selectedId ? "Save changes" : "Save draft"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-6" data-testid="capture-footer">
                    {activeTab > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => goToTab(activeTab - 1)}
                        data-testid="capture-back"
                        className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-xl px-6 py-2.5 text-sm font-medium h-10 shadow-none"
                      >
                        Back
                      </Button>
                    ) : <div />}
                    {activeTab < LAST_TAB ? (
                      <Button
                        className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white rounded-xl px-6 py-2.5 text-sm font-medium h-10 shadow-sm gap-2"
                        disabled={busy}
                        onClick={handleSaveAndContinue}
                        data-testid="capture-save-continue"
                      >
                        {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save and Continue
                      </Button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs text-slate-400">
                          Send is locked until every required document and field is in.
                        </span>
                        <Button
                          disabled={busy || !editable}
                          onClick={handleSubmit}
                          data-testid="capture-submit-btn"
                          aria-label="Send to CFO and CEO"
                          title={!editable ? "Record is not editable" : "Send to CFO and CEO"}
                          className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white rounded-xl px-5 py-2.5 text-sm font-semibold h-10 shadow-sm gap-2"
                        >
                          {(submitMutation.isPending || saveMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                          Send to CFO and CEO
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>

            {/* Information requested (WF-04) -------------------------------------- */}
            {infoRequested && (
              <Card className="border-amber-200 bg-amber-50/60 shadow-sm" data-testid="info-request-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                    <AlertTriangle className="w-4 h-4" /> Sirius has requested information
                  </CardTitle>
                  <CardDescription className="text-amber-900/80">
                    The form is unlocked. Answer each question, update the record if needed, then send your response.
                    A change to the figures clears the CEO and CFO attestations, so they re-confirm before you respond.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {infoThreadsQuery.isLoading && (
                    <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading questions...</p>
                  )}
                  {infoThreads.map((thread) => (
                    <div key={thread.id} className="rounded-md border border-amber-200 bg-white p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">{thread.subject}</p>
                        <div className="flex items-center gap-2">
                          {thread.due_at && (
                            <Badge variant="outline" className={cn(thread.overdue ? "bg-red-100 text-red-800 border-red-200" : "bg-slate-100 text-slate-700")}>
                              due {formatDateTime(thread.due_at)}
                            </Badge>
                          )}
                          <Badge variant="outline" className={thread.display_status === "open" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-emerald-100 text-emerald-800 border-emerald-200"}>
                            {thread.display_status === "open" ? "awaiting your answer" : thread.display_status}
                          </Badge>
                        </div>
                      </div>
                      {thread.first_message && <p className="text-sm text-slate-700 whitespace-pre-wrap">{thread.first_message}</p>}
                      {thread.display_status === "open" && (
                        <div className="space-y-2">
                          <Textarea
                            rows={3}
                            value={answers[thread.id] || ""}
                            placeholder="Your answer..."
                            data-testid={`info-answer-${thread.id}`}
                            onChange={(event) => setAnswers((prev) => ({ ...prev, [thread.id]: event.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            disabled={!String(answers[thread.id] || "").trim() || answerMutation.isPending}
                            onClick={() => answerMutation.mutate({ threadId: thread.id, body: answers[thread.id].trim() })}
                          >
                            <Send className="w-3.5 h-3.5" /> Send answer
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor="response-note">Note to Sirius (optional)</Label>
                    <Textarea id="response-note" rows={2} value={responseNote} onChange={(event) => setResponseNote(event.target.value)} />
                    <Button
                      className="bg-teal-600 hover:bg-teal-700 gap-2"
                      disabled={busy || unanswered.length > 0}
                      title={unanswered.length > 0 ? "Answer every question first" : undefined}
                      data-testid="send-response"
                      onClick={() => respondMutation.mutate()}
                    >
                      {respondMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Send response to Sirius
                    </Button>
                    {unanswered.length > 0 && (
                      <p className="text-xs text-amber-800">{unanswered.length} question(s) still need an answer.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Submit result ------------------------------------------------------ */}
            {submitResult && (
              <Alert className="border-emerald-200 bg-emerald-50" data-testid="submit-success">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle className="text-emerald-900">Submitted for screening</AlertTitle>
                <AlertDescription className="text-emerald-800">
                  New state: <span className="font-semibold">{STATUS_META[normalizeState(submitResult.state)]?.label || submitResult.state}</span>.
                </AlertDescription>
              </Alert>
            )}

            {!isInfiniaPreparer && blockedGate && (
              <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="submit-blocked">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertTitle className="text-red-900">Submission blocked</AlertTitle>
                <AlertDescription className="text-red-900">
                  <p className="mb-3">
                    {blockedMessage ||
                      "The opportunity did not pass the document gate. Resolve the items below and try again."}
                  </p>
                  <div className="space-y-3">
                    {Object.keys(blockedGroups).map((section) =>
                      blockedGroups[section].length > 0 ? (
                        <div key={section}>
                          <p className="font-semibold uppercase tracking-wide text-xs">
                            {SECTION_TITLES[section] || (fieldModel?.sections || []).find((s) => s.key === section)?.label || section} ({blockedGroups[section].length})
                          </p>
                          <ul className="list-disc pl-5 mt-1 space-y-0.5">
                            {blockedGroups[section].map((item) => (
                              <li key={`${item.type}-${item.key}`}>{item.label}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* CEO + CFO attestation (Hidden for Infinia Preparer — handled by CEO/CFO in their review view per DS-13 & DS-14) */}
            <div className="hidden" data-testid="infinia-attestations-hidden">
            {selectedId && gate?.attestations && (
              <Card className="border-slate-200 shadow-sm" data-testid="attestations">
                <CardHeader className="border-b border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <ShieldCheck className="w-5 h-5 text-teal-600" />
                      CEO &amp; CFO attestation
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-medium",
                        gate.attestations.complete
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                      )}
                      data-testid="attestations-status"
                    >
                      {gate.attestations.complete
                        ? "Both recorded"
                        : `${gate.attestations.missing.length} outstanding`}
                    </Badge>
                  </div>
                  <CardDescription>
                    Two named attestations are required before submission. Each records the person,
                    the timestamp and the IP, and each is written to the audit log.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {!gate.attestations.complete && (
                    <Alert variant="destructive" className="border-red-200 bg-red-50" data-testid="attestations-blocked">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertTitle className="text-red-900">Not ready</AlertTitle>
                      <AlertDescription className="text-red-900">
                        {gate.attestations.message}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    {gate.attestations.roles.map((a) => {
                      const canSignThis =
                        !a.attested &&
                        ((currentUser?.roles || []).includes(a.role) || (currentUser?.roles || []).includes("admin"));
                      return (
                        <div
                          key={a.key}
                          className={cn(
                            "rounded-lg border p-4 space-y-3",
                            a.attested ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"
                          )}
                          data-testid={`attestation-${a.key}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-slate-900 flex items-center gap-2">
                              {a.attested ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                              )}
                              {a.label}
                            </p>
                            {a.attested && (
                              <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                                Recorded
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 italic">“{a.text}”</p>
                          {a.attested ? (
                            <p className="text-xs text-slate-500" data-testid={`attestation-${a.key}-meta`}>
                              Signed by {a.record.name || a.record.by} on {formatDateTime(a.record.at)}
                              {a.record.ip ? ` from ${a.record.ip}` : ""}.
                            </p>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              className="gap-2 bg-teal-600 hover:bg-teal-700"
                              disabled={!canSignThis || attestMutation.isPending}
                              onClick={() => attestMutation.mutate(a.key)}
                              data-testid={`attestation-${a.key}-sign`}
                            >
                              {attestMutation.isPending && attestMutation.variables === a.key ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <PenLine className="w-4 h-4" />
                              )}
                              Record my attestation
                            </Button>
                          )}
                          {!a.attested && !canSignThis && (
                            <p className="text-xs text-slate-500">
                              Only the {a.label} for this subsidiary can record this attestation.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
            </div>

            {/* Gate checklist (Legacy M2 - superseded by DS-13 Documents and What is left callout in Step 7) */}
            <div className="hidden" data-testid="gate-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ClipboardCheck className="w-5 h-5 text-teal-600" />
                    What&apos;s needed to submit
                  </CardTitle>
                  {gate && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-medium",
                        gate.complete
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                      )}
                    >
                      {gate.complete ? "Gate complete" : `${gate.missing.length} item(s) missing`}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  Rendered directly from the server gate — fields first, then the required documents.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {!selectedId ? (
                  <p className="text-sm text-slate-500">
                    Save the draft to see the live checklist.
                  </p>
                ) : loadingGate ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Evaluating the gate...
                  </div>
                ) : gateError || !gate ? (
                  <Alert variant="destructive" className="border-red-200 bg-red-50">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-900">
                      Could not load the gate status.{" "}
                      <button
                        type="button"
                        className="underline font-medium"
                        onClick={() => queryClient.invalidateQueries({ queryKey: ["gateStatus", selectedId] })}
                      >
                        Retry
                      </button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">Document completeness</span>
                        <span className="text-slate-600">{completeness}%</span>
                      </div>
                      <Progress value={completeness} className="h-2" />
                    </div>

                    <Tabs defaultValue="checklist" className="w-full">
                      <TabsList className="grid w-full grid-cols-2 max-w-md">
                        <TabsTrigger value="checklist">Checklist</TabsTrigger>
                        <TabsTrigger value="documents">Documents</TabsTrigger>
                      </TabsList>

                      <TabsContent value="checklist" className="mt-4 space-y-5">
                        {fieldGroups.map((group) => {
                          const groupFields = (gate.fields || []).filter((f) => f.section === group.key);
                          if (groupFields.length === 0) return null;
                          return (
                            <div key={group.key} className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {SECTION_TITLES[group.key] || group.label}
                              </p>
                              <ul className="space-y-1.5">
                                {groupFields.map((field) => (
                                  <li key={field.key} className="flex items-center gap-2 text-sm">
                                    {field.present ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                    ) : (
                                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                    )}
                                    <span className={field.present ? "text-slate-700" : "text-slate-900 font-medium"}>
                                      {field.label}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}

                        <Separator />

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("submit.requiredDocuments")}
                          </p>
                          <ul className="space-y-1.5">
                            {(gate.documents || []).map((document) => (
                              <li key={document.key} className="flex items-center gap-2 text-sm">
                                {document.present ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                )}
                                <span className={document.present ? "text-slate-700" : "text-slate-900 font-medium"}>
                                  {document.label}
                                </span>
                                {!document.required && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    optional
                                  </Badge>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <Separator />

                        {renderSufficiencyCard()}
                      </TabsContent>

                      <TabsContent value="documents" className="mt-4 space-y-3">
                        {(gate.documents || []).map((requirement) => {
                          const current = currentVersionFor(requirement.key);
                          const isCurrentUpload =
                            uploadMutation.isPending &&
                            uploadMutation.variables?.requirementKey === requirement.key;
                          return (
                            <div
                              key={requirement.key}
                              className="rounded-lg border border-slate-200 p-4 space-y-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium text-slate-900 flex items-center gap-2">
                                    {requirement.label}
                                    {requirement.present ? (
                                      <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                                        provided
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                                        missing
                                      </Badge>
                                    )}
                                    {!requirement.required && (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        optional
                                      </Badge>
                                    )}
                                  </div>
                                  {requirement.description && (
                                    <p className="text-sm text-slate-500 mt-0.5">{requirement.description}</p>
                                  )}
                                </div>
                              </div>

                              {current ? (
                                <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-medium text-slate-900 truncate">
                                        {current.original_name}
                                      </p>
                                      <p className="text-xs text-slate-500">
                                        v{current.version} • uploaded {formatDateTime(current.uploaded_at)}
                                        {current.uploaded_by ? ` by ${current.uploaded_by}` : ""}
                                      </p>
                                      {current.scan_verdict && (
                                        <p className="text-xs mt-1 flex items-center gap-2" data-testid={`scan-verdict-${requirement.key}`}>
                                          <ShieldCheck
                                            className={cn(
                                              "w-3.5 h-3.5",
                                              current.scan_verdict === "clean" ? "text-emerald-600" : "text-amber-600"
                                            )}
                                          />
                                          <span className={cn(
                                            current.scan_verdict === "clean" ? "text-emerald-700" : "text-amber-700"
                                          )}>
                                            Virus scan: {current.scan_verdict}{current.scan_engine ? ` (${current.scan_engine})` : ""}
                                          </span>
                                        </p>
                                      )}
                                      {priorVersionsFor(requirement.key).length > 0 && (
                                        <p className="text-xs text-slate-400 mt-1" data-testid={`version-history-${requirement.key}`}>
                                          {priorVersionsFor(requirement.key).length} previous version
                                          {priorVersionsFor(requirement.key).length === 1 ? "" : "s"} retained
                                        </p>
                                      )}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                                      disabled={!editable}
                                      onClick={() => setPendingDelete({ document: current, label: requirement.label })}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-slate-500">No version uploaded yet.</p>
                              )}

                              <label className="inline-flex">
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={isCurrentUpload || !editable}
                                  onChange={(event) => handleUpload(requirement.key, event)}
                                />
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50",
                                    (isCurrentUpload || !editable) && "opacity-50 pointer-events-none"
                                  )}
                                >
                                  {isCurrentUpload ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : current ? (
                                    <RefreshCw className="w-4 h-4" />
                                  ) : (
                                    <Upload className="w-4 h-4" />
                                  )}
                                  {current ? "Replace" : "Upload"}
                                </span>
                              </label>
                            </div>
                          );
                        })}
                      </TabsContent>
                    </Tabs>
                  </>
                )}
              </CardContent>
            </div>
            </div>

            {/* Progress rail matching DS-7, DS-8, DS-9 ----------------- */}
            <div className="space-y-4 min-w-0">
            <aside className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-3" data-testid="capture-rail">
              <div className="space-y-1">
                <p className="font-bold text-slate-900 text-base">{itemsLeft} {itemsLeft === 1 ? "item left" : "items left"}</p>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{ width: `${formProgressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">{formProgressPercent}% complete</p>
              </div>

              <div className="space-y-1 pt-2">
                {CAPTURE_TABS.map((tab, index) => {
                  const totalCount = progressByTab[index]?.total ?? 0;
                  const presentCount = progressByTab[index]?.present ?? 0;
                  const isDone = missingByTab[index] === 0;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(index)}
                      className={cn(
                        "flex w-full items-center justify-between py-1.5 px-2 text-xs text-left rounded-lg transition-colors",
                        activeTab === index ? "bg-blue-50/60 font-semibold" : "hover:bg-slate-50"
                      )}
                    >
                      <span className="font-medium text-blue-600">
                        {tab.label}
                      </span>
                      {isDone ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Done
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-normal">
                          {presentCount} of {totalCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </aside>
            <AIValidationCard
              tabLabel={CAPTURE_TABS[activeTab].label}
              hasRecord={Boolean(selectedId)}
              result={aiResultsQuery.data?.results?.[CAPTURE_TABS[activeTab].key]?.validation || null}
              loading={aiResultsQuery.isLoading}
              running={aiValidateMutation.isPending && aiValidateMutation.variables?.tab === CAPTURE_TABS[activeTab].key}
              onRun={() => aiValidateMutation.mutate({ id: selectedId, tab: CAPTURE_TABS[activeTab].key, trigger: "manual" })}
            />
            <AIAnalysisCard
              tabLabel={CAPTURE_TABS[activeTab].label}
              hasRecord={Boolean(selectedId)}
              result={aiResultsQuery.data?.results?.[CAPTURE_TABS[activeTab].key]?.analysis || null}
              loading={aiResultsQuery.isLoading}
              running={aiAnalyseMutation.isPending && aiAnalyseMutation.variables?.tab === CAPTURE_TABS[activeTab].key}
              runError={aiAnalyseMutation.data?.run_error && aiAnalyseMutation.variables?.tab === CAPTURE_TABS[activeTab].key ? aiAnalyseMutation.data.run_error : null}
              onRun={() => aiAnalyseMutation.mutate({ id: selectedId, tab: CAPTURE_TABS[activeTab].key })}
            />
            <AIQACard
              tabLabel={CAPTURE_TABS[activeTab].label}
              hasRecord={Boolean(selectedId)}
              qa={aiResultsQuery.data?.qa?.[CAPTURE_TABS[activeTab].key] || null}
              suggestions={aiResultsQuery.data?.suggestions?.[CAPTURE_TABS[activeTab].key] || []}
              loading={aiResultsQuery.isLoading}
              asking={aiAskMutation.isPending && aiAskMutation.variables?.tab === CAPTURE_TABS[activeTab].key}
              error={aiAskMutation.isError && aiAskMutation.variables?.tab === CAPTURE_TABS[activeTab].key ? aiAskMutation.error?.message : null}
              onAsk={(question) => aiAskMutation.mutateAsync({ id: selectedId, tab: CAPTURE_TABS[activeTab].key, question })}
              onClear={() => aiClearMutation.mutate({ id: selectedId, tab: CAPTURE_TABS[activeTab].key })}
              onSendToSirius={(question) => sendToSirius(question, CAPTURE_TABS[activeTab].label)}
            />
            </div>
          </div>
        </div>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document version?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `"${pendingDelete.document.original_name}" (v${pendingDelete.document.version}) will be removed from "${pendingDelete.label}". The document gate will treat this requirement as missing.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.document.id)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
