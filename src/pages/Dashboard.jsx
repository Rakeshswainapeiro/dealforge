import React from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Building2, GitMerge, TrendingUp, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

import MetricCard from "../components/dashboard/MetricCard";
import RecentScenarios from "../components/dashboard/RecentScenarios";
import QuickStats from "../components/dashboard/QuickStats";
import MarketShareTrends from "../components/dashboard/MarketShareTrends";

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: companies, isLoading: loadingCompanies } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const allCompanies = await api.entities.Company.list();
      const user = await api.auth.me(); // Re-fetch user here to ensure it's available within this async context
      
      if (user.role === 'admin') return allCompanies;
      
      return allCompanies.filter(company => {
        if (company.created_by === user.email) return true;
        if (company.visibility === 'organization' && user.organization) return true;
        if (company.visibility === 'group' && company.shared_with_groups && user.groups) {
          // Check if any of the company's shared groups match any of the user's groups
          return company.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  const { data: scenarios, isLoading: loadingScenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const allScenarios = await api.entities.MergerScenario.list('-updated_date');
      const user = await api.auth.me(); // Re-fetch user here to ensure it's available within this async context
      
      if (user.role === 'admin') return allScenarios;
      
      return allScenarios.filter(scenario => {
        if (scenario.created_by === user.email) return true;
        if (scenario.visibility === 'organization' && user.organization) return true;
        if (scenario.visibility === 'group' && scenario.shared_with_groups && user.groups) {
          // Check if any of the scenario's shared groups match any of the user's groups
          return scenario.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  const totalMarketCap = companies.reduce((sum, c) => sum + (c.market_cap || 0), 0);
  const avgPremium = scenarios.length > 0 
    ? scenarios.reduce((sum, s) => sum + (s.deal_structure?.premium || 0), 0) / scenarios.length 
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{t('dashboard.title')}</h1>
            <p className="text-slate-600 mt-1">{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex gap-3">
            <Link to={createPageUrl("Companies")}>
              <Button variant="outline" className="gap-2">
                <Building2 className="w-4 h-4" />
                {t('dashboard.addCompany')}
              </Button>
            </Link>
            <Link to={createPageUrl("Scenarios")}>
              <Button className="bg-teal-600 hover:bg-teal-700 gap-2">
                <Plus className="w-4 h-4" />
                {t('dashboard.newScenario')}
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title={t('dashboard.totalCompanies')}
            value={companies.length}
            icon={Building2}
            color="blue"
            loading={loadingCompanies}
          />
          <MetricCard
            title={t('dashboard.activeScenarios')}
            value={scenarios.filter(s => s.status === 'active').length}
            icon={GitMerge}
            color="teal"
            loading={loadingScenarios}
          />
          <MetricCard
            title={t('dashboard.universeMarketCap')}
            value={`$${(totalMarketCap / 1000).toFixed(1)}B`}
            icon={TrendingUp}
            color="emerald"
            loading={loadingCompanies}
          />
          <MetricCard
            title={t('dashboard.avgPremium')}
            value={`${avgPremium.toFixed(1)}%`}
            icon={AlertTriangle}
            color="amber"
            loading={loadingScenarios}
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RecentScenarios scenarios={scenarios} loading={loadingScenarios} />
          </div>
          <div>
            <QuickStats companies={companies} scenarios={scenarios} />
          </div>
        </div>

        <MarketShareTrends companies={companies} />
      </div>
    </div>
  );
}
