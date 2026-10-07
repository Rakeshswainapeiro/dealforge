/* eslint-disable react/prop-types */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";

// The Sirius investment team (mirrors REVIEWER_ROLES on the server).
const TEAM_ROLES = ["admin", "sirius_deal_lead", "sirius_vertical_head", "cio", "leadership", "cluster_head"];
import OwnerPanel from "@/components/pipeline/OwnerPanel";
import QuestionsPanel from "@/components/pipeline/QuestionsPanel";
import { EvidencePanel, LaunchpadPanel } from "@/components/pipeline/EvidencePanel";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Database, ExternalLink, FileText, History, Layers, Loader2, ShieldAlert, XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Opportunity 360 (BRD v2 EXP-01). One screen with everything known about an
// opportunity - the submission, the screening checks with their evidence, the
// scores, the flags, the questions, the documents and every decision - each
// with its source. Deep-linkable: /opportunity?id=<id>. Read-only: actions are
// taken on the Screening Board, Submit Opportunity and Q&A screens.
// ---------------------------------------------------------------------------

const RESULT = {
  pass: { label: "Pass", className: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: CheckCircle2 },
  flag: { label: "Flag", className: "bg-amber-100 text-amber-800 border-amber-200", Icon: AlertTriangle },
  fail: { label: "Fail", className: "bg-red-100 text-red-800 border-red-200", Icon: XCircle },
  not_applicable: { label: "Pending", className: "bg-slate-100 text-slate-600 border-slate-200", Icon: Clock },
};

const SUBMISSION_FIELDS = [
  ["opportunity_type", "Type"], ["target_name", "Target"], ["sector", "Sector"], ["geography", "Geography"],
  ["total_commitment_aed", "Total commitment (AED mn)"], ["ask_aed", "Ask (AED mn)"], ["funding_source", "Funding source"],
  ["target_signing_close", "Target signing / close"], ["sourcing_channel", "Sourcing channel"],
  ["narrative_what", "What"], ["narrative_why_now", "Why now"], ["narrative_why_us", "Why us"], ["decision_sought", "Decision sought"],
];

function when(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Section({ icon: Icon, title, description, children, testid }) {
  return (
    <Card className="border-slate-200 shadow-sm" data-testid={testid}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">{Icon && <Icon className="h-4 w-4 text-teal-600" />}{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function Opportunity() {
  const { user } = useAuth();
  const isTeam = (user?.roles || (user?.role ? [user.role] : [])).some((r) => TEAM_ROLES.includes(r));
  const id = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("id"); } catch { return null; }
  }, []);

  const cardQuery = useQuery({ queryKey: ["pipeline", "card", id], queryFn: () => api.pipeline.card(id), enabled: Boolean(id), retry: false });
  const recordQuery = useQuery({ queryKey: ["entity", "DealOpportunity", id], queryFn: () => api.entities.DealOpportunity.get(id), enabled: Boolean(id) && cardQuery.isSuccess });
  const screeningQuery = useQuery({ queryKey: ["pipeline", "screening", id], queryFn: () => api.pipeline.screening(id), enabled: cardQuery.isSuccess });
  const documentsQuery = useQuery({ queryKey: ["gate", "documents", id], queryFn: () => api.gate.documents(id), enabled: cardQuery.isSuccess });
  const timelineQuery = useQuery({ queryKey: ["pipeline", "timeline", id], queryFn: () => api.pipeline.timeline(id), enabled: cardQuery.isSuccess });

  if (!id) {
    return <div className="p-6 text-slate-600">No opportunity selected. Open one from My Work, the Screening Board or Q&amp;A.</div>;
  }
  if (cardQuery.isLoading) {
    return <div className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the opportunity...</div>;
  }
  if (cardQuery.isError) {
    return (
      <div className="p-6">
        <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-800">
          {cardQuery.error?.status === 403 ? "You do not have access to this opportunity." : cardQuery.error?.status === 404 ? "This opportunity does not exist." : (cardQuery.error?.message || "Could not load the opportunity.")}
        </CardContent></Card>
      </div>
    );
  }

  const card = cardQuery.data;
  const record = recordQuery.data || {};
  const screening = screeningQuery.data?.screening;
  const documents = (Array.isArray(documentsQuery.data) ? documentsQuery.data : []).filter((d) => d.is_current);
  const events = timelineQuery.data?.events || [];
  const sc = screening?.scorecard;
  const flags = screening?.disqualifiers?.open_flags || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <a href={createPageUrl("MyWork")} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <ArrowLeft className="h-4 w-4" /> My Work
            </a>
            <h1 className="text-3xl font-bold text-slate-900" data-testid="opp-title">{card.opportunity_name}</h1>
            <p className="mt-1 text-slate-600">
              {[card.sector, card.geography].filter(Boolean).join(" · ")}
              {card.total_commitment_aed != null && ` · AED ${card.total_commitment_aed} mn`}
              {card.owner_email && ` · prepared by ${card.owner_email}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-sm" data-testid="opp-state">{card.state_label}</Badge>
            {card.sla_days != null && card.is_open && (
              <Badge variant="outline" className={cn("gap-1", card.sla_breached ? "bg-red-100 text-red-800 border-red-200" : "")}>
                <Clock className="h-3 w-3" /> {card.age_days}d / {card.sla_days}d SLA
              </Badge>
            )}
            {card.decision_reason_label && <Badge variant="outline">{card.decision_reason_label}</Badge>}
            <Button asChild variant="outline" size="sm"><a href={createPageUrl("ScreeningBoard") + "?id=" + card.id}>Open on the board</a></Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Section icon={FileText} title="Submission" description="What the subsidiary submitted." testid="opp-submission">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {SUBMISSION_FIELDS.filter(([k]) => record[k] !== undefined && record[k] !== null && record[k] !== "").map(([k, label]) => (
                  <div key={k} className={cn(String(record[k]).length > 60 && "sm:col-span-2")}>
                    <dt className="text-xs text-slate-500">{label}</dt>
                    <dd className="whitespace-pre-wrap text-sm text-slate-900">{String(record[k])}</dd>
                  </div>
                ))}
              </dl>
              {record.decision_reason_text && (
                <p className="rounded-md bg-slate-50 p-2 text-sm text-slate-700"><span className="font-medium">Decision note:</span> {record.decision_reason_text}</p>
              )}
            </Section>

            <Section icon={Layers} title="Screening and evidence" description={screening?.message || "The initial screen, each check with its rationale and source."} testid="opp-screening">
              {screeningQuery.isLoading && <p className="text-sm text-slate-500">Running the screen...</p>}
              {(screening?.checks || []).map((check) => {
                const meta = RESULT[check.result] || RESULT.not_applicable;
                return (
                  <div key={check.key} className="rounded-md border border-slate-200 p-3" data-testid={"opp-check-" + check.key}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{check.label}</p>
                      <Badge variant="outline" className={cn("gap-1", meta.className)}><meta.Icon className="h-3 w-3" />{meta.label}</Badge>
                    </div>
                    {check.rationale && <p className="mt-1 text-sm text-slate-600">{check.rationale}</p>}
                    {Array.isArray(check.evidence_refs) && check.evidence_refs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {check.evidence_refs.slice(0, 8).map((ref, i) => (
                          <Badge key={i} variant="outline" className="font-normal text-xs" title={ref.source || ref.type}>
                            {ref.label || ref.type}{ref.source ? ` · ${ref.source}` : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>

            {isTeam && (
              <Section icon={Database} title="External evidence" description="Values from connected tools and desk research, each with source, time, method and confidence." testid="opp-evidence">
                <EvidencePanel opportunityId={card.id} />
              </Section>
            )}

            <Section icon={History} title="Timeline" description="Every change, decision and upload, with who and when." testid="opp-timeline">
              {events.length === 0 ? <p className="text-sm text-slate-500">No events yet.</p> : (
                <ul className="space-y-2">
                  {events.slice(0, 60).map((e, i) => (
                    <li key={i} className="border-l-2 border-slate-200 pl-3 text-sm">
                      <span className="font-medium text-slate-900">{e.label}</span>
                      {e.from && e.to && <span className="text-slate-500"> · {e.from.replace(/_/g, " ")} → {e.to.replace(/_/g, " ")}</span>}
                      <span className="block text-xs text-slate-500">{e.actor_email || "system"} · {when(e.ts)}</span>
                      {e.comment && <span className="block text-xs text-slate-600">{e.comment}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="space-y-6">
            <Card className="border-slate-200 shadow-sm"><CardContent className="pt-0">
              <OwnerPanel card={card} />
              <QuestionsPanel card={card} />
            </CardContent></Card>

            <Section icon={ShieldAlert} title="Scores and flags" testid="opp-scores">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Scorecard</p>
                  <p className="font-semibold">{sc?.total != null ? `${sc.total} / 5` : "Not scored"}</p>
                  {sc?.outcome && <p className="text-xs text-slate-500">{sc.outcome.replace(/_/g, " ")}</p>}</div>
                <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Soft filters</p>
                  <p className="font-semibold">{screening?.soft_filters?.average != null ? `${screening.soft_filters.average} / 5` : "—"}</p>
                  {screening?.soft_filters?.outcome && <p className="text-xs text-slate-500">{screening.soft_filters.outcome}</p>}</div>
                <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Quality score</p>
                  <p className="font-semibold">{screening?.quality_score?.score != null ? `${screening.quality_score.score}%` : "—"}</p></div>
                <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">Related party</p>
                  <p className="font-semibold">{card.related_party_overlay ? card.related_party_overlay.status_label : "Not flagged"}</p></div>
              </div>
              {flags.length > 0 ? (
                <ul className="space-y-1">{flags.map((f) => (
                  <li key={f.key} className="flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="h-3.5 w-3.5" />{f.label}</li>
                ))}</ul>
              ) : <p className="text-xs text-slate-500">No open disqualifier flags.</p>}
            </Section>

            {isTeam && (
              <Section icon={ExternalLink} title="Tools" description="Open a licensed tool with this opportunity in context." testid="opp-tools">
                <LaunchpadPanel opportunityId={card.id} />
              </Section>
            )}

            <Section icon={FileText} title="Documents" description="Current versions; earlier versions are kept." testid="opp-documents">
              {documents.length === 0 ? <p className="text-sm text-slate-500">No documents uploaded.</p> : (
                <ul className="space-y-1">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                      <a className="truncate text-teal-700 hover:underline" href={d.file_url} title={d.original_name}>{d.original_name}</a>
                      <span className="shrink-0 text-xs text-slate-500">
                        {String(d.requirement_key).startsWith("qa_attachment:") ? "Q&A" : d.requirement_key.replace(/_/g, " ")} · v{d.version}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {card.dataroom_folder?.url && (
                <a className="text-sm text-teal-700 hover:underline" href={card.dataroom_folder.url} target="_blank" rel="noopener noreferrer">
                  Data-room folder{card.dataroom_folder.label ? `: ${card.dataroom_folder.label}` : ""}
                </a>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
