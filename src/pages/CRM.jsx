import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, Search, Star } from "lucide-react";
import ContactCard from "../components/crm/ContactCard";
import ContactDetails from "../components/crm/ContactDetails";
import ContactForm from "../components/crm/ContactForm";

export default function CRM() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [filterKeyContacts, setFilterKeyContacts] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: async () => {
      const all = await api.entities.Contact.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') return all;
      
      return all.filter(contact => {
        if (contact.created_by === user.email) return true;
        if (contact.visibility === 'organization' && user.organization) return true;
        if (contact.visibility === 'group' && contact.shared_with_groups && user.groups) {
          return contact.shared_with_groups.some(group => user.groups.includes(group));
        }
        return false;
      });
    },
    initialData: [],
  });

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.entities.Company.list(),
    initialData: [],
  });

  const { data: opportunities } = useQuery({
    queryKey: ['dealOpportunities'],
    queryFn: () => api.entities.DealOpportunity.list(),
    initialData: [],
  });

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = !searchTerm || 
      contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesKeyFilter = !filterKeyContacts || contact.key_contact;
    
    return matchesSearch && matchesKeyFilter;
  });

  const keyContacts = contacts.filter(c => c.key_contact);

  if (selectedContact) {
    return (
      <ContactDetails
        contact={selectedContact}
        companies={companies}
        opportunities={opportunities}
        onBack={() => setSelectedContact(null)}
        onEdit={(contact) => {
          setEditingContact(contact);
          setShowForm(true);
          setSelectedContact(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              CRM & Contacts
            </h1>
            <p className="text-slate-600 mt-2">
              Manage relationships with targets, advisors, and key stakeholders
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingContact(null);
              setShowForm(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </Button>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Total Contacts</p>
              <p className="text-3xl font-bold text-slate-900">{contacts.length}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Key Contacts</p>
              <p className="text-3xl font-bold text-indigo-600">{keyContacts.length}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">High Engagement</p>
              <p className="text-3xl font-bold text-emerald-600">
                {contacts.filter(c => c.engagement_level === 'high').length}
              </p>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-2">Follow-ups Due</p>
              <p className="text-3xl font-bold text-amber-600">
                {contacts.filter(c => c.next_followup_date && new Date(c.next_followup_date) <= new Date()).length}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search contacts by name, company, or email..."
              className="pl-10"
            />
          </div>
          <Button
            variant={filterKeyContacts ? "default" : "outline"}
            onClick={() => setFilterKeyContacts(!filterKeyContacts)}
            className="gap-2"
          >
            <Star className={`w-4 h-4 ${filterKeyContacts ? 'fill-current' : ''}`} />
            Key Contacts Only
          </Button>
        </div>

        {showForm && (
          <ContactForm
            contact={editingContact}
            companies={companies}
            opportunities={opportunities}
            onClose={() => {
              setShowForm(false);
              setEditingContact(null);
            }}
            onSaved={() => {
              setShowForm(false);
              setEditingContact(null);
            }}
          />
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="h-64 bg-white rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredContacts.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="p-12 text-center">
              <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {searchTerm ? 'No Matching Contacts' : 'No Contacts Yet'}
              </h3>
              <p className="text-slate-600 mb-4">
                {searchTerm ? 'Try a different search term' : 'Start building your network of contacts'}
              </p>
              {!searchTerm && (
                <Button onClick={() => setShowForm(true)} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Contact
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredContacts.map(contact => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onClick={() => setSelectedContact(contact)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}