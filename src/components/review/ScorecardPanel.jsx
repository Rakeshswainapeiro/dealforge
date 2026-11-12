/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Card } from "./ReviewSections";
import { userRoles } from "@/lib/reviewerWorkspace";

// The Gate 2 weighted scorecard inside the Reviewer Workspace. It reads the same
// screening payload and writes through the same endpoints as the Screening Board
// (api.gate.scoreScorecard / overrideScorecard), so the criteria, weights, pass
// bar, lens floors and the CIO override rule are the board's - none of it is
// re-implemented here. The server decides who may write.

const OUTCOME_TONE = {
  proceed: "border-emerald-200 bg-white text-emerald-700",
  override_required: "border-red-200 bg-white text-red-700",
  proceed_override: "border-amber-200 bg-white text-amber-700",
};

function outcomeLabel(sc) {
  if (sc.outcome === "proceed") return "Proceed";
  if (sc.outcome === "proceed_override") return "Proceed (CIO override)";
  if (sc.outcome === "override_required") return sc.below_lens_floor ? "Lens below floor - override required" : "Below bar - override required";
  return "Not scored";
}

const round2 = (n) => Math.round(n * 100) / 100;

const RATING_CHIP = {
  Strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Adequate: "border-amber-200 bg-amber-50 text-amber-700",
  Weak: "border-red-200 bg-red-50 text-red-700",
};

// The tabs whose AI analysis informs a criterion (server: SCORECARD_ANALYSIS_LINKS),
// with each tab's current analysis rating. Context only: it never changes a score.
function linkedAnalysis(item, overview) {
  const keys = overview?.analysis_assessment?.scorecard_links?.[item.key] || [];
  return keys.map((k) => overview.tabs.find((t) => t.tab === k)).filter(Boolean);
}

function whyText(item, linked) {
  const p = item.proposed_score;
  const refs = (item.proposed_refs || []).map((r) => r.label).filter(Boolean);
  const parts = [refs.length ? refs.join("; ") + "." : "Not captured on the record yet, so the proposal is neutral."];
  // The scoring-guide line only when the proposal rests on data; a neutral 3 for
  // missing data must not read as "meets threshold".
  const guide = item.guide?.[p] || item.guide?.[String(p)];
  if (guide && refs.length) parts.push(guide + ".");
  const rated = linked.filter((t) => t.analysis_rating);
  if (rated.length) {
    parts.push(rated.map((t) => `${t.label} is rated ${t.analysis_rating}${t.analysis_score_state === "stale" ? " (out of date)" : ""}`).join("; ") + " in the AI analysis.");
  }
  return parts.join(" ");
}

function SaveBanner({ state, canReview, reviewed, adjustedCount, need, error, onConfirm, confirming }) {
  if (!canReview) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="scorecard-save-state">
        {reviewed ? "Recorded by the reviewer." : "Not recorded yet."} You can read the scorecard; recording it is for the assigned reviewer.
      </p>
    );
  }
  if (state === "saving") {
    return <p className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800" data-testid="scorecard-save-state"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</p>;
  }
  if (state === "needs_reason") {
    return <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="scorecard-save-state"><span className="font-semibold">Not saved yet.</span> Give a reason (at least {need} characters) for each score you changed.</p>;
  }
  if (state === "error") {
    return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="scorecard-save-state"><span className="font-semibold">Could not save.</span> {error || "Try again."}</p>;
  }
  if (!reviewed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="scorecard-save-state">
        <span><span className="font-semibold">Not recorded yet.</span> Every final score is the proposed score. Change a score and it saves automatically, or confirm the proposals as they stand.</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirming} onClick={onConfirm} data-testid="scorecard-submit">Confirm proposed scores</Button>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="scorecard-save-state">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
      <span>
        <span className="font-semibold">Saved automatically.</span>{" "}
        {adjustedCount === 0
          ? "No changes yet: every final score is the proposed score. There is no separate Save button: the decision uses these scores."
          : `${adjustedCount} score${adjustedCount === 1 ? "" : "s"} changed from the proposal; both scores are kept on the record.`}
      </span>
    </p>
  );
}

export default function ScorecardPanel({ card, overview = null, onSelectTab }) {
  const id = card.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [comments, setComments] = useState({});
  const [openNotes, setOpenNotes] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [overrideBy, setOverrideBy] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const screeningQuery = useQuery({ queryKey: ["pipeline", "screening", id], queryFn: () => api.pipeline.screening(id) });
  const sc = screeningQuery.data?.screening?.scorecard || null;
  const canReview = Boolean(card.can_review);
  const isCio = userRoles(user).some((r) => r === "cio" || r === "admin");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["pipeline", "screening", id] });
    queryClient.invalidateQueries({ queryKey: ["review", "recommendation", id] });
    queryClient.invalidateQueries({ queryKey: ["review", "timeline", id] });
  };

  // The same endpoint as before (api.gate.scoreScorecard): every save records the full
  // set of final scores, and the server keeps both the proposal and the final score.
  const record = useMutation({
    mutationFn: (payload) => api.gate.scoreScorecard(id, payload),
    onSuccess: () => { setSaveError(null); refresh(); },
    onError: (error) => {
      setSaveError(error?.message || null);
      toast({ variant: "destructive", title: "Could not record the scorecard", description: error?.message });
    },
  });

  const override = useMutation({
    mutationFn: (payload) => api.gate.overrideScorecard(id, payload),
    onSuccess: (result) => {
      refresh(); setOverrideReason("");
      toast({ title: "CIO override memo recorded", description: result?.scorecard?.message || "The override is on the audit trail." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not record the override memo", description: error?.message }),
  });

  const items = sc?.items || [];
  const scoreFor = (item) => (scores[item.key] != null ? scores[item.key] : (item.has_review ? item.score : item.proposed_score));
  const noteFor = (item) => (notes[item.key] != null ? notes[item.key] : item.note || "");
  const commentFor = (item) => (comments[item.key] != null ? comments[item.key] : (item.comment || (item.comments && item.comments[item.key]) || ""));
  const adjusted = (item) => scoreFor(item) != null && scoreFor(item) !== item.proposed_score;
  const need = sc?.adjust_reason_min || 10;
  const commentOk = (item) => !adjusted(item) || commentFor(item).trim().length >= need;
  const allScored = items.length > 0 && items.every((i) => scoreFor(i) != null);
  const allCommented = items.every(commentOk);
  const total = allScored ? round2(items.reduce((t, i) => t + (scoreFor(i) * i.weight) / 100, 0)) : null;
  const adjustedCount = items.filter(adjusted).length;

  const payload = () => {
    const s = {}; const n = {}; const c = {};
    for (const item of items) {
      s[item.key] = scoreFor(item);
      n[item.key] = String(noteFor(item) || "").trim();
      if (adjusted(item)) c[item.key] = commentFor(item).trim();
    }
    return { scores: s, notes: n, comments: c };
  };

  // Auto-save: once the reviewer has changed something and every change carries its
  // reason, the full set is recorded after a short pause. No separate Save button.
  useEffect(() => {
    if (!canReview || !dirty || record.isPending || !allScored || !allCommented) return undefined;
    const timer = setTimeout(() => { setDirty(false); record.mutate(payload()); }, 900);
    return () => clearTimeout(timer);
  });

  if (screeningQuery.isLoading) {
    return <Card title="Scorecard" testid="review-action-scorecard"><div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the scorecard...</div></Card>;
  }
  if (!sc) {
    return <Card title="Scorecard" testid="review-action-scorecard"><p className="text-sm text-slate-600">{screeningQuery.isError ? (screeningQuery.error?.message || "The scorecard could not be loaded.") : "No scorecard is configured for this opportunity."}</p></Card>;
  }

  const change = (setter, key, value) => { setter((p) => ({ ...p, [key]: value })); setDirty(true); setSaveError(null); };
  const saveState = record.isPending ? "saving" : saveError ? "error" : (dirty && !allCommented) ? "needs_reason" : dirty ? "saving" : "idle";

  return (
    <Card testid="review-action-scorecard">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="scorecard-headline">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500">Scorecard:</p>
            <p className="leading-tight">
              <span className="text-3xl font-bold tabular-nums text-slate-900" data-testid="scorecard-total">{total != null ? total.toFixed(2) : "–"}</span>
              <span className="text-sm text-slate-500">/5</span>
              {!sc.reviewed && <span className="ml-2 text-xs text-slate-500">proposed, not recorded</span>}
            </p>
          </div>
          <Badge variant="outline" className={cn("font-medium", OUTCOME_TONE[sc.outcome] || "")} data-testid="scorecard-outcome">
            {outcomeLabel(sc)}{sc.total != null ? ` (${sc.total}/5)` : ""}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          DealForge proposes a score from 1 to 5 for each criterion from what the subsidiary submitted, shown with the AI analysis of the linked tabs. You accept it or change the final score; a change needs a reason, and both scores are kept.
        </p>
        <p className="mt-1 text-xs text-slate-500">Gate 2 weighted scorecard. Weights sum to {sc.weight_total}% · pass bar {sc.pass_threshold}.</p>
        {sc.message && <p className="mt-1 text-xs text-slate-500">{sc.message}</p>}
      </div>

      <SaveBanner state={saveState} canReview={canReview} reviewed={sc.reviewed} adjustedCount={adjustedCount} need={need}
        error={saveError} confirming={record.isPending} onConfirm={() => record.mutate(payload())} />

      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((item) => {
          const linked = linkedAnalysis(item, overview);
          const final = scoreFor(item);
          return (
            <div key={item.key} className="flex flex-col rounded-lg border border-slate-200 p-4" data-testid={`scorecard-row-${item.key}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-slate-900">{item.label}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Weight {item.weight}%{item.threshold ? ` · pass mark: ${item.threshold}` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <span className="text-[11px] text-slate-600">AI proposes</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-100 text-base font-semibold text-indigo-700" data-testid={`scorecard-proposed-${item.key}`}>{item.proposed_score}</span>
                </div>
              </div>
              <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid={`scorecard-why-${item.key}`}>
                <span className="font-semibold">Why {item.proposed_score}:</span> {whyText(item, linked)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid={`scorecard-analysis-${item.key}`}>
                <span className="text-xs font-medium text-slate-700">From the AI analysis</span>
                {linked.length === 0 ? (
                  <span className="text-xs text-slate-400">{overview ? "No linked tab" : "Loading..."}</span>
                ) : linked.map((t) => (
                  <button key={t.tab} type="button" onClick={() => onSelectTab?.(t.tab)}
                    title={t.analysis_rating ? `${t.label}: ${t.analysis_rating}${t.analysis_score_state === "stale" ? " (out of date)" : ""}` : `${t.label}: AI analysis not available`}
                    className={cn("rounded-full border px-2 py-0.5 text-[11px] hover:underline",
                      t.analysis_rating && t.analysis_score_state !== "stale" ? (RATING_CHIP[t.analysis_rating] || "border-slate-200 bg-slate-50 text-slate-600") : "border-slate-200 bg-white text-slate-500")}>
                    {t.label}{t.analysis_rating ? ` · ${t.analysis_rating}` : " · not run"}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-slate-800">Final score (you)</span>
                  {canReview ? (
                    <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm" value={final ?? ""}
                      data-testid={`scorecard-final-${item.key}`} aria-label={`Final score for ${item.label}`}
                      onChange={(e) => change(setScores, item.key, Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  ) : (
                    <span className="text-sm font-semibold text-slate-900">{item.has_review ? item.score : "–"}</span>
                  )}
                  <span className="text-slate-500">Weighted {final != null ? round2((final * item.weight) / 100) : "–"}</span>
                  {adjusted(item) && <Badge variant="outline" className="border-amber-200 bg-white text-amber-700">Changed from {item.proposed_score}</Badge>}
                </div>
                {canReview && adjusted(item) && (
                  <Input className="mt-2 h-8 text-xs" placeholder={`Reason for the change (at least ${need} characters)`}
                    value={commentFor(item)} onChange={(e) => change(setComments, item.key, e.target.value)} data-testid={`scorecard-reason-${item.key}`} />
                )}
                {canReview && (openNotes[item.key] || noteFor(item) ? (
                  <Input className="mt-2 h-8 text-xs" placeholder="Note (optional)" value={noteFor(item)} autoFocus={Boolean(openNotes[item.key]) && !noteFor(item)}
                    onChange={(e) => change(setNotes, item.key, e.target.value)} data-testid={`scorecard-note-${item.key}`} />
                ) : (
                  <button type="button" className="mt-2 text-xs text-slate-500 underline-offset-2 hover:underline"
                    onClick={() => setOpenNotes((p) => ({ ...p, [item.key]: true }))} data-testid={`scorecard-add-note-${item.key}`}>Add a note</button>
                ))}
                {!canReview && item.note && <p className="mt-1 text-xs text-slate-600">Note: {item.note}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {Array.isArray(sc.lenses) && sc.lenses.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-slate-200 p-3" data-testid="scorecard-lenses">
          <p className="text-xs font-medium text-slate-800">Two-lens floor - each sub-total must clear {sc.lens_floor}</p>
          {sc.lenses.map((lens) => (
            <div key={lens.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">{lens.label} <span className="ml-1 text-[10px] uppercase text-slate-400">({lens.criteria.length} criteria · weight {lens.weight}%)</span></span>
              <Badge variant="outline" className={cn("font-medium", lens.below_floor ? "border-red-200 text-red-700" : lens.complete ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-600")}>
                {lens.subtotal != null ? `${lens.subtotal}/5` : "not scored"}{lens.below_floor ? " - below floor" : ""}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {sc.outcome === "override_required" && canReview && (
        <div className="space-y-2 rounded-md border border-red-200 p-3" data-testid="scorecard-override">
          <p className="text-xs font-medium text-red-700">
            {sc.below_lens_floor ? "A lens sub-total is below the floor." : "The weighted total is below the pass bar."} A CIO override memo (a named CIO and a written reason) is required to proceed.
          </p>
          <Input className="text-xs" placeholder="Named CIO (email)" value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
          <Textarea rows={2} className="text-xs" placeholder="Override reason (at least 10 characters)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          <Button size="sm" variant="destructive" data-testid="scorecard-override-submit"
            disabled={override.isPending || !isCio || overrideReason.trim().length < 10 || !overrideBy.trim()}
            onClick={() => override.mutate({ by: overrideBy.trim(), reason: overrideReason.trim() })}>Record CIO override memo</Button>
          {!isCio && <p className="text-[11px] text-slate-500">Only a user with the CIO role can file the override memo.</p>}
        </div>
      )}

      {sc.outcome === "proceed_override" && sc.override && (
        <div className="rounded-md border border-amber-200 p-3 text-xs" data-testid="scorecard-override-record">
          <p className="font-medium text-amber-700">CIO override memo on file</p>
          <p className="text-slate-600">{sc.override.reason}</p>
          <p className="text-slate-500">Filed by {sc.override.by || "unknown"}{sc.override.at ? ` · ${new Date(sc.override.at).toLocaleString()}` : ""}</p>
        </div>
      )}
    </Card>
  );
}
