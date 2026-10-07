import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Filter, Layers, RefreshCw, TrendingDown } from "lucide-react";

// Pipeline dashboard filters (W7-02 / DSH-01). The Investment Team slices the
// live board by entity, cluster, sector, stage, owner and date, and drills down
// into any cut. The server applies the filter set over the board (already
// scoped to the actor's organisation) and returns the filtered cards, the
// near-real-time summary and the drill-down grouping.
const EMPTY = "__all__";

export default function PipelineDashboard() {
  const [filters, setFilters] = useState({ entity: EMPTY, cluster: EMPTY, sector: EMPTY, owner: EMPTY, date: "any", state: [] });
  const [drilldown, setDrilldown] = useState("");

  const query = useMemo(() => {
    const q = {};
    for (const key of ["entity", "cluster", "sector", "owner"]) {
      if (filters[key] && filters[key] !== EMPTY) q[key] = filters[key];
    }
    if (filters.state.length) q.state = filters.state;
    if (filters.date && filters.date !== "any") q.date = filters.date;
    if (drilldown) q.drilldown = drilldown;
    return q;
  }, [filters, drilldown]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["pipeline-dashboard", query],
    queryFn: () => api.pipelineDashboard.board(query),
    initialData: null,
  });

  const options = data?.options || { entity: [], cluster: [], sector: [], state: [], owner: [], date: [] };
  const dimension = data?.config?.default_drilldown || "state";
  const groups = data?.drilldown?.groups || [];
  const cards = data?.cards || [];
  const summary = data?.summary || { total: 0, breaches: 0, by_state: {} };
  const activeCount = data?.active_filters || 0;

  function set(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function toggleState(value) {
    setFilters((f) => {
      const has = f.state.includes(value);
      return { ...f, state: has ? f.state.filter((s) => s !== value) : [...f.state, value] };
    });
  }

  function reset() {
    setFilters({ entity: EMPTY, cluster: EMPTY, sector: EMPTY, owner: EMPTY, date: "any", state: [] });
    setDrilldown("");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Layers className="w-8 h-8 text-teal-600" />
              Pipeline Dashboard
            </h1>
            <p className="text-slate-600 mt-1">
              Slice the live pipeline by entity, cluster, sector, stage, owner and date, then drill down into any cut.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={reset} data-testid="pd-reset" disabled={activeCount === 0}>
              <Filter className="w-4 h-4 mr-2" />
              Clear filters
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="pd-refresh">
              <RefreshCw className={"w-4 h-4 mr-2" + (isFetching ? " animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        </div>

        <Card className="border border-slate-200" data-testid="pd-filters">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filters
              {activeCount > 0 && <Badge className="bg-teal-100 text-teal-700">{activeCount} active</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Entity</div>
                <Select value={filters.entity} onValueChange={(v) => set("entity", v)}>
                  <SelectTrigger data-testid="pd-entity"><SelectValue placeholder="All entities" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY}>All entities</SelectItem>
                    {options.entity.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Cluster</div>
                <Select value={filters.cluster} onValueChange={(v) => set("cluster", v)}>
                  <SelectTrigger data-testid="pd-cluster"><SelectValue placeholder="All clusters" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY}>All clusters</SelectItem>
                    {options.cluster.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Sector</div>
                <Select value={filters.sector} onValueChange={(v) => set("sector", v)}>
                  <SelectTrigger data-testid="pd-sector"><SelectValue placeholder="All sectors" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY}>All sectors</SelectItem>
                    {options.sector.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Owner</div>
                <Select value={filters.owner} onValueChange={(v) => set("owner", v)}>
                  <SelectTrigger data-testid="pd-owner"><SelectValue placeholder="All owners" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY}>All owners</SelectItem>
                    {options.owner.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Updated</div>
                <Select value={filters.date} onValueChange={(v) => set("date", v)}>
                  <SelectTrigger data-testid="pd-date"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(options.date || []).map((o) => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Stage</div>
              <div className="flex flex-wrap gap-2" data-testid="pd-state">
                {options.state.map((o) => {
                  const on = filters.state.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggleState(o.value)}
                      className={
                        "px-3 py-1.5 rounded-full text-sm border capitalize transition-colors " +
                        (on ? "bg-teal-50 border-teal-300 text-teal-700" : "bg-white border-slate-200 text-slate-500")
                      }
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500">Drill down by</div>
              <Select value={drilldown || dimension} onValueChange={setDrilldown}>
                <SelectTrigger className="w-56" data-testid="pd-drilldown"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["entity", "cluster", "sector", "state", "owner"].map((d) => (
                    <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="pd-summary">
          {[
            { label: "Matching opportunities", value: summary.total },
            { label: "Board total", value: data?.board_total ?? "—" },
            { label: "SLA breaches", value: summary.breaches, warn: summary.breaches > 0 },
            { label: "Open questions", value: summary.open_questions ?? 0 },
            { label: "Overdue questions", value: summary.overdue_questions ?? 0, warn: (summary.overdue_questions || 0) > 0 },
            { label: "Unassigned", value: summary.unassigned ?? 0, warn: (summary.unassigned || 0) > 0 },
          ].map((m) => (
            <Card key={m.label}>
              <CardContent className="pt-6">
                <div className="text-sm text-slate-500">{m.label}</div>
                <div className={"text-2xl font-bold " + (m.warn ? "text-amber-600" : "text-slate-900")}>{m.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingDown className="w-4 h-4" />
              Drill-down by <span className="capitalize">{data?.drilldown?.dimension || dimension}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <div className="text-slate-500 py-8 text-center">Loading the pipeline…</div>
            ) : cards.length === 0 ? (
              <div className="text-slate-500 py-8 text-center" data-testid="pd-empty">No opportunities match these filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="capitalize">{data?.drilldown?.dimension || dimension}</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead>Stages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={g.key} data-testid="pd-group">
                      <TableCell className="font-medium">{g.label}</TableCell>
                      <TableCell className="text-right">{g.count}</TableCell>
                      <TableCell className="text-slate-500">
                        {[...new Set(g.items.map((i) => i.state_label || i.state))].join(", ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
