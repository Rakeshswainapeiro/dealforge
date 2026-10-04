import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X, Loader2, TrendingUp } from "lucide-react";

export default function DealSourcer({ companies, onClose, onCreated }) {
  const [selectedProfile, setSelectedProfile] = useState("");
  const [criteria, setCriteria] = useState({
    sectors: [],
    min_revenue: "",
    max_revenue: "",
    min_ebitda: "",
    geography: "",
    deal_type: "acquisition"
  });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [foundOpportunities, setFoundOpportunities] = useState([]);
  const queryClient = useQueryClient();

  const { data: profiles } = useQuery({
    queryKey: ['acquirerProfiles'],
    queryFn: async () => {
      const all = await api.entities.AcquirerProfile.list('-updated_date');
      const user = await api.auth.me();
      if (user.role === 'admin') return all.filter(p => p.active);
      return all.filter(p => {
        if (!p.active) return false;
        if (p.created_by === user.email) return true;
        if (p.visibility === 'organization' && user.organization) return true;
        if (p.visibility === 'group' && p.shared_with_groups && user.groups) {
          return p.shared_with_groups.some(g => user.groups.includes(g));
        }
        return false;
      });
    },
    initialData: [],
  });

  const sectors = ["Technology", "Healthcare", "Financial Services", "Consumer Goods", "Energy", "Industrials", "Telecommunications"];

  const toggleSector = (sector) => {
    setCriteria(prev => ({
      ...prev,
      sectors: prev.sectors.includes(sector)
        ? prev.sectors.filter(s => s !== sector)
        : [...prev.sectors, sector]
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async (opportunities) => {
      return await api.entities.DealOpportunity.bulkCreate(opportunities);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealOpportunities'] });
      onCreated();
    },
  });

  const handleScan = async () => {
    if (criteria.sectors.length === 0) {
      setError("Please select at least one sector");
      return;
    }

    setScanning(true);
    setError(null);
    setFoundOpportunities([]);

    try {
      const profile = selectedProfile ? profiles.find(p => p.id === selectedProfile) : null;

      const prompt = `You are an M&A deal sourcing expert. Analyze current market conditions, recent financial news, and industry trends to identify potential acquisition targets and strategic partnership opportunities.

${profile ? `
**Acquirer Profile:**
- Target Sectors: ${profile.target_sectors?.join(', ') || 'Any'}
- Revenue Range: $${profile.revenue_range?.min || 0}M - $${profile.revenue_range?.max || 0}M
- EBITDA Range: $${profile.ebitda_range?.min || 0}M - $${profile.ebitda_range?.max || 0}M
- Strategic Priorities: ${profile.strategic_priorities?.join(', ') || 'None specified'}
- Desired Capabilities: ${profile.desired_capabilities?.join(', ') || 'None specified'}
- Deal Types: ${profile.deal_types?.join(', ') || 'Any'}
- Exclusions: ${profile.exclusion_criteria?.join(', ') || 'None'}
- Min EBITDA Margin: ${profile.financial_metrics?.min_ebitda_margin || 0}%
- Min Revenue Growth: ${profile.financial_metrics?.min_revenue_growth || 0}%
` : ''}

**Search Criteria:**
- Target Sectors: ${criteria.sectors.join(', ') || profile?.target_sectors?.join(', ') || 'Any'}
- Revenue Range: ${criteria.min_revenue ? `$${criteria.min_revenue}M` : 'No min'} - ${criteria.max_revenue ? `$${criteria.max_revenue}M` : 'No max'}
- EBITDA Minimum: ${criteria.min_ebitda ? `$${criteria.min_ebitda}M` : 'No minimum'}
- Geography: ${criteria.geography || profile?.target_geographies?.join(', ') || 'Global'}
- Deal Type: ${criteria.deal_type}

**Advanced Multi-Factor Scoring (0-100):**
${profile?.scoring_weights ? `
Use these custom scoring weights:
- Strategic Alignment: ${profile.scoring_weights.strategic_alignment}% (sector fit, strategic priorities alignment)
- Financial Metrics: ${profile.scoring_weights.financial_metrics}% (revenue, EBITDA, margins, growth rates)
- Market Growth Potential: ${profile.scoring_weights.market_growth}% (industry trends, market expansion, TAM growth)
- Synergy Potential: ${profile.scoring_weights.synergy_potential}% (revenue synergies, cost savings, capability fit)
- Competitive Position: ${profile.scoring_weights.competitive_position}% (market share, competitive moats, differentiation)
- Regulatory Risk (inverse): ${profile.scoring_weights.regulatory_risk}% (antitrust concerns, compliance issues)
` : `
Score each opportunity using these balanced factors:
- Strategic Alignment: 25% (sector fit, strategic priorities)
- Financial Metrics: 20% (revenue, EBITDA, margins, growth)
- Market Growth: 15% (industry trends, expansion potential)
- Synergy Potential: 20% (revenue/cost synergies, capabilities)
- Competitive Position: 10% (market share, moats)
- Regulatory Risk: 10% (inverse - lower risk = higher score)
`}

Calculate component scores (0-100 for each):
1. Strategic Alignment: Match with target sectors, strategic priorities, and desired capabilities
2. Financial Performance: Revenue/EBITDA in range, margins above thresholds, growth rates
3. Market Growth: Industry growth rate, TAM expansion, emerging market opportunities
4. Synergy Potential: Revenue synergies (cross-sell, market access), cost synergies (operations, tech), capability fit
5. Competitive Strength: Market share position, competitive advantages, barriers to entry, brand value
6. Regulatory Viability: Antitrust clearance likelihood, regulatory complexity, compliance burden (high score = low risk)

Provide individual component scores and the weighted final score.

**Task:**
Identify 5-8 realistic potential acquisition targets or partnership opportunities based on:
1. Recent market trends and industry consolidation patterns
2. Companies showing signs of being acquisition targets (financial stress, strategic shifts, founder exits)
3. Companies with complementary capabilities or market positions
4. Recent news indicating potential availability or strategic interest
5. Financial health and strategic fit

For each opportunity, provide:
- Company name and sector
- Estimated valuation and financials
- Strategic fit score (0-100)
- Risk score (0-100) 
- AI summary of why this is an opportunity
- Strategic rationale
- Key synergies (3-5 points)
- Risk factors (3-5 points)
- News sources or market signals
- Relevant market trends

Be specific and realistic. Use real market intelligence where possible.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target_name: { type: "string" },
                  target_sector: { type: "string" },
                  opportunity_type: { type: "string" },
                  estimated_value: { type: "number" },
                  target_revenue: { type: "number" },
                  target_ebitda: { type: "number" },
                  strategic_fit_score: { type: "number" },
                  risk_score: { type: "number" },
                  scoring_breakdown: {
                    type: "object",
                    properties: {
                      strategic_alignment: { type: "number" },
                      financial_metrics: { type: "number" },
                      market_growth: { type: "number" },
                      synergy_potential: { type: "number" },
                      competitive_position: { type: "number" },
                      regulatory_risk: { type: "number" }
                    }
                  },
                  market_growth_rate: { type: "number" },
                  competitive_intensity: { type: "string" },
                  regulatory_concerns: { type: "array", items: { type: "string" } },
                  estimated_synergies: {
                    type: "object",
                    properties: {
                      revenue_synergies: { type: "number" },
                      cost_synergies: { type: "number" }
                    }
                  },
                  ai_summary: { type: "string" },
                  strategic_rationale: { type: "string" },
                  key_synergies: { type: "array", items: { type: "string" } },
                  risk_factors: { type: "array", items: { type: "string" } },
                  news_sources: { type: "array", items: { type: "string" } },
                  market_trends: { type: "array", items: { type: "string" } },
                  priority: { type: "string" }
                }
              }
            }
          }
        }
      });

      const opportunities = result.opportunities.map(opp => ({
        ...opp,
        status: 'new',
        search_criteria: criteria,
        profile_used: profile?.name || null
      }));

      setFoundOpportunities(opportunities);
      setScanning(false);

    } catch (err) {
      console.error("Scan error:", err);
      setError(err.message || "Failed to scan for opportunities");
      setScanning(false);
    }
  };

  const handleSaveAll = () => {
    saveMutation.mutate(foundOpportunities);
  };

  return (
    <Card className="border-purple-200 shadow-lg">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-purple-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Deal Sourcing Engine
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {foundOpportunities.length === 0 ? (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Use Acquirer Profile (Optional)</Label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger>
                    <SelectValue placeholder="Manual search or select profile..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>Manual Search</SelectItem>
                    {profiles.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProfile && (
                  <p className="text-xs text-purple-600">
                    ✓ AI will score targets based on profile criteria and strategic fit
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Target Sectors *</Label>
                <div className="flex flex-wrap gap-2">
                  {sectors.map(sector => (
                    <Badge
                      key={sector}
                      variant={criteria.sectors.includes(sector) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleSector(sector)}
                    >
                      {sector}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Min Revenue ($M)</Label>
                  <Input
                    type="number"
                    value={criteria.min_revenue}
                    onChange={(e) => setCriteria({...criteria, min_revenue: e.target.value})}
                    placeholder="e.g., 100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Revenue ($M)</Label>
                  <Input
                    type="number"
                    value={criteria.max_revenue}
                    onChange={(e) => setCriteria({...criteria, max_revenue: e.target.value})}
                    placeholder="e.g., 1000"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Min EBITDA ($M)</Label>
                  <Input
                    type="number"
                    value={criteria.min_ebitda}
                    onChange={(e) => setCriteria({...criteria, min_ebitda: e.target.value})}
                    placeholder="e.g., 20"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Geography</Label>
                  <Input
                    value={criteria.geography}
                    onChange={(e) => setCriteria({...criteria, geography: e.target.value})}
                    placeholder="e.g., North America, Europe"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Deal Type</Label>
                <Select value={criteria.deal_type} onValueChange={(val) => setCriteria({...criteria, deal_type: val})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="acquisition">Acquisition</SelectItem>
                    <SelectItem value="merger">Merger</SelectItem>
                    <SelectItem value="strategic_partnership">Strategic Partnership</SelectItem>
                    <SelectItem value="asset_purchase">Asset Purchase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-900">{error}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleScan}
              disabled={scanning || criteria.sectors.length === 0}
              className="w-full bg-purple-600 hover:bg-purple-700 h-12"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Scanning Markets & News...
                </>
              ) : (
                <>
                  <TrendingUp className="w-5 h-5 mr-2" />
                  Scan for Opportunities
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Found {foundOpportunities.length} Opportunities</h3>
                <Button onClick={handleSaveAll} className="bg-purple-600 hover:bg-purple-700">
                  Save All to Pipeline
                </Button>
              </div>
              {foundOpportunities.map((opp, idx) => (
                <Card key={idx} className="border-slate-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                     <div>
                       <h4 className="font-semibold text-slate-900">{opp.target_name}</h4>
                       <p className="text-sm text-slate-600">{opp.target_sector}</p>
                     </div>
                     <div className="flex gap-2">
                       <Badge className="bg-emerald-100 text-emerald-800">
                         Score: {opp.strategic_fit_score}
                       </Badge>
                       <Badge className={opp.risk_score > 60 ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}>
                         Risk: {opp.risk_score}
                       </Badge>
                     </div>
                    </div>
                    <p className="text-sm text-slate-700 mb-3">{opp.ai_summary}</p>

                    {opp.scoring_breakdown && (
                     <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                       <p className="text-xs font-semibold text-slate-700 mb-2">Scoring Breakdown:</p>
                       <div className="grid grid-cols-3 gap-2 text-xs">
                         <div>
                           <span className="text-slate-600">Strategic:</span>
                           <span className="ml-1 font-semibold text-indigo-700">{opp.scoring_breakdown.strategic_alignment}</span>
                         </div>
                         <div>
                           <span className="text-slate-600">Financial:</span>
                           <span className="ml-1 font-semibold text-emerald-700">{opp.scoring_breakdown.financial_metrics}</span>
                         </div>
                         <div>
                           <span className="text-slate-600">Growth:</span>
                           <span className="ml-1 font-semibold text-blue-700">{opp.scoring_breakdown.market_growth}</span>
                         </div>
                         <div>
                           <span className="text-slate-600">Synergy:</span>
                           <span className="ml-1 font-semibold text-purple-700">{opp.scoring_breakdown.synergy_potential}</span>
                         </div>
                         <div>
                           <span className="text-slate-600">Competitive:</span>
                           <span className="ml-1 font-semibold text-teal-700">{opp.scoring_breakdown.competitive_position}</span>
                         </div>
                         <div>
                           <span className="text-slate-600">Regulatory:</span>
                           <span className="ml-1 font-semibold text-orange-700">{opp.scoring_breakdown.regulatory_risk}</span>
                         </div>
                       </div>
                     </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-600">Est. Value:</span>
                        <p className="font-semibold">${opp.estimated_value}M</p>
                      </div>
                      <div>
                        <span className="text-slate-600">Revenue:</span>
                        <p className="font-semibold">${opp.target_revenue}M</p>
                      </div>
                      <div>
                        <span className="text-slate-600">Priority:</span>
                        <Badge variant="outline" className="text-xs">{opp.priority}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}