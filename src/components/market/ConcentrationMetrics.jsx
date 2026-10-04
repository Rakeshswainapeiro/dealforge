import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";

export default function ConcentrationMetrics({ hhi, cr4, loading }) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Concentration Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const getHHIStatus = () => {
    if (hhi < 1500) return { label: "Competitive", color: "bg-emerald-100 text-emerald-800" };
    if (hhi < 2500) return { label: "Moderately Concentrated", color: "bg-amber-100 text-amber-800" };
    return { label: "Highly Concentrated", color: "bg-red-100 text-red-800" };
  };

  const hhiStatus = getHHIStatus();

  // Simulate HHI trend (in real app, this would be historical data)
  const hhiTrend = [
    { year: '2020', hhi: Math.max(800, hhi - 600), threshold1: 1500, threshold2: 2500 },
    { year: '2021', hhi: Math.max(900, hhi - 400), threshold1: 1500, threshold2: 2500 },
    { year: '2022', hhi: Math.max(1000, hhi - 200), threshold1: 1500, threshold2: 2500 },
    { year: '2023', hhi: Math.max(1100, hhi - 100), threshold1: 1500, threshold2: 2500 },
    { year: '2024', hhi: hhi, threshold1: 1500, threshold2: 2500 },
  ];

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-teal-600" />
          Concentration Metrics
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-gradient-to-br from-teal-50 to-blue-50 rounded-xl border border-teal-200">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-600 font-medium">HHI</span>
              <Badge className={hhiStatus.color}>{hhiStatus.label}</Badge>
            </div>
            <p className="text-4xl font-bold text-teal-600">{hhi.toFixed(0)}</p>
            <p className="text-xs text-slate-600 mt-2">
              {hhi < 1500 ? '✓ Market is competitive' : hhi < 2500 ? '📊 Antitrust review likely' : '⚠️ High regulatory risk'}
            </p>
          </div>

          <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-200">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-600 font-medium">CR4</span>
              {cr4 > 60 && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            </div>
            <p className="text-4xl font-bold text-purple-600">{cr4.toFixed(1)}%</p>
            <p className="text-xs text-slate-600 mt-2">
              {cr4 > 60 ? 'Oligopolistic structure' : 'Fragmented market'}
            </p>
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-slate-900 mb-3">HHI Trend Analysis</h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={hhiTrend} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} domain={[0, 3500]} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <ReferenceLine y={1500} stroke="#f59e0b" strokeDasharray="5 5" label="Moderate" />
              <ReferenceLine y={2500} stroke="#ef4444" strokeDasharray="5 5" label="High" />
              <Line 
                type="monotone" 
                dataKey="hhi" 
                stroke="#14B8A6" 
                strokeWidth={3}
                dot={{ fill: '#14B8A6', r: 5 }}
                name="Market HHI"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}