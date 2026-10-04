import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function DemandDiversion({ data, baselineData, onUpdate, onUpdateBaseline, onNext, onBack }) {
  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Demand Model Selection</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label>Model Type</Label>
            <Select
              value={data.model_type || "log_linear"}
              onValueChange={(value) => onUpdate({ model_type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="log_linear">Log-Linear</SelectItem>
                <SelectItem value="aids">AIDS</SelectItem>
                <SelectItem value="linear_aids">Linear AIDS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-700 gap-2">
          Next: Pricing Model
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}