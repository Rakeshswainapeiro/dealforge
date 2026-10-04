import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitMerge, Pencil, Trash2, ArrowRight } from "lucide-react";

export default function ScenarioCard({ scenario, companies, onClick, onEdit, onDelete, canModify = true }) {
  const acquirer = companies.find(c => c.id === scenario.acquirer_id);
  
  const statusColors = {
    draft: "bg-slate-100 text-slate-800",
    active: "bg-teal-100 text-teal-800",
    completed: "bg-emerald-100 text-emerald-800",
    archived: "bg-amber-100 text-amber-800",
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card 
        className="border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
        onClick={onClick}
      >
        <CardHeader className="border-b border-slate-100 p-4">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                <GitMerge className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">{scenario.name}</h3>
                <Badge className={`mt-1 ${statusColors[scenario.status]}`}>
                  {scenario.status}
                </Badge>
              </div>
            </div>
            {canModify && (
              <div className="flex gap-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(scenario);
                  }}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete ${scenario.name}?`)) {
                      onDelete();
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {acquirer && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-900">{acquirer.name}</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">Target</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Premium</span>
            <span className="text-sm font-semibold text-slate-900">
              {scenario.deal_structure?.premium || 0}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Cash/Stock</span>
            <span className="text-sm font-semibold text-slate-900">
              {scenario.deal_structure?.cash_percentage || 0}% / {scenario.deal_structure?.stock_percentage || 0}%
            </span>
          </div>
          {(scenario.synergies?.revenue_synergies || scenario.synergies?.cost_synergies) && (
            <div className="flex justify-between pt-2 border-t border-slate-100">
              <span className="text-sm text-slate-600">Total Synergies</span>
              <span className="text-sm font-bold text-teal-600">
                ${((scenario.synergies.revenue_synergies || 0) + (scenario.synergies.cost_synergies || 0)).toFixed(0)}M
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}