import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, AlertTriangle, TrendingUp, Shield, ExternalLink } from "lucide-react";

export default function DocumentReview({ documents }) {
  if (!documents || documents.length === 0) {
    return null;
  }

  const getDocumentTypeLabel = (type) => {
    const labels = {
      financial: "Financial Statement",
      legal: "Legal Contract",
      merger_agreement: "Merger Agreement",
      disclosure_schedule: "Disclosure Schedule",
      due_diligence_report: "DD Report",
      other: "Other"
    };
    return labels[type] || type;
  };

  const severityColors = {
    critical: "bg-red-100 text-red-800 border-red-300",
    high: "bg-orange-100 text-orange-800 border-orange-300",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
    low: "bg-emerald-100 text-emerald-800 border-emerald-300"
  };

  return (
    <div className="space-y-4">
      {documents.map((doc) => (
        <Card key={doc.id} className="border-slate-200">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-blue-600 mt-1" />
                <div>
                  <CardTitle className="text-lg">{doc.name}</CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline">{getDocumentTypeLabel(doc.type)}</Badge>
                    <Badge className={
                      doc.analysis_status === 'completed' ? "bg-emerald-100 text-emerald-800" :
                      doc.analysis_status === 'analyzing' ? "bg-blue-100 text-blue-800" :
                      doc.analysis_status === 'failed' ? "bg-red-100 text-red-800" :
                      "bg-slate-100 text-slate-800"
                    }>
                      {doc.analysis_status}
                    </Badge>
                  </div>
                </div>
              </div>
              {doc.file_url && (
                <Button variant="outline" size="sm" asChild>
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View
                  </a>
                </Button>
              )}
            </div>
          </CardHeader>

          {doc.analysis_status === 'completed' && (
            <CardContent className="p-6 space-y-6">
              {doc.summary && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Executive Summary
                  </h4>
                  <p className="text-sm text-blue-900">{doc.summary}</p>
                </div>
              )}

              {doc.identified_risks && doc.identified_risks.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    Identified Risks
                  </h4>
                  <div className="space-y-2">
                    {doc.identified_risks.map((risk, idx) => (
                      <div key={idx} className={`p-3 rounded-lg border-2 ${severityColors[risk.severity?.toLowerCase()] || severityColors.medium}`}>
                        <div className="flex items-start justify-between mb-1">
                          <p className="font-medium text-sm">{risk.risk}</p>
                          <Badge className="text-xs">{risk.severity}</Badge>
                        </div>
                        {risk.page_reference && (
                          <p className="text-xs opacity-75">Reference: {risk.page_reference}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {doc.key_clauses && doc.key_clauses.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-600" />
                    Key Clauses
                  </h4>
                  <ul className="space-y-2">
                    {doc.key_clauses.map((clause, idx) => (
                      <li key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm text-slate-700">
                        {clause}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {doc.financial_highlights && doc.financial_highlights.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    Financial Highlights
                  </h4>
                  <ul className="space-y-2">
                    {doc.financial_highlights.map((highlight, idx) => (
                      <li key={idx} className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-sm text-emerald-900">
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {doc.legal_concerns && doc.legal_concerns.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Legal Concerns
                  </h4>
                  <ul className="space-y-2">
                    {doc.legal_concerns.map((concern, idx) => (
                      <li key={idx} className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-sm text-amber-900">
                        {concern}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {doc.recommendations && doc.recommendations.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-3">Recommendations</h4>
                  <ul className="space-y-2">
                    {doc.recommendations.map((rec, idx) => (
                      <li key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-900 flex items-start gap-2">
                        <span className="text-blue-600 font-bold">{idx + 1}.</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}