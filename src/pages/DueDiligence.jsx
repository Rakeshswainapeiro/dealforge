import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Plus } from "lucide-react";
import ChecklistGenerator from "../components/duediligence/ChecklistGenerator";
import ChecklistCard from "../components/duediligence/ChecklistCard";
import ChecklistView from "../components/duediligence/ChecklistView";

export default function DueDiligence() {
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: checklists, isLoading } = useQuery({
    queryKey: ['dueDiligenceChecklists'],
    queryFn: async () => {
      const all = await api.entities.DueDiligenceChecklist.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') return all;
      
      return all.filter(checklist => {
        if (checklist.created_by === user.email) return true;
        if (checklist.visibility === 'organization' && user.organization) return true;
        if (checklist.visibility === 'group' && checklist.shared_with_groups && user.groups) {
          return checklist.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  const { data: scenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const all = await api.entities.MergerScenario.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') return all;
      
      return all.filter(scenario => {
        if (scenario.created_by === user.email) return true;
        if (scenario.visibility === 'organization' && user.organization) return true;
        if (scenario.visibility === 'group' && scenario.shared_with_groups && user.groups) {
          return scenario.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const all = await api.entities.Company.list();
      const user = await api.auth.me();
      
      if (user.role === 'admin') return all;
      
      return all.filter(company => {
        if (company.created_by === user.email) return true;
        if (company.visibility === 'organization' && user.organization) return true;
        if (company.visibility === 'group' && company.shared_with_groups && user.groups) {
          return company.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  if (selectedChecklist) {
    return (
      <ChecklistView
        checklist={selectedChecklist}
        companies={companies}
        onBack={() => setSelectedChecklist(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-white" />
              </div>
              Due Diligence Checklists
            </h1>
            <p className="text-slate-600 mt-2">
              AI-powered automated due diligence tracking and risk assessment
            </p>
          </div>
          <Button
            onClick={() => setShowGenerator(true)}
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Checklist
          </Button>
        </div>

        {showGenerator && (
          <ChecklistGenerator
            scenarios={scenarios}
            companies={companies}
            onClose={() => setShowGenerator(false)}
            onCreated={() => setShowGenerator(false)}
          />
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-64 bg-white rounded-xl animate-pulse" />
            ))}
          </div>
        ) : checklists.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="p-12 text-center">
              <ClipboardCheck className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No Checklists Yet</h3>
              <p className="text-slate-600 mb-4">
                Create your first AI-powered due diligence checklist to get started
              </p>
              <Button onClick={() => setShowGenerator(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Checklist
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {checklists.map(checklist => (
              <ChecklistCard
                key={checklist.id}
                checklist={checklist}
                companies={companies}
                onClick={() => setSelectedChecklist(checklist)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}