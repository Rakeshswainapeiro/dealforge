import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Pencil, Trash2, TrendingUp, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrencyConverter } from "./CurrencyConverter";

export default function CompanyCard({ company, onEdit, onDelete, canModify = true, convertToUSD = false }) {
  const { convertValue, formatCurrency } = useCurrencyConverter();
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const currency = company.currency || "USD";
  
  // Convert values if needed
  const displayRevenue = convertToUSD ? convertValue(company.revenue, currency) : company.revenue;
  const displayMarketCap = convertToUSD ? convertValue(company.market_cap, currency) : company.market_cap;
  const displayCurrency = convertToUSD ? "USD" : currency;
  
  // Calculate correct EV/Revenue multiple
  const evRevenue = company.revenue > 0 ? (company.enterprise_value / company.revenue).toFixed(2) : 0;

  const handleRefreshData = async (e) => {
    e.stopPropagation();
    if (!company.ticker) {
      alert("Company must have a ticker symbol to refresh market data");
      return;
    }

    setRefreshing(true);
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Get REAL-TIME financial data for: ${company.ticker} (${company.name})
Exchange: ${company.exchange || 'Unknown'}
Current Currency: ${currency}

**CRITICAL: Fetch CURRENT 2026 data from multiple sources:**
- Yahoo Finance - Real-time price
- Bloomberg/Reuters - Current data
- Company filings - Latest reports

Return LATEST data in ORIGINAL CURRENCY (${currency}):
- currency: "${currency}"
- exchange: "${company.exchange || ''}"
- revenue: Latest annual revenue in millions ${currency}
- ebitda: EBITDA in millions ${currency}
- net_income: Net income in millions ${currency}
- market_cap: CURRENT market cap (today's price × shares) in millions ${currency}
- enterprise_value: EV in millions ${currency}
- shares_outstanding: Shares in millions
- stock_price: CURRENT stock price in ${currency}
- total_debt: Debt in millions ${currency}
- cash: Cash in millions ${currency}
- last_data_sync: Current timestamp

Return in ORIGINAL CURRENCY (${currency}). Do NOT convert.
Use MOST RECENT data (2026, 2025, or latest quarter).`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            currency: { type: "string" },
            exchange: { type: "string" },
            revenue: { type: "number" },
            ebitda: { type: "number" },
            net_income: { type: "number" },
            market_cap: { type: "number" },
            enterprise_value: { type: "number" },
            shares_outstanding: { type: "number" },
            stock_price: { type: "number" },
            total_debt: { type: "number" },
            cash: { type: "number" },
            last_data_sync: { type: "string" }
          }
        }
      });

      await api.entities.Company.update(company.id, {
        currency: result.currency || currency,
        exchange: result.exchange || company.exchange,
        revenue: result.revenue || company.revenue,
        ebitda: result.ebitda || company.ebitda,
        net_income: result.net_income || company.net_income,
        market_cap: result.market_cap || company.market_cap,
        enterprise_value: result.enterprise_value || company.enterprise_value,
        shares_outstanding: result.shares_outstanding || company.shares_outstanding,
        stock_price: result.stock_price || company.stock_price,
        total_debt: result.total_debt || company.total_debt,
        cash: result.cash || company.cash,
        last_data_sync: result.last_data_sync || new Date().toISOString()
      });

      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert("Financial data updated successfully!");
    } catch (err) {
      console.error("Refresh error:", err);
      alert("Failed to refresh data: " + err.message);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="cursor-pointer"
    >
      <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="border-b border-slate-100 p-4">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">{company.name}</h3>
                <div className="flex gap-1 mt-1">
                  {company.ticker && (
                    <Badge variant="outline" className="text-xs">
                      {company.ticker}
                    </Badge>
                  )}
                  {currency !== "USD" && (
                    <Badge className="bg-blue-100 text-blue-800 text-xs">
                      {currency}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              {company.ticker && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleRefreshData}
                  disabled={refreshing}
                  title="Refresh market data"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600' : 'text-slate-600'}`} />
                </Button>
              )}
              {canModify && (
                <>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete ${company.name}?`)) {
                        onDelete();
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {company.sector && (
            <div className="flex justify-between">
              <span className="text-sm text-slate-600">Sector</span>
              <span className="text-sm font-medium text-slate-900">{company.sector}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Market Cap</span>
            <span className="text-sm font-semibold text-slate-900">
              {displayCurrency} {(displayMarketCap / 1000).toFixed(1)}B
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Revenue</span>
            <span className="text-sm font-semibold text-slate-900">
              {displayCurrency} {(displayRevenue / 1000).toFixed(1)}B
            </span>
          </div>
          {evRevenue > 0 && (
            <div className="flex justify-between items-center pt-2 border-t border-slate-100">
              <span className="text-sm text-slate-600 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                EV/Revenue
              </span>
              <span className="text-sm font-bold text-teal-600">
                {parseFloat(evRevenue).toFixed(2)}x
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}