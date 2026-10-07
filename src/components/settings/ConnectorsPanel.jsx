/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plug, Save, Trash2, Users } from "lucide-react";

// Connector console (INTG-11 / INTG-12) and the tool entitlement register
// (ACC-02). Enabling a connector, its cadence, field map and the maturity of
// each capability take effect on save, without a release.
export default function ConnectorsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({ queryKey: ["connectors"], queryFn: () => api.connectors.get() });
  const seatsQuery = useQuery({ queryKey: ["tools", "entitlements"], queryFn: () => api.tools.entitlements() });
  const [connectors, setConnectors] = useState([]);
  const [ssoTemplate, setSsoTemplate] = useState("");
  const [open, setOpen] = useState(null);
  const [grant, setGrant] = useState({ email: "", key: "" });

  useEffect(() => {
    if (query.data?.config) {
      setConnectors(query.data.config.connectors);
      setSsoTemplate(query.data.config.sso_launch_template || "");
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api.connectors.save({ connectors, sso_launch_template: ssoTemplate || null }),
    onSuccess: (r) => { queryClient.invalidateQueries({ queryKey: ["connectors"] }); queryClient.invalidateQueries({ queryKey: ["tools"] });
      toast({ title: "Connectors saved", description: `Revision ${r.config.revision}; ${r.changes.length} change(s).` }); },
    onError: (e) => toast({ variant: "destructive", title: "Not saved", description: e?.message }),
  });
  const grantSeat = useMutation({
    mutationFn: () => api.tools.grant(grant.email.trim(), grant.key),
    onSuccess: () => { setGrant({ email: "", key: "" }); queryClient.invalidateQueries({ queryKey: ["tools", "entitlements"] }); },
    onError: (e) => toast({ variant: "destructive", title: "Seat not granted", description: e?.message }),
  });
  const revoke = useMutation({
    mutationFn: (id) => api.tools.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tools", "entitlements"] }),
  });

  const update = (key, patch) => setConnectors((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const levels = query.data?.maturity_levels || [];
  const fields = query.data?.evidence_fields || [];
  const cadences = query.data?.cadences || ["manual"];
  const seats = seatsQuery.data?.items || [];

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm" data-testid="connectors-card">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-lg"><Plug className="h-5 w-5 text-teal-600" /> Connectors</CardTitle>
          <CardDescription>
            The specialist tools DealForge connects to. A disabled connector exchanges no data but can still be launched.
            Capabilities at L3 or above, and AI-derived values, always need a person to confirm them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-6">
          {query.isLoading ? <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading...</p> : (
            <>
              {connectors.map((c) => (
                <div key={c.key} className="rounded-md border border-slate-200 p-3" data-testid={"connector-" + c.key}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{c.label}</span>
                    <Badge variant="outline">{c.category.replace(/_/g, " ")}</Badge>
                    <label className="ml-auto flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={c.enabled} onChange={(e) => update(c.key, { enabled: e.target.checked })} /> data exchange
                    </label>
                    <select className="h-7 rounded border border-slate-300 bg-white px-1 text-xs" value={c.refresh_cadence} onChange={(e) => update(c.key, { refresh_cadence: e.target.value })}>
                      {cadences.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(open === c.key ? null : c.key)}>{open === c.key ? "Close" : "Configure"}</Button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.capabilities.map((cap, i) => (
                      <span key={cap.key} className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs">
                        {cap.label}
                        <select className="bg-transparent text-xs" value={cap.maturity}
                          onChange={(e) => update(c.key, { capabilities: c.capabilities.map((x, j) => (j === i ? { ...x, maturity: e.target.value } : x)) })}>
                          {levels.map((l) => <option key={l.key} value={l.key}>{l.key}</option>)}
                        </select>
                      </span>
                    ))}
                  </div>
                  {open === c.key && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input className="h-8 text-xs" placeholder="Launch URL (https)" value={c.launch_url || ""} onChange={(e) => update(c.key, { launch_url: e.target.value })} />
                      <Input className="h-8 text-xs" placeholder="Deep link with {target_name} / {sector}" value={c.deep_link_template || ""} onChange={(e) => update(c.key, { deep_link_template: e.target.value })} />
                      <Input className="h-8 text-xs" placeholder="SSO app id at the identity provider" value={c.sso_app_id || ""} onChange={(e) => update(c.key, { sso_app_id: e.target.value })} />
                      <div className="sm:col-span-2 space-y-1">
                        <p className="text-xs font-medium text-slate-600">Field map (tool field → evidence field)</p>
                        {c.field_map.map((m, i) => (
                          <div key={i} className="flex gap-2">
                            <Input className="h-7 text-xs" value={m.source} onChange={(e) => update(c.key, { field_map: c.field_map.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)) })} />
                            <select className="h-7 rounded border border-slate-300 bg-white px-1 text-xs" value={m.target}
                              onChange={(e) => update(c.key, { field_map: c.field_map.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)) })}>
                              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => update(c.key, { field_map: c.field_map.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        ))}
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => update(c.key, { field_map: [...c.field_map, { source: "", target: fields[0]?.key || "note" }] })}>Add mapping</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 max-w-lg text-xs" placeholder="Identity-provider launch template, e.g. https://idp/launch/{app_id}?target={redirect}"
                  value={ssoTemplate} onChange={(e) => setSsoTemplate(e.target.value)} />
                <Button size="sm" className="ml-auto gap-2 bg-teal-600 hover:bg-teal-700" disabled={save.isPending} onClick={() => save.mutate()} data-testid="connectors-save">
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save connectors
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm" data-testid="entitlements-card">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-5 w-5 text-teal-600" /> Tool entitlements</CardTitle>
          <CardDescription>Who holds a seat for which tool. A seat unused for 90 days shows as dormant. The portal never blocks a launch; each tool applies its own sign-in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap gap-2">
            <Input className="h-8 max-w-xs text-xs" placeholder="user@sirius..." value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} />
            <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" value={grant.key} onChange={(e) => setGrant({ ...grant, key: e.target.value })}>
              <option value="">Tool...</option>
              {connectors.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!grant.email || !grant.key || grantSeat.isPending} onClick={() => grantSeat.mutate()}>Grant seat</Button>
          </div>
          {seats.length === 0 ? <p className="text-sm text-slate-500">No seats recorded.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th>User</th><th>Tool</th><th>Status</th><th>Last launch</th><th>Launches</th><th /></tr></thead>
              <tbody>
                {seats.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-1">{s.user_email}</td>
                    <td>{connectors.find((c) => c.key === s.connector_key)?.label || s.connector_key}</td>
                    <td><Badge variant="outline" className={s.status === "dormant" ? "bg-amber-100 text-amber-800 border-amber-200" : ""}>{s.status}</Badge></td>
                    <td className="text-xs text-slate-500">{s.last_launched_at ? new Date(s.last_launched_at).toLocaleDateString() : "never"}</td>
                    <td>{s.launches}</td>
                    <td><Button size="sm" variant="ghost" className="h-7 text-xs text-red-700" onClick={() => revoke.mutate(s.id)}>Revoke</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
