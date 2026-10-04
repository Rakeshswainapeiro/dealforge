import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Columns, CheckCircle, AlertCircle } from "lucide-react";

export default function ColumnMappingDialog({ open, onOpenChange, csvHeaders, onMappingComplete }) {
  const [mapping, setMapping] = useState({});
  const [validationErrors, setValidationErrors] = useState([]);

  const companyFields = [
    { key: "name", label: "Company Name", required: true },
    { key: "ticker", label: "Ticker Symbol", required: false },
    { key: "sector", label: "Sector", required: false },
    { key: "revenue", label: "Revenue (M)", required: false },
    { key: "ebitda", label: "EBITDA (M)", required: false },
    { key: "net_income", label: "Net Income (M)", required: false },
    { key: "enterprise_value", label: "Enterprise Value (M)", required: false },
    { key: "market_cap", label: "Market Cap (M)", required: false },
    { key: "shares_outstanding", label: "Shares Outstanding (M)", required: false },
    { key: "stock_price", label: "Stock Price", required: false },
    { key: "total_debt", label: "Total Debt (M)", required: false },
    { key: "cash", label: "Cash (M)", required: false },
    { key: "market_share", label: "Market Share (%)", required: false },
    { key: "notes", label: "Notes", required: false }
  ];

  const handleMappingChange = (fieldKey, csvHeader) => {
    setMapping(prev => ({
      ...prev,
      [fieldKey]: csvHeader === "skip" ? null : csvHeader
    }));
    setValidationErrors([]);
  };

  const validateMapping = () => {
    const errors = [];
    const requiredFields = companyFields.filter(f => f.required);
    
    requiredFields.forEach(field => {
      if (!mapping[field.key]) {
        errors.push(`${field.label} is required but not mapped`);
      }
    });

    // Check for duplicate mappings
    const mappedHeaders = Object.values(mapping).filter(v => v !== null);
    const duplicates = mappedHeaders.filter((item, index) => mappedHeaders.indexOf(item) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate column mappings detected: ${duplicates.join(", ")}`);
    }

    return errors;
  };

  const handleConfirm = () => {
    const errors = validateMapping();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    onMappingComplete(mapping);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns className="w-5 h-5 text-teal-600" />
            Map CSV Columns to Fields
          </DialogTitle>
          <DialogDescription>
            Match your spreadsheet columns to the corresponding company data fields
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {validationErrors.length > 0 && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <strong>Validation Errors:</strong>
                <ul className="list-disc list-inside mt-2">
                  {validationErrors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Alert className="border-blue-200 bg-blue-50">
            <CheckCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <strong>Tip:</strong> Required fields are marked with an asterisk (*). Select "Skip" for columns you don't want to import.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4">
            {companyFields.map(field => (
              <div key={field.key} className="grid grid-cols-2 items-center gap-4">
                <Label className="text-right">
                  {field.label}
                  {field.required && <span className="text-red-600 ml-1">*</span>}
                </Label>
                <Select
                  value={mapping[field.key] || ""}
                  onValueChange={(value) => handleMappingChange(field.key, value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip this field</SelectItem>
                    {csvHeaders.map((header, idx) => (
                      <SelectItem key={idx} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="bg-teal-600 hover:bg-teal-700">
            Confirm Mapping
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}