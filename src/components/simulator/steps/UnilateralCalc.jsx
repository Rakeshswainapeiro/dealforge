import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";

export default function UnilateralCalc({ baselineData, mergerParties, companies, onNext, onBack }) {
  return (
    <div className="space-y-6">
      <Alert className="border-blue-200 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          Unilateral effects analysis calculates UPP, GUPPI, and CMCR metrics to assess competitive harm.
        </AlertDescription>
      </Alert>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Unilateral Effects Calculator</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-slate-600 text-center py-8">
            Advanced calculation engine coming soon.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-700 gap-2">
          Next: Efficiencies
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}