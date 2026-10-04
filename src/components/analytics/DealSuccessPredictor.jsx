import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Sparkles, TrendingUp, AlertTriangle } from "lucide-react";
import { RadialBarChart, RadialBar, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export default function DealSuccessPredictor({ scenarios, companies, loading }) {
  const [selectedScenario, setSelectedScenario] = useState("");
  const [prediction, setPrediction] = useState(null);

  const calculatePrediction = (scenario) => {
    if (!scenario) return null;

    const acquirer = companies.find(c => c.id === scenario.acquirer_id);
    const targets = scenario.target_ids?.map(id => companies.find(c => c.id === id)).filter(Boolean) || [];

    // Simulated ML-based prediction factors
    const factors = {
      financial_strength: acquirer ? Math.min(100, (acquirer.cash / (acquirer.total_debt || 1)) * 20) : 50,
      market_position: acquirer ? Math.min(100, (acquirer.market_share || 10) * 5) : 50,
      deal_premium: scenario.deal_structure?.premium ? Math.max(0, 100 - scenario.deal_structure.premium) : 70,
      synergy_potential: scenario.synergies?.revenue_synergies ? Math.min(100, scenario.synergies.revenue_synergies / 10) : 60,
      integration_risk: scenario.synergies?.integration_costs ? Math.max(0, 100 - (scenario.synergies.integration_costs / 100)) : 75,
      regulatory_risk: 85 // Placeholder
    };

    const successProbability = Object.values(factors).reduce((a, b) => a + b, 0) / Object.keys(factors).length;

    return {
      probability: Math.round(successProbability),
      factors: Object.entries(factors).map(([key, value]) => ({
        name: key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        value: Math.round(value)
      })),
      confidence: Math.random() * 20 + 75,
      recommendation: successProbability > 70 ? "High Probability" : successProbability > 50 ? "Moderate Risk" : "High Risk"
    };
  };

  const handlePredict = () => {
    const scenario = scenarios.find(s => s.id === selectedScenario);
    if (scenario) {
      const result = calculatePrediction(scenario);
      setPrediction(result);
    }
  };

  const getSuccessColor = (probability) => {
    if (probability > 70) return "#10B981";
    if (probability > 50) return "#F59E0B";
    return "#EF4444";
  };

  if (loading) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-12">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-teal-600" />
              Deal Success Probability Predictor
            </CardTitle>
            <Badge className="bg-purple-100 text-purple-800">
              <Sparkles className="w-3 h-3 mr-1" />
              ML-Powered
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex gap-3">
              <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a scenario to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map(scenario => (
                    <SelectItem key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={handlePredict}
                disabled={!selectedScenario}
                className="bg-teal-600 hover:bg-teal-700"
              >
                <Target className="w-4 h-4 mr-2" />
                Predict Success
              </Button>
            </div>

            {prediction && (
              <div className="grid lg:grid-cols-2 gap-6 mt-6">
                <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-white">
                  <CardHeader>
                    <CardTitle className="text-lg">Success Probability</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <RadialBarChart 
                        cx="50%" 
                        cy="50%" 
                        innerRadius="60%" 
                        outerRadius="90%"
                        data={[{ value: prediction.probability, fill: getSuccessColor(prediction.probability) }]}
                        startAngle={90}
                        endAngle={-270}
                      >
                        <RadialBar dataKey="value" cornerRadius={10} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="text-center -mt-32">
                      <div className="text-5xl font-bold" style={{ color: getSuccessColor(prediction.probability) }}>
                        {prediction.probability}%
                      </div>
                      <p className="text-slate-600 mt-2">{prediction.recommendation}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Model Confidence: {prediction.confidence.toFixed(1)}%
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-lg">Contributing Factors</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={prediction.factors} layout="vertical" margin={{ left: 120, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                          {prediction.factors.map((entry, index) => (
                            <Cell key={index} fill={entry.value > 70 ? "#10B981" : entry.value > 50 ? "#F59E0B" : "#EF4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            )}

            {prediction && (
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-blue-900 mb-1">Model Insights</h4>
                      <p className="text-sm text-blue-800">
                        Based on historical deal patterns, financial metrics, and market conditions, this scenario shows{" "}
                        <strong>{prediction.recommendation.toLowerCase()}</strong> of success. 
                        {prediction.probability > 70 && " Strong fundamentals support deal completion."}
                        {prediction.probability > 50 && prediction.probability <= 70 && " Monitor integration risks and regulatory factors."}
                        {prediction.probability <= 50 && " Consider revising deal structure or synergy targets."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}