import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  GitMerge,
  Network,
  ShieldAlert,
  FileText,
  Brain
} from "lucide-react";

import MarketOverview from "../components/market/MarketOverview";
import MarketStructure from "../components/market/MarketStructure";
import PricingElasticity from "../components/market/PricingElasticity";
import UnilateralEffects from "../components/market/UnilateralEffects";
import CoordinatedEffects from "../components/market/CoordinatedEffects";
import VerticalPlatform from "../components/market/VerticalPlatform";
import EntryExpansion from "../components/market/EntryExpansion";
import EvidencePack from "../components/market/EvidencePack";

export default function MarketAnalysis() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const allCompanies = await api.entities.Company.list();
      const user = await api.auth.me();
      
      if (user.role === 'admin') return allCompanies;
      
      return allCompanies.filter(company => {
        if (company.created_by === user.email) return true;
        if (company.visibility === 'organization' && user.organization) return true;
        if (company.visibility === 'group' && company.shared_with_groups && user.groups) {
          return company.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  const { data: scenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const allScenarios = await api.entities.MergerScenario.list();
      const user = await api.auth.me();
      
      if (user.role === 'admin') return allScenarios;
      
      return allScenarios.filter(scenario => {
        if (scenario.created_by === user.email) return true;
        if (scenario.visibility === 'organization' && user.organization) return true;
        if (scenario.visibility === 'group' && scenario.shared_with_groups && user.groups) {
          return scenario.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Market Impact Analysis</h1>
          <p className="text-slate-600 mt-1">Comprehensive antitrust and competitive dynamics assessment</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1 grid grid-cols-8 w-full">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden md:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="structure" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden md:inline">Structure</span>
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              <span className="hidden md:inline">Pricing</span>
            </TabsTrigger>
            <TabsTrigger value="unilateral" className="flex items-center gap-2">
              <GitMerge className="w-4 h-4" />
              <span className="hidden md:inline">Unilateral</span>
            </TabsTrigger>
            <TabsTrigger value="coordinated" className="flex items-center gap-2">
              <Network className="w-4 h-4" />
              <span className="hidden md:inline">Coordinated</span>
            </TabsTrigger>
            <TabsTrigger value="vertical" className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              <span className="hidden md:inline">Vertical</span>
            </TabsTrigger>
            <TabsTrigger value="entry" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden md:inline">Entry</span>
            </TabsTrigger>
            <TabsTrigger value="evidence" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span className="hidden md:inline">Evidence</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <MarketOverview companies={companies} scenarios={scenarios} loading={isLoading} />
          </TabsContent>

          <TabsContent value="structure">
            <MarketStructure companies={companies} loading={isLoading} />
          </TabsContent>

          <TabsContent value="pricing">
            <PricingElasticity companies={companies} loading={isLoading} />
          </TabsContent>

          <TabsContent value="unilateral">
            <UnilateralEffects companies={companies} scenarios={scenarios} loading={isLoading} />
          </TabsContent>

          <TabsContent value="coordinated">
            <CoordinatedEffects companies={companies} loading={isLoading} />
          </TabsContent>

          <TabsContent value="vertical">
            <VerticalPlatform companies={companies} scenarios={scenarios} loading={isLoading} />
          </TabsContent>

          <TabsContent value="entry">
            <EntryExpansion companies={companies} loading={isLoading} />
          </TabsContent>

          <TabsContent value="evidence">
            <EvidencePack companies={companies} scenarios={scenarios} loading={isLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}