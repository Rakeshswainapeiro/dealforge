import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Save, Settings, Database, TrendingUp, Zap, Shield } from "lucide-react";

import MarketSetup from "./steps/MarketSetup";
import BaselineData from "./steps/BaselineData";
import DemandDiversion from "./steps/DemandDiversion";
import PricingConfig from "./steps/PricingConfig";
import UnilateralCalc from "./steps/UnilateralCalc";
import EfficienciesRemedies from "./steps/EfficienciesRemedies";
import SensitivityConfig from "./steps/SensitivityConfig";

export default function SimulationBuilder({ simulation, companies, onSubmit, onCancel }) {
  const [activeTab, setActiveTab] = useState("market");
  const [formData, setFormData] = useState(simulation || {
    name: "",
    description: "",
    market_definition: {
      product_market: "",
      geographic_market: "",
      time_window: "",
      currency: "USD",
      multi_market: false
    },
    baseline_data: {
      prices: [],
      capacity_data: [],
      elasticities: {
        own_price: [],
        cross_price: []
      },
      diversion_matrix: []
    },
    demand_model: {
      model_type: "log_linear",
      quality_controls: []
    },
    pricing_model: "bertrand",
    merger_parties: {
      acquirer_id: "",
      target_ids: []
    },
    efficiencies: {
      variable_cost_reduction: 0,
      fixed_cost_synergies: 0,
      pass_through_rate: 0.5
    },
    sensitivity_analysis: {
      margin_range: [-10, 10],
      elasticity_range: [-0.5, 0.5],
      monte_carlo_runs: 1000
    },
    status: "draft",
    visibility: "private",
    shared_with_groups: []
  });

  const handleUpdate = (section, data) => {
    setFormData(prev => ({
      ...prev,
      [section]: { ...prev[section], ...data }
    }));
  };

  const handleSubmit = () => {
    onSubmit(formData);
  };

  const tabs = [
    { id: "market", label: "Market Setup", icon: Settings },
    { id: "baseline", label: "Baseline Data", icon: Database },
    { id: "demand", label: "Demand & Diversion", icon: TrendingUp },
    { id: "pricing", label: "Pricing Model", icon: Zap },
    { id: "unilateral", label: "Unilateral Effects", icon: TrendingUp },
    { id: "efficiencies", label: "Efficiencies", icon: Shield },
    { id: "sensitivity", label: "Sensitivity", icon: TrendingUp }
  ];

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
              <CardTitle className="text-2xl">
                {simulation ? "Edit Simulation" : "New Merger Simulation"}
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">
                Configure market parameters and run competitive effects analysis
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid grid-cols-7 w-full bg-slate-100">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-2 text-xs"
                >
                  <tab.icon className="w-3 h-3" />
                  <span className="hidden md:inline">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="market">
              <MarketSetup
                data={formData.market_definition}
                onUpdate={(data) => handleUpdate("market_definition", data)}
                onNext={() => setActiveTab("baseline")}
              />
            </TabsContent>

            <TabsContent value="baseline">
              <BaselineData
                data={formData.baseline_data}
                companies={companies}
                mergerParties={formData.merger_parties}
                onUpdate={(data) => handleUpdate("baseline_data", data)}
                onUpdateMergerParties={(data) => handleUpdate("merger_parties", data)}
                onNext={() => setActiveTab("demand")}
                onBack={() => setActiveTab("market")}
              />
            </TabsContent>

            <TabsContent value="demand">
              <DemandDiversion
                data={formData.demand_model}
                baselineData={formData.baseline_data}
                onUpdate={(data) => handleUpdate("demand_model", data)}
                onUpdateBaseline={(data) => handleUpdate("baseline_data", data)}
                onNext={() => setActiveTab("pricing")}
                onBack={() => setActiveTab("baseline")}
              />
            </TabsContent>

            <TabsContent value="pricing">
              <PricingConfig
                pricingModel={formData.pricing_model}
                onUpdate={(data) => setFormData(prev => ({ ...prev, pricing_model: data }))}
                onNext={() => setActiveTab("unilateral")}
                onBack={() => setActiveTab("demand")}
              />
            </TabsContent>

            <TabsContent value="unilateral">
              <UnilateralCalc
                baselineData={formData.baseline_data}
                mergerParties={formData.merger_parties}
                companies={companies}
                onNext={() => setActiveTab("efficiencies")}
                onBack={() => setActiveTab("pricing")}
              />
            </TabsContent>

            <TabsContent value="efficiencies">
              <EfficienciesRemedies
                efficiencies={formData.efficiencies}
                remedies={formData.remedies || []}
                onUpdateEfficiencies={(data) => handleUpdate("efficiencies", data)}
                onUpdateRemedies={(data) => setFormData(prev => ({ ...prev, remedies: data }))}
                onNext={() => setActiveTab("sensitivity")}
                onBack={() => setActiveTab("unilateral")}
              />
            </TabsContent>

            <TabsContent value="sensitivity">
              <SensitivityConfig
                data={formData.sensitivity_analysis}
                onUpdate={(data) => handleUpdate("sensitivity_analysis", data)}
                onBack={() => setActiveTab("efficiencies")}
                onSubmit={handleSubmit}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  );
}