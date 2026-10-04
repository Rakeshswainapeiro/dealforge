import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Target, Plus, Pencil, Trash2, X, Sliders } from "lucide-react";
import { Slider } from "@/components/ui/slider";

export default function AcquirerProfileManager() {
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    target_sectors: [],
    target_geographies: [],
    revenue_range: { min: 0, max: 0 },
    ebitda_range: { min: 0, max: 0 },
    deal_value_range: { min: 0, max: 0 },
    strategic_priorities: [],
    desired_capabilities: [],
    deal_types: [],
    exclusion_criteria: [],
    financial_metrics: {},
    scoring_weights: {
      strategic_alignment: 25,
      financial_metrics: 20,
      market_growth: 15,
      synergy_potential: 20,
      competitive_position: 10,
      regulatory_risk: 10
    },
    active: true
  });
  const [newItem, setNewItem] = useState("");

  const queryClient = useQueryClient();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['acquirerProfiles'],
    queryFn: async () => {
      const all = await api.entities.AcquirerProfile.list('-updated_date');
      const user = await api.auth.me();
      if (user.role === 'admin') return all;
      return all.filter(p => {
        if (p.created_by === user.email) return true;
        if (p.visibility === 'organization' && user.organization) return true;
        if (p.visibility === 'group' && p.shared_with_groups && user.groups) {
          return p.shared_with_groups.some(g => user.groups.includes(g));
        }
        return false;
      });
    },
    initialData: [],
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingProfile) {
        return await api.entities.AcquirerProfile.update(editingProfile.id, data);
      }
      return await api.entities.AcquirerProfile.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acquirerProfiles'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.AcquirerProfile.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acquirerProfiles'] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingProfile(null);
    setFormData({
      name: "",
      description: "",
      target_sectors: [],
      target_geographies: [],
      revenue_range: { min: 0, max: 0 },
      ebitda_range: { min: 0, max: 0 },
      deal_value_range: { min: 0, max: 0 },
      strategic_priorities: [],
      desired_capabilities: [],
      deal_types: [],
      exclusion_criteria: [],
      financial_metrics: {},
      scoring_weights: {
        strategic_alignment: 25,
        financial_metrics: 20,
        market_growth: 15,
        synergy_potential: 20,
        competitive_position: 10,
        regulatory_risk: 10
      },
      active: true
    });
  };

  const addArrayItem = (field) => {
    if (newItem.trim()) {
      setFormData({...formData, [field]: [...(formData[field] || []), newItem.trim()]});
      setNewItem("");
    }
  };

  const removeArrayItem = (field, index) => {
    setFormData({...formData, [field]: formData[field].filter((_, i) => i !== index)});
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Acquirer Profiles</h3>
          <p className="text-sm text-slate-600">Define your ideal acquisition targets</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <Plus className="w-4 h-4" />
          New Profile
        </Button>
      </div>

      {showForm && (
        <Card className="border-indigo-200 shadow-lg">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-indigo-50 to-white">
            <div className="flex items-center justify-between">
              <CardTitle>{editingProfile ? 'Edit Profile' : 'New Acquirer Profile'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={resetForm}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Profile Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Tech Acquisitions 2026"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Strategic rationale for this acquisition profile..."
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900">Target Sectors</h4>
              <div className="flex gap-2">
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="e.g., SaaS, Fintech"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addArrayItem('target_sectors'))}
                />
                <Button onClick={() => addArrayItem('target_sectors')} variant="outline">Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.target_sectors?.map((sector, i) => (
                  <Badge key={i} className="bg-indigo-100 text-indigo-800 gap-2">
                    {sector}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeArrayItem('target_sectors', i)} />
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Min Revenue ($M)</Label>
                <Input
                  type="number"
                  value={formData.revenue_range?.min || 0}
                  onChange={(e) => setFormData({...formData, revenue_range: {...formData.revenue_range, min: parseFloat(e.target.value)}})}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Revenue ($M)</Label>
                <Input
                  type="number"
                  value={formData.revenue_range?.max || 0}
                  onChange={(e) => setFormData({...formData, revenue_range: {...formData.revenue_range, max: parseFloat(e.target.value)}})}
                />
              </div>
              <div className="space-y-2">
                <Label>Min EBITDA Margin (%)</Label>
                <Input
                  type="number"
                  value={formData.financial_metrics?.min_ebitda_margin || 0}
                  onChange={(e) => setFormData({...formData, financial_metrics: {...formData.financial_metrics, min_ebitda_margin: parseFloat(e.target.value)}})}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900">Strategic Priorities</h4>
              <div className="flex gap-2">
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="e.g., Geographic expansion, Technology acquisition"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addArrayItem('strategic_priorities'))}
                />
                <Button onClick={() => addArrayItem('strategic_priorities')} variant="outline">Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.strategic_priorities?.map((priority, i) => (
                  <Badge key={i} className="bg-purple-100 text-purple-800 gap-2">
                    {priority}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeArrayItem('strategic_priorities', i)} />
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 mb-4">
                <Sliders className="w-5 h-5 text-indigo-600" />
                <h4 className="font-semibold text-slate-900">Scoring Weights</h4>
                <p className="text-xs text-slate-600 ml-auto">Total: {Object.values(formData.scoring_weights || {}).reduce((a, b) => a + b, 0)}%</p>
              </div>
              <p className="text-sm text-slate-600 mb-4">Customize how AI scores opportunities (total should equal 100%)</p>
              
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-sm">Strategic Alignment</Label>
                    <span className="text-sm font-semibold text-indigo-600">{formData.scoring_weights?.strategic_alignment || 25}%</span>
                  </div>
                  <Slider
                    value={[formData.scoring_weights?.strategic_alignment || 25]}
                    onValueChange={([val]) => setFormData({...formData, scoring_weights: {...formData.scoring_weights, strategic_alignment: val}})}
                    max={50}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500 mt-1">Fit with target sectors and strategic priorities</p>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-sm">Financial Metrics</Label>
                    <span className="text-sm font-semibold text-indigo-600">{formData.scoring_weights?.financial_metrics || 20}%</span>
                  </div>
                  <Slider
                    value={[formData.scoring_weights?.financial_metrics || 20]}
                    onValueChange={([val]) => setFormData({...formData, scoring_weights: {...formData.scoring_weights, financial_metrics: val}})}
                    max={50}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500 mt-1">Revenue, EBITDA, margins, and growth rates</p>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-sm">Market Growth Potential</Label>
                    <span className="text-sm font-semibold text-indigo-600">{formData.scoring_weights?.market_growth || 15}%</span>
                  </div>
                  <Slider
                    value={[formData.scoring_weights?.market_growth || 15]}
                    onValueChange={([val]) => setFormData({...formData, scoring_weights: {...formData.scoring_weights, market_growth: val}})}
                    max={40}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500 mt-1">Industry trends and expansion opportunities</p>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-sm">Synergy Potential</Label>
                    <span className="text-sm font-semibold text-indigo-600">{formData.scoring_weights?.synergy_potential || 20}%</span>
                  </div>
                  <Slider
                    value={[formData.scoring_weights?.synergy_potential || 20]}
                    onValueChange={([val]) => setFormData({...formData, scoring_weights: {...formData.scoring_weights, synergy_potential: val}})}
                    max={40}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500 mt-1">Revenue and cost synergies, capability fit</p>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-sm">Competitive Position</Label>
                    <span className="text-sm font-semibold text-indigo-600">{formData.scoring_weights?.competitive_position || 10}%</span>
                  </div>
                  <Slider
                    value={[formData.scoring_weights?.competitive_position || 10]}
                    onValueChange={([val]) => setFormData({...formData, scoring_weights: {...formData.scoring_weights, competitive_position: val}})}
                    max={30}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500 mt-1">Market share, competitive advantages, moats</p>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <Label className="text-sm">Regulatory Risk</Label>
                    <span className="text-sm font-semibold text-indigo-600">{formData.scoring_weights?.regulatory_risk || 10}%</span>
                  </div>
                  <Slider
                    value={[formData.scoring_weights?.regulatory_risk || 10]}
                    onValueChange={([val]) => setFormData({...formData, scoring_weights: {...formData.scoring_weights, regulatory_risk: val}})}
                    max={30}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-slate-500 mt-1">Compliance, antitrust, and regulatory concerns</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg border border-emerald-200">
              <div>
                <p className="font-medium text-slate-900">Active Profile</p>
                <p className="text-sm text-slate-600">Use this profile for AI deal sourcing</p>
              </div>
              <Switch
                checked={formData.active}
                onCheckedChange={(checked) => setFormData({...formData, active: checked})}
              />
            </div>

            <Button
              onClick={() => saveMutation.mutate(formData)}
              disabled={!formData.name || saveMutation.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {editingProfile ? 'Update Profile' : 'Create Profile'}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4">
          {Array(3).fill(0).map((_, i) => (
            <div key={i} className="h-40 bg-white rounded-xl animate-pulse" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="p-12 text-center">
            <Target className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No Profiles Yet</h3>
            <p className="text-slate-600 mb-4">Create an acquirer profile to enable smart deal sourcing</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles.map(profile => (
            <Card key={profile.id} className="border-slate-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-slate-900">{profile.name}</h3>
                      {profile.active && <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>}
                    </div>
                    <p className="text-sm text-slate-600">{profile.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={() => {
                      setEditingProfile(profile);
                      setFormData(profile);
                      setShowForm(true);
                    }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => deleteMutation.mutate(profile.id)}>
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {profile.target_sectors?.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-600 mb-2">Target Sectors</p>
                      <div className="flex flex-wrap gap-1">
                        {profile.target_sectors.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {profile.strategic_priorities?.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-600 mb-2">Strategic Priorities</p>
                      <div className="flex flex-wrap gap-1">
                        {profile.strategic_priorities.slice(0, 3).map((p, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{p}</Badge>
                        ))}
                        {profile.strategic_priorities.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{profile.strategic_priorities.length - 3}</Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}