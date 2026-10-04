import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Shield } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";

export default function ScenarioForm({ scenario, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(scenario || {
    name: "",
    acquirer_id: "",
    target_ids: [],
    deal_structure: {
      cash_percentage: 50,
      stock_percentage: 50,
      premium: 30,
      new_debt: 0,
    },
    synergies: {
      revenue_synergies: 0,
      cost_synergies: 0,
      integration_costs: 0,
      synergy_realization_years: 3,
    },
    assumptions: {
      wacc: 8,
      tax_rate: 25,
      closing_date: new Date().toISOString().split('T')[0],
    },
    status: "draft",
    visibility: "private",
    shared_with_groups: [],
  });

  const [availableGroups, setAvailableGroups] = React.useState([]);

  React.useEffect(() => {
    const fetchGroups = async () => {
      try {
        const users = await api.entities.User.list();
        const groups = [...new Set(users.flatMap(u => u.groups || []))];
        setAvailableGroups(groups);
      } catch (error) {
        console.error("Error fetching groups:", error);
      }
    };
    fetchGroups();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
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
            <CardTitle>{scenario ? "Edit Scenario" : "Create New Scenario"}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Scenario Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="e.g., Tech Giant + AI Startup Merger"
                required
              />
            </div>

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
                      <SelectValue />
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
                    <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 min-h-[60px]">
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

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => handleChange("status", value)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes || ""}
                onChange={(e) => handleChange("notes", e.target.value)}
                rows={3}
                placeholder="Additional scenario notes..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700">
                {scenario ? "Update Scenario" : "Create Scenario"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}