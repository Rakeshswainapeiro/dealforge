import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network, TrendingDown, Users } from "lucide-react";

export default function VerticalPlatform({ companies, scenarios, loading }) {
  // Simulated vGUPPI and RRC calculations
  const vGUPPI = {
    value: 12.5,
    description: "Vertical Gross Upward Pricing Pressure Index",
    interpretation: "Moderate foreclosure concern"
  };

  const rrc = {
    value: 8.3,
    description: "Raising Rivals' Costs Index",
    interpretation: "Potential for input foreclosure"
  };

  // Network effects simulation
  const networkEffects = {
    crossSideElasticity: 0.45,
    multiHomingPercentage: 35,
    switchingCosts: "Medium",
    dataAdvantage: "Significant"
  };

  // Access gating funnel
  const accessData = [
    { stage: "Access Requests Received", value: 1250 },
    { stage: "Approved Requests", value: 890 },
    { stage: "Conditional Approvals", value: 180 },
    { stage: "Denied Requests", value: 180 }
  ];

  const approvalRate = (890 / 1250 * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* vGUPPI & RRC Tiles */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-white">
          <CardHeader className="border-b border-purple-100">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-5 h-5 text-purple-600" />
              vGUPPI (Vertical)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <p className="text-4xl font-bold text-purple-600 mb-2">
              {vGUPPI.value.toFixed(1)}%
            </p>
            <p className="text-sm text-slate-600 mb-4">{vGUPPI.description}</p>
            <Badge className="bg-amber-100 text-amber-800">
              {vGUPPI.interpretation}
            </Badge>
            <div className="mt-4 pt-4 border-t border-purple-100">
              <p className="text-xs text-slate-600">
                vGUPPI measures incentive to raise downstream rival costs through input foreclosure. 
                Values &gt; 10% warrant detailed analysis.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-white">
          <CardHeader className="border-b border-blue-100">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-blue-600" />
              RRC (Raising Rivals' Costs)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <p className="text-4xl font-bold text-blue-600 mb-2">
              {rrc.value.toFixed(1)}%
            </p>
            <p className="text-sm text-slate-600 mb-4">{rrc.description}</p>
            <Badge className="bg-amber-100 text-amber-800">
              {rrc.interpretation}
            </Badge>
            <div className="mt-4 pt-4 border-t border-blue-100">
              <p className="text-xs text-slate-600">
                RRC index quantifies ability and incentive to disadvantage competitors through vertical integration. 
                Higher values indicate greater foreclosure risk.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Access Gating Funnel */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-600" />
            Access Gating Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {accessData.map((stage, idx) => {
              const percentage = (stage.value / accessData[0].value * 100).toFixed(1);
              const barColor = idx === 0 ? 'bg-teal-500' : 
                              idx === 1 ? 'bg-emerald-500' : 
                              idx === 2 ? 'bg-amber-500' : 
                              'bg-red-500';
              
              return (
                <div key={idx}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-slate-900">{stage.stage}</span>
                    <span className="text-sm font-semibold text-slate-900">
                      {stage.value} ({percentage}%)
                    </span>
                  </div>
                  <div className="h-8 bg-slate-100 rounded-lg overflow-hidden">
                    <div 
                      className={`h-full ${barColor} transition-all`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 p-4 bg-slate-50 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-900">Overall Approval Rate</span>
              <Badge className={approvalRate >= 70 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                {approvalRate}%
              </Badge>
            </div>
          </div>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-900">
              <strong>Interpretation:</strong> {approvalRate}% approval rate. 
              {approvalRate < 70 && " Low approval rates may indicate discriminatory access policies that could foreclose competition."}
              {approvalRate >= 70 && " Approval rate suggests relatively open access, reducing vertical foreclosure concerns."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Network Effects */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Platform Network Effects</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-4 border border-slate-200 rounded-lg">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">Cross-Side Elasticity</h4>
              <p className="text-3xl font-bold text-teal-600 mb-2">
                {networkEffects.crossSideElasticity.toFixed(2)}
              </p>
              <p className="text-xs text-slate-600">
                Demand response across platform sides. Higher values indicate stronger network effects.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">Multi-Homing Rate</h4>
              <p className="text-3xl font-bold text-teal-600 mb-2">
                {networkEffects.multiHomingPercentage}%
              </p>
              <p className="text-xs text-slate-600">
                Users active on multiple platforms. Lower rates increase platform power.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">Switching Costs</h4>
              <p className="text-lg font-bold text-teal-600 mb-2">
                {networkEffects.switchingCosts}
              </p>
              <p className="text-xs text-slate-600">
                Difficulty of moving to competing platform. High switching costs reduce competitive pressure.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">Data Advantage</h4>
              <p className="text-lg font-bold text-teal-600 mb-2">
                {networkEffects.dataAdvantage}
              </p>
              <p className="text-xs text-slate-600">
                Post-merger data accumulation creates barriers to entry and expansion.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}