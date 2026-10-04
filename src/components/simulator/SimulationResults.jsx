import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, FileDown, Play, TrendingUp, DollarSign, BarChart3 } from "lucide-react";

import ResultsOverview from "./results/ResultsOverview";
import UnilateralResults from "./results/UnilateralResults";
import CoordinatedResults from "./results/CoordinatedResults";
import SensitivityResults from "./results/SensitivityResults";
import ExportReport from "./results/ExportReport";

export default function SimulationResults({ simulation, companies, onBack, onEdit, onDelete, canModify }) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{simulation.name}</h1>
              {simulation.description && (
                <p className="text-slate-600 mt-1">{simulation.description}</p>
              )}
            </div>
          </div>
          {canModify && (
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onEdit(simulation)} className="gap-2">
                <Pencil className="w-4 h-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (window.confirm(`Delete ${simulation.name}?`)) {
                    onDelete(simulation.id);
                  }
                }}
                className="gap-2 text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden md:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="unilateral" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden md:inline">Unilateral Effects</span>
            </TabsTrigger>
            <TabsTrigger value="coordinated" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              <span className="hidden md:inline">Coordinated Effects</span>
            </TabsTrigger>
            <TabsTrigger value="sensitivity" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden md:inline">Sensitivity</span>
            </TabsTrigger>
            <TabsTrigger value="export" className="flex items-center gap-2">
              <FileDown className="w-4 h-4" />
              <span className="hidden md:inline">Export</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <ResultsOverview simulation={simulation} companies={companies} />
          </TabsContent>

          <TabsContent value="unilateral">
            <UnilateralResults simulation={simulation} companies={companies} />
          </TabsContent>

          <TabsContent value="coordinated">
            <CoordinatedResults simulation={simulation} companies={companies} />
          </TabsContent>

          <TabsContent value="sensitivity">
            <SensitivityResults simulation={simulation} />
          </TabsContent>

          <TabsContent value="export">
            <ExportReport simulation={simulation} companies={companies} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}