
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Shield, AlertCircle } from "lucide-react"; // Added AlertCircle
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";

export default function CompanyForm({ company, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(company || {
    name: "",
    ticker: "",
    sector: "",
    revenue: 0,
    ebitda: 0,
    net_income: 0,
    enterprise_value: 0,
    market_cap: 0,
    shares_outstanding: 0,
    stock_price: 0,
    total_debt: 0,
    cash: 0,
    market_share: 0,
    notes: "",
    visibility: "private",
    shared_with_groups: [],
    creator_organization: "",
  });

  const [availableGroups, setAvailableGroups] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [isImported, setIsImported] = useState(false); // New state for imported data

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = await api.auth.me();
        setCurrentUser(user);
        
        // Set creator organization if creating new company
        if (!company) {
          setFormData(prev => ({ 
            ...prev, 
            creator_organization: user.organization || "" 
          }));
        }

        // Check if this is imported data
        if (company && company.notes && company.notes.includes("Imported from")) {
          setIsImported(true);
        }

        const users = await api.entities.User.list();
        const groups = [...new Set(users.flatMap(u => u.groups || []))];
        setAvailableGroups(groups);
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };
    fetchData();
  }, [company]);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Ensure creator_organization is set
    const submitData = {
      ...formData,
      creator_organization: currentUser?.organization || formData.creator_organization
    };
    onSubmit(submitData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="border-slate-200 shadow-lg">
        <CardHeader className="border-b border-slate-100">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>
                {company && !isImported ? "Edit Company" : isImported ? "Review Imported Data" : "Add New Company"}
              </CardTitle>
              {isImported && (
                <p className="text-sm text-amber-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Please review and complete the imported data before saving
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name">Company Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticker">Ticker</Label>
                <Input
                  id="ticker"
                  value={formData.ticker}
                  onChange={(e) => handleChange("ticker", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sector">Sector</Label>
              <Input
                id="sector"
                value={formData.sector}
                onChange={(e) => handleChange("sector", e.target.value)}
              />
            </div>

            {/* Access Control Section */}
            <div className="border-t border-slate-200 pt-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-teal-600" />
                Access Control
              </h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="visibility">Visibility</Label>
                  <Select
                    value={formData.visibility}
                    onValueChange={(value) => handleChange("visibility", value)}
                  >
                    <SelectTrigger id="visibility">
                      <SelectValue placeholder="Select visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private (Only Me)</SelectItem>
                      <SelectItem value="organization">Organization (All Users)</SelectItem>
                      <SelectItem value="group">Group (Selected Groups)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.visibility === "group" && (
                  <div className="space-y-2">
                    <Label>Share with Groups</Label>
                    <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 min-h-[40px]">
                      {availableGroups.length > 0 ? (
                        availableGroups.map((group, idx) => (
                          <Badge
                            key={idx}
                            className={`cursor-pointer ${
                              formData.shared_with_groups?.includes(group)
                                ? 'bg-teal-100 text-teal-800 hover:bg-teal-200'
                                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                            }`}
                            onClick={() => {
                              const current = formData.shared_with_groups || [];
                              if (current.includes(group)) {
                                handleChange("shared_with_groups", current.filter(g => g !== group));
                              } else {
                                handleChange("shared_with_groups", [...current, group]);
                              }
                            }}
                          >
                            {group}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">No groups available. Ask admin to create groups.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Financials Section */}
            <div className="border-t border-slate-200 pt-6">
              <h3 className="font-semibold text-slate-900 mb-4">Financials ($ millions)</h3>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="revenue">Revenue</Label>
                  <Input
                    id="revenue"
                    type="number"
                    step="0.01"
                    value={formData.revenue}
                    onChange={(e) => handleChange("revenue", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ebitda">EBITDA</Label>
                  <Input
                    id="ebitda"
                    type="number"
                    step="0.01"
                    value={formData.ebitda}
                    onChange={(e) => handleChange("ebitda", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="net_income">Net Income</Label>
                  <Input
                    id="net_income"
                    type="number"
                    step="0.01"
                    value={formData.net_income}
                    onChange={(e) => handleChange("net_income", parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>

            {/* Valuation Section */}
            <div className="border-t border-slate-200 pt-6">
              <h3 className="font-semibold text-slate-900 mb-4">Valuation</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="enterprise_value">Enterprise Value</Label>
                  <Input
                    id="enterprise_value"
                    type="number"
                    step="0.01"
                    value={formData.enterprise_value}
                    onChange={(e) => handleChange("enterprise_value", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="market_cap">Market Cap</Label>
                  <Input
                    id="market_cap"
                    type="number"
                    step="0.01"
                    value={formData.market_cap}
                    onChange={(e) => handleChange("market_cap", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock_price">Stock Price</Label>
                  <Input
                    id="stock_price"
                    type="number"
                    step="0.01"
                    value={formData.stock_price}
                    onChange={(e) => handleChange("stock_price", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shares_outstanding">Shares Outstanding (M)</Label>
                  <Input
                    id="shares_outstanding"
                    type="number"
                    step="0.01"
                    value={formData.shares_outstanding}
                    onChange={(e) => handleChange("shares_outstanding", parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>

            {/* Balance Sheet Section */}
            <div className="border-t border-slate-200 pt-6">
              <h3 className="font-semibold text-slate-900 mb-4">Balance Sheet</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="total_debt">Total Debt</Label>
                  <Input
                    id="total_debt"
                    type="number"
                    step="0.01"
                    value={formData.total_debt}
                    onChange={(e) => handleChange("total_debt", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cash">Cash & Equivalents</Label>
                  <Input
                    id="cash"
                    type="number"
                    step="0.01"
                    value={formData.cash}
                    onChange={(e) => handleChange("cash", parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>

            {/* Market Share */}
            <div className="space-y-2">
              <Label htmlFor="market_share">Market Share (%)</Label>
              <Input
                id="market_share"
                type="number"
                step="0.01"
                value={formData.market_share}
                onChange={(e) => handleChange("market_share", parseFloat(e.target.value) || 0)}
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                rows={3}
              />
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700">
                {company ? "Update Company" : "Create Company"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
