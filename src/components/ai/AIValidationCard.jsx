/* eslint-disable react/prop-types */
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// AI validation for one capture tab. Advisory only: it never blocks saving or
// submitting. The result comes from /api/ai-review; `stale` is set by the server
// once the tab's fields or documents have changed since the check ran.
const PILL = {
  pass: { label: "Pass", cls: "bg-emerald-50 text-emerald-700" },
  review: { label: "Review", cls: "bg-amber-50 text-amber-700" },
  fail: { label: "Fix", cls: "bg-red-50 text-red-700" },
};

const AI_NOTES = {
  not_configured: "No AI backend is configured, so only the rule-based checks ran.",
  not_approved: "The AI provider is not approved yet (Admin > AI governance), so only the rule-based checks ran.",
  unavailable: "The AI check could not run. The rule-based checks above are still current.",
  rate_limited: "The AI provider is busy (rate limit). Wait a few seconds and re-run.",
};

export function AIBadge() {
  return <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">AI</span>;
}

export default function AIValidationCard({ tabLabel, hasRecord, result, loading, running, onRun }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="ai-validation-card" aria-label={`AI validation, ${tabLabel}`}>
      <header className="flex items-center gap-3 px-5 pb-2 pt-4">
        <AIBadge />
        <h3 className="flex-1 text-[15px] font-semibold text-slate-900">AI validation</h3>
        {hasRecord && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2.5 text-xs"
            disabled={running}
            onClick={onRun}
            data-testid="ai-validation-run"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {result ? "Re-run" : "Run"}
          </Button>
        )}
      </header>

      {!hasRecord ? (
        <p className="px-5 pb-5 text-sm text-slate-500">Save the draft to run AI validation on this tab.</p>
      ) : loading && !result ? (
        <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : !result ? (
        <p className="px-5 pb-5 text-sm text-slate-500">
          {running ? "Checking this tab..." : `Not checked yet. It runs when you Save and Continue, or press Run.`}
        </p>
      ) : (
        <>
          {result.stale && (
            <p className="mx-5 mb-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="ai-validation-stale">
              This tab changed since the check ran. Re-run to refresh.
            </p>
          )}
          <ul className={cn("transition-opacity", (result.stale || running) && "opacity-60")}>
            {result.checks.map((c) => {
              const pill = PILL[c.status] || PILL.review;
              return (
                <li key={c.key} className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3 last:border-b-0" data-testid={`ai-check-${c.key}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{c.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{c.detail}</p>
                  </div>
                  <span className={cn("mt-0.5 shrink-0 rounded-full px-3 py-0.5 text-xs font-medium", pill.cls)}>{pill.label}</span>
                </li>
              );
            })}
          </ul>
          {AI_NOTES[result.ai_status] && (
            <p className="px-5 pb-2 pt-1 text-xs text-slate-500">{AI_NOTES[result.ai_status]}</p>
          )}
          <p className="px-5 pb-4 pt-2 text-[11px] leading-snug text-slate-400" data-testid="ai-disclaimer">
            {result.disclaimer} {result.advisory}
          </p>
        </>
      )}
    </section>
  );
}
