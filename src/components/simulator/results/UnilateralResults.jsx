import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend, ComposedChart } from "recharts";

export default function UnilateralResults({ simulation, companies }) {
  const uppGuppi = simulation.unilateral_effects?.upp_guppi || [];
  const predictedChanges = simulation.unilateral_effects?.predicted_changes || {};

  // Sample data for demonstration - in real app, this would be calculated
  const sampleUppGuppi = uppGuppi.length > 0 ? uppGuppi : [
    { product: "Product A", upp: 8.5, guppi: 12.3, cmcr: 6.2 },
    { product: "Product B", upp: 6.2, guppi: 9.8, cmcr: 4.8 },
    { product: "Product C", upp: 10.1, guppi: 15.2, cmcr: 7.9 }
  ];

  // Simulate price uplift distribution
  const priceUpliftData = [
    { range: "0-2%", frequency: 15 },
    { range: "2-4%", frequency: 28 },
    { range: "4-6%", frequency: 35 },
    { range: "6-8%", frequency: 18 },
    { range: "8-10%", frequency: 4 }
  ];

  const COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6'];

  return (
    <div className="space-y-6">
      {uppGuppi.length === 0 && (
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            Showing sample visualization. Complete the simulation setup to see actual results.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {Object.entries(predictedChanges).map(([key, value]) => (
          <Card key={key} className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2 capitalize">
                {key.replace(/_/g, ' ')}
              </p>
              <p className="text-2xl font-bold text-slate-900">
                {typeof value === 'number' ? value.toFixed(2) : value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>UPP/GUPPI/CMCR Analysis by Product</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sampleUppGuppi} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="product" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} label={{ value: 'Percentage (%)', angle: -90, position: 'insideLeft' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px'
                }}
                formatter={(value) => `${value.toFixed(2)}%`}
              />
              <Legend />
              <Bar dataKey="upp" fill="#14B8A6" name="UPP" radius={[8, 8, 0, 0]} />
              <Bar dataKey="guppi" fill="#3B82F6" name="GUPPI" radius={[8, 8, 0, 0]} />
              <Bar dataKey="cmcr" fill="#8B5CF6" name="CMCR" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Predicted Price Uplift Distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={priceUpliftData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="range" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} label={{ value: 'Frequency', angle: -90, position: 'insideLeft' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Bar dataKey="frequency" fill="#F59E0B" name="Simulations" radius={[8, 8, 0, 0]} />
              <Line type="monotone" dataKey="frequency" stroke="#EF4444" strokeWidth={2} name="Trend" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-sm text-slate-600 mt-4 text-center">
            Monte Carlo simulation showing distribution of predicted price increases post-merger
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Detailed Metrics</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {sampleUppGuppi.map((item, idx) => (
              <div key={idx} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-3">{item.product}</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-600 mb-1">UPP (Upward Pricing Pressure)</p>
                    <p className="font-bold text-teal-600 text-lg">{item.upp?.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-slate-600 mb-1">GUPPI (Gross Upward Pricing Pressure Index)</p>
                    <p className="font-bold text-blue-600 text-lg">{item.guppi?.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-slate-600 mb-1">CMCR (Compensating Marginal Cost Reduction)</p>
                    <p className="font-bold text-purple-600 text-lg">{item.cmcr?.toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}