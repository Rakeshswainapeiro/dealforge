import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertTriangle, Building2, BarChart3 } from "lucide-react";

export default function ResultsOverview({ simulation, companies }) {
  const acquirer = companies.find(c => c.id === simulation.merger_parties?.acquirer_id);
  const targets = simulation.merger_parties?.target_ids?.map(id => 
    companies.find(c => c.id === id)
  ).filter(Boolean) || [];

  // Calculate HHI metrics if baseline data exists
  const calculateHHI = (shares) => {
    return shares.reduce((sum, share) => sum + Math.pow(share, 2), 0);
  };

  const preHHI = simulation.baseline_data?.prices 
    ? calculateHHI(simulation.baseline_data.prices.map(p => p.quantity || 0))
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-slate-600">Pre-Merger HHI</span>
            </div>
            <p className="text-3xl font-bold text-slate-900">
              {preHHI > 0 ? preHHI.toFixed(0) : "N/A"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-teal-600" />
              <span className="text-sm text-slate-600">ΔHHI</span>
            </div>
            <p className="text-3xl font-bold text-teal-600">
              {simulation.unilateral_effects?.predicted_changes?.delta_price 
                ? `+${simulation.unilateral_effects.predicted_changes.delta_price.toFixed(0)}`
                : "N/A"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-purple-600" />
              <span className="text-sm text-slate-600"># Firms</span>
            </div>
            <p className="text-3xl font-bold text-slate-900">
              {simulation.baseline_data?.prices?.length || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm text-slate-600">Risk Level</span>
            </div>
            <Badge className={preHHI > 2500 ? "bg-red-100 text-red-800" : preHHI > 1500 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
              {preHHI > 2500 ? "High" : preHHI > 1500 ? "Moderate" : "Low"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Market Definition</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-slate-600">Product Market</p>
              <p className="font-semibold text-slate-900">
                {simulation.market_definition?.product_market || "Not defined"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Geographic Market</p>
              <p className="font-semibold text-slate-900">
                {simulation.market_definition?.geographic_market || "Not defined"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Time Window</p>
              <p className="font-semibold text-slate-900">
                {simulation.market_definition?.time_window || "Not defined"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Pricing Model</p>
              <p className="font-semibold text-slate-900 capitalize">
                {simulation.pricing_model || "Bertrand"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Merger Parties</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {acquirer && (
              <div className="p-4 bg-teal-50 rounded-lg border border-teal-200">
                <p className="text-sm text-teal-600 font-medium mb-1">Acquirer</p>
                <p className="text-lg font-bold text-slate-900">{acquirer.name}</p>
                <p className="text-sm text-slate-600">Market Cap: ${(acquirer.market_cap / 1000).toFixed(1)}B</p>
              </div>
            )}
            {targets.length > 0 && (
              <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-sm text-amber-600 font-medium mb-2">Target(s)</p>
                <div className="space-y-2">
                  {targets.map((target, idx) => (
                    <div key={idx}>
                      <p className="font-bold text-slate-900">{target.name}</p>
                      <p className="text-sm text-slate-600">Market Cap: ${(target.market_cap / 1000).toFixed(1)}B</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>AI Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-slate-700 leading-relaxed">
            This simulation analyzes the competitive effects of a proposed merger in the{" "}
            {simulation.market_definition?.product_market || "specified"} market. 
            {preHHI > 2500 && " The pre-merger HHI indicates a highly concentrated market, suggesting increased scrutiny from regulators."}
            {preHHI > 1500 && preHHI <= 2500 && " The market shows moderate concentration, requiring careful analysis of unilateral effects."}
            {preHHI <= 1500 && " The market appears unconcentrated, though other competitive factors should be considered."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}