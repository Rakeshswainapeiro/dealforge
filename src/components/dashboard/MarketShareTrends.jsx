import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useTranslation } from "@/lib/i18n";

export default function MarketShareTrends({ companies }) {
  const { t } = useTranslation();
  // Simulate market share trends over time (in real app, this would be historical data)
  const topCompanies = companies
    .filter(c => c.market_share > 0)
    .sort((a, b) => b.market_share - a.market_share)
    .slice(0, 5);

  // Generate trend data for the last 5 years
  const years = ['2020', '2021', '2022', '2023', '2024'];
  const trendData = years.map((year, idx) => {
    const dataPoint = { year };
    topCompanies.forEach((company, compIdx) => {
      // Simulate historical variation
      const variation = (Math.random() - 0.5) * 3; // ±1.5% variation
      const historicalShare = company.market_share * (1 - (4 - idx) * 0.05) + variation;
      dataPoint[company.name] = Math.max(0, historicalShare);
    });
    return dataPoint;
  });

  const COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];

  if (topCompanies.length === 0) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>{t('dashboard.marketShareTrends')}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-slate-500 text-center py-8">
            {t('dashboard.noMarketShare')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle>{t('dashboard.marketShareEvolution')}</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis 
              tick={{ fontSize: 12 }} 
              label={{ value: t('dashboard.marketSharePct'), angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#fff', 
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px'
              }}
              formatter={(value) => `${value.toFixed(2)}%`}
            />
            <Legend />
            {topCompanies.map((company, idx) => (
              <Line
                key={company.id}
                type="monotone"
                dataKey={company.name}
                stroke={COLORS[idx]}
                strokeWidth={3}
                dot={{ fill: COLORS[idx], r: 5 }}
                activeDot={{ r: 7 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {topCompanies.map((company, idx) => (
            <div key={company.id} className="text-center p-2 bg-slate-50 rounded">
              <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ backgroundColor: COLORS[idx] }} />
              <p className="text-xs font-medium text-slate-700 truncate">{company.name}</p>
              <p className="text-xs text-slate-500">{company.market_share.toFixed(1)}%</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
