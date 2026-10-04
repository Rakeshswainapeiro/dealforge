import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save } from "lucide-react";

export default function SensitivityConfig({ data, onUpdate, onBack, onSubmit }) {
  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Sensitivity & Robustness Analysis</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label>Monte Carlo Simulations</Label>
            <Input
              type="number"
              value={data.monte_carlo_runs || 1000}
              onChange={(e) => onUpdate({ ...data, monte_carlo_runs: parseInt(e.target.value) || 1000 })}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Margin Range (± %)</Label>
              <Input
                type="number"
                value={data.margin_range?.[1] || 10}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 10;
                  onUpdate({ ...data, margin_range: [-val, val] });
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Elasticity Range (±)</Label>
              <Input
                type="number"
                step="0.1"
                value={data.elasticity_range?.[1] || 0.5}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0.5;
                  onUpdate({ ...data, elasticity_range: [-val, val] });
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onSubmit} className="bg-teal-600 hover:bg-teal-700 gap-2">
          <Save className="w-4 h-4" />
          Save Simulation
        </Button>
      </div>
    </div>
  );
}