import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  Gavel,
  GitBranch,
  Inbox,
  LayoutGrid,
  Loader2,
  Link2,
  ShieldAlert,
  Target,
  XCircle,
  ExternalLink,
} from "lucide-react";
import SiriusMemoDialog from "@/components/pipeline/SiriusMemoDialog";

// ---------------------------------------------------------------------------
// E6 — Sirius screening board.
//
// The board, the review queue, the subsidiary view, the alignment score and
// every permitted state change are computed server-side. This page renders the
// payloads verbatim (api.pipeline.*) and never re-derives gate/score/state logic.
// ---------------------------------------------------------------------------

const BOARD_STATES = ["submission", "screening", "refinement", "approval", "returned", "declined", "withdrawn"];

const STATE_META = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  submission: { label: "Submission", className: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500" },
  screening: { label: "Screening", className: "bg-blue-100 text-blue-800 border-blue-200", dot: "bg-blue-500" },
  refinement: { label: "Refinement", className: "bg-indigo-100 text-indigo-800 border-indigo-200", dot: "bg-indigo-500" },
  approval: { label: "Approval", className: "bg-purple-100 text-purple-800 border-purple-200", dot: "bg-purple-500" },
  returned: { label: "Returned", className: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  declined: { label: "Declined", className: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-500" },
  withdrawn: { label: "Withdrawn", className: "bg-gray-100 text-gray-700 border-gray-300", dot: "bg-gray-500" },
};

const SEVERITY_META = {
  error: "border-red-200 bg-red-50 text-red-800",
  critical: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

// The single screening panel (W3-01 / SCR-01) renders each check's result. The
// result vocabulary comes from the server; these are presentation only.
const SCREENING_RESULT_META = {
  pass: { label: "Pass", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  flag: { label: "Flag", className: "bg-amber-100 text-amber-800 border-amber-200" },
  fail: { label: "Fail", className: "bg-red-100 text-red-800 border-red-200" },
  not_applicable: { label: "Pending", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

const SCREENING_RECOMMENDATION_META = {
  pass: { label: "Recommended: proceed", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  review: { label: "Recommended: review flags", className: "bg-amber-100 text-amber-800 border-amber-200" },
  stop: { label: "Blocking checks open", className: "bg-red-100 text-red-800 border-red-200" },
};

const COMMENT_REQUIRED_STATES = new Set(["returned", "declined", "withdrawn"]);

// The decision class a comment-required pipeline state maps to (W6-01).
const STATE_DECISION_CLASS = { returned: "return", declined: "decline", withdrawn: "withdraw" };

function stateMeta(state) {
  return STATE_META[state] || {
    label: state || "Unknown",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  };
}

function severityMeta(severity) {
  return SEVERITY_META[String(severity || "info").toLowerCase()] || SEVERITY_META.info;
}

function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })} AED mn`;
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

function ageLabel(card) {
  if (card.age_days === null || card.age_days === undefined) return "age —";
  if (card.sla_days === null || card.sla_days === undefined) return `${card.age_days}d in stage`;
  return `${card.age_days}d / ${card.sla_days}d SLA`;
}

function errorMessage(error, fallback) {
  if (error?.status === 403) {
    return "You do not have permission to make this move on this opportunity.";
  }
  if (error?.status === 409) {
    return "That move is no longer allowed — the opportunity has already moved on. The board has been refreshed.";
  }
  if (error?.status === 404) {
    return "This opportunity could not be found. It may have been removed.";
  }
  return error?.message || fallback;
}

function opportunityCard(card, { onSelect, active, t }) {
  const meta = stateMeta(card.state);
  return (
    <button
      key={card.id}
      type="button"
      onClick={() => onSelect(card)}
      className={cn(
        "w-full rounded-lg border bg-white p-3 text-left shadow-sm transition-all",
        active ? "border-teal-400 ring-1 ring-teal-200" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-900 leading-snug line-clamp-2">
          {card.opportunity_name || "(untitled)"}
        </p>
        <span className={cn("mt-1 h-2 w-2 rounded-full shrink-0", meta.dot)} aria-hidden />
      </div>

      <p className="mt-1 text-xs text-slate-500 truncate">
        {card.owner_email || "No owner"}
      </p>

      <p className="mt-1 text-sm font-semibold text-slate-800">
        {formatAmount(card.total_commitment_aed)}
      </p>

      <p className="mt-1 text-xs text-slate-500 truncate">
        {[card.sector, card.geography].filter(Boolean).join(" · ") || "No sector/geography"}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            "gap-1 font-medium",
            card.sla_breached
              ? "bg-red-100 text-red-800 border-red-200"
              : "bg-slate-100 text-slate-600 border-slate-200"
          )}
        >
          {card.sla_breached ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {ageLabel(card)}
        </Badge>
        {card.theme_exception && (
          <Badge variant="outline" className="gap-1 font-medium bg-amber-100 text-amber-800 border-amber-200">
            <ShieldAlert className="h-3 w-3" />
            {t("board.themeException")}
          </Badge>
        )}
      </div>
      {card.gate1_authority && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px]",
            card.gate1_authority.authorized ? "text-emerald-700" : "text-slate-500"
          )}
          data-testid={"gate1-authority-" + card.id}
        >
          <Gavel className="h-3 w-3 shrink-0" />
          <span className="truncate">
            Gate 1 · {card.gate1_authority.tier_label} ·{" "}
            {card.gate1_authority.accountable_party?.label || "Unassigned"}
            {card.gate1_authority.authorized ? " · you can decide" : " owns the decision"}
          </span>
        </p>
      )}

      {/* Related-party overlay (W6-03 / BRD WF-06): a flagged, unsigned deal
          cannot take the Screening Decision, so the board says so up front. */}
      {card.related_party_overlay && (
        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-[11px]",
            card.related_party_overlay.blocked ? "text-amber-700" : "text-emerald-700"
          )}
          data-testid={"rp-overlay-" + card.id}
        >
          <ShieldAlert className="h-3 w-3 shrink-0" />
          <span className="truncate">
            Related party · {card.related_party_overlay.status_label}
            {card.related_party_overlay.blocked ? " · sign-off required" : " · cleared"}
          </span>
        </p>
      )}
    </button>
  );
}

function emptyState(Icon, title, description) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-white/60 py-12 text-center">
      <Icon className="h-8 w-8 text-slate-300" />
      <p className="font-medium text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}

function cardGrid(cards, { onSelect, selectedId, empty, t }) {
  if (!cards.length) return empty;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => opportunityCard(card, { onSelect, active: card.id === selectedId, t }))}
    </div>
  );
}

export default function ScreeningBoard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [comment, setComment] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [memoOpen, setMemoOpen] = useState(false);
  // Data-room folder link (W8-04 / BRD INTG-01).
  const [dataroomUrl, setDataroomUrl] = useState("");
  const [dataroomLabel, setDataroomLabel] = useState("");
  // Gate-1 hard-filter reviewer decision (W3-02 / SCR-03): the system recommends
  // decline, the reviewer confirms or overrides with a written reason.
  const [hardFilterDecision, setHardFilterDecision] = useState("overridden");
  const [hardFilterReason, setHardFilterReason] = useState("");
  // Gate-1 soft-filter reviewer decision (W3-03 / SCR-04): the system proposes a
  // 1-5 score per filter, the reviewer confirms or adjusts each with a rationale.
  const [softFilterDecision, setSoftFilterDecision] = useState("confirmed");
  const [softFilterScores, setSoftFilterScores] = useState({});
  const [softFilterRationales, setSoftFilterRationales] = useState({});
  const [disqualifierClears, setDisqualifierClears] = useState({});
  // Gate-2 weighted scorecard (W3-05 / SCO-02): seven 1-5 criteria, a 3.5 pass
  // bar and the CIO override memo for a below-bar total.
  const [scorecardScores, setScorecardScores] = useState({});
  const [scorecardNotes, setScorecardNotes] = useState({});
  const [scorecardComments, setScorecardComments] = useState({});
  const [overrideBy, setOverrideBy] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const statesQuery = useQuery({
    queryKey: ["pipeline", "states"],
    queryFn: () => api.pipeline.states(),
    staleTime: 5 * 60 * 1000,
  });

  const boardQuery = useQuery({
    queryKey: ["pipeline", "board"],
    queryFn: () => api.pipeline.board(),
  });

  const awaitingQuery = useQuery({
    queryKey: ["pipeline", "awaiting-my-review"],
    queryFn: () => api.pipeline.awaitingMyReview(),
  });

  const mineQuery = useQuery({
    queryKey: ["pipeline", "my-opportunities"],
    queryFn: () => api.pipeline.myOpportunities(),
  });

  const rollupQuery = useQuery({
    queryKey: ["pipeline", "rollup"],
    queryFn: () => api.pipeline.rollup(),
    enabled: mineQuery.isSuccess,
  });

  const alignmentQuery = useQuery({
    queryKey: ["pipeline", "alignment", selectedId],
    queryFn: () => api.pipeline.alignment(selectedId),
    enabled: Boolean(selectedId),
  });

  // The single screening panel (W3-01 / SCR-01): the whole initial screen in one
  // payload. Advisory — it recommends, the person decides (SCR-09).
  const screeningQuery = useQuery({
    queryKey: ["pipeline", "screening", selectedId],
    queryFn: () => api.pipeline.screening(selectedId),
    enabled: Boolean(selectedId),
  });

  // Data-room folder link (W8-04 / BRD INTG-01): the durable pointer to the folder
  // a screening works from.
  const dataroomQuery = useQuery({
    queryKey: ["pipeline", "dataroom-link", selectedId],
    queryFn: () => api.pipeline.dataroomLink(selectedId),
    enabled: Boolean(selectedId),
  });

  const transitionsQuery = useQuery({
    queryKey: ["pipeline", "transitions", selectedId],
    queryFn: () => api.pipeline.transitions(selectedId),
    enabled: Boolean(selectedId),
  });

  // Decision reason codes (W6-01 / WF-05). A move to returned / declined /
  // withdrawn must carry a code from the maintained catalogue.
  const decisionReasonsQuery = useQuery({
    queryKey: ["decision-reasons"],
    queryFn: () => api.gate.decisionReasons(),
    staleTime: 5 * 60 * 1000,
  });

  // Duplicate warnings are Investment-Team-only (INT-12). The request returns
  // 403 for anyone else, so we simply hide the panel rather than probe roles.
  const duplicatesQuery = useQuery({
    queryKey: ["duplicates", selectedId],
    queryFn: () => api.duplicates.forOpportunity(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ matchId, action, reason }) =>
      action === "dismiss"
        ? api.duplicates.dismiss(selectedId, matchId, reason)
        : api.duplicates.link(selectedId, matchId),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["duplicates", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
      toast({
        title: variables.action === "dismiss" ? "Warning dismissed" : "Linked as a duplicate",
        description:
          variables.action === "dismiss"
            ? "The pair will no longer appear as a duplicate warning."
            : "The two opportunities are recorded as the same target.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not record the decision",
        description: errorMessage(error, "The duplicate decision was rejected."),
      });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, state, note, code, text }) =>
      api.pipeline.transition(id, state, { comment: note, reasonCode: code, reasonText: text }),

    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "awaiting-my-review"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "my-opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "rollup"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "transitions", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "alignment", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", variables.id] });
      setPendingTransition(null);
      setComment("");
      setReasonCode("");
      toast({
        title: "State updated",
        description: `${stateMeta(result?.from_state).label} → ${stateMeta(result?.state ?? variables.state).label}`,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "transitions", selectedId] });
      toast({
        variant: "destructive",
        title: "Could not move this opportunity",
        description: errorMessage(error, "The state change was rejected."),
      });
    },
  });

  // Data-room folder link (W8-04 / BRD INTG-01). Setting or clearing the link is
  // audited; the toast explains which.
  const setDataroomMutation = useMutation({
    mutationFn: ({ id, url, label }) => api.pipeline.setDataroomLink(id, { url, label }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "dataroom-link", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
      setDataroomUrl("");
      setDataroomLabel("");
      toast({
        title: "Data-room link saved",
        description: result?.link?.provider_label
          ? "Linked to " + result.link.provider_label + " ("
            + (result.link.label || "folder") + "). Recorded on the audit trail."
          : "Recorded on the audit trail.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not save the data-room link",
        description: errorMessage(error, "The link was rejected."),
      });
    },
  });

  const clearDataroomMutation = useMutation({
    mutationFn: (id) => api.pipeline.clearDataroomLink(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "dataroom-link", id] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
      toast({ title: "Data-room link cleared", description: "The removal is recorded on the audit trail." });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not clear the data-room link",
        description: errorMessage(error, "The request was rejected."),
      });
    },
  });

  // Gate-1 hard-filter reviewer decision (W3-02 / SCR-03). A failed filter only
  // recommends decline; the reviewer confirms or overrides it with a written
  // reason and the decision is audited (SCR-09).
  const hardFilterMutation = useMutation({
    mutationFn: ({ id, decision, reason }) => api.gate.reviewHardFilter(id, decision, reason),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", variables.id] });
      setHardFilterReason("");
      toast({
        title: result?.review?.decision === "confirmed" ? "Recommended decline confirmed" : "Recommended decline overridden",
        description: "The hard-filter decision is recorded on the audit trail.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not record the hard-filter decision",
        description: errorMessage(error, "The reviewer decision was rejected."),
      });
    },
  });

  const softFilterMutation = useMutation({
    mutationFn: ({ id, decision, scores, rationales }) =>
      api.gate.reviewSoftFilter(id, { decision, scores, rationales }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", variables.id] });
      toast({
        title: result?.review?.decision === "adjusted" ? "Soft-filter scores adjusted" : "Soft-filter scores confirmed",
        description: "The reviewer decision is recorded on the audit trail.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not record the soft-filter decision",
        description: errorMessage(error, "The reviewer decision was rejected."),
      });
    },
  });

  // Automatic disqualifier clear (W3-04 / SCR-05). The system raises the flag;
  // the reviewer clears one or more, each needing a named reviewer and reason.
  const disqualifierMutation = useMutation({
    mutationFn: ({ id, clears }) => api.gate.reviewDisqualifiers(id, clears),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", variables.id] });
      setDisqualifierClears({});
      toast({
        title: "Disqualifier flag cleared",
        description: "The clear is recorded on the audit trail with the named reviewer and reason.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not clear the disqualifier flag",
        description: errorMessage(error, "The clear was rejected."),
      });
    },
  });

  // Gate 2 weighted scorecard capture (W3-05 / SCO-02). Seven 1-5 criteria; the
  // weighted total clears a 3.5 pass bar.
  const scorecardMutation = useMutation({
    mutationFn: ({ id, scores, notes, comments }) => api.gate.scoreScorecard(id, { scores, notes, comments }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", variables.id] });
      setScorecardScores({});
      setScorecardNotes({});
      setScorecardComments({});
      toast({
        title: "Gate 2 scorecard recorded",
        description: result?.scorecard?.message || "The weighted total is on the record.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not record the scorecard",
        description: errorMessage(error, "The capture was rejected."),
      });
    },
  });

  // Gate 2 CIO override memo (W3-05 / SCO-02): a below-bar total needs a named
  // CIO and a written reason to proceed to Gate 3.
  const overrideMutation = useMutation({
    mutationFn: ({ id, by, reason }) => api.gate.overrideScorecard(id, { by, reason }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", variables.id] });
      setOverrideReason("");
      toast({
        title: "CIO override memo recorded",
        description: result?.scorecard?.message || "The override is on the audit trail.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not record the override memo",
        description: errorMessage(error, "The override was rejected."),
      });
    },
  });

  const board = boardQuery.data;
  const columns = useMemo(() => board?.columns || [], [board]);
  const awaitingItems = useMemo(() => awaitingQuery.data?.items || [], [awaitingQuery.data]);
  const mine = mineQuery.data;
  const mineItems = useMemo(() => mine?.items || [], [mine]);

  const allCards = useMemo(() => {
    const byId = new Map();
    columns.forEach((column) => (column.items || []).forEach((card) => byId.set(card.id, card)));
    awaitingItems.forEach((card) => byId.set(card.id, card));
    mineItems.forEach((card) => byId.set(card.id, card));
    return byId;
  }, [columns, awaitingItems, mineItems]);

  const selectedCard = useMemo(() => {
    if (!selectedId) return null;
    return allCards.get(selectedId) || selectedSnapshot;
  }, [selectedId, allCards, selectedSnapshot]);

  // Who may set the data-room link (W8-04). The server re-checks this with
  // canWriteOrg; here we mirror it so the form is hidden rather than offering a
  // control the server would reject. Mirrors the write roles in server/rbac.js.
  const writable = useMemo(() => {
    const roles = user?.roles || (user?.role ? [user.role] : []);
    const WRITE_ROLES = [
      "admin", "subsidiary_deal_lead", "subsidiary_cfo", "subsidiary_ceo",
      "sirius_deal_lead", "sirius_vertical_head", "cio", "leadership",
      "ic_member", "board_member", "group_compliance", "cluster_head", "opco_signatory",
    ];
    return roles.some((r) => WRITE_ROLES.includes(r));
  }, [user]);

  const alignment = alignmentQuery.data?.alignment;
  const screening = screeningQuery.data?.screening;
  const transitionsList = Array.isArray(transitionsQuery.data) ? transitionsQuery.data : [];

  const allowedNextStates = useMemo(() => {
    const state = selectedCard?.state;
    if (!state) return [];
    const next = statesQuery.data?.transitions?.[state] || [];
    // Withdrawing is a producing-layer action (INT-13): only offer it where the
    // server would allow it, so the UI never promises a rejected transition.
    return next.filter((s) => s !== "withdrawn" || selectedCard?.can_withdraw);
  }, [statesQuery.data, selectedCard]);

  // The Gate-1 screening decisions (WF-08) are reserved to the roles the ticket
  // band names. The button stays visible but is disabled when this user is not
  // delegated, matching the server guard rather than hiding the rule.
  const GATE1_TARGETS = new Set(["refinement", "declined"]);
  const gate1Blocked = (state) =>
    GATE1_TARGETS.has(state) &&
    selectedCard?.gate1_authority &&
    selectedCard.gate1_authority.authorized === false;
  // A flagged related-party deal cannot take the Gate-1 screening decision
  // until an independent, non-conflicted sign-off is on file (W6-03 / WF-06).
  const rpBlocked = (state) =>
    GATE1_TARGETS.has(state) && Boolean(selectedCard?.related_party_overlay?.blocked);

  // Column order & SLA targets come straight from the server definition.
  const orderedColumns = useMemo(() => {
    if (columns.length) return columns;
    const sla = statesQuery.data?.sla || {};
    return BOARD_STATES.map((state) => ({
      state,
      label: stateMeta(state).label,
      sla_days: sla[state]?.days ?? null,
      items: [],
    }));
  }, [columns, statesQuery.data]);

  const openCard = (card) => {
    setSelectedId(card.id);
    setSelectedSnapshot(card);
    setPendingTransition(null);
    setComment("");
    setReasonCode("");
  };

  const requestTransition = () => {
    const note = comment.trim();
    if (!pendingTransition) return;
    const needsReason = COMMENT_REQUIRED_STATES.has(pendingTransition);
    if (needsReason && !note) {
      toast({
        variant: "destructive",
        title: "A comment is required",
        description: `Add a reason before moving this opportunity to ${stateMeta(pendingTransition).label}.`,
      });
      return;
    }
    if (needsReason && !reasonCode) {
      toast({
        variant: "destructive",
        title: "A reason code is required",
        description: `Choose the reason this opportunity is being moved to ${stateMeta(pendingTransition).label}.`,
      });
      return;
    }
    transitionMutation.mutate({
      id: selectedId,
      state: pendingTransition,
      note: note || undefined,
      code: needsReason ? reasonCode : undefined,
      text: needsReason ? note || undefined : undefined,
    });
  };

  const commentRequired = pendingTransition ? COMMENT_REQUIRED_STATES.has(pendingTransition) : false;
  // The enabled reason codes for the pending state's decision class (W6-01).
  const pendingDecisionClass = pendingTransition ? STATE_DECISION_CLASS[pendingTransition] : null;
  const pendingReasonOptions =
    (pendingDecisionClass && decisionReasonsQuery.data?.options?.[pendingDecisionClass]) || [];
  const pendingReasonNeedsText =
    (pendingDecisionClass &&
      (decisionReasonsQuery.data?.config?.classes || []).find((c) => c.key === pendingDecisionClass)
        ?.require_text) ||
    false;

  const renderDetail = () => {
    if (!selectedCard) return null;
    const meta = stateMeta(selectedCard.state);
    return (
      <>
        <SheetHeader className="space-y-3 pr-8">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <SheetTitle className="leading-snug">{selectedCard.opportunity_name || "(untitled)"}</SheetTitle>
              <SheetDescription>
                {selectedCard.owner_email || "No owner"} · {[selectedCard.sector, selectedCard.geography].filter(Boolean).join(" · ") || "No sector/geography"}
              </SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("font-medium", meta.className)}>
              {selectedCard.state_label || meta.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                selectedCard.sla_breached
                  ? "bg-red-100 text-red-800 border-red-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              )}
            >
              {selectedCard.sla_breached ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {ageLabel(selectedCard)}
            </Badge>
            {selectedCard.theme_exception && (
              <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-800 border-amber-200">
                <ShieldAlert className="h-3 w-3" />
                {t("board.themeException")}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-cyan-300 text-cyan-800 hover:bg-cyan-50"
            onClick={() => setMemoOpen(true)}
          >
            <FileText className="h-4 w-4" />
            Create Sirius memo
          </Button>
        </SheetHeader>

        {/* Data-room folder link (W8-04 / BRD INTG-01). */}
        <div className="mt-6 rounded-lg border border-slate-200 p-3" data-testid="dataroom-link-panel">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FolderOpen className="h-4 w-4 text-slate-600" />
            Data-room folder
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            The secure room stays the system of record; this is the folder the screening works from.
          </p>
          {dataroomQuery.data?.link ? (
            <div className="mt-2 space-y-2" data-testid="dataroom-link-current">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-700 border-slate-200">
                  <Link2 className="h-3 w-3" />
                  {dataroomQuery.data.link.provider_label || "Folder"}
                </Badge>
                <span className="text-xs text-slate-600">{dataroomQuery.data.link.label || "Linked folder"}</span>
                <a
                  href={dataroomQuery.data.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:underline"
                  data-testid="dataroom-link-open"
                >
                  Open folder
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-red-600 hover:text-red-700"
                  disabled={clearDataroomMutation.isPending}
                  onClick={() => clearDataroomMutation.mutate(selectedCard.id)}
                  data-testid="dataroom-link-clear"
                >
                  Clear
                </Button>
              </div>
              <p className="truncate text-[11px] text-slate-400" title={dataroomQuery.data.link.url}>
                {dataroomQuery.data.link.url}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-400" data-testid="dataroom-link-empty">
              No folder linked yet.
            </p>
          )}
          {writable && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={dataroomUrl}
                  onChange={(e) => setDataroomUrl(e.target.value)}
                  placeholder="https://room.example.com/folder/..."
                  className="h-8 flex-1 text-xs"
                  data-testid="dataroom-link-url"
                />
                <Input
                  value={dataroomLabel}
                  onChange={(e) => setDataroomLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className="h-8 text-xs sm:w-44"
                  data-testid="dataroom-link-label"
                />
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  disabled={!dataroomUrl.trim() || setDataroomMutation.isPending}
                  onClick={() => setDataroomMutation.mutate({ id: selectedCard.id, url: dataroomUrl, label: dataroomLabel })}
                  data-testid="dataroom-link-save"
                >
                  {setDataroomMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                  {dataroomQuery.data?.link ? "Replace link" : "Save link"}
                </Button>
              </div>
              <p className="text-[11px] text-slate-400">Must be an https URL to the folder (Coneshare, SharePoint, Drive, Box, Dropbox or an internal share).</p>
            </div>
          )}
        </div>

        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Total commitment</p>
              <p className="font-semibold text-slate-900">{formatAmount(selectedCard.total_commitment_aed)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Opportunity type</p>
              <p className="font-semibold text-slate-900">
                {selectedCard.opportunity_type ? String(selectedCard.opportunity_type).replace(/_/g, " ") : "—"}
              </p>
            </div>
          </div>


          {/* Single screening panel (W3-01 / SCR-01) ------------------------ */}
          <div className="space-y-3" data-testid="screening-panel">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShieldAlert className="h-4 w-4 text-slate-600" />
              {t("board.initialScreening")}
              {screening?.summary?.recommended && (
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-1 font-medium",
                    (SCREENING_RECOMMENDATION_META[screening.summary.recommended] || {}).className
                  )}
                >
                  {(SCREENING_RECOMMENDATION_META[screening.summary.recommended] || {}).label || screening.summary.recommended}
                </Badge>
              )}
            </p>
            {screeningQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Running the initial screen...
              </div>
            ) : screeningQuery.isError ? (
              <p className="text-sm text-red-600">
                {errorMessage(screeningQuery.error, "Could not load the screening panel.")}
              </p>
            ) : screening ? (
              <div className="space-y-3">
                {screening.message && (
                  <p className="text-sm text-slate-600">{screening.message}</p>
                )}
                <ul className="space-y-2">
                  {(screening.checks || []).map((check) => {
                    const resultMeta = SCREENING_RESULT_META[check.result] || SCREENING_RESULT_META.not_applicable;
                    return (
                      <li
                        key={check.key}
                        className="rounded-lg border border-slate-200 bg-white p-3"
                        data-testid={"screening-check-" + check.key}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-800">{check.label}</span>
                          <div className="flex items-center gap-1.5">
                            {check.advisory && (
                              <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                                advisory
                              </Badge>
                            )}
                            <Badge variant="outline" className={cn("font-medium", resultMeta.className)}>
                              {resultMeta.label}
                            </Badge>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{check.rationale}</p>
                        {(check.evidence_refs || []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {check.evidence_refs.map((ref, index) => (
                              <Badge
                                key={check.key + "-" + index}
                                variant="outline"
                                className="bg-slate-50 text-slate-600 border-slate-200 font-normal"
                                title={ref.label}
                              >
                                {ref.type}: {ref.label}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {/* Gate-1 hard-filter reviewer decision (W3-02 / SCR-03). Shown
                    only when a hard filter failed, so the reviewer confirms the
                    recommended decline or overrides it with a written reason. */}
                {(() => {
                  const hfCheck = (screening.checks || []).find((c) => c.key === "hard_filters");
                  const hf = hfCheck?.detail;
                  if (!hf || hf.recommended_outcome !== "recommended_decline") return null;
                  const failed = hf.failed || [];
                  const review = hf.review;
                  return (
                    <div
                      className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3"
                      data-testid="hard-filter-review"
                    >
                      <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                        <ShieldAlert className="h-4 w-4" />
                        Recommended decline — {failed.length} hard filter(s) failed
                      </p>
                      <ul className="space-y-1 text-xs text-red-800">
                        {failed.map((f) => (
                          <li key={f.key}>• {f.label}</li>
                        ))}
                      </ul>
                      <p className="text-xs text-red-700">
                        The system recommends decline; it never rejects on its own. A reviewer confirms or
                        overrides with a written reason.
                      </p>
                      {review ? (
                        <div className="rounded-md border border-red-200 bg-white p-2 text-xs" data-testid="hard-filter-review-record">
                          <p className="font-medium text-red-800">
                            {review.decision === "confirmed" ? "Recommended decline confirmed" : "Recommended decline overridden"}
                          </p>
                          <p className="mt-0.5 text-slate-600">{review.reason} — {review.by || "unknown"}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {["confirmed", "overridden"].map((option) => (
                              <Button
                                key={option}
                                size="sm"
                                variant={hardFilterDecision === option ? "default" : "outline"}
                                className="h-7 text-xs"
                                data-testid={"hard-filter-decision-" + option}
                                onClick={() => setHardFilterDecision(option)}
                              >
                                {option === "confirmed" ? "Confirm decline" : "Override decline"}
                              </Button>
                            ))}
                          </div>
                          <Textarea
                            rows={2}
                            className="text-sm"
                            placeholder="Reason (at least 10 characters)"
                            data-testid="hard-filter-reason"
                            value={hardFilterReason}
                            onChange={(event) => setHardFilterReason(event.target.value)}
                          />
                          <Button
                            size="sm"
                            className="bg-red-600 hover:bg-red-700"
                            disabled={hardFilterMutation.isPending || hardFilterReason.trim().length < 10}
                            data-testid="hard-filter-submit"
                            onClick={() =>
                              hardFilterMutation.mutate({
                                id: selectedId,
                                decision: hardFilterDecision,
                                reason: hardFilterReason.trim(),
                              })
                            }
                          >
                            Record decision
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Gate-1 soft-filter reviewer decision (W3-03 / SCR-04). The
                    system proposes a 1-5 score per soft filter; the reviewer
                    confirms or adjusts each with a written rationale. Scored,
                    never used to kill a deal, so this block never blocks. */}
                {(() => {
                  const sf = screening.soft_filters;
                  if (!sf) return null;
                  const items = sf.items || [];
                  const review = sf.review;
                  const bandMeta = {
                    strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
                    moderate: "border-amber-200 bg-amber-50 text-amber-700",
                    weak: "border-red-200 bg-red-50 text-red-700",
                  };
                  const scoreFor = (item) => {
                    const v = softFilterScores[item.key];
                    return v != null ? v : item.score;
                  };
                  const rationaleFor = (item) => {
                    const v = softFilterRationales[item.key];
                    return v != null ? v : item.rationale;
                  };
                  const allReasoned = items.every((i) => String(rationaleFor(i)).trim().length >= 10);
                  return (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="soft-filter-review">
                      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                        <span>Soft filters — scored, never used to kill a deal</span>
                        <Badge variant="outline" className={cn("font-medium", bandMeta[sf.outcome])} data-testid="soft-filter-outcome">
                          {String(sf.outcome || "").replace(/^./, (c) => c.toUpperCase())} ({sf.average}/5)
                        </Badge>
                      </p>
                      {review ? (
                        <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid="soft-filter-review-record">
                          <p className="font-medium text-slate-800">
                            {review.decision === "adjusted" ? "Scores adjusted by the reviewer" : "Scores confirmed by the reviewer"}
                          </p>
                          <ul className="text-slate-600">
                            {items.map((i) => (
                              <li key={i.key}>• {i.label}: {i.score}/5 — {review.rationales?.[i.key] || i.rationale}</li>
                            ))}
                          </ul>
                          <p className="text-slate-500">Recorded by {review.by || "unknown"}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {items.map((item) => (
                            <div key={item.key} className="rounded-md border border-slate-200 bg-white p-2" data-testid={"soft-filter-row-" + item.key}>
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-medium text-slate-800">{item.label}</span>
                                <span className="shrink-0 text-[10px] uppercase text-slate-500">
                                  Proposed {item.proposed_score}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <Button
                                    key={n}
                                    size="sm"
                                    variant={scoreFor(item) === n ? "default" : "outline"}
                                    className="h-6 w-6 p-0 text-xs"
                                    data-testid={"soft-filter-score-" + item.key + "-" + n}
                                    onClick={() => {
                                      setSoftFilterScores((prev) => ({ ...prev, [item.key]: n }));
                                      setSoftFilterDecision("adjusted");
                                    }}
                                  >
                                    {n}
                                  </Button>
                                ))}
                              </div>
                              <Textarea
                                rows={1}
                                className="mt-1.5 text-xs"
                                placeholder="Rationale (at least 10 characters)"
                                data-testid={"soft-filter-rationale-" + item.key}
                                value={rationaleFor(item)}
                                onChange={(event) => {
                                  setSoftFilterRationales((prev) => ({ ...prev, [item.key]: event.target.value }));
                                  setSoftFilterDecision("adjusted");
                                }}
                              />
                            </div>
                          ))}
                          <Button
                            size="sm"
                            disabled={softFilterMutation.isPending || !allReasoned}
                            data-testid="soft-filter-submit"
                            onClick={() => {
                              const scores = {};
                              const rationales = {};
                              for (const item of items) {
                                scores[item.key] = scoreFor(item);
                                rationales[item.key] = String(rationaleFor(item)).trim();
                              }
                              softFilterMutation.mutate({ id: selectedId, decision: softFilterDecision, scores, rationales });
                            }}
                          >
                            Record scores
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Automatic disqualifier clear (W3-04 / SCR-05). The system
                    raises a named flag; the reviewer clears one or more, each
                    with a named reviewer and a reason. A cleared flag is
                    recorded on the audit trail. */}
                {(() => {
                  const dq = screening.disqualifiers;
                  if (!dq) return null;
                  const items = dq.items || [];
                  const openFlags = dq.open_flags || [];
                  const clearedKeys = new Set(dq.cleared || []);
                  const canClear = openFlags.filter(
                    (f) => String(disqualifierClears[f.key]?.reason || "").trim().length >= 10
                  );
                  return (
                    <div
                      className={cn(
                        "space-y-3 rounded-lg border p-3",
                        dq.has_open_flag ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
                      )}
                      data-testid="disqualifiers-review"
                    >
                      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                        <span>Automatic disqualifier flags</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-medium",
                            dq.has_open_flag
                              ? "border-red-200 bg-white text-red-700"
                              : "border-emerald-200 bg-white text-emerald-700"
                          )}
                          data-testid="disqualifiers-review-outcome"
                        >
                          {dq.has_open_flag ? dq.open_flags.length + " open flag" + (dq.open_flags.length === 1 ? "" : "s") : "No open flags"}
                        </Badge>
                      </p>
                      <ul className="space-y-2">
                        {items.map((item) => (
                          <li
                            key={item.key}
                            className="rounded-md border border-slate-200 bg-white p-2 text-xs"
                            data-testid={"disqualifier-row-" + item.key}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium text-slate-800">{item.label}</span>
                              <span
                                className={cn(
                                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                                  item.status === "flagged"
                                    ? clearedKeys.has(item.key)
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-red-200 bg-red-50 text-red-700"
                                    : item.status === "clear"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-slate-200 bg-slate-50 text-slate-500"
                                )}
                              >
                                {item.status === "not_evaluated"
                                  ? "not evaluated"
                                  : item.status === "flagged" && clearedKeys.has(item.key)
                                    ? "cleared"
                                    : item.status}
                              </span>
                            </div>
                            <p className="mt-0.5 text-slate-500">{item.rationale}</p>
                            {item.status === "flagged" && !clearedKeys.has(item.key) && (
                              <div className="mt-1.5 space-y-1">
                                <Textarea
                                  rows={1}
                                  className="text-xs"
                                  placeholder="Reason to clear (at least 10 characters)"
                                  data-testid={"disqualifier-clear-reason-" + item.key}
                                  value={disqualifierClears[item.key]?.reason || ""}
                                  onChange={(event) =>
                                    setDisqualifierClears((prev) => ({
                                      ...prev,
                                      [item.key]: { reviewer: prev[item.key]?.reviewer || "", reason: event.target.value },
                                    }))
                                  }
                                />
                                <Input
                                  className="text-xs"
                                  placeholder="Named reviewer (email)"
                                  data-testid={"disqualifier-clear-reviewer-" + item.key}
                                  value={disqualifierClears[item.key]?.reviewer || ""}
                                  onChange={(event) =>
                                    setDisqualifierClears((prev) => ({
                                      ...prev,
                                      [item.key]: { reason: prev[item.key]?.reason || "", reviewer: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      {openFlags.length > 0 && (
                        <Button
                          size="sm"
                          disabled={disqualifierMutation.isPending || canClear.length === 0}
                          data-testid="disqualifier-clear-submit"
                          onClick={() => {
                            const clears = canClear.map((f) => ({
                              key: f.key,
                              reviewer: String(disqualifierClears[f.key]?.reviewer || "").trim(),
                              reason: String(disqualifierClears[f.key]?.reason || "").trim(),
                            }));
                            disqualifierMutation.mutate({ id: selectedId, clears });
                          }}
                        >
                          Clear flag{canClear.length === 1 ? "" : "s"}
                        </Button>
                      )}
                    </div>
                  );
                })()}
                {/* Gate-2 weighted scorecard (W3-05 / SCO-02). Seven 1-5
                    criteria with weights summing to 100%; the weighted total
                    clears a 3.5 pass bar, otherwise a CIO override memo is
                    required. The criteria and weights are configuration. */}
                {(() => {
                  const sc = screening.scorecard;
                  if (!sc) return null;
                  const items = sc.items || [];
                  const isCio = (user?.roles || []).some((r) => r === "cio" || r === "admin");
                  const scoreFor = (item) => {
                    const v = scorecardScores[item.key];
                    return v != null ? v : (item.has_review ? item.score : item.proposed_score);
                  };
                  const noteFor = (item) => {
                    const v = scorecardNotes[item.key];
                    return v != null ? v : item.note || "";
                  };
                  const commentFor = (item) => {
                    const v = scorecardComments[item.key];
                    return v != null ? v : ((item.comments && item.comments[item.key]) || "");
                  };
                  const isAdjusted = (item) => scoreFor(item) != null && scoreFor(item) !== item.proposed_score;
                  const commentOk = (item) => !isAdjusted(item) || commentFor(item).trim().length >= (sc.adjust_reason_min || 10);
                  const allScored = items.every((i) => scoreFor(i) != null);
                  const allCommented = items.every((i) => commentOk(i));
                  const totalPreview = allScored
                    ? Math.round(items.reduce((t, i) => t + (scoreFor(i) * i.weight) / 100, 0) * 100) / 100
                    : null;
                  const outcomeMeta = {
                    proceed: "border-emerald-200 bg-white text-emerald-700",
                    override_required: "border-red-200 bg-white text-red-700",
                    proceed_override: "border-amber-200 bg-white text-amber-700",
                  };
                  const outcomeLabel = sc.outcome === "proceed"
                    ? "Proceed"
                    : sc.outcome === "proceed_override"
                      ? "Proceed (CIO override)"
                      : sc.outcome === "override_required"
                        ? (sc.below_lens_floor ? "Lens below floor - override required" : "Below bar - override required")
                        : "Not scored";
                  return (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="scorecard-review">
                      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                        <span>Gate 2 weighted scorecard</span>
                        <Badge variant="outline" className={cn("font-medium", outcomeMeta[sc.outcome] || "")} data-testid="scorecard-outcome">
                          {outcomeLabel}{sc.total != null ? " (" + sc.total + "/5)" : ""}
                        </Badge>
                      </p>
                      <p className="text-xs text-slate-500">
                        Weights sum to {sc.weight_total}% · pass bar {sc.pass_threshold}. {sc.message}
                      </p>
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div key={item.key} className="rounded-md border border-slate-200 bg-white p-2" data-testid={"scorecard-row-" + item.key}>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-medium text-slate-800">{item.label}</span>
                              <span className="shrink-0 text-[10px] uppercase text-slate-500">Weight {item.weight}%</span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">{item.threshold}</p>
                            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                              <span data-testid={"scorecard-proposed-" + item.key}>
                                Proposed: {item.proposed_score}/5 ({item.proposed_label || "neutral"})
                              </span>
                              {isAdjusted(item) && (
                                <Badge variant="outline" className="border-amber-200 bg-white text-amber-700" data-testid={"scorecard-adjusted-" + item.key}>
                                  Adjusted
                                </Badge>
                              )}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Button
                                  key={n}
                                  size="sm"
                                  variant={scoreFor(item) === n ? "default" : "outline"}
                                  className="h-6 w-6 p-0 text-xs"
                                  data-testid={"scorecard-score-" + item.key + "-" + n}
                                  onClick={() => setScorecardScores((prev) => ({ ...prev, [item.key]: n }))}
                                >
                                  {n}
                                </Button>
                              ))}
                            </div>
                            <Input
                              className="mt-1.5 h-7 text-xs"
                              placeholder="Note (optional)"
                              data-testid={"scorecard-note-" + item.key}
                              value={noteFor(item)}
                              onChange={(event) => setScorecardNotes((prev) => ({ ...prev, [item.key]: event.target.value }))}
                            />
                            {isAdjusted(item) && (
                              <Input
                                className="mt-1.5 h-7 text-xs"
                                placeholder={"Comment required when adjusting the proposal (min " + (sc.adjust_reason_min || 10) + " chars)"}
                                data-testid={"scorecard-comment-" + item.key}
                                value={commentFor(item)}
                                onChange={(event) => setScorecardComments((prev) => ({ ...prev, [item.key]: event.target.value }))}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        disabled={scorecardMutation.isPending || !allScored || !allCommented}
                        data-testid="scorecard-submit"
                        onClick={() => {
                          const scores = {};
                          const notes = {};
                          const comments = {};
                          for (const item of items) {
                            scores[item.key] = scoreFor(item);
                            notes[item.key] = String(noteFor(item) || "").trim();
                            if (isAdjusted(item)) comments[item.key] = commentFor(item).trim();
                          }
                          scorecardMutation.mutate({ id: selectedId, scores, notes, comments });
                        }}
                      >
                        Record scorecard{totalPreview != null ? " (" + totalPreview + "/5)" : ""}
                      </Button>
                      {Array.isArray(sc.lenses) && sc.lenses.length > 0 && (
                        <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2" data-testid="scorecard-lenses">
                          <p className="text-xs font-medium text-slate-800">
                            Two-lens floor - each sub-total must clear {sc.lens_floor}
                          </p>
                          {sc.lenses.map((lens) => (
                            <div
                              key={lens.key}
                              className="flex items-center justify-between gap-2 text-xs"
                              data-testid={"scorecard-lens-" + lens.key}
                            >
                              <span className="text-slate-600">
                                {lens.label}
                                <span className="ml-1 text-[10px] uppercase text-slate-400">({lens.criteria.length} criteria · weight {lens.weight}%)</span>
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-medium",
                                  lens.below_floor
                                    ? "border-red-200 bg-white text-red-700"
                                    : lens.complete
                                      ? "border-emerald-200 bg-white text-emerald-700"
                                      : "border-slate-200 bg-white text-slate-600",
                                )}
                                data-testid={"scorecard-lens-" + lens.key + "-subtotal"}
                              >
                                {lens.subtotal != null ? lens.subtotal + "/5" : "not scored"}
                                {lens.below_floor ? " - below floor" : ""}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                      {sc.outcome === "override_required" && (
                        <div className="space-y-1.5 rounded-md border border-red-200 bg-white p-2" data-testid="scorecard-override">
                          <p className="text-xs font-medium text-red-700">
                            {sc.below_lens_floor
                              ? "A lens sub-total is below the floor. A CIO override memo (a named CIO and a written reason) is required to proceed."
                              : "The weighted total is below the pass bar. A CIO override memo (a named CIO and a written reason) is required to proceed."}
                          </p>
                          <Input
                            className="text-xs"
                            placeholder="Named CIO (email)"
                            data-testid="scorecard-override-by"
                            value={overrideBy}
                            onChange={(event) => setOverrideBy(event.target.value)}
                          />
                          <Textarea
                            rows={2}
                            className="text-xs"
                            placeholder="Override reason (at least 10 characters)"
                            data-testid="scorecard-override-reason"
                            value={overrideReason}
                            onChange={(event) => setOverrideReason(event.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={overrideMutation.isPending || !isCio || overrideReason.trim().length < 10 || !overrideBy.trim()}
                            data-testid="scorecard-override-submit"
                            onClick={() => overrideMutation.mutate({ id: selectedId, by: overrideBy.trim(), reason: overrideReason.trim() })}
                          >
                            Record CIO override memo
                          </Button>
                          {!isCio && <p className="text-[11px] text-slate-500">Only a user with the CIO role can file the override memo.</p>}
                        </div>
                      )}
                      {sc.outcome === "proceed_override" && sc.override && (
                        <div className="rounded-md border border-amber-200 bg-white p-2 text-xs" data-testid="scorecard-override-record">
                          <p className="font-medium text-amber-700">CIO override memo on file</p>
                          <p className="text-slate-600">{sc.override.reason}</p>
                          <p className="text-slate-500">Filed by {sc.override.by || "unknown"}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {screening.quality_score && (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="quality-score">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Overall quality score (advisory)</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-medium",
                          screening.quality_score.band === "strong"
                            ? "border-emerald-200 bg-white text-emerald-700"
                            : screening.quality_score.band === "moderate"
                              ? "border-amber-200 bg-white text-amber-700"
                              : screening.quality_score.band === "weak"
                                ? "border-red-200 bg-white text-red-700"
                                : "border-slate-200 bg-white text-slate-600",
                        )}
                        data-testid="quality-score-band"
                      >
                        {screening.quality_score.score != null ? screening.quality_score.score + "% - " + screening.quality_score.band_label : "Not scored"}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {screening.quality_score.components.map((c) => (
                        <div key={c.key} className="flex items-center justify-between gap-2 text-xs" data-testid={"quality-score-component-" + c.key}>
                          <span className="text-slate-600">
                            {c.label}
                            <span className="ml-1 text-[10px] uppercase text-slate-400">(weight {c.weight}%)</span>
                          </span>
                          <span className={c.available ? "font-medium text-slate-700" : "text-slate-400"}>
                            {c.available ? c.score + "/100" : "no data"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500">{screening.quality_score.version} - advisory only; it never takes the screening decision.</p>
                  </div>
                )}
                {screening.portfolio_synergy && (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="portfolio-synergy">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Portfolio synergies (advisory)</p>
                      <Badge variant="outline" className="font-medium border-teal-200 bg-white text-teal-700" data-testid="portfolio-synergy-count">
                        {screening.portfolio_synergy.synergy_count} match{screening.portfolio_synergy.synergy_count === 1 ? "" : "es"}
                      </Badge>
                    </div>
                    {screening.portfolio_synergy.synergies.length ? (
                      <ul className="space-y-1">
                        {screening.portfolio_synergy.synergies.map((s) => (
                          <li key={s.company_id} className="rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid={"portfolio-synergy-" + s.company_id}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-800">{s.company}</span>
                              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", s.strength === "high" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600")}>{s.strength}</span>
                            </div>
                            <p className="mt-0.5 text-slate-500">{s.rationale}</p>
                            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-700">{s.signoff}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">{screening.portfolio_synergy.message}</p>
                    )}
                  </div>
                )}
                {screening.portfolio_conflict && (
                  <div className={cn("space-y-2 rounded-lg border p-3", screening.portfolio_conflict.unmitigable_count > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50")} data-testid="portfolio-conflict">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Portfolio conflict & concentration (advisory)</p>
                      <Badge variant="outline" className={cn("font-medium", screening.portfolio_conflict.flag_count > 0 ? "border-amber-200 bg-white text-amber-700" : "border-emerald-200 bg-white text-emerald-700")} data-testid="portfolio-conflict-count">
                        {screening.portfolio_conflict.flag_count} overlap{screening.portfolio_conflict.flag_count === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {screening.portfolio_conflict.concentration?.post_deal_pct != null && (
                      <div className="flex items-center justify-between gap-2 text-xs" data-testid="portfolio-concentration">
                        <span className="text-slate-600">{screening.portfolio_conflict.concentration.sector} concentration ({screening.portfolio_conflict.concentration.basis})</span>
                        <span className={screening.portfolio_conflict.concentration.breach ? "font-semibold text-red-700" : "font-medium text-slate-700"}>
                          {screening.portfolio_conflict.concentration.post_deal_pct}% / {screening.portfolio_conflict.concentration.max_pct}% ceiling
                        </span>
                      </div>
                    )}
                    {screening.portfolio_conflict.flags.length ? (
                      <ul className="space-y-1">
                        {screening.portfolio_conflict.flags.map((f) => (
                          <li key={f.company_id} className="rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid={"portfolio-conflict-" + f.company_id}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-800">{f.company}</span>
                              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", f.severity === "high" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{f.severity}{f.unmitigable ? " - un-mitigable" : ""}</span>
                            </div>
                            <p className="mt-0.5 text-slate-500">{f.reason}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                     <p className="text-xs text-slate-500">{screening.portfolio_conflict.message}</p>
                   )}
                 </div>
               )}

                {/* Sanctions / adverse-media manual confirmation (W3-12 /
                    SCR-08). The analyst's verdict, the screening source, the
                    supporting note and the evidence held on the record. A
                    clear verdict is only satisfied with its note and
                    evidence; exposure escalates to a reviewer. */}
                {(() => {
                  const am = screening.adverse_media;
                  if (!am) return null;
                  const badgeClass =
                    am.status === "clear" && am.satisfied
                      ? "border-emerald-200 bg-white text-emerald-700"
                      : am.status === "adverse"
                      ? "border-red-200 bg-white text-red-700"
                      : "border-amber-200 bg-white text-amber-700";
                  return (
                    <div className={cn("space-y-2 rounded-lg border p-3", am.satisfied ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50")} data-testid="adverse-media">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />
                          Sanctions / adverse media (advisory)
                        </span>
                        <Badge variant="outline" className={cn("font-medium", badgeClass)} data-testid="adverse-media-status">
                          {String(am.status || "missing").replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600" data-testid="adverse-media-message">{am.message}</p>
                      <ul className="space-y-1 text-xs text-slate-600">
                        <li data-testid="adverse-media-note-state">
                          Confirmation note: {am.note_ok ? "recorded" : "missing or too short"}
                        </li>
                        <li data-testid="adverse-media-evidence-state">
                          Evidence on record: {am.evidence_on_record ? "yes" : "no"}
                          {am.source ? " \u00b7 source: " + am.source : ""}
                          {am.reviewed_by ? " \u00b7 screened by " + am.reviewed_by : ""}
                        </li>
                      </ul>
                    </div>
                  );
                })()}
                {/* The strategy profile version this screening used (W4-03 /
                    ENT-01). Names the mandate in force when the screen ran, so
                    the retained record is self-explanatory. */}
                {screening.strategy_profile && (
                  <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="strategy-profile-in-force">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strategy profile in force</span>
                      <Badge variant="outline" className="font-medium border-teal-200 bg-white text-teal-700" data-testid="strategy-profile-version">
                        v{screening.strategy_profile.version}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600" data-testid="strategy-profile-sources">
                      {screening.strategy_profile.source_document_ids?.length
                        ? `${screening.strategy_profile.source_document_ids.length} source document(s) in force`
                        : "No source documents recorded"}
                      {screening.screening_record
                        ? ` \u00b7 ${screening.screening_record.strategy_document_count} document(s) indexed`
                        : ""}
                    </p>
                  </div>
                )}
                {screening.disclaimer && (
                  <p className="text-xs text-slate-500">{screening.disclaimer}</p>
                )}
              </div>
            ) : null}
          </div>

          {/* Mandate alignment (E5) ------------------------------------------ */}
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Target className="h-4 w-4 text-teal-600" />
              {t("board.mandateAlignment")}
            </p>
            {alignmentQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Scoring against the theme...
              </div>
            ) : alignmentQuery.isError ? (
              <p className="text-sm text-red-600">
                {errorMessage(alignmentQuery.error, "Could not load the alignment score.")}
              </p>
            ) : alignment ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {alignment.aligned ? (
                    <Badge variant="outline" className="gap-1 bg-emerald-100 text-emerald-800 border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" /> Aligned
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-700 border-slate-200">
                      <XCircle className="h-3 w-3" /> Not aligned
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">
                    {alignment.has_theme
                      ? `Theme ${alignment.theme_status || "configured"}`
                      : "No theme configured"}
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Alignment score</span>
                    <span className="font-semibold text-slate-900">{alignment.score}/100</span>
                  </div>
                  <Progress value={alignment.score} className="h-2" />
                </div>

                {(alignment.matched || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {alignment.matched.map((item) => (
                      <Badge
                        key={item}
                        variant="outline"
                        className="bg-teal-50 text-teal-800 border-teal-200 font-medium"
                      >
                        {item}
                      </Badge>
                    ))}
                  </div>
                )}

                {(alignment.reasons || []).length > 0 && (
                  <ul className="space-y-1 text-sm text-slate-600">
                    {alignment.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span className="text-slate-300">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}


                {(alignment.dimensions || []).length > 0 && (
                  <div className="space-y-2" data-testid="alignment-dimensions">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Per-dimension verdicts
                    </p>
                    {alignment.dimensions.map((d) => {
                      const meta =
                        d.verdict === "aligned"
                          ? { label: "Aligned", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" }
                          : d.verdict === "partly"
                          ? { label: "Partly aligned", cls: "border-amber-200 bg-amber-50 text-amber-700" }
                          : { label: "Not aligned", cls: "border-slate-200 bg-slate-100 text-slate-600" };
                      return (
                        <div
                          key={d.key}
                          className="rounded-md border border-slate-200 bg-white p-2 text-sm"
                          data-testid={"alignment-dimension-" + d.key}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800">{d.label}</span>
                            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", meta.cls)} data-testid={"alignment-dimension-verdict-" + d.key}>
                              {meta.label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-600">{d.rationale}</p>
                          {d.citation && (
                            <p className="mt-1 border-l-2 border-teal-400 pl-2 text-xs italic text-slate-500" data-testid={"alignment-dimension-citation-" + d.key}>
                              &ldquo;{String(d.citation.text || "").slice(0, 220)}&rdquo;
                              {d.citation.document_name ? " - " + d.citation.document_name : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(alignment.signals || []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("board.signals")}
                    </p>
                    {alignment.signals.map((signal, index) => (
                      <div
                        key={`${signal.type}-${index}`}
                        className={cn("rounded-md border p-2.5 text-sm", severityMeta(signal.severity))}
                      >
                        <p className="font-medium">{signal.label}</p>
                        {signal.detail && <p className="mt-0.5 text-xs opacity-90">{signal.detail}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>


          {/* Duplicate warnings (INT-12) — Investment Team only ---------- */}
          {duplicatesQuery.isSuccess && (duplicatesQuery.data?.matches || []).length > 0 && (
            <>
              <Separator />
              <div className="space-y-3" data-testid="duplicate-panel">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Copy className="h-4 w-4 text-amber-600" />
                  Possible duplicate across the group
                </p>
                <ul className="space-y-3">
                  {(duplicatesQuery.data.matches || []).map((match) => (
                    <li key={match.opportunity_id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{match.opportunity_name}</p>
                          <p className="text-xs text-slate-600">
                            {match.target_name} · {[match.sector, match.geography].filter(Boolean).join(" · ")}
                          </p>
                          <p className="mt-1 text-xs text-amber-800">{(match.reasons || []).join("; ")}</p>
                        </div>
                        {match.review?.status === "linked" && (
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">Linked</Badge>
                        )}
                        {match.review?.status === "dismissed" && (
                          <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Dismissed</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={duplicateMutation.isPending}
                          onClick={() => duplicateMutation.mutate({ matchId: match.opportunity_id, action: "link" })}
                        >
                          Link as duplicate
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={duplicateMutation.isPending}
                          onClick={() => duplicateMutation.mutate({ matchId: match.opportunity_id, action: "dismiss" })}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <Separator />

          {/* Allowed next states (E6.1) -------------------------------------- */}
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ArrowRight className="h-4 w-4 text-teal-600" />
              {t("board.moveTo")}
            </p>
            {selectedCard.gate1_authority && (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                  selectedCard.gate1_authority.authorized
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                )}
                data-testid="gate1-authority-panel"
              >
                <Gavel className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Gate 1 — {selectedCard.gate1_authority.tier_label} band.</strong>{" "}
                  Accountable: {selectedCard.gate1_authority.accountable_party?.label || "Unassigned"}.{" "}
                  {selectedCard.gate1_authority.authorized
                    ? "Your role may take the screening decision."
                    : "Only the delegated roles may move this item to refinement or decline it."}
                </span>
              </div>
            )}
            {selectedCard.related_party_overlay && selectedCard.related_party_overlay.blocked && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                data-testid="rp-overlay-panel"
              >
                <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Related-party overlay — {selectedCard.related_party_overlay.status_label}.</strong>{" "}
                  This flagged deal cannot take the Screening Decision until an independent, non-conflicted sign-off
                  is recorded on the opportunity route.
                </span>
              </div>
            )}
            {statesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the state machine...
              </div>
            ) : allowedNextStates.length === 0 ? (
              <p className="text-sm text-slate-500">
                No further transitions are available from {selectedCard.state_label || meta.label}.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allowedNextStates.map((state) => {
                  const target = stateMeta(state);
                  const isBusy = transitionMutation.isPending && pendingTransition === state;
                  return (
                    <Button
                      key={state}
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={transitionMutation.isPending || gate1Blocked(state) || rpBlocked(state)}
                      title={
                        rpBlocked(state)
                          ? "The related-party overlay blocks this decision until an independent sign-off is recorded."
                          : gate1Blocked(state)
                            ? selectedCard.gate1_authority.reason
                            : undefined
                      }
                      data-testid={"transition-" + state}
                      onClick={() => {
                        setComment("");
                        setPendingTransition(state);
                      }}
                    >
                      {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {target.label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* Transition history --------------------------------------------- */}
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <GitBranch className="h-4 w-4 text-teal-600" />
              {t("board.transitionHistory")}
            </p>
            {transitionsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading history...
              </div>
            ) : transitionsQuery.isError ? (
              <p className="text-sm text-red-600">
                {errorMessage(transitionsQuery.error, "Could not load the transition history.")}
              </p>
            ) : transitionsList.length === 0 ? (
              <p className="text-sm text-slate-500">No transitions recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {transitionsList.map((item) => (
                  <li key={item.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <Badge variant="outline" className={cn("font-medium", stateMeta(item.from_state).className)}>
                        {stateMeta(item.from_state).label}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      <Badge variant="outline" className={cn("font-medium", stateMeta(item.to_state).className)}>
                        {stateMeta(item.to_state).label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.actor_email || "unknown"} · {formatDateTime(item.created_at)}
                    </p>
                    {item.comment && <p className="mt-1 text-sm text-slate-600">{item.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600">
                <LayoutGrid className="h-6 w-6 text-white" />
              </div>
              {t("board.title")}
            </h1>
            <p className="mt-2 text-slate-600">
              Every submission in one view — stage, owner, aging against its SLA target and mandate alignment.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="px-4 py-3">
                <p className="text-xs text-slate-500">In screening</p>
                <p className="text-2xl font-bold text-slate-900">{board?.total ?? "—"}</p>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="px-4 py-3">
                <p className="text-xs text-slate-500">SLA breaches</p>
                <p className="text-2xl font-bold text-red-600">{board?.breaches ?? "—"}</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Tabs defaultValue="board" className="space-y-4">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="review">
              {t("board.awaitingMyReview")}
              {awaitingQuery.data?.total ? (
                <span className="ml-2 rounded-full bg-teal-600 px-1.5 text-xs text-white">
                  {awaitingQuery.data.total}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="mine">{t("board.myOpportunities")}</TabsTrigger>
          </TabsList>

          {/* Board ---------------------------------------------------------- */}
          <TabsContent value="board">
            {boardQuery.isLoading ? (
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the board...
              </div>
            ) : boardQuery.isError ? (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-red-800">
                  <span>{errorMessage(boardQuery.error, "Could not load the screening board.")}</span>
                  <Button variant="outline" size="sm" onClick={() => boardQuery.refetch()}>
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-4">
                {orderedColumns.map((column) => {
                  const meta = stateMeta(column.state);
                  const items = column.items || [];
                  return (
                    <div key={column.state} className="flex w-72 shrink-0 flex-col">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} aria-hidden />
                          <span className="font-semibold text-slate-800">
                            {column.label || meta.label}
                          </span>
                          <Badge variant="outline" className="bg-white text-slate-600 border-slate-200">
                            {items.length}
                          </Badge>
                        </div>
                        <span className="whitespace-nowrap text-xs text-slate-500">
                          {column.sla_days != null ? `SLA ${column.sla_days}d` : "No SLA"}
                        </span>
                      </div>
                      <div className="flex-1 space-y-2 rounded-lg bg-slate-100/60 p-2">
                        {items.length === 0 ? (
                          <p className="py-6 text-center text-xs text-slate-400">Nothing in this stage</p>
                        ) : (
                          items.map((card) =>
                            opportunityCard(card, { onSelect: openCard, active: card.id === selectedId, t })
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Awaiting my review --------------------------------------------- */}
          <TabsContent value="review">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Inbox className="h-5 w-5 text-teal-600" />
                  Awaiting my review
                </CardTitle>
                <CardDescription>
                  Items whose current stage needs an action your role can perform.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {awaitingQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your queue...
                  </div>
                ) : awaitingQuery.isError ? (
                  <p className="text-sm text-red-600">
                    {errorMessage(awaitingQuery.error, "Could not load your review queue.")}
                  </p>
                ) : (
                  cardGrid(awaitingItems, {
                    onSelect: openCard,
                    selectedId,
                    t,
                    empty: emptyState(
                      CheckCircle2,
                      "Nothing awaiting your review",
                      "When an opportunity reaches a stage your role can act on, it will appear here."
                    ),
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* My opportunities ----------------------------------------------- */}
          <TabsContent value="mine">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <LayoutGrid className="h-5 w-5 text-teal-600" />
                  My opportunities
                </CardTitle>
                <CardDescription>
                  Everything raised by this organisation, and where each one currently sits.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                {mineQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your opportunities...
                  </div>
                ) : mineQuery.isError ? (
                  <p className="text-sm text-red-600">
                    {errorMessage(mineQuery.error, "Could not load your opportunities.")}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-white text-slate-700 border-slate-200">
                        {mine?.total ?? 0} total
                      </Badge>
                      <Badge variant="outline" className="bg-white text-slate-700 border-slate-200">
                        {mine?.open ?? 0} open
                      </Badge>
                      {Object.entries(mine?.by_state || {}).map(([state, count]) => (
                        <Badge
                          key={state}
                          variant="outline"
                          className={cn("font-medium", stateMeta(state).className)}
                        >
                          {stateMeta(state).label}: {count}
                        </Badge>
                      ))}
                    </div>
                    <Separator />
                    {cardGrid(mineItems, {
                      onSelect: openCard,
                      selectedId,
                      t,
                      empty: emptyState(
                        LayoutGrid,
                        "No opportunities yet",
                        "Drafts and submissions raised by this organisation will show up here."
                      ),
                    })}

                    <Separator />
                    <div className="space-y-2">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <GitBranch className="h-4 w-4 text-teal-600" />
                        {t("board.groupRollup")}
                        {rollupQuery.data?.descendants != null && (
                          <span className="text-xs font-normal text-slate-500">
                            across {rollupQuery.data.descendants} organisation(s)
                          </span>
                        )}
                      </p>
                      {rollupQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" /> Rolling up the group...
                        </div>
                      ) : rollupQuery.isError ? (
                        <p className="text-sm text-slate-500">
                          {errorMessage(rollupQuery.error, "Group rollup is not available for your role.")}
                        </p>
                      ) : Object.keys(rollupQuery.data?.total_by_state || {}).length === 0 ? (
                        <p className="text-sm text-slate-500">No opportunities in this organisation tree yet.</p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {Object.entries(rollupQuery.data.total_by_state).map(([state, count]) => (
                            <Badge
                              key={state}
                              variant="outline"
                              className={cn("font-medium", stateMeta(state).className)}
                            >
                              {stateMeta(state).label}: {count}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {renderDetail()}
        </SheetContent>
      </Sheet>

      <SiriusMemoDialog
        opportunityId={selectedId}
        opportunityName={selectedCard?.opportunity_name}
        open={memoOpen}
        onOpenChange={(open) => {
          setMemoOpen(open);
          if (!open) queryClient.invalidateQueries({ queryKey: ["pipeline", "memo", selectedId] });
        }}
      />

      <Dialog open={Boolean(pendingTransition)} onOpenChange={(open) => !open && setPendingTransition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("board.moveTo")} {pendingTransition ? stateMeta(pendingTransition).label : ""}
            </DialogTitle>
            <DialogDescription>
              {commentRequired
                ? "A reason code and comment are required for this move — they are recorded on the audit trail and shown to the owner."
                : "Add an optional comment for the audit trail."}
            </DialogDescription>
          </DialogHeader>
          {commentRequired && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Reason code{pendingReasonNeedsText ? "" : " (required)"}
              </Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger data-testid="transition-reason-code">
                  <SelectValue placeholder="Choose a reason code..." />
                </SelectTrigger>
                <SelectContent>
                  {pendingReasonOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reasonCode && (
                <p className="text-xs text-slate-500">
                  {pendingReasonOptions.find((o) => o.id === reasonCode)?.description}
                </p>
              )}
            </div>
          )}
          <Textarea
            data-testid="transition-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={
              commentRequired
                ? pendingReasonNeedsText
                  ? "Detail required for this reason code..."
                  : "Add detail for this decision..."
                : "Optional note..."
            }
            rows={4}
          />
          {commentRequired && (!comment.trim() || !reasonCode) && (
            <p className="text-xs text-red-600">
              {!reasonCode
                ? "Choose a reason code to move this opportunity here."
                : "A comment is required to move this opportunity here."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTransition(null)} disabled={transitionMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              className="gap-2 bg-teal-600 hover:bg-teal-700"
              onClick={requestTransition}
              disabled={transitionMutation.isPending || (commentRequired && (!comment.trim() || !reasonCode))}
            >
              {transitionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {t("board.confirmMove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
