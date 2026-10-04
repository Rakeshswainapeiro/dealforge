import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, RefreshCw, Download } from "lucide-react";
import { api } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";

export default function AIFinancialAnalyst({ company, allCompanies }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [factChecking, setFactChecking] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [verifiedData, setVerifiedData] = useState(null);
  const queryClient = useQueryClient();

  const handleAnalyze = async (withFactCheck = false) => {
    if (withFactCheck) {
      setFactChecking(true);
    } else {
      setAnalyzing(true);
    }

    try {
      const peerCompanies = allCompanies
        .filter(c => c.sector === company.sector && c.id !== company.id)
        .slice(0, 5);

      const currency = company.currency || "USD";
      const exchange = company.exchange || "Unknown";

      const prompt = `Perform comprehensive financial analyst deep-dive on ${company.name} (${company.ticker || 'Private Company'})
Exchange: ${exchange}
Currency: ${currency}

${withFactCheck ? `**CRITICAL FACT-CHECK MODE:**
Fetch REAL-TIME data from multiple sources:
- Yahoo Finance - Current prices and financials
- Bloomberg/Reuters - Verified financial data
- Company investor relations - Latest filings
- SEC EDGAR / regulatory filings - Official data

Compare stored data vs verified data and identify discrepancies.

STORED DATA (to verify):
- Revenue: ${currency} ${company.revenue}M
- EBITDA: ${currency} ${company.ebitda}M  
- Net Income: ${currency} ${company.net_income}M
- Market Cap: ${currency} ${company.market_cap}M
- Enterprise Value: ${currency} ${company.enterprise_value}M
- Total Debt: ${currency} ${company.total_debt}M
- Cash: ${currency} ${company.cash}M
- Shares Outstanding: ${company.shares_outstanding}M
- Stock Price: ${currency} ${company.stock_price}
- Sector: ${company.sector}

Provide VERIFIED/CORRECTED data in ORIGINAL CURRENCY (${currency}).
` : `COMPANY FINANCIALS (Currency: ${currency}):
- Revenue: ${currency} ${company.revenue}M
- EBITDA: ${currency} ${company.ebitda}M  
- Net Income: ${currency} ${company.net_income}M
- Market Cap: ${currency} ${company.market_cap}M
- Enterprise Value: ${currency} ${company.enterprise_value}M
- Total Debt: ${currency} ${company.total_debt}M
- Cash: ${currency} ${company.cash}M
- Shares Outstanding: ${company.shares_outstanding}M
- Stock Price: ${currency} ${company.stock_price}
- Sector: ${company.sector}
`}

${peerCompanies.length > 0 ? `PEER COMPANIES IN ${company.sector}:
${peerCompanies.map(p => `- ${p.name}: Market Cap ${p.currency || 'USD'} ${p.market_cap}M, Revenue ${p.currency || 'USD'} ${p.revenue}M`).join('\n')}` : ''}

Provide a COMPREHENSIVE financial analysis including:

1. KEY FINANCIAL RATIOS:
   - P/E Ratio (Price-to-Earnings)
   - EV/Revenue Multiple
   - EV/EBITDA Multiple
   - Debt-to-Equity Ratio
   - ROE (Return on Equity) - estimate based on net income/implied equity
   - EBITDA Margin %
   - Net Profit Margin %
   - Current Ratio (if debt data suggests)

2. FINANCIAL HEALTH ASSESSMENT:
   - Overall financial strength (Strong/Moderate/Weak)
   - Liquidity position
   - Leverage analysis
   - Profitability assessment

3. VALUATION ANALYSIS:
   - Is the company overvalued or undervalued?
   - Comparison to sector peers
   - Key valuation discrepancies or opportunities
   - Fair value estimate range

4. GROWTH OPPORTUNITIES:
   - Revenue growth potential
   - Market expansion opportunities
   - Competitive advantages
   - Strategic initiatives

5. FINANCIAL RISKS:
   - High debt concerns
   - Profitability challenges
   - Market risks
   - Liquidity concerns
   - Other material risks

6. TREND ANALYSIS:
   - Historical performance indicators
   - Industry trends affecting the company
   - Future outlook

7. PEER COMPARISON:
   - How does it compare to sector peers?
   - Relative valuation positioning
   - Competitive positioning

${withFactCheck ? `8. FACT-CHECK RESULTS:
   - Data accuracy verification
   - Source reliability assessment
   - Any discrepancies found
   - Confidence level in provided data` : ''}

8. INVESTMENT RECOMMENDATION:
   - Buy/Hold/Sell recommendation
   - Target price range (if applicable)
   - Key catalysts to watch

Be thorough, data-driven, and provide actionable insights.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: withFactCheck,
        response_json_schema: {
          type: "object",
          properties: {
            financial_ratios: {
              type: "object",
              properties: {
                pe_ratio: { type: "number" },
                ev_revenue: { type: "number" },
                ev_ebitda: { type: "number" },
                debt_to_equity: { type: "number" },
                roe: { type: "number" },
                ebitda_margin: { type: "number" },
                net_margin: { type: "number" },
                current_ratio: { type: "number" }
              }
            },
            financial_health: {
              type: "object",
              properties: {
                overall_strength: { type: "string" },
                liquidity: { type: "string" },
                leverage: { type: "string" },
                profitability: { type: "string" }
              }
            },
            valuation: {
              type: "object",
              properties: {
                assessment: { type: "string" },
                fair_value_low: { type: "number" },
                fair_value_high: { type: "number" },
                vs_peers: { type: "string" },
                key_insights: { type: "array", items: { type: "string" } }
              }
            },
            growth_opportunities: {
              type: "array",
              items: { type: "string" }
            },
            financial_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  severity: { type: "string" },
                  description: { type: "string" }
                }
              }
            },
            trend_analysis: {
              type: "object",
              properties: {
                historical_performance: { type: "string" },
                industry_trends: { type: "string" },
                outlook: { type: "string" }
              }
            },
            peer_comparison: {
              type: "object",
              properties: {
                relative_valuation: { type: "string" },
                competitive_position: { type: "string" },
                key_differentiators: { type: "array", items: { type: "string" } }
              }
            },
            fact_check: {
              type: "object",
              properties: {
                data_accuracy: { type: "string" },
                discrepancies: { type: "array", items: { type: "string" } },
                confidence_level: { type: "string" },
                verified_sources: { type: "array", items: { type: "string" } }
              }
            },
            verified_financials: {
              type: "object",
              properties: {
                currency: { type: "string" },
                exchange: { type: "string" },
                revenue: { type: "number" },
                ebitda: { type: "number" },
                net_income: { type: "number" },
                market_cap: { type: "number" },
                enterprise_value: { type: "number" },
                shares_outstanding: { type: "number" },
                stock_price: { type: "number" },
                total_debt: { type: "number" },
                cash: { type: "number" },
                last_data_sync: { type: "string" }
              }
            },
            recommendation: {
              type: "object",
              properties: {
                action: { type: "string" },
                target_low: { type: "number" },
                target_high: { type: "number" },
                catalysts: { type: "array", items: { type: "string" } },
                summary: { type: "string" }
              }
            }
          }
        }
      });

      setAnalysis(result);
      
      // If fact-checking and verified financials are available, store them
      if (withFactCheck && result.verified_financials) {
        setVerifiedData(result.verified_financials);
      }
    } catch (err) {
      console.error("Analysis error:", err);
      alert("Failed to perform analysis: " + err.message);
    } finally {
      setAnalyzing(false);
      setFactChecking(false);
    }
  };

  const getSeverityColor = (severity) => {
    if (!severity) return "bg-slate-100 text-slate-700";
    const s = severity.toLowerCase();
    if (s.includes("high") || s.includes("critical")) return "bg-red-100 text-red-700";
    if (s.includes("medium") || s.includes("moderate")) return "bg-yellow-100 text-yellow-700";
    return "bg-blue-100 text-blue-700";
  };

  const getRecommendationColor = (action) => {
    if (!action) return "bg-slate-100 text-slate-700";
    const a = action.toLowerCase();
    if (a.includes("buy") || a.includes("strong buy")) return "bg-green-100 text-green-700";
    if (a.includes("sell")) return "bg-red-100 text-red-700";
    return "bg-yellow-100 text-yellow-700";
  };

  const handleUpdateCompanyData = async () => {
    if (!verifiedData) return;
    
    try {
      await api.entities.Company.update(company.id, {
        currency: verifiedData.currency || company.currency,
        exchange: verifiedData.exchange || company.exchange,
        revenue: verifiedData.revenue || company.revenue,
        ebitda: verifiedData.ebitda || company.ebitda,
        net_income: verifiedData.net_income || company.net_income,
        market_cap: verifiedData.market_cap || company.market_cap,
        enterprise_value: verifiedData.enterprise_value || company.enterprise_value,
        shares_outstanding: verifiedData.shares_outstanding || company.shares_outstanding,
        stock_price: verifiedData.stock_price || company.stock_price,
        total_debt: verifiedData.total_debt || company.total_debt,
        cash: verifiedData.cash || company.cash,
        last_data_sync: verifiedData.last_data_sync || new Date().toISOString()
      });
      
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert("Company data updated successfully with verified financials!");
      setVerifiedData(null);
    } catch (err) {
      console.error("Update error:", err);
      alert("Failed to update company data: " + err.message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              AI Financial Analyst Deep-Dive
            </CardTitle>
            <div className="flex gap-2">
              <Button 
                onClick={() => handleAnalyze(false)}
                disabled={analyzing || factChecking}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Analyze
                  </>
                )}
              </Button>
              <Button 
                onClick={() => handleAnalyze(true)}
                disabled={analyzing || factChecking}
                variant="outline"
                className="border-blue-600 text-blue-600 hover:bg-blue-50"
              >
                {factChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Fact-Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Analyze + Fact-Check
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {analysis && (
        <div className="space-y-4">
          {/* Fact-Check Results */}
          {analysis.fact_check && analysis.fact_check.confidence_level && (
            <Alert className="border-blue-200 bg-blue-50">
              <CheckCircle className="w-4 h-4 text-blue-600" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-blue-900">Fact-Check Results</p>
                      <div className="text-sm text-blue-800">
                        <p><strong>Data Accuracy:</strong> {analysis.fact_check.data_accuracy}</p>
                        <p><strong>Confidence Level:</strong> {analysis.fact_check.confidence_level}</p>
                        {analysis.fact_check.discrepancies && analysis.fact_check.discrepancies.length > 0 && (
                          <div className="mt-2">
                            <strong>Discrepancies Found:</strong>
                            <ul className="list-disc list-inside ml-2 mt-1">
                              {analysis.fact_check.discrepancies.map((disc, idx) => (
                                <li key={idx}>{disc}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.fact_check.verified_sources && analysis.fact_check.verified_sources.length > 0 && (
                          <div className="mt-2">
                            <strong>Sources Verified:</strong> {analysis.fact_check.verified_sources.join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                    {verifiedData && (
                      <Button 
                        onClick={handleUpdateCompanyData}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 ml-3"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Update Company Data
                      </Button>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Verified Financials Comparison */}
          {verifiedData && (
            <Card className="border-green-200 bg-green-50">
              <CardHeader>
                <CardTitle className="text-lg text-green-900">Verified Financial Data</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {verifiedData.revenue && (
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs text-slate-600">Revenue (Verified)</p>
                      <p className="text-lg font-bold text-green-700">
                        {verifiedData.currency || company.currency} {verifiedData.revenue.toFixed(0)}M
                      </p>
                      {company.revenue !== verifiedData.revenue && (
                        <p className="text-xs text-slate-500">
                          Current: {company.currency} {company.revenue.toFixed(0)}M
                        </p>
                      )}
                    </div>
                  )}
                  {verifiedData.market_cap && (
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs text-slate-600">Market Cap (Verified)</p>
                      <p className="text-lg font-bold text-green-700">
                        {verifiedData.currency || company.currency} {verifiedData.market_cap.toFixed(0)}M
                      </p>
                      {company.market_cap !== verifiedData.market_cap && (
                        <p className="text-xs text-slate-500">
                          Current: {company.currency} {company.market_cap.toFixed(0)}M
                        </p>
                      )}
                    </div>
                  )}
                  {verifiedData.stock_price && (
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs text-slate-600">Stock Price (Verified)</p>
                      <p className="text-lg font-bold text-green-700">
                        {verifiedData.currency || company.currency} {verifiedData.stock_price.toFixed(2)}
                      </p>
                      {company.stock_price !== verifiedData.stock_price && (
                        <p className="text-xs text-slate-500">
                          Current: {company.currency} {company.stock_price.toFixed(2)}
                        </p>
                      )}
                    </div>
                  )}
                  {verifiedData.ebitda && (
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs text-slate-600">EBITDA (Verified)</p>
                      <p className="text-lg font-bold text-green-700">
                        {verifiedData.currency || company.currency} {verifiedData.ebitda.toFixed(0)}M
                      </p>
                      {company.ebitda !== verifiedData.ebitda && (
                        <p className="text-xs text-slate-500">
                          Current: {company.currency} {company.ebitda.toFixed(0)}M
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-green-800 mt-3">
                  Click "Update Company Data" to replace stored values with verified data from multiple sources.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Investment Recommendation */}
          {analysis.recommendation && (
            <Card className="border-2 border-purple-200">
              <CardHeader className="bg-gradient-to-br from-purple-50 to-white">
                <CardTitle className="text-lg">Investment Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Badge className={`${getRecommendationColor(analysis.recommendation.action)} text-lg px-4 py-2`}>
                    {analysis.recommendation.action}
                  </Badge>
                  {analysis.recommendation.target_low && analysis.recommendation.target_high && (
                    <span className="text-slate-700">
                      Target: ${analysis.recommendation.target_low} - ${analysis.recommendation.target_high}
                    </span>
                  )}
                </div>
                <p className="text-slate-700">{analysis.recommendation.summary}</p>
                {analysis.recommendation.catalysts && analysis.recommendation.catalysts.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Key Catalysts:</p>
                    <ul className="space-y-1">
                      {analysis.recommendation.catalysts.map((catalyst, idx) => (
                        <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                          <TrendingUp className="w-4 h-4 text-purple-600 mt-0.5" />
                          {catalyst}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Key Financial Ratios */}
          {analysis.financial_ratios && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Key Financial Ratios</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {analysis.financial_ratios.pe_ratio && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">P/E Ratio</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.pe_ratio.toFixed(2)}x</p>
                    </div>
                  )}
                  {analysis.financial_ratios.ev_revenue && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">EV/Revenue</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.ev_revenue.toFixed(2)}x</p>
                    </div>
                  )}
                  {analysis.financial_ratios.ev_ebitda && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">EV/EBITDA</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.ev_ebitda.toFixed(2)}x</p>
                    </div>
                  )}
                  {analysis.financial_ratios.debt_to_equity && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">Debt/Equity</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.debt_to_equity.toFixed(2)}x</p>
                    </div>
                  )}
                  {analysis.financial_ratios.roe && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">ROE</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.roe.toFixed(1)}%</p>
                    </div>
                  )}
                  {analysis.financial_ratios.ebitda_margin && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">EBITDA Margin</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.ebitda_margin.toFixed(1)}%</p>
                    </div>
                  )}
                  {analysis.financial_ratios.net_margin && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">Net Margin</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.net_margin.toFixed(1)}%</p>
                    </div>
                  )}
                  {analysis.financial_ratios.current_ratio && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">Current Ratio</p>
                      <p className="text-xl font-bold text-slate-900">{analysis.financial_ratios.current_ratio.toFixed(2)}x</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Financial Health */}
          {analysis.financial_health && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Financial Health Assessment</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {analysis.financial_health.overall_strength && (
                    <div>
                      <p className="text-sm text-slate-600 mb-1">Overall Strength</p>
                      <Badge className="bg-teal-100 text-teal-800">{analysis.financial_health.overall_strength}</Badge>
                    </div>
                  )}
                  {analysis.financial_health.liquidity && (
                    <div>
                      <p className="text-sm text-slate-600 mb-1">Liquidity</p>
                      <p className="text-sm text-slate-900">{analysis.financial_health.liquidity}</p>
                    </div>
                  )}
                  {analysis.financial_health.leverage && (
                    <div>
                      <p className="text-sm text-slate-600 mb-1">Leverage</p>
                      <p className="text-sm text-slate-900">{analysis.financial_health.leverage}</p>
                    </div>
                  )}
                  {analysis.financial_health.profitability && (
                    <div>
                      <p className="text-sm text-slate-600 mb-1">Profitability</p>
                      <p className="text-sm text-slate-900">{analysis.financial_health.profitability}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Valuation Analysis */}
            {analysis.valuation && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                    Valuation Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Badge className="bg-blue-100 text-blue-800">{analysis.valuation.assessment}</Badge>
                  </div>
                  {analysis.valuation.fair_value_low && analysis.valuation.fair_value_high && (
                    <p className="text-sm text-slate-700">
                      <strong>Fair Value Range:</strong> ${analysis.valuation.fair_value_low} - ${analysis.valuation.fair_value_high}
                    </p>
                  )}
                  {analysis.valuation.vs_peers && (
                    <p className="text-sm text-slate-700">
                      <strong>vs Peers:</strong> {analysis.valuation.vs_peers}
                    </p>
                  )}
                  {analysis.valuation.key_insights && analysis.valuation.key_insights.length > 0 && (
                    <ul className="space-y-1">
                      {analysis.valuation.key_insights.map((insight, idx) => (
                        <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                          <span className="text-teal-600">•</span>
                          {insight}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Financial Risks */}
            {analysis.financial_risks && analysis.financial_risks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    Financial Risks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {analysis.financial_risks.map((risk, idx) => (
                      <div key={idx} className="border-l-4 border-red-400 pl-3">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-slate-900 text-sm">{risk.risk}</p>
                          <Badge className={getSeverityColor(risk.severity)}>{risk.severity}</Badge>
                        </div>
                        <p className="text-xs text-slate-600">{risk.description}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Growth Opportunities */}
          {analysis.growth_opportunities && analysis.growth_opportunities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  Growth Opportunities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.growth_opportunities.map((opp, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                      {opp}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Trend Analysis */}
          {analysis.trend_analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Trend Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analysis.trend_analysis.historical_performance && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Historical Performance</p>
                    <p className="text-sm text-slate-600">{analysis.trend_analysis.historical_performance}</p>
                  </div>
                )}
                {analysis.trend_analysis.industry_trends && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Industry Trends</p>
                    <p className="text-sm text-slate-600">{analysis.trend_analysis.industry_trends}</p>
                  </div>
                )}
                {analysis.trend_analysis.outlook && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Future Outlook</p>
                    <p className="text-sm text-slate-600">{analysis.trend_analysis.outlook}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Peer Comparison */}
          {analysis.peer_comparison && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Peer Comparison</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analysis.peer_comparison.relative_valuation && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Relative Valuation</p>
                    <p className="text-sm text-slate-600">{analysis.peer_comparison.relative_valuation}</p>
                  </div>
                )}
                {analysis.peer_comparison.competitive_position && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Competitive Position</p>
                    <p className="text-sm text-slate-600">{analysis.peer_comparison.competitive_position}</p>
                  </div>
                )}
                {analysis.peer_comparison.key_differentiators && analysis.peer_comparison.key_differentiators.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Key Differentiators</p>
                    <ul className="space-y-1">
                      {analysis.peer_comparison.key_differentiators.map((diff, idx) => (
                        <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                          <span className="text-purple-600">•</span>
                          {diff}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!analysis && !analyzing && !factChecking && (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 mb-2">
              Click "Analyze" for comprehensive AI-powered financial analysis
            </p>
            <p className="text-sm text-slate-500">
              Or use "Analyze + Fact-Check" to verify data from multiple sources
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}