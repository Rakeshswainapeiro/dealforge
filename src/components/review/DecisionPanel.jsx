/* eslint-disable react/prop-types */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { formatWhen } from "./reviewModel";
import { Card } from "./ReviewSections";

// The Screening decision inside the Reviewer Workspace. The actions are the ones
// the server already offers this user for this opportunity (card.available_actions,
// computed with role, ownership, Delegation of Authority and the related-party
// overlay), and they are taken through the same transition endpoint and rules as
// the Screening Board. Nothing about who may decide is decided here.

const labelOf = (state) => String(state || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function needsOf(action) {
  const requires = action?.requires || [];
  return { reason: Boolean(action?.reason_class), question: requires.includes("question"), comment: Boolean(action?.reason_class) || requires.includes("comment") };
}

export default function DecisionPanel({ card }) {
  const id = card.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null);
  const [comment, setComment] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState("");

  const transitionsQuery = useQuery({ queryKey: ["pipeline", "transitions", id], queryFn: () => api.pipeline.transitions(id) });
  const reasonsQuery = useQuery({ queryKey: ["decision-reasons"], queryFn: () => api.gate.decisionReasons(), staleTime: 5 * 60 * 1000 });
  const screeningQuery = useQuery({ queryKey: ["pipeline", "screening", id], queryFn: () => api.pipeline.screening(id) });

  const actions = Array.isArray(card.available_actions) ? card.available_actions : [];
  const history = Array.isArray(transitionsQuery.data) ? transitionsQuery.data : [];
  const needs = needsOf(pending);
  const reasonOptions = (pending?.reason_class && reasonsQuery.data?.options?.[pending.reason_class]) || [];
  const incomplete = (needs.reason && !reasonCode) || (needs.comment && !comment.trim()) || (needs.question && (!subject.trim() || !comment.trim()));
  const screeningRecommendation = screeningQuery.data?.screening?.summary?.recommended || null;

  const close = () => { setPending(null); setComment(""); setReasonCode(""); setSubject(""); setDue(""); };

  const move = useMutation({
    mutationFn: ({ state, note, code, text, question }) => api.pipeline.transition(id, state, { comment: note, reasonCode: code, reasonText: text, question }),
    onSuccess: (result) => {
      for (const key of [["pipeline", "board"], ["pipeline", "awaiting-my-review"], ["pipeline", "my-opportunities"], ["pipeline", "rollup"],
        ["pipeline", "transitions", id], ["pipeline", "card", id], ["pipeline", "screening", id], ["review", "timeline", id], ["qa"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      close();
      toast({ title: "State updated", description: `${labelOf(result?.from_state)} → ${labelOf(result?.state)}` });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "card", id] });
      toast({ variant: "destructive", title: "Could not move this opportunity", description: error?.message || "The state change was rejected." });
    },
  });

  const confirm = () => {
    if (!pending || incomplete) return;
    const note = comment.trim();
    move.mutate({
      state: pending.to,
      note: needs.question ? undefined : note || undefined,
      code: needs.reason ? reasonCode : undefined,
      text: needs.reason ? note || undefined : undefined,
      question: needs.question ? { subject: subject.trim(), body: note, due_at: due || undefined } : undefined,
    });
  };

  return (
    <Card title="Sirius investment decision" testid="review-action-decision">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span>Current stage:</span>
        <Badge variant="outline">{card.state_label}</Badge>
        {screeningRecommendation && <span className="text-xs text-slate-500">Screening panel: {{ pass: "recommended to proceed", review: "review the flags", stop: "blocking checks open" }[screeningRecommendation] || String(screeningRecommendation).replace(/_/g, " ")}</span>}
      </div>

      {card.related_party_overlay?.status_label && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="rp-overlay-panel">
          <strong>Related-party overlay - {card.related_party_overlay.status_label}.</strong> This flagged deal cannot take the Screening Decision until an independent, non-conflicted sign-off is recorded on the opportunity route.
        </p>
      )}

      {actions.length === 0 ? (
        <p className="text-sm text-slate-500">
          {card.is_final ? `${card.state_label} is a final outcome; no further moves.`
            : card.next_actor === "subsidiary" ? "Waiting on the subsidiary."
              : `No actions for you on ${card.state_label}.`}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const tone = action.action === "decline" || action.action === "withdraw" ? "border-red-200 text-red-700 hover:bg-red-50"
                : action.action === "proceed" ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50" : "";
              return (
                <Button key={action.action + action.to} variant="outline" size="sm" className={cn("gap-2", tone)}
                  disabled={move.isPending || !action.allowed} title={action.allowed ? undefined : action.blocked_reason || undefined}
                  data-testid={`action-${action.action}`} onClick={() => { close(); setPending(action); }}>
                  {action.label}
                </Button>
              );
            })}
          </div>
          {actions.filter((a) => !a.allowed && a.blocked_reason).slice(0, 1).map((a) => (
            <p key="blocked" className="text-xs text-slate-500" data-testid="action-blocked-reason">{a.blocked_reason}</p>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Decision history</h3>
        {transitionsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading history...</div>
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-500">No transitions recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {history.map((item) => (
              <li key={item.id} className="border-l-2 border-slate-200 pl-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <Badge variant="outline">{labelOf(item.from_state)}</Badge><ArrowRight className="h-3 w-3 text-slate-400" /><Badge variant="outline">{labelOf(item.to_state)}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{item.actor_email || "unknown"} · {formatWhen(item.created_at)}</p>
                {item.reason_code && <p className="text-xs text-slate-500">Reason code: {item.reason_code}</p>}
                {item.comment && <p className="mt-1 text-sm text-slate-600">{item.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.label || ""}</DialogTitle>
            <DialogDescription>
              {needs.question ? "The question opens a tracked thread with the subsidiary. The opportunity unlocks for edits until they respond."
                : needs.reason ? "A reason code and comment are required. Both are recorded on the audit trail and shown to the owner."
                  : needs.comment ? "Add a comment explaining why the review resumes." : "Add an optional comment for the audit trail."}
            </DialogDescription>
          </DialogHeader>
          {needs.question && (
            <div className="space-y-3">
              <div className="space-y-1"><Label htmlFor="rw-question-subject">Subject</Label>
                <Input id="rw-question-subject" data-testid="question-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Funding split and lender terms" /></div>
              <div className="space-y-1"><Label htmlFor="rw-question-due">Response due (optional)</Label>
                <Input id="rw-question-due" type="date" data-testid="question-due" value={due} onChange={(e) => setDue(e.target.value)} />
                <p className="text-xs text-slate-500">Defaults to the Information Requested SLA when left blank.</p></div>
            </div>
          )}
          {needs.reason && (
            <div className="space-y-2">
              <Label>Reason code</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger data-testid="transition-reason-code"><SelectValue placeholder="Choose a reason code..." /></SelectTrigger>
                <SelectContent>{reasonOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              {reasonCode && <p className="text-xs text-slate-500">{reasonOptions.find((o) => o.id === reasonCode)?.description}</p>}
            </div>
          )}
          <Textarea data-testid="transition-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={needs.question ? "The question for the subsidiary..." : needs.reason ? "Add detail for this decision..." : needs.comment ? "Why the review resumes..." : "Optional note..."} />
          {incomplete && (
            <p className="text-xs text-red-600">
              {needs.reason && !reasonCode ? "Choose a reason code." : needs.question && !subject.trim() ? "Add a subject for the question." : needs.question ? "Write the question." : "A comment is required."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={move.isPending}>Cancel</Button>
            <Button className="gap-2 bg-teal-600 hover:bg-teal-700" onClick={confirm} disabled={move.isPending || incomplete} data-testid="transition-confirm">
              {move.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {pending?.label || "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
