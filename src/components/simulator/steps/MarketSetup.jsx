import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight } from "lucide-react";

export default function MarketSetup({ data, onUpdate, onNext }) {
  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Define Relevant Market</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product_market">Product Market</Label>
            <Textarea
              id="product_market"
              value={data.product_market || ""}
              onChange={(e) => onUpdate({ product_market: e.target.value })}
              placeholder="e.g., Wireless telecommunications services"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="geographic_market">Geographic Market</Label>
            <Input
              id="geographic_market"
              value={data.geographic_market || ""}
              onChange={(e) => onUpdate({ geographic_market: e.target.value })}
              placeholder="e.g., United States, California, etc."
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="time_window">Time Window</Label>
              <Input
                id="time_window"
                value={data.time_window || ""}
                onChange={(e) => onUpdate({ time_window: e.target.value })}
                placeholder="e.g., 2022-2024"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={data.currency || "USD"}
                onValueChange={(value) => onUpdate({ currency: value })}
              >
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="JPY">JPY</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-900">Multi-Market Analysis</p>
              <p className="text-sm text-slate-600">Analyze multiple markets simultaneously</p>
            </div>
            <Switch
              checked={data.multi_market || false}
              onCheckedChange={(checked) => onUpdate({ multi_market: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-700 gap-2">
          Next: Baseline Data
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}