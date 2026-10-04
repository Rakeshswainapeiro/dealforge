import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Building2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

export default function ChecklistCard({ checklist, companies, onClick }) {
  const acquirer = companies.find(c => c.id === checklist.acquirer_id);
  const target = companies.find(c => c.id === checklist.target_id);
  
  const statusColors = {
    in_progress: "bg-blue-100 text-blue-800",
    completed: "bg-emerald-100 text-emerald-800",
    blocked: "bg-red-100 text-red-800"
  };

  const dealTypeLabels = {
    acquisition: "Acquisition",
    merger: "Merger",
    asset_purchase: "Asset Purchase",
    joint_venture: "Joint Venture"
  };

  const criticalItems = checklist.items?.filter(i => i.priority === 'critical' && i.status !== 'completed').length || 0;
  const highRiskAreas = checklist.high_risk_areas?.length || 0;

  return (
    <Card
      className="border-slate-200 hover:shadow-lg transition-all cursor-pointer"
      onClick={onClick}
    >
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{checklist.name}</CardTitle>
          <Badge className={statusColors[checklist.status]}>
            {checklist.status === 'in_progress' && <Clock className="w-3 h-3 mr-1" />}
            {checklist.status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
            {checklist.status === 'blocked' && <AlertTriangle className="w-3 h-3 mr-1" />}
            {checklist.status.replace('_', ' ')}
          </Badge>
        </div>
        <div className="space-y-1 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            <span>{acquirer?.name || 'Unknown'} → {target?.name || 'Unknown'}</span>
          </div>
          <p className="text-xs">{dealTypeLabels[checklist.deal_type]} • {checklist.sector}</p>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Overall Progress</span>
            <span className="font-semibold text-slate-900">{Math.round(checklist.progress_percentage || 0)}%</span>
          </div>
          <Progress value={checklist.progress_percentage || 0} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-600">Total Items</p>
            <p className="text-xl font-bold text-slate-900">{checklist.items?.length || 0}</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-600">Completed</p>
            <p className="text-xl font-bold text-emerald-600">
              {checklist.items?.filter(i => i.status === 'completed').length || 0}
            </p>
          </div>
        </div>

        {(criticalItems > 0 || highRiskAreas > 0) && (
          <div className="pt-3 border-t border-slate-200 space-y-2">
            {criticalItems > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-red-600 font-medium">Critical Items Pending</span>
                <Badge className="bg-red-100 text-red-800">{criticalItems}</Badge>
              </div>
            )}
            {highRiskAreas > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-amber-600 font-medium">High-Risk Areas</span>
                <Badge className="bg-amber-100 text-amber-800">{highRiskAreas}</Badge>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}