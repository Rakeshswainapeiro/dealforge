import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle, Sparkles } from "lucide-react";

export default function DataValidationPanel({ validationResults }) {
  if (!validationResults) return null;

  const { issues, warnings, cleaned_data, summary } = validationResults;
  const hasIssues = issues?.length > 0;
  const hasWarnings = warnings?.length > 0;

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-teal-600" />
          AI Data Validation Results
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {summary && (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-900">Valid Records</span>
              </div>
              <p className="text-2xl font-bold text-emerald-600">{summary.valid_records || 0}</p>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-900">Warnings</span>
              </div>
              <p className="text-2xl font-bold text-amber-600">{warnings?.length || 0}</p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg border border-red-200">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-red-900">Errors</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{issues?.length || 0}</p>
            </div>
          </div>
        )}

        {hasIssues && (
          <Alert className="border-red-200 bg-red-50">
            <XCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-900">
              <strong>Critical Issues Found:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                {issues.map((issue, idx) => (
                  <li key={idx} className="text-sm">{issue}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {hasWarnings && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              <strong>Warnings:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                {warnings.map((warning, idx) => (
                  <li key={idx} className="text-sm">{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {!hasIssues && !hasWarnings && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-emerald-900">
              <strong>All Good!</strong> Data validation passed with no issues detected.
            </AlertDescription>
          </Alert>
        )}

        {cleaned_data && (
          <div className="p-4 bg-slate-50 rounded-lg">
            <h4 className="font-semibold text-slate-900 mb-2">AI Data Cleaning Applied:</h4>
            <div className="space-y-2">
              {cleaned_data.normalized_fields && (
                <div>
                  <Badge className="bg-blue-100 text-blue-800 mb-2">Normalized Fields</Badge>
                  <p className="text-sm text-slate-700">
                    {cleaned_data.normalized_fields.join(", ")}
                  </p>
                </div>
              )}
              {cleaned_data.filled_missing && (
                <div>
                  <Badge className="bg-purple-100 text-purple-800 mb-2">Filled Missing Values</Badge>
                  <p className="text-sm text-slate-700">
                    {cleaned_data.filled_missing.join(", ")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}