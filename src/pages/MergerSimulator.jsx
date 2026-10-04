import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Play, FileText } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import SimulationList from "../components/simulator/SimulationList";
import SimulationBuilder from "../components/simulator/SimulationBuilder";
import SimulationResults from "../components/simulator/SimulationResults";

export default function MergerSimulator() {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSimulation, setEditingSimulation] = useState(null);
  const [selectedSimulation, setSelectedSimulation] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: simulations, isLoading } = useQuery({
    queryKey: ['simulations'],
    queryFn: async () => {
      const allSims = await api.entities.MergerSimulation.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') return allSims;
      
      return allSims.filter(sim => {
        if (sim.created_by === user.email) return true;
        if (sim.visibility === 'organization' && user.organization) return true;
        if (sim.visibility === 'group' && sim.shared_with_groups && user.groups) {
          return sim.shared_with_groups.some(group => user.groups.includes(group));
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
      
      if (user.role === 'admin') return allCompanies;
      
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
      return api.entities.MergerSimulation.create({
        ...data,
        creator_organization: user.organization || ""
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
      setShowBuilder(false);
      setEditingSimulation(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.MergerSimulation.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
      setShowBuilder(false);
      setEditingSimulation(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.MergerSimulation.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
      setSelectedSimulation(null);
    },
  });

  const handleSubmit = (data) => {
    if (editingSimulation) {
      updateMutation.mutate({ id: editingSimulation.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (simulation) => {
    setEditingSimulation(simulation);
    setShowBuilder(true);
    setSelectedSimulation(null);
  };

  const handleDelete = (id) => {
    deleteMutation.mutate(id);
  };

  const canModify = (simulation) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return simulation.created_by === currentUser.email;
  };

  if (selectedSimulation) {
    return (
      <SimulationResults
        simulation={selectedSimulation}
        companies={companies}
        onBack={() => setSelectedSimulation(null)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        canModify={canModify(selectedSimulation)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Merger Simulator</h1>
            <p className="text-slate-600 mt-1">
              Advanced economic modeling for competitive effects analysis
            </p>
          </div>
          <Button 
            onClick={() => {
              setEditingSimulation(null);
              setShowBuilder(true);
            }}
            className="bg-teal-600 hover:bg-teal-700 gap-2"
          >
            <Plus className="w-4 h-4" />
            New Simulation
          </Button>
        </div>

        <AnimatePresence>
          {showBuilder && (
            <SimulationBuilder
              simulation={editingSimulation}
              companies={companies}
              onSubmit={handleSubmit}
              onCancel={() => {
                setShowBuilder(false);
                setEditingSimulation(null);
              }}
            />
          )}
        </AnimatePresence>

        {!showBuilder && (
          <SimulationList
            simulations={simulations}
            companies={companies}
            onSelect={setSelectedSimulation}
            onEdit={handleEdit}
            onDelete={handleDelete}
            canModify={canModify}
            loading={isLoading}
          />
        )}
      </div>
    </div>
  );
}