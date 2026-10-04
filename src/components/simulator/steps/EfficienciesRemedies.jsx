import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function EfficienciesRemedies({ efficiencies, remedies, onUpdateEfficiencies, onUpdateRemedies, onNext, onBack }) {
  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Merger Efficiencies</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label>Variable Cost Reduction (%)</Label>
            <Input
              type="number"
              step="0.1"
              value={efficiencies.variable_cost_reduction || 0}
              onChange={(e) => onUpdateEfficiencies({ ...efficiencies, variable_cost_reduction: parseFloat(e.target.value) || 0 })}
            />
          </div>

          <div className="space-y-2">
            <Label>Fixed Cost Synergies ($M)</Label>
            <Input
              type="number"
              value={efficiencies.fixed_cost_synergies || 0}
              onChange={(e) => onUpdateEfficiencies({ ...efficiencies, fixed_cost_synergies: parseFloat(e.target.value) || 0 })}
            />
          </div>

          <div className="space-y-2">
            <Label>Pass-Through Rate: {((efficiencies.pass_through_rate || 0.5) * 100).toFixed(0)}%</Label>
            <Slider
              value={[(efficiencies.pass_through_rate || 0.5) * 100]}
              onValueChange={(value) => onUpdateEfficiencies({ ...efficiencies, pass_through_rate: value[0] / 100 })}
              max={100}
              step={5}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-700 gap-2">
          Next: Sensitivity Analysis
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}