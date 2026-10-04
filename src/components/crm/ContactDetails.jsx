import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, User, Building2, Mail, Phone, Star, Pencil, TrendingUp } from "lucide-react";
import InteractionLog from "./InteractionLog";
import RelationshipInsights from "./RelationshipInsights";

export default function ContactDetails({ contact, companies, opportunities, onBack, onEdit }) {
  const linkedCompany = companies.find(c => c.id === contact.company_id);
  const linkedOpportunities = opportunities.filter(o => contact.opportunity_ids?.includes(o.id));

  const relationshipColors = {
    strong: "bg-emerald-100 text-emerald-800",
    moderate: "bg-blue-100 text-blue-800",
    weak: "bg-amber-100 text-amber-800",
    new: "bg-slate-100 text-slate-800"
  };

  const engagementColors = {
    high: "bg-emerald-100 text-emerald-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-red-100 text-red-800"
  };

  const typeLabels = {
    target_executive: "Target Executive",
    advisor: "Advisor",
    investor: "Investor",
    intermediary: "Intermediary",
    other: "Other"
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-full flex items-center justify-center">
                <User className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold text-slate-900">{contact.full_name}</h1>
                  {contact.key_contact && (
                    <Star className="w-6 h-6 text-amber-500 fill-amber-500" />
                  )}
                </div>
                <p className="text-slate-600 mt-1">{contact.title} {contact.company_name && `at ${contact.company_name}`}</p>
              </div>
            </div>
          </div>
          <Button onClick={() => onEdit(contact)} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
            <Pencil className="w-4 h-4" />
            Edit Contact
          </Button>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Contact Type</p>
              <Badge variant="outline" className="text-sm">{typeLabels[contact.contact_type]}</Badge>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Relationship Strength</p>
              <Badge className={relationshipColors[contact.relationship_strength]}>
                {contact.relationship_strength}
              </Badge>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Engagement Level</p>
              <Badge className={engagementColors[contact.engagement_level]}>
                {contact.engagement_level}
              </Badge>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Interactions</p>
              <p className="text-2xl font-bold text-slate-900">{contact.interactions?.length || 0}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-100">
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              {contact.email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-600">Email</p>
                    <p className="font-medium text-slate-900">{contact.email}</p>
                  </div>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-600">Phone</p>
                    <p className="font-medium text-slate-900">{contact.phone}</p>
                  </div>
                </div>
              )}
              {contact.company_name && (
                <div className="flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-600">Company</p>
                    <p className="font-medium text-slate-900">{contact.company_name}</p>
                  </div>
                </div>
              )}
              {contact.strategic_importance && (
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-600">Strategic Importance</p>
                    <p className="font-medium text-indigo-600">{contact.strategic_importance}/100</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {linkedOpportunities.length > 0 && (
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader>
              <CardTitle className="text-purple-900">Linked Deal Opportunities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {linkedOpportunities.map(opp => (
                <div key={opp.id} className="p-3 bg-white rounded-lg border border-purple-200">
                  <p className="font-semibold text-purple-900">{opp.target_name}</p>
                  <p className="text-sm text-purple-700">{opp.target_sector} • ${(opp.estimated_value / 1000).toFixed(1)}B</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {contact.notes && (
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-700 whitespace-pre-wrap">{contact.notes}</p>
            </CardContent>
          </Card>
        )}

        <RelationshipInsights contact={contact} linkedCompany={linkedCompany} opportunities={linkedOpportunities} />

        <InteractionLog contact={contact} />
      </div>
    </div>
  );
}