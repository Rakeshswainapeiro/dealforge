import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  TrendingDown, 
  Building2, 
  AlertTriangle,
  DollarSign,
  Brain,
  Sparkles
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function MarketOverview({ companies, scenarios, loading }) {
  const [aiNarrative, setAiNarrative] = useState(null);
  const [generatingNarrative, setGeneratingNarrative] = useState(false);

  const companiesWithShare = companies.filter(c => c.market_share && c.market_share > 0);
  
  // Calculate HHI (pre-merger)
  const calculateHHI = (shares) => {
    return shares.reduce((sum, share) => sum + Math.pow(share, 2), 0);
  };

  const preHHI = calculateHHI(companiesWithShare.map(c => c.market_share));
  
  // Calculate CR4
  const calculateCR4 = (shares) => {
    const sorted = [...shares].sort((a, b) => b - a);
    return sorted.slice(0, 4).reduce((sum, share) => sum + share, 0);
  };
  
  const cr4 = calculateCR4(companiesWithShare.map(c => c.market_share));
  
  // Find largest firm
  const largestFirm = companiesWithShare.reduce((max, c) => 
    c.market_share > (max?.market_share || 0) ? c : max, null
  );

  // Calculate post-merger HHI for active scenarios
  const activeScenarios = scenarios.filter(s => s.status === 'active');
  let postHHI = preHHI;
  let deltaHHI = 0;
  
  if (activeScenarios.length > 0) {
    // For simplicity, calculate for the first active scenario
    const scenario = activeScenarios[0];
    const acquirer = companies.find(c => c.id === scenario.acquirer_id);
    const targets = scenario.target_ids?.map(id => companies.find(c => c.id === id)).filter(Boolean) || [];
    
    if (acquirer && targets.length > 0) {
      const acquirerShare = acquirer.market_share || 0;
      const targetShares = targets.map(t => t.market_share || 0);
      const combinedShare = acquirerShare + targetShares.reduce((sum, s) => sum + s, 0);
      
      // Calculate post-merger shares
      const postShares = companiesWithShare
        .filter(c => c.id !== acquirer.id && !scenario.target_ids.includes(c.id))
        .map(c => c.market_share);
      postShares.push(combinedShare);
      
      postHHI = calculateHHI(postShares);
      deltaHHI = postHHI - preHHI;
    }
  }

  const getHHIStatus = (hhi) => {
    if (hhi < 1500) return { label: "Unconcentrated", color: "bg-emerald-100 text-emerald-800", risk: "Low" };
    if (hhi < 2500) return { label: "Moderately Concentrated", color: "bg-amber-100 text-amber-800", risk: "Medium" };
    return { label: "Highly Concentrated", color: "bg-red-100 text-red-800", risk: "High" };
  };

  const preStatus = getHHIStatus(preHHI);
  const postStatus = getHHIStatus(postHHI);

  const generateAINarrative = async () => {
    setGeneratingNarrative(true);
    try {
      const user = await api.auth.me();
      if (!user?.ai_settings?.enabled) {
        setAiNarrative({
          error: "AI backend not configured. Please configure in Settings."
        });
        return;
      }

      const prompt = `You are an expert antitrust economist analyzing a market for regulatory review. Provide a concise executive summary.

**Market Data:**
- Pre-merger HHI: ${preHHI.toFixed(0)} (${preStatus.label})
- Post-merger HHI: ${postHHI.toFixed(0)} (${postStatus.label})
- ΔHHI: ${deltaHHI.toFixed(0)}
- CR4: ${cr4.toFixed(1)}%
- Number of firms: ${companiesWithShare.length}
- Largest firm: ${largestFirm?.name || 'N/A'} (${largestFirm?.market_share || 0}%)
- Active merger scenarios: ${activeScenarios.length}

Provide a 2-3 paragraph narrative covering:
1. Overall market concentration and competitive landscape
2. Likely regulator view (FTC/DOJ perspective in the US)
3. Key risks and red flags from an antitrust perspective
4. Recommended next steps for deal structuring or defense

Be specific, cite the numbers, and use professional but accessible language.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false
      });

      setAiNarrative({ content: result });
    } catch (error) {
      setAiNarrative({
        error: "Failed to generate narrative. " + error.message
      });
    } finally {
      setGeneratingNarrative(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-6">
        <div className="grid md:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics Tiles */}
      <div className="grid md:grid-cols-6 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-600">Pre-HHI</span>
              <TrendingUp className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{preHHI.toFixed(0)}</p>
            <Badge className={`mt-2 ${preStatus.color} text-xs`}>
              {preStatus.label}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-600">Post-HHI</span>
              <TrendingUp className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{postHHI.toFixed(0)}</p>
            <Badge className={`mt-2 ${postStatus.color} text-xs`}>
              {postStatus.label}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-600">ΔHHI</span>
              {deltaHHI > 0 ? (
                <TrendingUp className="w-4 h-4 text-red-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-emerald-500" />
              )}
            </div>
            <p className={`text-2xl font-bold ${deltaHHI > 200 ? 'text-red-600' : 'text-slate-900'}`}>
              {deltaHHI > 0 ? '+' : ''}{deltaHHI.toFixed(0)}
            </p>
            {deltaHHI > 200 && (
              <Badge className="mt-2 bg-red-100 text-red-800 text-xs">
                High Risk
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-600">CR4</span>
              <Building2 className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{cr4.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-2">
              {cr4 > 60 ? 'Oligopolistic' : 'Fragmented'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-600"># Firms</span>
              <Building2 className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{companiesWithShare.length}</p>
            <p className="text-xs text-slate-500 mt-2">
              w/ market share
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-600">Top Firm</span>
              <AlertTriangle className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">
              {largestFirm?.market_share?.toFixed(1) || 0}%
            </p>
            <p className="text-xs text-slate-500 mt-2 truncate">
              {largestFirm?.name || 'N/A'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* AI-Generated Narrative */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-teal-600" />
              AI Market Assessment
            </CardTitle>
            <Button
              onClick={generateAINarrative}
              disabled={generatingNarrative}
              className="bg-gradient-to-r from-teal-600 to-teal-700"
            >
              {generatingNarrative ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Analysis
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {!aiNarrative && !generatingNarrative && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gradient-to-br from-teal-100 to-teal-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Brain className="w-8 h-8 text-teal-600" />
              </div>
              <p className="text-slate-600 mb-2">AI-Powered Regulatory Assessment</p>
              <p className="text-sm text-slate-500">
                Get expert analysis of market concentration, competitive risks, and likely regulator views
              </p>
            </div>
          )}

          {aiNarrative?.error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{aiNarrative.error}</AlertDescription>
            </Alert>
          )}

          {aiNarrative?.content && (
            <div className="prose prose-slate max-w-none">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 whitespace-pre-wrap text-sm leading-relaxed">
                {aiNarrative.content}
              </div>
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-900">
                  <strong>Note:</strong> This AI-generated analysis is based on current market data (HHI: {preHHI.toFixed(0)}, CR4: {cr4.toFixed(1)}%, {companiesWithShare.length} firms). 
                  All conclusions should be verified with deterministic calculations and legal counsel.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regulatory Thresholds Reference */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base">Regulatory Thresholds (FTC/DOJ Guidelines)</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <h4 className="font-semibold text-emerald-900 mb-2">Unconcentrated</h4>
              <p className="text-sm text-emerald-700">HHI &lt; 1,500</p>
              <p className="text-xs text-emerald-600 mt-2">
                Mergers unlikely to raise competitive concerns
              </p>
            </div>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h4 className="font-semibold text-amber-900 mb-2">Moderate Concentration</h4>
              <p className="text-sm text-amber-700">HHI 1,500 - 2,500</p>
              <p className="text-xs text-amber-600 mt-2">
                ΔHHI &gt; 100: Potential concerns; &gt; 200: Presumption of harm
              </p>
            </div>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-semibold text-red-900 mb-2">Highly Concentrated</h4>
              <p className="text-sm text-red-700">HHI &gt; 2,500</p>
              <p className="text-xs text-red-600 mt-2">
                ΔHHI &gt; 100: Presumption of market power; &gt; 200: Likely challenge
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}