import React, { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Clock, XCircle, AlertTriangle, Brain, ChevronDown, ChevronUp } from "lucide-react";

export default function ChecklistItem({ item, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(item.notes || "");

  const statusIcons = {
    pending: <Clock className="w-4 h-4 text-slate-500" />,
    in_progress: <Clock className="w-4 h-4 text-blue-500" />,
    completed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    blocked: <XCircle className="w-4 h-4 text-red-500" />
  };

  const statusColors = {
    pending: "bg-slate-100 text-slate-800",
    in_progress: "bg-blue-100 text-blue-800",
    completed: "bg-emerald-100 text-emerald-800",
    blocked: "bg-red-100 text-red-800"
  };

  const priorityColors = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-slate-100 text-slate-800"
  };

  const riskColors = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-emerald-100 text-emerald-800"
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            {statusIcons[item.status]}
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900">{item.title}</h4>
              <p className="text-sm text-slate-600 mt-1">{item.description}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge className={statusColors[item.status]}>
                  {item.status.replace('_', ' ')}
                </Badge>
                <Badge className={priorityColors[item.priority]}>
                  {item.priority} priority
                </Badge>
                <Badge className={riskColors[item.risk_level]}>
                  {item.risk_level} risk
                </Badge>
                <Badge variant="outline">{item.category}</Badge>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {item.ai_insights && (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-blue-600" />
                <h5 className="font-semibold text-blue-900">AI Insights & Risk Assessment</h5>
              </div>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{item.ai_insights}</p>
            </div>
          )}

          {item.recommendations && item.recommendations.length > 0 && (
            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
              <h5 className="font-semibold text-emerald-900 mb-2">Recommendations</h5>
              <ul className="space-y-2">
                {item.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-sm text-emerald-900 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.data_sources && item.data_sources.length > 0 && (
            <div className="p-3 bg-slate-50 rounded-lg">
              <h5 className="text-sm font-medium text-slate-900 mb-2">Data Sources</h5>
              <div className="flex flex-wrap gap-2">
                {item.data_sources.map((source, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {source}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Status</label>
              <Select value={item.status} onValueChange={(val) => onUpdate({ status: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Assigned To</label>
              <Select value={item.assigned_to || ""} onValueChange={(val) => onUpdate({ assigned_to: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Assign team member..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="legal_team">Legal Team</SelectItem>
                  <SelectItem value="finance_team">Finance Team</SelectItem>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                  <SelectItem value="it">IT/Technology</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => onUpdate({ notes })}
              placeholder="Add notes or findings..."
              rows={3}
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}