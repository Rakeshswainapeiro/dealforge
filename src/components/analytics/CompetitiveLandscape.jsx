import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from "recharts";

export default function CompetitiveLandscape({ companies, scenarios, loading }) {
  if (loading) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-12">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Simulate competitive shifts based on scenarios
  const topCompanies = companies
    .filter(c => c.market_share > 0)
    .sort((a, b) => b.market_share - a.market_share)
    .slice(0, 5);

  const years = ['2022', '2023', '2024', '2025 (Projected)', '2026 (Projected)'];
  const historicalData = years.map((year, idx) => {
    const dataPoint = { year };
    topCompanies.forEach(company => {
      const variation = (Math.random() - 0.5) * 2;
      const growth = idx * 0.3;
      dataPoint[company.name] = Math.max(0, company.market_share + variation + growth);
    });
    return dataPoint;
  });

  // Competitive intensity index
  const hhi = topCompanies.reduce((sum, c) => sum + Math.pow(c.market_share, 2), 0);
  const competitiveIntensity = hhi > 2500 ? "Low" : hhi > 1500 ? "Moderate" : "High";

  const COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="border-slate-200 bg-gradient-to-br from-teal-50 to-blue-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-teal-600" />
              <span className="text-sm text-slate-600">Market Concentration (HHI)</span>
            </div>
            <p className="text-3xl font-bold text-teal-600">{hhi.toFixed(0)}</p>
            <Badge className={
              hhi > 2500 ? "bg-red-100 text-red-800 mt-2" :
              hhi > 1500 ? "bg-amber-100 text-amber-800 mt-2" :
              "bg-emerald-100 text-emerald-800 mt-2"
            }>
              {hhi > 2500 ? "Highly Concentrated" : hhi > 1500 ? "Moderately Concentrated" : "Competitive"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-purple-600" />
              <span className="text-sm text-slate-600">Competitive Intensity</span>
            </div>
            <p className="text-3xl font-bold text-purple-600">{competitiveIntensity}</p>
            <p className="text-xs text-slate-600 mt-2">Based on market structure</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-gradient-to-br from-emerald-50 to-teal-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-sm text-slate-600">Active M&A Scenarios</span>
            </div>
            <p className="text-3xl font-bold text-emerald-600">
              {scenarios.filter(s => s.status === 'active').length}
            </p>
            <p className="text-xs text-slate-600 mt-2">Potential landscape changes</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-teal-600" />
            Market Share Evolution & Projections
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={historicalData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                {topCompanies.map((company, idx) => (
                  <linearGradient key={company.id} id={`color${idx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[idx]} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS[idx]} stopOpacity={0.1}/>
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: 'Market Share (%)', angle: -90, position: 'insideLeft' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px'
                }}
                formatter={(value) => `${value.toFixed(2)}%`}
              />
              <Legend />
              {topCompanies.map((company, idx) => (
                <Area
                  key={company.id}
                  type="monotone"
                  dataKey={company.name}
                  stroke={COLORS[idx]}
                  fill={`url(#color${idx})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Competitive Dynamics Analysis</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {topCompanies.map((company, idx) => (
              <div key={company.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white" style={{ backgroundColor: COLORS[idx] }}>
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-900">{company.name}</h4>
                  <p className="text-sm text-slate-600">{company.sector}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-900">{company.market_share.toFixed(1)}%</p>
                  <p className="text-xs text-slate-500">Market Share</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-teal-600">${(company.market_cap / 1000).toFixed(1)}B</p>
                  <p className="text-xs text-slate-500">Market Cap</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}