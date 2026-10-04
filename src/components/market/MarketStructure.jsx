import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

export default function MarketStructure({ companies, loading }) {
  const companiesWithShare = companies.filter(c => c.market_share && c.market_share > 0);

  // Calculate HHI
  const calculateHHI = (shares) => {
    return shares.reduce((sum, share) => sum + Math.pow(share, 2), 0);
  };

  const currentHHI = calculateHHI(companiesWithShare.map(c => c.market_share));

  // Simulate HHI trend over time (in a real app, you'd track historical data)
  const hhiTrendData = [
    { period: '2019', hhi: currentHHI * 0.85 },
    { period: '2020', hhi: currentHHI * 0.90 },
    { period: '2021', hhi: currentHHI * 0.95 },
    { period: '2022', hhi: currentHHI * 0.98 },
    { period: '2023', hhi: currentHHI },
  ];

  // Market share evolution (simulated)
  const topFirms = [...companiesWithShare]
    .sort((a, b) => b.market_share - a.market_share)
    .slice(0, 5);

  const shareEvolutionData = [
    {
      period: '2019',
      ...Object.fromEntries(topFirms.map((f, i) => [f.name, f.market_share * (0.9 + i * 0.02)]))
    },
    {
      period: '2020',
      ...Object.fromEntries(topFirms.map((f, i) => [f.name, f.market_share * (0.93 + i * 0.015)]))
    },
    {
      period: '2021',
      ...Object.fromEntries(topFirms.map((f, i) => [f.name, f.market_share * (0.96 + i * 0.01)]))
    },
    {
      period: '2022',
      ...Object.fromEntries(topFirms.map((f, i) => [f.name, f.market_share * (0.98 + i * 0.005)]))
    },
    {
      period: '2023',
      ...Object.fromEntries(topFirms.map(f => [f.name, f.market_share]))
    },
  ];

  const COLORS = ['#14B8A6', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B'];

  const getHHIZone = (hhi) => {
    if (hhi < 1500) return { color: '#10B981', label: 'Unconcentrated' };
    if (hhi < 2500) return { color: '#F59E0B', label: 'Moderate' };
    return { color: '#EF4444', label: 'High' };
  };

  return (
    <div className="space-y-6">
      {/* HHI Trend with Threshold Bands */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-teal-600" />
            HHI Trend with Regulatory Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4 flex gap-3">
            <Badge className="bg-emerald-100 text-emerald-800">
              &lt; 1500: Unconcentrated
            </Badge>
            <Badge className="bg-amber-100 text-amber-800">
              1500-2500: Moderate
            </Badge>
            <Badge className="bg-red-100 text-red-800">
              &gt; 2500: High Risk
            </Badge>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hhiTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fill: '#64748b' }} />
              <YAxis tick={{ fill: '#64748b' }} domain={[0, 3000]} />
              <Tooltip />
              <Legend />
              {/* Threshold bands */}
              <Area type="monotone" dataKey={() => 1500} fill="#10B981" fillOpacity={0.1} stroke="none" />
              <Area type="monotone" dataKey={() => 2500} fill="#F59E0B" fillOpacity={0.1} stroke="none" />
              <Line 
                type="monotone" 
                dataKey="hhi" 
                stroke={getHHIZone(currentHHI).color}
                strokeWidth={3}
                dot={{ r: 5 }}
                name="HHI"
              />
              {/* Reference lines */}
              <Line type="monotone" dataKey={() => 1500} stroke="#10B981" strokeDasharray="5 5" strokeWidth={2} name="Unconcentrated Threshold" />
              <Line type="monotone" dataKey={() => 2500} stroke="#EF4444" strokeDasharray="5 5" strokeWidth={2} name="High Risk Threshold" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Market Share Evolution (Stacked Area) */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Market Share Evolution (Top 5 Firms)</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={shareEvolutionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fill: '#64748b' }} />
              <YAxis tick={{ fill: '#64748b' }} />
              <Tooltip />
              <Legend />
              {topFirms.map((firm, index) => (
                <Area
                  key={firm.id}
                  type="monotone"
                  dataKey={firm.name}
                  stackId="1"
                  stroke={COLORS[index]}
                  fill={COLORS[index]}
                  fillOpacity={0.6}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Capacity/Revenue Heatmap */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Company Size Distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {companiesWithShare
              .sort((a, b) => b.market_share - a.market_share)
              .map((company, index) => {
                const intensity = Math.min(company.market_share / 20, 1);
                const bgColor = `rgba(20, 184, 166, ${intensity * 0.8 + 0.2})`;
                
                return (
                  <div
                    key={company.id}
                    className="p-4 rounded-lg border border-slate-200 transition-all hover:shadow-md cursor-pointer"
                    style={{ backgroundColor: bgColor }}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-semibold text-white text-sm">
                        #{index + 1} {company.name}
                      </p>
                      <Badge className="bg-white/30 text-white text-xs">
                        {company.market_share.toFixed(1)}%
                      </Badge>
                    </div>
                    {company.revenue > 0 && (
                      <p className="text-xs text-white/90">
                        Revenue: ${(company.revenue / 1000).toFixed(1)}B
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}