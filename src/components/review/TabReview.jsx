/* eslint-disable react/prop-types */
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The consolidated AI overview across all seven tabs (shown on the Scorecard tab).
// It is the Sirius Investment Team's: the server refuses these endpoints to a
// Preparer, and no Preparer screen renders them.

// The overall assessment is scored from the AI analysis ratings (server: aiAnalysisScore.js).
const RATING_TONE = {
  Strong: "bg-emerald-50 text-emerald-700",
  Adequate: "bg-amber-50 text-amber-700",
  Weak: "bg-red-50 text-red-700",
  Incomplete: "bg-slate-100 text-slate-600",
};

// Why a tab is not in the score. Never a number for these.
const SCORE_STATE = {
  scored: { label: "", hint: "" },
  not_run: { label: "Not run", hint: "The AI analysis has not run on this tab yet." },
  failed: { label: "Did not run", hint: "The AI analysis did not complete (provider unavailable or busy)." },
  not_configured: { label: "AI not configured", hint: "No AI backend is configured." },
  insufficient_evidence: { label: "Insufficient evidence", hint: "Rated Not enough evidence, so it is not scored." },
  stale: { label: "Out of date", hint: "The inputs changed after this analysis ran; re-run it to score this tab." },
};

function AssessmentHeadline({ assessment }) {
  if (!assessment) return null;
  const incomplete = assessment.score == null;
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1" data-testid="review-assessment">
      <p className="leading-none">
        {incomplete ? (
          <span className="text-2xl font-medium text-slate-300" data-testid="review-assessment-score">N/A</span>
        ) : (
          <span className="text-3xl font-bold tabular-nums text-slate-900" data-testid="review-assessment-score">{assessment.score.toFixed(2)}</span>
        )}
        <span className="text-sm text-slate-500">/{assessment.max}</span>
      </p>
      <span className={cn("rounded-full px-3 py-0.5 text-xs font-semibold", RATING_TONE[assessment.rating] || RATING_TONE.Incomplete)} data-testid="review-assessment-rating">
        {assessment.rating}
      </span>
      <span className="text-xs text-slate-500" data-testid="review-assessment-coverage">
        Based on AI analysis · scored {assessment.scored_tabs} of {assessment.total_tabs} tabs · {assessment.coverage_weight}% of weight
      </span>
      {incomplete && assessment.incomplete_reason && (
        <p className="w-full text-xs text-slate-500" data-testid="review-assessment-incomplete">{assessment.incomplete_reason}</p>
      )}
    </div>
  );
}

function Card({ title, action, children, testid }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={testid}>
      <header className="mb-3 flex items-center gap-3">
        <h3 className="flex-1 text-[15px] font-semibold text-slate-900">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

// --- consolidated overview ---------------------------------------------

export function OverviewCard({ overview, running, onRunAll, runningAll, activeKey, onSelectTab }) {
  const c = overview?.counts;
  const anyRun = overview && overview.tabs.some((t) => t.validation_ran || t.analysis_ran);
  return (
    <Card
      title="Overall AI assessment"
      testid="review-overview"
      action={(
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" disabled={running || runningAll} onClick={onRunAll} data-testid="review-run-all">
          {running || runningAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {anyRun ? "Re-run all tabs" : "Run all tabs"}
        </Button>
      )}
    >
      {!overview ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : (
        <div className="space-y-3">
          {running && (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800" data-testid="review-running">
              The AI review is running across the tabs. Results appear here as each one finishes.
            </p>
          )}
          <AssessmentHeadline assessment={overview.analysis_assessment} />
          {c.ai_not_configured > 0 && c.failed_runs === 0 && (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700" data-testid="review-ai-not-configured">
              No AI backend is configured, so only the rule-based checks ran and no tab has an AI analysis to score.
            </p>
          )}
          {c.failed_runs > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="review-failed-runs">
              {c.failed_runs} tab{c.failed_runs === 1 ? "" : "s"} did not complete the AI step (provider unavailable or busy). Use Re-run all tabs to retry.
            </p>
          )}
          <div>
            <div className="hidden grid-cols-[minmax(0,1fr)_52px_150px_44px_60px] gap-2 border-b border-slate-100 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 lg:grid">
              <span>Tab</span><span className="text-right">Weight</span><span>AI analysis</span><span className="text-right">Score</span><span className="text-right">Weighted</span>
            </div>
            <ul className="divide-y divide-slate-100" data-testid="review-overview-tabs">
              {overview.tabs.map((t) => {
                const state = SCORE_STATE[t.analysis_score_state] || SCORE_STATE.not_run;
                const scored = t.analysis_score_state === "scored";
                return (
                  <li key={t.tab}>
                    <button type="button" onClick={() => onSelectTab?.(t.tab)}
                      className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 py-2 text-left text-xs hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_52px_150px_44px_60px]", activeKey === t.tab && "font-semibold")}
                      data-testid={`review-overview-${t.tab}`}>
                      <span className="min-w-0 truncate text-slate-800">
                        {t.label}
                        {t.clarifications > 0 && <span className="ml-1.5 font-normal text-slate-500">· {t.clarifications} asked</span>}
                        <span className="block font-normal text-slate-400 lg:hidden">
                          Weight {t.analysis_weight}%{scored ? ` · ${t.analysis_score}/5 · weighted ${t.analysis_weighted.toFixed(2)}` : ""}
                        </span>
                      </span>
                      <span className="hidden text-right text-slate-500 lg:block">{t.analysis_weight}%</span>
                      <span className="flex min-w-0 items-center gap-1.5 justify-self-end lg:justify-self-start" data-testid={`review-overview-rating-${t.tab}`}>
                        {t.analysis_rating && (
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5", scored ? RATING_TONE[t.analysis_rating] : "bg-slate-100 text-slate-500", t.analysis_score_state === "stale" && "line-through decoration-slate-400")}
                            title={scored ? undefined : state.hint}>
                            {t.analysis_rating}{t.analysis_overridden ? " *" : ""}
                          </span>
                        )}
                        {!scored && !(t.analysis_rating && t.analysis_score_state === "insufficient_evidence") && (
                          <span className="whitespace-nowrap text-slate-400" title={state.hint}>{state.label}</span>
                        )}
                      </span>
                      <span className="hidden text-right tabular-nums text-slate-800 lg:block" data-testid={`review-overview-score-${t.tab}`}>{scored ? `${t.analysis_score}/5` : "–"}</span>
                      <span className="hidden text-right tabular-nums text-slate-500 lg:block">{scored ? t.analysis_weighted.toFixed(2) : "–"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-[11px] text-slate-400">
            Overall score = weighted average of the AI analysis ratings (Strong 5 · Adequate 3 · Weak 1) over the tabs with a current rating; the AI validation status does not feed it.
            {" "}* reviewer override applied. AI output is advisory; the decision is the reviewer&apos;s.
          </p>
        </div>
      )}
    </Card>
  );
}
