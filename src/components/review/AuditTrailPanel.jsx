/* eslint-disable react/prop-types */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { REVIEW_TABS, formatWhen } from "./reviewModel";
import { Card } from "./ReviewSections";

// The audit trail inside the Reviewer Workspace: the opportunity timeline the
// server already builds from the immutable audit log (who did what, when), with
// the reasons and named users for decisions and CIO overrides. Internal-note
// events are filtered out on the server for anyone not entitled to see them.

const DECISION_ACTIONS = new Set(["transition", "transition_auto", "hard_filter_confirmed", "hard_filter_overridden", "soft_filter_confirmed", "soft_filter_adjusted", "disqualifier_cleared", "owner_assigned", "owner_reassigned", "ai_review_accept", "ai_review_override", "ai_review_clarify"]);
// The server stores these as plain action names; say what they were in words.
const AI_DECISION_LABEL = {
  ai_review_accept: "AI finding accepted",
  ai_review_override: "AI finding overridden",
  ai_review_clarify: "Preparer asked about an AI finding",
};
const SCORE_ACTIONS = new Set(["scorecard_scored", "scorecard_override"]);
// Earlier decisions on AI findings, read from the stored records. Nothing here
// records a new one.
const AI_DECISION_WORD = { accept: "Accepted", override: "Overrode", clarify: "Asked the Preparer about" };
const FILTERS = [
  { key: "all", label: "All activity", test: () => true },
  { key: "decisions", label: "Decisions", test: (e) => DECISION_ACTIONS.has(e.action) },
  { key: "scoring", label: "Scorecard and overrides", test: (e) => SCORE_ACTIONS.has(e.action) },
];

export default function AuditTrailPanel({ card }) {
  const id = card.id;
  const [filter, setFilter] = useState("all");
  const query = useQuery({ queryKey: ["review", "timeline", id], queryFn: () => api.pipeline.timeline(id) });
  const aiDecisionsQuery = useQuery({ queryKey: ["review", "history", id, "all"], queryFn: () => api.aiReview.reviewHistory(id) });
  const aiDecisions = Array.isArray(aiDecisionsQuery.data?.decisions) ? [...aiDecisionsQuery.data.decisions].reverse() : [];
  const tabLabel = (key) => REVIEW_TABS.find((t) => t.key === key)?.label || key;
  const events = Array.isArray(query.data?.events) ? query.data.events : [];
  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const shown = events.filter(active.test);

  return (
    <div className="space-y-5">
    <Card title="Audit trail" testid="review-action-audit">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the audit trail">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} data-testid={`audit-filter-${f.key}`}
            className={cn("rounded-full border px-3 py-1 text-xs", filter === f.key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {f.label} ({events.filter(f.test).length})
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the audit trail...</div>
      ) : query.isError ? (
        <p className="text-sm text-red-600">{query.error?.message || "The audit trail could not be loaded."}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded under this filter yet.</p>
      ) : (
        <ol className="space-y-3" data-testid="audit-list">
          {shown.map((e, i) => (
            <li key={`${e.ts}-${e.action}-${i}`} className="border-l-2 border-slate-200 pl-3" data-testid="audit-event">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{AI_DECISION_LABEL[e.action] || e.label}</span>
                {e.from && e.to && <Badge variant="outline" className="text-xs">{String(e.from).replace(/_/g, " ")} → {String(e.to).replace(/_/g, " ")}</Badge>}
                {SCORE_ACTIONS.has(e.action) && e.action === "scorecard_override" && <Badge variant="outline" className="border-amber-200 text-amber-700">CIO override</Badge>}
              </div>
              <p className="text-xs text-slate-500">{e.actor_email || "system"}{e.role ? ` (${String(e.role).replace(/_/g, " ")})` : ""} · {formatWhen(e.ts)}</p>
              {e.detail && <p className="mt-1 text-sm text-slate-700">{e.detail}</p>}
              {e.comment && <p className="mt-1 text-sm text-slate-600">{e.comment}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
    <Card title="Decisions on AI findings" testid="review-ai-decisions">
      <p className="text-xs text-slate-500">A read-only record of earlier decisions on AI validation and analysis findings. No new decisions are recorded from this workspace.</p>
      {aiDecisionsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : aiDecisionsQuery.isError ? (
        <p className="text-sm text-red-600">{aiDecisionsQuery.error?.message || "The decisions could not be loaded."}</p>
      ) : aiDecisions.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="ai-decisions-none">No decisions were recorded on AI findings.</p>
      ) : (
        <ol className="space-y-3" data-testid="ai-decisions-list">
          {aiDecisions.map((d) => (
            <li key={d.id} className="border-l-2 border-slate-200 pl-3" data-testid="ai-decision-record">
              <p className="text-sm text-slate-900">
                <span className="font-medium">{AI_DECISION_WORD[d.action] || d.action}</span>{" "}
                {d.finding_key === "__tab__" ? `the ${d.kind} result` : `${d.kind} finding “${String(d.finding_key).replace(/_/g, " ")}”`} on {tabLabel(d.tab)}
                {d.from_status || d.to_status ? <span className="text-slate-500"> (AI: {d.from_status || "—"}{d.to_status ? ` → ${d.to_status}` : ""})</span> : null}
              </p>
              <p className="text-xs text-slate-500">{d.by} · {formatWhen(d.at)}</p>
              {(d.reason || d.question) && <p className="mt-1 text-sm text-slate-600">{d.reason || d.question}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
    </div>
  );
}