import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, 
  Building2, 
  TrendingUp, 
  DollarSign, 
  PieChart,
  Pencil,
  BarChart3,
  Globe
} from "lucide-react";
import AICompanyInsights from "./AICompanyInsights";
import RiskAssessment from "../shared/RiskAssessment";
import CompanyNewsScraper from "./CompanyNewsScraper";
import AIFinancialAnalyst from "./AIFinancialAnalyst";

const EXCHANGE_RATES = {
  "USD": 1,
  "AED": 3.67,
  "INR": 83.0
};

export default function CompanyDetails({ company, allCompanies, onBack, onEdit, canModify = true }) {
  const [displayCurrency, setDisplayCurrency] = useState(company.currency || "USD");
  const nativeCurrency = company.currency || "USD";
  
  // Convert function
  const convertValue = (value) => {
    if (!value) return 0;
    const fromRate = EXCHANGE_RATES[nativeCurrency] || 1;
    const toRate = EXCHANGE_RATES[displayCurrency] || 1;
    return value * (toRate / fromRate);
  };

  // Convert all financial values
  const displayRevenue = convertValue(company.revenue);
  const displayEbitda = convertValue(company.ebitda);
  const displayNetIncome = convertValue(company.net_income);
  const displayMarketCap = convertValue(company.market_cap);
  const displayEnterpriseValue = convertValue(company.enterprise_value);
  const displayTotalDebt = convertValue(company.total_debt);
  const displayCash = convertValue(company.cash);
  const displayStockPrice = convertValue(company.stock_price);
  const displayNetDebt = displayTotalDebt - displayCash;

  // Ratios remain the same regardless of currency
  const evRevenue = company.revenue > 0 ? (company.enterprise_value / company.revenue).toFixed(2) : 'N/A';
  const evEbitda = company.ebitda > 0 ? (company.enterprise_value / company.ebitda).toFixed(2) : 'N/A';
  const peRatio = company.net_income > 0 ? (company.market_cap / company.net_income).toFixed(2) : 'N/A';
  const ebitdaMargin = company.revenue > 0 ? ((company.ebitda / company.revenue) * 100).toFixed(1) : 'N/A';
  const netMargin = company.revenue > 0 ? ((company.net_income / company.revenue) * 100).toFixed(1) : 'N/A';
  const debtToEquity = (company.market_cap > 0 && company.total_debt > 0) ? (company.total_debt / company.market_cap).toFixed(2) : 'N/A';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-teal-400 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
                <Building2 className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl font-bold text-slate-900">{company.name}</h1>
                  {company.ticker && (
                    <Badge variant="outline" className="text-base px-3 py-1">
                      {company.ticker}
                    </Badge>
                  )}
                  <Badge className="bg-blue-100 text-blue-800 text-base px-3 py-1">
                    Native: {nativeCurrency}
                  </Badge>
                </div>
                {company.sector && (
                  <p className="text-slate-600 mt-1">{company.sector}</p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">Display in:</span>
              <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="AED">AED</SelectItem>
                  <SelectItem value="INR">INR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canModify && (
              <Button onClick={() => onEdit(company)} className="bg-teal-600 hover:bg-teal-700 gap-2">
                <Pencil className="w-4 h-4" />
                Edit Company
              </Button>
            )}
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Market Cap</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {displayCurrency} {(displayMarketCap / 1000).toFixed(1)}B
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-teal-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Enterprise Value</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {displayCurrency} {(displayEnterpriseValue / 1000).toFixed(1)}B
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-emerald-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Revenue</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {displayCurrency} {(displayRevenue / 1000).toFixed(1)}B
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <PieChart className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">Market Share</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {company.market_share || 0}%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Financial Overview */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal-600" />
                Income Statement
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">Revenue</span>
                  <span className="font-semibold text-slate-900">{displayCurrency} {displayRevenue.toFixed(0)}M</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">EBITDA</span>
                  <span className="font-semibold text-slate-900">{displayCurrency} {displayEbitda.toFixed(0)}M</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">EBITDA Margin</span>
                  <span className="font-semibold text-emerald-600">{ebitdaMargin}%</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">Net Income</span>
                  <span className="font-semibold text-slate-900">{displayCurrency} {displayNetIncome.toFixed(0)}M</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Net Margin</span>
                  <span className="font-semibold text-emerald-600">{netMargin}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-teal-600" />
                Balance Sheet
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">Total Debt</span>
                  <span className="font-semibold text-slate-900">{displayCurrency} {displayTotalDebt.toFixed(0)}M</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">Cash & Equivalents</span>
                  <span className="font-semibold text-slate-900">{displayCurrency} {displayCash.toFixed(0)}M</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">Net Debt</span>
                  <span className={`font-semibold ${displayNetDebt < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {displayCurrency} {displayNetDebt.toFixed(0)}M
                  </span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <span className="text-slate-600">Debt / Equity</span>
                  <span className="font-semibold text-slate-900">{debtToEquity}x</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Valuation Multiples */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-teal-600" />
              Valuation Multiples
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-2">EV / Revenue</p>
                <p className="text-2xl font-bold text-teal-600">{evRevenue}x</p>
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-2">EV / EBITDA</p>
                <p className="text-2xl font-bold text-teal-600">{evEbitda}x</p>
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-2">P / E Ratio</p>
                <p className="text-2xl font-bold text-teal-600">{peRatio}x</p>
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 mb-2">Stock Price</p>
                <p className="text-2xl font-bold text-teal-600">{displayCurrency} {displayStockPrice.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Share Information */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-teal-600" />
              Share Information
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-slate-600 mb-2">Shares Outstanding</p>
                <p className="text-xl font-semibold text-slate-900">{company.shares_outstanding.toFixed(1)}M</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-2">Current Stock Price</p>
                <p className="text-xl font-semibold text-slate-900">{displayCurrency} {displayStockPrice.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-2">Implied Market Cap</p>
                <p className="text-xl font-semibold text-slate-900">
                  {displayCurrency} {((company.shares_outstanding * displayStockPrice) / 1000).toFixed(1)}B
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes Section */}
        {company.notes && (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100">
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <p className="text-slate-700 whitespace-pre-wrap">{company.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Tabs for Additional Insights */}
        <Tabs defaultValue="analyst" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="analyst">AI Financial Analyst</TabsTrigger>
            <TabsTrigger value="insights">AI Insights & Risk</TabsTrigger>
            <TabsTrigger value="intelligence" className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Market Intelligence
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analyst" className="mt-6">
            <AIFinancialAnalyst company={company} allCompanies={allCompanies} />
          </TabsContent>

          <TabsContent value="insights" className="space-y-6 mt-6">
            {/* AI Risk Assessment */}
            <RiskAssessment type="company" data={company} context={{ allCompanies }} />

            {/* AI Strategic Insights */}
            <AICompanyInsights company={company} allCompanies={allCompanies} />
          </TabsContent>

          <TabsContent value="intelligence" className="mt-6">
            <CompanyNewsScraper company={company} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}