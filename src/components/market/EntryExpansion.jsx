import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Shield, Calendar } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";

export default function EntryExpansion({ companies, loading }) {
  // Barrier radar chart data
  const barriers = [
    { barrier: "Capital Requirements", score: 75, max: 100 },
    { barrier: "Regulatory/Licensing", score: 85, max: 100 },
    { barrier: "IP & Patents", score: 60, max: 100 },
    { barrier: "Distribution Access", score: 70, max: 100 },
    { barrier: "Data/Network Effects", score: 80, max: 100 },
    { barrier: "Brand Loyalty", score: 55, max: 100 }
  ];

  const avgBarrier = barriers.reduce((sum, b) => sum + b.score, 0) / barriers.length;

  // Entry/Exit timeline
  const timeline = [
    { year: 2019, entries: 3, exits: 1, netChange: 2 },
    { year: 2020, entries: 2, exits: 2, netChange: 0 },
    { year: 2021, entries: 1, exits: 3, netChange: -2 },
    { year: 2022, entries: 2, exits: 1, netChange: 1 },
    { year: 2023, entries: 1, exits: 2, netChange: -1 }
  ];

  // Simulate expected entry impact
  const entryScenario = {
    timeToEntry: 24, // months
    expectedEntrants: 2,
    hhiImpact: -125,
    priceImpact: -3.5,
    likelihood: 45 // percentage
  };

  const getBarrierColor = (score) => {
    if (score < 50) return "bg-emerald-100 text-emerald-800";
    if (score < 75) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  return (
    <div className="space-y-6">
      {/* Barrier Radar */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-teal-600" />
              Entry Barrier Assessment
            </CardTitle>
            <Badge className={getBarrierColor(avgBarrier)}>
              Avg Score: {avgBarrier.toFixed(0)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={barriers}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="barrier" tick={{ fill: '#64748b', fontSize: 12 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#64748b' }} />
              <Radar 
                name="Barrier Height" 
                dataKey="score" 
                stroke="#14B8A6" 
                fill="#14B8A6" 
                fillOpacity={0.5}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
          <div className="mt-4 grid md:grid-cols-3 gap-3">
            {barriers.map((b, idx) => (
              <div key={idx} className="p-3 border border-slate-200 rounded-lg">
                <p className="text-xs text-slate-600 mb-1">{b.barrier}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${
                        b.score < 50 ? 'bg-emerald-500' : 
                        b.score < 75 ? 'bg-amber-500' : 
                        'bg-red-500'
                      }`}
                      style={{ width: `${b.score}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-900">{b.score}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-900">
              <strong>Assessment:</strong> Average barrier score of {avgBarrier.toFixed(0)}/100 indicates {
                avgBarrier >= 75 ? 'VERY HIGH' : avgBarrier >= 50 ? 'MODERATE TO HIGH' : 'LOW'
              } barriers to entry. 
              {avgBarrier >= 75 && " Entry unlikely to be timely, likely, or sufficient to deter anticompetitive effects."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Entry/Exit Timeline */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-teal-600" />
            Historical Entry & Exit Pattern
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {timeline.map((period, idx) => (
              <div key={idx} className="flex items-center gap-4">
                <span className="text-sm font-semibold text-slate-900 w-16">{period.year}</span>
                <div className="flex-1 flex gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-slate-600 mb-1">Entries: {period.entries}</p>
                    <div className="h-6 bg-emerald-100 rounded flex items-center px-2" style={{ width: `${period.entries * 30}%` }}>
                      <span className="text-xs font-semibold text-emerald-800">{period.entries}</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-600 mb-1">Exits: {period.exits}</p>
                    <div className="h-6 bg-red-100 rounded flex items-center px-2" style={{ width: `${period.exits * 30}%` }}>
                      <span className="text-xs font-semibold text-red-800">{period.exits}</span>
                    </div>
                  </div>
                </div>
                <Badge className={period.netChange > 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                  {period.netChange > 0 ? '+' : ''}{period.netChange}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Entry Scenario Impact */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-teal-600" />
            Expected Entry Impact Scenario
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600 mb-1">Time to Entry</p>
              <p className="text-3xl font-bold text-slate-900">{entryScenario.timeToEntry} mo</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600 mb-1">Expected Entrants</p>
              <p className="text-3xl font-bold text-slate-900">{entryScenario.expectedEntrants}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600 mb-1">HHI Impact</p>
              <p className="text-3xl font-bold text-emerald-600">{entryScenario.hhiImpact}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600 mb-1">Price Impact</p>
              <p className="text-3xl font-bold text-emerald-600">{entryScenario.priceImpact}%</p>
            </div>
          </div>
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-amber-900">Entry Likelihood</span>
              <Badge className="bg-amber-100 text-amber-800">
                {entryScenario.likelihood}%
              </Badge>
            </div>
            <div className="h-3 bg-amber-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-amber-600"
                style={{ width: `${entryScenario.likelihood}%` }}
              />
            </div>
            <p className="text-xs text-amber-900 mt-3">
              <strong>Conclusion:</strong> With {entryScenario.likelihood}% probability and {entryScenario.timeToEntry}-month timeline, 
              entry is {entryScenario.likelihood < 50 ? 'unlikely' : 'moderately likely'} to be timely and sufficient to counteract merger's competitive harm.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}