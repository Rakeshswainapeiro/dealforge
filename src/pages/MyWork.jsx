/* eslint-disable react/prop-types */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { AlarmClock, ClipboardList, Inbox, Loader2, MessagesSquare, UserCheck } from "lucide-react";

// ---------------------------------------------------------------------------
// My Work (BRD v2 EXP-02 / WF-03): one personal queue - the opportunities owned
// by or routed to me, other moves I can make, the questions waiting on me, my
// subsidiary's drafts and information requests, and what is about to breach
// its SLA. Each row opens the Opportunity 360 screen.
// ---------------------------------------------------------------------------

function slaText(card) {
  if (!card.sla_due_at) return null;
  const ms = new Date(card.sla_due_at).getTime() - Date.now();
  const hours = Math.round(Math.abs(ms) / 3600000);
  const span = hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
  return ms < 0 ? `SLA breached ${span} ago` : `SLA due in ${span}`;
}

function OppRow({ card }) {
  const sla = slaText(card);
  return (
    <a
      href={createPageUrl("Opportunity") + "?id=" + card.id}
      className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-3 hover:border-teal-300 hover:bg-teal-50/40"
      data-testid={"mywork-opp-" + card.id}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900">{card.opportunity_name}</span>
        <span className="block truncate text-xs text-slate-500">
          {[card.sector, card.total_commitment_aed != null ? `AED ${card.total_commitment_aed} mn` : null, card.owner_email].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Badge variant="outline">{card.state_label}</Badge>
      {card.open_questions > 0 && <Badge variant="outline">{card.open_questions} Q</Badge>}
      {sla && (
        <Badge variant="outline" className={cn(card.sla_breached ? "bg-red-100 text-red-800 border-red-200" : "bg-white text-slate-600")}>{sla}</Badge>
      )}
    </a>
  );
}

function Block({ icon: Icon, title, description, items, empty, render, testid }) {
  return (
    <Card className="border-slate-200 shadow-sm" data-testid={testid}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-teal-600" /> {title}
          <Badge variant="outline" className="ml-1">{items.length}</Badge>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : items.map(render)}
      </CardContent>
    </Card>
  );
}

export default function MyWork() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["pipeline", "my-work"], queryFn: () => api.pipeline.myWork(), refetchInterval: 60000 });
  const data = query.data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600">
              <Inbox className="h-6 w-6 text-white" />
            </div>
            My Work
          </h1>
          <p className="mt-2 text-slate-600">
            Everything waiting on {user?.full_name || "you"}: owned and routed opportunities, questions to answer and SLA timers.
          </p>
        </div>

        {query.isLoading ? (
          <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your queue...</p>
        ) : query.isError ? (
          <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-800">{query.error?.message || "Could not load your queue."}</CardContent></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="mywork-counts">
              {[
                ["Assigned to me", data.counts.assigned],
                ["I can act on", data.counts.can_act],
                ["Questions for me", data.counts.questions],
                ["Subsidiary to-dos", data.counts.subsidiary],
                ["SLA due / breached", data.counts.due_soon],
              ].map(([label, value]) => (
                <Card key={label}><CardContent className="pt-5">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-2xl font-bold text-slate-900">{value}</p>
                </CardContent></Card>
              ))}
            </div>

            {data.due_soon.length > 0 && (
              <Block icon={AlarmClock} title="SLA due within a day or breached" items={data.due_soon} empty=""
                render={(c) => <OppRow key={"due-" + c.id} card={c} />} testid="mywork-due" />
            )}
            <Block icon={MessagesSquare} title="Questions waiting on me"
              description="Answer the ones you own; close the ones you asked once they are answered."
              items={data.questions} empty="No questions are waiting on you." testid="mywork-questions"
              render={(t) => (
                <a key={t.id} href={createPageUrl("QandA") + "?thread=" + t.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-3 hover:border-teal-300">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{t.subject}</span>
                    <span className="block truncate text-xs text-slate-500">{t.opportunity_name}</span>
                  </span>
                  {t.kind === "information_request" && <Badge variant="outline">information request</Badge>}
                  <Badge variant="outline">{t.display_status === "answered" ? "answered - close it" : "to answer"}</Badge>
                  {t.due_at && <Badge variant="outline" className={cn(t.overdue && "bg-red-100 text-red-800 border-red-200")}>due {new Date(t.due_at).toLocaleDateString()}</Badge>}
                </a>
              )} />
            <Block icon={UserCheck} title="Owned by or routed to me" description="Opportunities with Sirius where you are the owner or a reviewer."
              items={data.assigned} empty="Nothing is assigned to you." render={(c) => <OppRow key={"a-" + c.id} card={c} />} testid="mywork-assigned" />
            <Block icon={ClipboardList} title="Other opportunities I can act on" items={data.can_act}
              empty="No other opportunities need your action." render={(c) => <OppRow key={"o-" + c.id} card={c} />} testid="mywork-can-act" />
            {(data.subsidiary.length > 0 || !data.assigned.length) && (
              <Block icon={ClipboardList} title="My subsidiary's drafts and information requests" items={data.subsidiary}
                empty="No drafts or information requests." render={(c) => <OppRow key={"s-" + c.id} card={c} />} testid="mywork-subsidiary" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
