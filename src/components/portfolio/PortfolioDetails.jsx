import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Pencil, Trash2, TrendingUp, Building2 } from "lucide-react";
import AddHoldingForm from "./AddHoldingForm";

export default function PortfolioDetails({ portfolio, holdings, companies, onBack, onEdit }) {
  const [showAddHolding, setShowAddHolding] = useState(false);
  const queryClient = useQueryClient();

  const createHoldingMutation = useMutation({
    mutationFn: (data) => api.entities.PortfolioHolding.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolioHoldings'] });
      setShowAddHolding(false);
    },
  });

  const deleteHoldingMutation = useMutation({
    mutationFn: (id) => api.entities.PortfolioHolding.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolioHoldings'] });
    },
  });

  const calculateMetrics = () => {
    let totalCost = 0;
    let currentValue = 0;

    holdings.forEach(holding => {
      const company = companies.find(c => c.id === holding.company_id);
      if (company) {
        totalCost += holding.shares * holding.purchase_price;
        currentValue += holding.shares * company.stock_price;
      }
    });

    const profitLoss = currentValue - totalCost;
    const profitLossPercent = totalCost > 0 ? ((profitLoss / totalCost) * 100) : 0;

    return { totalCost, currentValue, profitLoss, profitLossPercent };
  };

  const metrics = calculateMetrics();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-slate-900">{portfolio.name}</h1>
                <Badge className={portfolio.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
                  {portfolio.status}
                </Badge>
              </div>
              {portfolio.description && (
                <p className="text-slate-600 mt-1">{portfolio.description}</p>
              )}
            </div>
          </div>
          <Button onClick={() => onEdit(portfolio)} variant="outline">
            <Pencil className="w-4 h-4 mr-2" />
            Edit Portfolio
          </Button>
        </div>

        {/* Performance Metrics */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-1">Current Value</p>
              <p className="text-2xl font-bold text-slate-900">
                {portfolio.currency} {(metrics.currentValue / 1000).toFixed(2)}B
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-1">Cost Basis</p>
              <p className="text-2xl font-bold text-slate-900">
                {portfolio.currency} {(metrics.totalCost / 1000).toFixed(2)}B
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-1">Total P/L</p>
              <p className={`text-2xl font-bold ${metrics.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {portfolio.currency} {(metrics.profitLoss / 1000).toFixed(2)}B
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-1">Return %</p>
              <p className={`text-2xl font-bold ${metrics.profitLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {metrics.profitLoss >= 0 ? '+' : ''}{metrics.profitLossPercent.toFixed(2)}%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Add Holding Form */}
        {showAddHolding && (
          <Card>
            <CardHeader>
              <CardTitle>Add Holding</CardTitle>
            </CardHeader>
            <CardContent>
              <AddHoldingForm
                portfolioId={portfolio.id}
                companies={companies}
                onSubmit={(data) => createHoldingMutation.mutate(data)}
                onCancel={() => setShowAddHolding(false)}
              />
            </CardContent>
          </Card>
        )}

        {/* Holdings List */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Holdings ({holdings.length})</CardTitle>
              <Button onClick={() => setShowAddHolding(true)} className="bg-teal-600 hover:bg-teal-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Holding
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {holdings.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No holdings in this portfolio</p>
                <Button onClick={() => setShowAddHolding(true)} className="mt-4 bg-teal-600 hover:bg-teal-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Holding
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {holdings.map(holding => {
                  const company = companies.find(c => c.id === holding.company_id);
                  if (!company) return null;

                  const cost = holding.shares * holding.purchase_price;
                  const currentValue = holding.shares * company.stock_price;
                  const pl = currentValue - cost;
                  const plPercent = cost > 0 ? ((pl / cost) * 100) : 0;

                  return (
                    <div key={holding.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-slate-900">{company.name}</h3>
                          {company.ticker && (
                            <Badge variant="outline">{company.ticker}</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-4 mt-2 text-sm">
                          <div>
                            <p className="text-slate-600">Shares</p>
                            <p className="font-medium text-slate-900">{holding.shares.toFixed(2)}M</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Purchase Price</p>
                            <p className="font-medium text-slate-900">{portfolio.currency} {holding.purchase_price.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Current Price</p>
                            <p className="font-medium text-slate-900">{portfolio.currency} {company.stock_price.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Value</p>
                            <p className="font-medium text-slate-900">{portfolio.currency} {(currentValue / 1000).toFixed(2)}B</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className={`font-bold ${pl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {pl >= 0 ? '+' : ''}{portfolio.currency} {(pl / 1000).toFixed(2)}B
                          </p>
                          <p className={`text-sm ${plPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {pl >= 0 ? '+' : ''}{plPercent.toFixed(2)}%
                          </p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => {
                            if (confirm('Delete this holding?')) {
                              deleteHoldingMutation.mutate(holding.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}