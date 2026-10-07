import { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Activity, RefreshCw, TrendingDown, Timer } from "lucide-react";

const COLORS = ["#0d9488", "#0891b2", "#3b82f6", "#6366f1", "#f59e0b", "#ef4444"];

// Funnel & cycle-time metrics (W7-03 / DSH-04). The Investment Team sees how
// many opportunities reach each forward stage, why the ones that leave are
// declined / on hold / withdrawn, and how long each stage takes against its
// SLA target, for a chosen date range.
export default function PipelineMetrics() {
  const [range, setRange] = useState("any");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["pipeline-metrics", range],
    queryFn: () => api.pipelineMetrics.summary(range),
    initialData: null,
  });

  const funnel = data?.funnel || [];
  const cycle = data?.cycle || [];
  const reasons = data?.reasons || {};
  const branchStates = data?.branch_states || [];

  const chartData = funnel.map((f) => ({ name: (f.key || "").replace(/^./, (c) => c.toUpperCase()), count: f.count }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Activity className="w-8 h-8 text-teal-600" />
              Funnel &amp; Cycle Time
            </h1>
            <p className="text-slate-600 mt-1">
              Stage conversion, decline reasons and cycle time measured against the stage SLA.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-44" data-testid="pm-range"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any time</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="365d">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="pm-refresh">
              <RefreshCw className={"w-4 h-4 mr-2" + (isFetching ? " animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="pm-summary">
          {[
            { label: "Entered funnel", value: data?.entered ?? "—" },
            { label: "Tracked opportunities", value: data?.total ?? "—" },
            { label: "Cycle-time breaches", value: data?.cycle_breaches ?? "—", warn: (data?.cycle_breaches || 0) > 0 },
            { label: "Range", value: range === "any" ? "Any time" : range },
          ].map((m) => (
            <Card key={m.label}>
              <CardContent className="pt-6">
                <div className="text-sm text-slate-500">{m.label}</div>
                <div className={"text-2xl font-bold " + (m.warn ? "text-amber-600" : "text-slate-900")}>{m.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border border-slate-200" data-testid="pm-funnel">
          <CardHeader>
            <CardTitle className="text-lg">Funnel conversion</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <div className="text-slate-500 py-8 text-center">Loading the funnel…</div>
            ) : (
              <>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Reached</TableHead>
                      <TableHead className="text-right">From previous</TableHead>
                      <TableHead className="text-right">From submission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funnel.map((f) => (
                      <TableRow key={f.key} data-testid="pm-stage">
                        <TableCell className="font-medium capitalize">{f.key}</TableCell>
                        <TableCell className="text-right">{f.count}</TableCell>
                        <TableCell className="text-right">{f.from_previous == null ? "—" : f.from_previous + "%"}</TableCell>
                        <TableCell className="text-right">{f.from_first == null ? "—" : f.from_first + "%"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200" data-testid="pm-cycle">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Timer className="w-4 h-4" /> Cycle time vs SLA (days)
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Samples</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">SLA</TableHead>
                  <TableHead className="text-right">Avg vs SLA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycle.map((s) => (
                  <TableRow key={s.key} data-testid="pm-cycle-row">
                    <TableCell className="font-medium capitalize">{s.key}</TableCell>
                    <TableCell className="text-right">{s.samples}</TableCell>
                    <TableCell className="text-right">{s.avg_days == null ? "—" : s.avg_days}</TableCell>
                    <TableCell className="text-right">{s.median_days == null ? "—" : s.median_days}</TableCell>
                    <TableCell className="text-right">{s.max_days == null ? "—" : s.max_days}</TableCell>
                    <TableCell className="text-right">{s.sla_days == null ? "—" : s.sla_days}</TableCell>
                    <TableCell className={"text-right " + (s.within_sla === false ? "text-amber-600 font-medium" : "")}>
                      {s.avg_vs_sla == null ? "—" : (s.avg_vs_sla > 0 ? "+" : "") + s.avg_vs_sla}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border border-slate-200" data-testid="pm-reasons">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingDown className="w-4 h-4" /> Why opportunities leave
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {branchStates.map((b) => {
              const block = reasons[b.key] || { total: 0, reasons: [] };
              return (
                <div key={b.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-slate-800">{b.label}</span>
                    <Badge className="bg-slate-100 text-slate-600">{block.total}</Badge>
                  </div>
                  {block.reasons.length === 0 ? (
                    <div className="text-sm text-slate-400">No {b.label.toLowerCase()} records in range.</div>
                  ) : (
                    <div className="space-y-1">
                      {block.reasons.map((r) => (
                        <div key={r.code} className="flex items-center justify-between text-sm" data-testid="pm-reason">
                          <span className="text-slate-600">{r.text || r.code}</span>
                          <span className="text-slate-500">{r.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
