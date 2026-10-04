import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, TrendingUp, Target, Network } from "lucide-react";

import DealSuccessPredictor from "../components/analytics/DealSuccessPredictor";
import CrossMarketCorrelations from "../components/analytics/CrossMarketCorrelations";
import CompetitiveLandscape from "../components/analytics/CompetitiveLandscape";
import SynergyRiskAnalysis from "../components/analytics/SynergyRiskAnalysis";
import PipelineMetrics from "../components/analytics/PipelineMetrics";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("predictor");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: companies, isLoading: loadingCompanies } = useQuery({
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

  const { data: scenarios, isLoading: loadingScenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const allScenarios = await api.entities.MergerScenario.list('-updated_date');
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

  const { data: opportunities, isLoading: loadingOpportunities } = useQuery({
    queryKey: ['dealOpportunities'],
    queryFn: async () => {
      const allOpps = await api.entities.DealOpportunity.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') return allOpps;
      
      return allOpps.filter(opp => {
        if (opp.created_by === user.email) return true;
        if (opp.visibility === 'organization' && user.organization) return true;
        if (opp.visibility === 'group' && opp.shared_with_groups && user.groups) {
          return opp.shared_with_groups.some(group => user.groups.includes(group));
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
          <h1 className="text-3xl font-bold text-slate-900">Advanced Analytics</h1>
          <p className="text-slate-600 mt-1">
            AI-powered insights, predictive models, and competitive intelligence
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1">
            <TabsTrigger value="pipeline" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden md:inline">Pipeline Metrics</span>
            </TabsTrigger>
            <TabsTrigger value="predictor" className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              <span className="hidden md:inline">Deal Success</span>
            </TabsTrigger>
            <TabsTrigger value="correlations" className="flex items-center gap-2">
              <Network className="w-4 h-4" />
              <span className="hidden md:inline">Cross-Market</span>
            </TabsTrigger>
            <TabsTrigger value="landscape" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden md:inline">Competitive</span>
            </TabsTrigger>
            <TabsTrigger value="synergy" className="flex items-center gap-2">
              <Brain className="w-4 h-4" />
              <span className="hidden md:inline">Synergy & Risk</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline">
            <PipelineMetrics 
              opportunities={opportunities}
              loading={loadingOpportunities}
            />
          </TabsContent>

          <TabsContent value="predictor">
            <DealSuccessPredictor 
              scenarios={scenarios} 
              companies={companies}
              loading={loadingScenarios || loadingCompanies}
            />
          </TabsContent>

          <TabsContent value="correlations">
            <CrossMarketCorrelations 
              companies={companies}
              loading={loadingCompanies}
            />
          </TabsContent>

          <TabsContent value="landscape">
            <CompetitiveLandscape 
              companies={companies}
              scenarios={scenarios}
              loading={loadingCompanies || loadingScenarios}
            />
          </TabsContent>

          <TabsContent value="synergy">
            <SynergyRiskAnalysis 
              scenarios={scenarios}
              companies={companies}
              loading={loadingScenarios || loadingCompanies}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}