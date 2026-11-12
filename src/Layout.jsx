import React from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { api } from "@/api/client";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from '@/lib/AuthContext';
import { navItemEnabled } from '@/lib/features';

import {
  Building2,
  GitMerge,
  LayoutGrid,
  Palette,
  Settings,
  Users,
  LogOut,
  ClipboardCheck,
  Briefcase,
  PlusCircle,
  Network,
  Workflow,
  MessageSquareQuote,
  Globe,
  ShieldCheck,
  FileSpreadsheet,
  Layers,
  Activity,
  Inbox,
  ChevronDown,
  Check,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

// Navigation in Phase 1 workflow order (BRD v2). Items whose page is switched
// off in server/config/featureFlags.js are hidden by navItemEnabled(), so the
// later-phase entries at the end only appear when an admin enables them.
const navigationItems = [
  {
    key: "nav.myWork",
    url: createPageUrl("MyWork"),
    page: 'MyWork',
    icon: Inbox,
  },
  {
    key: "nav.submitOpportunity",
    url: createPageUrl("SubmitOpportunity"),
    page: 'SubmitOpportunity',
    icon: ClipboardCheck,
  },
  {
    key: "nav.newOpportunity",
    url: createPageUrl("NewOpportunity"),
    page: 'NewOpportunity',
    icon: PlusCircle,
  },
  {
    key: "nav.screeningBoard",
    url: createPageUrl("ScreeningBoard"),
    page: 'ScreeningBoard',
    icon: LayoutGrid,
  },
  {
    key: "nav.opportunityRoute",
    url: createPageUrl("OpportunityRoute"),
    page: 'OpportunityRoute',
    icon: Workflow,
  },
  {
    key: "nav.qanda",
    url: createPageUrl("QandA"),
    page: 'QandA',
    icon: MessageSquareQuote,
  },
  {
    key: "nav.pipelineDashboard",
    url: createPageUrl("PipelineDashboard"),
    page: 'PipelineDashboard',
    icon: Layers,
  },
  {
    key: "nav.pipelineMetrics",
    url: createPageUrl("PipelineMetrics"),
    page: 'PipelineMetrics',
    icon: Activity,
  },
  {
    key: "nav.reporting",
    url: createPageUrl("Reporting"),
    page: 'Reporting',
    icon: FileSpreadsheet,
  },
  {
    key: "nav.groupStructure",
    url: createPageUrl("GroupStructure"),
    page: 'GroupStructure',
    icon: Network,
  },
  {
    key: "nav.investmentThemes",
    url: createPageUrl("ThemeAdmin"),
    page: 'ThemeAdmin',
    icon: Palette,
    adminOnly: true,
  },
  {
    key: "nav.superAdmin",
    url: createPageUrl("SuperAdmin"),
    page: 'SuperAdmin',
    icon: ShieldCheck,
    adminOnly: true,
  },
  {
    key: "nav.settings",
    url: createPageUrl("Settings"),
    page: 'Settings',
    icon: Settings,
  },
  // Later phase - off by default (featureFlags.js).
  {
    key: "nav.dueDiligence",
    url: createPageUrl("DueDiligence"),
    page: 'DueDiligence',
    icon: ClipboardCheck,
  },
  {
    key: "nav.portfolios",
    url: createPageUrl("Portfolios"),
    page: 'Portfolios',
    icon: Briefcase,
  },
];

const MODULE_OPTIONS = [
  { id: "sirius", name: "Sirius Group", initial: "S", roleSubtitle: "Sirius HR · all subsidiaries" },
  { id: "subsidiary_a", name: "Subsidiary A", initial: "A", roleSubtitle: "Subsidiary HR" },
  { id: "subsidiary_b", name: "Subsidiary B", initial: "B", roleSubtitle: "Subsidiary HR" },
  { id: "subsidiary_c", name: "Subsidiary C", initial: "C", roleSubtitle: "Subsidiary HR" },
];

// eslint-disable-next-line react/prop-types
export default function Layout({ children }) {
  const location = useLocation();
  const { t, lang, dir, setLang, languages, } = useTranslation();
  const { features } = useAuth();

  const [selectedModuleId, setSelectedModuleId] = React.useState(() => {
    try {
      return localStorage.getItem("dealforge_selected_module") || "sirius";
    } catch {
      return "sirius";
    }
  });

  const currentModule = React.useMemo(() => {
    return MODULE_OPTIONS.find((m) => m.id === selectedModuleId) || MODULE_OPTIONS[0];
  }, [selectedModuleId]);

  const handleSelectModule = (mod) => {
    setSelectedModuleId(mod.id);
    try {
      localStorage.setItem("dealforge_selected_module", mod.id);
    } catch {
      // no-op if localStorage is restricted
    }
  };

  const { user: authUser } = useAuth();
  const [currentUser, setCurrentUser] = React.useState(authUser || null);
  const [loading, setLoading] = React.useState(!authUser);

  React.useEffect(() => {
    if (authUser) {
      setCurrentUser(authUser);
      setLoading(false);
      return;
    }
    const fetchUser = async () => {
      try {
        const user = await api.auth.me();
        setCurrentUser(user);
      } catch (err) {
        console.error("Error fetching user:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [authUser]);

  const activeUser = currentUser || authUser;
  const isAdmin = activeUser?.role === 'admin';

  // Scope sidebar spacing refinements exclusively to Infinia Preparer (Deal Lead)
  const isInfiniaPreparer = React.useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const roleParam = (searchParams.get("role") || "").toLowerCase().trim();
    if (roleParam) {
      if (
        roleParam === "infinia_preparer" ||
        roleParam === "subsidiary_deal_lead" ||
        roleParam === "infinia_deal_lead" ||
        roleParam === "preparer" ||
        roleParam === "deal_lead" ||
        roleParam === "subsidiary_hr" ||
        roleParam === "hr"
      ) {
        return true;
      }
      if (
        roleParam === "admin" ||
        roleParam === "subsidiary_cfo" ||
        roleParam === "cfo" ||
        roleParam === "subsidiary_ceo" ||
        roleParam === "ceo" ||
        roleParam === "sirius_deal_lead" ||
        roleParam === "cluster_head" ||
        roleParam === "sirius"
      ) {
        return false;
      }
    }

    const email = String(activeUser?.email || "").toLowerCase().trim();
    if (email === "deal.lead@infinia.local") {
      return true;
    }

    const roles = [
      activeUser?.role,
      ...(activeUser?.roles || []),
      activeUser?.primary_role,
    ]
      .filter(Boolean)
      .map((r) => String(r).toLowerCase().trim());

    if (
      roles.includes("admin") ||
      roles.includes("subsidiary_cfo") ||
      roles.includes("subsidiary_ceo") ||
      roles.includes("sirius_deal_lead") ||
      roles.includes("cluster_head") ||
      roles.includes("sirius_vertical_head") ||
      roles.includes("cio") ||
      roles.includes("leadership") ||
      roles.includes("ic_member") ||
      roles.includes("independent_reviewer")
    ) {
      if (!roles.includes("subsidiary_deal_lead") && !roles.includes("infinia_preparer")) {
        return false;
      }
    }

    if (roles.includes("sirius_deal_lead") || email === "deal.lead@sirius.local") {
      return false;
    }

    if (
      roles.includes("subsidiary_deal_lead") ||
      roles.includes("infinia_preparer") ||
      roles.includes("subsidiary_hr")
    ) {
      return true;
    }

    const orgId = String(activeUser?.org_id || "").toLowerCase();
    const orgName = String(activeUser?.org_name || activeUser?.organization || "").toLowerCase();
    const isInfiniaOrg = orgId.includes("infinia") || orgName.includes("infinia");
    if (isInfiniaOrg) {
      if (
        roles.some((r) => r.includes("deal_lead") || r.includes("preparer") || r.includes("lead")) &&
        !roles.includes("subsidiary_cfo") &&
        !roles.includes("subsidiary_ceo")
      ) {
        return true;
      }
    }

    return false;
  }, [activeUser, location.search]);

  const handleLogout = async () => {
    await api.auth.logout();
    window.location.assign('/login');
  };

  return (
    <SidebarProvider style={{ "--sidebar-width": "220px" }}>
      <style>{`
        :root {
          --sidebar-width: 220px;
          --sidebar-bg: #0f1b3d;
          --sidebar-border: #182752;
          --sidebar-text: #c9d3f2;
          --sidebar-text-muted: #8b9bb4;
          --sidebar-hover: rgba(255, 255, 255, 0.08);
          --sidebar-active: #0f172a;
          --sidebar-active-bg: #FFFFFF;
          --sidebar-active-border: #FFFFFF;
        }
        /* Completely hide scrollbars while preserving scrolling across all browsers */
        [data-sidebar="content"],
        [data-sidebar="sidebar"],
        .no-scrollbar,
        .no-scrollbar * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        [data-sidebar="content"]::-webkit-scrollbar,
        [data-sidebar="sidebar"]::-webkit-scrollbar,
        .no-scrollbar::-webkit-scrollbar,
        .no-scrollbar *::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
      `}</style>
      <div className="min-h-screen flex w-full bg-[#f6f7fb]">
        <Sidebar side={dir === "rtl" ? "right" : "left"} className="border-e border-[#182752]/40 bg-[#0f1b3d] text-slate-100 shadow-xl w-[220px] shrink-0">
          <SidebarHeader className={`border-b border-transparent bg-[#0f1b3d] ${isInfiniaPreparer ? "px-4 pt-5 pb-3" : "px-4 pt-6 pb-4"}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <svg width="32" height="34" viewBox="0 0 28 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 2L3 6.5V14.5C3 21.5 7.7 26.8 14 28.5C20.3 26.8 25 21.5 25 14.5V6.5L14 2Z" fill="#4ebb67" />
                  <path d="M8.5 14.5L12 18L19.5 10.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-xl text-white tracking-tight leading-none">Deal<span className="text-[#4ebb67]">Forge</span></h2>
                <p className="text-[9px] text-[#8b9bb4] font-semibold tracking-[0.25em] uppercase mt-1">M&amp;A ANALYSIS</p>
              </div>
            </div>

            {/* Global Module Selector (S2, S3, S4 reference designs) */}
            <div className="mt-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl bg-[#14234b] hover:bg-[#1a2c5e] border border-white/10 text-xs text-white shadow-xs transition-colors cursor-pointer group focus:outline-none"
                    data-testid="sidebar-module-selector"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center bg-[#2563eb] text-white font-bold text-xs shrink-0 shadow-xs">
                        {currentModule.initial}
                      </span>
                      <div className="flex flex-col text-left min-w-0">
                        <span className="text-[9px] font-bold tracking-wider uppercase text-slate-400 leading-none">
                          MODULE
                        </span>
                        <span className="text-xs font-bold text-white tracking-tight truncate leading-tight mt-0.5">
                          {currentModule.name}
                        </span>
                      </div>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-300 group-hover:text-white shrink-0 ml-1 transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-60 p-1.5 rounded-xl bg-white border border-slate-200 shadow-xl z-50" align="start" side="bottom" sideOffset={6}>
                  <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    SWITCH MODULE
                  </div>
                  {MODULE_OPTIONS.map((mod) => {
                    const isSelected = mod.id === currentModule.id;
                    return (
                      <DropdownMenuItem
                        key={mod.id}
                        onClick={() => handleSelectModule(mod)}
                        className={`flex items-center justify-between gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${
                          isSelected ? "bg-[#edf3fe] text-slate-900 font-semibold" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                              isSelected ? "bg-[#2563eb] text-white" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {mod.initial}
                          </span>
                          <div className="flex flex-col min-w-0 text-left">
                            <span className="text-xs font-bold text-slate-900 leading-tight truncate">
                              {mod.name}
                            </span>
                            <span className="text-[10px] text-slate-500 leading-tight truncate mt-0.5">
                              {mod.roleSubtitle}
                            </span>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SidebarHeader>
          
          <SidebarContent className={`px-3 bg-[#0f1b3d] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${isInfiniaPreparer ? "py-1" : "py-2"}`}>
            <SidebarGroup className="p-0">
              <SidebarGroupContent className="p-0">
                <SidebarMenu className={isInfiniaPreparer ? "space-y-1.5" : "space-y-3"}>
                  {navigationItems
                    .filter(item => (!item.adminOnly || isAdmin) && navItemEnabled(features || {}, item))
                    .map((item) => {
                      const isActive = location.pathname.toLowerCase() === item.url.toLowerCase();
                      const label = item.label || t(item.key);

                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton 
                            asChild 
                            className={`
                              transition-all duration-200 rounded-lg px-3
                              ${isInfiniaPreparer ? "py-1.5 h-[36px]" : "py-2.5 h-[42px]"}
                              ${isActive 
                                ? 'bg-white text-slate-900 font-semibold shadow-sm hover:bg-white hover:text-slate-900 active:bg-white active:text-slate-900' 
                                : 'text-[#c9d3f2] hover:bg-white/10 hover:text-white'
                              }
                            `}
                          >
                            <Link to={item.url} className="flex items-center gap-2.5 w-full">
                              <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-900' : 'text-[#8b9bb4]'}`} />
                              <span className={`text-sm truncate ${isActive ? 'font-semibold text-slate-900' : 'font-medium text-[#c9d3f2]'}`}>{label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className={`border-t border-transparent px-3 bg-[#0f1b3d] ${isInfiniaPreparer ? "pb-3 pt-1.5" : "pb-3 pt-2"}`}>
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <div className="flex items-center gap-1.5 text-[#8b9bb4]">
                <Globe className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">{t("lang.label")}</span>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label={t("lang.label")}>
                {languages.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLang(l.code)}
                    aria-pressed={lang === l.code}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                      lang === l.code
                        ? "bg-blue-600 text-white font-semibold"
                        : "bg-white/10 text-[#c9d3f2] hover:bg-white/20"
                    }`}
                  >
                    {t("lang." + l.code)}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/5 border border-white/10 animate-pulse">
                <div className="w-11 h-11 bg-slate-800 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-slate-800 rounded w-20" />
                  <div className="h-3 bg-slate-800 rounded w-12" />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 w-full">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-white/10 transition-all flex-1 min-w-0 text-start group">
                      <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center border border-white/10 shadow-sm">
                        <img 
                          src={activeUser?.avatar_url || "/avatar.png"} 
                          alt={activeUser?.full_name || "Deepak Juneja"} 
                          className="w-full h-full object-cover" 
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.parentElement.querySelector('.avatar-fallback');
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                        <div 
                          className="avatar-fallback w-full h-full bg-gradient-to-tr from-amber-600 to-indigo-600 items-center justify-center text-white font-bold text-sm"
                          style={{ display: 'none' }}
                        >
                          {activeUser?.full_name ? activeUser.full_name.charAt(0) : "D"}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-[13px] leading-tight truncate">
                          {activeUser?.full_name || "Deepak Juneja"}
                        </p>
                        <p className="text-[11px] text-[#8b9bb4] leading-tight truncate mt-0.5">
                          {activeUser?.role === 'admin' ? "Admin" : (activeUser?.email || 'User')}
                        </p>
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64" align="end" side="top">
                    <DropdownMenuLabel>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {activeUser?.full_name || t("user.fallbackName")}
                        </p>
                        <p className="text-xs text-slate-600">{activeUser?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {activeUser?.organization && (
                      <DropdownMenuItem disabled>
                        <Building2 className="w-4 h-4 me-2" />
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-500">{t("user.organization")}</span>
                          <span className="text-sm font-medium">{activeUser.organization}</span>
                        </div>
                      </DropdownMenuItem>
                    )}
                    {activeUser?.department && (
                      <DropdownMenuItem disabled>
                        <Users className="w-4 h-4 me-2" />
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-500">{t("user.department")}</span>
                          <span className="text-sm font-medium">{activeUser.department}</span>
                        </div>
                      </DropdownMenuItem>
                    )}
                    {activeUser?.groups && activeUser.groups.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled>
                          <div className="flex flex-col w-full">
                            <span className="text-xs text-slate-500 mb-2">{t("user.groups")}</span>
                            <div className="flex flex-wrap gap-1">
                              {activeUser.groups.map((group, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {group}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer">
                      <LogOut className="w-4 h-4 me-2" />
                      {t("user.logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  type="button"
                  onClick={handleLogout}
                  title={t("user.logout")}
                  className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col bg-[#f6f7fb] min-w-0 max-w-full overflow-x-hidden">
          <header className="bg-white border-b-2 border-slate-200 px-6 py-4 md:hidden shadow-sm">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="hover:bg-slate-100 p-2 rounded-lg transition-colors duration-200 text-slate-700" />
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-teal-600 rounded-lg flex items-center justify-center">
                  <GitMerge className="w-4 h-4 text-white" />
                </div>
                <h1 className="text-lg font-bold text-slate-900">{t("app.name")}</h1>
              </div>
            </div>
          </header>

          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden no-scrollbar">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
