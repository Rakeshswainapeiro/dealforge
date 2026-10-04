import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DollarSign } from "lucide-react";

// Real-time exchange rates (approximate - in production, fetch from API)
const EXCHANGE_RATES = {
  "USD": 1,
  "AED": 3.67,
  "INR": 83.0,
  "EUR": 0.92,
  "GBP": 0.79,
  "JPY": 149.5,
  "CNY": 7.24,
  "SGD": 1.34
};

export function useCurrencyConverter() {
  const [convertToUSD, setConvertToUSD] = useState(false);

  const convertValue = (value, fromCurrency) => {
    if (!value || !fromCurrency) return value;
    if (!convertToUSD || fromCurrency === "USD") return value;
    
    const rate = EXCHANGE_RATES[fromCurrency] || 1;
    return value / rate;
  };

  const formatCurrency = (value, currency, decimals = 0) => {
    if (!value) return "0";
    const displayValue = convertToUSD ? convertValue(value, currency) : value;
    const displayCurrency = convertToUSD ? "USD" : currency;
    
    return `${displayCurrency} ${displayValue.toFixed(decimals)}`;
  };

  return { convertToUSD, setConvertToUSD, convertValue, formatCurrency };
}

export default function CurrencyConverter({ convertToUSD, setConvertToUSD }) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
      <DollarSign className="w-4 h-4 text-teal-600" />
      <Label htmlFor="currency-toggle" className="text-sm cursor-pointer">
        Convert to USD
      </Label>
      <Switch
        id="currency-toggle"
        checked={convertToUSD}
        onCheckedChange={setConvertToUSD}
      />
    </div>
  );
}