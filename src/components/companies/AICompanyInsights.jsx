import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, 
  Sparkles, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2,
  Target,
  Settings
} from "lucide-react";
import { api } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AICompanyInsights({ company, allCompanies }) {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(true);

  useEffect(() => {
    checkAIConfiguration();
  }, []);

  const checkAIConfiguration = async () => {
    setCheckingConfig(true);
    try {
      const user = await api.auth.me();
      const configured = user?.ai_settings?.enabled && user?.ai_settings?.base_url;
      setAiConfigured(configured);
    } catch (err) {
      console.error("Error checking AI configuration:", err);
      setAiConfigured(false);
    } finally {
      setCheckingConfig(false);
    }
  };

  const generateInsights = async () => {
    setLoading(true);
    setError(null);

    try {
      const sectorPeers = allCompanies.filter(c => 
        c.sector === company.sector && c.id !== company.id
      );

      const avgPeerRevenue = sectorPeers.length > 0 
        ? sectorPeers.reduce((sum, c) => sum + (c.revenue || 0), 0) / sectorPeers.length 
        : 0;

      const avgPeerMarketCap = sectorPeers.length > 0 
        ? sectorPeers.reduce((sum, c) => sum + (c.market_cap || 0), 0) / sectorPeers.length 
        : 0;

      const prompt = `You are a strategic M&A advisor evaluating a company's acquisition attractiveness. Analyze the following company and provide detailed insights in JSON format.

**Company Profile:**
- Name: ${company.name}
- Sector: ${company.sector || 'Unknown'}
- Revenue: $${company.revenue}M
- EBITDA: $${company.ebitda}M
- Market Cap: $${company.market_cap}M
- Enterprise Value: $${company.enterprise_value}M
- Market Share: ${company.market_share || 0}%
- Total Debt: $${company.total_debt}M
- Cash: $${company.cash}M

**Sector Context:**
- Number of Peers: ${sectorPeers.length}
- Average Peer Revenue: $${avgPeerRevenue.toFixed(0)}M
- Average Peer Market Cap: $${avgPeerMarketCap.toFixed(0)}M

Provide a comprehensive strategic analysis of this company's position and acquisition attractiveness.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt: prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            acquisition_score: {
              type: "number",
              description: "Acquisition attractiveness score from 0-100"
            },
            recommendation: {
              type: "string",
              enum: ["Highly Attractive", "Moderately Attractive", "Low Priority", "Not Recommended"],
              description: "Overall acquisition recommendation"
            },
            strategic_position: {
              type: "object",
              properties: {
                strengths: { type: "array", items: { type: "string" } },
                weaknesses: { type: "array", items: { type: "string" } },
                market_position: { type: "string" }
              }
            },
            financial_health: {
              type: "object",
              properties: {
                assessment: { type: "string" },
                key_metrics: { type: "array", items: { type: "string" } },
                concerns: { type: "array", items: { type: "string" } }
              }
            },
            acquisition_rationale: {
              type: "object",
              properties: {
                strategic_fit_scenarios: { type: "array", items: { type: "string" } },
                potential_synergies: { type: "array", items: { type: "string" } },
                integration_complexity: { type: "string", enum: ["Low", "Medium", "High"] }
              }
            },
            valuation_analysis: {
              type: "object",
              properties: {
                fair_value_assessment: { type: "string" },
                comparable_positioning: { type: "string" },
                premium_guidance: { type: "string" }
              }
            },
            risks: {
              type: "array",
              items: { type: "string" }
            },
            target_acquirers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  profile: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            }
          },
          required: ["acquisition_score", "recommendation", "strategic_position", "financial_health"]
        }
      });

      setInsights(result);
    } catch (err) {
      setError(err.message || "Failed to generate insights. Please check your AI backend configuration.");
    } finally {
      setLoading(false);
    }
  };

  if (checkingConfig) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-slate-600">Checking AI configuration...</p>
        </CardContent>
      </Card>
    );
  }

  if (!aiConfigured) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-slate-400" />
            AI Strategic Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Settings className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="font-semibold text-slate-900 mb-2">AI Backend Not Configured</h3>
          <p className="text-slate-600 mb-6">
            Configure your AI backend to unlock strategic insights and acquisition analysis.
          </p>
          <Link to={createPageUrl("Settings")}>
            <Button className="bg-teal-600 hover:bg-teal-700">
              <Settings className="w-4 h-4 mr-2" />
              Configure AI Backend
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-teal-600" />
            AI Strategic Analysis
          </CardTitle>
          {!insights && (
            <Button 
              onClick={generateInsights}
              disabled={loading}
              className="bg-teal-600 hover:bg-teal-700"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Insights
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {error && (
          <Alert className="border-red-200 bg-red-50 mb-6">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        {!insights && !loading && !error && (
          <div className="text-center py-12">
            <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">
              Generate AI-powered strategic insights and acquisition analysis for {company.name}
            </p>
          </div>
        )}

        {loading && (
          <div className="space-y-4 py-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-3 px-4 py-2 bg-teal-50 rounded-full">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-600" />
                <span className="text-sm font-medium text-teal-900">AI is analyzing {company.name}...</span>
              </div>
            </div>
            <Progress value={33} className="mb-2" />
            <p className="text-sm text-center text-slate-600">Evaluating financial health, strategic position, and acquisition potential...</p>
          </div>
        )}

        {insights && (
          <div className="space-y-6">
            {/* Acquisition Score */}
            <div className="bg-gradient-to-br from-teal-50 to-blue-50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1">Acquisition Attractiveness</h3>
                  <Badge className={
                    insights.recommendation === "Highly Attractive" ? "bg-emerald-100 text-emerald-800" :
                    insights.recommendation === "Moderately Attractive" ? "bg-blue-100 text-blue-800" :
                    insights.recommendation === "Low Priority" ? "bg-amber-100 text-amber-800" :
                    "bg-red-100 text-red-800"
                  }>
                    {insights.recommendation}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold text-teal-600">{insights.acquisition_score}</div>
                  <div className="text-sm text-slate-600">/ 100</div>
                </div>
              </div>
              <Progress value={insights.acquisition_score} className="h-3" />
            </div>

            {/* Strategic Position */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-emerald-200 bg-emerald-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.strategic_position?.strengths?.map((strength, idx) => (
                      <li key={idx} className="text-sm text-emerald-900 flex items-start gap-2">
                        <span className="text-emerald-600 mt-1">•</span>
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-amber-200 bg-amber-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Weaknesses
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.strategic_position?.weaknesses?.map((weakness, idx) => (
                      <li key={idx} className="text-sm text-amber-900 flex items-start gap-2">
                        <span className="text-amber-600 mt-1">•</span>
                        <span>{weakness}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Financial Health */}
            <Card className="border-slate-200">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-teal-600" />
                  Financial Health Assessment
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <p className="text-slate-700 mb-4">{insights.financial_health?.assessment}</p>
                
                {insights.financial_health?.key_metrics && insights.financial_health.key_metrics.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-semibold text-slate-900 text-sm mb-2">Key Metrics:</h4>
                    <ul className="space-y-1">
                      {insights.financial_health.key_metrics.map((metric, idx) => (
                        <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                          <span>{metric}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {insights.financial_health?.concerns && insights.financial_health.concerns.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-slate-900 text-sm mb-2">Concerns:</h4>
                    <ul className="space-y-1">
                      {insights.financial_health.concerns.map((concern, idx) => (
                        <li key={idx} className="text-sm text-amber-700 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <span>{concern}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Acquisition Rationale */}
            {insights.acquisition_rationale && (
              <Card className="border-slate-200">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-teal-600" />
                    Acquisition Rationale
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {insights.acquisition_rationale.strategic_fit_scenarios && (
                    <div>
                      <h4 className="font-semibold text-slate-900 text-sm mb-2">Strategic Fit Scenarios:</h4>
                      <ul className="space-y-1">
                        {insights.acquisition_rationale.strategic_fit_scenarios.map((scenario, idx) => (
                          <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                            <span className="text-teal-600 mt-1">•</span>
                            <span>{scenario}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {insights.acquisition_rationale.potential_synergies && (
                    <div>
                      <h4 className="font-semibold text-slate-900 text-sm mb-2">Potential Synergies:</h4>
                      <ul className="space-y-1">
                        {insights.acquisition_rationale.potential_synergies.map((synergy, idx) => (
                          <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                            <span className="text-teal-600 mt-1">•</span>
                            <span>{synergy}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {insights.acquisition_rationale.integration_complexity && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <span className="text-sm font-semibold text-slate-700">Integration Complexity:</span>
                      <Badge className={
                        insights.acquisition_rationale.integration_complexity === "Low" ? "bg-emerald-100 text-emerald-800" :
                        insights.acquisition_rationale.integration_complexity === "Medium" ? "bg-amber-100 text-amber-800" :
                        "bg-red-100 text-red-800"
                      }>
                        {insights.acquisition_rationale.integration_complexity}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Valuation Analysis */}
            {insights.valuation_analysis && (
              <Card className="border-slate-200">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle>Valuation Analysis</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                  <div>
                    <h4 className="font-semibold text-slate-900 text-sm mb-1">Fair Value Assessment:</h4>
                    <p className="text-sm text-slate-700">{insights.valuation_analysis.fair_value_assessment}</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 text-sm mb-1">Comparable Positioning:</h4>
                    <p className="text-sm text-slate-700">{insights.valuation_analysis.comparable_positioning}</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 text-sm mb-1">Premium Guidance:</h4>
                    <p className="text-sm text-slate-700">{insights.valuation_analysis.premium_guidance}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Risks */}
            {insights.risks && insights.risks.length > 0 && (
              <Card className="border-red-200 bg-red-50">
                <CardHeader className="border-b border-red-100">
                  <CardTitle className="flex items-center gap-2 text-red-900">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    Key Risks
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <ul className="space-y-2">
                    {insights.risks.map((risk, idx) => (
                      <li key={idx} className="text-sm text-red-900 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Target Acquirers */}
            {insights.target_acquirers && insights.target_acquirers.length > 0 && (
              <Card className="border-slate-200">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle>Potential Acquirer Profiles</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    {insights.target_acquirers.map((acquirer, idx) => (
                      <div key={idx} className="p-4 bg-slate-50 rounded-lg">
                        <h4 className="font-semibold text-slate-900 mb-2">{acquirer.profile}</h4>
                        <p className="text-sm text-slate-700">{acquirer.rationale}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button 
                onClick={generateInsights}
                variant="outline"
                disabled={loading}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Regenerate Analysis
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}