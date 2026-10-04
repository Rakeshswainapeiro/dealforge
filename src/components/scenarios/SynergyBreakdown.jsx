import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { DollarSign } from "lucide-react";

export default function SynergyBreakdown({ synergies }) {
  const data = [
    {
      name: 'Revenue Synergies',
      value: synergies?.revenue_synergies || 0,
      fill: '#14B8A6'
    },
    {
      name: 'Cost Synergies',
      value: synergies?.cost_synergies || 0,
      fill: '#10B981'
    },
    {
      name: 'Integration Costs',
      value: -(synergies?.integration_costs || 0),
      fill: '#F59E0B'
    },
  ];

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-teal-600" />
          Synergy Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fill: '#64748b' }} />
            <YAxis tick={{ fill: '#64748b' }} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#fff', 
                border: '1px solid #e2e8f0',
                borderRadius: '8px'
              }}
            />
            <Bar dataKey="value" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}