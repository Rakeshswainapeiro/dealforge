import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useTranslation } from "@/lib/i18n";

export default function QuickStats({ companies, scenarios }) {
  const { t } = useTranslation();
  const totalEV = companies.reduce((sum, c) => sum + (c.enterprise_value || 0), 0);
  const totalRevenue = companies.reduce((sum, c) => sum + (c.revenue || 0), 0);
  const avgEVRevenue = totalRevenue > 0 ? totalEV / totalRevenue : 0;

  const topSectors = companies.reduce((acc, c) => {
    if (c.sector) {
      acc[c.sector] = (acc[c.sector] || 0) + 1;
    }
    return acc;
  }, {});

  const sortedSectors = Object.entries(topSectors)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([sector, count]) => ({ sector, count }));

  const COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-teal-600" />
          {t('dashboard.quickStats')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div>
          <p className="text-sm text-slate-600 mb-2">{t('dashboard.totalEnterpriseValue')}</p>
          <p className="text-2xl font-bold text-slate-900">
            ${(totalEV / 1000).toFixed(1)}B
          </p>
        </div>

        <div>
          <p className="text-sm text-slate-600 mb-2">{t('dashboard.avgEvRevenue')}</p>
          <p className="text-2xl font-bold text-slate-900">
            {avgEVRevenue.toFixed(1)}x
          </p>
        </div>

        {sortedSectors.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-3">{t('dashboard.topSectors')}</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sortedSectors} margin={{ top: 10, right: 10, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="sector" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#fff', 
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px'
                  }}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {sortedSectors.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
