import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Sparkles, AlertTriangle, CheckCircle, TrendingUp, Shield } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend } from "recharts";

export default function SynergyRiskAnalysis({ scenarios, companies, loading }) {
  const [selectedScenario, setSelectedScenario] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const generateAIAnalysis = async () => {
    const scenario = scenarios.find(s => s.id === selectedScenario);
    if (!scenario) return;

    setAnalyzing(true);
    setError(null);

    try {
      const acquirer = companies.find(c => c.id === scenario.acquirer_id);
      const targets = scenario.target_ids?.map(id => companies.find(c => c.id === id)).filter(Boolean) || [];

      const prompt = `Analyze this M&A scenario for synergies and risks:

**Acquirer:** ${acquirer?.name} (Sector: ${acquirer?.sector}, Revenue: $${acquirer?.revenue}M, Market Cap: $${acquirer?.market_cap}M)
**Target(s):** ${targets.map(t => `${t.name} ($${t.revenue}M revenue)`).join(", ")}

**Deal Structure:**
- Premium: ${scenario.deal_structure?.premium || 0}%
- Cash: ${scenario.deal_structure?.cash_percentage || 0}%
- Stock: ${scenario.deal_structure?.stock_percentage || 0}%

**Proposed Synergies:**
- Revenue synergies: $${scenario.synergies?.revenue_synergies || 0}M
- Cost synergies: $${scenario.synergies?.cost_synergies || 0}M
- Integration costs: $${scenario.synergies?.integration_costs || 0}M

Provide a comprehensive analysis of potential synergies and risks across multiple dimensions.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            synergies: {
              type: "object",
              properties: {
                revenue: { type: "array", items: { type: "string" } },
                cost: { type: "array", items: { type: "string" } },
                operational: { type: "array", items: { type: "string" } },
                strategic: { type: "array", items: { type: "string" } }
              }
            },
            risks: {
              type: "object",
              properties: {
                integration: { type: "array", items: { type: "string" } },
                cultural: { type: "array", items: { type: "string" } },
                regulatory: { type: "array", items: { type: "string" } },
                market: { type: "array", items: { type: "string" } },
                financial: { type: "array", items: { type: "string" } }
              }
            },
            scores: {
              type: "object",
              properties: {
                synergy_potential: { type: "number" },
                integration_difficulty: { type: "number" },
                regulatory_risk: { type: "number" },
                strategic_fit: { type: "number" },
                value_creation: { type: "number" }
              }
            },
            overall_assessment: { type: "string" },
            key_recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setAnalysis(result);
    } catch (err) {
      setError(err.message || "Failed to generate AI analysis");
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-12">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const radarData = analysis?.scores ? [
    { subject: 'Synergy Potential', A: analysis.scores.synergy_potential || 0, fullMark: 100 },
    { subject: 'Strategic Fit', A: analysis.scores.strategic_fit || 0, fullMark: 100 },
    { subject: 'Value Creation', A: analysis.scores.value_creation || 0, fullMark: 100 },
    { subject: 'Integration Ease', A: 100 - (analysis.scores.integration_difficulty || 0), fullMark: 100 },
    { subject: 'Regulatory Safety', A: 100 - (analysis.scores.regulatory_risk || 0), fullMark: 100 }
  ] : [];

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-teal-600" />
              AI-Driven Synergy & Risk Analysis
            </CardTitle>
            <Badge className="bg-purple-100 text-purple-800">
              <Sparkles className="w-3 h-3 mr-1" />
              AI-Powered
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex gap-3">
              <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a scenario to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map(scenario => (
                    <SelectItem key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={generateAIAnalysis}
                disabled={!selectedScenario || analyzing}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {analyzing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Analyze with AI
                  </>
                )}
              </Button>
            </div>

            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-900">{error}</AlertDescription>
              </Alert>
            )}

            {analysis && (
              <>
                <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-white">
                  <CardHeader>
                    <CardTitle className="text-lg">Deal Quality Assessment</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Radar name="Score" dataKey="A" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.6} />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="border-emerald-200 bg-emerald-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                        Synergy Opportunities
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {analysis.synergies?.revenue && analysis.synergies.revenue.length > 0 && (
                        <div>
                          <Badge className="bg-blue-100 text-blue-800 mb-2">Revenue</Badge>
                          <ul className="space-y-1">
                            {analysis.synergies.revenue.map((item, idx) => (
                              <li key={idx} className="text-sm text-emerald-900 flex items-start gap-2">
                                <TrendingUp className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analysis.synergies?.cost && analysis.synergies.cost.length > 0 && (
                        <div>
                          <Badge className="bg-purple-100 text-purple-800 mb-2">Cost</Badge>
                          <ul className="space-y-1">
                            {analysis.synergies.cost.map((item, idx) => (
                              <li key={idx} className="text-sm text-emerald-900 flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-red-200 bg-red-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                        Risk Factors
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {analysis.risks?.integration && analysis.risks.integration.length > 0 && (
                        <div>
                          <Badge className="bg-amber-100 text-amber-800 mb-2">Integration</Badge>
                          <ul className="space-y-1">
                            {analysis.risks.integration.map((item, idx) => (
                              <li key={idx} className="text-sm text-red-900 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analysis.risks?.regulatory && analysis.risks.regulatory.length > 0 && (
                        <div>
                          <Badge className="bg-red-100 text-red-800 mb-2">Regulatory</Badge>
                          <ul className="space-y-1">
                            {analysis.risks.regulatory.map((item, idx) => (
                              <li key={idx} className="text-sm text-red-900 flex items-start gap-2">
                                <Shield className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-blue-200 bg-blue-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Overall Assessment</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-blue-900 mb-4">{analysis.overall_assessment}</p>
                    {analysis.key_recommendations && analysis.key_recommendations.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-blue-900 mb-2">Key Recommendations:</h4>
                        <ul className="space-y-2">
                          {analysis.key_recommendations.map((rec, idx) => (
                            <li key={idx} className="text-sm text-blue-800 flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}