/* eslint-disable react/prop-types */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Database, ExternalLink, Loader2 } from "lucide-react";

// External evidence with provenance (INTG-07 / INTG-12) and the tool launchpad
// (EXP-03 / ACC-01 / ACC-04) for one opportunity. Every value shows where it
// came from, when, how and with what confidence; L3+ and AI values wait for a
// second person to confirm them.
export function EvidencePanel({ opportunityId }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ field: "", value: "", source: "", method: "manual", confidence: "" });
  const query = useQuery({ queryKey: ["evidence", opportunityId], queryFn: () => api.evidence.list(opportunityId), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["evidence", opportunityId] });
  const add = useMutation({
    mutationFn: () => api.evidence.add(opportunityId, { ...form, confidence: form.confidence === "" ? undefined : Number(form.confidence) }),
    onSuccess: (item) => { setForm({ field: "", value: "", source: "", method: "manual", confidence: "" }); refresh();
      toast({ title: item.status === "proposed" ? "Value proposed" : "Value recorded", description: item.status === "proposed" ? "A colleague confirms it before it counts." : "Stored with its source." }); },
    onError: (e) => toast({ variant: "destructive", title: "Not recorded", description: e?.message }),
  });
  const review = useMutation({
    mutationFn: ({ id, decision, note }) => (decision === "confirm" ? api.evidence.confirm(id, note) : api.evidence.reject(id, note)),
    onSuccess: refresh,
    onError: (e) => toast({ variant: "destructive", title: "Not saved", description: e?.message }),
  });

  if (query.isError) return null; // not on the investment team
  const items = query.data?.items || [];
  const fields = query.data?.fields || [];

  return (
    <div className="space-y-3" data-testid="evidence-panel">
      {query.isLoading && <p className="text-sm text-slate-500"><Loader2 className="inline h-3 w-3 animate-spin" /> Loading...</p>}
      {items.length === 0 && !query.isLoading && <p className="text-sm text-slate-500">No external evidence yet.</p>}
      <ul className="space-y-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-md border border-slate-200 p-2 text-sm" data-testid={"evidence-" + e.field}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{e.field_label}:</span>
              <span>{typeof e.value === "object" ? JSON.stringify(e.value) : String(e.value)}</span>
              <Badge variant="outline" className={cn(e.status === "proposed" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200")}>{e.status}</Badge>
              <Badge variant="outline">{e.maturity}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Source: {e.source}{e.source_ref ? ` (${e.source_ref})` : ""} · {e.method} · {new Date(e.retrieved_at).toLocaleString()}
              {e.confidence != null && ` · confidence ${Math.round(e.confidence * 100)}%`} · by {e.recorded_by}
              {e.reviewed_by && ` · ${e.status} by ${e.reviewed_by}`}
            </p>
            {e.status === "proposed" && (
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => review.mutate({ id: e.id, decision: "confirm" })}>Confirm</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-700"
                  onClick={() => { const note = window.prompt("Why is this value rejected?"); if (note) review.mutate({ id: e.id, decision: "reject", note }); }}>Reject</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-2">
        <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} data-testid="evidence-field">
          <option value="">Field...</option>
          {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <Input className="h-8 text-xs" placeholder="Value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        <Input className="h-8 text-xs" placeholder="Source (tool key, report, URL)" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        <div className="flex gap-2">
          <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {["manual", "api", "file", "ai"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Input className="h-8 text-xs" placeholder="Confidence 0-1" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} />
        </div>
        <Button size="sm" className="bg-teal-600 hover:bg-teal-700 sm:col-span-2" disabled={!form.field || !form.value || !form.source || add.isPending} onClick={() => add.mutate()}>
          Record value with source
        </Button>
      </div>
    </div>
  );
}

export function LaunchpadPanel({ opportunityId }) {
  const { toast } = useToast();
  const query = useQuery({ queryKey: ["tools", "launchpad", opportunityId], queryFn: () => api.tools.launchpad(opportunityId) });
  const launch = async (tool) => {
    // Open the window first so the browser does not treat it as a pop-up.
    const win = window.open("about:blank", "_blank", "noopener");
    try {
      const res = await api.tools.launch(tool.key, opportunityId);
      if (win) win.location.href = res.url; else window.open(res.url, "_blank", "noopener");
      if (res.note) toast({ title: tool.label, description: res.note });
    } catch (e) {
      if (win) win.close();
      toast({ variant: "destructive", title: "Could not open " + tool.label, description: e?.message });
    }
  };
  const tools = query.data?.tools || [];
  const cats = query.data?.categories || [];
  return (
    <div className="space-y-2" data-testid="launchpad">
      {cats.map((c) => {
        const list = tools.filter((t) => t.category === c.key);
        if (!list.length) return null;
        return (
          <div key={c.key}>
            <p className="text-xs font-medium text-slate-500">{c.label}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {list.map((t) => (
                <Button key={t.key} size="sm" variant="outline" className={cn("h-7 gap-1 text-xs", t.entitled && "border-teal-300")}
                  title={t.entitled ? "You hold a seat" : "No seat recorded; the tool applies its own sign-in"} onClick={() => launch(t)} data-testid={"launch-" + t.key}>
                  {t.label} <ExternalLink className="h-3 w-3" />
                </Button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="flex items-center gap-1 text-xs text-slate-500"><Database className="h-3 w-3" /> Highlighted: tools you hold a seat for. Opens with this opportunity in context.</p>
    </div>
  );
}
