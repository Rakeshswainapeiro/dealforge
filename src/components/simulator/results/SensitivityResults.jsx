import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export default function SensitivityResults({ simulation }) {
  const sensitivity = simulation.sensitivity_analysis || {};
  const results = sensitivity.results || {};

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Sensitivity Analysis Results</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {Object.keys(results).length === 0 ? (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                Run the simulation to generate sensitivity analysis results.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-600 mb-1">P50 Price Change</p>
                <p className="text-2xl font-bold text-teal-600">
                  {results.p50_price_change?.toFixed(2)}%
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-600 mb-1">P90 Price Change</p>
                <p className="text-2xl font-bold text-amber-600">
                  {results.p90_price_change?.toFixed(2)}%
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-600 mb-1">P50 CS Change</p>
                <p className="text-2xl font-bold text-blue-600">
                  ${results.p50_cs_change?.toFixed(0)}M
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-600 mb-1">P90 CS Change</p>
                <p className="text-2xl font-bold text-purple-600">
                  ${results.p90_cs_change?.toFixed(0)}M
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Analysis Parameters</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-600">Monte Carlo Runs</span>
              <span className="font-semibold text-slate-900">
                {sensitivity.monte_carlo_runs || 1000}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Margin Range</span>
              <span className="font-semibold text-slate-900">
                {sensitivity.margin_range?.join('% to ') || "N/A"}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Elasticity Range</span>
              <span className="font-semibold text-slate-900">
                {sensitivity.elasticity_range?.join(' to ') || "N/A"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}