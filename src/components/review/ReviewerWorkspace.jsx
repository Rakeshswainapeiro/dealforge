/* eslint-disable react/prop-types */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { createPageUrl } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { REVIEW_ACTION_TABS, REVIEW_TABS } from "./reviewModel";
import ReviewSections from "./ReviewSections";
import ScorecardPanel from "./ScorecardPanel";
import DecisionPanel from "./DecisionPanel";
import AuditTrailPanel from "./AuditTrailPanel";
import { RecommendationCard, SectionQACard, ValidationCard } from "./ReviewerRail";
import AIAnalysisCard from "@/components/ai/AIAnalysisCard";
import { OverviewCard } from "./TabReview";

// The read-only Reviewer Workspace (/opportunity?id=...) for the Sirius
// investment team. It shows a submitted opportunity exactly as the subsidiary
// submitted it - no inputs, no Save - with the AI validation, the draft
// recommendation and section-scoped Q&A beside it. The server remains the
// authority: a Sirius user cannot change a submitted opportunity.
//
// The seven section tabs are read-only. Scorecard, Decision and Audit trail are
// the reviewer's own work and reuse the Screening Board's endpoints and rules.

function TabBar({ active, onSelect }) {
  const base = "whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors";
  return (
    <div role="tablist" aria-label="Opportunity sections" className="flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto border-b border-slate-200 [contain:inline-size]" data-testid="review-tabs">
      {REVIEW_TABS.map((tab) => (
        <button key={tab.key} type="button" role="tab" aria-selected={active === tab.key} data-testid={`review-tab-${tab.key}`}
          onClick={() => onSelect(tab.key)}
          className={cn(base, active === tab.key ? "border-blue-600 font-semibold text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {tab.label}
        </button>
      ))}
      <span className="mx-2 h-5 w-px bg-slate-200" aria-hidden="true" />
      {REVIEW_ACTION_TABS.map((tab) => (
        <button key={tab.key} type="button" role="tab" aria-selected={active === tab.key} data-testid={`review-tab-${tab.key}`}
          onClick={() => onSelect(tab.key)}
          className={cn(base, active === tab.key ? "border-blue-600 font-semibold text-blue-700" : "border-transparent font-medium text-slate-700 hover:text-slate-900")}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function ReviewerWorkspace({ card, record }) {
  const id = card.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState(REVIEW_TABS[0].key);
  const sectionTab = REVIEW_TABS.find((t) => t.key === activeKey) || null;
  // Which rail cards are open. Kept here so a choice survives switching tabs.
  const [sections, setSections] = useState({ validation: true, analysis: false });
  const toggleSection = (key) => () => setSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const fieldsQuery = useQuery({ queryKey: ["review", "fields"], queryFn: () => api.gate.fields(), staleTime: 5 * 60 * 1000 });
  const gateQuery = useQuery({ queryKey: ["review", "gate", id], queryFn: () => api.gate.status(id) });
  const documentsQuery = useQuery({ queryKey: ["review", "documents", id], queryFn: () => api.gate.documents(id) });
  // While the automatic run is still going, keep polling so each tab appears as it finishes.
  const aiQuery = useQuery({
    queryKey: ["review", "ai", id], queryFn: () => api.aiReview.results(id),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });
  // Read-only. The evidence pipeline itself is run by the server (on submission, and by
  // "Re-run all tabs"); the workspace only asks whether the evidence is out of date, to say
  // so on the AI draft recommendation. Polls while a run is going.
  const evidenceQuery = useQuery({
    queryKey: ["review", "evidence", id], queryFn: () => api.aiReview.evidence(id), retry: false,
    enabled: activeKey === "decision",
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });
  const evidenceStale = Boolean(evidenceQuery.data?.comparison?.stale || evidenceQuery.data?.financials?.stale);
  const recommendationQuery = useQuery({ queryKey: ["review", "recommendation", id], queryFn: () => api.aiReview.recommendation(id), retry: false });

  const rerun = useMutation({
    mutationFn: (tab) => api.aiReview.validate(id, tab, "manual"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["review", "ai", id] }),
    onError: (error) => toast({ variant: "destructive", title: "AI validation did not run", description: error?.message }),
  });

  const analyse = useMutation({
    mutationFn: (tab) => api.aiReview.analyse(id, tab),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["review", "ai", id] }),
    onError: (error) => toast({ variant: "destructive", title: "AI analysis did not run", description: error?.message }),
  });
  const runAll = useMutation({
    mutationFn: () => api.aiReview.runAll(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", "ai", id] });
      // The run also refreshes the evidence behind the draft recommendation.
      queryClient.invalidateQueries({ queryKey: ["review", "evidence", id] });
      queryClient.invalidateQueries({ queryKey: ["review", "recommendation", id] });
    },
    onError: (error) => toast({ variant: "destructive", title: "The AI review did not start", description: error?.message }),
  });
  const groups = fieldsQuery.data?.sections || [];
  const gate = gateQuery.data?.gate || null;
  const documents = Array.isArray(documentsQuery.data) ? documentsQuery.data : [];
  const loading = fieldsQuery.isLoading || gateQuery.isLoading;

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-hidden bg-slate-50 p-6" data-testid="reviewer-workspace">
      <div className="mx-auto w-full min-w-0 max-w-[1400px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <a href={createPageUrl("MyWork")} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <ArrowLeft className="h-4 w-4" /> My Work
            </a>
            <h1 className="text-2xl font-bold text-slate-900" data-testid="opp-title">{card.opportunity_name}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {[card.sector, card.geography].filter(Boolean).join(" · ")}
              {card.total_commitment_aed != null && ` · AED ${card.total_commitment_aed} mn`}
              {card.owner_email && ` · prepared by ${card.owner_email}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-sm" data-testid="opp-state">{card.state_label}</Badge>
            {card.sla_days != null && card.is_open && (
              <Badge variant="outline" className={cn("gap-1", card.sla_breached ? "border-red-200 bg-red-100 text-red-800" : "")}>
                <Clock className="h-3 w-3" /> {card.age_days}d / {card.sla_days}d SLA
              </Badge>
            )}
            <Badge variant="outline" className="border-slate-300 bg-white text-slate-600" data-testid="review-readonly-badge">Read-only</Badge>
            <Button asChild variant="outline" size="sm"><a href={createPageUrl("ScreeningBoard") + "?id=" + card.id}>Open on the board</a></Button>
          </div>
        </div>

        <TabBar active={activeKey} onSelect={setActiveKey} />

        <div className={cn("grid items-start gap-6", sectionTab ? "lg:grid-cols-[minmax(0,1fr)_420px]" : "grid-cols-1")}>
          <div className="min-w-0">
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the submission...</div>
            ) : sectionTab ? (
              <ReviewSections tab={sectionTab} groups={groups} record={record} gate={gate} documents={documents} />
            ) : (
              activeKey === "scorecard" ? (
                <div className="space-y-5">
                  <div className="max-w-3xl">
                    <OverviewCard
                      overview={aiQuery.data?.overview || null}
                      running={Boolean(aiQuery.data?.running)}
                      runningAll={runAll.isPending}
                      onRunAll={() => runAll.mutate()}
                      activeKey={activeKey}
                      onSelectTab={setActiveKey}
                    />
                  </div>
                  <ScorecardPanel card={card} overview={aiQuery.data?.overview || null} onSelectTab={setActiveKey} />
                </div>
              ) : activeKey === "decision" ? (
                <div className="space-y-5">
                  <div className="max-w-3xl">
                    <RecommendationCard
                      recommendation={recommendationQuery.data?.recommendation || null}
                      loading={recommendationQuery.isLoading}
                      error={recommendationQuery.isError ? (recommendationQuery.error?.message || "The recommendation could not be loaded.") : null}
                      evidenceStale={evidenceStale}
                    />
                  </div>
                  <DecisionPanel card={card} />
                </div>
              ) : <AuditTrailPanel card={card} />
            )}
          </div>

          {sectionTab && (
          <aside className="min-w-0 space-y-4" data-testid="review-ai-aside">
            <ValidationCard
              tabLabel={sectionTab.label}
              result={aiQuery.data?.results?.[sectionTab.key]?.validation || null}
              effective={aiQuery.data?.overview?.tabs?.find((t) => t.tab === sectionTab.key) && {
                overridden: aiQuery.data.overview.tabs.find((t) => t.tab === sectionTab.key).validation_overridden,
                status: aiQuery.data.overview.tabs.find((t) => t.tab === sectionTab.key).validation_status,
                ai_status: aiQuery.data.overview.tabs.find((t) => t.tab === sectionTab.key).validation_ai_status,
              }}
              loading={aiQuery.isLoading}
              running={rerun.isPending && rerun.variables === sectionTab.key}
              onRerun={() => rerun.mutate(sectionTab.key)}
              open={sections.validation}
              onToggle={toggleSection("validation")}
            />
            <AIAnalysisCard
              tabLabel={sectionTab.label}
              hasRecord
              result={aiQuery.data?.results?.[sectionTab.key]?.analysis || null}
              loading={aiQuery.isLoading}
              running={analyse.isPending && analyse.variables === sectionTab.key}
              runError={analyse.data?.run_error && analyse.variables === sectionTab.key ? analyse.data.run_error : null}
              onRun={() => analyse.mutate(sectionTab.key)}
              open={sections.analysis}
              onToggle={toggleSection("analysis")}
            />
            <SectionQACard opportunityId={id} section={sectionTab.key} sectionLabel={sectionTab.label} />
          </aside>
          )}
        </div>
      </div>
    </div>
  );
}
