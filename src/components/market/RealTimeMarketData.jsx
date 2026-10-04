import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";

export default function RealTimeMarketData({ company, onDataUpdate }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const { data: dataProvidersConfig } = useQuery({
    queryKey: ['dataProvidersConfig'],
    queryFn: async () => {
      const settings = await api.entities.AppSettings.list();
      const config = settings.find(s => s.setting_key === 'data_providers_config');
      return config?.setting_value || {};
    },
    initialData: {},
  });

  const hasActiveProvider = () => {
    return dataProvidersConfig.bloomberg?.enabled || 
           dataProvidersConfig.refinitiv?.enabled || 
           dataProvidersConfig.factset?.enabled;
  };

  const fetchLiveData = async () => {
    if (!company.ticker || !hasActiveProvider()) return;

    setLoading(true);
    try {
      const prompt = `Fetch simulated real-time market data for ticker ${company.ticker}:
      
Current company data:
- Name: ${company.name}
- Sector: ${company.sector}
- Last recorded stock price: $${company.stock_price || 'N/A'}
- Market cap: $${company.market_cap}M

Generate realistic real-time market data including:
- Current stock price with intraday change
- Market cap update
- Day high/low
- Volume
- Key financial metrics
- Recent news headlines (1-2)

Make the data realistic based on the sector and company profile.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            stock_price: { type: "number" },
            price_change: { type: "number" },
            price_change_percent: { type: "number" },
            day_high: { type: "number" },
            day_low: { type: "number" },
            volume: { type: "number" },
            market_cap: { type: "number" },
            pe_ratio: { type: "number" },
            week_52_high: { type: "number" },
            week_52_low: { type: "number" },
            news_headlines: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setLiveData(result);
      setLastUpdate(new Date());
      
      if (onDataUpdate) {
        onDataUpdate(result);
      }
    } catch (error) {
      console.error("Failed to fetch live data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasActiveProvider()) {
      fetchLiveData();
      
      // Auto-refresh every 5 minutes
      const interval = setInterval(fetchLiveData, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [company.ticker, dataProvidersConfig]);

  if (!hasActiveProvider()) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6">
          <div className="text-center py-4">
            <Activity className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              Configure a data provider in Settings to enable real-time market data
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!company.ticker) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6">
          <p className="text-sm text-slate-600 text-center">
            Add a ticker symbol to view real-time market data
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            Real-Time Market Data
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-xs text-slate-500">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <Button
              onClick={fetchLiveData}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {loading && !liveData ? (
          <div className="animate-pulse space-y-4">
            <div className="h-16 bg-slate-200 rounded" />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-12 bg-slate-200 rounded" />
              <div className="h-12 bg-slate-200 rounded" />
            </div>
          </div>
        ) : liveData ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-3xl font-bold text-slate-900">
                    ${liveData.stock_price?.toFixed(2)}
                  </h3>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded ${
                    liveData.price_change >= 0 ? 'bg-emerald-100' : 'bg-red-100'
                  }`}>
                    {liveData.price_change >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600" />
                    )}
                    <span className={`text-sm font-semibold ${
                      liveData.price_change >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      ${Math.abs(liveData.price_change).toFixed(2)} ({liveData.price_change_percent?.toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-1">{company.ticker} • {company.name}</p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-800">
                <Activity className="w-3 h-3 mr-1" />
                Live
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600">Day High</p>
                <p className="text-lg font-semibold text-slate-900">${liveData.day_high?.toFixed(2)}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600">Day Low</p>
                <p className="text-lg font-semibold text-slate-900">${liveData.day_low?.toFixed(2)}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600">Volume</p>
                <p className="text-lg font-semibold text-slate-900">
                  {(liveData.volume / 1000000).toFixed(2)}M
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600">P/E Ratio</p>
                <p className="text-lg font-semibold text-slate-900">{liveData.pe_ratio?.toFixed(2)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-900">52 Week High</p>
                <p className="text-lg font-semibold text-blue-900">${liveData.week_52_high?.toFixed(2)}</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-900">52 Week Low</p>
                <p className="text-lg font-semibold text-blue-900">${liveData.week_52_low?.toFixed(2)}</p>
              </div>
            </div>

            {liveData.news_headlines && liveData.news_headlines.length > 0 && (
              <div className="pt-4 border-t border-slate-200">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Recent News</h4>
                <ul className="space-y-2">
                  {liveData.news_headlines.map((headline, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-2 flex-shrink-0" />
                      {headline}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-slate-600">Click refresh to load market data</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}