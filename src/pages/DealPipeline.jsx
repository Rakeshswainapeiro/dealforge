import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Search, Filter } from "lucide-react";
import DealSourcer from "../components/pipeline/DealSourcer";
import PipelineBoard from "../components/pipeline/PipelineBoard";
import OpportunityDetails from "../components/pipeline/OpportunityDetails";
import PipelineFilters from "../components/pipeline/PipelineFilters";
import AcquirerProfileManager from "../components/pipeline/AcquirerProfileManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function DealPipeline() {
  const [showSourcer, setShowSourcer] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [filters, setFilters] = useState({
    sector: "all",
    opportunity_type: "all",
    status: "all",
    priority: "all"
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: opportunities, isLoading } = useQuery({
    queryKey: ['dealOpportunities'],
    queryFn: async () => {
      const all = await api.entities.DealOpportunity.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') return all;
      
      return all.filter(opp => {
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

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const all = await api.entities.Company.list();
      const user = await api.auth.me();
      
      if (user.role === 'admin') return all;
      
      return all.filter(company => {
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

  const filteredOpportunities = opportunities.filter(opp => {
    if (filters.sector !== "all" && opp.target_sector !== filters.sector) return false;
    if (filters.opportunity_type !== "all" && opp.opportunity_type !== filters.opportunity_type) return false;
    if (filters.status !== "all" && opp.status !== filters.status) return false;
    if (filters.priority !== "all" && opp.priority !== filters.priority) return false;
    return true;
  });

  if (selectedOpportunity) {
    return (
      <OpportunityDetails
        opportunity={selectedOpportunity}
        companies={companies}
        onBack={() => setSelectedOpportunity(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            Deal Pipeline
          </h1>
          <p className="text-slate-600 mt-2">
            AI-powered deal sourcing and opportunity tracking
          </p>
        </div>

        <Tabs defaultValue="pipeline" className="w-full">
          <TabsList>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="profiles">Acquirer Profiles</TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className="gap-2"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                </Button>
                <Button
                  onClick={() => setShowSourcer(true)}
                  className="bg-purple-600 hover:bg-purple-700 gap-2"
                >
                  <Search className="w-4 h-4" />
                  Source Deals
                </Button>
              </div>
            </div>

            {showSourcer && (
              <DealSourcer
                companies={companies}
                onClose={() => setShowSourcer(false)}
                onCreated={() => setShowSourcer(false)}
              />
            )}

            {showFilters && (
              <PipelineFilters
                filters={filters}
                onFilterChange={setFilters}
                opportunities={opportunities}
              />
            )}

            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{filteredOpportunities.length} opportunities in pipeline</span>
              <span>
                {filteredOpportunities.filter(o => o.status === 'new').length} new •{' '}
                {filteredOpportunities.filter(o => o.status === 'contacted').length} contacted •{' '}
                {filteredOpportunities.filter(o => o.status === 'due_diligence').length} due diligence •{' '}
                {filteredOpportunities.filter(o => o.status === 'negotiation').length} negotiation
              </span>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array(6).fill(0).map((_, i) => (
                  <div key={i} className="h-80 bg-white rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filteredOpportunities.length === 0 ? (
              <Card className="border-slate-200">
                <CardContent className="p-12 text-center">
                  <TrendingUp className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No Opportunities Yet</h3>
                  <p className="text-slate-600 mb-4">
                    Start sourcing deals using AI to identify potential targets
                  </p>
                  <Button onClick={() => setShowSourcer(true)} className="bg-purple-600 hover:bg-purple-700">
                    <Search className="w-4 h-4 mr-2" />
                    Source Deals
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <PipelineBoard
                opportunities={filteredOpportunities}
                onSelectOpportunity={setSelectedOpportunity}
              />
            )}
          </TabsContent>

          <TabsContent value="profiles">
            <AcquirerProfileManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}