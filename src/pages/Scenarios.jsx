
import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import ScenarioBuilder from "../components/scenarios/ScenarioBuilder";
import ScenarioCard from "../components/scenarios/ScenarioCard";
import ScenarioDetails from "../components/scenarios/ScenarioDetails";

export default function Scenarios() {
  const [showForm, setShowForm] = useState(false);
  const [editingScenario, setEditingScenario] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: scenarios, isLoading: loadingScenarios } = useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const allScenarios = await api.entities.MergerScenario.list('-updated_date');
      const user = await api.auth.me();
      
      // Admin sees all scenarios
      if (user.role === 'admin') {
        return allScenarios;
      }
      
      // Filter scenarios based on visibility
      return allScenarios.filter(scenario => {
        // User's own scenarios
        if (scenario.created_by === user.email) {
          return true;
        }
        
        // Organization-wide scenarios
        if (scenario.visibility === 'organization' && user.organization) {
          return true;
        }
        
        // Group-shared scenarios
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
      const allCompanies = await api.entities.Company.list();
      const user = await api.auth.me();
      
      // Admin sees all companies
      if (user.role === 'admin') {
        return allCompanies;
      }
      
      // Filter companies based on visibility
      return allCompanies.filter(company => {
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

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const user = await api.auth.me();
      return api.entities.MergerScenario.create({
        ...data,
        creator_organization: user.organization || ""
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      setShowForm(false);
      setEditingScenario(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.MergerScenario.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      setShowForm(false);
      setEditingScenario(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.MergerScenario.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      setSelectedScenario(null);
    },
  });

  const handleSubmit = (data) => {
    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (scenario) => {
    setEditingScenario(scenario);
    setShowForm(true);
  };

  // Check if user can edit/delete a scenario
  const canModify = (scenario) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return scenario.created_by === currentUser.email;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Merger Scenarios</h1>
            <p className="text-slate-600 mt-1">Model deals and analyze pro-forma impact</p>
          </div>
          <Button 
            onClick={() => {
              setEditingScenario(null);
              setShowForm(true);
            }}
            className="bg-teal-600 hover:bg-teal-700 gap-2"
          >
            <Plus className="w-4 h-4" />
            New Scenario
          </Button>
        </div>

        <AnimatePresence>
          {showForm && (
            <ScenarioBuilder
              scenario={editingScenario}
              companies={companies}
              onSubmit={handleSubmit}
              onCancel={() => {
                setShowForm(false);
                setEditingScenario(null);
              }}
            />
          )}
        </AnimatePresence>

        {selectedScenario ? (
          <ScenarioDetails
            scenario={selectedScenario}
            companies={companies}
            onBack={() => setSelectedScenario(null)}
            onEdit={handleEdit}
            onDelete={() => deleteMutation.mutate(selectedScenario.id)}
            canModify={canModify(selectedScenario)}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loadingScenarios ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-48 bg-white rounded-xl animate-pulse" />
              ))
            ) : (
              scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  companies={companies}
                  onClick={() => setSelectedScenario(scenario)}
                  onEdit={handleEdit}
                  onDelete={() => deleteMutation.mutate(scenario.id)}
                  canModify={canModify(scenario)}
                />
              ))
            )}
          </div>
        )}

        {!loadingScenarios && scenarios.length === 0 && !showForm && (
          <div className="text-center py-12">
            <p className="text-slate-500">No scenarios yet. Create your first merger model to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
