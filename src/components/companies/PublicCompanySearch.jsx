import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, Loader2, Building2, Plus, CheckCircle, Globe } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PublicCompanySearch({ onClose }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [importedIds, setImportedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState("global");
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (companyData) => {
      return await api.entities.Company.create(companyData);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setImportedIds(prev => new Set([...prev, variables.ticker || variables.name]));
    },
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError("Please enter a company name or ticker symbol");
      return;
    }

    setSearching(true);
    setError(null);
    setResults([]);

    try {
      let prompt = "";
      
      if (activeTab === "adx") {
        prompt = `Search Abu Dhabi Securities Exchange (ADX) for REAL-TIME data on: "${searchQuery}"

**CRITICAL: Fetch CURRENT 2026 data from multiple sources:**
- Yahoo Finance (finance.yahoo.com) - Real-time prices
- ADX official website (https://www.adx.ae) - Live trading data
- Bloomberg/Reuters - Current market data
- Company investor relations - Latest filings
- Financial news sites - Recent reports

For EACH company found, provide LATEST data in ORIGINAL CURRENCY (AED):
- name: Full company legal name
- ticker: ADX trading code
- exchange: "ADX"
- sector: Primary industry sector
- currency: "AED"
- revenue: Latest annual revenue in millions AED (DO NOT CONVERT)
- ebitda: EBITDA in millions AED
- net_income: Net profit in millions AED
- market_cap: CURRENT market cap in millions AED (today's stock price × shares)
- enterprise_value: Enterprise value in millions AED
- shares_outstanding: Total shares in millions
- stock_price: CURRENT stock price in AED (real-time or today's close)
- total_debt: Total debt in millions AED
- cash: Cash and equivalents in millions AED
- last_data_sync: Current date/time

Return data in ORIGINAL CURRENCY (AED). Do NOT convert to USD.
Use MOST RECENT data available (2026, 2025, or latest quarter).
Verify data from multiple sources for accuracy.

Return 3-5 companies with COMPLETE, CURRENT financial data.`;
      } else if (activeTab === "india") {
        prompt = `Search Indian Stock Exchanges for REAL-TIME data on: "${searchQuery}"

**CRITICAL: Fetch CURRENT 2026 data from multiple sources:**
- Yahoo Finance - Real-time Indian stock prices
- NSE/BSE official websites - Live market data
- Moneycontrol.com - Current Indian market data
- Economic Times, Bloomberg - Latest reports
- Company filings - Recent quarterly data

For EACH company found, provide LATEST data in ORIGINAL CURRENCY (INR):
- name: Full company legal name
- ticker: NSE/BSE symbol (e.g., "RELIANCE.NS", "TCS.NS")
- exchange: "NSE" or "BSE"
- sector: Primary industry sector
- currency: "INR"
- revenue: Latest annual revenue in millions INR (DO NOT CONVERT)
- ebitda: EBITDA in millions INR
- net_income: Net profit in millions INR
- market_cap: CURRENT market cap in millions INR (today's price × shares)
- enterprise_value: Enterprise value in millions INR
- shares_outstanding: Total shares in millions
- stock_price: CURRENT stock price in INR (real-time or today's close)
- total_debt: Total debt in millions INR
- cash: Cash in millions INR
- last_data_sync: Current date/time

Return data in ORIGINAL CURRENCY (INR). Do NOT convert to USD.
Use MOST RECENT data (FY2025-26, Q4 FY2024-25, or latest available).
Cross-verify from multiple sources.

Return 3-5 companies with COMPLETE, CURRENT financial data.`;
      } else {
        prompt = `Search for REAL-TIME data on public companies: "${searchQuery}"

**CRITICAL: Fetch CURRENT 2026 data from multiple sources:**
- Yahoo Finance - Real-time stock prices
- Google Finance - Current market data
- Bloomberg, Reuters - Latest financials
- Company investor relations - Recent filings
- SEC EDGAR filings - Latest 10-K/10-Q

For EACH company, provide LATEST data in ORIGINAL TRADING CURRENCY:
- name: Company name
- ticker: Stock ticker symbol
- exchange: Primary exchange (NYSE, NASDAQ, LSE, etc.)
- sector: Primary sector/industry
- currency: Trading currency (USD, EUR, GBP, etc.)
- revenue: Latest annual revenue in millions (original currency)
- ebitda: EBITDA in millions (original currency)
- net_income: Net income in millions (original currency)
- market_cap: CURRENT market cap in millions (today's price × shares)
- enterprise_value: Enterprise value in millions (original currency)
- shares_outstanding: Shares in millions
- stock_price: CURRENT stock price (real-time or today's close)
- total_debt: Total debt in millions (original currency)
- cash: Cash in millions (original currency)
- last_data_sync: Current date/time

Return data in ORIGINAL TRADING CURRENCY (do NOT convert).
Use MOST RECENT data (2026, 2025, or latest quarter).
Verify from multiple sources for accuracy.

Return 5-8 companies with COMPLETE, CURRENT data.`;
      }

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            companies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  ticker: { type: "string" },
                  exchange: { type: "string" },
                  sector: { type: "string" },
                  currency: { type: "string" },
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
            }
          }
        }
      });

      setResults(result.companies || []);
      setSearching(false);
    } catch (err) {
      console.error("Search error:", err);
      setError(err.message || "Failed to search for companies");
      setSearching(false);
    }
  };

  const handleImport = (company) => {
    // Keep data in original currency
    const companyData = {
      name: company.name || "Unknown Company",
      ticker: company.ticker || "",
      exchange: company.exchange || "",
      sector: company.sector || "Unknown",
      currency: company.currency || "USD",
      revenue: company.revenue || 0,
      ebitda: company.ebitda || 0,
      net_income: company.net_income || 0,
      market_cap: company.market_cap || 0,
      enterprise_value: company.enterprise_value || 0,
      shares_outstanding: company.shares_outstanding || 0,
      stock_price: company.stock_price || 0,
      total_debt: company.total_debt || 0,
      cash: company.cash || 0,
      last_data_sync: company.last_data_sync || new Date().toISOString()
    };
    importMutation.mutate(companyData);
  };

  return (
    <Card className="border-blue-200 shadow-lg">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-600" />
            Search Public Companies
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setResults([]); setError(null); }}>
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="global" className="gap-2">
              <Globe className="w-4 h-4" />
              Global Markets
            </TabsTrigger>
            <TabsTrigger value="adx" className="gap-2">
              <Building2 className="w-4 h-4" />
              ADX (UAE)
            </TabsTrigger>
            <TabsTrigger value="india" className="gap-2">
              <Building2 className="w-4 h-4" />
              BSE/NSE (India)
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === "adx" 
                ? "Search ADX companies (e.g., ADNOC, First Abu Dhabi Bank)"
                : activeTab === "india"
                ? "Search BSE/NSE companies (e.g., Reliance, TCS, INFY)"
                : "Search by company name or ticker (e.g., Apple, AAPL)"
            }
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button
            onClick={handleSearch}
            disabled={searching}
            className="bg-blue-600 hover:bg-blue-700 min-w-[100px]"
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Search
              </>
            )}
          </Button>
        </div>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        {results.length > 0 && (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            <p className="text-sm text-slate-600 font-medium">
              Found {results.length} companies
            </p>
            {results.map((company, idx) => {
              const isImported = importedIds.has(company.ticker || company.name);
              return (
                <Card key={idx} className="border-slate-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-slate-900">{company.name}</h4>
                            {company.ticker && (
                              <Badge variant="outline" className="text-xs">{company.ticker}</Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-600">{company.sector}</p>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleImport(company)}
                        disabled={isImported || importMutation.isPending}
                        size="sm"
                        className={isImported ? "bg-emerald-600" : "bg-blue-600 hover:bg-blue-700"}
                      >
                        {isImported ? (
                          <>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Imported
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4 mr-2" />
                            Import
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      {company.currency && (
                        <div>
                          <span className="text-slate-600">Currency:</span>
                          <p className="font-semibold text-blue-700">{company.currency}</p>
                        </div>
                      )}
                      {company.revenue !== undefined && company.revenue !== null && (
                        <div>
                          <span className="text-slate-600">Revenue:</span>
                          <p className="font-semibold text-slate-900">{company.currency || 'USD'} {company.revenue.toFixed(0)}M</p>
                        </div>
                      )}
                      {company.market_cap !== undefined && company.market_cap !== null && (
                        <div>
                          <span className="text-slate-600">Market Cap:</span>
                          <p className="font-semibold text-slate-900">{company.currency || 'USD'} {company.market_cap.toFixed(0)}M</p>
                        </div>
                      )}
                      {company.stock_price !== undefined && company.stock_price !== null && (
                        <div>
                          <span className="text-slate-600">Stock Price:</span>
                          <p className="font-semibold text-slate-900">{company.currency || 'USD'} {company.stock_price.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {!searching && results.length === 0 && !error && (
          <div className="text-center py-8 text-slate-500">
            <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>
              {activeTab === "adx" 
                ? "Search for ADX-listed companies from Abu Dhabi Securities Exchange"
                : activeTab === "india"
                ? "Search for companies listed on Bombay Stock Exchange (BSE) or National Stock Exchange (NSE)"
                : "Search for public companies to import their financial data"
              }
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}