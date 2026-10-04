import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function AddHoldingForm({ portfolioId, companies, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    portfolio_id: portfolioId,
    company_id: "",
    shares: 0,
    purchase_price: 0,
    purchase_date: new Date().toISOString().split('T')[0],
    notes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const selectedCompany = companies.find(c => c.id === formData.company_id);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Company *</Label>
        <Select 
          value={formData.company_id} 
          onValueChange={(value) => {
            const company = companies.find(c => c.id === value);
            setFormData({ 
              ...formData, 
              company_id: value,
              purchase_price: company?.stock_price || 0
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a company" />
          </SelectTrigger>
          <SelectContent>
            {companies.map(company => (
              <SelectItem key={company.id} value={company.id}>
                {company.name} {company.ticker ? `(${company.ticker})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Shares (Millions) *</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.shares}
            onChange={(e) => setFormData({ ...formData, shares: parseFloat(e.target.value) || 0 })}
            placeholder="0.00"
            required
          />
        </div>

        <div>
          <Label>Purchase Price *</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.purchase_price}
            onChange={(e) => setFormData({ ...formData, purchase_price: parseFloat(e.target.value) || 0 })}
            placeholder="0.00"
            required
          />
          {selectedCompany && (
            <p className="text-xs text-slate-500 mt-1">
              Current: {selectedCompany.currency} {selectedCompany.stock_price.toFixed(2)}
            </p>
          )}
        </div>
      </div>

      <div>
        <Label>Purchase Date</Label>
        <Input
          type="date"
          value={formData.purchase_date}
          onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
        />
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Investment thesis, rationale..."
          rows={2}
        />
      </div>

      {formData.shares > 0 && formData.purchase_price > 0 && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <p className="text-sm text-slate-600">Total Cost</p>
          <p className="text-xl font-bold text-slate-900">
            ${(formData.shares * formData.purchase_price).toFixed(2)}M
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="bg-teal-600 hover:bg-teal-700">
          Add Holding
        </Button>
      </div>
    </form>
  );
}