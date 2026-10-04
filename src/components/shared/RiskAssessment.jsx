import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Shield, TrendingDown, Loader2, RefreshCw } from "lucide-react";

export default function RiskAssessment({ type, data, context }) {
  const [riskData, setRiskData] = useState(null);

  const assessRiskMutation = useMutation({
    mutationFn: async () => {
      let prompt = "";
      
      if (type === "company") {
        prompt = `Conduct a comprehensive risk assessment for ${data.name} (${data.ticker || 'private company'}):

**Company Profile:**
- Sector: ${data.sector}
- Revenue: $${data.revenue}M
- EBITDA: $${data.ebitda}M
- Market Cap: $${data.market_cap}M
- Debt: $${data.total_debt}M
- Cash: $${data.cash}M
- Debt/EBITDA Ratio: ${data.ebitda > 0 ? (data.total_debt / data.ebitda).toFixed(2) : 'N/A'}

Analyze and identify:
1. **Financial Risks**: Leverage, liquidity, profitability concerns
2. **Market Risks**: Competition, market share erosion, pricing pressure
3. **Operational Risks**: Supply chain, capacity constraints, execution
4. **Regulatory Risks**: Compliance, antitrust, industry regulations
5. **ESG Risks**: Environmental, social, governance concerns
6. **Macroeconomic Risks**: Interest rates, economic cycles, industry trends

For each risk category, provide:
- Risk level (critical/high/medium/low)
- Description of the specific risk
- Potential financial impact
- Mitigation strategies
- Industry benchmarks and best practices`;
      } else if (type === "scenario") {
        const acquirer = context.companies?.find(c => c.id === data.acquirer_id);
        const targets = data.target_ids?.map(id => context.companies?.find(c => c.id === id)).filter(Boolean) || [];
        
        prompt = `Conduct M&A transaction risk assessment:

**Transaction Details:**
- Acquirer: ${acquirer?.name || 'Unknown'} ($${acquirer?.revenue}M revenue)
- Target(s): ${targets.map(t => `${t.name} ($${t.revenue}M revenue)`).join(', ')}
- Deal Structure: ${data.deal_structure?.cash_percentage}% cash, ${data.deal_structure?.stock_percentage}% stock
- Premium: ${data.deal_structure?.premium}%
- New Debt: $${data.deal_structure?.new_debt}M

**Financial Projections:**
- Revenue Synergies: $${data.synergies?.revenue_synergies}M
- Cost Synergies: $${data.synergies?.cost_synergies}M
- Integration Costs: $${data.synergies?.integration_costs}M
- Combined Debt: $${(acquirer?.total_debt || 0) + (data.deal_structure?.new_debt || 0)}M

Assess transaction risks:
1. **Integration Risks**: Cultural fit, systems integration, talent retention
2. **Financial Risks**: Leverage post-deal, financing availability, valuation
3. **Synergy Realization Risks**: Revenue synergy achievability, cost reduction execution
4. **Market/Competitive Risks**: Customer reaction, competitor response
5. **Regulatory Risks**: Antitrust approval, regulatory hurdles
6. **Strategic Risks**: Strategic fit, market timing, alternative opportunities

Provide risk scoring, impact analysis, and mitigation strategies.`;
      }

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            overall_risk_level: { type: "string" },
            risk_summary: { type: "string" },
            risk_categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  risk_level: { type: "string" },
                  score: { type: "number" },
                  description: { type: "string" },
                  potential_impact: { type: "string" },
                  financial_impact_range: { type: "string" },
                  mitigation_strategies: { type: "array", items: { type: "string" } },
                  industry_benchmarks: { type: "string" }
                }
              }
            },
            red_flags: { type: "array", items: { type: "string" } },
            key_monitoring_metrics: { type: "array", items: { type: "string" } }
          }
        }
      });

      return result;
    },
    onSuccess: (result) => {
      setRiskData(result);
    },
  });

  const riskLevelColors = {
    critical: "bg-red-100 text-red-800 border-red-300",
    high: "bg-orange-100 text-orange-800 border-orange-300",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
    low: "bg-emerald-100 text-emerald-800 border-emerald-300"
  };

  const riskLevelIcons = {
    critical: <AlertTriangle className="w-5 h-5 text-red-600" />,
    high: <AlertTriangle className="w-5 h-5 text-orange-600" />,
    medium: <TrendingDown className="w-5 h-5 text-yellow-600" />,
    low: <Shield className="w-5 h-5 text-emerald-600" />
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            AI-Powered Risk Assessment
          </CardTitle>
          <Button
            onClick={() => assessRiskMutation.mutate()}
            disabled={assessRiskMutation.isPending}
            variant="outline"
            size="sm"
          >
            {assessRiskMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : riskData ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </>
            ) : (
              "Run Assessment"
            )}
          </Button>
        </div>
      </CardHeader>

      {riskData && (
        <CardContent className="p-6 space-y-6">
          <div className={`p-4 rounded-lg border-2 ${riskLevelColors[riskData.overall_risk_level?.toLowerCase()] || riskLevelColors.medium}`}>
            <div className="flex items-start gap-3">
              {riskLevelIcons[riskData.overall_risk_level?.toLowerCase()] || riskLevelIcons.medium}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">Overall Risk Level: {riskData.overall_risk_level}</h3>
                  <Badge className="bg-slate-900 text-white">
                    Score: {riskData.overall_risk_score}/100
                  </Badge>
                </div>
                <p className="text-sm">{riskData.risk_summary}</p>
              </div>
            </div>
          </div>

          {riskData.red_flags && riskData.red_flags.length > 0 && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription>
                <p className="font-semibold text-red-900 mb-2">Critical Red Flags:</p>
                <ul className="space-y-1">
                  {riskData.red_flags.map((flag, idx) => (
                    <li key={idx} className="text-sm text-red-900">• {flag}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <h4 className="font-semibold text-slate-900">Risk Categories</h4>
            {riskData.risk_categories?.map((category, idx) => (
              <Card key={idx} className="border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h5 className="font-semibold text-slate-900">{category.category}</h5>
                        <Badge className={riskLevelColors[category.risk_level?.toLowerCase()] || ""}>
                          {category.risk_level} Risk
                        </Badge>
                        <Badge variant="outline">Score: {category.score}/100</Badge>
                      </div>
                      <p className="text-sm text-slate-700">{category.description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-xs font-semibold text-red-900 mb-1">Potential Impact:</p>
                    <p className="text-sm text-red-900">{category.potential_impact}</p>
                    {category.financial_impact_range && (
                      <p className="text-xs text-red-800 mt-1">
                        <strong>Financial Impact:</strong> {category.financial_impact_range}
                      </p>
                    )}
                  </div>

                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2">Mitigation Strategies:</p>
                    <ul className="space-y-1">
                      {category.mitigation_strategies?.map((strategy, i) => (
                        <li key={i} className="text-sm text-blue-900 flex items-start gap-2">
                          <span className="text-blue-600 mt-0.5">→</span>
                          {strategy}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {category.industry_benchmarks && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="text-xs font-semibold text-slate-900 mb-1">Industry Benchmarks:</p>
                      <p className="text-sm text-slate-700">{category.industry_benchmarks}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {riskData.key_monitoring_metrics && riskData.key_monitoring_metrics.length > 0 && (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h5 className="font-semibold text-blue-900 mb-3">Key Monitoring Metrics</h5>
              <div className="grid md:grid-cols-2 gap-2">
                {riskData.key_monitoring_metrics.map((metric, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span className="text-sm text-blue-900">{metric}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}

      {!riskData && !assessRiskMutation.isPending && (
        <CardContent className="p-12 text-center">
          <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600 mb-4">
            Click "Run Assessment" to analyze risks using AI with real-time market data
          </p>
        </CardContent>
      )}
    </Card>
  );
}