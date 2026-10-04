import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TrendingUp, AlertTriangle, CheckCircle, Target, DollarSign, Calendar, Building2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function RecommendationResults({ recommendations, companies }) {
  const { recommendations: targets, market_insights, overall_strategy, acquirer } = recommendations;

  const getScoreColor = (score) => {
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-blue-600";
    if (score >= 40) return "text-amber-600";
    return "text-red-600";
  };

  const getScoreBgColor = (score) => {
    if (score >= 80) return "bg-emerald-100";
    if (score >= 60) return "bg-blue-100";
    if (score >= 40) return "bg-amber-100";
    return "bg-red-100";
  };

  return (
    <div className="space-y-6">
      <Alert className="border-blue-200 bg-blue-50">
        <Target className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <strong>Strategic Overview:</strong> {overall_strategy}
        </AlertDescription>
      </Alert>

      {market_insights && (
        <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-white">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-purple-600" />
              Market Intelligence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700">{market_insights}</p>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-4">
          Top {targets.length} Recommended Targets for {acquirer.name}
        </h2>
        <div className="space-y-4">
          {targets.map((target, idx) => (
            <Card key={idx} className="border-slate-200 shadow-sm hover:shadow-lg transition-all">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
                      #{idx + 1}
                    </div>
                    <div>
                      <CardTitle className="text-xl">{target.target_company}</CardTitle>
                      {target.company_data && (
                        <p className="text-sm text-slate-600 mt-1">
                          {target.company_data.sector} • ${(target.company_data.revenue / 1000).toFixed(1)}B Revenue • {target.company_data.market_share?.toFixed(1)}% Market Share
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-4xl font-bold ${getScoreColor(target.recommendation_score)}`}>
                      {target.recommendation_score}
                    </div>
                    <p className="text-xs text-slate-500 uppercase font-semibold">Overall Score</p>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="p-6 space-y-6">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-blue-900">Strategic Fit</span>
                      <span className="font-bold text-blue-600">{target.strategic_fit_score}</span>
                    </div>
                    <Progress value={target.strategic_fit_score} className="h-2" />
                  </div>
                  
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-emerald-900">Financial Attractiveness</span>
                      <span className="font-bold text-emerald-600">{target.financial_attractiveness}</span>
                    </div>
                    <Progress value={target.financial_attractiveness} className="h-2" />
                  </div>
                  
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-amber-900">Integration Complexity</span>
                      <span className="font-bold text-amber-600">{target.integration_complexity}</span>
                    </div>
                    <Progress value={target.integration_complexity} className="h-2" />
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <h4 className="font-semibold text-slate-900 mb-2">Strategic Rationale</h4>
                  <p className="text-slate-700">{target.rationale}</p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                      Key Synergies
                    </h4>
                    <ul className="space-y-2">
                      {target.key_synergies?.map((synergy, i) => (
                        <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2 flex-shrink-0" />
                          {synergy}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      Potential Risks
                    </h4>
                    <ul className="space-y-2">
                      {target.potential_risks?.map((risk, i) => (
                        <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-2 flex-shrink-0" />
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-3">
                    <DollarSign className="w-5 h-5 text-purple-600" />
                    <div>
                      <p className="text-xs text-slate-500">Est. Premium</p>
                      <p className="font-semibold text-slate-900">{target.estimated_premium}%</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-purple-600" />
                    <div>
                      <p className="text-xs text-slate-500">Timeline</p>
                      <p className="font-semibold text-slate-900">{target.timeline_to_close}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                    <div>
                      <p className="text-xs text-slate-500">Value Creation</p>
                      <p className="font-semibold text-slate-900">{target.value_creation_potential}</p>
                    </div>
                  </div>
                </div>

                <Button className="w-full bg-purple-600 hover:bg-purple-700">
                  <Building2 className="w-4 h-4 mr-2" />
                  Create Scenario for {target.target_company}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}