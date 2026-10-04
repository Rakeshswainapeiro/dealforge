import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, X, Loader2 } from "lucide-react";

export default function ChecklistGenerator({ scenarios, companies, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    scenario_id: "",
    acquirer_id: "",
    target_id: "",
    deal_type: "acquisition",
    sector: ""
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => api.entities.DueDiligenceChecklist.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dueDiligenceChecklists'] });
      onCreated();
    },
  });

  const handleGenerate = async () => {
    if (!formData.name || !formData.acquirer_id || !formData.target_id) {
      setError("Please fill in all required fields");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const acquirer = companies.find(c => c.id === formData.acquirer_id);
      const target = companies.find(c => c.id === formData.target_id);
      
      // Get historical data
      const completedScenarios = scenarios.filter(s => s.status === 'completed');
      
      const prompt = `Generate a comprehensive due diligence checklist for the following M&A transaction:

**Deal Overview:**
- Deal Type: ${formData.deal_type}
- Acquirer: ${acquirer.name} (${acquirer.sector}, $${acquirer.revenue}M revenue)
- Target: ${target.name} (${target.sector}, $${target.revenue}M revenue)
- Primary Sector: ${formData.sector || target.sector}

**Acquirer Financial Profile:**
- Market Cap: $${acquirer.market_cap}M
- EBITDA: $${acquirer.ebitda}M
- Debt: $${acquirer.total_debt}M
- Cash: $${acquirer.cash}M

**Target Financial Profile:**
- Market Cap: $${target.market_cap}M
- EBITDA: $${target.ebitda}M
- Debt: $${target.total_debt}M
- Cash: $${target.cash}M

**Historical Context:**
${completedScenarios.length > 0 ? `Recent completed deals: ${completedScenarios.length} transactions` : 'No historical deal data available'}

Generate:
1. Detailed checklist items organized by category (Financial, Legal, Operational, Technology, HR, Market, Compliance, etc.)
2. Risk assessment for each item (critical/high/medium/low)
3. Priority levels
4. AI-driven insights and recommendations
5. Identify 3-5 high-risk areas requiring deeper investigation with mitigation strategies

Make the checklist comprehensive and sector-specific.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  category: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  status: { type: "string" },
                  priority: { type: "string" },
                  risk_level: { type: "string" },
                  ai_insights: { type: "string" },
                  recommendations: { type: "array", items: { type: "string" } },
                  data_sources: { type: "array", items: { type: "string" } }
                }
              }
            },
            high_risk_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  risk_score: { type: "number" },
                  description: { type: "string" },
                  mitigation_strategies: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      // Calculate progress
      const completedItems = result.items.filter(i => i.status === 'completed').length;
      const progress = (completedItems / result.items.length) * 100;

      await createMutation.mutateAsync({
        ...formData,
        items: result.items,
        high_risk_areas: result.high_risk_areas,
        progress_percentage: progress,
        status: 'in_progress'
      });

    } catch (err) {
      console.error("Generation error:", err);
      setError(err.message || "Failed to generate checklist");
      setGenerating(false);
    }
  };

  const handleScenarioChange = (scenarioId) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (scenario) {
      setFormData({
        ...formData,
        scenario_id: scenarioId,
        acquirer_id: scenario.acquirer_id || "",
        target_id: scenario.target_ids?.[0] || "",
        name: `Due Diligence - ${scenario.name}`
      });
    }
  };

  return (
    <Card className="border-blue-200 shadow-lg">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            Generate AI-Powered Checklist
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="space-y-2">
          <Label>Checklist Name *</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            placeholder="e.g., Acme Corp Acquisition DD"
          />
        </div>

        <div className="space-y-2">
          <Label>Link to Scenario (Optional)</Label>
          <Select value={formData.scenario_id} onValueChange={handleScenarioChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select scenario..." />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map(scenario => (
                <SelectItem key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Acquirer *</Label>
            <Select value={formData.acquirer_id} onValueChange={(val) => setFormData({...formData, acquirer_id: val})}>
              <SelectTrigger>
                <SelectValue placeholder="Select acquirer..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map(company => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Target *</Label>
            <Select value={formData.target_id} onValueChange={(val) => {
              const target = companies.find(c => c.id === val);
              setFormData({...formData, target_id: val, sector: target?.sector || ""});
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select target..." />
              </SelectTrigger>
              <SelectContent>
                {companies.filter(c => c.id !== formData.acquirer_id).map(company => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Deal Type</Label>
            <Select value={formData.deal_type} onValueChange={(val) => setFormData({...formData, deal_type: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acquisition">Acquisition</SelectItem>
                <SelectItem value="merger">Merger</SelectItem>
                <SelectItem value="asset_purchase">Asset Purchase</SelectItem>
                <SelectItem value="joint_venture">Joint Venture</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Sector</Label>
            <Input
              value={formData.sector}
              onChange={(e) => setFormData({...formData, sector: e.target.value})}
              placeholder="e.g., Technology, Healthcare"
            />
          </div>
        </div>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleGenerate}
          disabled={generating || !formData.name || !formData.acquirer_id || !formData.target_id}
          className="w-full bg-blue-600 hover:bg-blue-700 h-12"
        >
          {generating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Generating AI-Powered Checklist...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 mr-2" />
              Generate Checklist
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}