import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";

export default function ContactForm({ contact, companies, opportunities, onClose, onSaved }) {
  const [formData, setFormData] = useState(contact || {
    full_name: "",
    title: "",
    email: "",
    phone: "",
    company_name: "",
    company_id: "",
    opportunity_ids: [],
    contact_type: "other",
    relationship_strength: "new",
    engagement_level: "medium",
    key_contact: false,
    notes: ""
  });

  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (contact) {
        return await api.entities.Contact.update(contact.id, data);
      }
      return await api.entities.Contact.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      onSaved();
    },
  });

  return (
    <Card className="border-indigo-200 shadow-lg">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-indigo-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle>{contact ? 'Edit Contact' : 'Add New Contact'}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input
              value={formData.full_name}
              onChange={(e) => setFormData({...formData, full_name: e.target.value})}
              placeholder="John Doe"
            />
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="CEO, CFO, etc."
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              placeholder="john@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              placeholder="+1 (555) 123-4567"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Company Name</Label>
            <Input
              value={formData.company_name}
              onChange={(e) => setFormData({...formData, company_name: e.target.value})}
              placeholder="Acme Corp"
            />
          </div>
          <div className="space-y-2">
            <Label>Link to Company (Optional)</Label>
            <Select value={formData.company_id} onValueChange={(val) => setFormData({...formData, company_id: val})}>
              <SelectTrigger>
                <SelectValue placeholder="Select company..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map(company => (
                  <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Contact Type</Label>
            <Select value={formData.contact_type} onValueChange={(val) => setFormData({...formData, contact_type: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="target_executive">Target Executive</SelectItem>
                <SelectItem value="advisor">Advisor</SelectItem>
                <SelectItem value="investor">Investor</SelectItem>
                <SelectItem value="intermediary">Intermediary</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Relationship Strength</Label>
            <Select value={formData.relationship_strength} onValueChange={(val) => setFormData({...formData, relationship_strength: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strong">Strong</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="weak">Weak</SelectItem>
                <SelectItem value="new">New</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Engagement Level</Label>
            <Select value={formData.engagement_level} onValueChange={(val) => setFormData({...formData, engagement_level: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div>
            <p className="font-medium text-slate-900">Mark as Key Contact</p>
            <p className="text-sm text-slate-600">Requires proactive engagement</p>
          </div>
          <Switch
            checked={formData.key_contact}
            onCheckedChange={(checked) => setFormData({...formData, key_contact: checked})}
          />
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            value={formData.notes}
            onChange={(e) => setFormData({...formData, notes: e.target.value})}
            placeholder="Additional notes about this contact..."
            rows={3}
          />
        </div>

        <Button
          onClick={() => saveMutation.mutate(formData)}
          disabled={!formData.full_name || saveMutation.isPending}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {contact ? 'Update Contact' : 'Add Contact'}
        </Button>
      </CardContent>
    </Card>
  );
}