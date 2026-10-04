import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle, Shield } from "lucide-react";

export default function AntitrustAlerts({ hhi, scenarios, companies }) {
  const alerts = [];

  if (hhi >= 2500) {
    alerts.push({
      type: "warning",
      title: "High Market Concentration",
      description: "HHI above 2500 indicates highly concentrated market. Federal antitrust review highly likely.",
      icon: AlertTriangle
    });
  }

  scenarios.forEach(scenario => {
    if (scenario.status === 'active') {
      const acquirer = companies.find(c => c.id === scenario.acquirer_id);
      if (acquirer && acquirer.market_share > 30) {
        alerts.push({
          type: "warning",
          title: `${scenario.name}`,
          description: `Acquirer has ${acquirer.market_share}% market share. Large transactions may trigger HSR filing requirements.`,
          icon: Shield
        });
      }
    }
  });

  if (alerts.length === 0) {
    alerts.push({
      type: "success",
      title: "No Major Antitrust Concerns",
      description: "Current market structure and scenarios appear to have low regulatory risk.",
      icon: CheckCircle
    });
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-teal-600" />
          Antitrust Alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {alerts.map((alert, index) => {
          const Icon = alert.icon;
          return (
            <Alert 
              key={index}
              className={
                alert.type === 'warning' 
                  ? 'border-amber-200 bg-amber-50' 
                  : 'border-emerald-200 bg-emerald-50'
              }
            >
              <Icon className={`h-4 w-4 ${
                alert.type === 'warning' ? 'text-amber-600' : 'text-emerald-600'
              }`} />
              <AlertDescription>
                <p className="font-semibold mb-1">{alert.title}</p>
                <p className="text-sm">{alert.description}</p>
              </AlertDescription>
            </Alert>
          );
        })}
      </CardContent>
    </Card>
  );
}