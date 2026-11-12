/* eslint-disable react/prop-types */
import { RecommendationEvidence } from "./EvidencePanel";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Paperclip, RefreshCw, XCircle } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { formatWhen } from "./reviewModel";
import { describeCheck, groupChecks, summariseChecks } from "./validationModel";
import RailSection, { StaleChip } from "./RailSection";

// The right-hand column of the Reviewer Workspace: AI validation for the open
// tab, the draft recommendation for the whole opportunity and section-scoped
// Q&A. All of it is advisory; none of it edits the opportunity.

function AIBadge() {
  return <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">AI</span>;
}

function RailCard({ title, action, children, testid }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={testid}>
      <header className="mb-3 flex items-center gap-3">
        {testid !== "review-qa" && <AIBadge />}
        <h3 className="flex-1 text-[15px] font-semibold text-slate-900">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

const PILL = {
  pass: { label: "Passed", cls: "bg-emerald-50 text-emerald-700" },
  review: { label: "Needs review", cls: "bg-amber-50 text-amber-700" },
  fail: { label: "Failed", cls: "bg-red-50 text-red-700" },
};

// --- AI validation -------------------------------------------------------

export const AI_NOTES = {
  not_configured: "No AI backend is configured.",
  not_approved: "The AI provider is not approved yet (Admin > AI governance).",
  unavailable: "The AI provider could not be reached.",
  rate_limited: "The AI provider is busy (rate limit).",
};

// One icon per check carries its status; the group heading names it, so the row
// does not repeat it as a pill.
const CHECK_ICON = {
  fail: { Icon: XCircle, cls: "text-red-600", label: "Failed" },
  review: { Icon: AlertTriangle, cls: "text-amber-600", label: "Needs review" },
  pass: { Icon: CheckCircle2, cls: "text-emerald-600", label: "Passed" },
};

// One validation check: a plain headline and the reason. The technical title,
// the full stored note and the "Checked against" evidence are behind Details.
// Reviewer decisions are not made here; they live in the Reviewer decision card.
function CheckRow({ check }) {
  const [open, setOpen] = useState(false);
  const d = describeCheck(check);
  const { Icon, cls, label } = CHECK_ICON[check.status] || CHECK_ICON.review;
  const evidence = check.checked_against || [];
  const showNote = d.detail && d.detail !== d.reason;
  return (
    <li className="py-3 first:pt-0" data-testid={`review-check-${check.key}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cls)} aria-label={label} role="img" />
        <p className={cn("min-w-0 flex-1 text-sm leading-snug text-slate-900", !open && "line-clamp-3")}>
          <span className="font-semibold">{d.headline}</span>
          {d.reason && <span className="text-slate-600"> – {d.reason}</span>}
        </p>
        <button
          type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          aria-label={open ? `Hide details for ${d.headline}` : `Show details for ${d.headline}`}
          className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          data-testid={`review-check-toggle-${check.key}`}
        >
          Details {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <div className="ml-[26px] mt-2 space-y-2 rounded-md bg-slate-50 px-3 py-2.5 text-xs text-slate-600" data-testid={`review-check-details-${check.key}`}>
          {d.title && <p><span className="font-semibold text-slate-700">Check:</span> {d.title} ({d.source})</p>}
          {showNote && <p><span className="font-semibold text-slate-700">Full note:</span> {d.detail}</p>}
          {evidence.length > 0 && (
            <div className="space-y-0.5">
              <p className="font-semibold text-slate-800">Checked against</p>
              {evidence.map((row) => (
                <p key={row.label}><span className="font-semibold text-slate-700">{row.label}:</span> {row.value}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ValidationCard({ result, loading, running, onRerun, tabLabel, effective = null, open = true, onToggle = () => {} }) {
  const groups = groupChecks(result?.checks || []);
  const shownStatus = effective?.overridden ? effective.status : result?.status;
  const renderRows = (list) => list.map((c) => <CheckRow key={c.key} check={c} />);
  return (
    <RailSection
      title="AI validation"
      badge
      testid="review-validation"
      open={open}
      onToggle={onToggle}
      summary={result ? `${summariseChecks(groups)}${shownStatus ? ` · ${(PILL[shownStatus] || PILL.review).label}` : ""}` : "Not checked yet"}
      chips={result?.stale ? <StaleChip label="Out of date" /> : null}
      action={(
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" disabled={running} onClick={onRerun} data-testid="review-validation-rerun">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {result ? "Re-run" : "Run"}
        </Button>
      )}
    >
      {loading && !result ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : !result ? (
        <p className="text-sm text-slate-500">{running ? "Checking this tab..." : `Not checked yet for ${tabLabel.toLowerCase()}.`}</p>
      ) : (
        <div className={cn(result.stale && "opacity-70")}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-testid="review-validation-status">
            <span className="text-xs text-slate-500">{summariseChecks(groups)}</span>
            <span className="flex items-center gap-2">
              {effective?.overridden && (
                <span className="text-[11px] text-slate-400">AI said {(PILL[effective.ai_status] || PILL.review).label}; reviewer override applied</span>
              )}
              <span className={cn("rounded-full px-3 py-0.5 text-xs font-semibold", (PILL[shownStatus] || PILL.review).cls)}>
                {(PILL[shownStatus] || PILL.review).label}
              </span>
            </span>
          </div>
          {result.ai_status && result.ai_status !== "ok" && (
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="review-validation-ai-note">
              {AI_NOTES[result.ai_status] || "The AI check did not run."} The rule-based checks below still apply.
            </p>
          )}
          {result.stale && (
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="review-validation-stale">
              The submission changed since this ran. Re-run to refresh.
            </p>
          )}
          {[["fail", "Failed"], ["review", "Needs review"]].map(([key, title]) => groups[key].length > 0 && (
            <section key={key} className="mb-1" data-testid={`review-group-${key}`}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title} ({groups[key].length})</h4>
              <ul className="divide-y divide-slate-100">{renderRows(groups[key])}</ul>
            </section>
          ))}
          {groups.pass.length > 0 && (
            <details className="group mt-1" data-testid="review-group-pass">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" /> Passed ({groups.pass.length})
              </summary>
              <ul className="mt-2 divide-y divide-slate-100">{renderRows(groups.pass)}</ul>
            </details>
          )}
          <p className="mt-3 text-[11px] leading-snug text-slate-400">{result.disclaimer} {result.advisory}</p>
        </div>
      )}
    </RailSection>
  );
}

// --- AI recommendation ---------------------------------------------------

const RATING = {
  Go: "bg-emerald-50 text-emerald-700",
  "Conditional Go": "bg-amber-50 text-amber-700",
  "No-Go": "bg-red-50 text-red-700",
};
const RULE_ICON = {
  pass: <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />,
  fail: <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />,
};

export function RecommendationCard({ recommendation, loading, error, evidenceStale = false }) {
  const r = recommendation;
  return (
    <RailCard title="AI draft recommendation" testid="review-recommendation">
      <p className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800" data-testid="review-recommendation-note">
        Drafted by rules from the submission and its evidence. It is not the Sirius investment decision, which is recorded in the decision card below.
      </p>
      {evidenceStale && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" data-testid="review-evidence-stale">
          <span className="font-semibold">Evidence is out of date.</span> The submission changed after the evidence behind this draft was gathered, so the draft may not reflect the current submission.
        </p>
      )}
      {loading && !r ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : error ? (
        <p className="text-sm text-slate-500" data-testid="review-recommendation-error">{error}</p>
      ) : r ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>AI recommendation</span>
              <span className={cn("rounded-full px-3 py-0.5 text-xs font-semibold", RATING[r.rating])} data-testid="review-rating">{r.rating}</span>
            </div>
            <p className="mt-2 text-sm text-slate-800" data-testid="review-rating-summary">{r.summary}</p>
            <ul className="mt-3 space-y-2" data-testid="review-rules">
              {r.rules.map((rule) => (
                <li key={rule.key} className="flex items-start gap-2 text-xs text-slate-700" data-testid={`review-rule-${rule.key}`}>
                  {RULE_ICON[rule.status]}
                  <span><span className="font-medium text-slate-900">{rule.label}</span>{rule.detail ? ` — ${rule.detail}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          {r.conditions.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3" data-testid="review-conditions">
              <p className="text-xs font-semibold text-slate-900">Conditions to proceed</p>
              <ul className="mt-2 space-y-1.5">
                {r.conditions.map((c) => (
                  <li key={c.key} className="text-xs text-slate-700">{c.text} <span className="font-semibold text-slate-900">Owner: {c.owner}.</span></li>
                ))}
              </ul>
            </div>
          )}
          <RecommendationEvidence recommendation={r} />
          <p className="text-[11px] leading-snug text-slate-400">{r.label}. {r.advisory}</p>
        </div>
      ) : null}
    </RailCard>
  );
}

// --- section-scoped Q&A --------------------------------------------------

function ThreadRow({ thread }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: ["review", "thread", thread.id], queryFn: () => api.qa.thread(thread.id), enabled: open });
  const internal = thread.visibility === "internal";
  return (
    <li className="py-2.5" data-testid={`review-thread-${thread.id}`}>
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">{thread.subject}</span>
          <span className="block text-xs text-slate-500">
            {thread.display_status}{thread.message_count != null ? ` · ${thread.message_count} message(s)` : ""}
          </span>
        </span>
        {internal && <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">Internal</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-5">
          {detail.isLoading && <p className="text-xs text-slate-500">Loading...</p>}
          {(detail.data?.messages || []).map((m) => (
            <div key={m.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <p className="whitespace-pre-wrap">{m.body}</p>
              {m.attachment && <a className="mt-1 inline-flex items-center gap-1 text-blue-700 hover:underline" href={m.attachment.download_url}><Paperclip className="h-3 w-3" />{m.attachment.original_name}</a>}
              <p className="mt-1 text-[10px] text-slate-400">{m.author_name || m.author_email} · {formatWhen(m.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function SectionQACard({ opportunityId, section, sectionLabel }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(true);
  const [files, setFiles] = useState([]);
  const fileInput = useRef(null);

  const threads = useQuery({
    queryKey: ["review", "threads", opportunityId, section],
    queryFn: () => api.qa.threads(opportunityId, { section }),
  });

  const send = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      const thread = await api.qa.open(opportunityId, {
        subject: `${sectionLabel}: ${body}`.slice(0, 120),
        body,
        section,
        requires_response: !internal,
        visibility: internal ? "internal" : "shared",
      });
      for (const file of files) await api.qa.attach(thread.id, file, { body: `Attached ${file.name}` });
      return thread;
    },
    onSuccess: () => {
      setText(""); setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["review", "threads", opportunityId, section] });
      toast({ title: internal ? "Internal note saved" : "Question sent to the subsidiary", description: internal ? "Only the Sirius team can see it." : "It is in their Q&A inbox." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not send", description: error?.message }),
  });

  const list = threads.data?.threads || [];
  return (
    <RailCard title="Question & Answer" testid="review-qa">
      {threads.isLoading ? (
        <p className="mb-3 text-sm text-slate-500">Loading...</p>
      ) : list.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">No questions on this section yet.</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100" data-testid="review-thread-list">{list.map((t) => <ThreadRow key={t.id} thread={t} />)}</ul>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What do you need from the subsidiary?"
        rows={4}
        maxLength={10000}
        data-testid="review-qa-input"
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <Checkbox checked={internal} onCheckedChange={(v) => setInternal(Boolean(v))} data-testid="review-qa-internal" />
        Internal note: only the Sirius team sees it
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600">{files.map((f) => <li key={f.name} className="flex items-center gap-1"><Paperclip className="h-3 w-3" />{f.name}</li>)}</ul>
      )}
      <div className="mt-3 flex gap-3">
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} data-testid="review-qa-file" />
        <Button type="button" variant="outline" className="flex-1" onClick={() => fileInput.current?.click()}>Attach Documents</Button>
        <Button type="button" className="flex-1 bg-blue-700 hover:bg-blue-800" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()} data-testid="review-qa-send">
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
        </Button>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-slate-400">
        A shared question goes to the subsidiary&apos;s Q&amp;A inbox and waits for their response. Pausing the review until they answer is a separate step (Request information).
      </p>
    </RailCard>
  );
}
