import { useMemo, useState } from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Save,
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

// Field input types the form renders inline (arrays such as the risk register
// are captured as text blocks, so every model type maps to a control).
const FIELD_TYPES = new Set(["text", "number", "select", "textarea"]);

function emptyForm(ownerEmail) {
  return { owner_email: ownerEmail || "" };
}

function toForm(record, allFields) {
  const form = emptyForm(record?.owner_email);
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

function buildPayload(form, allFields) {
  const payload = { status: form.status || DRAFT_STATUS, owner_email: form.owner_email || "" };
  for (const field of allFields) {
    const raw = form[field.key];
    if (field.type === "number") {
      payload[field.key] = raw === "" || raw === null || raw === undefined ? null : Number(raw);
    } else {
      payload[field.key] = raw ?? "";
    }
  }
  payload.financials = financialsFromForm(form.financials);
  payload.funding_plan = fundingPlanFromForm(form.funding_plan);
  payload.valuation_comparables = comparablesFromForm(form.valuation_comparables);
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

export default function SubmitOpportunity() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(() => emptyForm(""));
  const [submitResult, setSubmitResult] = useState(null);
  const [blockedGate, setBlockedGate] = useState(null);
  const [blockedMessage, setBlockedMessage] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // Pre-form self-screen (W1-01 / INT-02): six questions answered before the
  // capture form opens. A hard stop halts the flow; flags are carried forward.
  const [screenOpen, setScreenOpen] = useState(true);
  const [screenAnswers, setScreenAnswers] = useState(() => ({ related_party: "no" }));
  const [screenResult, setScreenResult] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.auth.me(),
  });

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

  const { data: gateStatus, isLoading: loadingGate, isError: gateError } = useQuery({
    queryKey: ["gateStatus", selectedId],
    queryFn: () => api.gate.status(selectedId),
    enabled: Boolean(selectedId),
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["gateDocuments", selectedId],
    queryFn: () => api.gate.documents(selectedId),
    enabled: Boolean(selectedId),
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

  // The funding sources and uses table (W2-06 / FIN-06). The gate reports each
  // source and use with its amount and percentage, whether sources equal uses,
  // and the funding-hierarchy signal. Advisory only — it never blocks.
  const sourcesUsesConfig = useMemo(() => fieldModel?.sources_uses || null, [fieldModel]);
  const sourcesUsesGate = gate?.sources_uses || null;

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

  function invalidateFor(id) {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    if (id) {
      queryClient.invalidateQueries({ queryKey: ["gateStatus", id] });
      queryClient.invalidateQueries({ queryKey: ["gateDocuments", id] });
    }
  }

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      selectedId
        ? api.entities.DealOpportunity.update(selectedId, payload)
        : api.entities.DealOpportunity.create(payload),
    onSuccess: (record) => {
      setSelectedId(record.id);
      setForm((prev) => ({ ...toForm(record, allFields), status: record.status || prev.status }));
      setSubmitResult(null);
      setBlockedGate(null);
      setBlockedMessage(null);
      invalidateFor(record.id);
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

  const handleScreenChange = (key, value) => {
    setScreenAnswers((prev) => ({ ...prev, [key]: value }));
    setScreenResult(null);
  };

  const handleRunScreen = () => {
    screenMutation.mutate(screenAnswers);
  };

  // A passing/flagged screen seeds the matching header fields so the preparer
  // does not answer the same questions twice, then opens the capture form.
  const proceedToForm = () => {
    const seeds = {};
    for (const q of screenQuestions) {
      if (screenAnswers[q.key] !== undefined && screenAnswers[q.key] !== "") {
        seeds[q.field] = screenAnswers[q.key];
      }
    }
    setForm((prev) => ({ ...prev, ...seeds }));
    setScreenOpen(false);
  };

  const startNew = () => {
    setSelectedId(null);
    setForm(emptyForm(currentUser?.email));
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
  };

  const selectOpportunity = (opportunity) => {
    setSelectedId(opportunity.id);
    setForm({ ...toForm(opportunity, allFields), status: opportunity.status || DRAFT_STATUS });
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
  };

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  const handleSave = () => {
    const payload = buildPayload(form, allFields);
    if (!payload.owner_email) payload.owner_email = currentUser?.email || "";
    saveMutation.mutate(payload);
  };

  const handleSubmit = () => {
    if (!selectedId) return;
    setSubmitResult(null);
    setBlockedGate(null);
    setBlockedMessage(null);
    submitMutation.mutate();
  };

  const handleUpload = (requirementKey, event) => {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate({ requirementKey, file });
    event.target.value = "";
  };

  const currentVersionFor = (key) =>
    documents.find((doc) => doc.requirement_key === key && doc.is_current) || null;

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

  const renderField = (field) => {
    if (field.type === "textarea") {
      return (
        <Textarea
          id={field.key}
          value={form[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => handleChange(field.key, event.target.value)}
          rows={3}
        />
      );
    }
    if (field.type === "select") {
      const options = field.options || [];
      return (
        <Select value={form[field.key] || ""} onValueChange={(value) => handleChange(field.key, value)}>
          <SelectTrigger id={field.key}>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
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
            className="border-slate-200 shadow-sm"
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

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Opportunities list -------------------------------------------------- */}
          <div className="lg:col-span-1 space-y-4">
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
          <div className="lg:col-span-2 space-y-6">
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
                  Saved as a <span className="font-medium text-slate-700">draft</span> until it passes the gate.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {fieldGroups.map((group) => (
                  <div key={group.key} className="space-y-4">
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
                  New state: <span className="font-semibold">{submitResult.state}</span>.
                </AlertDescription>
              </Alert>
            )}

            {blockedGate && (
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

            {/* Gate checklist ----------------------------------------------------- */}
            <Card className="border-slate-200 shadow-sm">
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
                                  <p className="font-medium text-slate-900 flex items-center gap-2">
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
                                  </p>
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
}
