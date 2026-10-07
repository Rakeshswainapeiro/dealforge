import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { ArrowDown, ArrowUp, GitBranch, Loader2, Plus, Save, Trash2 } from "lucide-react";

// Owner assignment and reviewer routing rules (WF-02 / WF-03). The first rule
// whose conditions match a submitted opportunity names its Sirius owner and
// reviewers. A rule names a person or a role; for a role the least-loaded
// active holder is chosen. Saving mints a new revision on the audit trail.

const csv = (list) => (list || []).join(", ");
const fromCsv = (text) => String(text || "").split(",").map((x) => x.trim()).filter(Boolean);
const label = (role) => role.replace(/_/g, " ");

function blankRule(n) {
  return { key: "rule_" + n, label: "New rule", when: { org_ids: [], sectors: [], min_aed: null, max_aed: null, flags: [] },
    owner_email: null, owner_role: "sirius_deal_lead", reviewer_emails: [], reviewer_roles: [] };
}

export default function RoutingRulesPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({ queryKey: ["routing", "config"], queryFn: () => api.routing.get() });
  const [rules, setRules] = useState([]);
  const [fallback, setFallback] = useState("sirius_deal_lead");

  useEffect(() => {
    if (query.data?.config) {
      setRules(query.data.config.rules || []);
      setFallback(query.data.config.fallback_owner_role || "sirius_deal_lead");
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api.routing.save({ rules, fallback_owner_role: fallback }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["routing"] });
      toast({ title: "Routing rules saved", description: `Revision ${result.config.revision}. New submissions use them now.` });
    },
    onError: (error) => toast({ variant: "destructive", title: "Not saved", description: error?.message }),
  });

  const roles = query.data?.roles || [];
  const flags = query.data?.flags || [];
  const update = (i, patch) => setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateWhen = (i, patch) => setRules((prev) => prev.map((r, j) => (j === i ? { ...r, when: { ...r.when, ...patch } } : r)));
  const move = (i, d) => setRules((prev) => {
    const next = [...prev];
    const [item] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, item);
    return next;
  });
  const toggle = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <Card className="border-slate-200 shadow-sm" data-testid="routing-rules-card">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-700 rounded-lg flex items-center justify-center">
            <GitBranch className="w-5 h-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-lg">Owner &amp; Routing</CardTitle>
            <CardDescription>
              When an opportunity is submitted, the first rule that matches names its Sirius owner and reviewers.
              Choose a person, or a role (the least-loaded active holder is picked). Order matters.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : (
          <>
            {rules.map((rule, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-3" data-testid={"routing-rule-" + i}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{i + 1}</Badge>
                  <Input className="h-8 max-w-xs" value={rule.label} onChange={(e) => update(i, { label: e.target.value })} />
                  <Input className="h-8 max-w-[10rem] font-mono text-xs" value={rule.key} onChange={(e) => update(i, { key: e.target.value })} />
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === rules.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Entities (org ids, comma separated; blank = any)</Label>
                    <Input className="h-8 text-xs" value={csv(rule.when?.org_ids)} onChange={(e) => updateWhen(i, { org_ids: fromCsv(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sectors (comma separated; blank = any)</Label>
                    <Input className="h-8 text-xs" value={csv(rule.when?.sectors)} onChange={(e) => updateWhen(i, { sectors: fromCsv(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ticket from / to (AED mn)</Label>
                    <div className="flex gap-2">
                      <Input className="h-8 text-xs" type="number" value={rule.when?.min_aed ?? ""} onChange={(e) => updateWhen(i, { min_aed: e.target.value === "" ? null : Number(e.target.value) })} />
                      <Input className="h-8 text-xs" type="number" value={rule.when?.max_aed ?? ""} onChange={(e) => updateWhen(i, { max_aed: e.target.value === "" ? null : Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Any of these flags</Label>
                    <div className="flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <Button key={f.key} size="sm" variant={(rule.when?.flags || []).includes(f.key) ? "default" : "outline"} className="h-7 text-xs"
                          onClick={() => updateWhen(i, { flags: toggle(rule.when?.flags || [], f.key) })}>
                          {f.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Owner: a person (email) or a role</Label>
                    <div className="flex gap-2">
                      <Input className="h-8 text-xs" placeholder="name@sirius..." value={rule.owner_email || ""} onChange={(e) => update(i, { owner_email: e.target.value || null })} />
                      <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" value={rule.owner_role || ""} onChange={(e) => update(i, { owner_role: e.target.value || null })}>
                        <option value="">(no role)</option>
                        {roles.filter((r) => r !== "independent_reviewer").map((r) => <option key={r} value={r}>{label(r)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reviewer roles</Label>
                    <div className="flex flex-wrap gap-1">
                      {roles.map((r) => (
                        <Button key={r} size="sm" variant={(rule.reviewer_roles || []).includes(r) ? "default" : "outline"} className="h-7 text-xs"
                          onClick={() => update(i, { reviewer_roles: toggle(rule.reviewer_roles || [], r) })}>
                          {label(r)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setRules((prev) => [...prev, blankRule(prev.length + 1)])}>
                <Plus className="h-4 w-4" /> Add rule
              </Button>
              <Label className="text-xs">When nothing matches, owner role:</Label>
              <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" value={fallback} onChange={(e) => setFallback(e.target.value)}>
                {roles.filter((r) => r !== "independent_reviewer").map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </select>
              <Button className="ml-auto gap-2 bg-teal-600 hover:bg-teal-700" size="sm" disabled={save.isPending} onClick={() => save.mutate()} data-testid="routing-save">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save rules
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Revision {query.data?.config?.revision}. Already-assigned opportunities keep their owner; re-assign them from the Screening Board.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
