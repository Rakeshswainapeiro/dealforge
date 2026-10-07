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
  User,
  Users,
  LogOut,
  ClipboardCheck,
  Briefcase,
  Network,
  Workflow,
  MessageSquareQuote,
  Globe,
  ShieldCheck,
  FileSpreadsheet,
  Layers,
  Activity,
  Inbox,
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

// eslint-disable-next-line react/prop-types
export default function Layout({ children }) {
  const location = useLocation();
  const { t, lang, setLang, languages } = useTranslation();
  const { features } = useAuth();

  const [currentUser, setCurrentUser] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
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
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const handleLogout = async () => {
    await api.auth.logout();
    window.location.assign('/login');
  };

  return (
    <SidebarProvider>
      <style>{`
        :root {
          --sidebar-bg: #FFFFFF;
          --sidebar-border: #E2E8F0;
          --sidebar-text: #1E293B;
          --sidebar-text-muted: #64748B;
          --sidebar-hover: #F8FAFC;
          --sidebar-active: #14B8A6;
          --sidebar-active-bg: #F0FDFA;
          --sidebar-active-border: #14B8A6;
        }
      `}</style>
      <div className="min-h-screen flex w-full bg-slate-50">
        <Sidebar className="border-r-2 border-slate-200 bg-white shadow-sm">
          <SidebarHeader className="border-b-2 border-slate-100 p-6 bg-gradient-to-br from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md">
                <GitMerge className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-slate-900">{t("app.name")}</h2>
                <p className="text-xs text-slate-600 font-medium">{t("app.tagline")}</p>
              </div>
            </div>
          </SidebarHeader>
          
          <SidebarContent className="p-4 bg-white">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {navigationItems
                    .filter(item => (!item.adminOnly || isAdmin) && navItemEnabled(features || {}, item))
                    .map((item) => {
                      const isActive = location.pathname === item.url;
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton 
                            asChild 
                            className={`
                              transition-all duration-200 rounded-lg px-4 py-3
                              ${isActive 
                                ? 'bg-teal-50 text-teal-700 font-semibold border-l-4 border-teal-600 shadow-sm' 
                                : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 border-l-4 border-transparent'
                              }
                            `}
                          >
                            <Link to={item.url} className="flex items-center gap-3 w-full">
                              <item.icon className={`w-5 h-5 ${isActive ? 'text-teal-600' : 'text-slate-500'}`} />
                              <span className="font-medium text-sm">{t(item.key)}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t-2 border-slate-100 p-4 bg-gradient-to-br from-slate-50 to-white">
            <div className="flex items-center justify-between gap-2 px-1 pb-3">
              <div className="flex items-center gap-2 text-slate-500">
                <Globe className="w-4 h-4" />
                <span className="text-xs font-medium">{t("lang.label")}</span>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label={t("lang.label")}>
                {languages.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLang(l.code)}
                    aria-pressed={lang === l.code}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      lang === l.code
                        ? "bg-teal-600 text-white"
                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {t("lang." + l.code)}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-slate-200 shadow-sm animate-pulse">
                <div className="w-10 h-10 bg-slate-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-24" />
                  <div className="h-3 bg-slate-200 rounded w-16" />
                </div>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all w-full text-left">
                    <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-600 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">
                        {currentUser?.full_name || t("user.fallbackName")}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-slate-600 truncate">
                          {currentUser?.email || ''}
                        </p>
                        {currentUser?.role === 'admin' && (
                          <Badge className="bg-purple-100 text-purple-800 text-[10px] px-1.5 py-0">
                            {t("user.admin")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="end" side="top">
                  <DropdownMenuLabel>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {currentUser?.full_name || t("user.fallbackName")}
                      </p>
                      <p className="text-xs text-slate-600">{currentUser?.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {currentUser?.organization && (
                    <DropdownMenuItem disabled>
                      <Building2 className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-500">{t("user.organization")}</span>
                        <span className="text-sm font-medium">{currentUser.organization}</span>
                      </div>
                    </DropdownMenuItem>
                  )}
                  {currentUser?.department && (
                    <DropdownMenuItem disabled>
                      <Users className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-500">{t("user.department")}</span>
                        <span className="text-sm font-medium">{currentUser.department}</span>
                      </div>
                    </DropdownMenuItem>
                  )}
                  {currentUser?.groups && currentUser.groups.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled>
                        <div className="flex flex-col w-full">
                          <span className="text-xs text-slate-500 mb-2">{t("user.groups")}</span>
                          <div className="flex flex-wrap gap-1">
                            {currentUser.groups.map((group, idx) => (
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
                    <LogOut className="w-4 h-4 mr-2" />
                    {t("user.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col bg-slate-50">
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

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
