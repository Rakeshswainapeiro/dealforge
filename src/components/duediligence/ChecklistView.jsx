import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, XCircle, FileText, Upload } from "lucide-react";
import ChecklistItem from "./ChecklistItem";
import DocumentAnalyzer from "./DocumentAnalyzer";
import DocumentReview from "./DocumentReview";

export default function ChecklistView({ checklist, companies, onBack }) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showDocumentAnalyzer, setShowDocumentAnalyzer] = useState(false);
  const queryClient = useQueryClient();

  const acquirer = companies.find(c => c.id === checklist.acquirer_id);
  const target = companies.find(c => c.id === checklist.target_id);

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, updates }) => {
      const updatedItems = checklist.items.map(item =>
        item.id === itemId ? { ...item, ...updates } : item
      );
      
      const completedCount = updatedItems.filter(i => i.status === 'completed').length;
      const progress = (completedCount / updatedItems.length) * 100;
      
      return await api.entities.DueDiligenceChecklist.update(checklist.id, {
        items: updatedItems,
        progress_percentage: progress,
        status: progress === 100 ? 'completed' : 'in_progress'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dueDiligenceChecklists'] });
    },
  });

  const categories = [...new Set(checklist.items?.map(i => i.category) || [])];
  const filteredItems = selectedCategory === "all"
    ? checklist.items
    : checklist.items?.filter(i => i.category === selectedCategory);

  const statusCounts = {
    pending: checklist.items?.filter(i => i.status === 'pending').length || 0,
    in_progress: checklist.items?.filter(i => i.status === 'in_progress').length || 0,
    completed: checklist.items?.filter(i => i.status === 'completed').length || 0,
    blocked: checklist.items?.filter(i => i.status === 'blocked').length || 0,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Checklists
          </Button>
          <Button 
            onClick={() => setShowDocumentAnalyzer(true)}
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload Document
          </Button>
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
            <div className="space-y-4">
              <CardTitle className="text-2xl">{checklist.name}</CardTitle>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-slate-600">Acquirer: </span>
                  <span className="font-semibold">{acquirer?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-slate-600">Target: </span>
                  <span className="font-semibold">{target?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-slate-600">Deal Type: </span>
                  <span className="font-semibold capitalize">{checklist.deal_type.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-slate-600">Sector: </span>
                  <span className="font-semibold">{checklist.sector}</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Overall Progress</span>
                  <span className="text-sm font-semibold">{Math.round(checklist.progress_percentage || 0)}%</span>
                </div>
                <Progress value={checklist.progress_percentage || 0} className="h-3" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-slate-600" />
                  <span className="text-sm text-slate-600">Pending</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{statusCounts.pending}</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span className="text-sm text-blue-900">In Progress</span>
                </div>
                <p className="text-2xl font-bold text-blue-900">{statusCounts.in_progress}</p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm text-emerald-900">Completed</span>
                </div>
                <p className="text-2xl font-bold text-emerald-900">{statusCounts.completed}</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-900">Blocked</span>
                </div>
                <p className="text-2xl font-bold text-red-900">{statusCounts.blocked}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {showDocumentAnalyzer && (
          <DocumentAnalyzer
            checklist={checklist}
            onClose={() => setShowDocumentAnalyzer(false)}
            onAnalyzed={(result) => {
              setShowDocumentAnalyzer(false);
              alert(`Document analyzed! Added ${result.newItemsCount} new checklist items.`);
            }}
          />
        )}

        {checklist.documents && checklist.documents.length > 0 && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <FileText className="w-5 h-5" />
                Document Analysis ({checklist.documents.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentReview documents={checklist.documents} />
            </CardContent>
          </Card>
        )}

        {checklist.high_risk_areas && checklist.high_risk_areas.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <AlertTriangle className="w-5 h-5" />
                High-Risk Areas Requiring Attention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {checklist.high_risk_areas.map((area, idx) => (
                <div key={idx} className="p-4 bg-white rounded-lg border border-amber-200">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-amber-900">{area.area}</h4>
                    <Badge className="bg-red-100 text-red-800">
                      Risk Score: {area.risk_score}/100
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700 mb-3">{area.description}</p>
                  <div>
                    <p className="text-sm font-medium text-slate-900 mb-2">Mitigation Strategies:</p>
                    <ul className="space-y-1">
                      {area.mitigation_strategies?.map((strategy, i) => (
                        <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                          <span className="text-amber-600">•</span>
                          {strategy}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="all">All Items ({checklist.items?.length || 0})</TabsTrigger>
            {categories.map(category => (
              <TabsTrigger key={category} value={category}>
                {category} ({checklist.items?.filter(i => i.category === category).length || 0})
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={selectedCategory} className="space-y-3 mt-6">
            {filteredItems?.map(item => (
              <ChecklistItem
                key={item.id}
                item={item}
                onUpdate={(updates) => updateItemMutation.mutate({ itemId: item.id, updates })}
              />
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}