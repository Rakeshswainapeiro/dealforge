import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const COLORS = ['#14B8A6', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#6366F1'];

export default function MarketShareChart({ companies, loading }) {
  const [topN, setTopN] = useState("10");

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Share Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-80 w-full" />
        </CardContent>
      </Card>
    );
  }

  const companiesWithShare = companies.filter(c => c.market_share && c.market_share > 0);

  if (companiesWithShare.length === 0) {
    return (
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Market Share Distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <p className="text-slate-500">No market share data available. Add market share percentages to companies.</p>
        </CardContent>
      </Card>
    );
  }

  // Sort by market share and take top N
  const topLimit = parseInt(topN);
  const sortedCompanies = [...companiesWithShare].sort((a, b) => b.market_share - a.market_share);
  const topCompanies = sortedCompanies.slice(0, topLimit);
  const othersShare = sortedCompanies.slice(topLimit).reduce((sum, c) => sum + c.market_share, 0);

  const data = topCompanies.map(c => ({
    name: c.name,
    value: c.market_share,
    ticker: c.ticker || ""
  }));

  // Add "Others" if there are more companies
  if (othersShare > 0) {
    data.push({
      name: "Others",
      value: othersShare,
      ticker: `${sortedCompanies.length - topLimit} companies`
    });
  }

  const totalShare = data.reduce((sum, item) => sum + item.value, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 shadow-lg rounded-lg border border-slate-200">
          <p className="font-semibold text-slate-900">{payload[0].name}</p>
          {payload[0].payload.ticker && (
            <p className="text-xs text-slate-500">{payload[0].payload.ticker}</p>
          )}
          <p className="text-sm text-teal-600 font-semibold mt-1">
            {payload[0].value.toFixed(2)}% market share
          </p>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.03) return null; // Don't show label if less than 3%
    
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        className="text-xs font-semibold"
      >
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    );
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <div className="flex justify-between items-center">
          <CardTitle>Market Share Distribution</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Show top:</span>
            <Select value={topN} onValueChange={setTopN}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="15">15</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="mb-4 p-3 bg-slate-50 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Total Companies with Share Data:</span>
            <span className="font-semibold text-slate-900">{companiesWithShare.length}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-slate-600">Total Market Share Tracked:</span>
            <span className="font-semibold text-teal-600">{totalShare.toFixed(1)}%</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomLabel}
              outerRadius={140}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              verticalAlign="bottom" 
              height={36}
              formatter={(value, entry) => (
                <span className="text-sm text-slate-700">
                  {value} ({entry.payload.value.toFixed(1)}%)
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>

        {sortedCompanies.length > topLimit && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-900">
              <strong>Note:</strong> Showing top {topLimit} companies. 
              {sortedCompanies.length - topLimit} other companies with {othersShare.toFixed(1)}% combined market share are grouped as "Others".
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}