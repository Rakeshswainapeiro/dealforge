import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function PricingConfig({ pricingModel, onUpdate, onNext, onBack }) {
  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Competition Model</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <RadioGroup value={pricingModel} onValueChange={onUpdate}>
            <div className="space-y-3">
              <div className="flex items-start space-x-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <RadioGroupItem value="bertrand" id="bertrand" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="bertrand" className="font-semibold cursor-pointer">
                    Bertrand (Differentiated Products)
                  </Label>
                  <p className="text-sm text-slate-600 mt-1">
                    Firms compete on price with differentiated products. Best for most consumer markets.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <RadioGroupItem value="cournot" id="cournot" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="cournot" className="font-semibold cursor-pointer">
                    Cournot (Quantity Competition)
                  </Label>
                  <p className="text-sm text-slate-600 mt-1">
                    Firms compete on quantity. Suitable for commodity-like markets with capacity constraints.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <RadioGroupItem value="multi_period" id="multi_period" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="multi_period" className="font-semibold cursor-pointer">
                    Multi-Period Dynamic
                  </Label>
                  <p className="text-sm text-slate-600 mt-1">
                    Analyzes short-run and long-run effects with capacity adjustments over time.
                  </p>
                </div>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-700 gap-2">
          Next: Unilateral Effects
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}