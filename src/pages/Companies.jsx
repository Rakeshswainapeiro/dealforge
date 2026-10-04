import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Upload } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import CompanyForm from "../components/companies/CompanyForm";
import CompanyCard from "../components/companies/CompanyCard";
import CompanyDetails from "../components/companies/CompanyDetails";
import ImportCompanyDialog from "../components/companies/ImportCompanyDialog";
import PublicCompanySearch from "../components/companies/PublicCompanySearch";
import RealTimeMarketData from "../components/market/RealTimeMarketData";
import CurrencyConverter from "../components/companies/CurrencyConverter";

export default function Companies() {
  const [showForm, setShowForm] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showPublicSearch, setShowPublicSearch] = useState(false);
  const [importedData, setImportedData] = useState(null);
  const [convertToUSD, setConvertToUSD] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const allCompanies = await api.entities.Company.list('-updated_date');
      const user = await api.auth.me();
      
      if (user.role === 'admin') {
        return allCompanies;
      }
      
      return allCompanies.filter(company => {
        if (company.created_by === user.email) {
          return true;
        }
        
        if (company.visibility === 'organization' && user.organization && company.creator_organization === user.organization) {
          return true;
        }
        
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
      return api.entities.Company.create({
        ...data,
        creator_organization: user.organization || ""
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setShowForm(false);
      setEditingCompany(null);
      setImportedData(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.Company.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setShowForm(false);
      setEditingCompany(null);
      setImportedData(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.Company.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setSelectedCompany(null);
    },
  });

  const handleSubmit = (data) => {
    if (editingCompany) {
      updateMutation.mutate({ id: editingCompany.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (company) => {
    setEditingCompany(company);
    setShowForm(true);
    setSelectedCompany(null);
    setImportedData(null);
  };

  const handleDelete = (id) => {
    deleteMutation.mutate(id);
  };

  const handleImportData = (extractedData) => {
    setImportedData(extractedData);
    setEditingCompany(null);
    setShowImportDialog(false);
    setShowForm(true);
  };

  const filteredCompanies = companies.filter(company =>
    company.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    company.ticker?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    company.sector?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const canModify = (company) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return company.created_by === currentUser.email;
  };

  if (selectedCompany) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <RealTimeMarketData 
            company={selectedCompany}
            onDataUpdate={(liveData) => {
              // Update company with live data
              queryClient.setQueryData(['companies'], (old) =>
                old.map(c => c.id === selectedCompany.id
                  ? { ...c, stock_price: liveData.stock_price, market_cap: liveData.market_cap }
                  : c
                )
              );
            }}
          />
          <CompanyDetails
            company={selectedCompany}
            allCompanies={companies}
            onBack={() => setSelectedCompany(null)}
            onEdit={handleEdit}
            canModify={canModify(selectedCompany)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Company Library</h1>
            <p className="text-slate-600 mt-1">Manage your universe of companies and targets</p>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={() => setShowPublicSearch(true)}
              variant="outline"
              className="gap-2 border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              <Search className="w-4 h-4" />
              Search Public Companies
            </Button>
            <Button 
              onClick={() => setShowImportDialog(true)}
              variant="outline"
              className="gap-2 border-teal-600 text-teal-600 hover:bg-teal-50"
            >
              <Upload className="w-4 h-4" />
              Import from File
            </Button>
            <Button 
              onClick={() => {
                setEditingCompany(null);
                setImportedData(null);
                setShowForm(true);
              }}
              className="bg-teal-600 hover:bg-teal-700 gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Company
            </Button>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search companies by name, ticker, or sector..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-white border-slate-200"
            />
          </div>
          <CurrencyConverter convertToUSD={convertToUSD} setConvertToUSD={setConvertToUSD} />
        </div>

        <AnimatePresence>
          {showForm && (
            <CompanyForm
              company={editingCompany || importedData}
              onSubmit={handleSubmit}
              onCancel={() => {
                setShowForm(false);
                setEditingCompany(null);
                setImportedData(null);
              }}
            />
          )}
        </AnimatePresence>

        {showPublicSearch && (
          <PublicCompanySearch
            onClose={() => setShowPublicSearch(false)}
          />
        )}

        <ImportCompanyDialog
          open={showImportDialog}
          onOpenChange={setShowImportDialog}
          onDataExtracted={handleImportData}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <div key={i} className="h-64 bg-white rounded-xl animate-pulse" />
            ))
          ) : (
            filteredCompanies.map((company) => (
              <div key={company.id} onClick={() => setSelectedCompany(company)}>
                <CompanyCard
                  company={company}
                  onEdit={() => handleEdit(company)}
                  onDelete={() => handleDelete(company.id)}
                  canModify={canModify(company)}
                  convertToUSD={convertToUSD}
                />
              </div>
            ))
          )}
        </div>

        {!isLoading && filteredCompanies.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">No companies found. Add your first company to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}