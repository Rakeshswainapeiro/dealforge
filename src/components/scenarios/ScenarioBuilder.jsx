
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { 
  Building2, 
  ArrowRight, 
  X, 
  Plus,
  Info,
  Calendar,
  Percent,
  DollarSign,
  TrendingUp,
  Search // Added Search icon
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ScenarioBuilder({ scenario, companies, onSubmit, onCancel }) {
  const [step, setStep] = useState(1);
  const [scenarioName, setScenarioName] = useState(scenario?.name || "");
  const [searchQuery, setSearchQuery] = useState(""); // New state for search query
  const [acquirer, setAcquirer] = useState(
    scenario?.acquirer_id ? companies.find(c => c.id === scenario.acquirer_id) : null
  );
  const [targets, setTargets] = useState(
    scenario?.target_ids?.map(id => companies.find(c => c.id === id)).filter(Boolean) || []
  );
  const [availableCompanies, setAvailableCompanies] = useState(
    companies.filter(c => 
      c.id !== scenario?.acquirer_id && 
      !scenario?.target_ids?.includes(c.id)
    )
  );

  const [dealStructure, setDealStructure] = useState(scenario?.deal_structure || {
    cash_percentage: 50,
    stock_percentage: 50,
    premium: 30,
    new_debt: 0,
  });

  const [synergies, setSynergies] = useState(scenario?.synergies || {
    revenue_synergies: 0,
    cost_synergies: 0,
    integration_costs: 0,
    synergy_realization_years: 3,
  });

  const [assumptions, setAssumptions] = useState(scenario?.assumptions || {
    wacc: 8,
    tax_rate: 25,
    closing_date: new Date().toISOString().split('T')[0],
  });

  const [status, setStatus] = useState(scenario?.status || "draft");

  // Filter available companies based on search query
  const filteredAvailableCompanies = availableCompanies.filter(company =>
    company.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    company.ticker?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    company.sector?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const onDragEnd = (result) => {
    const { source, destination } = result;

    if (!destination) return;

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    // Moving from available companies
    if (source.droppableId === "available") {
      // Find the company from the *filtered* list that was dragged
      const company = filteredAvailableCompanies[source.index];
      if (!company) return; // Should not happen if index is valid

      // Remove the company from the *original* availableCompanies list
      const newAvailable = availableCompanies.filter(c => c.id !== company.id);
      setAvailableCompanies(newAvailable);
      setSearchQuery(""); // Clear search after dragging to ensure all companies are visible again

      if (destination.droppableId === "acquirer") {
        if (acquirer) {
          // If there's an existing acquirer, return it to the available list
          setAvailableCompanies([...newAvailable, acquirer]);
        }
        setAcquirer(company);
      } else if (destination.droppableId === "targets") {
        setTargets([...targets, company]);
      }
    }

    // Moving from acquirer
    if (source.droppableId === "acquirer") {
      if (destination.droppableId === "available") {
        setAvailableCompanies([...availableCompanies, acquirer]);
        setAcquirer(null);
      } else if (destination.droppableId === "targets") {
        setTargets([...targets, acquirer]);
        setAcquirer(null);
      }
    }

    // Moving from targets
    if (source.droppableId === "targets") {
      const company = targets[source.index];
      const newTargets = [...targets];
      newTargets.splice(source.index, 1);
      setTargets(newTargets);

      if (destination.droppableId === "available") {
        setAvailableCompanies([...availableCompanies, company]);
      } else if (destination.droppableId === "acquirer") {
        if (acquirer) {
          setAvailableCompanies([...availableCompanies, acquirer]);
        }
        setAcquirer(company);
      }
    }
  };

  const handleNext = () => {
    if (step === 1 && (!scenarioName || !acquirer || targets.length === 0)) {
      alert("Please provide a scenario name, select an acquirer, and at least one target");
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => setStep(step - 1);

  const handleSubmit = () => {
    const data = {
      name: scenarioName,
      acquirer_id: acquirer.id,
      target_ids: targets.map(t => t.id),
      deal_structure: dealStructure,
      synergies,
      assumptions,
      status,
      visibility: "private", // Default visibility
      shared_with_groups: [],
    };
    onSubmit(data);
  };

  const updateDealStructure = (field, value) => {
    const newStructure = { ...dealStructure, [field]: value };
    if (field === "cash_percentage") {
      newStructure.stock_percentage = 100 - value;
    } else if (field === "stock_percentage") {
      newStructure.cash_percentage = 100 - value;
    }
    setDealStructure(newStructure);
  };

  return (
    <Card className="border-slate-200 shadow-lg">
      <CardHeader className="border-b border-slate-100">
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-2xl">
              {scenario ? "Edit Scenario" : "Create New Merger Scenario"}
            </CardTitle>
            <p className="text-sm text-slate-600 mt-1">
              Step {step} of 3: {step === 1 ? "Select Companies" : step === 2 ? "Deal Structure" : "Synergies & Assumptions"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {step === 1 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="scenario-name">Scenario Name *</Label>
              <Input
                id="scenario-name"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="e.g., Tech Giant + AI Startup Merger"
                className="text-lg"
              />
            </div>

            <Alert className="border-blue-200 bg-blue-50">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>Drag & drop companies</strong> from the available list to the acquirer or targets zones below.
              </AlertDescription>
            </Alert>

            <DragDropContext onDragEnd={onDragEnd}>
              <div className="grid lg:grid-cols-3 gap-6">
                {/* Available Companies */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Available Companies
                  </h3>
                  
                  {/* Search Input */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Search companies..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-sm bg-white"
                    />
                  </div>

                  <Droppable droppableId="available">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`min-h-[400px] p-3 rounded-lg border-2 border-dashed transition-colors overflow-y-auto max-h-[500px] ${ // Added overflow-y-auto and max-h
                          snapshot.isDraggingOver
                            ? "border-teal-400 bg-teal-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        {filteredAvailableCompanies.length === 0 ? (
                          <p className="text-sm text-slate-500 text-center mt-8">
                            {searchQuery ? "No companies match your search" : "All companies assigned or none available"}
                          </p>
                        ) : (
                          filteredAvailableCompanies.map((company, index) => (
                            <Draggable key={company.id} draggableId={company.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`mb-2 p-3 rounded-lg border bg-white transition-shadow cursor-move ${
                                    snapshot.isDragging
                                      ? "shadow-lg border-teal-400"
                                      : "shadow-sm border-slate-200 hover:shadow-md"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="font-semibold text-slate-900 text-sm truncate">
                                        {company.name}
                                      </p>
                                      {company.ticker && (
                                        <p className="text-xs text-slate-500">{company.ticker}</p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2 text-xs text-slate-600">
                                    Market Cap: ${(company.market_cap / 1000).toFixed(1)}B
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                  
                  {/* Company count indicator */}
                  <div className="mt-2 text-xs text-slate-500 text-center">
                    Showing {filteredAvailableCompanies.length} of {availableCompanies.length} companies
                  </div>
                </div>

                {/* Acquirer Zone */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-teal-600" />
                    Acquirer *
                  </h3>
                  <Droppable droppableId="acquirer">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`min-h-[400px] p-3 rounded-lg border-2 border-dashed transition-colors ${
                          snapshot.isDraggingOver
                            ? "border-teal-400 bg-teal-50"
                            : acquirer
                            ? "border-teal-300 bg-teal-50"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {acquirer ? (
                          <Draggable draggableId={acquirer.id} index={0}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`p-4 rounded-lg border-2 bg-white transition-shadow cursor-move ${
                                  snapshot.isDragging
                                    ? "shadow-lg border-teal-400"
                                    : "shadow-sm border-teal-400"
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-3">
                                  <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                                    <Building2 className="w-4 h-4 text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-bold text-slate-900 truncate">{acquirer.name}</p>
                                    {acquirer.ticker && (
                                      <Badge variant="outline" className="mt-1">
                                        {acquirer.ticker}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-slate-600">Market Cap</span>
                                    <span className="font-semibold text-slate-900">
                                      ${(acquirer.market_cap / 1000).toFixed(1)}B
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-600">Revenue</span>
                                    <span className="font-semibold text-slate-900">
                                      ${(acquirer.revenue / 1000).toFixed(1)}B
                                    </span>
                                  </div>
                                  {acquirer.sector && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-600">Sector</span>
                                      <span className="font-semibold text-slate-900">{acquirer.sector}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ) : (
                          <div className="h-full flex items-center justify-center text-center p-4">
                            <div>
                              <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                              <p className="text-sm text-slate-500">Drag a company here to set as acquirer</p>
                            </div>
                          </div>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>

                {/* Targets Zone */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-amber-600" />
                    Targets *
                  </h3>
                  <Droppable droppableId="targets">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`min-h-[400px] p-3 rounded-lg border-2 border-dashed transition-colors overflow-y-auto max-h-[500px] ${ // Added overflow-y-auto and max-h
                          snapshot.isDraggingOver
                            ? "border-amber-400 bg-amber-50"
                            : targets.length > 0
                            ? "border-amber-300 bg-amber-50"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {targets.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-center p-4">
                            <div>
                              <ArrowRight className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                              <p className="text-sm text-slate-500">
                                Drag companies here to set as targets
                              </p>
                            </div>
                          </div>
                        ) : (
                          targets.map((target, index) => (
                            <Draggable key={target.id} draggableId={target.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`mb-2 p-3 rounded-lg border bg-white transition-shadow cursor-move ${
                                    snapshot.isDragging
                                      ? "shadow-lg border-amber-400"
                                      : "shadow-sm border-amber-300 hover:shadow-md"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-2">
                                    <Building2 className="w-4 h-4 text-amber-600 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="font-semibold text-slate-900 text-sm truncate">
                                        {target.name}
                                      </p>
                                      {target.ticker && (
                                        <p className="text-xs text-slate-500">{target.ticker}</p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-xs text-slate-600">
                                    Market Cap: ${(target.market_cap / 1000).toFixed(1)}B
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            </DragDropContext>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button 
                onClick={handleNext}
                className="bg-teal-600 hover:bg-teal-700"
                disabled={!scenarioName || !acquirer || targets.length === 0}
              >
                Next: Deal Structure
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-slate-200 bg-slate-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Percent className="w-4 h-4 text-teal-600" />
                    Consideration Mix
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label>Cash</Label>
                      <span className="text-sm font-semibold text-teal-600">
                        {dealStructure.cash_percentage}%
                      </span>
                    </div>
                    <Slider
                      value={[dealStructure.cash_percentage]}
                      onValueChange={([value]) => updateDealStructure("cash_percentage", value)}
                      max={100}
                      step={5}
                      className="mb-4"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label>Stock</Label>
                      <span className="text-sm font-semibold text-purple-600">
                        {dealStructure.stock_percentage}%
                      </span>
                    </div>
                    <Slider
                      value={[dealStructure.stock_percentage]}
                      onValueChange={([value]) => updateDealStructure("stock_percentage", value)}
                      max={100}
                      step={5}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-slate-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-teal-600" />
                    Deal Terms
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label>Acquisition Premium</Label>
                      <span className="text-sm font-semibold text-teal-600">
                        {dealStructure.premium}%
                      </span>
                    </div>
                    <Slider
                      value={[dealStructure.premium]}
                      onValueChange={([value]) => updateDealStructure("premium", value)}
                      max={100}
                      step={5}
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-debt">New Debt Issuance ($M)</Label>
                    <Input
                      id="new-debt"
                      type="number"
                      value={dealStructure.new_debt}
                      onChange={(e) => updateDealStructure("new_debt", parseFloat(e.target.value) || 0)}
                      className="mt-2"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-between gap-3 pt-4">
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button onClick={handleNext} className="bg-teal-600 hover:bg-teal-700">
                Next: Synergies
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <Card className="border-slate-200 bg-slate-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-teal-600" />
                  Synergy Assumptions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="revenue-syn">Revenue Synergies ($M)</Label>
                    <Input
                      id="revenue-syn"
                      type="number"
                      step="0.01"
                      value={synergies.revenue_synergies}
                      onChange={(e) => setSynergies({...synergies, revenue_synergies: parseFloat(e.target.value) || 0})}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cost-syn">Cost Synergies ($M)</Label>
                    <Input
                      id="cost-syn"
                      type="number"
                      step="0.01"
                      value={synergies.cost_synergies}
                      onChange={(e) => setSynergies({...synergies, cost_synergies: parseFloat(e.target.value) || 0})}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="integration-costs">Integration Costs ($M)</Label>
                    <Input
                      id="integration-costs"
                      type="number"
                      step="0.01"
                      value={synergies.integration_costs}
                      onChange={(e) => setSynergies({...synergies, integration_costs: parseFloat(e.target.value) || 0})}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="syn-years">Realization Period (Years)</Label>
                    <Input
                      id="syn-years"
                      type="number"
                      min="1"
                      value={synergies.synergy_realization_years}
                      onChange={(e) => setSynergies({...synergies, synergy_realization_years: parseInt(e.target.value) || 3})}
                      className="mt-2"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-slate-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-teal-600" />
                  Financial Assumptions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="wacc">WACC (%)</Label>
                    <Input
                      id="wacc"
                      type="number"
                      step="0.1"
                      value={assumptions.wacc}
                      onChange={(e) => setAssumptions({...assumptions, wacc: parseFloat(e.target.value) || 0})}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="tax-rate">Tax Rate (%)</Label>
                    <Input
                      id="tax-rate"
                      type="number"
                      step="0.1"
                      value={assumptions.tax_rate}
                      onChange={(e) => setAssumptions({...assumptions, tax_rate: parseFloat(e.target.value) || 0})}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="closing-date">Expected Closing</Label>
                    <Input
                      id="closing-date"
                      type="date"
                      value={assumptions.closing_date}
                      onChange={(e) => setAssumptions({...assumptions, closing_date: e.target.value})}
                      className="mt-2"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="status">Scenario Status</Label>
              <Select value={status} onValueChange={setStatus}>
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

            <div className="flex justify-between gap-3 pt-4">
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button onClick={handleSubmit} className="bg-teal-600 hover:bg-teal-700">
                <Plus className="w-4 h-4 mr-2" />
                {scenario ? "Update Scenario" : "Create Scenario"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
