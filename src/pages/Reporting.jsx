import { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FileSpreadsheet, Download, CalendarClock, Settings2, RefreshCw } from "lucide-react";

// IHC weekly report (W7-01 / DSH-03). Reproduces the group Investment Holding
// Committee's standing Friday tracker straight from the live pipeline: the
// agreed columns in order, an Excel/CSV export and an optional weekly schedule.
// The column set, the state filter and the schedule are configuration owned by
// the group admin (AppSettings 'reporting_config').
export default function Reporting() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("weekly");

  const { data: me } = useQuery({ queryKey: ["currentUser"], queryFn: () => api.auth.me() });
  const isAdmin = me?.role === "admin";

  const { data: report, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ihc-weekly"],
    queryFn: () => api.reporting.weekly(),
    initialData: null,
  });

  const { data: configData } = useQuery({
    queryKey: ["reporting-config"],
    queryFn: () => api.reporting.config(),
    initialData: null,
  });

  const [localConfig, setLocalConfig] = useState(null);
  const config = localConfig || configData?.config || null;

  const saveMutation = useMutation({
    mutationFn: (patch) => api.reporting.updateConfig(patch),
    onSuccess: (res) => {
      toast.success("Reporting configuration saved (revision " + res.config.revision + ")");
      setLocalConfig(null);
      qc.invalidateQueries({ queryKey: ["reporting-config"] });
      qc.invalidateQueries({ queryKey: ["ihc-weekly"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const exportMutation = useMutation({
    mutationFn: (format) => api.reporting.downloadWeekly(format),
    onSuccess: (r) => toast.success("Exported " + r.filename),
    onError: (e) => toast.error(e.message),
  });

  const columns = report?.columns || [];
  const rows = report?.rows || [];
  const summary = report?.summary || { total: 0, breaches: 0, commitment_aed_mn: 0, by_state: {} };

  function toggleColumn(key) {
    if (!config) return;
    const has = config.columns.includes(key);
    const next = has ? config.columns.filter((c) => c !== key) : [...config.columns, key];
    // Keep the canonical order.
    const order = (configData?.all_columns || []).map((c) => c.key);
    next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    setLocalConfig({ ...config, columns: next });
  }

  function toggleState(state) {
    if (!config) return;
    const has = config.states.includes(state);
    setLocalConfig({ ...config, states: has ? config.states.filter((s) => s !== state) : [...config.states, state] });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-teal-600" />
              IHC Weekly Report
            </h1>
            <p className="text-slate-600 mt-1">
              The group Investment Holding Committee&apos;s weekly deal tracker, generated from the live pipeline.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={"w-4 h-4 mr-2" + (isFetching ? " animate-spin" : "")} />
              Refresh
            </Button>
            <Button
              variant="outline"
              data-testid="ihc-export-csv"
              onClick={() => exportMutation.mutate("csv")}
              disabled={exportMutation.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
            <Button
              data-testid="ihc-export-xlsx"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => exportMutation.mutate("xlsx")}
              disabled={exportMutation.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Excel
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Opportunities", value: summary.total },
            { label: "SLA breaches", value: summary.breaches, warn: summary.breaches > 0 },
            { label: "Commitment (AED mn)", value: summary.commitment_aed_mn },
            { label: "Stage", value: (report?.states || []).length + " states" },
          ].map((m) => (
            <Card key={m.label}>
              <CardContent className="pt-6">
                <div className="text-sm text-slate-500">{m.label}</div>
                <div className={"text-2xl font-bold " + (m.warn ? "text-amber-600" : "text-slate-900")}>{m.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="weekly" className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Weekly tracker
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4" /> Schedule
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="config" className="flex items-center gap-2" data-testid="ihc-tab-config">
                <Settings2 className="w-4 h-4" /> Configuration
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="weekly" data-testid="ihc-weekly">
            <Card className="border border-slate-200">
              <CardHeader>
                <CardTitle className="text-lg">Friday tracker columns</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {isLoading && !report ? (
                  <div className="text-slate-500 py-8 text-center">Loading the tracker…</div>
                ) : rows.length === 0 ? (
                  <div className="text-slate-500 py-8 text-center" data-testid="ihc-empty">
                    No opportunities are in the tracked states yet.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {columns.map((c) => (
                          <TableHead key={c.key} className="whitespace-nowrap">{c.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id} data-testid="ihc-row">
                          {columns.map((c) => (
                            <TableCell key={c.key} className="whitespace-nowrap">
                              {r.values[c.key] === "" || r.values[c.key] == null ? "—" : String(r.values[c.key])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule" data-testid="ihc-schedule">
            <Card className="border border-slate-200">
              <CardHeader>
                <CardTitle className="text-lg">Weekly schedule</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600">
                  The pack is generated on demand; the schedule records the agreed weekly cadence so operators know
                  when the tracker is due. Enable it to advertise the Friday run to the group.
                </p>
                {config && (
                  <div className="flex items-center gap-3">
                    <Switch
                      data-testid="ihc-schedule-enabled"
                      checked={Boolean(config.schedule.enabled)}
                      onCheckedChange={(v) => setLocalConfig({ ...config, schedule: { ...config.schedule, enabled: v } })}
                      disabled={!isAdmin}
                    />
                    <span className="text-sm text-slate-700">
                      Weekly run on{" "}
                      {(configData?.weekdays || []).find((d) => d.value === config.schedule.weekday)?.label || "Friday"}{" "}
                      at {String(config.schedule.hour).padStart(2, "0")}:00 ({config.schedule.timezone})
                    </span>
                  </div>
                )}
                {isAdmin && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Weekday</Label>
                      <Select
                        value={String(config?.schedule.weekday ?? 5)}
                        onValueChange={(v) => setLocalConfig({ ...config, schedule: { ...config.schedule, weekday: Number(v) } })}
                      >
                        <SelectTrigger data-testid="ihc-schedule-weekday"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(configData?.weekdays || []).map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Hour (0-23)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={config?.schedule.hour ?? 9}
                        data-testid="ihc-schedule-hour"
                        onChange={(e) => setLocalConfig({ ...config, schedule: { ...config.schedule, hour: Number(e.target.value) } })}
                      />
                    </div>
                    <div>
                      <Label>Timezone</Label>
                      <Input
                        value={config?.schedule.timezone ?? "Asia/Dubai"}
                        data-testid="ihc-schedule-tz"
                        onChange={(e) => setLocalConfig({ ...config, schedule: { ...config.schedule, timezone: e.target.value } })}
                      />
                    </div>
                  </div>
                )}
                {isAdmin && (
                  <Button
                    className="bg-teal-600 hover:bg-teal-700"
                    data-testid="ihc-save"
                    onClick={() => saveMutation.mutate({ schedule: config.schedule })}
                    disabled={!localConfig || saveMutation.isPending}
                  >
                    Save schedule
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config" data-testid="ihc-config">
            <Card className="border border-slate-200">
              <CardHeader>
                <CardTitle className="text-lg">
                  Tracker configuration{" "}
                  {config && <span className="text-sm font-normal text-slate-500">revision {config.revision}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <div className="font-medium text-slate-800 mb-2">Columns (agreed order)</div>
                  <div className="flex flex-wrap gap-2">
                    {(configData?.all_columns || []).map((c) => {
                      const on = config?.columns.includes(c.key);
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggleColumn(c.key)}
                          className={
                            "px-3 py-1.5 rounded-full text-sm border transition-colors " +
                            (on
                              ? "bg-teal-50 border-teal-300 text-teal-700"
                              : "bg-white border-slate-200 text-slate-400 line-through")
                          }
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-slate-800 mb-2">Stages tracked</div>
                  <div className="flex flex-wrap gap-2">
                    {["submission", "screening", "refinement", "approval", "returned", "declined", "withdrawn"].map((s) => {
                      const on = config?.states.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleState(s)}
                          className={
                            "px-3 py-1.5 rounded-full text-sm border capitalize transition-colors " +
                            (on ? "bg-teal-50 border-teal-300 text-teal-700" : "bg-white border-slate-200 text-slate-400")
                          }
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {config && (
                  <div className="text-xs text-slate-500">
                    Version {config.version} · owner {config.owner}
                  </div>
                )}
                <Button
                  className="bg-teal-600 hover:bg-teal-700"
                  data-testid="ihc-config-save"
                  onClick={() => saveMutation.mutate({ columns: config.columns, states: config.states })}
                  disabled={!localConfig || saveMutation.isPending}
                >
                  Save configuration
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
