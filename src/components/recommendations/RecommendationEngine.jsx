import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Target, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function RecommendationEngine({ companies, scenarios, loading, onRecommendationsGenerated }) {
  const [criteria, setCriteria] = useState({
    acquirer_id: "",
    target_sectors: [],
    revenue_min: 0,
    revenue_max: 10000,
    market_share_min: 0,
    priority: "strategic_fit", // strategic_fit, financial_strength, market_expansion
    risk_tolerance: 50
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const availableSectors = [...new Set(companies.map(c => c.sector).filter(Boolean))];

  const handleGenerateRecommendations = async () => {
    if (!criteria.acquirer_id) {
      setError("Please select an acquiring company");
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const acquirer = companies.find(c => c.id === criteria.acquirer_id);
      
      // Filter potential targets based on criteria
      const potentialTargets = companies.filter(c => {
        if (c.id === criteria.acquirer_id) return false;
        if (criteria.target_sectors.length > 0 && !criteria.target_sectors.includes(c.sector)) return false;
        if (c.revenue < criteria.revenue_min || c.revenue > criteria.revenue_max) return false;
        if (c.market_share < criteria.market_share_min) return false;
        return true;
      });

      // Historical scenario analysis
      const historicalDeals = scenarios.filter(s => s.status === 'completed').map(s => ({
        acquirer: companies.find(c => c.id === s.acquirer_id)?.name,
        targets: s.target_ids?.map(id => companies.find(c => c.id === id)?.name).filter(Boolean),
        premium: s.deal_structure?.premium,
        synergies: s.synergies
      }));

      const prompt = `As an M&A advisor, analyze and recommend the top 5 acquisition targets for this company:

**Acquirer Profile:**
- Company: ${acquirer.name}
- Sector: ${acquirer.sector}
- Revenue: $${acquirer.revenue}M
- Market Cap: $${acquirer.market_cap}M
- Market Share: ${acquirer.market_share}%
- Financial Position: Debt $${acquirer.total_debt}M, Cash $${acquirer.cash}M

**Strategic Criteria:**
- Priority: ${criteria.priority}
- Risk Tolerance: ${criteria.risk_tolerance}/100
- Target Sectors: ${criteria.target_sectors.length > 0 ? criteria.target_sectors.join(", ") : "All sectors"}
- Revenue Range: $${criteria.revenue_min}M - $${criteria.revenue_max}M

**Potential Targets (${potentialTargets.length}):**
${potentialTargets.slice(0, 20).map(t => `- ${t.name}: ${t.sector}, $${t.revenue}M revenue, ${t.market_share}% share`).join("\n")}

**Historical Deal Context:**
${historicalDeals.slice(0, 5).map(d => `- ${d.acquirer} acquired ${d.targets?.join(", ")} at ${d.premium}% premium`).join("\n") || "No completed deals in database"}

Analyze market trends, competitive dynamics, and financial synergies to recommend the best targets with clear rationale.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target_company: { type: "string" },
                  recommendation_score: { type: "number" },
                  strategic_fit_score: { type: "number" },
                  financial_attractiveness: { type: "number" },
                  integration_complexity: { type: "number" },
                  rationale: { type: "string" },
                  key_synergies: { type: "array", items: { type: "string" } },
                  potential_risks: { type: "array", items: { type: "string" } },
                  estimated_premium: { type: "number" },
                  value_creation_potential: { type: "string" },
                  timeline_to_close: { type: "string" }
                }
              }
            },
            market_insights: { type: "string" },
            overall_strategy: { type: "string" }
          }
        }
      });

      // Enrich recommendations with company data
      const enrichedRecommendations = result.recommendations.map(rec => {
        const targetCompany = potentialTargets.find(c => 
          c.name.toLowerCase().includes(rec.target_company.toLowerCase()) ||
          rec.target_company.toLowerCase().includes(c.name.toLowerCase())
        );
        return {
          ...rec,
          company_data: targetCompany
        };
      });

      onRecommendationsGenerated({
        ...result,
        recommendations: enrichedRecommendations,
        acquirer,
        criteria
      });

    } catch (err) {
      console.error("Recommendation error:", err);
      setError(err.message || "Failed to generate recommendations");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSectorToggle = (sector) => {
    setCriteria(prev => ({
      ...prev,
      target_sectors: prev.target_sectors.includes(sector)
        ? prev.target_sectors.filter(s => s !== sector)
        : [...prev.target_sectors, sector]
    }));
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-600" />
          Define Acquisition Criteria
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Acquiring Company</Label>
            <Select value={criteria.acquirer_id} onValueChange={(val) => setCriteria({...criteria, acquirer_id: val})}>
              <SelectTrigger>
                <SelectValue placeholder="Select your company..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map(company => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name} - {company.sector}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Strategic Priority</Label>
            <Select value={criteria.priority} onValueChange={(val) => setCriteria({...criteria, priority: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strategic_fit">Strategic Fit & Synergies</SelectItem>
                <SelectItem value="financial_strength">Financial Strength & Stability</SelectItem>
                <SelectItem value="market_expansion">Market Expansion & Growth</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Target Sectors (Optional)</Label>
          <div className="flex flex-wrap gap-2">
            {availableSectors.map(sector => (
              <Badge
                key={sector}
                className={`cursor-pointer transition-colors ${
                  criteria.target_sectors.includes(sector)
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
                onClick={() => handleSectorToggle(sector)}
              >
                {sector}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Revenue Range (Min: ${criteria.revenue_min}M)</Label>
            <Slider
              value={[criteria.revenue_min]}
              onValueChange={([val]) => setCriteria({...criteria, revenue_min: val})}
              max={5000}
              step={100}
              className="mt-2"
            />
          </div>

          <div className="space-y-2">
            <Label>Revenue Range (Max: ${criteria.revenue_max}M)</Label>
            <Slider
              value={[criteria.revenue_max]}
              onValueChange={([val]) => setCriteria({...criteria, revenue_max: val})}
              min={100}
              max={10000}
              step={100}
              className="mt-2"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Risk Tolerance: {criteria.risk_tolerance}/100</Label>
          <Slider
            value={[criteria.risk_tolerance]}
            onValueChange={([val]) => setCriteria({...criteria, risk_tolerance: val})}
            max={100}
            className="mt-2"
          />
          <p className="text-xs text-slate-500">
            {criteria.risk_tolerance < 30 && "Conservative - Focus on stable, low-risk targets"}
            {criteria.risk_tolerance >= 30 && criteria.risk_tolerance < 70 && "Moderate - Balance risk and opportunity"}
            {criteria.risk_tolerance >= 70 && "Aggressive - Willing to pursue high-risk, high-reward targets"}
          </p>
        </div>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleGenerateRecommendations}
          disabled={!criteria.acquirer_id || analyzing || loading}
          className="w-full bg-purple-600 hover:bg-purple-700 h-12"
        >
          {analyzing ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
              Analyzing Market & Generating Recommendations...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 mr-2" />
              Generate AI Recommendations
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}