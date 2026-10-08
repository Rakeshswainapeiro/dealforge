/* eslint-disable react/prop-types */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { useTranslation } from "@/lib/i18n";
import { AlarmClock, ClipboardList, Inbox, Loader2, MessagesSquare, UserCheck } from "lucide-react";

// ---------------------------------------------------------------------------
// My Work (BRD v2 EXP-02 / WF-03): one personal queue - the opportunities owned
// by or routed to me, other moves I can make, the questions waiting on me, my
// subsidiary's drafts and information requests, and what is about to breach
// its SLA. Each row opens the Opportunity 360 screen.
// ---------------------------------------------------------------------------

function slaText(card,t) {
  if (!card.sla_due_at) return null;
  const ms = new Date(card.sla_due_at).getTime() - Date.now();
  const hours = Math.round(Math.abs(ms) / 3600000);
  const span = hours >= 48
    ? t("mywork.unit.days", { n: Math.round(hours / 24) })
    : t("mywork.unit.hours", { n: hours });
  return ms < 0 ? t("mywork.sla.breached", { span }) : t("mywork.sla.dueIn", { span });
}

function OppRow({ card }) {
  const { t } = useTranslation();
  const sla = slaText(card, t);
  return (
    <a
      href={createPageUrl("Opportunity") + "?id=" + card.id}
      className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-3 hover:border-teal-300 hover:bg-teal-50/40"
      data-testid={"mywork-opp-" + card.id}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900"><bdi>{card.opportunity_name}</bdi></span>
<span className="block truncate text-xs text-slate-500">
  {[card.sector, card.total_commitment_aed != null ? t("mywork.amount", { n: card.total_commitment_aed }) : null, card.owner_email]
    .filter(Boolean)
    .map((part, i) => <span key={i}>{i > 0 && " · "}<bdi>{part}</bdi></span>)}
</span>
      </span>
      <Badge variant="outline">{card.state_label}</Badge>
      {card.open_questions > 0 && <Badge variant="outline">{t("mywork.badge.questions", { n: card.open_questions })}</Badge>}
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
          <Badge variant="outline" className="ms-1">{items.length}</Badge>
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
const { t, lang } = useTranslation();
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
            {t("nav.myWork")}
</h1>
<p className="mt-2 text-slate-600">
  {user?.full_name
    ? t("mywork.subtitle", { name: user.full_name })
    : t("mywork.subtitleYou")}
</p>
        </div>

        {query.isLoading ? (
          <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("mywork.loading")}</p>
        ) : query.isError ? (
          <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-800">{query.error?.message || t("mywork.loadError")}</CardContent></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="mywork-counts">
              {[
                [t("mywork.count.assigned"), data.counts.assigned],
[t("mywork.count.canAct"), data.counts.can_act],
[t("mywork.count.questions"), data.counts.questions],
[t("mywork.count.subsidiary"), data.counts.subsidiary],
[t("mywork.count.dueSoon"), data.counts.due_soon],
              ].map(([label, value]) => (
                <Card key={label}><CardContent className="pt-5">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-2xl font-bold text-slate-900">{value}</p>
                </CardContent></Card>
              ))}
            </div>

            {data.due_soon.length > 0 && (
              <Block icon={AlarmClock} title={t("mywork.due.title")} items={data.due_soon} empty=""
                render={(c) => <OppRow key={"due-" + c.id} card={c} />} testid="mywork-due" />
            )}
            <Block icon={MessagesSquare} title={t("mywork.questions.title")}
              description={t("mywork.questions.desc")}
              items={data.questions} empty={t("mywork.questions.empty")} testid="mywork-questions"
              render={(q) => (
                <a key={q.id} href={createPageUrl("QandA") + "?thread=" + q.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-3 hover:border-teal-300">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900"><bdi>{q.subject}</bdi></span>
                    <span className="block truncate text-xs text-slate-500"><bdi>{q.opportunity_name}</bdi></span>
                  </span>
                  {q.kind === "information_request" && <Badge variant="outline">{t("mywork.badge.infoRequest")}</Badge>}
                  <Badge variant="outline">{q.display_status === "answered" ? t("mywork.badge.answered") : t("mywork.badge.toAnswer")}</Badge>
                  {q.due_at && <Badge variant="outline" className={cn(q.overdue && "bg-red-100 text-red-800 border-red-200")}>{t("mywork.badge.due", { date: new Date(q.due_at).toLocaleDateString(lang) })}</Badge>}
                </a>
              )} />
            <Block icon={UserCheck} title={t("mywork.assigned.title")} description={t("mywork.assigned.desc")}
              items={data.assigned} empty={t("mywork.assigned.empty")} render={(c) => <OppRow key={"a-" + c.id} card={c} />} testid="mywork-assigned" />
            <Block icon={ClipboardList} title={t("mywork.canAct.title")} items={data.can_act}
              empty={t("mywork.canAct.empty")} render={(c) => <OppRow key={"o-" + c.id} card={c} />} testid="mywork-can-act" />
            {(data.subsidiary.length > 0 || !data.assigned.length) && (
              <Block icon={ClipboardList} title={t("mywork.subsidiary.title")} items={data.subsidiary}
                empty={t("mywork.subsidiary.empty")} render={(c) => <OppRow key={"s-" + c.id} card={c} />} testid="mywork-subsidiary" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
