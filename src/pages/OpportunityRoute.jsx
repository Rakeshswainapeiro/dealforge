import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  HelpCircle,
  Loader2,
  MessageSquare,
  PenLine,
  Plus,
  RotateCcw,
  Send,
  Workflow,
} from "lucide-react";

// ---------------------------------------------------------------------------
// E7 — Opportunity route (submission route / workflow engine).
//
// A user applies a reusable workflow to a submission, then inspects the
// signature map (participants, actions, signing order, per-stage status) before
// sending. The server owns stage permissions, required fields and the route
// state machine: this page only renders the map and asks the server to advance,
// sign or return a stage (REQ-WF-06/07/08, REQ-FLOW-01/02).
//
// The Q&A panel (Epic E8) is embedded so a clarification raised during routing
// is visible without leaving the route.
// ---------------------------------------------------------------------------

const ACTION_META = {
  fill: { label: "Fill", className: "bg-blue-100 text-blue-800 border-blue-200" },
  review: { label: "Review", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  sign: { label: "Sign", className: "bg-violet-100 text-violet-800 border-violet-200" },
  approve: { label: "Approve", className: "bg-teal-100 text-teal-800 border-teal-200" },
  return: { label: "Return", className: "bg-amber-100 text-amber-800 border-amber-200" },
  route_applied: { label: "Route applied", className: "bg-slate-100 text-slate-700 border-slate-200" },
  act: { label: "Complete", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

const STATUS_META = {
  pending: { label: "Pending", className: "bg-slate-100 text-slate-700 border-slate-200" },
  complete: { label: "Complete", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  returned: { label: "Returned", className: "bg-amber-100 text-amber-800 border-amber-200" },
  signed: { label: "Signed", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

function actionMeta(action) {
  return (
    ACTION_META[String(action || "").toLowerCase()] || {
      label: action || "Action",
      className: "bg-slate-100 text-slate-700 border-slate-200",
    }
  );
}

function statusMeta(status) {
  return (
    STATUS_META[String(status || "").toLowerCase()] || {
      label: status || "Unknown",
      className: "bg-slate-100 text-slate-700 border-slate-200",
    }
  );
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

function errorMessage(error, fallback) {
  if (error?.status === 403) {
    return "You do not have permission to do that on this opportunity.";
  }
  if (error?.status === 404) {
    return "Not found — no route is applied to this opportunity yet.";
  }
  if (error?.status === 409) {
    return error?.message || "That action is no longer allowed — the route has already moved on.";
  }
  if (error?.status === 422) {
    const missing = error?.data?.missing;
    if (Array.isArray(missing) && missing.length) {
      if (missing.includes("rationale")) {
        return "A rationale is required to complete this stage.";
      }
      return `Missing required fields: ${missing.join(", ")}`;
    }
    return error?.message || "Required fields for this stage are missing.";
  }
  return error?.message || fallback;
}

function opportunityLabel(record) {
  return record?.opportunity_name || record?.target_name || record?.title || record?.id || "Untitled opportunity";
}

function errorPanel(message, onRetry) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <span className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        {message}
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function loadingRow(label) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function emptyState(Icon, title, description) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-white/60 py-10 text-center">
      <Icon className="h-8 w-8 text-slate-300" />
      <p className="font-medium text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}

export default function OpportunityRoute() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState(null);
  const [workflowId, setWorkflowId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionComment, setActionComment] = useState("");
  const [actionReasonCode, setActionReasonCode] = useState("");
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newThreadForm, setNewThreadForm] = useState({
    subject: "",
    body: "",
    requiresResponse: false,
    participants: "",
  });
  const [newThreadVisibility, setNewThreadVisibility] = useState("shared");
  const [replyVisibility, setReplyVisibility] = useState("shared");
  const [meMayInternal, setMeMayInternal] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [rpForm, setRpForm] = useState({ disclosure: "", arm_length_basis: "", arm_length_note: "", conflicted_users: "", independent_reviewer_email: "" });
  const [rpSignoffNote, setRpSignoffNote] = useState("");
  const [prForm, setPrForm] = useState({ scheduled_at: "", format: "video", status: "scheduled", location: "", attendees: "", outcome: "", next_steps: "", notes: "" });
  const [prEditingId, setPrEditingId] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyIsResponse, setReplyIsResponse] = useState(false);

  // Whether this viewer may keep a comment internal (W6-04 / AUD-03).
  const cvQuery = useQuery({
    queryKey: ["comment-visibility"],
    queryFn: () => api.commentVisibility.config(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.auth.me(),
  });

  const opportunitiesQuery = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => api.entities.DealOpportunity.list("-updated_date", 100),
  });

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api.workflows.list(),
  });

  const actionsQuery = useQuery({
    queryKey: ["workflow-actions"],
    queryFn: () => api.workflows.actions(),
    staleTime: 5 * 60 * 1000,
  });

  const routeQuery = useQuery({
    queryKey: ["route", selectedId],
    queryFn: () => api.workflows.route(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const signatureMapQuery = useQuery({
    queryKey: ["signatureMap", selectedId],
    queryFn: () => api.workflows.signatureMap(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const eventsQuery = useQuery({
    queryKey: ["workflow-events", selectedId],
    queryFn: () => api.workflows.events(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });

  // Decision reason codes (W6-01 / WF-05) for return / rationale-stage actions.
  const decisionReasonsQuery = useQuery({
    queryKey: ["decision-reasons"],
    queryFn: () => api.gate.decisionReasons(),
    staleTime: 5 * 60 * 1000,
  });

  const threadsQuery = useQuery({
    queryKey: ["qa-threads", selectedId],
    queryFn: () => api.qa.threads(selectedId),
    enabled: Boolean(selectedId),
  });

  const relatedPartyQuery = useQuery({
    queryKey: ["related-party", selectedId],
    queryFn: () => api.relatedParty.get(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });

  // Record the disclosure, arm's-length basis and conflicted users (W6-03).
  const rpSaveMutation = useMutation({
    mutationFn: (payload) => api.relatedParty.save(selectedId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["related-party", selectedId] });
      toast({ title: "Related-party record saved", description: "The disclosure and arm's-length basis are recorded." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not save", description: errorMessage(error, "Save failed.") }),
  });

  // The independent, non-conflicted sign-off that clears the overlay (W6-03).
  const rpSignoffMutation = useMutation({
    mutationFn: (payload) => api.relatedParty.signoff(selectedId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["related-party", selectedId] });
      setRpSignoffNote("");
      toast({ title: "Related-party overlay signed off", description: "The Gate-1 decision is no longer blocked." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Sign-off refused", description: errorMessage(error, "Sign-off failed.") }),
  });

  const threadQuery = useQuery({
    queryKey: ["qa-thread", activeThreadId],
    queryFn: () => api.qa.thread(activeThreadId),
    enabled: Boolean(activeThreadId),
  });

  // Presentation scheduling (W6-06 / BRD WF-07). Capture the scheduled date,
  // group attendees, and - once held - the outcome and next steps on record.
  const presentationsQuery = useQuery({
    queryKey: ["presentations", selectedId],
    queryFn: () => api.presentations.list(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const prSaveMutation = useMutation({
    mutationFn: (payload) => (
      prEditingId
        ? api.presentations.update(selectedId, prEditingId, payload)
        : api.presentations.create(selectedId, payload)
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presentations", selectedId] });
      setPrEditingId(null);
      setPrForm({ scheduled_at: "", format: "video", status: "scheduled", location: "", attendees: "", outcome: "", next_steps: "", notes: "" });
      toast({ title: "Presentation captured", description: "The session is recorded on the opportunity." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not capture presentation", description: errorMessage(error, "Save failed.") }),
  });

  // Prefill the overlay form from the recorded review once it loads, so a
  // reviewer edits what is on file rather than retyping it (W6-03).
  useEffect(() => {
    const rv = relatedPartyQuery.data?.review;
    if (!rv) return;
    setRpForm({
      disclosure: rv.disclosure || "",
      arm_length_basis: rv.arm_length_basis || "",
      arm_length_note: rv.arm_length_note || "",
      conflicted_users: Array.isArray(rv.conflicted_users) ? rv.conflicted_users.join(", ") : "",
      independent_reviewer_email: rv.independent_reviewer_email || "",
    });
  }, [relatedPartyQuery.data]);

  const applyMutation = useMutation({
    mutationFn: () => api.workflows.apply(selectedId, workflowId || undefined),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["route", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["signatureMap", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["workflow-events", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast({
        title: "Route applied",
        description: `${result?.workflow_name || "Workflow"} is now on the signature map.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not apply the route",
        description: errorMessage(error, "The route was rejected."),
      });
    },
  });

  const actMutation = useMutation({
    mutationFn: ({ stageKey, action, comment, reasonCode, reasonText }) =>
      api.workflows.act(selectedId, { stageKey, action, comment, reasonCode, reasonText }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["route", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["signatureMap", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["workflow-events", selectedId] });
      setPendingAction(null);
      setActionComment("");
      setActionReasonCode("");
      toast({
        title: result?.status === "returned" ? "Stage returned" : "Stage advanced",
        description: result?.next_stage
          ? `Next stage: ${result.next_stage}.`
          : "The route is now complete.",
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["signatureMap", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["route", selectedId] });
      toast({
        variant: "destructive",
        title: "Could not update the stage",
        description: errorMessage(error, "The stage action was rejected."),
      });
    },
  });

  useEffect(() => {
    setMeMayInternal(Boolean(cvQuery.data?.viewer?.may_view_internal));
  }, [cvQuery.data]);
  const openThreadMutation = useMutation({
    mutationFn: () =>
      api.qa.open(selectedId, {
        subject: newThreadForm.subject.trim(),
        body: newThreadForm.body.trim(),
        requires_response: newThreadForm.requiresResponse,
        visibility: newThreadVisibility,
        participants: newThreadForm.participants
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    onSuccess: (thread) => {
      queryClient.invalidateQueries({ queryKey: ["qa-threads", selectedId] });
      setNewThreadOpen(false);
      setNewThreadForm({ subject: "", body: "", requiresResponse: false, participants: "" });
      setNewThreadVisibility("shared");
      if (thread?.id) setActiveThreadId(thread.id);
      toast({ title: "Thread opened", description: "Participants have been notified." });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not open the thread",
        description: errorMessage(error, "The clarification was rejected."),
      });
    },
  });

  const replyMutation = useMutation({
    mutationFn: () => api.qa.reply(activeThreadId, replyBody.trim(), replyIsResponse, replyVisibility),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-threads", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["qa-thread", activeThreadId] });
      setReplyBody("");
      setReplyIsResponse(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not send the reply",
        description: errorMessage(error, "The message was rejected."),
      });
    },
  });

  const closeThreadMutation = useMutation({
    mutationFn: () => api.qa.close(activeThreadId, replyBody.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-threads", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["qa-thread", activeThreadId] });
      setReplyBody("");
      toast({ title: "Thread closed" });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not close the thread",
        description: errorMessage(error, "The change was rejected."),
      });
    },
  });

  const reopenThreadMutation = useMutation({
    mutationFn: () => api.qa.reopen(activeThreadId, replyBody.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-threads", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["qa-thread", activeThreadId] });
      setReplyBody("");
      toast({ title: "Thread reopened" });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not reopen the thread",
        description: errorMessage(error, "The change was rejected."),
      });
    },
  });

  const opportunities = opportunitiesQuery.data || [];
  const workflows = workflowsQuery.data?.workflows || [];
  const signatureMap = signatureMapQuery.data;
  const stages = useMemo(
    () => [...(signatureMap?.stages || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [signatureMap]
  );
  const currentStage = useMemo(
    () => stages.find((stage) => stage.stage_key === signatureMap?.current_stage) || null,
    [stages, signatureMap]
  );
  const events = useMemo(() => {
    const list = eventsQuery.data || routeQuery.data?.events || [];
    return [...list].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [eventsQuery.data, routeQuery.data]);
  const threads = threadsQuery.data?.threads || [];
  const activeThread = threadQuery.data;

  const selectedWorkflow = workflows.find((workflow) => workflow.id === workflowId) || null;
  const identityEmail = (currentUser?.email || "").toLowerCase();

  const isSignerForCurrentStage = Boolean(
    currentStage?.requires_signature &&
      currentStage?.signing_order?.some(
        (signer) => String(signer.user_email || "").toLowerCase() === identityEmail
      )
  );

  const routeNotFound = routeQuery.isError && routeQuery.error?.status === 404;
  // The engine advertises which actions a stage may be driven with; the Sign
  // button is only offered when 'sign' is one of them and the current user is a
  // listed signatory for the stage.
  const engineSupportsSign = (actionsQuery.data?.actions || []).includes("sign");

  const requestAction = (action, label, requireComment) => {
    setActionComment("");
    setActionReasonCode("");
    setPendingAction({ action, label, requireComment });
  };

  const submitAction = () => {
    if (!pendingAction || !currentStage) return;
    const comment = actionComment.trim();
    if (pendingAction.requireComment && !comment) {
      toast({
        variant: "destructive",
        title: pendingAction.action === "return" ? "A comment is required" : "A rationale is required",
        description:
          pendingAction.action === "return"
            ? "Explain what needs revising before returning this stage."
            : "Record why this decision is being taken before completing the stage.",
      });
      return;
    }
    if (pendingAction.requireComment && !actionReasonCode) {
      toast({
        variant: "destructive",
        title: "A reason code is required",
        description: "Choose the reason code for this decision before continuing.",
      });
      return;
    }
    actMutation.mutate({
      stageKey: currentStage.stage_key,
      action: pendingAction.action,
      comment: comment || undefined,
      reasonCode: pendingAction.requireComment ? actionReasonCode : undefined,
      reasonText: pendingAction.requireComment ? comment || undefined : undefined,
    });
  };

  // The decision class for the pending route action (W6-01): a return carries a
  // return code, a rationale-bearing completion carries an approve code.
  const pendingActionClass = pendingAction
    ? pendingAction.action === "return"
      ? "return"
      : "approve"
    : null;
  const pendingActionReasonOptions =
    (pendingActionClass && decisionReasonsQuery.data?.options?.[pendingActionClass]) || [];

  const canSubmitNewThread =
    newThreadForm.subject.trim().length > 0 && newThreadForm.body.trim().length > 0;

  const renderSignatureMap = () => {
    if (!selectedId) {
      return emptyState(
        GitBranch,
        "Pick an opportunity",
        "Select an opportunity and apply a submission route to build its signature map."
      );
    }
    if (signatureMapQuery.isLoading) return loadingRow("Building the signature map...");
    if (signatureMapQuery.isError) {
      if (signatureMapQuery.error?.status === 404) {
        return emptyState(
          GitBranch,
          "No route applied",
          "Apply a workflow above to create the route, resolve participants and lay out the signing order."
        );
      }
      return errorPanel(
        errorMessage(signatureMapQuery.error, "Could not load the signature map."),
        () => signatureMapQuery.refetch()
      );
    }
    if (!stages.length) {
      return emptyState(GitBranch, "Empty route", "This route has no stages yet.");
    }

    return (
      <ol className="space-y-3">
        {stages.map((stage, index) => {
          const isCurrent = stage.stage_key === signatureMap?.current_stage;
          const action = actionMeta(stage.action);
          const status = statusMeta(stage.status);
          return (
            <li
              key={stage.stage_key}
              className={cn(
                "rounded-lg border bg-white p-4 shadow-sm",
                isCurrent ? "border-teal-400 ring-1 ring-teal-200" : "border-slate-200"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isCurrent ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"
                    )}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{stage.name || stage.stage_key}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("font-medium", action.className)}>
                        {action.label}
                      </Badge>
                      <Badge variant="outline" className={cn("font-medium", status.className)}>
                        {status.label}
                      </Badge>
                      {isCurrent && (
                        <Badge variant="outline" className="font-medium bg-teal-50 text-teal-800 border-teal-300">
                          Current
                          {t("route.current")}
                        </Badge>
                      )}
                      {stage.requires_signature && (
                        <Badge
                          variant="outline"
                          className="gap-1 font-medium bg-violet-50 text-violet-800 border-violet-200"
                        >
                          <PenLine className="h-3 w-3" />
                          {t("route.signatureRequired")}
                        </Badge>
                      )}
                      {stage.requires_rationale && (
                        <Badge
                          variant="outline"
                          className="gap-1 font-medium bg-amber-50 text-amber-800 border-amber-200"
                        >
                          <HelpCircle className="h-3 w-3" />
                          {t("route.rationaleRequired")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {(stage.required_fields || []).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("route.requiredFields")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {stage.required_fields.map((field) => (
                      <Badge
                        key={field}
                        variant="outline"
                        className="bg-slate-50 text-slate-700 border-slate-200 font-medium"
                      >
                        {field}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {(stage.participants || []).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("route.participants")}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {stage.participants.map((participant) => {
                      const participantStatus = statusMeta(participant.status);
                      return (
                        <li
                          key={`${stage.stage_key}-${participant.user_email}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate text-slate-700">
                            {participant.full_name || participant.user_email}
                            {participant.role ? (
                              <span className="ml-1 text-xs text-slate-400">({participant.role})</span>
                            ) : null}
                          </span>
                          <Badge variant="outline" className={cn("font-medium", participantStatus.className)}>
                            {participantStatus.label}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {(stage.signing_order || []).length > 0 && (
                <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-800">
                    <PenLine className="h-3 w-3" />
                    {t("route.signingOrder")}
                  </p>
                  <ol className="mt-2 space-y-1.5">
                    {stage.signing_order.map((signer, signerIndex) => {
                      const signerStatus = statusMeta(signer.status);
                      return (
                        <li
                          key={`${stage.stage_key}-${signer.user_email}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="text-xs font-semibold text-violet-700">
                              {signerIndex + 1}.
                            </span>
                            <span className="truncate text-slate-800">
                              {signer.full_name || signer.user_email}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            {signer.signed_at && (
                              <span className="text-xs text-slate-500">
                                {formatDateTime(signer.signed_at)}
                              </span>
                            )}
                            <Badge variant="outline" className={cn("font-medium", signerStatus.className)}>
                              {signerStatus.label}
                            </Badge>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {stage.acted_by && (
                <p className="mt-3 text-xs text-slate-500">
                  Acted by {stage.acted_by} · {formatDateTime(stage.acted_at)}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    );
  };

  const renderActionBar = () => {
    if (!selectedId || !signatureMap) return null;

    if (signatureMap.route_status !== "active" || !currentStage) {
      return (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm text-slate-600">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {signatureMap.route_status === "complete"
              ? "Every stage is complete — this route has been fully signed off."
              : "This route is returned for revision. Re-apply or advance it once the producing layer has updated the submission."}
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Workflow className="h-5 w-5 text-teal-600" />
            Act on {currentStage.name || currentStage.stage_key}
          </CardTitle>
          <CardDescription>
            {actionMeta(currentStage.action).label} stage · advance it, sign it, or return it for revision.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-4">
          <Button
            className="bg-teal-600 hover:bg-teal-700 gap-2"
            disabled={actMutation.isPending}
            onClick={() =>
              requestAction(
                "act",
                `Complete — ${currentStage.name || currentStage.stage_key}`,
                Boolean(currentStage.requires_rationale)
              )
            }
          >
            {actMutation.isPending && pendingAction?.action === "act" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Complete
          </Button>

          {engineSupportsSign && isSignerForCurrentStage && (
            <Button
              variant="outline"
              className="gap-2 border-violet-300 text-violet-800 hover:bg-violet-50"
              disabled={actMutation.isPending}
              onClick={() => requestAction("sign", "Sign this stage", false)}
            >
              {actMutation.isPending && pendingAction?.action === "sign" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PenLine className="h-4 w-4" />
              )}
              Sign
            </Button>
          )}

          <Button
            variant="outline"
            className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
            disabled={actMutation.isPending}
            onClick={() => requestAction("return", "Return for revision", true)}
          >
            {actMutation.isPending && pendingAction?.action === "return" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            {t("route.returnForRevision")}
          </Button>

          {currentStage.requires_signature && !isSignerForCurrentStage && (
            <p className="self-center text-xs text-slate-500">
              A signature is required at this stage; the Sign action appears for listed signatories.
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header ----------------------------------------------------------- */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600">
                <Workflow className="h-6 w-6 text-white" />
              </div>
              {t("route.title")}
            </h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              Apply a submission route to an opportunity and review its signature map — the ordered
              stages, the participants and signatories, what each stage must produce, and where the
              route stands — before you send it forward.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 bg-white text-slate-600 border-slate-200">
              <GitBranch className="h-3.5 w-3.5" />
              {stages.length ? `${stages.length} stages` : "No route"}
            </Badge>
          </div>
        </div>

        {/* Selection -------------------------------------------------------- */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg">Apply a route</CardTitle>
            <CardDescription>
              Choose the opportunity, then the workflow template to snapshot onto it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="opportunity-select">Opportunity</Label>
              <Select
                value={selectedId || undefined}
                onValueChange={(value) => {
                  setSelectedId(value);
                  setActiveThreadId(null);
                  setPendingAction(null);
                  setActionComment("");
                }}
              >
                <SelectTrigger id="opportunity-select" aria-label="Opportunity">
                  <SelectValue
                    placeholder={
                      opportunitiesQuery.isLoading ? "Loading opportunities..." : "Select an opportunity..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {opportunities.map((record) => (
                    <SelectItem key={record.id} value={record.id}>
                      {opportunityLabel(record)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {opportunitiesQuery.isError && (
                <p className="text-xs text-red-600">
                  {errorMessage(opportunitiesQuery.error, "Could not load opportunities.")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="workflow-select">Workflow</Label>
              {workflowsQuery.isLoading ? (
                <div className="flex h-9 items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading workflows...
                </div>
              ) : workflowsQuery.isError ? (
                <div className="flex items-center justify-between gap-2 text-xs text-red-600">
                  <span>{errorMessage(workflowsQuery.error, "Could not load workflows.")}</span>
                  <Button variant="outline" size="sm" onClick={() => workflowsQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : workflows.length === 0 ? (
                <p className="flex h-9 items-center text-sm text-slate-500">
                  No workflows configured — Apply uses the server default.
                </p>
              ) : (
                <>
                  <Select
                    value={workflowId || undefined}
                    onValueChange={setWorkflowId}
                  >
                    <SelectTrigger id="workflow-select" aria-label="Workflow">
                      <SelectValue placeholder="Select a workflow..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          {workflow.name}
                          {workflow.is_default ? " (default)" : ""} ·{" "}
                          {(workflow.stages || []).length} stages
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {selectedWorkflow
                      ? `${(selectedWorkflow.stages || []).length} stages · ${selectedWorkflow.status}`
                      : "Pick a workflow to see its stage count."}
                  </p>
                </>
              )}
            </div>

            <div className="flex items-end lg:col-span-3">
              <Button
                className="gap-2 bg-teal-600 hover:bg-teal-700"
                disabled={!selectedId || applyMutation.isPending}
                onClick={() => applyMutation.mutate()}
              >
                {applyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t("route.applyRoute")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main column ---------------------------------------------------- */}
          <div className="space-y-6 lg:col-span-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <GitBranch className="h-5 w-5 text-teal-600" />
                  {t("route.signatureMap")}
                </CardTitle>
                <CardDescription>
                  {signatureMap
                    ? `${signatureMap.workflow_name || "Route"} · ${signatureMap.route_status}`
                    : "Stages, actions, participants and signing order for the applied route."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                {routeNotFound && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    This opportunity has no applied route yet — applying a workflow will snapshot its
                    stages here.
                  </div>
                )}
                {renderSignatureMap()}
              </CardContent>
            </Card>

            {!signatureMapQuery.isError && renderActionBar()}

            {/* Related-party flag (E9.5) ------------------------------------ */}
            {selectedId && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertCircle className="h-5 w-5 text-teal-600" />
                    {t("route.relatedPartyCheck")}
                  </CardTitle>
                  <CardDescription>
                    Sourcing channel and any affiliate involvement for this opportunity.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  {relatedPartyQuery.isLoading ? (
                    loadingRow("Checking for affiliate involvement...")
                  ) : relatedPartyQuery.isError ? (
                    errorPanel(
                      errorMessage(relatedPartyQuery.error, "Could not load the related-party check."),
                      () => relatedPartyQuery.refetch()
                    )
                  ) : (
                    (() => {
                      const rp = relatedPartyQuery.data || {};
                      const channel = (rp.channels || []).find(
                        (c) => c.key === (rp.review?.sourcing_channel || rp.detection?.sourcing_channel)
                      );
                      return (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium",
                                rp.flagged
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-emerald-100 text-emerald-800 border-emerald-200"
                              )}
                            >
                              {rp.flagged ? "Flagged: related party" : "No related party detected"}
                            </Badge>
                            {channel && (
                              <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                                {channel.label}
                              </Badge>
                            )}
                          </div>
                          {rp.detection?.detection_basis && (
                            <p className="text-sm text-slate-600">
                              Basis: {rp.detection.detection_basis}
                            </p>
                          )}
                          {rp.review?.disclosure && (
                            <p className="text-sm text-slate-600">Disclosure: {rp.review.disclosure}</p>
                          )}
                          {rp.review?.independent_reviewer_name || rp.review?.independent_reviewer_email ? (
                            <p className="text-sm text-slate-600">
                              Independent reviewer:{" "}
                              {rp.review.independent_reviewer_name || rp.review.independent_reviewer_email}
                            </p>
                          ) : rp.flagged ? (
                            <p className="text-xs text-amber-700">
                              A flagged deal must name a disclosure and an independent reviewer.
                            </p>
                          ) : null}

                          {/* Related-party overlay enforcement (W6-03 / BRD WF-06).
                              A flagged deal carries a status, its outstanding
                              requirements, the arm's-length record and the
                              independent sign-off. Only a non-conflicted,
                              delegated reviewer may sign off. */}
                          {rp.overlay?.flagged && (
                            <div className="space-y-3 border-t border-slate-100 pt-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "font-medium",
                                    rp.overlay.status === "signed_off"
                                      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                      : rp.overlay.status === "documented"
                                        ? "bg-sky-100 text-sky-800 border-sky-200"
                                        : "bg-amber-100 text-amber-800 border-amber-200"
                                  )}
                                  data-testid="rp-overlay-status"
                                >
                                  Overlay: {rp.overlay.status_label || rp.overlay.status}
                                </Badge>
                                {rp.overlay.blocked && (
                                  <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                                    Screening decision blocked
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-slate-600" data-testid="rp-overlay-message">
                                {rp.overlay.message}
                              </p>
                              {(rp.overlay.outstanding || []).length > 0 && (
                                <ul className="list-disc pl-5 text-xs text-amber-700" data-testid="rp-outstanding">
                                  {rp.overlay.outstanding.map((o) => (
                                    <li key={o.key}>{o.label}</li>
                                  ))}
                                </ul>
                              )}

                              <div className="rounded-md border border-slate-200 p-3 space-y-3">
                                <p className="text-xs font-semibold uppercase text-slate-500">Overlay record</p>
                                <div className="space-y-1">
                                  <Label className="text-xs">Disclosure</Label>
                                  <Textarea
                                    rows={2}
                                    value={rpForm.disclosure}
                                    onChange={(e) => setRpForm({ ...rpForm, disclosure: e.target.value })}
                                    data-testid="rp-disclosure"
                                  />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Arm&apos;s-length basis</Label>
                                    <select
                                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                                      value={rpForm.arm_length_basis}
                                      onChange={(e) => setRpForm({ ...rpForm, arm_length_basis: e.target.value })}
                                      data-testid="rp-arm-length-basis"
                                    >
                                      <option value="">Select a basis...</option>
                                      {(rp.arm_length_bases || []).map((b) => (
                                        <option key={b.key} value={b.key}>{b.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Conflicted users (emails, comma-separated)</Label>
                                    <Input
                                      value={rpForm.conflicted_users}
                                      onChange={(e) => setRpForm({ ...rpForm, conflicted_users: e.target.value })}
                                      placeholder="person@example.com"
                                      data-testid="rp-conflicted-users"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Arm&apos;s-length evidence note</Label>
                                  <Input
                                    value={rpForm.arm_length_note}
                                    onChange={(e) => setRpForm({ ...rpForm, arm_length_note: e.target.value })}
                                    data-testid="rp-arm-length-note"
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  disabled={!rp.viewer?.may_decide || rpSaveMutation.isPending}
                                  onClick={() => rpSaveMutation.mutate({
                                    flagged: true,
                                    disclosure: rpForm.disclosure,
                                    arm_length_basis: rpForm.arm_length_basis,
                                    arm_length_note: rpForm.arm_length_note,
                                    conflicted_users: rpForm.conflicted_users.split(",").map((x) => x.trim()).filter(Boolean),
                                  })}
                                  data-testid="rp-save"
                                >
                                  {rpSaveMutation.isPending ? "Saving..." : "Save overlay record"}
                                </Button>
                              </div>

                              <div className="rounded-md border border-slate-200 p-3 space-y-2">
                                <p className="text-xs font-semibold uppercase text-slate-500">Independent sign-off</p>
                                {rp.overlay.signed_off ? (
                                  <p className="text-sm text-emerald-700" data-testid="rp-signed-off">
                                    Signed off by {rp.overlay.signed_off_by} — the overlay no longer blocks the
                                    Gate-1 decision.
                                  </p>
                                ) : (
                                  <>
                                    <p className="text-xs text-slate-500">
                                      {rp.viewer?.may_sign_off
                                        ? "You may sign this off as an independent, non-conflicted reviewer."
                                        : (rp.viewer?.signoff_reason || "You are not able to sign this off.")}
                                    </p>
                                    <Input
                                      placeholder="Sign-off note (optional)"
                                      value={rpSignoffNote}
                                      onChange={(e) => setRpSignoffNote(e.target.value)}
                                      data-testid="rp-signoff-note"
                                    />
                                    <Button
                                      size="sm"
                                      disabled={!rp.viewer?.may_sign_off || rpSignoffMutation.isPending}
                                      onClick={() => rpSignoffMutation.mutate({ signoff_note: rpSignoffNote })}
                                      data-testid="rp-signoff"
                                    >
                                      {rpSignoffMutation.isPending ? "Signing off..." : "Sign off independently"}
                                    </Button>
                                  </>
                                )}
                                {rp.viewer?.conflicted && (
                                  <p className="text-xs text-red-600" data-testid="rp-conflicted">
                                    You are conflicted with this deal
                                    {(rp.viewer.conflict_reasons || []).length ? " (" + rp.viewer.conflict_reasons.join(", ") + ")" : ""} and
                                    may not sign off or take the screening decision.
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
            )}

            {/* History ----------------------------------------------------- */}
            {/* Presentation scheduling (W6-06 / BRD WF-07) ----------------- */}
            {selectedId && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Send className="h-5 w-5 text-teal-600" />
                    Presentation scheduling
                  </CardTitle>
                  <CardDescription>
                    Capture the investor or committee session date, attendees, outcome and next steps on record.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  {presentationsQuery.isLoading ? (
                    loadingRow("Loading presentation sessions...")
                  ) : presentationsQuery.isError ? (
                    errorPanel(
                      errorMessage(presentationsQuery.error, "Could not load presentation sessions."),
                      () => presentationsQuery.refetch()
                    )
                  ) : (
                    (() => {
                      const pd = presentationsQuery.data || {};
                      const sessions = pd.sessions || [];
                      const mayManage = Boolean(pd.viewer?.may_manage);
                      return (
                        <div className="space-y-4">
                          <div className="space-y-3 rounded-md border border-slate-200 p-3">
                            <p className="text-xs font-semibold uppercase text-slate-500">
                              {prEditingId ? "Update session" : "Schedule a session"}
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Scheduled date and time</Label>
                                <Input
                                  type="datetime-local"
                                  value={prForm.scheduled_at}
                                  onChange={(e) => setPrForm({ ...prForm, scheduled_at: e.target.value })}
                                  disabled={!mayManage}
                                  data-testid="pr-scheduled-at"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Format</Label>
                                <select
                                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                                  value={prForm.format}
                                  onChange={(e) => setPrForm({ ...prForm, format: e.target.value })}
                                  disabled={!mayManage}
                                  data-testid="pr-format"
                                >
                                  {(pd.formats || []).map((f) => (
                                    <option key={f.key} value={f.key}>{f.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Attendees (emails, comma-separated)</Label>
                              <Input
                                value={prForm.attendees}
                                onChange={(e) => setPrForm({ ...prForm, attendees: e.target.value })}
                                placeholder="person@example.com"
                                disabled={!mayManage}
                                data-testid="pr-attendees"
                              />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Location or dial-in</Label>
                                <Input
                                  value={prForm.location}
                                  onChange={(e) => setPrForm({ ...prForm, location: e.target.value })}
                                  disabled={!mayManage}
                                  data-testid="pr-location"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Status</Label>
                                <select
                                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                                  value={prForm.status}
                                  onChange={(e) => setPrForm({ ...prForm, status: e.target.value })}
                                  disabled={!mayManage}
                                  data-testid="pr-status"
                                >
                                  {(pd.statuses || []).map((s) => (
                                    <option key={s.key} value={s.key}>{s.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Outcome (required to complete)</Label>
                              <Textarea
                                rows={2}
                                value={prForm.outcome}
                                onChange={(e) => setPrForm({ ...prForm, outcome: e.target.value })}
                                disabled={!mayManage}
                                data-testid="pr-outcome"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Next steps</Label>
                              <Textarea
                                rows={2}
                                value={prForm.next_steps}
                                onChange={(e) => setPrForm({ ...prForm, next_steps: e.target.value })}
                                disabled={!mayManage}
                                data-testid="pr-next-steps"
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                disabled={!mayManage || prSaveMutation.isPending}
                                onClick={() => prSaveMutation.mutate({
                                  scheduled_at: prForm.scheduled_at ? new Date(prForm.scheduled_at).toISOString() : "",
                                  format: prForm.format,
                                  status: prForm.status,
                                  location: prForm.location,
                                  attendees: prForm.attendees.split(",").map((x) => x.trim()).filter(Boolean),
                                  outcome: prForm.outcome,
                                  next_steps: prForm.next_steps,
                                })}
                                data-testid="pr-save"
                              >
                                {prSaveMutation.isPending ? "Saving..." : prEditingId ? "Save changes" : "Schedule presentation"}
                              </Button>
                              {prEditingId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setPrEditingId(null);
                                    setPrForm({ scheduled_at: "", format: "video", status: "scheduled", location: "", attendees: "", outcome: "", next_steps: "", notes: "" });
                                  }}
                                >
                                  Cancel
                                </Button>
                              )}
                              {!mayManage && (
                                <span className="text-xs text-slate-500" data-testid="pr-readonly">
                                  You have view-only access to this opportunity.
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase text-slate-500">Recorded sessions</p>
                            {sessions.length === 0 ? (
                              <p className="text-sm text-slate-500" data-testid="pr-empty">No presentation sessions captured yet.</p>
                            ) : (
                              <ul className="space-y-2" data-testid="pr-sessions">
                                {sessions.map((s) => (
                                  <li key={s.id} className="rounded-md border border-slate-200 p-3" data-testid="pr-session">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <Badge variant="outline" className={cn("font-medium",
                                        s.status === "completed" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                          : s.status === "cancelled" ? "bg-red-100 text-red-800 border-red-200"
                                            : "bg-sky-100 text-sky-800 border-sky-200")}
                                        data-testid="pr-session-status">
                                        {s.status}
                                      </Badge>
                                      <span className="text-xs text-slate-500">{s.format}</span>
                                      {s.scheduled_at && (
                                        <span className="text-xs text-slate-600">{new Date(s.scheduled_at).toLocaleString()}</span>
                                      )}
                                      {mayManage && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="ml-auto h-7"
                                          onClick={() => {
                                            setPrEditingId(s.id);
                                            setPrForm({
                                              scheduled_at: s.scheduled_at ? new Date(s.scheduled_at).toISOString().slice(0, 16) : "",
                                              format: s.format || "video",
                                              status: s.status || "scheduled",
                                              location: s.location || "",
                                              attendees: (s.attendees || []).map((a) => a.email).join(", "),
                                              outcome: s.outcome || "",
                                              next_steps: s.next_steps || "",
                                              notes: s.notes || "",
                                            });
                                          }}
                                          data-testid="pr-edit"
                                        >
                                          Edit
                                        </Button>
                                      )}
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600" data-testid="pr-session-attendees">
                                      Attendees: {(s.attendees || []).map((a) => a.email).join(", ") || "none"}
                                    </p>
                                    {s.outcome && <p className="text-sm text-slate-600">Outcome: {s.outcome}</p>}
                                    {s.next_steps && <p className="text-sm text-slate-600">Next steps: {s.next_steps}</p>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ChevronRight className="h-5 w-5 text-teal-600" />
                  Stage &amp; action history
                </CardTitle>
                <CardDescription>Newest first — every route event with its actor.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {!selectedId ? (
                  <p className="py-6 text-sm text-slate-500">
                    Select an opportunity to see its route history.
                  </p>
                ) : eventsQuery.isLoading ? (
                  loadingRow("Loading history...")
                ) : eventsQuery.isError ? (
                  errorPanel(
                    errorMessage(eventsQuery.error, "Could not load the route history."),
                    () => eventsQuery.refetch()
                  )
                ) : events.length === 0 ? (
                  <p className="py-6 text-sm text-slate-500">No route events recorded yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {events.map((event) => {
                      const meta = actionMeta(event.action);
                      return (
                        <li
                          key={event.id}
                          className="border-l-2 border-slate-200 pl-3"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className={cn("font-medium", meta.className)}>
                              {meta.label}
                            </Badge>
                            {event.stage_key && (
                              <span className="text-xs text-slate-500">{event.stage_key}</span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {event.actor_email || "unknown"} · {formatDateTime(event.created_at)}
                          </p>
                          {event.comment && (
                            <p className="mt-1 text-sm text-slate-600">{event.comment}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Q&A side panel -------------------------------------------------- */}
          <div className="space-y-6">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <HelpCircle className="h-5 w-5 text-teal-600" />
                    Clarifications (Q&amp;A)
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={!selectedId}
                    onClick={() => {
                      setNewThreadForm({
                        subject: "",
                        body: "",
                        requiresResponse: false,
                        participants: "",
                      });
                      setNewThreadOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </Button>
                </div>
                <CardDescription>
                  {selectedId
                    ? "Clarifications raised on this opportunity."
                    : "Select an opportunity to see its questions."}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {!selectedId ? (
                  <p className="py-6 text-sm text-slate-500">Nothing selected yet.</p>
                ) : activeThreadId ? (
                  <div className="space-y-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 px-0"
                      onClick={() => setActiveThreadId(null)}
                    >
                      <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                      {t("qa.backToThreads")}
                    </Button>

                    {threadQuery.isLoading ? (
                      loadingRow("Loading thread...")
                    ) : threadQuery.isError ? (
                      errorPanel(
                        errorMessage(threadQuery.error, "Could not load this thread."),
                        () => threadQuery.refetch()
                      )
                    ) : activeThread ? (
                      <>
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">{activeThread.subject}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium",
                                activeThread.is_open
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                              )}
                            >
                              {activeThread.is_open ? "Open" : "Closed"}
                            </Badge>
                            {activeThread.awaiting_response && (
                              <Badge
                                variant="outline"
                                className="bg-amber-100 text-amber-800 border-amber-200 font-medium"
                              >
                                {t("qa.awaitingResponse")}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <Separator />

                        <ul className="space-y-3">
                          {(activeThread.messages || []).map((message) => (
                            <li
                              key={message.id}
                              className={cn(
                                "rounded-lg border p-3 text-sm",
                                message.is_response
                                  ? "border-emerald-200 bg-emerald-50"
                                  : "border-slate-200 bg-white"
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-slate-800">
                                  {message.author_name || message.author_email}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {formatDateTime(message.created_at)}
                                </span>
                              </div>
                              {message.is_response && (
                                <Badge
                                  variant="outline"
                                  className="mt-1 bg-emerald-100 text-emerald-800 border-emerald-200 font-medium"
                                >
                                  Response
                                </Badge>
                              )}
                              <p className="mt-1 whitespace-pre-wrap text-slate-700">{message.body}</p>
                            </li>
                          ))}
                        </ul>

                        {activeThread.is_open ? (
                          <div className="space-y-3">
                            <Textarea
                              rows={3}
                              value={replyBody}
                              placeholder="Write a reply..."
                              aria-label="Reply"
                              onChange={(event) => setReplyBody(event.target.value)}
                            />
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="reply-is-response"
                                checked={replyIsResponse}
                                onCheckedChange={(checked) => setReplyIsResponse(checked === true)}
                              />
                              <Label htmlFor="reply-is-response" className="text-sm font-normal">
                                {t("qa.markAsResponse")}
                              </Label>
                            </div>
                            {meMayInternal && (
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id="reply-internal"
                                  checked={replyVisibility === "internal"}
                                  onCheckedChange={(checked) => setReplyVisibility(checked === true ? "internal" : "shared")}
                                />
                                <Label htmlFor="reply-internal" className="text-sm font-normal">
                                  Internal (group only)
                                </Label>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                className="gap-1 bg-teal-600 hover:bg-teal-700"
                                disabled={!replyBody.trim() || replyMutation.isPending}
                                onClick={() => replyMutation.mutate()}
                              >
                                {replyMutation.isPending ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Send className="h-3.5 w-3.5" />
                                )}
                                Send
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={closeThreadMutation.isPending}
                                onClick={() => closeThreadMutation.mutate()}
                              >
                                {t("qa.closeThread")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={reopenThreadMutation.isPending}
                            onClick={() => reopenThreadMutation.mutate()}
                          >
                            {reopenThreadMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            {t("common.reopen")}
                          </Button>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : threadsQuery.isLoading ? (
                  loadingRow("Loading threads...")
                ) : threadsQuery.isError ? (
                  errorPanel(
                    errorMessage(threadsQuery.error, "Could not load clarifications."),
                    () => threadsQuery.refetch()
                  )
                ) : threads.length === 0 ? (
                  emptyState(
                    MessageSquare,
                    "No clarifications",
                    "No questions have been raised on this opportunity yet."
                  )
                ) : (
                  <ul className="space-y-2">
                    {threads.map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyBody("");
                            setReplyIsResponse(false);
                            setActiveThreadId(thread.id);
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                        >
                          <p className="font-medium text-slate-900">{thread.subject}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium",
                                thread.is_open
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                              )}
                            >
                              {thread.is_open ? "Open" : "Closed"}
                            </Badge>
                            {thread.awaiting_response && (
                              <Badge
                                variant="outline"
                                className="bg-amber-100 text-amber-800 border-amber-200 font-medium"
                              >
                                Awaiting response
                              </Badge>
                            )}
                            <span className="text-xs text-slate-500">
                              {thread.message_count ?? 0} messages
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Action confirm dialog --------------------------------------------- */}
      <Dialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setActionComment("");
            setActionReasonCode("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingAction?.label}</DialogTitle>
            <DialogDescription>
              {pendingAction?.requireComment
                ? pendingAction?.action === "return"
                  ? "A comment is required so the producing layer knows what to revise."
                  : "A rationale is required — record why this decision is being taken."
                : "Add an optional comment for the route history."}
            </DialogDescription>
          </DialogHeader>
          {pendingAction?.requireComment && (
            <div className="space-y-2">
              <Label>Reason code</Label>
              <Select value={actionReasonCode} onValueChange={setActionReasonCode}>
                <SelectTrigger data-testid="action-reason-code">
                  <SelectValue placeholder="Choose a reason code..." />
                </SelectTrigger>
                <SelectContent>
                  {pendingActionReasonOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="action-comment">
              {pendingAction?.action === "return" ? "Comment" : "Rationale"}
              {pendingAction?.requireComment ? "" : " (optional)"}
            </Label>
            <Textarea
              id="action-comment"
              rows={3}
              value={actionComment}
              placeholder={
                pendingAction?.action === "return"
                  ? "Anything the producing layer should revise..."
                  : "Anything the next actor should know..."
              }
              onChange={(event) => setActionComment(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingAction(null);
                setActionComment("");
                setActionReasonCode("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="gap-2 bg-teal-600 hover:bg-teal-700"
              disabled={
                actMutation.isPending ||
                (pendingAction?.requireComment &&
                  (!actionComment.trim() || !actionReasonCode))
              }
              onClick={submitAction}
            >
              {actMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New thread dialog -------------------------------------------------- */}
      <Dialog open={newThreadOpen} onOpenChange={setNewThreadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("route.openClarification")}</DialogTitle>
            <DialogDescription>
              Raise a question against this opportunity. Participants are notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="thread-subject">Subject</Label>
              <Input
                id="thread-subject"
                value={newThreadForm.subject}
                placeholder="e.g. Confirm the equity IRR assumption"
                onChange={(event) =>
                  setNewThreadForm((prev) => ({ ...prev, subject: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="thread-body">Question</Label>
              <Textarea
                id="thread-body"
                rows={4}
                value={newThreadForm.body}
                placeholder="Describe what you need clarified..."
                onChange={(event) =>
                  setNewThreadForm((prev) => ({ ...prev, body: event.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="thread-requires-response"
                checked={newThreadForm.requiresResponse}
                onCheckedChange={(checked) =>
                  setNewThreadForm((prev) => ({ ...prev, requiresResponse: checked === true }))
                }
              />
              <Label htmlFor="thread-requires-response" className="text-sm font-normal">
                {t("qa.requiresResponse")}
              </Label>
            </div>
            {meMayInternal && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="thread-internal"
                  checked={newThreadVisibility === "internal"}
                  onCheckedChange={(checked) => setNewThreadVisibility(checked === true ? "internal" : "shared")}
                />
                <Label htmlFor="thread-internal" className="text-sm font-normal">
                  Keep internal to the group (hidden from subsidiary roles)
                </Label>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="thread-participants">Participants (optional)</Label>
              <Input
                id="thread-participants"
                value={newThreadForm.participants}
                placeholder="name@example.com, other@example.com"
                onChange={(event) =>
                  setNewThreadForm((prev) => ({ ...prev, participants: event.target.value }))
                }
              />
              <p className="text-xs text-slate-500">Comma-separated email addresses.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewThreadOpen(false)}>
              Cancel
            </Button>
            <Button
              className="gap-2 bg-teal-600 hover:bg-teal-700"
              disabled={!canSubmitNewThread || openThreadMutation.isPending}
              onClick={() => openThreadMutation.mutate()}
            >
              {openThreadMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("qa.openThread")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
