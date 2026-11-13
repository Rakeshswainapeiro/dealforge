/* eslint-disable react/prop-types */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { formatWhen } from '@/components/review/reviewModel';
import { RecommendationEvidence } from '@/components/review/EvidencePanel';

const labelOf = (state) => String(state || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function needsOf(action) {
  const requires = action?.requires || [];
  return {
    reason: Boolean(action?.reason_class),
    question: requires.includes('question'),
    comment: Boolean(action?.reason_class) || requires.includes('comment'),
  };
}

const RATING_STYLE = {
  proceed: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  conditional: 'border-amber-200 bg-amber-100 text-amber-800',
  stop: 'border-red-200 bg-red-100 text-red-800',
};

const RULE_ICON = {
  pass: <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />,
  fail: <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />,
};

export default function SiriusDecisionTab({ card }) {
  const id = card.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialog state for Sirius Investment Decision
  const [pending, setPending] = useState(null);
  const [comment, setComment] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');

  // Queries for Left Column (AI Recommendation)
  const recommendationQuery = useQuery({
    queryKey: ['review', 'recommendation', id],
    queryFn: () => api.aiReview.recommendation(id),
    retry: false,
  });

  const evidenceQuery = useQuery({
    queryKey: ['review', 'evidence', id],
    queryFn: () => api.aiReview.evidence(id),
    retry: false,
  });

  // Queries for Right Column (Sirius Investment Decision)
  const transitionsQuery = useQuery({
    queryKey: ['pipeline', 'transitions', id],
    queryFn: () => api.pipeline.transitions(id),
  });

  const reasonsQuery = useQuery({
    queryKey: ['decision-reasons'],
    queryFn: () => api.gate.decisionReasons(),
    staleTime: 5 * 60 * 1000,
  });

  const screeningQuery = useQuery({
    queryKey: ['pipeline', 'screening', id],
    queryFn: () => api.pipeline.screening(id),
  });

  const r = recommendationQuery.data?.recommendation || null;
  const evidenceStale = Boolean(evidenceQuery.data?.comparison?.stale || evidenceQuery.data?.financials?.stale);

  const actions = Array.isArray(card.available_actions) ? card.available_actions : [];
  const history = Array.isArray(transitionsQuery.data) ? transitionsQuery.data : [];
  const needs = needsOf(pending);
  const reasonOptions = (pending?.reason_class && reasonsQuery.data?.options?.[pending.reason_class]) || [];
  const incomplete =
    (needs.reason && !reasonCode) ||
    (needs.comment && !comment.trim()) ||
    (needs.question && (!subject.trim() || !comment.trim()));

  const screeningRecommendation = screeningQuery.data?.screening?.summary?.recommended || null;
  const screeningRecText =
    {
      pass: 'recommended to proceed',
      review: 'review the flags',
      stop: 'blocking checks open',
    }[screeningRecommendation] || (screeningRecommendation ? String(screeningRecommendation).replace(/_/g, ' ') : '');

  const closeDialog = () => {
    setPending(null);
    setComment('');
    setReasonCode('');
    setSubject('');
    setDue('');
  };

  const move = useMutation({
    mutationFn: ({ state, note, code, text, question }) =>
      api.pipeline.transition(id, state, {
        comment: note,
        reasonCode: code,
        reasonText: text,
        question,
      }),
    onSuccess: (result) => {
      for (const key of [
        ['pipeline', 'board'],
        ['pipeline', 'awaiting-my-review'],
        ['pipeline', 'my-opportunities'],
        ['pipeline', 'rollup'],
        ['pipeline', 'transitions', id],
        ['pipeline', 'card', id],
        ['pipeline', 'screening', id],
        ['review', 'timeline', id],
        ['qa'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      closeDialog();
      toast({
        title: 'State updated',
        description: `${labelOf(result?.from_state)} \u2192 ${labelOf(result?.state)}`,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'card', id] });
      toast({
        variant: 'destructive',
        title: 'Could not move this opportunity',
        description: error?.message || 'The state change was rejected.',
      });
    },
  });

  const confirmDecision = () => {
    if (!pending || incomplete) return;
    const note = comment.trim();
    move.mutate({
      state: pending.to,
      note: needs.question ? undefined : note || undefined,
      code: needs.reason ? reasonCode : undefined,
      text: needs.reason ? note || undefined : undefined,
      question: needs.question
        ? { subject: subject.trim(), body: note, due_at: due || undefined }
        : undefined,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* LEFT COLUMN: AI Draft Recommendation */}
      <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900 tracking-tight">AI draft recommendation</h2>

        {/* Note Banner */}
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 text-xs font-semibold text-[#1D4ED8] leading-relaxed">
          Drafted by rules from the submission and its evidence. It is not the Sirius investment decision, which is recorded in the decision panel to the right.
        </div>

        {evidenceStale && (
          <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded-lg p-3 text-xs font-medium text-[#92400E] leading-relaxed">
            <span className="font-semibold">Evidence is out of date.</span> The submission changed after the evidence behind this draft was gathered, so the draft may not reflect the current submission.
          </div>
        )}

        {recommendationQuery.isLoading && !r ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Loading AI recommendation...
          </div>
        ) : recommendationQuery.isError ? (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {recommendationQuery.error?.message || 'The recommendation could not be loaded.'}
          </p>
        ) : r ? (
          <div className="space-y-4">
            {/* Rating Card */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/40">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">AI recommendation</span>
                <span
                  className={cn(
                    'rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide',
                    RATING_STYLE[r.rating] || 'border-slate-200 bg-slate-100 text-slate-700'
                  )}
                >
                  {r.rating}
                </span>
              </div>
              <p className="text-xs text-slate-800 leading-relaxed font-normal">{r.summary}</p>
              <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {r.rules.map((rule) => (
                  <li key={rule.key} className="flex items-start gap-2 text-xs text-slate-700 leading-snug">
                    {RULE_ICON[rule.status] || <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    <span>
                      <span className="font-medium text-slate-900">{rule.label}</span>
                      {rule.detail ? ` \u2014 ${rule.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Conditions to Proceed */}
            {r.conditions && r.conditions.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-2">
                <p className="text-xs font-bold text-slate-900">Conditions to proceed</p>
                <ul className="space-y-1.5 pt-1">
                  {r.conditions.map((c) => (
                    <li key={c.key} className="text-xs text-slate-700 leading-relaxed">
                      {c.text} <span className="font-semibold text-slate-900">Owner: {c.owner}.</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Evidence Behind Draft */}
            <RecommendationEvidence recommendation={r} />

            {/* Advisory Footer */}
            <p className="text-[11px] leading-snug text-slate-400 pt-1">
              {r.label}. {r.advisory}
            </p>
          </div>
        ) : null}
      </div>

      {/* RIGHT COLUMN: Sirius Investment Decision */}
      <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900 tracking-tight">Sirius investment decision</h2>

        {/* Current Stage Meta */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Current stage:</span>
          <Badge variant="outline" className="text-xs font-semibold bg-slate-50 border-slate-200 text-slate-800">
            {card.state_label}
          </Badge>
          {screeningRecommendation && (
            <span className="text-xs text-slate-500">
              Screening panel: {screeningRecText}
            </span>
          )}
        </div>

        {/* Related-Party Overlay Banner */}
        {card.related_party_overlay?.status_label && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
            <strong>Related-party overlay &mdash; {card.related_party_overlay.status_label}.</strong> This flagged deal cannot take the Screening Decision until an independent, non-conflicted sign-off is recorded on the opportunity route.
          </div>
        )}

        {/* Action Buttons */}
        {actions.length === 0 ? (
          <p className="text-xs text-slate-500 py-1">
            {card.is_final
              ? `${card.state_label} is a final outcome; no further moves.`
              : card.next_actor === 'subsidiary'
              ? 'Waiting on the subsidiary.'
              : `No actions for you on ${card.state_label}.`}
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => {
                const tone =
                  action.action === 'decline' || action.action === 'withdraw'
                    ? 'border-red-200 text-red-700 hover:bg-red-50'
                    : action.action === 'proceed'
                    ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                    : 'border-slate-300 text-slate-800 hover:bg-slate-50';
                return (
                  <Button
                    key={action.action + action.to}
                    variant="outline"
                    size="sm"
                    className={cn('gap-2 text-xs font-semibold px-3 py-1.5 h-auto', tone)}
                    disabled={move.isPending || !action.allowed}
                    title={action.allowed ? undefined : action.blocked_reason || undefined}
                    data-testid={`action-${action.action}`}
                    onClick={() => {
                      closeDialog();
                      setPending(action);
                    }}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </div>
            {actions
              .filter((a) => !a.allowed && a.blocked_reason)
              .slice(0, 1)
              .map((a) => (
                <p key="blocked" className="text-xs text-slate-500" data-testid="action-blocked-reason">
                  {a.blocked_reason}
                </p>
              ))}
          </div>
        )}

        {/* Decision History */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-900">Decision history</h3>
          {transitionsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Loading history...
            </div>
          ) : history.length === 0 ? (
            <p className="text-xs text-slate-500 py-1">No transitions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {history.map((item) => (
                <li key={item.id} className="border-l-2 border-slate-200 pl-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="text-[11px] font-normal border-slate-200 bg-slate-50/70 text-slate-700">
                      {labelOf(item.from_state)}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-slate-400" />
                    <Badge variant="outline" className="text-[11px] font-normal border-slate-200 bg-slate-50/70 text-slate-700">
                      {labelOf(item.to_state)}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {item.actor_email || 'unknown'} · {formatWhen(item.created_at)}
                  </p>
                  {item.reason_code && (
                    <p className="text-[11px] text-slate-500">Reason code: {item.reason_code}</p>
                  )}
                  {item.comment && (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded p-2.5 mt-1 leading-relaxed">
                      {item.comment}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Transition Confirmation Dialog */}
        <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) closeDialog(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">
                {pending?.label || ''}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 leading-relaxed">
                {needs.question
                  ? 'The question opens a tracked thread with the subsidiary. The opportunity unlocks for edits until they respond.'
                  : needs.reason
                  ? 'A reason code and comment are required. Both are recorded on the audit trail and shown to the owner.'
                  : needs.comment
                  ? 'Add a comment explaining why the review resumes.'
                  : 'Add an optional comment for the audit trail.'}
              </DialogDescription>
            </DialogHeader>

            {needs.question && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="sirius-question-subject" className="text-xs font-semibold text-slate-700">
                    Subject
                  </Label>
                  <Input
                    id="sirius-question-subject"
                    data-testid="question-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Funding split and lender terms"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sirius-question-due" className="text-xs font-semibold text-slate-700">
                    Response due (optional)
                  </Label>
                  <Input
                    id="sirius-question-due"
                    type="date"
                    data-testid="question-due"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="text-xs"
                  />
                  <p className="text-[11px] text-slate-500">
                    Defaults to the Information Requested SLA when left blank.
                  </p>
                </div>
              </div>
            )}

            {needs.reason && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">Reason code</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger data-testid="transition-reason-code" className="text-xs">
                    <SelectValue placeholder="Choose a reason code..." />
                  </SelectTrigger>
                  <SelectContent>
                    {reasonOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reasonCode && (
                  <p className="text-[11px] text-slate-500">
                    {reasonOptions.find((o) => o.id === reasonCode)?.description}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">
                {needs.question ? 'Question details' : 'Comments & notes'}
              </Label>
              <Textarea
                data-testid="transition-comment"
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  needs.question
                    ? 'The question for the subsidiary...'
                    : needs.reason
                    ? 'Add detail for this decision...'
                    : needs.comment
                    ? 'Why the review resumes...'
                    : 'Optional note...'
                }
                className="text-xs leading-relaxed"
              />
            </div>

            {incomplete && (
              <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
                {needs.reason && !reasonCode
                  ? 'Choose a reason code.'
                  : needs.question && !subject.trim()
                  ? 'Add a subject for the question.'
                  : needs.question
                  ? 'Write the question.'
                  : 'A comment is required.'}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={closeDialog} disabled={move.isPending} className="text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                onClick={confirmDecision}
                disabled={move.isPending || incomplete}
                data-testid="transition-confirm"
              >
                {move.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {pending?.label || 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
