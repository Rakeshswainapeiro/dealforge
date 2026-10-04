import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  ArrowDown,
  ChevronRight,
  Loader2,
  MessageSquareQuote,
  MessagesSquare,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// E8 — Q&A / clarification loop.
//
// One inbox for every clarification thread the signed-in user participates in,
// across opportunities (REQ-QA-01, REQ-FLOW-02). Threads are permissioned and
// audit-logged server-side: this page only reads api.qa.* payloads, sends a
// reply / close / reopen, and renders the server's audit rows verbatim. It
// never scopes by organisation or decides who may act — a 403/404/409 from the
// server surfaces as an inline error.
// ---------------------------------------------------------------------------

const FILTERS = [
  { key: "all", labelKey: "qa.all" },
  { key: "open", labelKey: "common.open" },
  { key: "awaiting", labelKey: "qa.awaitingResponse" },
  { key: "closed", labelKey: "common.closed" },
];

const AUDIT_ACTION_META = {
  open: { label: "Opened", className: "bg-teal-100 text-teal-800 border-teal-200" },
  reply: { label: "Reply", className: "bg-blue-100 text-blue-800 border-blue-200" },
  message: { label: "Message", className: "bg-blue-100 text-blue-800 border-blue-200" },
  response: { label: "Formal response", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  close: { label: "Closed", className: "bg-slate-100 text-slate-700 border-slate-200" },
  reopen: { label: "Reopened", className: "bg-amber-100 text-amber-800 border-amber-200" },
};

function auditActionMeta(action) {
  const key = String(action || "").toLowerCase();
  return (
    AUDIT_ACTION_META[key] || {
      label: key ? key.replace(/_/g, " ") : "Event",
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
    return "You do not have permission to act on this clarification thread.";
  }
  if (error?.status === 404) {
    return "This thread could not be found. It may have been removed or you are no longer a participant.";
  }
  if (error?.status === 409) {
    return "That action is no longer allowed — the thread has already changed. The inbox has been refreshed.";
  }
  return error?.message || fallback;
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

function errorPanel(error, onRetry, fallback) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-red-800">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorMessage(error, fallback)}
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

export default function QandA() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [body, setBody] = useState("");
  const [isResponse, setIsResponse] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeComment, setCloseComment] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [replyVisibility, setReplyVisibility] = useState("shared");
  const [meCanSeeInternal, setMeCanSeeInternal] = useState(false);

  const meQuery = useQuery({
    queryKey: ["qa", "me"],
    queryFn: () => api.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  // The effective comment visibility policy tells us whether this viewer may
  // keep a reply internal (W6-04 / AUD-03).
  const cvQuery = useQuery({
    queryKey: ["comment-visibility"],
    queryFn: () => api.commentVisibility.config(),
    staleTime: 5 * 60 * 1000,
  });

  const myThreadsQuery = useQuery({
    queryKey: ["qa", "my-threads"],
    queryFn: () => api.qa.myThreads(),
  });

  const threadQuery = useQuery({
    queryKey: ["qa", "thread", selectedId],
    queryFn: () => api.qa.thread(selectedId),
    enabled: Boolean(selectedId),
  });

  const auditQuery = useQuery({
    queryKey: ["qa", "audit", selectedId],
    queryFn: () => api.qa.audit(selectedId),
    enabled: Boolean(selectedId),
  });

  const invalidateThread = (threadId) => {
    queryClient.invalidateQueries({ queryKey: ["qa", "my-threads"] });
    if (threadId) {
      queryClient.invalidateQueries({ queryKey: ["qa", "thread", threadId] });
      queryClient.invalidateQueries({ queryKey: ["qa", "audit", threadId] });
    }
  };

  const replyMutation = useMutation({
    mutationFn: ({ threadId, messageBody, asResponse, visibility }) =>
      api.qa.reply(threadId, messageBody, asResponse, visibility),
    onSuccess: (_result, variables) => {
      invalidateThread(variables.threadId);
      setBody("");
      setIsResponse(false);
      setReplyVisibility("shared");
      toast({
        title: variables.asResponse ? "Formal response sent" : "Reply sent",
        description: variables.asResponse
          ? "Your reply is recorded as the formal response on this thread."
          : "Your reply was added to the clarification thread.",
      });
    },
    onError: (error, variables) => {
      invalidateThread(variables.threadId);
      toast({
        variant: "destructive",
        title: "Could not send your reply",
        description: errorMessage(error, "The reply was rejected."),
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ threadId, comment }) => api.qa.close(threadId, comment),
    onSuccess: (_result, variables) => {
      invalidateThread(variables.threadId);
      setCloseDialogOpen(false);
      setCloseComment("");
      toast({
        title: "Thread closed",
        description: "The clarification thread is now closed.",
      });
    },
    onError: (error, variables) => {
      invalidateThread(variables.threadId);
      toast({
        variant: "destructive",
        title: "Could not close the thread",
        description: errorMessage(error, "The thread could not be closed."),
      });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: ({ threadId, comment }) => api.qa.reopen(threadId, comment),
    onSuccess: (_result, variables) => {
      invalidateThread(variables.threadId);
      toast({
        title: "Thread reopened",
        description: "The thread is open again for further clarification.",
      });
    },
    onError: (error, variables) => {
      invalidateThread(variables.threadId);
      toast({
        variant: "destructive",
        title: "Could not reopen the thread",
        description: errorMessage(error, "The thread could not be reopened."),
      });
    },
  });

  const threads = useMemo(() => myThreadsQuery.data?.items || [], [myThreadsQuery.data]);

  // Auto-select the first thread once the inbox has loaded and nothing else is
  // selected, so the detail pane is never empty when threads exist.
  useEffect(() => {
    if (selectedId || threads.length === 0) return;
    setSelectedId(threads[0].id);
  }, [threads, selectedId]);

  // Reset the composer and disclosure whenever the selected thread changes.
  useEffect(() => {
    setBody("");
    setIsResponse(false);
    setAuditOpen(false);
    setCloseDialogOpen(false);
    setCloseComment("");
  }, [selectedId]);

  // Whether this viewer may mark a comment internal, from the policy viewer block.
  useEffect(() => {
    setMeCanSeeInternal(Boolean(cvQuery.data?.viewer?.may_view_internal));
  }, [cvQuery.data]);

  const counts = useMemo(
    () => ({
      all: threads.length,
      open: threads.filter((thread) => thread.is_open).length,
      awaiting: threads.filter((thread) => thread.awaiting_response).length,
      closed: threads.filter((thread) => !thread.is_open).length,
    }),
    [threads]
  );

  const visibleThreads = useMemo(() => {
    if (filter === "open") return threads.filter((thread) => thread.is_open);
    if (filter === "awaiting") return threads.filter((thread) => thread.awaiting_response);
    if (filter === "closed") return threads.filter((thread) => !thread.is_open);
    return threads;
  }, [threads, filter]);

  const thread = threadQuery.data;
  const myEmail = meQuery.data?.email || null;
  const isOpen = thread ? Boolean(thread.is_open) : false;
  const busy = replyMutation.isPending || closeMutation.isPending || reopenMutation.isPending;

  const messages = useMemo(() => {
    const list = Array.isArray(thread?.messages) ? [...thread.messages] : [];
    list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    return list;
  }, [thread]);

  const participants = useMemo(
    () => (Array.isArray(thread?.participants) ? thread.participants : []),
    [thread]
  );

  const auditRows = useMemo(
    () => (Array.isArray(auditQuery.data) ? auditQuery.data : []),
    [auditQuery.data]
  );

  // "Closed by" comes from the server's own audit rows rather than being
  // re-derived from thread state.
  const closedBy = useMemo(() => {
    const event = auditRows.find((row) => String(row.action || "").toLowerCase().includes("close"));
    return event?.actor_email || null;
  }, [auditRows]);

  const canSend = Boolean(thread) && isOpen && body.trim().length > 0 && !busy;

  const sendReply = () => {
    if (!canSend) return;
    const messageBody = body.trim();
    replyMutation.mutate({ threadId: selectedId, messageBody, asResponse: isResponse, visibility: replyVisibility });
  };

  const requestClose = () => {
    closeMutation.mutate({ threadId: selectedId, comment: closeComment.trim() || undefined });
  };

  const reopenThread = () => {
    reopenMutation.mutate({ threadId: selectedId, comment: undefined });
  };

  const threadCard = (item) => {
    const active = item.id === selectedId;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setSelectedId(item.id)}
        aria-pressed={active}
        className={cn(
          "w-full rounded-lg border bg-white p-3 text-left shadow-sm transition-all",
          active ? "border-teal-400 ring-1 ring-teal-200" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium leading-snug text-slate-900 line-clamp-2">
            {item.subject || "(no subject)"}
          </p>
          {item.is_open ? (
            <Badge variant="outline" className="shrink-0 gap-1 bg-emerald-100 text-emerald-800 border-emerald-200">
              {t("common.open")}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 gap-1 bg-slate-100 text-slate-600 border-slate-200">
              {t("common.closed")}
            </Badge>
          )}
        </div>

        <p className="mt-1 truncate text-xs text-slate-500">
          {item.opportunity_name || "Unknown opportunity"}
        </p>
        <p className="mt-1 truncate text-xs text-slate-500">
          Raised by {item.raised_by_name || item.raised_by || "unknown"}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {item.awaiting_response && (
            <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-800 border-amber-200">
              <ArrowDown className="h-3 w-3" />
              {t("qa.awaitingResponse")}
            </Badge>
          )}
          {item.visibility === "internal" && (
            <Badge variant="outline" className="gap-1 bg-sky-100 text-sky-800 border-sky-200">
              Internal
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-600 border-slate-200">
            <MessagesSquare className="h-3 w-3" />
            {item.message_count ?? 0}
          </Badge>
          <span className="ml-auto text-xs text-slate-400">{formatDateTime(item.updated_at)}</span>
        </div>
      </button>
    );
  };

  const renderDetail = () => {
    if (threadQuery.isLoading) {
      return (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the thread...
        </div>
      );
    }
    if (threadQuery.isError) {
      return errorPanel(threadQuery.error, () => threadQuery.refetch(), "Could not load this thread.");
    }
    if (!thread) {
      return emptyState(
        MessageSquareQuote,
        "Select a thread",
        "Choose a clarification thread on the left to read the conversation and reply."
      );
    }

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug text-slate-900">
              {thread.subject || "(no subject)"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {thread.opportunity_name || "Unknown opportunity"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOpen ? (
              <Badge variant="outline" className="gap-1 bg-emerald-100 text-emerald-800 border-emerald-200">
                {t("common.open")}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-600 border-slate-200">
                {t("common.closed")}
              </Badge>
            )}
            {thread.visibility === "internal" && (
              <Badge variant="outline" className="gap-1 bg-sky-100 text-sky-800 border-sky-200">
                Internal (group only)
              </Badge>
            )}
            {thread.awaiting_response && (
              <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-800 border-amber-200">
                <ArrowDown className="h-3 w-3" />
                {t("qa.awaitingResponse")}
              </Badge>
            )}
            {isOpen ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setCloseComment("");
                  setCloseDialogOpen(true);
                }}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
                {t("qa.closeThread")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={reopenThread}
                disabled={busy}
              >
                {reopenMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                {t("qa.reopenThread")}
              </Button>
            )}
          </div>
        </div>

        {/* Metadata ------------------------------------------------------- */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Raised by</p>
            <p className="truncate text-sm font-medium text-slate-900">
              {thread.raised_by_name || thread.raised_by || "Unknown"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Opened</p>
            <p className="text-sm font-medium text-slate-900">{formatDateTime(thread.opened_at)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">{isOpen ? "Status" : "Closed"}</p>
            <p className="truncate text-sm font-medium text-slate-900">
              {isOpen ? "Open for clarification" : formatDateTime(thread.closed_at)}
            </p>
            {!isOpen && (
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {closedBy ? `by ${closedBy}` : "Closed by an authorised participant"}
              </p>
            )}
          </div>
        </div>

        {/* Participants --------------------------------------------------- */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">Participants</p>
          {participants.length === 0 ? (
            <p className="text-sm text-slate-500">No participants are listed on this thread.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {participants.map((person) => (
                <Badge
                  key={`${person.user_email}-${person.role || "member"}`}
                  variant="outline"
                  className="gap-1 bg-white text-slate-700 border-slate-200 font-normal"
                >
                  <span className="font-medium">{person.user_email}</span>
                  {person.role && <span className="text-slate-400">·</span>}
                  {person.role && <span>{person.role}</span>}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Messages ------------------------------------------------------- */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-800">Conversation</p>
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">No messages on this thread yet.</p>
          ) : (
            <ul className="space-y-3">
              {messages.map((message) => {
                const mine = Boolean(myEmail) && message.author_email === myEmail;
                return (
                  <li key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg border p-3 shadow-sm sm:max-w-[75%]",
                        mine ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-white"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {mine ? "You" : message.author_name || message.author_email || "Unknown"}
                        </span>
                        {!mine && message.author_email && (
                          <span className="text-xs text-slate-400">{message.author_email}</span>
                        )}
                        {message.is_response && (
                          <Badge
                            variant="outline"
                            className="gap-1 bg-indigo-100 text-indigo-800 border-indigo-200"
                          >
                            <ShieldCheck className="h-3 w-3" />
                            {t("qa.formalResponse")}
                          </Badge>
                        )}
                        {message.visibility === "internal" && (
                          <Badge
                            variant="outline"
                            className="gap-1 bg-sky-100 text-sky-800 border-sky-200"
                          >
                            Internal
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                        {message.body}
                      </p>
                      <p className="mt-1.5 text-xs text-slate-400">
                        {formatDateTime(message.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Separator />

        {/* Composer ------------------------------------------------------- */}
        {isOpen ? (
          <div className="space-y-3">
            <Label htmlFor="qa-reply" className="text-sm font-semibold text-slate-800">
              {t("qa.reply")}
            </Label>
            <Textarea
              id="qa-reply"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write your clarification..."
              rows={4}
              disabled={replyMutation.isPending}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <Checkbox
                  checked={isResponse}
                  onCheckedChange={(checked) => setIsResponse(checked === true)}
                  disabled={replyMutation.isPending}
                  aria-label="Mark as the formal response"
                />
                {t("qa.markAsResponse")}
              </label>
              {meCanSeeInternal && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <Checkbox
                    checked={replyVisibility === "internal"}
                    onCheckedChange={(checked) => setReplyVisibility(checked === true ? "internal" : "shared")}
                    disabled={replyMutation.isPending}
                    aria-label="Keep this comment internal to the group"
                  />
                  Internal (group only)
                </label>
              )}
              <Button
                className="gap-2 bg-teal-600 hover:bg-teal-700"
                onClick={sendReply}
                disabled={!canSend}
              >
                {replyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
                {t("common.send")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <AlertCircle className="h-4 w-4 text-slate-400 shrink-0" />
              This thread is closed. Reopen it to post another clarification.
            </p>
            <Button variant="outline" className="gap-2" onClick={reopenThread} disabled={busy}>
              {reopenMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {t("common.reopen")}
            </Button>
          </div>
        )}

        {/* Audit trail ---------------------------------------------------- */}
        <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <ChevronRight
                  className={cn("h-4 w-4 text-slate-400 transition-transform", auditOpen && "rotate-90")}
                />
                {t("qa.auditTrail")}
              </span>
              <span className="text-xs font-normal text-slate-500">
                {auditOpen ? "Hide" : "Show"}
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {auditQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the audit trail...
              </div>
            ) : auditQuery.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-600">
                <span>{errorMessage(auditQuery.error, "Could not load the audit trail.")}</span>
                <Button variant="outline" size="sm" onClick={() => auditQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : auditRows.length === 0 ? (
              <p className="text-sm text-slate-500">No audit events recorded for this thread.</p>
            ) : (
              <ul className="space-y-3">
                {auditRows.map((row) => {
                  const meta = auditActionMeta(row.action);
                  return (
                    <li key={row.id} className="border-l-2 border-slate-200 pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn("font-medium capitalize", meta.className)}>
                          {meta.label}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {row.actor_email || "unknown"}
                          {row.role ? ` · ${row.role}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{formatDateTime(row.ts)}</p>
                      {row.comment && <p className="mt-1 text-sm text-slate-600">{row.comment}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header --------------------------------------------------------- */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600">
                <MessageSquareQuote className="h-6 w-6 text-white" />
              </div>
              Q&amp;A Inbox
            </h1>
            <p className="mt-2 text-slate-600">
              Every clarification thread you take part in, across opportunities. Reply, mark the
              formal response, and close or reopen a thread — each action is permissioned and audit
              logged.
            </p>
          </div>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="px-4 py-3">
              <p className="text-xs text-slate-500">Awaiting response</p>
              <p className="text-2xl font-bold text-amber-600">{counts.awaiting}</p>
            </CardContent>
          </Card>
        </div>

        {myThreadsQuery.isError ? (
          errorPanel(
            myThreadsQuery.error,
            () => myThreadsQuery.refetch(),
            "Could not load your Q&A inbox."
          )
        ) : (
          <>
            {/* Filters ---------------------------------------------------- */}
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((option) => {
                const active = filter === option.key;
                return (
                  <Button
                    key={option.key}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    className={cn("gap-2", active && "bg-teal-600 hover:bg-teal-700")}
                    aria-pressed={active}
                    onClick={() => setFilter(option.key)}
                  >
                    {t(option.labelKey)}
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-xs",
                        active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {counts[option.key]}
                    </span>
                  </Button>
                );
              })}
            </div>

            {/* Two-pane layout -------------------------------------------- */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              {/* Thread list ---------------------------------------------- */}
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="text-base">{t("qa.title")}</CardTitle>
                  <CardDescription>
                    {visibleThreads.length} thread{visibleThreads.length === 1 ? "" : "s"} in this view
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 p-3">
                  {myThreadsQuery.isLoading ? (
                    <div className="flex items-center gap-2 p-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading your inbox...
                    </div>
                  ) : threads.length === 0 ? (
                    emptyState(
                      MessageSquareQuote,
                      "No clarification threads",
                      "Threads you raise or are invited to, across every opportunity, will appear here."
                    )
                  ) : visibleThreads.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500">
                      No threads match this filter.
                    </p>
                  ) : (
                    visibleThreads.map((item) => threadCard(item))
                  )}
                </CardContent>
              </Card>

              {/* Thread detail -------------------------------------------- */}
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-4 sm:p-6">{renderDetail()}</CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={closeDialogOpen}
        onOpenChange={(open) => {
          setCloseDialogOpen(open);
          if (!open) setCloseComment("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close thread</DialogTitle>
            <DialogDescription>
              Closing marks this clarification as settled. Add an optional comment for the audit
              trail. The thread can be reopened later.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={closeComment}
            onChange={(event) => setCloseComment(event.target.value)}
            placeholder="Optional comment..."
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseDialogOpen(false)}
              disabled={closeMutation.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="gap-2 bg-teal-600 hover:bg-teal-700"
              onClick={requestClose}
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              {t("qa.closeThread")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
