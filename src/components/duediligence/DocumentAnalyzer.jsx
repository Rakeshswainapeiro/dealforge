import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Loader2, FileText, X } from "lucide-react";

export default function DocumentAnalyzer({ checklist, onClose, onAnalyzed }) {
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState("financial");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please select a file");

      // Upload file
      const { file_url } = await api.integrations.Core.UploadFile({ file });

      const documentId = Date.now().toString();
      
      // Add document to checklist with pending status
      const documents = checklist.documents || [];
      const newDoc = {
        id: documentId,
        name: file.name,
        type: documentType,
        file_url,
        uploaded_date: new Date().toISOString(),
        analysis_status: "analyzing"
      };

      await api.entities.DueDiligenceChecklist.update(checklist.id, {
        documents: [...documents, newDoc]
      });

      // Analyze document with AI
      const prompt = `Analyze this ${documentType} document for M&A due diligence purposes.

**Document Type:** ${documentType}
**Analysis Required:**

1. **Executive Summary:** Provide a 2-3 sentence overview of the document
2. **Key Clauses/Sections:** Extract 5-8 most important clauses, terms, or sections
3. **Risk Identification:** Identify potential risks with severity (critical/high/medium/low) and page references
4. **Financial Highlights:** Extract key financial data, ratios, or obligations (for financial documents)
5. **Legal Concerns:** Flag any legal red flags, liabilities, or compliance issues (for legal documents)
6. **Recommendations:** Provide 3-5 actionable recommendations for the deal team

Focus on M&A-relevant aspects: liabilities, obligations, change of control clauses, earn-outs, warranties, indemnities, financial covenants, material adverse change clauses, etc.`;

      const analysis = await api.integrations.Core.InvokeLLM({
        prompt,
        file_urls: [file_url],
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            key_clauses: { type: "array", items: { type: "string" } },
            identified_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  severity: { type: "string" },
                  page_reference: { type: "string" }
                }
              }
            },
            financial_highlights: { type: "array", items: { type: "string" } },
            legal_concerns: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
            suggested_checklist_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string" },
                  risk_level: { type: "string" }
                }
              }
            }
          }
        }
      });

      // Update document with analysis results
      const updatedDocuments = documents.map(doc =>
        doc.id === documentId ? { ...doc, ...analysis, analysis_status: "completed" } : doc
      );

      // Add new checklist items from document analysis
      const existingItems = checklist.items || [];
      const newItems = analysis.suggested_checklist_items?.map(item => ({
        id: Date.now().toString() + Math.random(),
        ...item,
        status: "pending",
        ai_insights: `Auto-generated from ${file.name}`,
        linked_document_ids: [documentId],
        data_sources: [file.name]
      })) || [];

      const allItems = [...existingItems, ...newItems];
      const completedCount = allItems.filter(i => i.status === 'completed').length;
      const progress = (completedCount / allItems.length) * 100;

      await api.entities.DueDiligenceChecklist.update(checklist.id, {
        documents: updatedDocuments,
        items: allItems,
        progress_percentage: progress
      });

      return { analysis, newItemsCount: newItems.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dueDiligenceChecklists'] });
      onAnalyzed(result);
    },
    onError: (err) => {
      setError(err.message || "Failed to analyze document");
      setAnalyzing(false);
    }
  });

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    await analyzeMutation.mutateAsync();
  };

  return (
    <Card className="border-blue-200 shadow-lg">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Upload & Analyze Document
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="space-y-2">
          <Label>Document Type</Label>
          <Select value={documentType} onValueChange={setDocumentType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="financial">Financial Statement</SelectItem>
              <SelectItem value="legal">Legal Contract</SelectItem>
              <SelectItem value="merger_agreement">Merger Agreement</SelectItem>
              <SelectItem value="disclosure_schedule">Disclosure Schedule</SelectItem>
              <SelectItem value="due_diligence_report">Due Diligence Report</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Upload Document (PDF, DOCX, etc.)</Label>
          <Input
            type="file"
            onChange={(e) => setFile(e.target.files[0])}
            accept=".pdf,.doc,.docx,.xls,.xlsx"
          />
        </div>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-900">
            AI will analyze the document to:
          </p>
          <ul className="text-sm text-blue-900 mt-2 space-y-1 ml-4">
            <li>• Extract key clauses and terms</li>
            <li>• Identify potential risks and red flags</li>
            <li>• Highlight financial obligations</li>
            <li>• Auto-generate relevant checklist items</li>
          </ul>
        </div>

        <Button
          onClick={handleAnalyze}
          disabled={!file || analyzing}
          className="w-full bg-blue-600 hover:bg-blue-700 h-12"
        >
          {analyzing ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Analyzing Document...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5 mr-2" />
              Upload & Analyze
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}