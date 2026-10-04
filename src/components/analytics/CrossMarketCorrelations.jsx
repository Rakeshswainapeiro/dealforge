import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, TrendingUp } from "lucide-react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";

export default function CrossMarketCorrelations({ companies, loading }) {
  if (loading) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-12">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Calculate sector correlations
  const sectorData = {};
  companies.forEach(company => {
    if (!company.sector) return;
    if (!sectorData[company.sector]) {
      sectorData[company.sector] = {
        companies: [],
        totalRevenue: 0,
        totalMarketCap: 0,
        avgEVRevenue: 0
      };
    }
    sectorData[company.sector].companies.push(company);
    sectorData[company.sector].totalRevenue += company.revenue || 0;
    sectorData[company.sector].totalMarketCap += company.market_cap || 0;
  });

  // Generate correlation matrix data
  const correlationData = Object.entries(sectorData).map(([sector, data]) => {
    const avgRevenue = data.totalRevenue / data.companies.length;
    const avgMarketCap = data.totalMarketCap / data.companies.length;
    const evRevenue = data.companies.reduce((sum, c) => {
      return sum + (c.revenue > 0 ? c.enterprise_value / c.revenue : 0);
    }, 0) / data.companies.length;

    return {
      sector,
      avgRevenue: avgRevenue / 1000,
      avgMarketCap: avgMarketCap / 1000,
      evRevenue: evRevenue || 0,
      size: data.companies.length * 100
    };
  });

  // Bubble chart for cross-sector analysis
  const bubbleData = companies.slice(0, 20).map(company => ({
    name: company.name,
    x: company.revenue || 0,
    y: company.market_cap || 0,
    z: company.market_share || 5,
    sector: company.sector || "Other"
  }));

  const COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#10B981', '#EF4444'];

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-teal-600" />
            Cross-Market Correlations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis 
                dataKey="x" 
                name="Revenue" 
                unit="M"
                tick={{ fontSize: 11 }}
                label={{ value: 'Revenue ($M)', position: 'bottom', offset: 40 }}
              />
              <YAxis 
                dataKey="y" 
                name="Market Cap" 
                unit="M"
                tick={{ fontSize: 11 }}
                label={{ value: 'Market Cap ($M)', angle: -90, position: 'insideLeft', offset: 60 }}
              />
              <ZAxis dataKey="z" range={[50, 500]} name="Market Share" />
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-lg">
                        <p className="font-semibold text-slate-900">{data.name}</p>
                        <p className="text-sm text-slate-600">Sector: {data.sector}</p>
                        <p className="text-sm text-slate-600">Revenue: ${data.x.toFixed(0)}M</p>
                        <p className="text-sm text-slate-600">Market Cap: ${data.y.toFixed(0)}M</p>
                        <p className="text-sm text-slate-600">Share: {data.z.toFixed(1)}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Scatter data={bubbleData} fill="#14B8A6" fillOpacity={0.6} />
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-teal-600" />
            Sector Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {correlationData.map((sector, idx) => (
              <Card key={sector.sector} className="border-slate-200 bg-slate-50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <h4 className="font-semibold text-slate-900">{sector.sector}</h4>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Avg Revenue</span>
                      <span className="font-medium">${sector.avgRevenue.toFixed(1)}B</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Avg Market Cap</span>
                      <span className="font-medium">${sector.avgMarketCap.toFixed(1)}B</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">EV/Revenue</span>
                      <span className="font-medium">{sector.evRevenue.toFixed(1)}x</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}