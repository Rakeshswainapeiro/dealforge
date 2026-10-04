import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitMerge, TrendingUp, AlertTriangle } from "lucide-react";

export default function UnilateralEffects({ companies, scenarios, loading }) {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [marginAdjust, setMarginAdjust] = useState(0);
  const [efficiencyAdjust, setEfficiencyAdjust] = useState(0);

  const activeScenarios = scenarios.filter(s => s.status === 'active');

  // Calculate UPP/GUPPI
  const calculateUPP = (scenario) => {
    const acquirer = companies.find(c => c.id === scenario.acquirer_id);
    const target = companies.find(c => c.id === scenario.target_ids[0]);
    
    if (!acquirer || !target || !acquirer.ebitda || !acquirer.revenue || !target.ebitda || !target.revenue) {
      return null;
    }

    const acquirerMargin = ((acquirer.ebitda / acquirer.revenue) * 100) + marginAdjust;
    const targetMargin = ((target.ebitda / target.revenue) * 100) + marginAdjust;
    
    // Simplified UPP calculation
    const diversion = 0.15 + (Math.random() * 0.15); // Simulated diversion ratio
    const efficiency = (scenario.synergies?.cost_synergies || 0) / target.revenue * 100 + efficiencyAdjust;
    
    const uppAcquirer = diversion * targetMargin - efficiency;
    const uppTarget = diversion * acquirerMargin - efficiency;

    const guppi = diversion * targetMargin / 100;

    return {
      acquirer: {
        upp: uppAcquirer,
        guppi: guppi * 100,
        margin: acquirerMargin,
        diversion: diversion * 100
      },
      target: {
        upp: uppTarget,
        guppi: guppi * 100,
        margin: targetMargin,
        diversion: diversion * 100
      },
      efficiency: efficiency
    };
  };

  const selectedScenarioData = selectedScenario ? 
    activeScenarios.find(s => s.id === selectedScenario) : null;

  const uppResults = selectedScenarioData ? calculateUPP(selectedScenarioData) : null;

  // Simulate post-merger price uplift distribution
  const priceUpliftData = uppResults ? 
    Array.from({ length: 100 }, (_, i) => ({
      value: Math.max(0, uppResults.acquirer.upp + (Math.random() - 0.5) * 5)
    })) : [];

  const avgUplift = priceUpliftData.length > 0 ? 
    priceUpliftData.reduce((sum, d) => sum + d.value, 0) / priceUpliftData.length : 0;

  // Diversion matrix (simplified)
  const topFirms = companies
    .filter(c => c.market_share > 0)
    .sort((a, b) => b.market_share - a.market_share)
    .slice(0, 5);

  const diversionMatrix = topFirms.map((from, i) => ({
    from: from.name,
    diversions: topFirms.map((to, j) => {
      if (i === j) return 0;
      const baseDiv = (from.market_share + to.market_share) / 100;
      return (baseDiv * 0.1 + Math.random() * 0.15).toFixed(3);
    })
  }));

  const getUPPColor = (upp) => {
    if (upp < 0) return "bg-emerald-100 text-emerald-800";
    if (upp < 5) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  return (
    <div className="space-y-6">
      {/* Scenario Selector */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-teal-600" />
            Unilateral Effects Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div>
              <Label>Select Active Scenario</Label>
              <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a scenario to analyze" />
                </SelectTrigger>
                <SelectContent>
                  {activeScenarios.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {activeScenarios.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                No active scenarios available. Create and activate a merger scenario to analyze unilateral effects.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {uppResults && (
        <>
          {/* UPP/GUPPI Cards */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-white">
              <CardHeader className="border-b border-teal-100">
                <CardTitle className="text-base">Acquirer UPP/GUPPI</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">UPP (Upward Pricing Pressure)</span>
                  <Badge className={getUPPColor(uppResults.acquirer.upp)}>
                    {uppResults.acquirer.upp > 0 ? '+' : ''}{uppResults.acquirer.upp.toFixed(2)}%
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">GUPPI (Gross Upward Pricing Pressure Index)</span>
                  <Badge className="bg-slate-100 text-slate-800">
                    {uppResults.acquirer.guppi.toFixed(2)}%
                  </Badge>
                </div>
                <div className="pt-4 border-t border-slate-200 space-y-2">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Margin:</span>
                    <span className="font-semibold">{uppResults.acquirer.margin.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Diversion Ratio:</span>
                    <span className="font-semibold">{uppResults.acquirer.diversion.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Efficiency Credit:</span>
                    <span className="font-semibold">{uppResults.efficiency.toFixed(1)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
              <CardHeader className="border-b border-amber-100">
                <CardTitle className="text-base">Target UPP/GUPPI</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">UPP (Upward Pricing Pressure)</span>
                  <Badge className={getUPPColor(uppResults.target.upp)}>
                    {uppResults.target.upp > 0 ? '+' : ''}{uppResults.target.upp.toFixed(2)}%
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">GUPPI</span>
                  <Badge className="bg-slate-100 text-slate-800">
                    {uppResults.target.guppi.toFixed(2)}%
                  </Badge>
                </div>
                <div className="pt-4 border-t border-slate-200 space-y-2">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Margin:</span>
                    <span className="font-semibold">{uppResults.target.margin.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Diversion Ratio:</span>
                    <span className="font-semibold">{uppResults.target.diversion.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Efficiency Credit:</span>
                    <span className="font-semibold">{uppResults.efficiency.toFixed(1)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sensitivity Analysis */}
          <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal-600" />
                Sensitivity Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <Label>Margin Adjustment</Label>
                  <span className="text-sm font-semibold text-teal-600">
                    {marginAdjust > 0 ? '+' : ''}{marginAdjust}%
                  </span>
                </div>
                <Slider
                  value={[marginAdjust]}
                  onValueChange={([value]) => setMarginAdjust(value)}
                  min={-10}
                  max={10}
                  step={1}
                />
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <Label>Efficiency Adjustment</Label>
                  <span className="text-sm font-semibold text-teal-600">
                    {efficiencyAdjust > 0 ? '+' : ''}{efficiencyAdjust}%
                  </span>
                </div>
                <Slider
                  value={[efficiencyAdjust]}
                  onValueChange={([value]) => setEfficiencyAdjust(value)}
                  min={-5}
                  max={15}
                  step={0.5}
                />
              </div>
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-900">
                  <strong>Impact:</strong> With current adjustments, acquirer UPP is {uppResults.acquirer.upp > 0 ? 'positive' : 'negative'} 
                  ({uppResults.acquirer.upp.toFixed(2)}%), indicating {uppResults.acquirer.upp > 5 ? 'significant' : uppResults.acquirer.upp > 0 ? 'moderate' : 'no'} 
                  {' '}competitive concern under unilateral effects theory.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Price Uplift Distribution */}
          <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-100">
              <CardTitle>Post-Merger Price Uplift (Simulation)</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="mb-4 p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600">Average Expected Price Increase</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">{avgUplift.toFixed(2)}%</p>
              </div>
              <div className="flex gap-1 h-40 items-end">
                {priceUpliftData.slice(0, 50).map((d, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-teal-600 to-teal-400 rounded-t"
                    style={{ height: `${(d.value / Math.max(...priceUpliftData.map(x => x.value))) * 100}%` }}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2 text-center">
                Distribution of simulated price effects (100 draws)
              </p>
            </CardContent>
          </Card>

          {/* Diversion Matrix Heatmap */}
          <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-100">
              <CardTitle>Diversion Matrix (Top 5 Firms)</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left p-3 font-semibold text-slate-900">From \ To</th>
                      {topFirms.map(f => (
                        <th key={f.id} className="text-center p-3 font-semibold text-slate-900 text-xs">
                          {f.name.substring(0, 15)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diversionMatrix.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="p-3 font-medium text-slate-900">{row.from.substring(0, 20)}</td>
                        {row.diversions.map((val, j) => {
                          const intensity = parseFloat(val);
                          const bgColor = i === j ? '#f1f5f9' : `rgba(20, 184, 166, ${intensity * 2})`;
                          return (
                            <td 
                              key={j} 
                              className="p-3 text-center font-semibold"
                              style={{ backgroundColor: bgColor, color: intensity > 0.1 ? 'white' : '#334155' }}
                            >
                              {i === j ? '-' : val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-900">
                  <strong>Note:</strong> Diversion ratios represent the fraction of lost sales diverted to competitors when one firm raises prices. 
                  Higher values indicate closer substitution. Values shown are illustrative estimates.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}