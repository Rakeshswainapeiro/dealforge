import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  Building2,
  Info,
  Loader2,
  Lock,
  Save,
  ShieldCheck,
  Target,
} from "lucide-react";

// ---------------------------------------------------------------------------
// E5 — Investment theme administration (REQ-THEME-01).
//
// An admin defines one theme per organisation (sector, keywords, geographies,
// opportunity types, size band) and the mandate thresholds used by the
// alignment engine (AED floor + return hurdles, REQ-RULE-02/05/10).
//
// Everything is server-driven: this page reads api.themes.get(orgId) and writes
// through api.themes.save / api.themes.saveThresholds. It never scores, gates or
// clears an opportunity locally — the server owns that logic and enforces the
// admin role (a 403 surfaces here as a read-only view).
// ---------------------------------------------------------------------------

const THEME_STATUSES = [
  { value: "draft", label: "Draft", className: "bg-amber-100 text-amber-800 border-amber-200" },
  { value: "approved", label: "Approved", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "archived", label: "Archived", className: "bg-slate-100 text-slate-600 border-slate-200" },
];

const STATUS_META = Object.fromEntries(THEME_STATUSES.map((s) => [s.value, s]));

const OPPORTUNITY_TYPES = [
  { value: "acquisition", label: "Acquisition" },
  { value: "merger", label: "Merger" },
  { value: "joint_venture", label: "Joint venture" },
  { value: "asset_purchase", label: "Asset purchase" },
  { value: "strategic_partnership", label: "Strategic partnership" },
  { value: "other", label: "Other" },
];

// Mandate thresholds (REQ-RULE-10 — configurable, never hard-coded in the UI).
// Values are stored per org by the server; the labels explain what each drives.
const THRESHOLD_FIELDS = [
  {
    key: "floor_aed",
    label: "Minimum deal size — AED floor (AED m)",
    hint: "Deals below this floor are flagged for a portfolio-synergy + IRR exception and Sirius escalation (REQ-RULE-02).",
    step: "1",
  },
  {
    key: "equity_irr_min",
    label: "Equity IRR hurdle (%)",
    hint: "Minimum equity IRR an investment must demonstrate (REQ-RULE-05).",
    step: "0.5",
  },
  {
    key: "greenfield_irr_min",
    label: "Greenfield IRR hurdle (%)",
    hint: "Higher hurdle applied to greenfield builds versus brownfield (REQ-RULE-05).",
    step: "0.5",
  },
  {
    key: "roic_wacc_spread",
    label: "ROIC − WACC spread (ppts)",
    hint: "Required return-on-invested-capital spread over the cost of capital.",
    step: "0.5",
  },
  {
    key: "wacc_pct",
    label: "Entity WACC (%)",
    hint: "Sirius-set cost of capital for this entity. Every opportunity inherits it; a preparer may override per deal with a reason (FIN-05).",
    step: "0.5",
  },
  {
    key: "payback_max_years",
    label: "Maximum payback (years)",
    hint: "Longest acceptable payback period for a commitment.",
    step: "0.5",
  },
  {
    key: "concentration_max_pct",
    label: "Maximum concentration (% of portfolio)",
    hint: "Cap on exposure to a single name or sector within the portfolio.",
    step: "1",
  },
  {
    key: "leverage_max",
    label: "Maximum leverage (x)",
    hint: "Ceiling on net debt / EBITDA at entry.",
    step: "0.5",
  },
];

const EMPTY_FORM = {
  sector: "",
  keywords: "",
  geographies: "",
  opportunity_types: [],
  description: "",
  min_aed: "",
  max_aed: "",
  status: "draft",
};

function toForm(theme) {
  if (!theme) return { ...EMPTY_FORM, opportunity_types: [] };
  return {
    sector: theme.sector ?? "",
    keywords: (theme.keywords || []).join(", "),
    geographies: (theme.geographies || []).join(", "),
    opportunity_types: theme.opportunity_types || [],
    description: theme.description ?? "",
    min_aed: theme.min_aed == null ? "" : String(theme.min_aed),
    max_aed: theme.max_aed == null ? "" : String(theme.max_aed),
    status: theme.status === "approved" ? "approved" : "draft",
  };
}

function toThresholdsForm(thresholds) {
  const form = {};
  for (const field of THRESHOLD_FIELDS) {
    const value = thresholds?.[field.key];
    form[field.key] = value == null ? "" : String(value);
  }
  return form;
}

// Split a free-text list field. Commas always separate; keywords additionally
// accept space-separated tokens. Geographies stay whole so multi-word names survive.
function parseList(value, splitSpace) {
  const raw = String(value ?? "");
  const parts = raw.includes(",") ? raw.split(",") : splitSpace ? raw.split(/[\s]+/) : [raw];
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function numberOrNull(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || {
    label: status ? status.charAt(0).toUpperCase() + status.slice(1) : "No theme",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <Badge
      variant="outline"
      className={cn("font-medium", meta.className)}
      data-testid="theme-status"
    >
      {meta.label}
    </Badge>
  );
}

StatusBadge.propTypes = {
  status: PropTypes.string,
};

function ListPreview({ values, empty }) {
  if (!values || values.length === 0) {
    return <p className="text-xs text-slate-400">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge key={value} variant="secondary" className="font-normal">
          {value}
        </Badge>
      ))}
    </div>
  );
}

ListPreview.propTypes = {
  values: PropTypes.arrayOf(PropTypes.string),
  empty: PropTypes.string,
};

export default function ThemeAdmin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [orgId, setOrgId] = useState("");
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, opportunity_types: [] }));
  const [thresholdsForm, setThresholdsForm] = useState(() => toThresholdsForm(null));
  const [permissionDenied, setPermissionDenied] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.auth.me(),
  });

  const { data: organizations = [] } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      try {
        const rows = await api.org.organizations();
        return Array.isArray(rows) ? rows : [];
      } catch {
        // The org tree may be unreadable for restricted roles; the selector
        // still offers the current user's org below.
        return [];
      }
    },
  });

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["theme", orgId],
    queryFn: () => api.themes.get(orgId),
    enabled: Boolean(orgId),
  });

  const themeFromServer = data?.theme ?? null;
  const thresholdsFromServer = data?.thresholds ?? null;

  // Default the selector to the current user's org.
  useEffect(() => {
    if (!orgId && currentUser?.org_id) setOrgId(currentUser.org_id);
  }, [currentUser, orgId]);

  // Sync the theme form to whatever the server last returned for this org.
  useEffect(() => {
    setForm(themeFromServer ? toForm(themeFromServer) : { ...EMPTY_FORM, opportunity_types: [] });
  }, [orgId, themeFromServer]);

  useEffect(() => {
    setThresholdsForm(toThresholdsForm(thresholdsFromServer));
  }, [orgId, thresholdsFromServer]);

  const isAdmin =
    (currentUser?.roles || []).includes("admin") || currentUser?.role === "admin";
  const canEdit = isAdmin && !permissionDenied;

  const orgOptions = useMemo(() => {
    const byId = new Map();
    for (const org of organizations) {
      if (org?.id) byId.set(org.id, org);
    }
    if (currentUser?.org_id && !byId.has(currentUser.org_id)) {
      byId.set(currentUser.org_id, {
        id: currentUser.org_id,
        name: currentUser.org_name || currentUser.org_id,
      });
    }
    return [...byId.values()].sort((a, b) => {
      const levelDiff = (a.level ?? 0) - (b.level ?? 0);
      if (levelDiff !== 0) return levelDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [organizations, currentUser]);

  const parsedKeywords = useMemo(() => parseList(form.keywords, true), [form.keywords]);
  const parsedGeographies = useMemo(() => parseList(form.geographies, false), [form.geographies]);

  function handlePermissionError(mutationError) {
    if (mutationError?.status === 403) {
      setPermissionDenied(true);
      return true;
    }
    return false;
  }

  const saveTheme = useMutation({
    mutationFn: (payload) => api.themes.save(payload),
    onSuccess: (theme) => {
      setForm(toForm(theme));
      queryClient.invalidateQueries({ queryKey: ["theme", orgId] });
      toast({
        title: theme?.status === "approved" ? "Theme approved" : "Theme saved",
        description:
          theme?.status === "approved"
            ? "The theme is now approved and used for opportunity alignment."
            : "The theme was saved as a draft.",
      });
    },
    onError: (err) => {
      const denied = handlePermissionError(err);
      toast({
        variant: "destructive",
        title: denied ? "Admins only" : "Could not save theme",
        description: denied
          ? "You do not have permission to edit this organisation's theme."
          : err?.message || "An unexpected error occurred.",
      });
    },
  });

  const saveThresholds = useMutation({
    mutationFn: (payload) => api.themes.saveThresholds(payload),
    onSuccess: (thresholds) => {
      setThresholdsForm(toThresholdsForm(thresholds));
      queryClient.invalidateQueries({ queryKey: ["theme", orgId] });
      toast({
        title: "Thresholds saved",
        description: "The mandate floor and return hurdles have been updated.",
      });
    },
    onError: (err) => {
      const denied = handlePermissionError(err);
      toast({
        variant: "destructive",
        title: denied ? "Admins only" : "Could not save thresholds",
        description: denied
          ? "You do not have permission to edit mandate thresholds."
          : err?.message || "An unexpected error occurred.",
      });
    },
  });

  const viewDenied = isError && error?.status === 403;
  const busy = saveTheme.isPending || saveThresholds.isPending;

  const handleChange = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleThresholdChange = (key, value) =>
    setThresholdsForm((prev) => ({ ...prev, [key]: value }));

  const toggleOpportunityType = (value) => {
    if (!canEdit) return;
    setForm((prev) => {
      const set = new Set(prev.opportunity_types);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, opportunity_types: [...set] };
    });
  };

  const handleSaveTheme = () => {
    if (!orgId) return;
    saveTheme.mutate({
      org_id: orgId,
      sector: form.sector.trim() || null,
      keywords: parsedKeywords,
      geographies: parsedGeographies,
      opportunity_types: form.opportunity_types,
      description: form.description.trim() || null,
      min_aed: numberOrNull(form.min_aed),
      max_aed: numberOrNull(form.max_aed),
      status: form.status,
    });
  };

  const handleSaveThresholds = () => {
    if (!orgId) return;
    const payload = { org_id: orgId };
    for (const field of THRESHOLD_FIELDS) {
      payload[field.key] = numberOrNull(thresholdsForm[field.key]);
    }
    saveThresholds.mutate(payload);
  };

  const selectedOrgName =
    orgOptions.find((org) => org.id === orgId)?.name || currentUser?.org_name || orgId;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header ------------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-teal-600" />
            Investment Theme &amp; Mandate
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Define the sector lens, size band and return hurdles an organisation invests against.
            Approved themes drive opportunity alignment on the server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Badge variant="outline" className="gap-1 bg-teal-50 text-teal-800 border-teal-200">
              <ShieldCheck className="w-3.5 h-3.5" />
              {t("common.admin")}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-600 border-slate-200">
              <Lock className="w-3.5 h-3.5" />
              {t("common.readOnly")}
            </Badge>
          )}
        </div>
      </div>

      {/* Org selector -------------------------------------------------------- */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Building2 className="w-4 h-4 text-slate-500" />
            {t("theme.organisation")}
          </div>
          <div className="w-full sm:w-96">
            <Select value={orgId || undefined} onValueChange={setOrgId}>
              <SelectTrigger aria-label="Organisation">
                <SelectValue placeholder="Select an organisation..." />
              </SelectTrigger>
              <SelectContent>
                {orgOptions.length === 0 && orgId ? (
                  <SelectItem value={orgId}>{selectedOrgName}</SelectItem>
                ) : (
                  orgOptions.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name || org.id}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <span className="text-xs text-slate-500">
            Themes are inherited down the org tree until an org defines its own.
          </span>
        </CardContent>
      </Card>

      {/* Permission / error states ------------------------------------------ */}
      {!isAdmin && (
        <Alert className="border-amber-200 bg-amber-50">
          <Lock className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900">Only admins can edit</AlertTitle>
          <AlertDescription className="text-amber-800">
            You can review this organisation&apos;s theme and mandate thresholds below, but saving
            changes requires an admin role. Ask a group admin to make the update.
          </AlertDescription>
        </Alert>
      )}

      {permissionDenied && isAdmin && (
        <Alert className="border-amber-200 bg-amber-50">
          <Lock className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900">Editing not permitted</AlertTitle>
          <AlertDescription className="text-amber-800">
            The server rejected the last save for this organisation. You can continue to view the
            current theme in read-only mode.
          </AlertDescription>
        </Alert>
      )}

      {viewDenied ? (
        <Alert variant="destructive" className="border-red-200 bg-red-50">
          <Lock className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-900">Theme not available</AlertTitle>
          <AlertDescription className="text-red-900">
            {error?.message || "You do not have permission to view this organisation's theme."}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Theme form ------------------------------------------------------ */}
          <Card className="lg:col-span-3 border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="w-5 h-5 text-teal-600" />
                  {t("theme.definition")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <StatusBadge status={themeFromServer?.status} />
                  {isFetching && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                </div>
              </div>
              <CardDescription>
                {themeFromServer
                  ? "Edit the approved lens this organisation screens opportunities against."
                  : "No theme has been defined for this organisation yet — create one below."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              {isLoading ? (
                <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading theme...
                </div>
              ) : (
                <>
                  {themeFromServer?.status === "approved" && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                      <span>
                        {t("common.approved")}
                        {themeFromServer.approved_by
                          ? " by " + themeFromServer.approved_by
                          : ""}
                        {themeFromServer.approved_at
                          ? " on " + formatDateTime(themeFromServer.approved_at)
                          : ""}
                        .
                      </span>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sector">Sector</Label>
                      <Input
                        id="sector"
                        value={form.sector}
                        disabled={!canEdit}
                        placeholder="e.g. Energy"
                        onChange={(event) => handleChange("sector", event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={form.status}
                        disabled={!canEdit}
                        onValueChange={(value) => handleChange("status", value)}
                      >
                        <SelectTrigger id="status">
                          <SelectValue placeholder="Select status..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="min_aed">Minimum size (AED m)</Label>
                      <Input
                        id="min_aed"
                        type="number"
                        value={form.min_aed}
                        disabled={!canEdit}
                        placeholder="0"
                        onChange={(event) => handleChange("min_aed", event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="max_aed">Maximum size (AED m)</Label>
                      <Input
                        id="max_aed"
                        type="number"
                        value={form.max_aed}
                        disabled={!canEdit}
                        placeholder="0"
                        onChange={(event) => handleChange("max_aed", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="keywords">Keywords</Label>
                    <Input
                      id="keywords"
                      value={form.keywords}
                      disabled={!canEdit}
                      placeholder="e.g. solar, storage, hydrogen"
                      onChange={(event) => handleChange("keywords", event.target.value)}
                    />
                    <p className="text-xs text-slate-500">
                      Comma or space separated. Matched against an opportunity&apos;s name, sector,
                      geography and narrative on the server.
                    </p>
                    <ListPreview values={parsedKeywords} empty="No keywords yet." />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="geographies">Geographies</Label>
                    <Input
                      id="geographies"
                      value={form.geographies}
                      disabled={!canEdit}
                      placeholder="e.g. UAE, GCC, South East Asia"
                      onChange={(event) => handleChange("geographies", event.target.value)}
                    />
                    <p className="text-xs text-slate-500">
                      Comma separated; multi-word names are kept whole.
                    </p>
                    <ListPreview values={parsedGeographies} empty="No geographies yet." />
                  </div>

                  <div className="space-y-2">
                    <Label>Opportunity types</Label>
                    <div className="flex flex-wrap gap-2">
                      {OPPORTUNITY_TYPES.map((type) => {
                        const active = form.opportunity_types.includes(type.value);
                        return (
                          <button
                            key={type.value}
                            type="button"
                            disabled={!canEdit}
                            aria-pressed={active}
                            onClick={() => toggleOpportunityType(type.value)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                              active
                                ? "border-teal-600 bg-teal-50 text-teal-800"
                                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                              !canEdit && "opacity-60 cursor-not-allowed hover:bg-white"
                            )}
                          >
                            {type.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-500">
                      Optional: leave empty to accept any opportunity type.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      rows={4}
                      value={form.description}
                      disabled={!canEdit}
                      placeholder="What this organisation invests in and why."
                      onChange={(event) => handleChange("description", event.target.value)}
                    />
                  </div>

                  <Separator />

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={handleSaveTheme}
                      disabled={!canEdit || busy || !orgId}
                      className="bg-teal-600 hover:bg-teal-700 gap-2"
                      data-testid="save-theme"
                    >
                      {saveTheme.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {form.status === "approved" ? "Save & approve" : "Save theme"}
                    </Button>
                    {!canEdit && <span className="text-sm text-slate-500">Read-only view.</span>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Thresholds panel ----------------------------------------------- */}
          <Card className="lg:col-span-2 border-slate-200 shadow-sm h-fit">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-teal-600" />
                {t("theme.mandateThresholds")}
              </CardTitle>
              <CardDescription>
                The AED floor and return hurdles the alignment engine reports on.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
                <span>
                  {t("theme.notHardCoded")}
                  (REQ-RULE-02/05, REQ-RULE-10). Breaching them raises a non-blocking signal with a
                  reasoned-exception path.
                </span>
              </div>

              {THRESHOLD_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    type="number"
                    step={field.step}
                    value={thresholdsForm[field.key] == null ? "" : thresholdsForm[field.key]}
                    disabled={!canEdit || isLoading}
                    placeholder="0"
                    onChange={(event) => handleThresholdChange(field.key, event.target.value)}
                  />
                  <p className="text-xs text-slate-500">{field.hint}</p>
                </div>
              ))}

              <Separator />

              <Button
                onClick={handleSaveThresholds}
                disabled={!canEdit || busy || !orgId}
                className="w-full bg-teal-600 hover:bg-teal-700 gap-2"
                data-testid="save-thresholds"
              >
                {saveThresholds.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t("theme.saveThresholds")}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
