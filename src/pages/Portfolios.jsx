import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Briefcase, TrendingUp, DollarSign, Building2 } from "lucide-react";
import PortfolioForm from "../components/portfolio/PortfolioForm";
import PortfolioDetails from "../components/portfolio/PortfolioDetails";

export default function PortfoliosPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: portfolios = [], isLoading: portfoliosLoading } = useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const allPortfolios = await api.entities.Portfolio.list();
      if (currentUser?.role === 'admin') return allPortfolios;
      return allPortfolios.filter(p => p.created_by === currentUser?.email);
    },
    enabled: !!currentUser,
  });

  const { data: holdings = [] } = useQuery({
    queryKey: ['portfolioHoldings'],
    queryFn: async () => {
      const allHoldings = await api.entities.PortfolioHolding.list();
      if (currentUser?.role === 'admin') return allHoldings;
      return allHoldings.filter(h => h.created_by === currentUser?.email);
    },
    enabled: !!currentUser,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const allCompanies = await api.entities.Company.list();
      if (currentUser?.role === 'admin') return allCompanies;
      return allCompanies.filter(c => c.created_by === currentUser?.email);
    },
    enabled: !!currentUser,
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.entities.Portfolio.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      setShowForm(false);
      setEditingPortfolio(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.Portfolio.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      setShowForm(false);
      setEditingPortfolio(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.Portfolio.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });

  const handleSubmit = (data) => {
    if (editingPortfolio) {
      updateMutation.mutate({ id: editingPortfolio.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const calculatePortfolioMetrics = (portfolio) => {
    const portfolioHoldings = holdings.filter(h => h.portfolio_id === portfolio.id);
    
    let totalCost = 0;
    let currentValue = 0;
    let totalHoldings = portfolioHoldings.length;

    portfolioHoldings.forEach(holding => {
      const company = companies.find(c => c.id === holding.company_id);
      if (company) {
        const cost = holding.shares * holding.purchase_price;
        const value = holding.shares * company.stock_price;
        totalCost += cost;
        currentValue += value;
      }
    });

    const profitLoss = currentValue - totalCost;
    const profitLossPercent = totalCost > 0 ? ((profitLoss / totalCost) * 100) : 0;

    return {
      totalCost,
      currentValue,
      profitLoss,
      profitLossPercent,
      totalHoldings
    };
  };

  const calculateTotalMetrics = () => {
    let totalValue = 0;
    let totalCost = 0;

    portfolios.forEach(portfolio => {
      const metrics = calculatePortfolioMetrics(portfolio);
      totalValue += metrics.currentValue;
      totalCost += metrics.totalCost;
    });

    const totalPL = totalValue - totalCost;
    const totalPLPercent = totalCost > 0 ? ((totalPL / totalCost) * 100) : 0;

    return { totalValue, totalCost, totalPL, totalPLPercent };
  };

  if (selectedPortfolio) {
    return (
      <PortfolioDetails 
        portfolio={selectedPortfolio}
        holdings={holdings.filter(h => h.portfolio_id === selectedPortfolio.id)}
        companies={companies}
        onBack={() => setSelectedPortfolio(null)}
        onEdit={(p) => {
          setEditingPortfolio(p);
          setShowForm(true);
          setSelectedPortfolio(null);
        }}
      />
    );
  }

  const totalMetrics = calculateTotalMetrics();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Portfolio Management</h1>
            <p className="text-slate-600 mt-1">Track and manage your investment portfolios</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="bg-teal-600 hover:bg-teal-700">
            <Plus className="w-4 h-4 mr-2" />
            New Portfolio
          </Button>
        </div>

        {/* Total Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Briefcase className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Total Portfolios</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{portfolios.length}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Total Value</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                ${(totalMetrics.totalValue / 1000).toFixed(1)}B
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Total P/L</span>
              </div>
              <p className={`text-2xl font-bold ${totalMetrics.totalPL >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${(totalMetrics.totalPL / 1000).toFixed(1)}B
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-teal-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Total Return</span>
              </div>
              <p className={`text-2xl font-bold ${totalMetrics.totalPLPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalMetrics.totalPLPercent.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingPortfolio ? 'Edit Portfolio' : 'Create New Portfolio'}</CardTitle>
            </CardHeader>
            <CardContent>
              <PortfolioForm
                portfolio={editingPortfolio}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setShowForm(false);
                  setEditingPortfolio(null);
                }}
              />
            </CardContent>
          </Card>
        )}

        {portfoliosLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-32 bg-slate-200 rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : portfolios.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Briefcase className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 mb-4">No portfolios yet</p>
              <Button onClick={() => setShowForm(true)} className="bg-teal-600 hover:bg-teal-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Portfolio
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {portfolios.map(portfolio => {
              const metrics = calculatePortfolioMetrics(portfolio);
              return (
                <Card 
                  key={portfolio.id} 
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => setSelectedPortfolio(portfolio)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{portfolio.name}</CardTitle>
                        {portfolio.description && (
                          <p className="text-sm text-slate-600 mt-1">{portfolio.description}</p>
                        )}
                      </div>
                      <Badge className={portfolio.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
                        {portfolio.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Holdings</span>
                        <span className="font-semibold text-slate-900 flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          {metrics.totalHoldings}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Current Value</span>
                        <span className="font-semibold text-slate-900">
                          {portfolio.currency} {(metrics.currentValue / 1000).toFixed(2)}B
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Cost Basis</span>
                        <span className="font-semibold text-slate-900">
                          {portfolio.currency} {(metrics.totalCost / 1000).toFixed(2)}B
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                        <span className="text-sm font-medium text-slate-700">P/L</span>
                        <div className="text-right">
                          <p className={`font-bold ${metrics.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {portfolio.currency} {(metrics.profitLoss / 1000).toFixed(2)}B
                          </p>
                          <p className={`text-sm ${metrics.profitLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {metrics.profitLoss >= 0 ? '+' : ''}{metrics.profitLossPercent.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}