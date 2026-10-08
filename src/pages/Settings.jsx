import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Settings as SettingsIcon, Save, CheckCircle, AlertCircle, Brain, Lock, Mail, Shield, TrendingUp, RefreshCw, Trash2, ToggleLeft, LayoutGrid, Briefcase, Upload, Download } from "lucide-react";
import { Sparkles } from "lucide-react";
import { Gavel, ShieldAlert, MessageSquare } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import { Globe } from "lucide-react";
import { FileText, Search } from "lucide-react";
import { Target } from "lucide-react";
import { ListChecks } from "lucide-react";
import { ClipboardCheck } from "lucide-react";
import { Link2 } from "lucide-react";
import { Scale } from "lucide-react";
import { navItemEnabled } from '@/lib/features';
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RoutingRulesPanel from "@/components/settings/RoutingRulesPanel";
import ConnectorsPanel from "@/components/settings/ConnectorsPanel";
import MailPanel from "@/components/settings/MailPanel";
import { Badge } from "@/components/ui/badge";

// Human labels for the template-library categories (W5-05 / DOC-06), mirroring
// server/config/templateLibraryData.js so the screen groups like the config.
const TEMPLATE_CATEGORY_LABELS = {
  opportunity: "Opportunity Overview",
  financial: "Financial model",
  governance: "Risk & governance",
};

// Delegation of Authority (W6-02 / WF-08). The RACI parties and codes mirror
// server/config/doaData.js so the editor renders the same matrix the engine
// enforces; the effective values come from the API, not from this list.
const DOA_PARTIES = [
  { key: "deal_lead", label: "Deal Lead" },
  { key: "vertical_head", label: "Vertical Head" },
  { key: "cio", label: "CIO" },
  { key: "ic", label: "Investment Committee" },
  { key: "board", label: "Board" },
];
const DOA_CODES = ["R", "A", "C", "I", "-"];
const DOA_ROLE_OPTIONS = [
  "sirius_deal_lead", "sirius_vertical_head", "cio", "ic_member", "board_member",
];

// Render a checklist item's applicability rule in words (W5-01 / DOC-01).
function formatChecklistRule(rule = {}) {
  const parts = [];
  if (rule.types?.length) parts.push('type is ' + rule.types.join('/'));
  if (rule.exclude_types?.length) parts.push('type is not ' + rule.exclude_types.join('/'));
  if (rule.greenfield_stages?.length) parts.push('greenfield stage is ' + rule.greenfield_stages.join('/'));
  if (rule.exclude_greenfield_stages?.length) parts.push('greenfield stage is not ' + rule.exclude_greenfield_stages.join('/'));
  if (rule.off_budget) parts.push('off approved budget');
  if (rule.in_budget) parts.push('within approved budget');
  if (rule.related_party) parts.push('related party');
  if (rule.cross_border) parts.push('cross-border');
  if (rule.min_commitment_aed != null) parts.push('commitment >= ' + rule.min_commitment_aed + ' AED');
  if (rule.max_commitment_aed != null) parts.push('commitment <= ' + rule.max_commitment_aed + ' AED');
  return parts.length ? parts.join(' and ') : 'always';
}

export default function Settings() {
  const [aiSettings, setAiSettings] = useState({
    base_url: "",
    api_key: "",
    model: "gpt-4",
    enabled: false,
  });

  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  const [featuresOverride, setFeaturesOverride] = useState(null);
  const [featureGroups, setFeatureGroups] = useState([]);
  const [featureSaveSuccess, setFeatureSaveSuccess] = useState(false);

  const [scorecardConfig, setScorecardConfig] = useState(null);
  const [scorecardSaveSuccess, setScorecardSaveSuccess] = useState(false);
  const [qualityConfig, setQualityConfig] = useState(null);
  const [qualitySaveSuccess, setQualitySaveSuccess] = useState(false);
  const [portfolioRegister, setPortfolioRegister] = useState(null);
  const [portfolioSaveSuccess, setPortfolioSaveSuccess] = useState(false);
  const [portfolioImportText, setPortfolioImportText] = useState("");

  // Sirius group mandate (W4-04 / ENT-03).
  const [mandateConfig, setMandateConfig] = useState(null);
  const [mandateSaveSuccess, setMandateSaveSuccess] = useState(false);

  // Document checklist (W5-01 / DOC-01).
  const [checklistConfig, setChecklistConfig] = useState(null);
  const [checklistSaveSuccess, setChecklistSaveSuccess] = useState(false);

  // Document upload policy (W5-02 / DOC-02).
  const [documentPolicyConfig, setDocumentPolicyConfig] = useState(null);
  const [documentPolicySaveSuccess, setDocumentPolicySaveSuccess] = useState(false);

  // Content sufficiency check (W5-03 / DOC-04).
  const [sufficiencyConfig, setSufficiencyConfig] = useState(null);
  const [sufficiencySaveSuccess, setSufficiencySaveSuccess] = useState(false);

  // Data-point to source mapping (W5-04 / DOC-05).
  const [dataSourceConfig, setDataSourceConfig] = useState(null);
  const [dataSourceSaveSuccess, setDataSourceSaveSuccess] = useState(false);
  // Document template library (W5-05 / DOC-06).
  const [templateConfig, setTemplateConfig] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);
  const [templateDownloading, setTemplateDownloading] = useState(null);

  // Decision reason codes (W6-01 / WF-05).
  const [decisionReasonConfig, setDecisionReasonConfig] = useState(null);
  const [decisionReasonSaveSuccess, setDecisionReasonSaveSuccess] = useState(false);

  // Delegation of Authority matrix (W6-02 / WF-08).
  const [doaConfig, setDoaConfig] = useState(null);
  const [doaErrors, setDoaErrors] = useState([]);
  const [doaSaveSuccess, setDoaSaveSuccess] = useState(false);

  // Related-party overlay enforcement (W6-03 / BRD WF-06).
  const [rpConfig, setRpConfig] = useState(null);
  const [rpErrors, setRpErrors] = useState([]);
  const [rpSaveSuccess, setRpSaveSuccess] = useState(false);
  const RP_SIGNOFF_ROLES = ["independent_reviewer", "group_compliance", "cio", "board_member"];
  const RP_SWITCHES = [
    { key: "require_arm_length_documentation", label: "Require an arm's-length basis and evidence" },
    { key: "require_independent_signoff", label: "Require an independent sign-off" },
    { key: "block_decision_without_signoff", label: "Block the Screening Decision without a sign-off" },
    { key: "exclude_conflicted_users", label: "Exclude conflicted users from sign-off and decision" },
  ];

  // Internal vs shared comment visibility (W6-04 / BRD AUD-03). The editor
  // mirrors the shipped validation: the restriction needs at least one
  // subsidiary role, and the subsidiary list must not include a cross-org reader.
  const [cvConfig, setCvConfig] = useState(null);
  const [cvErrors, setCvErrors] = useState([]);
  const [cvSaveSuccess, setCvSaveSuccess] = useState(false);
  const CV_SWITCHES = [
    { key: "restrict_internal_to_group", label: "Restrict internal comments to the group investment layer" },
    { key: "notify_internal_messages", label: "Notify subsidiary roles about internal comments" },
  ];
  const CV_SUBSIDIARY_ROLES = ["subsidiary_deal_lead", "subsidiary_cfo", "subsidiary_ceo", "cluster_head", "opco_signatory"];

  // Hash-chained audit (W6-05 / BRD AUD-01). The editor exposes the on/off
  // switch, the algorithm (sha256 only) and the owner label; the verify action
  // recomputes the whole chain server-side and reports the first break.
  const [acConfig, setAcConfig] = useState(null);
  const [acVerify, setAcVerify] = useState(null);

  // Notification email frequency (W6-07 / BRD NTF-01). Every user controls
  // their own frequency; an admin tunes the group policy.
  const [nfPolicy, setNfPolicy] = useState(null);
  const [nfViewer, setNfViewer] = useState(null);
  const [nfFrequencies, setNfFrequencies] = useState([]);
  const [nfDigest, setNfDigest] = useState(null);
  // Unified admin configuration registry (W8-03 / BRD ADM-01).
  const [adminRegistry, setAdminRegistry] = useState(null);
  const [adminRegistryError, setAdminRegistryError] = useState(null);
  const [adminDomain, setAdminDomain] = useState(null);
  const [adminHistory, setAdminHistory] = useState([]);
  const [adminDomainLoading, setAdminDomainLoading] = useState(false);

  // Bulk import of in-flight opportunities (W8-05 / BRD INTG-03). The operator
  // uploads the tracker, sees the row-level validation report, then loads the
  // importable rows.
  const [importPolicy, setImportPolicy] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importReport, setImportReport] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  // AI governance (W9-01 / NFR-03): the policy, provider register, governed
  // call log and approval roll-up. Read is available to any user; edits are
  // administrator-only and audited server-side.
  const [aiGov, setAiGov] = useState(null);
  const [aiGovLog, setAiGovLog] = useState({ logs: [], status: null });
  const [aiGovBusy, setAiGovBusy] = useState(false);
  const [aiGovNotice, setAiGovNotice] = useState(null);

  // Render a policy extension list as a comma string for the inline editor.
  const policyExtensionsText = (list) => (list || []).join(', ');
  const parseExtensionsText = (text) => String(text || '').split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

  // Entity & strategy library (W4-02 / ENT-02).
  const [strategyConfig, setStrategyConfig] = useState(null);
  const [strategyOrgs, setStrategyOrgs] = useState([]);
  const [strategyOrgId, setStrategyOrgId] = useState("");
  const [strategyDocs, setStrategyDocs] = useState([]);
  const [strategyProfile, setStrategyProfile] = useState(null);
  const [strategyFile, setStrategyFile] = useState(null);
  const [strategyQuery, setStrategyQuery] = useState("");
  const [strategyCitations, setStrategyCitations] = useState(null);
  const [strategyNotice, setStrategyNotice] = useState(null);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';
  const weightTotal = scorecardConfig?.criteria
    ? scorecardConfig.criteria.reduce((t, c) => t + Number(c.weight || 0), 0)
    : 100;
  const qualityWeightTotal = qualityConfig?.components
    ? qualityConfig.components.reduce((t, c) => t + Number(c.weight || 0), 0)
    : 100;

  // Fetch app-wide settings
  const { data: appSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      const settings = await api.entities.AppSettings.list();
      return settings;
    },
    initialData: [],
  });

  useEffect(() => {
    const aiConfig = appSettings.find(s => s.setting_key === 'ai_config');

    if (aiConfig?.setting_value) {
      setAiSettings(aiConfig.setting_value);
    }
  }, [appSettings]);

  // Load the current feature/menu configuration for the Feature Visibility tab.
  useEffect(() => {
    api.features.get().then((cfg) => {
      if (!cfg) return;
      setFeaturesOverride(cfg.features || {});
      setFeatureGroups(cfg.groups || []);
    }).catch(() => {});
  }, []);

  // Load the effective Gate 2 scorecard configuration (W3-08 / SCO-05).
  useEffect(() => {
    api.gate.scorecardConfig().then((res) => {
      if (res?.config) setScorecardConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective quality-score configuration (W3-09 / SCO-01).
  useEffect(() => {
    api.gate.qualityScoreConfig().then((res) => {
      if (res?.config) setQualityConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective portfolio register (W4-01 / ENT-04).
  useEffect(() => {
    api.gate.portfolioRegister().then((res) => {
      if (res?.config) setPortfolioRegister(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective Sirius group mandate (W4-04 / ENT-03).
  useEffect(() => {
    api.gate.mandate().then((res) => {
      if (res?.config) setMandateConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective document checklist (W5-01 / DOC-01).
  useEffect(() => {
    api.gate.checklist().then((res) => {
      if (res?.config) setChecklistConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective document upload policy (W5-02 / DOC-02).
  useEffect(() => {
    api.gate.documentPolicy().then((res) => {
      if (res?.config) setDocumentPolicyConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective content sufficiency configuration (W5-03 / DOC-04).
  useEffect(() => {
    api.gate.sufficiencyConfig().then((res) => {
      if (res?.config) setSufficiencyConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective data-point to source mapping (W5-04 / DOC-05).
  useEffect(() => {
    api.gate.dataSources().then((res) => {
      if (res?.config) setDataSourceConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective document template library (W5-05 / DOC-06).
  useEffect(() => {
    api.gate.templates().then((res) => {
      if (res?.config) setTemplateConfig(res.config);
      if (Array.isArray(res?.templates)) setTemplates(res.templates);
    }).catch(() => {});
  }, []);

  // Load the effective decision reason codes (W6-01 / WF-05).
  useEffect(() => {
    api.gate.decisionReasons().then((res) => {
      if (res?.config) setDecisionReasonConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective Delegation of Authority matrix (W6-02 / WF-08).
  useEffect(() => {
    api.gate.doa().then((res) => {
      if (res?.config) setDoaConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective related-party overlay (W6-03 / BRD WF-06).
  useEffect(() => {
    api.relatedParty.config().then((res) => {
      if (res?.config) setRpConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective comment visibility policy (W6-04 / BRD AUD-03).
  useEffect(() => {
    api.commentVisibility.config().then((res) => {
      if (res?.config) setCvConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the effective hash-chain policy (W6-05 / BRD AUD-01).
  useEffect(() => {
    api.auditChain.config().then((res) => {
      if (res?.config) setAcConfig(res.config);
    }).catch(() => {});
  }, []);

  // Load the notification frequency policy and this user's own choice (W6-07).
  useEffect(() => {
    api.notificationFrequency.config().then((res) => {
      if (res?.config) setNfPolicy(res.config);
      if (res?.viewer) setNfViewer(res.viewer);
      if (Array.isArray(res?.frequencies)) setNfFrequencies(res.frequencies);
    }).catch(() => {});
  }, []);

  // Unified admin configuration registry (W8-03 / BRD ADM-01). Lists every
  // tunable that shapes a screening with its edit route and audited history.
  const selectAdminDomain = (domainKey) => {
    setAdminDomain(domainKey);
    setAdminDomainLoading(true);
    api.adminConfig.history(domainKey)
      .then((res) => setAdminHistory(res?.history || []))
      .catch(() => setAdminHistory([]))
      .finally(() => setAdminDomainLoading(false));
  };

  useEffect(() => {
    if (!isAdmin) return;
    api.adminConfig.registry().then((res) => {
      setAdminRegistry(res);
      setAdminRegistryError(null);
      const first = res?.groups?.[0]?.domains?.[0]?.domain;
      if (first) selectAdminDomain(first);
    }).catch((err) => {
      setAdminRegistryError(err?.message || 'Could not load the configuration registry.');
    });
  }, [isAdmin]);

  // Bulk-import policy (W8-05 / INTG-03): the required columns, row ceiling
  // and importable states the screen explains before a file is chosen.
  useEffect(() => {
    if (!isAdmin) return;
    api.bulkImport.policy().then((res) => setImportPolicy(res || null)).catch(() => setImportPolicy(null));
  }, [isAdmin]);

  const runImportValidate = async () => {
    if (!importFile) { setImportError('Choose a CSV or Excel file first.'); return; }
    setImportBusy(true); setImportError(null); setImportResult(null);
    try {
      const report = await api.bulkImport.validate({ file: importFile });
      setImportReport(report);
    } catch (err) {
      setImportError(err?.data?.report?.message || err?.message || 'Validation failed.');
      if (err?.data?.report) setImportReport(err.data.report);
    } finally { setImportBusy(false); }
  };

  const runImportExecute = async () => {
    if (!importFile) { setImportError('Choose a CSV or Excel file first.'); return; }
    setImportBusy(true); setImportError(null);
    try {
      const result = await api.bulkImport.execute({ file: importFile });
      setImportResult(result);
      setImportReport(result.report || importReport);
    } catch (err) {
      setImportError(err?.data?.report?.message || err?.message || 'Import failed.');
    } finally { setImportBusy(false); }
  };

  // AI governance (W9-01 / NFR-03): load the policy, register and governed-call
  // log. Available read-only to any user so the AI-output label has a source.
  const loadAiGov = () => {
    api.aiGovernance.get().then((res) => setAiGov(res || null)).catch(() => setAiGov(null));
    if (isAdmin) {
      api.aiGovernance.log(25).then((res) => setAiGovLog((s) => ({ ...s, logs: res?.logs || [] }))).catch(() => {});
      api.aiGovernance.logStatus().then((res) => setAiGovLog((s) => ({ ...s, status: res?.status || null }))).catch(() => {});
    }
  };
  useEffect(() => { loadAiGov(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin]);

  const patchAiGov = (patch) => {
    setAiGov((cur) => (cur ? { ...cur, config: { ...cur.config, ...patch } } : cur));
  };

  const setProviderStatus = (id, status) => {
    setAiGov((cur) => {
      if (!cur) return cur;
      const providers = (cur.config.providers || []).map((p) => (p.id === id ? { ...p, approval_status: status } : p));
      return { ...cur, config: { ...cur.config, providers } };
    });
  };

  const saveAiGov = async () => {
    if (!aiGov?.config) return;
    setAiGovBusy(true); setAiGovNotice(null);
    try {
      const res = await api.aiGovernance.update(aiGov.config);
      setAiGov((cur) => ({ ...cur, config: res.config, approval: res.approval }));
      setAiGovNotice({ ok: true, message: 'AI governance saved (revision ' + res.config.revision + ').' });
      if (isAdmin) api.aiGovernance.log(25).then((r) => setAiGovLog((s) => ({ ...s, logs: r?.logs || [] }))).catch(() => {});
    } catch (err) {
      setAiGovNotice({ ok: false, message: err?.data?.errors?.join('; ') || err?.message || 'Save failed.' });
    } finally { setAiGovBusy(false); }
  };

  // Load the strategy indexer shape and the org list for the entity selector
  // (W4-02 / ENT-02), then the documents + profile for the chosen entity.
  useEffect(() => {
    api.strategy.config().then((cfg) => { if (cfg) setStrategyConfig(cfg); }).catch(() => {});
    api.org.organizations().then((rows) => {
      const list = Array.isArray(rows) ? rows : [];
      setStrategyOrgs(list);
      setStrategyOrgId((current) => {
        if (current || !list.length) return current;
        const preferred = list.find((o) => /infinia|finstreet/i.test(o.name)) || list[0];
        return preferred.id;
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!strategyOrgId) return;
    api.strategy.documents(strategyOrgId).then((res) => {
      setStrategyDocs(res?.documents || []);
    }).catch(() => setStrategyDocs([]));
    api.strategy.profile(strategyOrgId).then((res) => {
      setStrategyProfile(res || null);
    }).catch(() => setStrategyProfile(null));
  }, [strategyOrgId, strategyDocs.length]);

  const saveAiMutation = useMutation({
    mutationFn: async (settings) => {
      const user = await api.auth.me();
      const existingSetting = appSettings.find(s => s.setting_key === 'ai_config');
      
      const data = {
        setting_key: 'ai_config',
        setting_value: settings,
        description: 'AI Backend Configuration',
        last_updated_by: user.email
      };

      if (existingSetting) {
        return await api.entities.AppSettings.update(existingSetting.id, data);
      } else {
        return await api.entities.AppSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });


  const saveFeaturesMutation = useMutation({
    mutationFn: (overrides) => api.features.save(overrides),
    onSuccess: (res) => {
      setFeaturesOverride(res.features || {});
      setFeatureSaveSuccess(true);
      setTimeout(() => setFeatureSaveSuccess(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['featureConfig'] });
    },
  });

  const saveScorecardConfigMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveScorecardConfig(cfg),
    onSuccess: (res) => {
      if (res?.config) setScorecardConfig(res.config);
      setScorecardSaveSuccess(true);
      setTimeout(() => setScorecardSaveSuccess(false), 3000);
    },
  });

  const saveQualityConfigMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveQualityScoreConfig(cfg),
    onSuccess: (res) => {
      if (res?.config) setQualityConfig(res.config);
      setQualitySaveSuccess(true);
      setTimeout(() => setQualitySaveSuccess(false), 3000);
    },
  });

  const savePortfolioRegisterMutation = useMutation({
    mutationFn: (cfg) => api.gate.savePortfolioRegister(cfg),
    onSuccess: (res) => {
      if (res?.config) setPortfolioRegister(res.config);
      setPortfolioSaveSuccess(true);
      setTimeout(() => setPortfolioSaveSuccess(false), 3000);
    },
  });

  const importPortfolioRegisterMutation = useMutation({
    mutationFn: (csv) => api.gate.importPortfolioRegister(csv),
    onSuccess: (res) => {
      if (res?.config) setPortfolioRegister(res.config);
      setPortfolioImportText("");
      setPortfolioSaveSuccess(true);
      setTimeout(() => setPortfolioSaveSuccess(false), 3000);
    },
  });

  const saveMandateMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveMandate(cfg),
    onSuccess: (res) => {
      if (res?.config) setMandateConfig(res.config);
      setMandateSaveSuccess(true);
      setTimeout(() => setMandateSaveSuccess(false), 3000);
    },
  });

  const saveChecklistMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveChecklist(cfg),
    onSuccess: (res) => {
      if (res?.config) setChecklistConfig(res.config);
      setChecklistSaveSuccess(true);
      setTimeout(() => setChecklistSaveSuccess(false), 3000);
    },
  });

  const saveDocumentPolicyMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveDocumentPolicy(cfg),
    onSuccess: (res) => {
      if (res?.config) setDocumentPolicyConfig(res.config);
      setDocumentPolicySaveSuccess(true);
      setTimeout(() => setDocumentPolicySaveSuccess(false), 3000);
    },
  });

  const saveSufficiencyMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveSufficiencyConfig(cfg),
    onSuccess: (res) => {
      if (res?.config) setSufficiencyConfig(res.config);
      setSufficiencySaveSuccess(true);
      setTimeout(() => setSufficiencySaveSuccess(false), 3000);
    },
  });

  const saveDataSourceMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveDataSources(cfg),
    onSuccess: (res) => {
      if (res?.config) setDataSourceConfig(res.config);
      setDataSourceSaveSuccess(true);
      setTimeout(() => setDataSourceSaveSuccess(false), 3000);
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveTemplates(cfg),
    onSuccess: (res) => {
      if (res?.config) setTemplateConfig(res.config);
      setTemplateSaveSuccess(true);
      setTimeout(() => setTemplateSaveSuccess(false), 3000);
    },
  });

  const downloadTemplate = async (id) => {
    setTemplateDownloading(id);
    try { await api.gate.downloadTemplate(id); } finally { setTemplateDownloading(null); }
  };

  const saveDecisionReasonMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveDecisionReasons(cfg),
    onSuccess: (res) => {
      if (res?.config) setDecisionReasonConfig(res.config);
      setDecisionReasonSaveSuccess(true);
      setTimeout(() => setDecisionReasonSaveSuccess(false), 3000);
    },
  });

  // Delegation of Authority (W6-02 / WF-08). Validate bands before saving so an
  // overlapping or empty band is caught in the editor, not by the API.
  const validateDoa = (cfg) => {
    const errors = [];
    const tiers = Array.isArray(cfg?.tiers) ? cfg.tiers : [];
    if (!tiers.length) errors.push("At least one ticket band is required.");
    const ranges = [];
    for (const t of tiers) {
      const label = t.label || t.key || "Untitled band";
      if (!t.label || String(t.label).trim() === "") errors.push(label + ": a band needs a label.");
      const min = t.min_aed === null || t.min_aed === undefined || t.min_aed === "" ? null : Number(t.min_aed);
      const max = t.max_aed === null || t.max_aed === undefined || t.max_aed === "" ? null : Number(t.max_aed);
      if (min !== null && (!Number.isFinite(min) || min < 0)) errors.push(label + ": the floor must be a non-negative number.");
      if (max !== null && (!Number.isFinite(max) || max <= 0)) errors.push(label + ": the ceiling must be a positive number.");
      if (min !== null && max !== null && !(max > min)) errors.push(label + ": the ceiling must exceed the floor.");
      if (!Array.isArray(t.decision_roles) || !t.decision_roles.length) errors.push(label + ": name at least one role that may decide.");
      ranges.push({ label, min: min === null ? 0 : min, max: max === null ? Infinity : max });
    }
    const sorted = [...ranges].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].min < sorted[i - 1].max) errors.push("Bands " + sorted[i - 1].label + " and " + sorted[i].label + " overlap.");
    }
    return errors;
  };

  const updateDoaTier = (key, patch) => {
    setDoaConfig((cfg) => {
      if (!cfg) return cfg;
      const next = { ...cfg, tiers: cfg.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)) };
      setDoaErrors(validateDoa(next));
      return next;
    });
  };

  // Related-party overlay (W6-03 / BRD WF-06). The editor mirrors the shipped
  // validation: a sign-off requirement needs at least one sign-off role, and an
  // arm's-length requirement needs at least one accepted basis.
  const updateRpConfig = (patch) => {
    setRpConfig((cfg) => {
      if (!cfg) return cfg;
      const next = { ...cfg, ...patch };
      const errors = [];
      if (next.require_independent_signoff && !(next.signoff_roles || []).length) {
        errors.push("Name at least one role that may give the independent sign-off.");
      }
      if (next.require_arm_length_documentation && !(next.arm_length_bases || []).length) {
        errors.push("Accept at least one arm's-length basis.");
      }
      setRpErrors(errors);
      return next;
    });
  };

  const saveRpMutation = useMutation({
    mutationFn: (cfg) => api.relatedParty.saveConfig(cfg),
    onSuccess: (res) => {
      if (res?.config) setRpConfig(res.config);
      setRpErrors([]);
      setRpSaveSuccess(true);
      setTimeout(() => setRpSaveSuccess(false), 3000);
    },
  });

  // Comment visibility editor (W6-04 / BRD AUD-03).
  const updateCvConfig = (patch) => {
    setCvConfig((cfg) => {
      if (!cfg) return cfg;
      const next = { ...cfg, ...patch };
      const errors = [];
      if (next.restrict_internal_to_group && !(next.subsidiary_roles || []).length) {
        errors.push("Name at least one subsidiary role while the restriction is on.");
      }
      setCvErrors(errors);
      return next;
    });
  };

  const saveCvMutation = useMutation({
    mutationFn: (cfg) => api.commentVisibility.saveConfig(cfg),
    onSuccess: (res) => {
      if (res?.config) setCvConfig(res.config);
      setCvErrors([]);
      setCvSaveSuccess(true);
      setTimeout(() => setCvSaveSuccess(false), 3000);
    },
  });

  // Hash-chain policy editor + on-demand verification (W6-05 / BRD AUD-01).
  const saveAcMutation = useMutation({
    mutationFn: (cfg) => api.auditChain.saveConfig(cfg),
    onSuccess: (res) => { if (res?.config) setAcConfig(res.config); },
  });

  const verifyAcMutation = useMutation({
    mutationFn: () => api.auditChain.verify(),
    onSuccess: (res) => setAcVerify(res?.summary || null),
  });

  // Notification frequency (W6-07 / BRD NTF-01).
  const saveNfPreferenceMutation = useMutation({
    mutationFn: (frequency) => api.notificationFrequency.savePreference(frequency),
    onSuccess: (res) => {
      if (res?.viewer) setNfViewer(res.viewer);
    },
  });

  const saveNfPolicyMutation = useMutation({
    mutationFn: (cfg) => api.notificationFrequency.savePolicy(cfg),
    onSuccess: (res) => { if (res?.config) setNfPolicy(res.config); },
  });

  const loadNfDigestMutation = useMutation({
    mutationFn: () => api.notificationFrequency.digest(),
    onSuccess: (res) => setNfDigest(res || null),
  });

  const saveDoaMutation = useMutation({
    mutationFn: (cfg) => api.gate.saveDoa(cfg),
    onSuccess: (res) => {
      if (res?.config) setDoaConfig(res.config);
      setDoaErrors([]);
      setDoaSaveSuccess(true);
      setTimeout(() => setDoaSaveSuccess(false), 3000);
    },
  });

  const refreshStrategy = async (orgId = strategyOrgId) => {
    if (!orgId) return;
    const [docs, profile] = await Promise.all([
      api.strategy.documents(orgId).catch(() => ({ documents: [] })),
      api.strategy.profile(orgId).catch(() => null),
    ]);
    setStrategyDocs(docs?.documents || []);
    setStrategyProfile(profile);
  };

  const uploadStrategyMutation = useMutation({
    mutationFn: ({ orgId, file }) => api.strategy.uploadDocument(orgId, file),
    onSuccess: (doc) => {
      setStrategyFile(null);
      setStrategyNotice({ ok: true, text: doc?.status === 'indexed'
        ? `Indexed "${doc.original_name}" into ${doc.passage_count} citable passages.`
        : `Stored "${doc.original_name}" (${doc.index_reason || 'not indexable'}).` });
      refreshStrategy();
    },
    onError: (err) => setStrategyNotice({ ok: false, text: err.message || 'Upload failed' }),
  });

  const reindexStrategyMutation = useMutation({
    mutationFn: (id) => api.strategy.reindexDocument(id),
    onSuccess: () => { setStrategyNotice({ ok: true, text: 'Document re-indexed.' }); refreshStrategy(); },
    onError: (err) => setStrategyNotice({ ok: false, text: err.message || 'Reindex failed' }),
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: (id) => api.strategy.deleteDocument(id),
    onSuccess: () => { setStrategyNotice({ ok: true, text: 'Document removed from the strategy library.' }); refreshStrategy(); },
    onError: (err) => setStrategyNotice({ ok: false, text: err.message || 'Delete failed' }),
  });

  const searchStrategyMutation = useMutation({
    mutationFn: ({ orgId, q }) => api.strategy.search(orgId, q),
    onSuccess: (res) => setStrategyCitations(res || null),
    onError: (err) => setStrategyNotice({ ok: false, text: err.message || 'Search failed' }),
  });

  const publishStrategyMutation = useMutation({
    mutationFn: (payload) => api.strategy.publishProfile(payload),
    onSuccess: (profile) => {
      setStrategyNotice({ ok: true, text: `Published strategy profile version ${profile?.version}.` });
      refreshStrategy();
    },
    onError: (err) => setStrategyNotice({ ok: false, text: err.message || 'Publish failed' }),
  });

  const handleSave = () => {
    if (!isAdmin) return;
    saveAiMutation.mutate(aiSettings);
  };


  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const testPrompt = "Respond with 'Connection successful!' if you receive this message.";
      
      const result = await api.integrations.Core.InvokeLLM({
        prompt: testPrompt,
        add_context_from_internet: false,
      });

      setTestResult({
        success: true,
        message: "AI backend connected successfully! Ready to analyze deals."
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error.message || "Failed to connect to AI backend. Please check your settings."
      });
    } finally {
      setTesting(false);
    }
  };


  const handleChange = (field, value) => {
    if (!isAdmin) return;
    setAiSettings(prev => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
    setTestResult(null);
  };






  if (loadingSettings) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-slate-500">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
            <p className="text-slate-600 mt-1">Configure AI analysis and email settings for all users</p>
          </div>
          {!isAdmin && (
            <Badge className="bg-amber-100 text-amber-800">
              <Lock className="w-3 h-3 mr-1" />
              Read Only
            </Badge>
          )}
        </div>

        {!isAdmin && (
          <Alert className="border-blue-200 bg-blue-50">
            <Shield className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <strong>Note:</strong> Only administrators can modify these settings. These configurations apply to all users in the application.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="ai" className="flex flex-col lg:flex-row gap-6 items-start">
          <TabsList className="bg-white border border-slate-200 flex flex-col h-auto w-full lg:w-60 shrink-0 p-2 gap-1 items-stretch lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <TabsTrigger value="ai" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Brain className="w-4 h-4" />
              AI Backend
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Mail className="w-4 h-4" />
              Email & SMTP
            </TabsTrigger>
            <TabsTrigger value="features" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <ToggleLeft className="w-4 h-4" />
              Feature Visibility
            </TabsTrigger>
            <TabsTrigger value="scorecard" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <TrendingUp className="w-4 h-4" />
              Scorecard Config
            </TabsTrigger>
            <TabsTrigger value="quality" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <LayoutGrid className="w-4 h-4" />
              Quality Score
            </TabsTrigger>
            <TabsTrigger value="register" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Briefcase className="w-4 h-4" />
              Portfolio Register
            </TabsTrigger>
            <TabsTrigger value="strategy" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <FileText className="w-4 h-4" />
              Strategy Library
            </TabsTrigger>
            <TabsTrigger value="mandate" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Target className="w-4 h-4" />
              Group Mandate
            </TabsTrigger>
            <TabsTrigger value="checklist" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <ListChecks className="w-4 h-4" />
              Document Checklist
            </TabsTrigger>
            <TabsTrigger value="document-policy" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Shield className="w-4 h-4" />
              Upload Policy
            </TabsTrigger>
            <TabsTrigger value="sufficiency" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <ClipboardCheck className="w-4 h-4" />
              Sufficiency Check
            </TabsTrigger>
            <TabsTrigger value="data-sources" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Link2 className="w-4 h-4" />
              Source Mapping
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <FileText className="w-4 h-4" />
              Template Library
            </TabsTrigger>
            <TabsTrigger value="decision-reasons" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Gavel className="w-4 h-4" />
              Decision Reasons
            </TabsTrigger>
            <TabsTrigger value="delegation" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Scale className="w-4 h-4" />
              Delegation of Authority
            </TabsTrigger>
            <TabsTrigger value="routing" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Scale className="w-4 h-4" />
              Owner &amp; Routing
            </TabsTrigger>
            <TabsTrigger value="connectors" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <LayoutGrid className="w-4 h-4" />
              Connectors &amp; Tools
            </TabsTrigger>
            <TabsTrigger value="related-party" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <ShieldAlert className="w-4 h-4" />
              Related-Party Overlay
            </TabsTrigger>
            <TabsTrigger value="comment-visibility" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <MessageSquare className="w-4 h-4" />
              Comment Visibility
            </TabsTrigger>
            <TabsTrigger value="audit-chain" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Shield className="w-4 h-4" />
              Audit Integrity
            </TabsTrigger>
            <TabsTrigger value="notification-frequency" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Mail className="w-4 h-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="config-registry" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <LayoutGrid className="w-4 h-4" />
              Config Registry
            </TabsTrigger>
            <TabsTrigger value="bulk-import" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Upload className="w-4 h-4" />
              Bulk Import
            </TabsTrigger>
            <TabsTrigger value="ai-governance" className="flex items-center gap-2 w-full justify-start px-3 py-2 text-left">
              <Shield className="w-4 h-4" />
              AI Governance
            </TabsTrigger>
          </TabsList>

          {/* AI Settings Tab */}
          <TabsContent value="ai" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                    <Brain className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>AI Backend Configuration</CardTitle>
                    <CardDescription>
                      OpenAI-compatible API for AI-powered deal analysis (applies to all users)
                    </CardDescription>
                  </div>
                  {appSettings.find(s => s.setting_key === 'ai_config')?.last_updated_by && (
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Last updated by:</p>
                      <p className="text-xs font-medium text-slate-700">
                        {appSettings.find(s => s.setting_key === 'ai_config').last_updated_by}
                      </p>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <SettingsIcon className="w-5 h-5 text-slate-600" />
                    <div>
                      <p className="font-medium text-slate-900">Enable Custom AI Backend</p>
                      <p className="text-sm text-slate-600">Use custom OpenAI-compatible API for all users</p>
                    </div>
                  </div>
                  <Switch
                    checked={aiSettings.enabled}
                    onCheckedChange={(checked) => handleChange("enabled", checked)}
                    disabled={!isAdmin}
                  />
                </div>

                {aiSettings.enabled && (
                  <>
                    <Separator />

                    <Alert className="border-blue-200 bg-blue-50">
                      <AlertCircle className="h-4 w-4 text-blue-600" />
                      <AlertDescription className="text-blue-900">
                        <strong>Supported Backends:</strong> OpenAI API, Azure OpenAI, LocalAI, LM Studio, Ollama (with OpenAI compatibility), or any OpenAI-compatible endpoint
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="base_url" className="flex items-center gap-2">
                          Base URL
                          <span className="text-xs text-slate-500">(e.g., https://api.openai.com/v1 or http://localhost:1234/v1)</span>
                        </Label>
                        <Input
                          id="base_url"
                          value={aiSettings.base_url}
                          onChange={(e) => handleChange("base_url", e.target.value)}
                          placeholder="https://api.openai.com/v1"
                          className="font-mono text-sm"
                          disabled={!isAdmin}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="api_key" className="flex items-center gap-2">
                          <Lock className="w-3 h-3" />
                          API Key
                          <span className="text-xs text-slate-500">(Optional for local models)</span>
                        </Label>
                        <Input
                          id="api_key"
                          type="password"
                          value={aiSettings.api_key}
                          onChange={(e) => handleChange("api_key", e.target.value)}
                          placeholder="sk-..."
                          className="font-mono text-sm"
                          disabled={!isAdmin}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="model" className="flex items-center gap-2">
                          Model Name
                          <span className="text-xs text-slate-500">(e.g., gpt-4, gpt-3.5-turbo, llama2, mistral)</span>
                        </Label>
                        <Input
                          id="model"
                          value={aiSettings.model}
                          onChange={(e) => handleChange("model", e.target.value)}
                          placeholder="gpt-4"
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="flex gap-3">
                      <Button
                        onClick={testConnection}
                        disabled={testing || !aiSettings.base_url}
                        variant="outline"
                        className="flex-1"
                      >
                        {testing ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600 mr-2" />
                            Testing...
                          </>
                        ) : (
                          <>
                            <Brain className="w-4 h-4 mr-2" />
                            Test Connection
                          </>
                        )}
                      </Button>

                      {isAdmin && (
                        <Button
                          onClick={handleSave}
                          disabled={saveAiMutation.isPending}
                          className="flex-1 bg-teal-600 hover:bg-teal-700"
                        >
                          {saveSuccess ? (
                            <>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Saved!
                            </>
                          ) : (
                            <>
                              <Save className="w-4 h-4 mr-2" />
                              Save Settings
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {testResult && (
                      <Alert className={testResult.success ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}>
                        {testResult.success ? (
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                        <AlertDescription className={testResult.success ? "text-emerald-900" : "text-red-900"}>
                          {testResult.message}
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                )}

                {!aiSettings.enabled && (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Brain className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-slate-600">
                      {isAdmin 
                        ? "Enable custom AI backend to use your own models for deal analysis"
                        : "AI backend is currently disabled. Contact an administrator to enable it."}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Email Settings Tab: the in-region SMTP relay is server configuration (NTF-01). */}
          <TabsContent value="email" className="flex-1 min-w-0 mt-0">
            <MailPanel isAdmin={isAdmin} />
          </TabsContent>

          <TabsContent value="features" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-violet-600 rounded-lg flex items-center justify-center">
                    <ToggleLeft className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Feature Visibility</CardTitle>
                    <CardDescription>
                      Enable or disable whole modules / menus across the app for every user.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {!isAdmin && (
                  <Alert className="border-blue-200 bg-blue-50">
                    <Lock className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-900">Only administrators can change feature visibility.</AlertDescription>
                  </Alert>
                )}

                <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-4">
                  {featureGroups.map((group) => {
                    const enabled = group.pages.length === 0 ? false : group.pages.every((pg) => featuresOverride?.[pg] !== false);
                    return (
                      <div key={group.key} className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">{group.label}</div>
                            <div className="text-xs text-slate-500">{group.pages.join(", ")}</div>
                          </div>
                          <Switch
                            checked={enabled}
                            disabled={!isAdmin}
                            onCheckedChange={(checked) => {
                              const next = { ...featuresOverride };
                              group.pages.forEach((pg) => { next[pg] = checked; });
                              setFeaturesOverride(next);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-3 items-center">
                  <Button
                    onClick={() => saveFeaturesMutation.mutate(featuresOverride || {})}
                    disabled={!isAdmin}
                    className="gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save Feature Visibility
                  </Button>
                  {featureSaveSuccess && (
                    <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                      <AlertDescription className="text-emerald-900">Feature configuration saved. The next page load applies it.</AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Scorecard Configuration Tab (W3-08 / SCO-05) */}
          <TabsContent value="scorecard" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Gate 2 Scorecard Configuration</CardTitle>
                    <CardDescription>
                      Recalibrate the seven weighted criteria, the 1-5 pass bar, the lenses and the lens floor. Each saved change mints a new revision; opportunities scored under an earlier revision keep that version.
                    </CardDescription>
                  </div>
                  {scorecardConfig && (
                    <Badge variant="outline" data-testid="scorecard-config-revision">
                      {scorecardConfig.version} (rev {scorecardConfig.revision})
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {!isAdmin && (
                  <Alert className="border-blue-200 bg-blue-50">
                    <Lock className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-900">Only administrators can publish a new scorecard revision.</AlertDescription>
                  </Alert>
                )}

                {scorecardConfig ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Pass bar (1-5)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="1"
                          max="5"
                          value={scorecardConfig.pass_threshold}
                          disabled={!isAdmin}
                          data-testid="scorecard-config-pass-bar"
                          onChange={(e) => setScorecardConfig({ ...scorecardConfig, pass_threshold: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Lens floor (1-5)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="1"
                          max="5"
                          value={scorecardConfig.lens_floor}
                          disabled={!isAdmin}
                          data-testid="scorecard-config-lens-floor"
                          onChange={(e) => setScorecardConfig({ ...scorecardConfig, lens_floor: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Criteria &amp; weights</Label>
                        <Badge
                          variant="outline"
                          className={weightTotal === 100 ? 'text-emerald-700 border-emerald-300' : 'text-red-700 border-red-300'}
                          data-testid="scorecard-config-weight-total"
                        >
                          Total {weightTotal}%
                        </Badge>
                      </div>
                      {scorecardConfig.criteria.map((c, idx) => (
                        <div key={c.key} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex-1 text-sm font-medium text-slate-800">{c.label}</div>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            className="w-24"
                            value={c.weight}
                            disabled={!isAdmin}
                            data-testid={'scorecard-config-weight-' + c.key}
                            onChange={(e) => {
                              const next = scorecardConfig.criteria.map((x, i) => (i === idx ? { ...x, weight: Number(e.target.value) } : x));
                              setScorecardConfig({ ...scorecardConfig, criteria: next });
                            }}
                          />
                          <span className="text-xs text-slate-500">%</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <Label>Lenses</Label>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {scorecardConfig.lenses.map((l) => (
                          <div key={l.key} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="text-sm font-semibold text-slate-800">{l.label}</div>
                            <div className="text-xs text-slate-500">{l.criteria.join(', ')}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 items-center">
                      <Button
                        onClick={() => saveScorecardConfigMutation.mutate({
                          pass_threshold: scorecardConfig.pass_threshold,
                          lens_floor: scorecardConfig.lens_floor,
                          criteria: scorecardConfig.criteria,
                          lenses: scorecardConfig.lenses,
                        })}
                        disabled={!isAdmin || weightTotal !== 100 || saveScorecardConfigMutation.isPending}
                        className="gap-2"
                        data-testid="scorecard-config-save"
                      >
                        <Save className="w-4 h-4" />
                        Save as new revision
                      </Button>
                      {weightTotal !== 100 && (
                        <span className="text-sm text-red-600">Weights must total 100% before saving.</span>
                      )}
                      {scorecardSaveSuccess && (
                        <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">Scorecard configuration saved under a new revision.</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading scorecard configuration...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Quality Score Configuration Tab (W3-09 / SCO-01) */}
          <TabsContent value="quality" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-sky-600 rounded-lg flex items-center justify-center">
                    <LayoutGrid className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Overall Quality Score Configuration</CardTitle>
                    <CardDescription>
                      Recalibrate the component weights and the band thresholds behind the advisory 0-100% pre-screening quality score. Each saved change mints a new revision.
                    </CardDescription>
                  </div>
                  {qualityConfig && (
                    <Badge variant="outline" data-testid="quality-config-revision">
                      {qualityConfig.version} (rev {qualityConfig.revision})
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {!isAdmin && (
                  <Alert className="border-blue-200 bg-blue-50">
                    <Lock className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-900">Only administrators can publish a new quality-score revision.</AlertDescription>
                  </Alert>
                )}

                {qualityConfig ? (
                  <>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Component weights</Label>
                        <Badge
                          variant="outline"
                          className={qualityWeightTotal === 100 ? 'text-emerald-700 border-emerald-300' : 'text-red-700 border-red-300'}
                          data-testid="quality-config-weight-total"
                        >
                          Total {qualityWeightTotal}%
                        </Badge>
                      </div>
                      {qualityConfig.components.map((c, idx) => (
                        <div key={c.key} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex-1 text-sm font-medium text-slate-800">{c.label}</div>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            className="w-24"
                            value={c.weight}
                            disabled={!isAdmin}
                            data-testid={'quality-config-weight-' + c.key}
                            onChange={(e) => {
                              const next = qualityConfig.components.map((x, i) => (i === idx ? { ...x, weight: Number(e.target.value) } : x));
                              setQualityConfig({ ...qualityConfig, components: next });
                            }}
                          />
                          <span className="text-xs text-slate-500">%</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <Label>Bands</Label>
                      <div className="grid sm:grid-cols-3 gap-3">
                        {qualityConfig.bands.map((b, idx) => (
                          <div key={b.key} className="space-y-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="text-sm font-semibold text-slate-800">{b.label}</div>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={b.min}
                              disabled={!isAdmin}
                              data-testid={'quality-config-band-' + b.key}
                              onChange={(e) => {
                                const next = qualityConfig.bands.map((x, i) => (i === idx ? { ...x, min: Number(e.target.value) } : x));
                                setQualityConfig({ ...qualityConfig, bands: next });
                              }}
                            />
                            <div className="text-[11px] text-slate-500">minimum score</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 items-center">
                      <Button
                        onClick={() => saveQualityConfigMutation.mutate({
                          components: qualityConfig.components,
                          bands: qualityConfig.bands,
                        })}
                        disabled={!isAdmin || qualityWeightTotal !== 100 || saveQualityConfigMutation.isPending}
                        className="gap-2"
                        data-testid="quality-config-save"
                      >
                        <Save className="w-4 h-4" />
                        Save as new revision
                      </Button>
                      {qualityWeightTotal !== 100 && (
                        <span className="text-sm text-red-600">Weights must total 100% before saving.</span>
                      )}
                      {qualitySaveSuccess && (
                        <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">Quality-score configuration saved under a new revision.</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading quality-score configuration...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Portfolio Register Tab (W4-01 / ENT-04) */}
          <TabsContent value="register" className="flex-1 min-w-0 mt-0">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5" /> Portfolio Register</CardTitle>
                    <CardDescription>
                      The existing portfolio companies behind the advisory synergy and conflict checks. Each record carries cluster, sector, geography and capability tags (BRD ENT-04). Saving mints a new revision.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="portfolio-register-revision">{portfolioRegister ? portfolioRegister.version : '...'}</Badge>
                    <Badge variant="secondary" data-testid="portfolio-register-count">{portfolioRegister ? portfolioRegister.companies.length : 0} companies</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {portfolioRegister ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <Button asChild variant="outline" size="sm" className="gap-2">
                        <a href={api.gate.portfolioRegisterTemplateUrl()} data-testid="portfolio-register-template" download>
                          <Download className="w-4 h-4" /> Download template (CSV)
                        </a>
                      </Button>
                      <Button
                        onClick={() => savePortfolioRegisterMutation.mutate({ companies: portfolioRegister.companies })}
                        disabled={!isAdmin || savePortfolioRegisterMutation.isPending}
                        className="gap-2"
                        data-testid="portfolio-register-save"
                      >
                        <Save className="w-4 h-4" /> Save as new revision
                      </Button>
                      {!isAdmin && <span className="text-sm text-slate-500">Read-only - administrator role required to change the register.</span>}
                      {portfolioSaveSuccess && (
                        <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">Portfolio register saved under a new revision.</AlertDescription>
                        </Alert>
                      )}
                    </div>
                    <div className="overflow-x-auto border rounded-md" data-testid="portfolio-register-table">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left p-2 font-medium">Company</th>
                            <th className="text-left p-2 font-medium">Cluster</th>
                            <th className="text-left p-2 font-medium">Sector</th>
                            <th className="text-left p-2 font-medium">Geography</th>
                            <th className="text-left p-2 font-medium">Capabilities</th>
                            <th className="text-left p-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolioRegister.companies.map((c) => (
                            <tr key={c.id} data-testid={'portfolio-row-' + c.id} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{c.name}</div>
                                {c.legal_name && <div className="text-xs text-slate-500">{c.legal_name}</div>}
                                {c.source === 'brd_register' && <Badge variant="outline" className="mt-1 text-[10px]">BRD-named</Badge>}
                              </td>
                              <td className="p-2">
                                <select
                                  className="border rounded px-2 py-1 bg-white"
                                  value={c.cluster}
                                  disabled={!isAdmin}
                                  data-testid={'portfolio-cluster-' + c.id}
                                  onChange={(e) => {
                                    const cluster = e.target.value;
                                    setPortfolioRegister((prev) => ({
                                      ...prev,
                                      companies: prev.companies.map((x) => (x.id === c.id ? { ...x, cluster } : x)),
                                    }));
                                  }}
                                >
                                  {(portfolioRegister.clusters || []).map((cl) => (
                                    <option key={cl.key} value={cl.key}>{cl.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-2">{c.sector || <span className="text-amber-600">unset</span>}</td>
                              <td className="p-2">{(c.geographies && c.geographies.length ? c.geographies : [c.geography]).filter(Boolean).join(', ')}</td>
                              <td className="p-2">{(c.capabilities || []).join(', ')}</td>
                              <td className="p-2 capitalize">{c.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {portfolioRegister.disclaimer && <p className="text-xs text-slate-500 mt-3">{portfolioRegister.disclaimer}</p>}
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading portfolio register...</p>
                )}
              </CardContent>
            </Card>

            {isAdmin && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Upload className="w-4 h-4" /> Import register from template</CardTitle>
                  <CardDescription>Paste the CSV template contents (header: name, legal_name, cluster, sector, geography, capabilities, status, note). Capabilities are pipe-separated.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <textarea
                    className="w-full h-40 border rounded-md p-2 font-mono text-xs"
                    placeholder="name,legal_name,cluster,sector,geography,capabilities,status,note"
                    value={portfolioImportText}
                    onChange={(e) => setPortfolioImportText(e.target.value)}
                    data-testid="portfolio-register-import-text"
                  />
                  <Button
                    onClick={() => importPortfolioRegisterMutation.mutate(portfolioImportText)}
                    disabled={!portfolioImportText.trim() || importPortfolioRegisterMutation.isPending}
                    className="gap-2"
                    data-testid="portfolio-register-import"
                  >
                    <Upload className="w-4 h-4" /> Import CSV
                  </Button>
                  {importPortfolioRegisterMutation.isError && (
                    <p className="text-sm text-red-600">Import failed. Check the CSV columns and cluster keys.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>


          {/* Strategy Library Tab (W4-02 / ENT-02) */}
          <TabsContent value="strategy" className="flex-1 min-w-0 mt-0">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Strategy Library</CardTitle>
                    <CardDescription>
                      Upload an entity&apos;s strategy document (PDF, DOCX, PPTX, TXT) to index it into citable passages the
                      alignment engine quotes. The structured profile is versioned; publishing mints a new version (BRD ENT-01/ENT-02).
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="strategy-index-version">{strategyConfig ? strategyConfig.version : '...'}</Badge>
                    <Badge variant="secondary" data-testid="strategy-document-count">{strategyDocs.length} documents</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label className="text-xs text-slate-500">Entity</Label>
                    <select
                      className="border rounded px-2 py-2 bg-white text-sm min-w-[260px]"
                      value={strategyOrgId}
                      data-testid="strategy-org-select"
                      onChange={(e) => { setStrategyOrgId(e.target.value); setStrategyCitations(null); }}
                    >
                      <option value="">Select an entity...</option>
                      {strategyOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">Upload strategy document</Label>
                    <Input
                      type="file"
                      accept=".pdf,.docx,.pptx,.txt,.md"
                      data-testid="strategy-upload-input"
                      onChange={(e) => setStrategyFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <Button
                    onClick={() => strategyOrgId && strategyFile && uploadStrategyMutation.mutate({ orgId: strategyOrgId, file: strategyFile })}
                    disabled={!strategyOrgId || !strategyFile || uploadStrategyMutation.isPending}
                    className="gap-2"
                    data-testid="strategy-upload-button"
                  >
                    <Upload className="w-4 h-4" /> Upload &amp; index
                  </Button>
                </div>

                {strategyNotice && (
                  <Alert className={strategyNotice.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}>
                    {strategyNotice.ok ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                    <AlertDescription data-testid="strategy-notice">{strategyNotice.text}</AlertDescription>
                  </Alert>
                )}

                <div className="overflow-x-auto border rounded-md" data-testid="strategy-document-table">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left p-2 font-medium">Document</th>
                        <th className="text-left p-2 font-medium">Format</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="text-left p-2 font-medium">Passages</th>
                        <th className="text-left p-2 font-medium">Uploaded</th>
                        <th className="text-left p-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategyDocs.map((d) => (
                        <tr key={d.id} data-testid={'strategy-row-' + d.id} className="border-t">
                          <td className="p-2 font-medium">{d.original_name}</td>
                          <td className="p-2 uppercase text-xs">{d.format || '—'}</td>
                          <td className="p-2">
                            <Badge variant={d.status === 'indexed' ? 'default' : 'secondary'}>{d.status}</Badge>
                          </td>
                          <td className="p-2">{d.passage_count ?? 0}</td>
                          <td className="p-2 text-xs text-slate-500">{d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString() : '—'}</td>
                          <td className="p-2">
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" disabled={!isAdmin || reindexStrategyMutation.isPending}
                                data-testid={'strategy-reindex-' + d.id}
                                onClick={() => reindexStrategyMutation.mutate(d.id)}>
                                <RefreshCw className="w-3 h-3" /> Reindex
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-600" disabled={!isAdmin || deleteStrategyMutation.isPending}
                                data-testid={'strategy-delete-' + d.id}
                                onClick={() => deleteStrategyMutation.mutate(d.id)}>
                                <Trash2 className="w-3 h-3" /> Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {strategyDocs.length === 0 && (
                        <tr><td colSpan={6} className="p-4 text-center text-slate-500">No strategy documents for this entity yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[240px]">
                    <Label className="text-xs text-slate-500">Test the citation (alignment engine query)</Label>
                    <Input
                      value={strategyQuery}
                      placeholder="e.g. technology UAE recurring revenue"
                      data-testid="strategy-search-input"
                      onChange={(e) => setStrategyQuery(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" className="gap-2"
                    disabled={!strategyOrgId || !strategyQuery.trim() || searchStrategyMutation.isPending}
                    data-testid="strategy-search-button"
                    onClick={() => searchStrategyMutation.mutate({ orgId: strategyOrgId, q: strategyQuery })}>
                    <Search className="w-4 h-4" /> Search passages
                  </Button>
                </div>
                {strategyCitations && (
                  <div className="border rounded-md p-3 space-y-2" data-testid="strategy-citations">
                    <p className="text-xs text-slate-500">
                      {(strategyCitations.citations || []).length} passage(s) from {strategyCitations.documents || 0} document(s)
                    </p>
                    {(strategyCitations.citations || []).map((c) => (
                      <div key={c.index} className="border-l-2 border-teal-400 pl-3">
                        <p className="text-sm">{c.text}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Score {c.score} · matched: {(c.matched_terms || []).join(', ') || '—'}
                          {c.document_name ? ' · ' + c.document_name : ''}
                        </p>
                      </div>
                    ))}
                    {(strategyCitations.citations || []).length === 0 && (
                      <p className="text-sm text-slate-500">No passages matched that query.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">Versioned strategy profile</CardTitle>
                    <CardDescription>The structured mandate for this entity. Derived from its theme and thresholds; publishing mints a new version.</CardDescription>
                  </div>
                  <Badge variant="outline" data-testid="strategy-profile-version">
                    {strategyProfile?.current ? 'v' + strategyProfile.current.version : 'no version'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {strategyProfile?.derived ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm" data-testid="strategy-profile-derived">
                    <div><span className="text-slate-500">Mission:</span> {strategyProfile.derived.mission || '—'}</div>
                    <div><span className="text-slate-500">Sectors:</span> {(strategyProfile.derived.sectors || []).join(', ') || '—'}</div>
                    <div><span className="text-slate-500">Geographies:</span> {(strategyProfile.derived.geographies || []).join(', ') || '—'}</div>
                    <div><span className="text-slate-500">Focus areas:</span> {(strategyProfile.derived.focus_areas || []).join(', ') || '—'}</div>
                    <div className="md:col-span-2">
                      <span className="text-slate-500">Constraints:</span>{' '}
                      floor AED {strategyProfile.derived.constraints?.floor_aed ?? '—'}, IRR min {strategyProfile.derived.constraints?.equity_irr_min ?? '—'}%, leverage max {strategyProfile.derived.constraints?.leverage_max ?? '—'}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm">Loading profile...</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={!isAdmin || !strategyOrgId || publishStrategyMutation.isPending}
                    data-testid="strategy-publish-button"
                    onClick={() => publishStrategyMutation.mutate({ org_id: strategyOrgId, profile: strategyProfile?.derived || {} })}
                  >
                    <Save className="w-4 h-4" /> Publish new version
                  </Button>
                  {!isAdmin && <span className="text-sm text-slate-500">Read-only - administrator role required to publish.</span>}
                </div>
                {strategyProfile?.history?.length > 0 && (
                  <div className="text-xs text-slate-500" data-testid="strategy-profile-history">
                    Version history: {strategyProfile.history.map((h) => 'v' + h.version).join(', ')}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Group Mandate Tab (W4-04 / ENT-03) */}
          <TabsContent value="mandate" className="flex-1 min-w-0 mt-0">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" /> Group Mandate</CardTitle>
                    <CardDescription>
                      The versioned Sirius investment mandate behind screening - sectors in scope, geographic posture, stage and
                      instrument policy, ticket band and the 1bn-people objective (BRD ENT-03). Saving mints a new revision.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="sirius-mandate-revision">{mandateConfig ? mandateConfig.version : '...'}</Badge>
                    <Badge variant="secondary" data-testid="sirius-mandate-sector-count">{mandateConfig ? mandateConfig.sectors.length : 0} sectors</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {mandateConfig ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <Button
                        onClick={() => saveMandateMutation.mutate({
                          sectors: mandateConfig.sectors,
                          geography: mandateConfig.geography,
                          stages: mandateConfig.stages,
                          instruments: mandateConfig.instruments,
                          ticket: mandateConfig.ticket,
                          objective: mandateConfig.objective,
                          governance: mandateConfig.governance,
                        })}
                        disabled={!isAdmin || saveMandateMutation.isPending}
                        className="gap-2"
                        data-testid="sirius-mandate-save"
                      >
                        <Save className="w-4 h-4" /> Save as new revision
                      </Button>
                      {!isAdmin && <span className="text-sm text-slate-500">Read-only - administrator role required to change the mandate.</span>}
                      {mandateSaveSuccess && (
                        <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">Group mandate saved under a new revision.</AlertDescription>
                        </Alert>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="border rounded-md p-3" data-testid="sirius-mandate-sectors">
                        <div className="text-sm font-medium mb-2">Sectors in scope</div>
                        <div className="flex flex-wrap gap-2">
                          {mandateConfig.sectors.map((s) => (
                            <Badge key={s} variant="outline" className="gap-1">
                              {s}
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="text-slate-400 hover:text-red-600"
                                  data-testid={'sirius-mandate-sector-remove-' + s}
                                  onClick={() => setMandateConfig((prev) => ({ ...prev, sectors: prev.sectors.filter((x) => x !== s) }))}
                                >&times;</button>
                              )}
                            </Badge>
                          ))}
                        </div>
                        {isAdmin && (
                          <div className="mt-3">
                            <Input
                              placeholder="Add a sector and press Enter"
                              data-testid="sirius-mandate-sector-add"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.target.value.trim()) {
                                  const val = e.target.value.trim();
                                  setMandateConfig((prev) => prev.sectors.includes(val) ? prev : ({ ...prev, sectors: [...prev.sectors, val] }));
                                  e.target.value = '';
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="border rounded-md p-3" data-testid="sirius-mandate-geography">
                        <div className="text-sm font-medium mb-2">Core geographies</div>
                        <div className="flex flex-wrap gap-2">
                          {(mandateConfig.geography?.core || []).map((g) => (
                            <Badge key={g} variant="outline" className="gap-1">
                              {g}
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="text-slate-400 hover:text-red-600"
                                  onClick={() => setMandateConfig((prev) => ({ ...prev, geography: { ...prev.geography, core: prev.geography.core.filter((x) => x !== g) } }))}
                                >&times;</button>
                              )}
                            </Badge>
                          ))}
                        </div>
                        {isAdmin && (
                          <div className="mt-3">
                            <Input
                              placeholder="Add a geography and press Enter"
                              data-testid="sirius-mandate-geography-add"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.target.value.trim()) {
                                  const val = e.target.value.trim();
                                  setMandateConfig((prev) => {
                                    const core = prev.geography?.core || [];
                                    return core.includes(val) ? prev : ({ ...prev, geography: { ...prev.geography, core: [...core, val] } });
                                  });
                                  e.target.value = '';
                                }
                              }}
                            />
                          </div>
                        )}
                        <p className="text-xs text-slate-500 mt-3">{mandateConfig.geography?.posture}</p>
                      </div>

                      <div className="border rounded-md p-3" data-testid="sirius-mandate-policy">
                        <div className="text-sm font-medium mb-2">Stage &amp; instruments</div>
                        <div className="text-xs text-slate-500 mb-1">Stages</div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {mandateConfig.stages.map((s) => (
                            <Badge key={s} variant="secondary">{s.replace(/_/g, ' ')}</Badge>
                          ))}
                        </div>
                        <div className="text-xs text-slate-500 mb-1">Instruments</div>
                        <div className="flex flex-wrap gap-2">
                          {mandateConfig.instruments.map((i) => (
                            <Badge key={i} variant="secondary">{i.replace(/_/g, ' ')}</Badge>
                          ))}
                        </div>
                      </div>

                      <div className="border rounded-md p-3" data-testid="sirius-mandate-objective">
                        <div className="text-sm font-medium mb-2">Objective &amp; ticket</div>
                        <p className="text-sm">{mandateConfig.objective?.statement}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Target {mandateConfig.objective?.target_year} · {Number(mandateConfig.objective?.people_by_2030 || 0).toLocaleString()} people
                        </p>
                        <div className="text-sm mt-3">
                          Ticket: {mandateConfig.ticket?.min_aed != null ? mandateConfig.ticket.min_aed : '-'}
                          {mandateConfig.ticket?.max_aed != null ? ' - ' + mandateConfig.ticket.max_aed : '+'} {mandateConfig.ticket?.unit}
                        </div>
                        {mandateConfig.ticket?.note && <p className="text-xs text-amber-600 mt-1">{mandateConfig.ticket.note}</p>}
                      </div>
                    </div>

                    {mandateConfig.governance && (
                      <p className="text-xs text-slate-500 mt-4" data-testid="sirius-mandate-governance">{mandateConfig.governance}</p>
                    )}
                    {mandateConfig.disclaimer && <p className="text-xs text-slate-500 mt-2">{mandateConfig.disclaimer}</p>}
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading group mandate...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Document Checklist Tab (W5-01 / DOC-01) */}
          <TabsContent value="checklist" className="flex-1 min-w-0 mt-0">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5" /> Document Checklist</CardTitle>
                    <CardDescription>
                      The checklist a submission carries, generated from the opportunity type, stage and flags. Each item is
                      mandatory, conditional or optional, and blocks only when it is due and enforced (BRD DOC-01). Editing here
                      needs no code; saving mints a new revision.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="document-checklist-revision">{checklistConfig ? checklistConfig.version : '...'}</Badge>
                    <Badge variant="secondary" data-testid="document-checklist-item-count">{(checklistConfig?.items || []).length} items</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {checklistConfig ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <Button
                        onClick={() => saveChecklistMutation.mutate({
                          items: checklistConfig.items.map((i) => ({ key: i.key, label: i.label, description: i.description, tier: i.tier, enforce: i.enforce, rule: i.rule, sort_order: i.sort_order })),
                          disclaimer: checklistConfig.disclaimer,
                        })}
                        disabled={!isAdmin || saveChecklistMutation.isPending}
                        className="gap-2"
                        data-testid="document-checklist-save"
                      >
                        <Save className="w-4 h-4" /> Save as new revision
                      </Button>
                      {!isAdmin && <span className="text-sm text-slate-500">Read-only - administrator role required to change the checklist.</span>}
                      {checklistSaveSuccess && (
                        <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">Document checklist saved under a new revision.</AlertDescription>
                        </Alert>
                      )}
                    </div>

                    <div className="border rounded-md divide-y" data-testid="document-checklist-items">
                      {checklistConfig.items.map((item, idx) => (
                        <div key={item.key} className="p-3 flex items-start justify-between gap-4" data-testid={'document-checklist-item-' + item.key}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{item.label}</span>
                              <Badge
                                variant={item.tier === 'mandatory' ? 'destructive' : item.tier === 'conditional' ? 'default' : 'outline'}
                                className="text-xs"
                                data-testid={'document-checklist-tier-badge-' + item.key}
                              >{item.tier}</Badge>
                              {item.enforce && <Badge variant="secondary" className="text-xs">blocks</Badge>}
                            </div>
                            <p className="text-xs text-slate-500 mt-1">{item.key}{item.description ? ' - ' + item.description : ''}</p>
                            {item.rule && Object.keys(item.rule).length > 0 && (
                              <p className="text-xs text-slate-400 mt-1">applies when {formatChecklistRule(item.rule)}</p>
                            )}
                          </div>
                          {isAdmin && (
                            <select
                              className="border rounded-md text-sm px-2 py-1"
                              value={item.tier}
                              data-testid={'document-checklist-tier-select-' + item.key}
                              onChange={(e) => {
                                const tier = e.target.value;
                                setChecklistConfig((prev) => ({
                                  ...prev,
                                  items: prev.items.map((x, i) => (i === idx ? { ...x, tier, enforce: tier === 'mandatory' ? true : x.enforce } : x)),
                                }));
                              }}
                            >
                              <option value="mandatory">Mandatory</option>
                              <option value="conditional">Conditional</option>
                              <option value="optional">Optional</option>
                            </select>
                          )}
                        </div>
                      ))}
                    </div>

                    {checklistConfig.disclaimer && <p className="text-xs text-slate-500 mt-4">{checklistConfig.disclaimer}</p>}
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading document checklist...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Upload Policy Tab (W5-02 / DOC-02) */}
          <TabsContent value="document-policy" className="flex-1 min-w-0 mt-0">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" /> Upload Policy</CardTitle>
                    <CardDescription>
                      The document size cap, the accepted file types and the upload virus scan (BRD DOC-02). Every upload is
                      scanned and the previous version is retained, so a submission&apos;s evidence is reproducible. Saving mints a
                      new revision.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="document-policy-revision">{documentPolicyConfig ? documentPolicyConfig.version : '...'}</Badge>
                    <Badge variant="secondary" data-testid="document-policy-max-mb">{documentPolicyConfig ? documentPolicyConfig.max_upload_mb : 0} MB</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {documentPolicyConfig ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <Button
                        onClick={() => saveDocumentPolicyMutation.mutate({
                          max_upload_mb: documentPolicyConfig.max_upload_mb,
                          core_extensions: documentPolicyConfig.core_extensions,
                          legacy_extensions: documentPolicyConfig.legacy_extensions,
                          scan_engine: documentPolicyConfig.scan_engine,
                          require_clean_scan: documentPolicyConfig.require_clean_scan,
                          block_suspicious: documentPolicyConfig.block_suspicious,
                          disclaimer: documentPolicyConfig.disclaimer,
                        })}
                        disabled={!isAdmin || saveDocumentPolicyMutation.isPending}
                        className="gap-2"
                        data-testid="document-policy-save"
                      >
                        <Save className="w-4 h-4" /> Save as new revision
                      </Button>
                      {!isAdmin && <span className="text-sm text-slate-500">Read-only - administrator role required to change the policy.</span>}
                      {documentPolicySaveSuccess && (
                        <Alert className="border-emerald-200 bg-emerald-50 flex-1">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">Upload policy saved under a new revision.</AlertDescription>
                        </Alert>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="border rounded-md p-3" data-testid="document-policy-size">
                        <div className="text-sm font-medium mb-2">Size cap</div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            className="max-w-[120px]"
                            value={documentPolicyConfig.max_upload_mb}
                            disabled={!isAdmin}
                            data-testid="document-policy-max-input"
                            onChange={(e) => setDocumentPolicyConfig((p) => ({ ...p, max_upload_mb: Number(e.target.value) }))}
                          />
                          <span className="text-sm text-slate-500">MB per file</span>
                        </div>
                      </div>

                      <div className="border rounded-md p-3" data-testid="document-policy-scan">
                        <div className="text-sm font-medium mb-2">Virus scan</div>
                        <select
                          className="border rounded-md text-sm px-2 py-1"
                          value={documentPolicyConfig.scan_engine}
                          disabled={!isAdmin}
                          data-testid="document-policy-scan-engine"
                          onChange={(e) => setDocumentPolicyConfig((p) => ({ ...p, scan_engine: e.target.value }))}
                        >
                          <option value="builtin">Built-in heuristic</option>
                          <option value="external">External command</option>
                        </select>
                        <label className="flex items-center gap-2 text-sm mt-3">
                          <input
                            type="checkbox"
                            checked={documentPolicyConfig.require_clean_scan}
                            disabled={!isAdmin}
                            data-testid="document-policy-require-clean"
                            onChange={(e) => setDocumentPolicyConfig((p) => ({ ...p, require_clean_scan: e.target.checked }))}
                          />
                          Require a clean scan before an upload is stored
                        </label>
                        <label className="flex items-center gap-2 text-sm mt-2">
                          <input
                            type="checkbox"
                            checked={documentPolicyConfig.block_suspicious}
                            disabled={!isAdmin}
                            data-testid="document-policy-block-suspicious"
                            onChange={(e) => setDocumentPolicyConfig((p) => ({ ...p, block_suspicious: e.target.checked }))}
                          />
                          Also block suspicious files
                        </label>
                      </div>

                      <div className="border rounded-md p-3" data-testid="document-policy-types">
                        <div className="text-sm font-medium mb-2">Accepted types</div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {[...documentPolicyConfig.core_extensions, ...documentPolicyConfig.legacy_extensions].map((ext) => (
                            <Badge key={ext} variant={documentPolicyConfig.core_extensions.includes(ext) ? 'default' : 'outline'}>{ext}</Badge>
                          ))}
                        </div>
                        {isAdmin && (
                          <div className="space-y-2">
                            <div>
                              <div className="text-xs text-slate-500 mb-1">Core types (always accepted)</div>
                              <Input
                                value={policyExtensionsText(documentPolicyConfig.core_extensions)}
                                data-testid="document-policy-core-input"
                                onChange={(e) => setDocumentPolicyConfig((p) => ({ ...p, core_extensions: parseExtensionsText(e.target.value) }))}
                              />
                            </div>
                            <div>
                              <div className="text-xs text-slate-500 mb-1">Legacy types (empty to enforce the core set only)</div>
                              <Input
                                value={policyExtensionsText(documentPolicyConfig.legacy_extensions)}
                                data-testid="document-policy-legacy-input"
                                onChange={(e) => setDocumentPolicyConfig((p) => ({ ...p, legacy_extensions: parseExtensionsText(e.target.value) }))}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {documentPolicyConfig.disclaimer && <p className="text-xs text-slate-500 mt-4">{documentPolicyConfig.disclaimer}</p>}
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading upload policy...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sufficiency" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center">
                      <ClipboardCheck className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Content Sufficiency Check</CardTitle>
                      <CardDescription>
                        Advisory rules that flag thin content (a missing cash flow, fewer years of
                        history than the policy expects, no downside case). Flags never block a
                        submission; a reviewer resolves them or records a reason.
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="sufficiency-revision">{sufficiencyConfig ? sufficiencyConfig.version : "..."}</Badge>
                    <Badge variant="secondary" data-testid="sufficiency-min-years">{sufficiencyConfig ? sufficiencyConfig.min_history_years : 0} yrs</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {sufficiencyConfig ? (
                  <>
                    <div className="flex justify-end mb-4">
                      <Button
                        onClick={() => saveSufficiencyMutation.mutate({
                          min_history_years: sufficiencyConfig.min_history_years,
                          rules: sufficiencyConfig.rules,
                        })}
                        disabled={!isAdmin || saveSufficiencyMutation.isPending}
                        data-testid="sufficiency-save"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveSufficiencyMutation.isPending ? "Saving..." : "Save revision"}
                      </Button>
                    </div>
                    {sufficiencySaveSuccess && (
                      <Alert className="mb-4 border-emerald-200 bg-emerald-50">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">Sufficiency check saved as a new revision.</AlertDescription>
                      </Alert>
                    )}
                    <div className="border rounded-md p-3 mb-4" data-testid="sufficiency-min-years-input-wrap">
                      <Label htmlFor="sufficiency-min-years-input">Minimum years of actual history</Label>
                      <Input
                        id="sufficiency-min-years-input"
                        type="number"
                        min={1}
                        max={10}
                        className="mt-2 max-w-[8rem]"
                        value={sufficiencyConfig.min_history_years}
                        onChange={(e) => setSufficiencyConfig({ ...sufficiencyConfig, min_history_years: Number(e.target.value) })}
                        data-testid="sufficiency-min-years-input"
                      />
                    </div>
                    <div className="border rounded-md p-3" data-testid="sufficiency-rules">
                      <Label className="text-sm font-medium">Advisory rules</Label>
                      <div className="mt-2 space-y-2">
                        {sufficiencyConfig.rules.map((rule) => (
                          <div key={rule.key} className="flex items-center justify-between border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                            <div>
                              <div className="text-sm font-medium flex items-center gap-2">
                                {rule.label}
                                <Badge variant="outline" className="text-[10px]">{rule.category}</Badge>
                              </div>
                              <div className="text-xs text-slate-500">{rule.key}</div>
                            </div>
                            <Switch
                              checked={rule.enabled}
                              onCheckedChange={(v) => setSufficiencyConfig({
                                ...sufficiencyConfig,
                                rules: sufficiencyConfig.rules.map((r) => (r.key === rule.key ? { ...r, enabled: v } : r)),
                              })}
                              data-testid={"sufficiency-rule-" + rule.key}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                      The content sufficiency check is advisory. It flags thin content for a person to
                      resolve or override with a reason; it never blocks a submission.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading sufficiency check...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data-sources" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-700 rounded-lg flex items-center justify-center">
                      <Link2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Data-point Source Mapping</CardTitle>
                      <CardDescription>
                        Where each memo value came from. Every data point is linked to the artefact
                        or captured field behind it, so a reviewer can open the source. Provenance
                        only: it never changes a value or blocks a submission.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="data-source-revision">{dataSourceConfig ? dataSourceConfig.version : "..."}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {dataSourceConfig ? (
                  <>
                    <div className="flex justify-end mb-4">
                      <Button
                        onClick={() => saveDataSourceMutation.mutate({ links: dataSourceConfig.links })}
                        disabled={!isAdmin || saveDataSourceMutation.isPending}
                        data-testid="data-source-save"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveDataSourceMutation.isPending ? "Saving..." : "Save revision"}
                      </Button>
                    </div>
                    {dataSourceSaveSuccess && (
                      <Alert className="mb-4 border-emerald-200 bg-emerald-50">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">Source mapping saved as a new revision.</AlertDescription>
                      </Alert>
                    )}
                    <div className="border rounded-md p-3" data-testid="data-source-links">
                      <div className="grid grid-cols-[1.4fr_0.9fr_1.1fr] gap-2 text-xs font-semibold text-slate-500 pb-2 border-b border-slate-100">
                        <span>Memo data point</span>
                        <span>Source type</span>
                        <span>Source reference</span>
                      </div>
                      <div className="space-y-2 mt-2">
                        {dataSourceConfig.links.map((link) => (
                          <div key={link.target} className="grid grid-cols-[1.4fr_0.9fr_1.1fr] gap-2 items-center" data-testid={"data-source-row-" + link.target}>
                            <div>
                              <div className="text-sm font-medium">{link.target_label}</div>
                              <div className="text-[11px] text-slate-500">{link.target} · {link.page}</div>
                            </div>
                            <select
                              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
                              value={link.source_type}
                              onChange={(e) => setDataSourceConfig({
                                ...dataSourceConfig,
                                links: dataSourceConfig.links.map((l) => (l.target === link.target ? { ...l, source_type: e.target.value } : l)),
                              })}
                              data-testid={"data-source-type-" + link.target}
                            >
                              <option value="field">field</option>
                              <option value="document">document</option>
                              <option value="derived">derived</option>
                              <option value="external">external</option>
                            </select>
                            <Input
                              className="h-9 text-xs"
                              value={link.source_ref}
                              onChange={(e) => setDataSourceConfig({
                                ...dataSourceConfig,
                                links: dataSourceConfig.links.map((l) => (l.target === link.target ? { ...l, source_ref: e.target.value } : l)),
                              })}
                              data-testid={"data-source-ref-" + link.target}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                      The data-point source mapping is provenance only. It shows where each memo value
                      came from and lets a reviewer open the linked source; it never changes a value or
                      blocks a submission.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading source mapping...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="flex-1 min-w-0 mt-0">
                      <Card className="border-slate-200 shadow-sm" data-testid="template-library-card">
                        <CardHeader className="border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-lg flex items-center justify-center">
                                <FileText className="w-5 h-5 text-white" />
                              </div>
                              <div>
                                <CardTitle className="text-lg">Document Template Library</CardTitle>
                                <CardDescription>
                                  The standard submission templates maintained by the Investment Team. Each is
                                  downloadable in its current version. Guidance only: a download never changes an
                                  opportunity and never blocks a submission.
                                </CardDescription>
                              </div>
                            </div>
                            <Badge variant="outline" data-testid="template-revision">{templateConfig ? templateConfig.version : "..."}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                          {templateConfig ? (
                            <>
                              <div className="flex justify-end mb-4">
                                <Button
                                  onClick={() => saveTemplateMutation.mutate({ templates: templateConfig.templates })}
                                  disabled={!isAdmin || saveTemplateMutation.isPending}
                                  data-testid="template-save"
                                >
                                  <Save className="w-4 h-4 mr-2" />
                                  {saveTemplateMutation.isPending ? "Saving..." : "Save revision"}
                                </Button>
                              </div>
                              {templateSaveSuccess && (
                                <Alert className="mb-4 border-emerald-200 bg-emerald-50">
                                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                                  <AlertDescription className="text-emerald-800">Template library saved as a new revision.</AlertDescription>
                                </Alert>
                              )}
                              <div className="space-y-4" data-testid="template-list">
                                {templates.map((tpl) => (
                                  <div
                                    key={tpl.id}
                                    className="border rounded-md p-4 flex items-start justify-between gap-4"
                                    data-testid={"template-row-" + tpl.id}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold">{tpl.label}</span>
                                        <Badge variant="secondary" className="text-[10px] uppercase">{tpl.format}</Badge>
                                        <span className="text-[11px] text-slate-500">{TEMPLATE_CATEGORY_LABELS[tpl.category] || tpl.category}</span>
                                        {tpl.maintained && <Badge variant="outline" className="text-[10px]">maintained</Badge>}
                                      </div>
                                      <p className="text-xs text-slate-600 mt-1">{tpl.description}</p>
                                      <p className="text-[11px] text-slate-400 mt-1">
                                        Owner: {tpl.owner} · File: {tpl.filename} · Version: {tpl.version}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {isAdmin && (
                                        <Switch
                                          checked={tpl.enabled !== false}
                                          onCheckedChange={(checked) => {
                                            setTemplateConfig({
                                              ...templateConfig,
                                              templates: templateConfig.templates.map((t) =>
                                                t.id === tpl.id ? { ...t, enabled: checked } : t
                                              ),
                                            });
                                          }}
                                          data-testid={"template-enabled-" + tpl.id}
                                        />
                                      )}
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => downloadTemplate(tpl.id)}
                                        disabled={templateDownloading === tpl.id}
                                        data-testid={"template-download-" + tpl.id}
                                      >
                                        <Download className="w-4 h-4 mr-1" />
                                        {templateDownloading === tpl.id ? "Preparing..." : "Download"}
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-slate-500 mt-4">
                                Current versions are downloaded on demand and rendered from the same configuration the
                                memo, financials grid and qualifying gates use, so a template can never drift from the
                                rules the system enforces.
                              </p>
                            </>
                          ) : (
                            <p className="text-slate-500 text-sm">Loading template library...</p>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

          <TabsContent value="decision-reasons" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="decision-reasons-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-700 rounded-lg flex items-center justify-center">
                      <Gavel className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Decision Reason Codes</CardTitle>
                      <CardDescription>
                        The reason codes Investment Team reviewers pick when they approve, return, decline or
                        withdraw an opportunity. Every decision carries a code, so declines are comparable across
                        mandates. Declines always require free-text detail.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="decision-reason-revision">
                    {decisionReasonConfig ? decisionReasonConfig.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {decisionReasonConfig ? (
                  <>
                    <div className="flex justify-end mb-4">
                      <Button
                        onClick={() => saveDecisionReasonMutation.mutate({ classes: decisionReasonConfig.classes })}
                        disabled={!isAdmin || saveDecisionReasonMutation.isPending}
                        data-testid="decision-reason-save"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveDecisionReasonMutation.isPending ? "Saving..." : "Save revision"}
                      </Button>
                    </div>
                    {decisionReasonSaveSuccess && (
                      <Alert className="mb-4 border-emerald-200 bg-emerald-50">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">Decision reason codes saved as a new revision.</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-4" data-testid="decision-reason-classes">
                      {decisionReasonConfig.classes.map((cls) => (
                        <div key={cls.key} className="border rounded-md p-4" data-testid={"decision-class-" + cls.key}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{cls.label}</span>
                                {cls.require_text && (
                                  <Badge variant="secondary" className="text-[10px]">free text required</Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 mt-1">{cls.description}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <label className="flex items-center gap-2 text-xs text-slate-500">
                                Require text
                                <Switch
                                  checked={cls.require_text === true}
                                  disabled={!isAdmin}
                                  onCheckedChange={(checked) => {
                                    setDecisionReasonConfig({
                                      ...decisionReasonConfig,
                                      classes: decisionReasonConfig.classes.map((c) =>
                                        c.key === cls.key ? { ...c, require_text: checked } : c
                                      ),
                                    });
                                  }}
                                  data-testid={"decision-class-require-text-" + cls.key}
                                />
                              </label>
                              <Switch
                                checked={cls.enabled !== false}
                                disabled={!isAdmin}
                                onCheckedChange={(checked) => {
                                  setDecisionReasonConfig({
                                    ...decisionReasonConfig,
                                    classes: decisionReasonConfig.classes.map((c) =>
                                      c.key === cls.key ? { ...c, enabled: checked } : c
                                    ),
                                  });
                                }}
                                data-testid={"decision-class-enabled-" + cls.key}
                              />
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {cls.reasons.map((reason) => (
                              <div
                                key={reason.id}
                                className="flex items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50/50 px-3 py-2"
                                data-testid={"decision-reason-" + cls.key + "-" + reason.id}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium">{reason.label}</span>
                                    {reason.counts_as_decline && (
                                      <Badge variant="outline" className="text-[9px] uppercase">decline comparable</Badge>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-500 truncate">{reason.description}</p>
                                </div>
                                <Switch
                                  checked={reason.enabled !== false}
                                  disabled={!isAdmin}
                                  onCheckedChange={(checked) => {
                                    setDecisionReasonConfig({
                                      ...decisionReasonConfig,
                                      classes: decisionReasonConfig.classes.map((c) =>
                                        c.key === cls.key
                                          ? {
                                              ...c,
                                              reasons: c.reasons.map((r) =>
                                                r.id === reason.id ? { ...r, enabled: checked } : r
                                              ),
                                            }
                                          : c
                                      ),
                                    });
                                  }}
                                  data-testid={"decision-reason-enabled-" + cls.key + "-" + reason.id}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                      A move to returned, declined or withdrawn, and any stage that demands a rationale, cannot be
                      saved without a reason code. The code and its free text are written to the opportunity, the
                      transition and workflow events, and the immutable audit trail.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading decision reason codes...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="connectors" className="flex-1 min-w-0 mt-0">
            <ConnectorsPanel />
          </TabsContent>

          <TabsContent value="routing" className="flex-1 min-w-0 mt-0">
            <RoutingRulesPanel />
          </TabsContent>

          <TabsContent value="delegation" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="doa-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-lg flex items-center justify-center">
                      <Scale className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Delegation of Authority</CardTitle>
                      <CardDescription>
                        For each Gate-1 ticket band, who is responsible (R), accountable (A), consulted (C) or
                        informed (I), and which roles may actually take the screening decision. The decision is
                        refused to everyone else, so the RACI matrix is enforced, not just documented.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="doa-revision">
                    {doaConfig ? doaConfig.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {doaConfig ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-slate-500">
                        Bands are contiguous in AED mn: a floor is inclusive and a ceiling exclusive.
                      </p>
                      <Button
                        onClick={() => saveDoaMutation.mutate({ tiers: doaConfig.tiers })}
                        disabled={!isAdmin || doaErrors.length > 0 || saveDoaMutation.isPending}
                        data-testid="doa-save"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveDoaMutation.isPending ? "Saving..." : "Save revision"}
                      </Button>
                    </div>
                    {doaErrors.length > 0 && (
                      <Alert variant="destructive" className="mb-4" data-testid="doa-validation">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <ul className="list-disc pl-4">
                            {doaErrors.map((e) => (<li key={e}>{e}</li>))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                    {doaSaveSuccess && (
                      <Alert className="mb-4 border-emerald-200 bg-emerald-50" data-testid="doa-saved">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">Delegation of Authority saved as a new revision.</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-4" data-testid="doa-tiers">
                      {doaConfig.tiers.map((tier) => (
                        <div key={tier.key} className="border rounded-md p-4" data-testid={"doa-tier-" + tier.key}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">{tier.label}</span>
                                <Badge variant="secondary" className="text-[10px] uppercase">{tier.key}</Badge>
                              </div>
                              <p className="text-xs text-slate-600 mt-1">{tier.description}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div>
                                <Label className="text-[10px] uppercase text-slate-500">Floor (AED mn)</Label>
                                <Input
                                  className="w-24 h-8"
                                  type="number"
                                  value={tier.min_aed === null || tier.min_aed === undefined ? "" : tier.min_aed}
                                  disabled={!isAdmin}
                                  onChange={(e) => updateDoaTier(tier.key, { min_aed: e.target.value === "" ? null : Number(e.target.value) })}
                                  data-testid={"doa-min-" + tier.key}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase text-slate-500">Ceiling</Label>
                                <Input
                                  className="w-24 h-8"
                                  type="number"
                                  placeholder="open"
                                  value={tier.max_aed === null || tier.max_aed === undefined ? "" : tier.max_aed}
                                  disabled={!isAdmin}
                                  onChange={(e) => updateDoaTier(tier.key, { max_aed: e.target.value === "" ? null : Number(e.target.value) })}
                                  data-testid={"doa-max-" + tier.key}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-5">
                            {DOA_PARTIES.map((party) => (
                              <div key={party.key} className="flex flex-col gap-1">
                                <Label className="text-[10px] text-slate-500">{party.label}</Label>
                                <select
                                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                                  value={tier.responsibilities?.[party.key] || "-"}
                                  disabled={!isAdmin}
                                  onChange={(e) => updateDoaTier(tier.key, {
                                    responsibilities: { ...tier.responsibilities, [party.key]: e.target.value },
                                  })}
                                  data-testid={"doa-raci-" + tier.key + "-" + party.key}
                                >
                                  {DOA_CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
                                </select>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3">
                            <Label className="text-[10px] uppercase text-slate-500">Roles delegated this decision</Label>
                            <div className="mt-1 flex flex-wrap gap-3">
                              {DOA_ROLE_OPTIONS.map((role) => {
                                const checked = (tier.decision_roles || []).includes(role);
                                return (
                                  <label key={role} className="flex items-center gap-2 text-xs text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!isAdmin}
                                      onChange={(e) => {
                                        const set = new Set(tier.decision_roles || []);
                                        if (e.target.checked) set.add(role); else set.delete(role);
                                        updateDoaTier(tier.key, { decision_roles: [...set] });
                                      }}
                                      data-testid={"doa-role-" + tier.key + "-" + role}
                                    />
                                    {role}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                      The Gate-1 decision - moving a screened item to Gate 2 or declining it - is reserved to the
                      roles a band names. The band, its RACI row and the deciding user are stamped on the record and
                      written to the audit trail.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading the Delegation of Authority matrix...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="related-party" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="rp-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-700 rounded-lg flex items-center justify-center">
                      <ShieldAlert className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Related-Party / Affiliate Overlay</CardTitle>
                      <CardDescription>
                        How a flagged deal is cleared for the Gate-1 Screening Decision: a written arm&apos;s-length
                        basis, an independent sign-off by a delegated role, and the exclusion of anyone conflicted
                        with the deal.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="rp-revision">
                    {rpConfig ? rpConfig.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {rpConfig ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-slate-500">
                        A flagged deal cannot reach the Screening Decision without the requirements switched on below.
                      </p>
                      <Button
                        onClick={() => saveRpMutation.mutate({ ...rpConfig })}
                        disabled={!isAdmin || rpErrors.length > 0 || saveRpMutation.isPending}
                        data-testid="rp-config-save"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveRpMutation.isPending ? "Saving..." : "Save revision"}
                      </Button>
                    </div>
                    {rpErrors.length > 0 && (
                      <Alert variant="destructive" className="mb-4" data-testid="rp-validation">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <ul className="list-disc pl-4">
                            {rpErrors.map((e) => (<li key={e}>{e}</li>))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                    {rpSaveSuccess && (
                      <Alert className="mb-4 border-emerald-200 bg-emerald-50" data-testid="rp-saved">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">Related-party overlay saved as a new revision.</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      {RP_SWITCHES.map((sw) => (
                        <div key={sw.key} className="flex items-center justify-between border rounded-md p-3" data-testid={"rp-switch-" + sw.key}>
                          <div>
                            <p className="text-sm font-medium">{sw.label}</p>
                            <p className="text-xs text-slate-500">{sw.key}</p>
                          </div>
                          <Switch
                            checked={rpConfig[sw.key] !== false}
                            disabled={!isAdmin}
                            onCheckedChange={(checked) => updateRpConfig({ [sw.key]: checked })}
                            data-testid={"rp-toggle-" + sw.key}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-5">
                      <Label className="text-xs uppercase text-slate-500">Roles that may give the independent sign-off</Label>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {RP_SIGNOFF_ROLES.map((role) => {
                          const checked = (rpConfig.signoff_roles || []).includes(role);
                          return (
                            <label key={role} className="flex items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!isAdmin}
                                onChange={(e) => {
                                  const set = new Set(rpConfig.signoff_roles || []);
                                  if (e.target.checked) set.add(role); else set.delete(role);
                                  updateRpConfig({ signoff_roles: [...set] });
                                }}
                                data-testid={"rp-signoff-role-" + role}
                              />
                              {role}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-5">
                      <Label className="text-xs uppercase text-slate-500">Accepted arm&apos;s-length bases</Label>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {(rpConfig.arm_length_bases || []).length === 0 && (
                          <span className="text-xs text-slate-400">No bases accepted.</span>
                        )}
                        {(rpConfig.arm_length_bases || []).map((key) => (
                          <Badge key={key} variant="secondary" className="text-[10px]">{key}</Badge>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-5">
                      On a flagged deal the overlay records the disclosure, the arm&apos;s-length basis and its evidence,
                      and the conflicted users. The independent sign-off and the screening decision are refused to a
                      conflicted user, and the applied overlay is stamped on the record and written to the audit trail.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading the related-party overlay...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comment-visibility" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="cv-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-700 rounded-lg flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Internal vs Shared Comments</CardTitle>
                      <CardDescription>
                        Which clarification comments the group investment team may keep internal. An internal
                        comment is filtered out of every read and every notification for a subsidiary-only user,
                        so the restriction is enforced server-side, not in the client.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="cv-revision">
                    {cvConfig ? cvConfig.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {cvConfig ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-slate-500">
                        A subsidiary-only user never sees an internal thread or message, and is never notified about one.
                      </p>
                      <Button
                        onClick={() => saveCvMutation.mutate({ ...cvConfig })}
                        disabled={!isAdmin || cvErrors.length > 0 || saveCvMutation.isPending}
                        data-testid="cv-config-save"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveCvMutation.isPending ? "Saving..." : "Save revision"}
                      </Button>
                    </div>
                    {cvErrors.length > 0 && (
                      <Alert variant="destructive" className="mb-4" data-testid="cv-validation">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <ul className="list-disc pl-4">
                            {cvErrors.map((e) => (<li key={e}>{e}</li>))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                    {cvSaveSuccess && (
                      <Alert className="mb-4 border-emerald-200 bg-emerald-50" data-testid="cv-saved">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">Comment visibility policy saved as a new revision.</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      {CV_SWITCHES.map((sw) => (
                        <div key={sw.key} className="flex items-center justify-between border rounded-md p-3" data-testid={"cv-switch-" + sw.key}>
                          <div>
                            <p className="text-sm font-medium">{sw.label}</p>
                            <p className="text-xs text-slate-500">{sw.key}</p>
                          </div>
                          <Switch
                            checked={cvConfig[sw.key] !== false}
                            disabled={!isAdmin}
                            onCheckedChange={(checked) => updateCvConfig({ [sw.key]: checked })}
                            data-testid={"cv-toggle-" + sw.key}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-5">
                      <Label className="text-xs uppercase text-slate-500">Roles treated as the subsidiary layer</Label>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {CV_SUBSIDIARY_ROLES.map((role) => {
                          const checked = (cvConfig.subsidiary_roles || []).includes(role);
                          return (
                            <label key={role} className="flex items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!isAdmin}
                                onChange={(e) => {
                                  const set = new Set(cvConfig.subsidiary_roles || []);
                                  if (e.target.checked) set.add(role); else set.delete(role);
                                  updateCvConfig({ subsidiary_roles: [...set] });
                                }}
                                data-testid={"cv-role-" + role}
                              />
                              {role}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-5">
                      <Label className="text-xs uppercase text-slate-500">Default visibility for a new comment</Label>
                      <div className="mt-1 flex gap-2">
                        {["shared", "internal"].map((v) => (
                          <Button
                            key={v}
                            size="sm"
                            variant={cvConfig.default_message_visibility === v ? "default" : "outline"}
                            disabled={!isAdmin}
                            onClick={() => updateCvConfig({ default_message_visibility: v, default_thread_visibility: v })}
                            data-testid={"cv-default-" + v}
                          >
                            {v}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-5">
                      A thread marked internal (and every reply on it) is hidden from a subsidiary-only participant,
                      removed from their inbox and never notified. The applied visibility is stamped on each message
                      and written to the audit trail.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading the comment visibility policy...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit-chain" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="ac-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center">
                      <Shield className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Audit Integrity</CardTitle>
                      <CardDescription>
                        Every audit row stores the hash of the row before it plus a hash of its own fields.
                        Recomputing the chain proves the log has not been altered and names the first broken row.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="ac-revision">
                    {acConfig ? acConfig.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {acConfig ? (
                  <>
                    <div className="flex items-center justify-between border rounded-md p-3 mb-4" data-testid="ac-switch-enabled">
                      <div>
                        <p className="text-sm font-medium">Hash-chain new audit rows</p>
                        <p className="text-xs text-slate-500">When off, rows stay append-only but carry no chain hash.</p>
                      </div>
                      <Switch
                        checked={acConfig.enabled !== false}
                        disabled={!isAdmin}
                        onCheckedChange={(checked) => setAcConfig({ ...acConfig, enabled: checked })}
                        data-testid="ac-toggle-enabled"
                      />
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-slate-500">
                        Algorithm <span className="font-mono">{acConfig.algorithm}</span> · genesis{" "}
                        <span className="font-mono">{acConfig.genesis}</span>
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => verifyAcMutation.mutate()}
                          disabled={verifyAcMutation.isPending}
                          data-testid="ac-verify"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          {verifyAcMutation.isPending ? "Verifying..." : "Verify chain"}
                        </Button>
                        <Button
                          onClick={() => saveAcMutation.mutate({ ...acConfig })}
                          disabled={!isAdmin || saveAcMutation.isPending}
                          data-testid="ac-save"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {saveAcMutation.isPending ? "Saving..." : "Save revision"}
                        </Button>
                      </div>
                    </div>
                    {acVerify && (
                      <Alert
                        className={acVerify.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}
                        data-testid="ac-verify-result"
                      >
                        {acVerify.ok ? (
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                        <AlertDescription className={acVerify.ok ? "text-emerald-800" : "text-red-800"}>
                          {acVerify.ok
                            ? "Chain intact - " + acVerify.checked + " rows verified (" + acVerify.unchained + " unchained)."
                            : "Chain BROKEN at row " + acVerify.broken_at + " (" + acVerify.reason + ")."}
                        </AlertDescription>
                      </Alert>
                    )}
                    <p className="text-xs text-slate-500 mt-5">
                      Verification is administrator-only and every run is itself written to the audit trail, so the
                      integrity check is accountable.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading the audit chain policy...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notification email frequency (W6-07 / BRD NTF-01). */}
          <TabsContent value="notification-frequency" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="nf-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-700 rounded-lg flex items-center justify-center">
                      <Mail className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Notification Email Frequency</CardTitle>
                      <CardDescription>
                        Choose whether event email is delivered immediately or batched into a daily digest.
                        The digest only ever contains the notifications addressed to you.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="nf-revision">
                    {nfPolicy ? nfPolicy.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {nfPolicy ? (
                  <>
                    <div className="border rounded-md p-4 mb-4" data-testid="nf-preference">
                      <p className="text-sm font-medium mb-1">Your frequency</p>
                      <p className="text-xs text-slate-500 mb-3">
                        {nfViewer?.may_choose
                          ? "Applies to event email sent to your inbox."
                          : "The group has fixed the notification frequency for everyone."}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {nfFrequencies.map((f) => (
                          <Button
                            key={f.key}
                            size="sm"
                            variant={(nfViewer?.preference || nfPolicy.default_frequency) === f.key ? "default" : "outline"}
                            disabled={!nfViewer?.may_choose || saveNfPreferenceMutation.isPending}
                            onClick={() => saveNfPreferenceMutation.mutate(f.key)}
                            data-testid={`nf-choice-${f.key}`}
                          >
                            {f.label}
                          </Button>
                        ))}
                        <span className="text-xs text-slate-500 ml-1" data-testid="nf-effective">
                          Effective: {nfViewer?.frequency || nfPolicy.default_frequency}
                        </span>
                      </div>
                    </div>

                    <div className="border rounded-md p-4 mb-4">
                      <p className="text-sm font-medium mb-3">Group policy</p>
                      <div className="flex items-center justify-between mb-3" data-testid="nf-switch-selectable">
                        <div>
                          <p className="text-sm">Allow each user to choose their own frequency</p>
                          <p className="text-xs text-slate-500">When off, everyone uses the group default below.</p>
                        </div>
                        <Switch
                          checked={nfPolicy.user_selectable !== false}
                          disabled={!isAdmin}
                          onCheckedChange={(checked) => setNfPolicy({ ...nfPolicy, user_selectable: checked })}
                          data-testid="nf-toggle-selectable"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Group default frequency</Label>
                          <select
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={nfPolicy.default_frequency}
                            disabled={!isAdmin}
                            onChange={(e) => setNfPolicy({ ...nfPolicy, default_frequency: e.target.value })}
                            data-testid="nf-default-frequency"
                          >
                            {nfFrequencies.map((f) => (
                              <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Digest hour (0-23)</Label>
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={nfPolicy.digest_hour}
                            disabled={!isAdmin}
                            onChange={(e) => setNfPolicy({ ...nfPolicy, digest_hour: Number(e.target.value) })}
                            data-testid="nf-digest-hour"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-4">
                        <Button
                          onClick={() => saveNfPolicyMutation.mutate({ ...nfPolicy })}
                          disabled={!isAdmin || saveNfPolicyMutation.isPending}
                          data-testid="nf-save"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {saveNfPolicyMutation.isPending ? "Saving..." : "Save policy"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => loadNfDigestMutation.mutate()}
                          disabled={loadNfDigestMutation.isPending}
                          data-testid="nf-preview-digest"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          {loadNfDigestMutation.isPending ? "Composing..." : "Preview my digest"}
                        </Button>
                      </div>
                    </div>

                    {nfDigest && (
                      <Alert data-testid="nf-digest-result">
                        <AlertDescription>
                          <span className="font-medium">
                            Digest for {nfDigest.recipient_email || "you"}: {nfDigest.total} item
                            {nfDigest.total === 1 ? "" : "s"}.
                          </span>{" "}
                          {(nfDigest.kinds || []).map((k) => `${k.kind} (${k.count})`).join(", ") || "Nothing pending."}
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">Loading the notification frequency policy...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Unified admin configuration registry (W8-03 / BRD ADM-01). */}
          <TabsContent value="config-registry" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="admin-config-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-700 rounded-lg flex items-center justify-center">
                      <LayoutGrid className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Configuration Registry</CardTitle>
                      <CardDescription>
                        Every tunable that shapes a screening in one place - the scorecard, hurdle rates,
                        document checklist, routing, SLAs, decision reason codes and picklists - with the
                        route that edits it and its audited change history.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" data-testid="admin-config-version">
                    {adminRegistry ? adminRegistry.version : "..."}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {adminRegistryError && (
                  <Alert variant="destructive" className="mb-4" data-testid="admin-config-error">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{adminRegistryError}</AlertDescription>
                  </Alert>
                )}
                {!adminRegistry ? (
                  <p className="text-slate-500 text-sm">Loading the configuration registry...</p>
                ) : (
                  <>
                    <Alert className="mb-4 border-slate-200 bg-slate-50" data-testid="admin-config-scope-note">
                      <Shield className="h-4 w-4 text-slate-600" />
                      <AlertDescription className="text-slate-700">{adminRegistry.scope_note}</AlertDescription>
                    </Alert>

                    <div className="grid grid-cols-3 gap-3 mb-5" data-testid="admin-config-summary">
                      <div className="border rounded-md p-3 text-center">
                        <div className="text-2xl font-semibold text-slate-800">{adminRegistry.summary.total}</div>
                        <div className="text-xs text-slate-500">Configurable areas</div>
                      </div>
                      <div className="border rounded-md p-3 text-center">
                        <div className="text-2xl font-semibold text-slate-800">{adminRegistry.summary.versioned}</div>
                        <div className="text-xs text-slate-500">Versioned</div>
                      </div>
                      <div className="border rounded-md p-3 text-center">
                        <div className="text-2xl font-semibold text-slate-800">{adminRegistry.summary.audited}</div>
                        <div className="text-xs text-slate-500">Audited</div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {adminRegistry.groups.map((group) => (
                        <div key={group.key} className="border rounded-md p-3" data-testid="admin-config-group">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-800">{group.label}</span>
                            <Badge variant="secondary" className="text-[10px]">{group.domains.length}</Badge>
                          </div>
                          <p className="text-xs text-slate-500 mb-2">{group.description}</p>
                          <div className="space-y-1">
                            {group.domains.map((d) => (
                              <button
                                key={d.domain}
                                type="button"
                                onClick={() => selectAdminDomain(d.domain)}
                                data-testid="admin-config-domain"
                                data-domain={d.domain}
                                className={
                                  "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors "
                                  + (adminDomain === d.domain ? "bg-slate-800 text-white" : "hover:bg-slate-100")
                                }
                              >
                                <span className="flex-1 text-xs font-medium">{d.label}</span>
                                <span className={"text-[10px] " + (adminDomain === d.domain ? "text-slate-300" : "text-slate-400")}>{d.route}</span>
                                {d.versioned ? (
                                  <span className={"text-[10px] rounded px-1 " + (adminDomain === d.domain ? "bg-slate-700" : "bg-slate-100 text-slate-500")}>v</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 border rounded-md p-4" data-testid="admin-config-history">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            Change history{adminDomain ? ": " + adminDomain : ""}
                          </p>
                          <p className="text-xs text-slate-500">
                            Read from the immutable audit trail. A published change is a new baseline and applies to new screenings only.
                          </p>
                        </div>
                        <Badge variant="outline" data-testid="admin-config-history-count">
                          {adminDomainLoading ? "..." : adminHistory.length + " revision" + (adminHistory.length === 1 ? "" : "s")}
                        </Badge>
                      </div>
                      {adminDomainLoading ? (
                        <p className="text-slate-500 text-xs">Loading history...</p>
                      ) : adminHistory.length === 0 ? (
                        <p className="text-slate-500 text-xs" data-testid="admin-config-history-empty">
                          No audited edits recorded for this area yet. Changes appear here once an administrator publishes a revision.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {adminHistory.map((row) => (
                            <div key={row.id} className="flex items-start gap-3 text-xs border-b border-slate-100 pb-2 last:border-0" data-testid="admin-config-history-row">
                              <Badge variant="secondary" className="text-[10px] shrink-0">#{row.id}</Badge>
                              <div className="flex-1">
                                <div className="text-slate-700 font-medium">{row.action}</div>
                                <div className="text-slate-500">
                                  {row.actor_email || "system"}{row.ts ? " - " + String(row.ts).slice(0, 19).replace("T", " ") : ""}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 mt-5">{adminRegistry.disclaimer}</p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bulk-import" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="bulk-import-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="w-5 h-5" /> Bulk Import Opportunities
                    </CardTitle>
                    <CardDescription>
                      Load deals already in flight from the tracker spreadsheet (BRD INTG-03). Every row is validated first; the report names each row that cannot be loaded and why.
                    </CardDescription>
                  </div>
                  {importPolicy && (
                    <Badge variant="outline" data-testid="bulk-import-version">{importPolicy.version}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {importPolicy && (
                  <Alert className="border-slate-200 bg-slate-50" data-testid="bulk-import-scope-note">
                    <AlertDescription className="text-slate-700">{importPolicy.scope_note}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a href={api.bulkImport.templateUrl()} data-testid="bulk-import-template" download>
                      <Download className="w-4 h-4" /> Download template (CSV)
                    </a>
                  </Button>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    data-testid="bulk-import-file"
                    onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportReport(null); setImportResult(null); setImportError(null); }}
                    className="text-sm"
                  />
                  <Button onClick={runImportValidate} disabled={!isAdmin || importBusy || !importFile} variant="outline" className="gap-2" data-testid="bulk-import-validate">
                    <Search className="w-4 h-4" /> Validate
                  </Button>
                  <Button onClick={runImportExecute} disabled={!isAdmin || importBusy || !importFile} className="gap-2" data-testid="bulk-import-execute">
                    <Upload className="w-4 h-4" /> Load importable rows
                  </Button>
                  {!isAdmin && <span className="text-sm text-slate-500">Administrator role required to import.</span>}
                </div>

                {importPolicy && (
                  <div className="text-xs text-slate-500" data-testid="bulk-import-required">
                    Required columns: {(importPolicy.policy?.required_columns || []).join(', ') || 'n/a'} · max {importPolicy.policy?.max_rows} rows · importable states: {(importPolicy.states || []).join(', ')}
                  </div>
                )}

                {importError && (
                  <Alert variant="destructive" data-testid="bulk-import-error">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{importError}</AlertDescription>
                  </Alert>
                )}

                {importResult && (
                  <Alert className="border-emerald-200 bg-emerald-50" data-testid="bulk-import-result">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <AlertDescription className="text-emerald-900">
                      Loaded {importResult.created_count} of {importResult.report?.total} rows into opportunities.
                    </AlertDescription>
                  </Alert>
                )}

                {importReport && (
                  <div data-testid="bulk-import-report">
                    <div className="grid grid-cols-4 gap-3 mb-4" data-testid="bulk-import-summary">
                      {[
                        { label: 'Rows', value: importReport.total, key: 'total' },
                        { label: 'Valid', value: importReport.valid, key: 'valid' },
                        { label: 'Warnings', value: importReport.warning, key: 'warning' },
                        { label: 'Errors', value: importReport.error, key: 'error' },
                      ].map((s) => (
                        <div key={s.key} className="border rounded-md p-3" data-testid={'bulk-import-summary-' + s.key}>
                          <div className="text-xs text-slate-500">{s.label}</div>
                          <div className="text-2xl font-semibold text-slate-800">{s.value}</div>
                        </div>
                      ))}
                    </div>
                    {(importReport.unknown_headers || []).length > 0 && (
                      <div className="text-xs text-amber-700 mb-2" data-testid="bulk-import-unknown">
                        Ignored unknown columns: {importReport.unknown_headers.join(', ')}
                      </div>
                    )}
                    {importReport.message && (
                      <div className="text-sm text-amber-700 mb-2">{importReport.message}</div>
                    )}
                    <div className="overflow-x-auto border rounded-md" data-testid="bulk-import-table">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left p-2 font-medium">Row</th>
                            <th className="text-left p-2 font-medium">Opportunity</th>
                            <th className="text-left p-2 font-medium">Status</th>
                            <th className="text-left p-2 font-medium">Findings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importReport.rows.map((r) => (
                            <tr key={r.row} className="border-t" data-testid={'bulk-import-row-' + r.row}>
                              <td className="p-2 text-slate-500">#{r.row}</td>
                              <td className="p-2">{r.opportunity_name || <span className="text-slate-400">(no name)</span>}</td>
                              <td className="p-2">
                                <Badge variant={r.status === 'error' ? 'destructive' : (r.status === 'warning' ? 'secondary' : 'outline')} className="capitalize">{r.status}</Badge>
                              </td>
                              <td className="p-2 text-xs text-slate-600">
                                {[...(r.errors || []), ...(r.warnings || [])].join(' ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Governance tab (W9-01 / NFR-03) */}
          <TabsContent value="ai-governance" className="flex-1 min-w-0 mt-0">
            <Card className="border-slate-200 shadow-sm" data-testid="ai-governance-card">
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5" /> AI Governance
                    </CardTitle>
                    <CardDescription>
                      Prompt/output logging, AI-output labelling and the provider approval register (BRD NFR-03). A provider must be approved before a model call is allowed when approval is required.
                    </CardDescription>
                  </div>
                  {aiGov?.config && (
                    <Badge variant="outline" data-testid="ai-governance-version">{aiGov.config.version} r{aiGov.config.revision}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {aiGov?.security_posture && (
                  <div className="border rounded-lg" data-testid="security-posture">
                    <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b rounded-t-lg">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-slate-800">Security posture (NFR-02)</span>
                      </div>
                      <Badge variant={aiGov.security_posture.gate?.pass ? 'secondary' : 'destructive'} data-testid="security-posture-gate">
                        {aiGov.security_posture.gate?.pass ? 'Gate pass' : 'Gate fail'} · {aiGov.security_posture.summary.open_critical_or_high} open critical/high
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-3 p-4" data-testid="security-posture-summary">
                      {[
                        { label: 'Server runtime advisories', value: aiGov.security_posture.scan.server_runtime.total },
                        { label: 'Critical/high (all trees)', value: aiGov.security_posture.scan.open_critical_or_high },
                        { label: 'Controls implemented', value: aiGov.security_posture.summary.implemented },
                        { label: 'External dependencies', value: aiGov.security_posture.summary.external },
                      ].map((s) => (
                        <div key={s.label} className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">{s.label}</div>
                          <div className="text-2xl font-semibold text-slate-800">{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="overflow-x-auto px-4 pb-4" data-testid="security-posture-controls">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left p-2 font-medium">Control</th>
                            <th className="text-left p-2 font-medium">Status</th>
                            <th className="text-left p-2 font-medium">Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiGov.security_posture.controls.map((c) => (
                            <tr key={c.id} className="border-t" data-testid={'security-control-' + c.id}>
                              <td className="p-2 font-medium text-slate-800">{c.label}</td>
                              <td className="p-2">
                                <Badge variant={c.status === 'implemented' || c.status === 'passing' ? 'secondary' : 'outline'} className="capitalize">{c.status}</Badge>
                              </td>
                              <td className="p-2 text-xs text-slate-600">{c.evidence}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {aiGov?.residency && (
                  <div className="border rounded-lg" data-testid="data-residency">
                    <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b rounded-t-lg">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-sky-600" />
                        <span className="text-sm font-semibold text-slate-800">Data residency (NFR-01)</span>
                      </div>
                      <Badge variant={aiGov.residency.posture_satisfied ? 'secondary' : 'destructive'} data-testid="residency-posture">
                        {aiGov.residency.posture_satisfied ? 'Posture clean' : aiGov.residency.summary.unpinned + ' unpinned'} · sign-off {aiGov.residency.signoff.status}
                      </Badge>
                    </div>
                    <div className="overflow-x-auto px-4 py-4" data-testid="residency-dependencies">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left p-2 font-medium">Dependency</th>
                            <th className="text-left p-2 font-medium">Status</th>
                            <th className="text-left p-2 font-medium">Region</th>
                            <th className="text-left p-2 font-medium">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiGov.residency.dependencies.map((d) => (
                            <tr key={d.id} className="border-t" data-testid={'residency-dep-' + d.id}>
                              <td className="p-2 font-medium text-slate-800">{d.label}</td>
                              <td className="p-2">
                                <Badge variant={d.status === 'unpinned' ? 'destructive' : 'secondary'} className="capitalize">{d.status.replace('_', ' ')}</Badge>
                              </td>
                              <td className="p-2 text-xs text-slate-600">{d.region || '—'}</td>
                              <td className="p-2 text-xs text-slate-600">{d.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {aiGov?.approval && (
                  <div className="grid grid-cols-4 gap-3" data-testid="ai-governance-approval-summary">
                    {[
                      { label: 'Providers', value: aiGov.approval.total },
                      { label: 'Approved', value: aiGov.approval.approved },
                      { label: 'Pending', value: aiGov.approval.pending },
                      { label: 'Rejected', value: aiGov.approval.rejected },
                    ].map((s) => (
                      <div key={s.label} className="border rounded-md p-3">
                        <div className="text-xs text-slate-500">{s.label}</div>
                        <div className="text-2xl font-semibold text-slate-800">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {aiGov?.config && (
                  <div className="space-y-3" data-testid="ai-governance-policy">
                    <h4 className="text-sm font-semibold text-slate-800">Governance policy</h4>
                    {[
                      ['log_prompts', 'Log prompts'],
                      ['log_responses', 'Log responses'],
                      ['redact_emails', 'Redact emails in logs'],
                      ['redact_secrets', 'Redact secrets in logs'],
                      ['label_ai_output', 'Label AI output'],
                      ['require_provider_approval', 'Require provider approval'],
                      ['human_review_required', 'Human review required'],
                    ].map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <span className="text-sm text-slate-700">{label}</span>
                        <Switch
                          checked={Boolean(aiGov.config[key])}
                          onCheckedChange={(checked) => patchAiGov({ [key]: checked })}
                          disabled={!isAdmin}
                          data-testid={'ai-governance-' + key}
                        />
                      </div>
                    ))}
                    <div className="flex items-center gap-4 pt-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm text-slate-600">Retention (days)</Label>
                        <Input
                          type="number"
                          className="w-24"
                          value={aiGov.config.retention_days}
                          onChange={(e) => patchAiGov({ retention_days: Number(e.target.value) })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Output label: <Badge variant="outline" className="ml-1">{aiGov.label}</Badge>
                      </div>
                    </div>
                  </div>
                )}

                {aiGov?.config && (
                  <div className="space-y-3" data-testid="ai-governance-providers">
                    <h4 className="text-sm font-semibold text-slate-800">Provider approval register</h4>
                    <div className="overflow-x-auto border rounded-md">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left p-2 font-medium">Provider</th>
                            <th className="text-left p-2 font-medium">Residency</th>
                            <th className="text-left p-2 font-medium">Status</th>
                            <th className="text-left p-2 font-medium">Approved by</th>
                            <th className="text-left p-2 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(aiGov.config.providers || []).map((p) => (
                            <tr key={p.id} className="border-t" data-testid={'ai-provider-' + p.id}>
                              <td className="p-2 font-medium text-slate-800">{p.label}</td>
                              <td className="p-2 text-slate-600">{p.data_residency}</td>
                              <td className="p-2">
                                <Badge variant={p.approval_status === 'approved' ? 'secondary' : (p.approval_status === 'rejected' ? 'destructive' : 'outline')} className="capitalize">
                                  {p.approval_status}
                                </Badge>
                              </td>
                              <td className="p-2 text-slate-600">{p.approved_by || '—'}</td>
                              <td className="p-2">
                                <select
                                  className="text-xs border rounded px-2 py-1"
                                  value={p.approval_status}
                                  onChange={(e) => setProviderStatus(p.id, e.target.value)}
                                  disabled={!isAdmin}
                                  data-testid={'ai-provider-status-' + p.id}
                                >
                                  <option value="pending">pending</option>
                                  <option value="approved">approved</option>
                                  <option value="rejected">rejected</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {aiGovNotice && (
                  <Alert className={aiGovNotice.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'} data-testid="ai-governance-notice">
                    {aiGovNotice.ok ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                    <AlertDescription>{aiGovNotice.message}</AlertDescription>
                  </Alert>
                )}

                {isAdmin && (
                  <div className="flex gap-3">
                    <Button onClick={saveAiGov} disabled={aiGovBusy} className="bg-teal-600 hover:bg-teal-700 gap-2" data-testid="ai-governance-save">
                      <Save className="w-4 h-4" /> Save governance
                    </Button>
                    <Button variant="outline" onClick={loadAiGov} className="gap-2">
                      <RefreshCw className="w-4 h-4" /> Refresh
                    </Button>
                  </div>
                )}

                {isAdmin && aiGovLog.status && (
                  <div className="text-xs text-slate-500" data-testid="ai-governance-log-status">
                    Governed calls logged: {aiGovLog.status.total} · with error: {aiGovLog.status.with_error}{aiGovLog.status.last_call_at ? ' · last: ' + new Date(aiGovLog.status.last_call_at).toLocaleString() : ''}
                  </div>
                )}
                {isAdmin && aiGovLog.logs.length > 0 && (
                  <div className="overflow-x-auto border rounded-md" data-testid="ai-governance-log">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left p-2 font-medium">When</th>
                          <th className="text-left p-2 font-medium">Model</th>
                          <th className="text-left p-2 font-medium">Provider</th>
                          <th className="text-left p-2 font-medium">Actor</th>
                          <th className="text-left p-2 font-medium">Prompt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiGovLog.logs.map((l) => (
                          <tr key={l.id} className="border-t">
                            <td className="p-2 text-slate-500 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                            <td className="p-2 text-xs">{l.model}</td>
                            <td className="p-2 text-xs">{l.provider_id || '—'}</td>
                            <td className="p-2 text-xs">{l.actor_email || '—'}</td>
                            <td className="p-2 text-xs text-slate-600">{String(l.prompt_preview || '').slice(0, 80)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
