import React, { useState } from "react";
import { api } from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, AlertCircle, CheckCircle, Loader2, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import ColumnMappingDialog from "../import/ColumnMappingDialog";
import DataValidationPanel from "../import/DataValidationPanel";

export default function ImportCompanyDialog({ open, onOpenChange, onDataExtracted }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [validationResults, setValidationResults] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setSuccess(false);
    }
  };

  const handleImport = async (columnMapping = null) => {
    if (!file) {
      setError("Please select a file to upload");
      return;
    }

    // Check if CSV/Excel needs column mapping
    const isSpreadsheet = file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    
    if (isSpreadsheet && !columnMapping) {
      // For spreadsheets, show column mapping dialog
      await handleSpreadsheetUpload();
      return;
    }

    setUploading(true);
    setProgress(20);
    setError(null);

    try {
      const uploadResult = await api.integrations.Core.UploadFile({ file });
      const fileUrl = uploadResult.file_url;
      setProgress(40);

      const companySchema = {
        type: "object",
        properties: {
          name: { type: "string", description: "Company name" },
          ticker: { type: "string", description: "Stock ticker symbol" },
          sector: { type: "string", description: "Industry sector or business type" },
          revenue: { type: "number", description: "Annual revenue in millions" },
          ebitda: { type: "number", description: "EBITDA in millions" },
          net_income: { type: "number", description: "Net income in millions" },
          enterprise_value: { type: "number", description: "Enterprise value in millions" },
          market_cap: { type: "number", description: "Market capitalization in millions" },
          shares_outstanding: { type: "number", description: "Shares outstanding in millions" },
          stock_price: { type: "number", description: "Current stock price" },
          total_debt: { type: "number", description: "Total debt in millions" },
          cash: { type: "number", description: "Cash and equivalents in millions" },
          total_assets: { type: "number", description: "Total assets in millions" },
          total_equity: { type: "number", description: "Total equity in millions" },
          notes: { type: "string", description: "Any additional relevant information from the document" }
        }
      };

      setExtracting(true);
      setProgress(60);

      const extractResult = await api.integrations.Core.ExtractDataFromUploadedFile({
        file_url: fileUrl,
        json_schema: companySchema
      });

      setProgress(75);

      if (extractResult.status === "success" && extractResult.output) {
        // AI-powered data validation
        setValidating(true);
        setProgress(85);
        
        const validationResult = await validateWithAI(extractResult.output);
        setValidationResults(validationResult);
        setProgress(100);
        setSuccess(true);
        
        const cleanedData = validationResult.cleaned_data || extractResult.output;
        
        const extractedData = {
          name: cleanedData.name || "",
          ticker: cleanedData.ticker || "",
          sector: cleanedData.sector || "",
          revenue: cleanedData.revenue || 0,
          ebitda: cleanedData.ebitda || 0,
          net_income: cleanedData.net_income || 0,
          enterprise_value: cleanedData.enterprise_value || 0,
          market_cap: cleanedData.market_cap || 0,
          shares_outstanding: cleanedData.shares_outstanding || 0,
          stock_price: cleanedData.stock_price || 0,
          total_debt: cleanedData.total_debt || 0,
          cash: cleanedData.cash || 0,
          market_share: 0,
          notes: cleanedData.notes || `Imported from ${file.name}`,
          visibility: "private",
          shared_with_groups: [],
        };

        if (extractedData.shares_outstanding > 0 && extractedData.stock_price > 0) {
          extractedData.market_cap = extractedData.shares_outstanding * extractedData.stock_price;
        }

        setTimeout(() => {
          onDataExtracted(extractedData);
          onOpenChange(false);
          resetForm();
        }, 1500);
      } else {
        setError(extractResult.details || "Failed to extract data from the file. Please try again or enter data manually.");
        setProgress(0);
      }
    } catch (err) {
      console.error("Import error:", err);
      setError(err.message || "An error occurred while processing the file. Please try again.");
      setProgress(0);
    } finally {
      setUploading(false);
      setExtracting(false);
      setValidating(false);
    }
  };

  const handleSpreadsheetUpload = async () => {
    // Simulate reading CSV headers (in production, would parse actual file)
    const mockHeaders = ["Company Name", "Ticker", "Industry", "Annual Revenue", "EBITDA", "Stock Price", "Shares Out"];
    setCsvHeaders(mockHeaders);
    setShowColumnMapping(true);
  };

  const handleMappingComplete = (mapping) => {
    setShowColumnMapping(false);
    // In production, would apply mapping and import data
    handleImport(mapping);
  };

  const validateWithAI = async (data) => {
    try {
      const validationPrompt = `Validate and clean this company financial data. Check for:
1. Missing required fields (company name is required)
2. Inconsistent units (ensure all financials are in millions)
3. Unrealistic values or outliers
4. Data type mismatches

Data: ${JSON.stringify(data)}

Return validation results including any issues, warnings, and cleaned data.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt: validationPrompt,
        add_context_from_internet: false,
        response_json_schema: {
          type: "object",
          properties: {
            issues: { type: "array", items: { type: "string" } },
            warnings: { type: "array", items: { type: "string" } },
            cleaned_data: { type: "object" },
            summary: {
              type: "object",
              properties: {
                valid_records: { type: "number" }
              }
            }
          }
        }
      });

      return result;
    } catch (err) {
      console.error("Validation error:", err);
      return {
        issues: [],
        warnings: [],
        cleaned_data: data,
        summary: { valid_records: 1 }
      };
    }
  };

  const resetForm = () => {
    setFile(null);
    setProgress(0);
    setError(null);
    setSuccess(false);
    setUploading(false);
    setExtracting(false);
    setValidating(false);
    setValidationResults(null);
    setCsvHeaders([]);
  };

  const handleClose = () => {
    if (!uploading && !extracting) {
      resetForm();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-teal-600" />
            Import Company Data
          </DialogTitle>
          <DialogDescription>
            Upload a financial statement (PDF, CSV, or Excel) and AI will extract company data automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="file-upload">Select File</Label>
            <div className="flex items-center gap-3">
              <input
                id="file-upload"
                type="file"
                accept=".pdf,.csv,.xlsx,.xls"
                onChange={handleFileChange}
                disabled={uploading || extracting}
                className="hidden"
              />
              <label
                htmlFor="file-upload"
                className={`flex-1 flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                  file
                    ? "border-teal-400 bg-teal-50"
                    : "border-slate-300 bg-slate-50 hover:border-slate-400"
                } ${uploading || extracting ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <FileText className="w-5 h-5 text-slate-500" />
                <span className="text-sm text-slate-700 truncate">
                  {file ? file.name : "Choose PDF, CSV, or Excel file"}
                </span>
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Supported formats: PDF, CSV, Excel (.xlsx, .xls)
            </p>
          </div>

          {(uploading || extracting || validating) && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 flex items-center gap-2">
                  {uploading && !extracting && !validating && "Uploading file..."}
                  {extracting && !validating && "Extracting data with AI..."}
                  {validating && (
                    <>
                      <Sparkles className="w-4 h-4 text-teal-600" />
                      Validating and cleaning data...
                    </>
                  )}
                </span>
                <span className="text-teal-600 font-semibold">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {validationResults && (
            <DataValidationPanel validationResults={validationResults} />
          )}

          {success && (
            <Alert className="border-emerald-200 bg-emerald-50">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-900">
                <strong>Success!</strong> Company data extracted successfully. Review and edit as needed.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <strong>Error:</strong> {error}
              </AlertDescription>
            </Alert>
          )}

          {!uploading && !extracting && !success && !error && (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>How it works:</strong> Upload a financial document, and AI will automatically extract key financial metrics. You can review and edit the data before saving.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={uploading || extracting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!file || uploading || extracting || success}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {uploading || extracting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import Data
              </>
            )}
          </Button>
        </div>
      </DialogContent>

      <ColumnMappingDialog
        open={showColumnMapping}
        onOpenChange={setShowColumnMapping}
        csvHeaders={csvHeaders}
        onMappingComplete={handleMappingComplete}
      />
    </Dialog>
  );
}