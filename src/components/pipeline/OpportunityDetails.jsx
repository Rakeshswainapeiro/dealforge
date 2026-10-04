import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, TrendingUp, AlertTriangle, Lightbulb, Newspaper, Target, FileText } from "lucide-react";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import DealMemoGenerator from "./DealMemoGenerator";

export default function OpportunityDetails({ opportunity, companies, onBack }) {
  const [showMemoGenerator, setShowMemoGenerator] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const updateMutation = useMutation({
    mutationFn: async (updates) => {
      return await api.entities.DealOpportunity.update(opportunity.id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealOpportunities'] });
    },
  });

  const priorityColors = {
    high: "bg-red-100 text-red-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-emerald-100 text-emerald-800"
  };

  const statusColors = {
    new: "bg-slate-100 text-slate-800",
    reviewing: "bg-blue-100 text-blue-800",
    pursuing: "bg-purple-100 text-purple-800",
    rejected: "bg-red-100 text-red-800",
    converted: "bg-emerald-100 text-emerald-800"
  };

  const handleCreateScenario = () => {
    navigate(createPageUrl("Scenarios"));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {showMemoGenerator && (
          <DealMemoGenerator 
            opportunity={opportunity} 
            onClose={() => setShowMemoGenerator(false)} 
          />
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{opportunity.target_name}</h1>
              <p className="text-slate-600 mt-1">{opportunity.target_sector} • {opportunity.opportunity_type.replace('_', ' ')}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setShowMemoGenerator(true)} variant="outline" className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
              <FileText className="w-4 h-4 mr-2" />
              Generate Deal Memo
            </Button>
            <Button onClick={handleCreateScenario} className="bg-purple-600 hover:bg-purple-700">
              <Target className="w-4 h-4 mr-2" />
              Create Scenario
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Estimated Value</p>
              <p className="text-3xl font-bold text-slate-900">
                ${(opportunity.estimated_value / 1000).toFixed(1)}B
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Strategic Fit</p>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold text-emerald-600">{opportunity.strategic_fit_score}</p>
                <span className="text-slate-600">/100</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Risk Score</p>
              <div className="flex items-center gap-2">
                <p className={`text-3xl font-bold ${opportunity.risk_score > 60 ? 'text-red-600' : 'text-amber-600'}`}>
                  {opportunity.risk_score}
                </p>
                <span className="text-slate-600">/100</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Revenue</p>
              <p className="text-3xl font-bold text-slate-900">
                ${opportunity.target_revenue}M
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Card className="border-slate-200">
            <CardContent className="p-4">
              <label className="text-sm font-medium text-slate-700 mb-2 block">Status</label>
              <Select 
                value={opportunity.status} 
                onValueChange={(val) => updateMutation.mutate({ status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="reviewing">Reviewing</SelectItem>
                  <SelectItem value="pursuing">Pursuing</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-4">
              <label className="text-sm font-medium text-slate-700 mb-2 block">Priority</label>
              <Select 
                value={opportunity.priority} 
                onValueChange={(val) => updateMutation.mutate({ priority: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-4 flex items-center justify-center gap-4">
              <Badge className={statusColors[opportunity.status]}>
                {opportunity.status}
              </Badge>
              <Badge className={priorityColors[opportunity.priority]}>
                {opportunity.priority} priority
              </Badge>
            </CardContent>
          </Card>
        </div>

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <TrendingUp className="w-5 h-5" />
              AI Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-blue-900">{opportunity.ai_summary}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-teal-600" />
              Strategic Rationale
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700 whitespace-pre-wrap">{opportunity.strategic_rationale}</p>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="border-emerald-200 bg-emerald-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-900">
                <TrendingUp className="w-5 h-5" />
                Key Synergies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {opportunity.key_synergies?.map((synergy, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-emerald-900">
                    <span className="text-emerald-600 mt-1">✓</span>
                    {synergy}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-900">
                <AlertTriangle className="w-5 h-5" />
                Risk Factors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {opportunity.risk_factors?.map((risk, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-red-900">
                    <span className="text-red-600 mt-1">⚠</span>
                    {risk}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {opportunity.news_sources && opportunity.news_sources.length > 0 && (
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-teal-600" />
                News Sources & Market Signals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {opportunity.news_sources.map((source, idx) => (
                  <li key={idx} className="text-sm text-slate-700">
                    • {source}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {opportunity.market_trends && opportunity.market_trends.length > 0 && (
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal-600" />
                Relevant Market Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {opportunity.market_trends.map((trend, idx) => (
                  <Badge key={idx} variant="outline">{trend}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}