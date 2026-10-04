import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Building2, Mail, Phone, Star, Calendar } from "lucide-react";
import { format } from "date-fns";

export default function ContactCard({ contact, onClick }) {
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

  const isFollowupOverdue = contact.next_followup_date && 
    new Date(contact.next_followup_date) <= new Date();

  return (
    <Card
      className="border-slate-200 hover:shadow-lg transition-all cursor-pointer"
      onClick={onClick}
    >
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{contact.full_name}</h3>
                {contact.key_contact && (
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                )}
              </div>
              {contact.title && (
                <p className="text-sm text-slate-600">{contact.title}</p>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-3">
        {contact.company_name && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span className="text-slate-700">{contact.company_name}</span>
          </div>
        )}
        
        {contact.email && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">{contact.email}</span>
          </div>
        )}
        
        {contact.phone && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">{contact.phone}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Badge variant="outline">{typeLabels[contact.contact_type]}</Badge>
          <Badge className={relationshipColors[contact.relationship_strength]}>
            {contact.relationship_strength}
          </Badge>
          <Badge className={engagementColors[contact.engagement_level]}>
            {contact.engagement_level} engagement
          </Badge>
        </div>

        {contact.next_followup_date && (
          <div className={`flex items-center gap-2 text-xs pt-2 ${isFollowupOverdue ? 'text-red-600' : 'text-slate-600'}`}>
            <Calendar className="w-3 h-3" />
            <span>
              Follow-up: {format(new Date(contact.next_followup_date), 'MMM d, yyyy')}
              {isFollowupOverdue && ' (Overdue)'}
            </span>
          </div>
        )}

        {contact.strategic_importance && (
          <div className="pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Strategic Importance</span>
              <span className="font-semibold text-indigo-600">{contact.strategic_importance}/100</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}