import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export default function CoordinatedResults({ simulation, companies }) {
  const coordinated = simulation.coordinated_effects || {};
  const riskIndex = coordinated.coordination_risk_index || 0;

  const getRiskLevel = (index) => {
    if (index > 0.7) return { label: "High", color: "bg-red-100 text-red-800" };
    if (index > 0.4) return { label: "Medium", color: "bg-amber-100 text-amber-800" };
    return { label: "Low", color: "bg-emerald-100 text-emerald-800" };
  };

  const risk = getRiskLevel(riskIndex);

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <div className="flex justify-between items-center">
            <CardTitle>Coordination Risk Assessment</CardTitle>
            <Badge className={risk.color}>{risk.label} Risk</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-slate-600">Overall Risk Index</span>
                <span className="text-sm font-bold text-slate-900">{(riskIndex * 100).toFixed(0)}%</span>
              </div>
              <Progress value={riskIndex * 100} className="h-3" />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Parallel Pricing Score</p>
                <p className="text-2xl font-bold text-slate-900">
                  {coordinated.parallel_pricing_score?.toFixed(2) || "N/A"}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Transparency Score</p>
                <p className="text-2xl font-bold text-slate-900">
                  {coordinated.transparency_score?.toFixed(2) || "N/A"}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Capacity Tightness</p>
                <p className="text-2xl font-bold text-slate-900">
                  {coordinated.capacity_tightness?.toFixed(2) || "N/A"}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Interaction Frequency</p>
                <p className="text-2xl font-bold text-slate-900">
                  {coordinated.interaction_frequency?.toFixed(2) || "N/A"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}