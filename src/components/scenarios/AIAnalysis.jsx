import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Brain, AlertCircle, TrendingUp, Shield, Settings } from "lucide-react";
import { api } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AIAnalysis({ scenario, acquirer, companies }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
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

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);

    try {
      const target = companies.find(c => scenario.target_ids?.includes(c.id));
      
      const prompt = `You are an elite M&A advisor analyzing a potential merger. Provide a comprehensive analysis in JSON format.

**Deal Overview:**
- Acquirer: ${acquirer?.name || 'N/A'} (Revenue: $${acquirer?.revenue || 0}M, Market Cap: $${acquirer?.market_cap || 0}M, Market Share: ${acquirer?.market_share || 0}%)
- Target: ${target?.name || 'Target'} (Revenue: $${target?.revenue || 0}M, Market Cap: $${target?.market_cap || 0}M, Market Share: ${target?.market_share || 0}%)
- Premium: ${scenario.deal_structure?.premium || 0}%
- Deal Structure: ${scenario.deal_structure?.cash_percentage || 0}% Cash / ${scenario.deal_structure?.stock_percentage || 0}% Stock
- New Debt: $${scenario.deal_structure?.new_debt || 0}M
- Revenue Synergies: $${scenario.synergies?.revenue_synergies || 0}M
- Cost Synergies: $${scenario.synergies?.cost_synergies || 0}M
- Integration Costs: $${scenario.synergies?.integration_costs || 0}M

**Sectors:**
- Acquirer Sector: ${acquirer?.sector || 'Unknown'}
- Target Sector: ${target?.sector || 'Unknown'}

Analyze this deal across multiple dimensions and provide actionable insights.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt: prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: {
              type: "number",
              description: "Overall deal quality score from 0-100"
            },
            recommendation: {
              type: "string",
              enum: ["Strong Buy", "Proceed with Caution", "Recommend Against", "Needs More Data"],
              description: "Executive recommendation"
            },
            strategic_fit: {
              type: "object",
              properties: {
                score: { type: "number" },
                rationale: { type: "string" },
                key_synergies: { type: "array", items: { type: "string" } }
              }
            },
            financial_analysis: {
              type: "object",
              properties: {
                valuation_assessment: { type: "string" },
                premium_justification: { type: "string" },
                synergy_realism: { type: "string" },
                leverage_concern: { type: "string" }
              }
            },
            risk_assessment: {
              type: "object",
              properties: {
                regulatory_risk: { type: "string", enum: ["Low", "Medium", "High"] },
                integration_risk: { type: "string", enum: ["Low", "Medium", "High"] },
                market_risk: { type: "string", enum: ["Low", "Medium", "High"] },
                key_risks: { type: "array", items: { type: "string" } }
              }
            },
            competitive_impact: {
              type: "object",
              properties: {
                market_position: { type: "string" },
                competitive_advantages: { type: "array", items: { type: "string" } },
                antitrust_concerns: { type: "string" }
              }
            },
            alternatives: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  suggestion: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            key_recommendations: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setAnalysis(result);
    } catch (err) {
      setError("Failed to generate AI analysis. Please check your AI backend configuration.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 75) return "text-emerald-600";
    if (score >= 50) return "text-amber-600";
    return "text-red-600";
  };

  const getRiskColor = (level) => {
    if (level === "Low") return "bg-emerald-100 text-emerald-800";
    if (level === "Medium") return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  const getRecommendationColor = (rec) => {
    if (rec === "Strong Buy") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (rec === "Proceed with Caution") return "bg-amber-100 text-amber-800 border-amber-200";
    if (rec === "Recommend Against") return "bg-red-100 text-red-800 border-red-200";
    return "bg-slate-100 text-slate-800 border-slate-200";
  };

  if (checkingConfig) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600" />
            <span className="text-sm text-slate-600">Checking AI configuration...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!aiConfigured) {
    return (
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-teal-600" />
            AI Deal Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Alert className="border-blue-200 bg-blue-50">
            <Settings className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <p className="font-medium mb-2">AI Backend Not Configured</p>
              <p className="text-sm mb-3">
                To use AI-powered deal analysis, please configure your OpenAI-compatible backend in settings.
              </p>
              <Link to={createPageUrl("Settings")}>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <Settings className="w-4 h-4 mr-2" />
                  Configure AI Backend
                </Button>
              </Link>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-teal-600" />
            AI Deal Analysis
          </CardTitle>
          <Button
            onClick={runAnalysis}
            disabled={loading}
            className="bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {loading ? "Analyzing..." : analysis ? "Re-analyze" : "Analyze Deal"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600" />
              <span className="text-sm text-slate-600">AI agents analyzing deal structure, market dynamics, and strategic fit...</span>
            </div>
            <Progress value={33} className="h-2" />
          </div>
        )}

        {!loading && !analysis && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gradient-to-br from-teal-100 to-teal-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <Brain className="w-8 h-8 text-teal-600" />
            </div>
            <p className="text-slate-600 mb-2">AI-Powered Deal Intelligence</p>
            <p className="text-sm text-slate-500">
              Get comprehensive analysis using your configured AI model
            </p>
          </div>
        )}

        {analysis && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6">
                <p className="text-sm text-slate-600 mb-2">Deal Quality Score</p>
                <p className={`text-5xl font-bold ${getScoreColor(analysis.overall_score)}`}>
                  {analysis.overall_score}
                  <span className="text-2xl">/100</span>
                </p>
                <Progress value={analysis.overall_score} className="h-2 mt-3" />
              </div>

              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6">
                <p className="text-sm text-slate-600 mb-3">Executive Recommendation</p>
                <Badge className={`text-lg px-4 py-2 ${getRecommendationColor(analysis.recommendation)}`}>
                  {analysis.recommendation}
                </Badge>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-6">
              <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-teal-600" />
                Strategic Fit Analysis
              </h4>
              <div className="bg-slate-50 rounded-lg p-4 mb-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-slate-600">Strategic Fit Score</span>
                  <span className="font-bold text-slate-900">{analysis.strategic_fit?.score}/100</span>
                </div>
                <Progress value={analysis.strategic_fit?.score} className="h-2" />
              </div>
              <p className="text-sm text-slate-700 mb-3">{analysis.strategic_fit?.rationale}</p>
              {analysis.strategic_fit?.key_synergies && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-900">Key Synergies Identified:</p>
                  {analysis.strategic_fit.key_synergies.map((synergy, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                      <span className="text-teal-600 mt-0.5">•</span>
                      <span>{synergy}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-6">
              <h4 className="font-semibold text-slate-900 mb-3">Financial Analysis</h4>
              <div className="grid gap-3">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-slate-900 mb-1">Valuation Assessment</p>
                  <p className="text-sm text-slate-600">{analysis.financial_analysis?.valuation_assessment}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-slate-900 mb-1">Premium Justification</p>
                  <p className="text-sm text-slate-600">{analysis.financial_analysis?.premium_justification}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-slate-900 mb-1">Synergy Realism</p>
                  <p className="text-sm text-slate-600">{analysis.financial_analysis?.synergy_realism}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-slate-900 mb-1">Leverage Analysis</p>
                  <p className="text-sm text-slate-600">{analysis.financial_analysis?.leverage_concern}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-6">
              <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-teal-600" />
                Risk Assessment
              </h4>
              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div className="text-center p-4 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-600 mb-2">Regulatory Risk</p>
                  <Badge className={getRiskColor(analysis.risk_assessment?.regulatory_risk)}>
                    {analysis.risk_assessment?.regulatory_risk}
                  </Badge>
                </div>
                <div className="text-center p-4 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-600 mb-2">Integration Risk</p>
                  <Badge className={getRiskColor(analysis.risk_assessment?.integration_risk)}>
                    {analysis.risk_assessment?.integration_risk}
                  </Badge>
                </div>
                <div className="text-center p-4 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-600 mb-2">Market Risk</p>
                  <Badge className={getRiskColor(analysis.risk_assessment?.market_risk)}>
                    {analysis.risk_assessment?.market_risk}
                  </Badge>
                </div>
              </div>
              {analysis.risk_assessment?.key_risks && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-900">Key Risks:</p>
                  {analysis.risk_assessment.key_risks.map((risk, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm text-slate-600 bg-amber-50 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <span>{risk}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-6">
              <h4 className="font-semibold text-slate-900 mb-3">Competitive Impact</h4>
              <div className="bg-slate-50 rounded-lg p-4 mb-3">
                <p className="text-sm font-medium text-slate-900 mb-1">Post-Merger Market Position</p>
                <p className="text-sm text-slate-600">{analysis.competitive_impact?.market_position}</p>
              </div>
              {analysis.competitive_impact?.competitive_advantages && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-slate-900 mb-2">Competitive Advantages:</p>
                  <div className="space-y-2">
                    {analysis.competitive_impact.competitive_advantages.map((advantage, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-emerald-600 mt-0.5">✓</span>
                        <span>{advantage}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-900 mb-1">Antitrust Concerns</p>
                <p className="text-sm text-amber-700">{analysis.competitive_impact?.antitrust_concerns}</p>
              </div>
            </div>

            {analysis.alternatives && analysis.alternatives.length > 0 && (
              <div className="border-t border-slate-200 pt-6">
                <h4 className="font-semibold text-slate-900 mb-3">Alternative Deal Structures</h4>
                <div className="space-y-3">
                  {analysis.alternatives.map((alt, idx) => (
                    <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-900 mb-1">{alt.suggestion}</p>
                      <p className="text-sm text-blue-700">{alt.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 pt-6">
              <h4 className="font-semibold text-slate-900 mb-3">Key Recommendations</h4>
              <div className="space-y-2">
                {analysis.key_recommendations?.map((rec, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                    <span className="text-teal-600 font-bold text-lg">{idx + 1}</span>
                    <p className="text-sm text-teal-900 flex-1">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}