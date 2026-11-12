/* eslint-disable react/prop-types */
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import RailSection, { StaleChip } from "@/components/review/RailSection";

// AI analysis ("AI research") for one capture tab. It reads only that tab, its
// documents and the Sirius strategy library; sources shown are the ones the
// server accepted. Advisory only.
const RATING = {
  Strong: "bg-emerald-50 text-emerald-700",
  Adequate: "bg-amber-50 text-amber-700",
  Weak: "bg-red-50 text-red-700",
  "Not enough evidence": "bg-slate-100 text-slate-600",
};
const LEVEL = { High: "bg-emerald-50 text-emerald-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-amber-50 text-amber-700" };

const NOTES = {
  not_configured: "No AI backend is configured, so research cannot run.",
  not_approved: "The AI provider is not approved yet (Admin > AI governance).",
  unavailable: "The AI research could not run. Try again shortly.",
  rate_limited: "The AI provider is busy (rate limit). Wait a few seconds and re-run.",
};

function Pill({ text, cls }) {
  return <span className={cn("shrink-0 rounded-full px-3 py-0.5 text-xs font-medium", cls)}>{text}</span>;
}

function Item({ item, index }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3" data-testid={`ai-analysis-item-${index}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{index + 1}. {item.title}</p>
        <Pill text={item.rating} cls={RATING[item.rating] || RATING["Not enough evidence"]} />
      </div>
      {item.summary && <p className="mt-1.5 text-xs text-slate-600">{item.summary}</p>}
      {item.why && (
        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-slate-700">
          <span className="font-semibold">Why {item.rating}:</span> {item.why}
        </p>
      )}
      {item.missing.length > 0 && (
        <p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Missing:</span> {item.missing.join(" · ")}</p>
      )}
      {item.ask_subsidiary.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-700"><span className="font-semibold">Ask the subsidiary:</span> {item.ask_subsidiary.join(" · ")}</p>
      )}
      {(item.found.length > 0 || item.would_change) && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs font-medium text-indigo-600">More: what the AI found, what would change the rating</summary>
          <div className="mt-2 space-y-1.5">
            {item.found.map((f, i) => (
              <div key={i} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
                <p className="font-semibold text-slate-800">{f.label}</p>
                <p className="text-slate-600">{f.detail}</p>
              </div>
            ))}
            {item.would_change && (
              <p className="text-xs text-slate-700"><span className="font-semibold">What would change the rating:</span> {item.would_change}</p>
            )}
          </div>
        </details>
      )}
      {item.sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.sources.map((s) => <span key={s} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">{s}</span>)}
        </div>
      )}
    </div>
  );
}

export default function AIAnalysisCard({ tabLabel, hasRecord, result, loading, running, onRun, runError, open = false, onToggle = () => {} }) {
  const a = result?.analysis;
  const n = a?.items?.length || 0;
  const summary = a ? `${a.recommendation.rating} · ${n} finding${n === 1 ? "" : "s"}` : (running ? "Researching..." : "Not run yet");
  return (
    <RailSection
      title="AI analysis"
      badge
      testid="ai-analysis-card"
      open={open}
      onToggle={onToggle}
      summary={summary}
      chips={result?.stale ? <StaleChip label="Out of date" /> : null}
      action={hasRecord ? (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" disabled={running} onClick={onRun} data-testid="ai-analysis-run">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {result ? "Re-run" : "Research this tab"}
        </Button>
      ) : null}
    >
      {!hasRecord ? (
        <p className="text-sm text-slate-500">Save the draft to research this tab.</p>
      ) : loading && !result ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : !a ? (
        <p className="text-sm text-slate-500">
          {running ? "Researching this tab..."
            : NOTES[result?.ai_status] || `Not run yet. Research reads only the ${tabLabel.toLowerCase()} tab, its documents and the Sirius strategy library.`}
        </p>
      ) : (
        <div className={cn("space-y-3", (result.stale || running) && "opacity-60")}>
          {runError && !running && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="ai-analysis-run-error">
              The latest re-run failed ({NOTES[runError] || "the AI could not run"}) so the earlier result is kept.
            </p>
          )}
          {result.stale && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="ai-analysis-stale">
              This tab changed since the research ran. Re-run to refresh.
            </p>
          )}
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>AI recommendation</span>
              <Pill text={a.recommendation.rating} cls={RATING[a.recommendation.rating] || RATING["Not enough evidence"]} />
            </div>
            <p className="mt-1.5 text-sm text-slate-800">{a.recommendation.summary}</p>
          </div>
          {a.key_figures.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {a.key_figures.map((k) => (
                <li key={k.label} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-700">{k.label}{k.note && <span className="block text-xs text-slate-500">{k.note}</span>}</span>
                  <span className="font-semibold text-slate-900">{k.value}</span>
                </li>
              ))}
            </ul>
          )}
          {a.items.map((item, i) => <Item key={i} item={item} index={i} />)}
          {a.data_gaps?.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700" data-testid="ai-analysis-gaps">
              <span className="font-semibold">Not filled in on this tab:</span> {a.data_gaps.join(" · ")}
            </div>
          )}
          {a.low_confidence.length > 0 && (
            <div className="border-t border-slate-200 pt-3">
              <p className="mb-1 text-sm font-semibold text-slate-900">Low-confidence points</p>
              <ul className="divide-y divide-slate-100">
                {a.low_confidence.map((l) => (
                  <li key={l.label} className="flex items-start justify-between gap-3 py-2">
                    <span className="text-sm text-slate-800">{l.label}<span className="block text-xs text-slate-500">{l.note}</span></span>
                    <Pill text={l.level} cls={LEVEL[l.level] || LEVEL.Low} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="pt-1 text-[11px] leading-snug text-slate-400" data-testid="ai-analysis-disclaimer">{result.disclaimer} {result.advisory}</p>
        </div>
      )}
    </RailSection>
  );
}
