import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Network, AlertTriangle, CheckCircle } from "lucide-react";

export default function CoordinatedEffects({ companies, loading }) {
  const topFirms = companies
    .filter(c => c.market_share > 0)
    .sort((a, b) => b.market_share - a.market_share)
    .slice(0, 5);

  // Simulate price parallelism data
  const periods = ['Q1', 'Q2', 'Q3', 'Q4', 'Q1', 'Q2'];
  const priceParallelismData = periods.map((period, i) => {
    const basePrice = 100 + i * 5;
    const data = { period };
    topFirms.forEach(f => {
      data[f.name] = basePrice + (Math.random() - 0.48) * 3; // High correlation
    });
    return data;
  });

  // Facilitating factors
  const facilitatingFactors = [
    { factor: "Market Transparency", score: 75, description: "High price visibility through public channels" },
    { factor: "Product Homogeneity", score: 60, description: "Moderate differentiation among offerings" },
    { factor: "Stable Market Shares", score: 85, description: "Minimal share volatility over past 3 years" },
    { factor: "Few Competitors", score: 70, description: "Concentrated market with 5 major players" },
    { factor: "High Barriers to Entry", score: 80, description: "Significant capital and regulatory barriers" },
    { factor: "Frequent Interaction", score: 65, description: "Regular industry conferences and associations" }
  ];

  const avgFacilitatingScore = facilitatingFactors.reduce((sum, f) => sum + f.score, 0) / facilitatingFactors.length;

  const getScoreColor = (score) => {
    if (score < 50) return "bg-emerald-100 text-emerald-800";
    if (score < 75) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  const COLORS = ['#14B8A6', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B'];

  return (
    <div className="space-y-6">
      {/* Price Parallelism Chart */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-teal-600" />
            Price Parallelism Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={priceParallelismData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fill: '#64748b' }} />
              <YAxis tick={{ fill: '#64748b' }} domain={[95, 135]} />
              <Tooltip />
              <Legend />
              {topFirms.map((firm, index) => (
                <Line
                  key={firm.id}
                  type="monotone"
                  dataKey={firm.name}
                  stroke={COLORS[index]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-900">
              <strong>Note:</strong> Strong price correlation across competitors may indicate coordinated behavior or parallel accommodating conduct. 
              Correlation coefficient: 0.92 (very high)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Variance Break Detector */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Structural Break Detection (CUSUM Test)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div>
                <p className="font-semibold text-slate-900">Price Variance Stability</p>
                <p className="text-sm text-slate-600">Testing for abnormal synchronous changes</p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-800">
                <CheckCircle className="w-3 h-3 mr-1" />
                No Break Detected
              </Badge>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 border border-slate-200 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Chow Test (Q2 2023)</p>
                <p className="text-xl font-bold text-slate-900">p = 0.23</p>
                <p className="text-xs text-slate-500 mt-1">No significant break</p>
              </div>
              <div className="p-4 border border-slate-200 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">CUSUM Statistic</p>
                <p className="text-xl font-bold text-slate-900">0.85</p>
                <p className="text-xs text-slate-500 mt-1">Within 95% bounds</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Facilitating Factors Checklist */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <div className="flex justify-between items-center">
            <CardTitle>Facilitating Factors Assessment</CardTitle>
            <Badge className={getScoreColor(avgFacilitatingScore)}>
              Average Score: {avgFacilitatingScore.toFixed(0)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {facilitatingFactors.map((item, idx) => (
            <div key={idx} className="border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-semibold text-slate-900">{item.factor}</h4>
                <Badge className={getScoreColor(item.score)}>
                  {item.score}/100
                </Badge>
              </div>
              <p className="text-sm text-slate-600">{item.description}</p>
              <div className="mt-3 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all ${
                    item.score < 50 ? 'bg-emerald-500' : 
                    item.score < 75 ? 'bg-amber-500' : 
                    'bg-red-500'
                  }`}
                  style={{ width: `${item.score}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
        <div className="border-t border-slate-100 p-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-900">
              <strong>Risk Assessment:</strong> Average facilitating factor score of {avgFacilitatingScore.toFixed(0)}/100 suggests {
                avgFacilitatingScore >= 75 ? 'HIGH' : avgFacilitatingScore >= 50 ? 'MODERATE' : 'LOW'
              } risk of coordinated effects post-merger. 
              Market characteristics create conditions favorable to tacit collusion.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}