import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, DollarSign } from "lucide-react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function PricingElasticity({ companies, loading }) {
  const [criticalLoss, setCriticalLoss] = useState({
    priceIncrease: 10,
    margin: 30,
    result: 0
  });

  // Calculate critical loss
  const calculateCriticalLoss = () => {
    const p = criticalLoss.priceIncrease / 100;
    const m = criticalLoss.margin / 100;
    const cl = p / (p + m) * 100;
    setCriticalLoss({ ...criticalLoss, result: cl });
  };

  // Generate price vs margin scatter data
  const priceMarginData = companies
    .filter(c => c.revenue > 0 && c.ebitda > 0)
    .map(c => ({
      name: c.name,
      price: c.stock_price || 0,
      margin: c.revenue > 0 ? (c.ebitda / c.revenue) * 100 : 0,
      marketShare: c.market_share || 0
    }));

  // Simulated elasticity matrix
  const topFirms = companies
    .filter(c => c.market_share > 0)
    .sort((a, b) => b.market_share - a.market_share)
    .slice(0, 5);

  const elasticityMatrix = topFirms.map((firm, i) => ({
    firm: firm.name,
    own: -2.5 - Math.random() * 1.5,
    cross: topFirms.map((_, j) => i === j ? null : (0.3 + Math.random() * 0.7).toFixed(2))
  }));

  return (
    <div className="space-y-6">
      {/* Critical Loss Calculator */}
      <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-white">
        <CardHeader className="border-b border-teal-100">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-teal-600" />
            Critical Loss Calculator
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="price-increase">Price Increase (%)</Label>
              <Input
                id="price-increase"
                type="number"
                step="1"
                value={criticalLoss.priceIncrease}
                onChange={(e) => setCriticalLoss({ ...criticalLoss, priceIncrease: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="margin">Current Margin (%)</Label>
              <Input
                id="margin"
                type="number"
                step="1"
                value={criticalLoss.margin}
                onChange={(e) => setCriticalLoss({ ...criticalLoss, margin: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={calculateCriticalLoss} className="w-full bg-teal-600 hover:bg-teal-700">
                Calculate
              </Button>
            </div>
          </div>
          {criticalLoss.result > 0 && (
            <div className="mt-6 p-4 bg-white rounded-lg border-2 border-teal-200">
              <p className="text-sm text-slate-600 mb-2">Critical Loss</p>
              <p className="text-4xl font-bold text-teal-600">{criticalLoss.result.toFixed(2)}%</p>
              <p className="text-sm text-slate-600 mt-2">
                The merger is profitable if volume loss is less than {criticalLoss.result.toFixed(2)}% for a {criticalLoss.priceIncrease}% price increase.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price vs Margin Scatter */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-teal-600" />
            Price vs. Margin Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={350}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis 
                dataKey="price" 
                name="Stock Price" 
                tick={{ fill: '#64748b' }}
                label={{ value: 'Stock Price ($)', position: 'insideBottom', offset: -5, fill: '#64748b' }}
              />
              <YAxis 
                dataKey="margin" 
                name="EBITDA Margin" 
                tick={{ fill: '#64748b' }}
                label={{ value: 'EBITDA Margin (%)', angle: -90, position: 'insideLeft', fill: '#64748b' }}
              />
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-white p-3 shadow-lg rounded-lg border border-slate-200">
                        <p className="font-semibold text-slate-900">{payload[0].payload.name}</p>
                        <p className="text-sm text-slate-600">Price: ${payload[0].payload.price.toFixed(2)}</p>
                        <p className="text-sm text-slate-600">Margin: {payload[0].payload.margin.toFixed(1)}%</p>
                        <p className="text-sm text-slate-600">Market Share: {payload[0].payload.marketShare.toFixed(1)}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Scatter data={priceMarginData} fill="#14B8A6" />
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Elasticity Matrix */}
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Own-Price & Cross-Price Elasticity Matrix</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left p-3 font-semibold text-slate-900">Firm</th>
                  <th className="text-center p-3 font-semibold text-slate-900">Own-Price</th>
                  {topFirms.map(f => (
                    <th key={f.id} className="text-center p-3 font-semibold text-slate-900 text-xs">
                      {f.name.substring(0, 15)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {elasticityMatrix.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-900">{row.firm.substring(0, 20)}</td>
                    <td className="p-3 text-center">
                      <Badge className="bg-red-100 text-red-800">
                        {row.own.toFixed(2)}
                      </Badge>
                    </td>
                    {row.cross.map((val, j) => (
                      <td key={j} className="p-3 text-center">
                        {val ? (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            +{val}
                          </Badge>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-900">
              <strong>Note:</strong> Own-price elasticity measures demand sensitivity to own price changes (negative values expected). 
              Cross-price elasticity measures demand response to competitor price changes (positive = substitutes).
              Values shown are illustrative - actual elasticities require econometric estimation from transaction data.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}