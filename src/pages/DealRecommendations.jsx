import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, Sparkles } from "lucide-react";
import RecommendationEngine from "../components/recommendations/RecommendationEngine";
import RecommendationResults from "../components/recommendations/RecommendationResults";

export default function DealRecommendations() {
  const [recommendations, setRecommendations] = useState(null);

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

  const { data: scenarios } = useQuery({
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Target className="w-6 h-6 text-white" />
              </div>
              Deal Recommendation Engine
            </h1>
            <p className="text-slate-600 mt-2">
              AI-powered analysis to identify optimal acquisition targets and strategic partners
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 border border-purple-200 rounded-lg">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-semibold text-purple-800">AI-Powered</span>
          </div>
        </div>

        <RecommendationEngine 
          companies={companies}
          scenarios={scenarios}
          loading={loadingCompanies}
          onRecommendationsGenerated={setRecommendations}
        />

        {recommendations && (
          <RecommendationResults 
            recommendations={recommendations}
            companies={companies}
          />
        )}
      </div>
    </div>
  );
}