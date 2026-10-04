import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, DollarSign, Clock, Target, AlertTriangle } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";

const COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#10B981'];

export default function PipelineMetrics({ opportunities, loading }) {
  const [timeFilter, setTimeFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");

  const filteredOpps = useMemo(() => {
    if (!opportunities) return [];
    
    let filtered = [...opportunities];
    
    // Time filter
    if (timeFilter !== "all") {
      const now = new Date();
      const cutoff = new Date();
      if (timeFilter === "7days") cutoff.setDate(now.getDate() - 7);
      else if (timeFilter === "30days") cutoff.setDate(now.getDate() - 30);
      else if (timeFilter === "90days") cutoff.setDate(now.getDate() - 90);
      
      filtered = filtered.filter(opp => new Date(opp.created_date) >= cutoff);
    }
    
    // Sector filter
    if (sectorFilter !== "all") {
      filtered = filtered.filter(opp => opp.target_sector === sectorFilter);
    }
    
    // Member filter
    if (memberFilter !== "all") {
      filtered = filtered.filter(opp => opp.created_by === memberFilter);
    }
    
    return filtered;
  }, [opportunities, timeFilter, sectorFilter, memberFilter]);

  const sectors = useMemo(() => {
    if (!opportunities) return [];
    return [...new Set(opportunities.map(o => o.target_sector).filter(Boolean))];
  }, [opportunities]);

  const members = useMemo(() => {
    if (!opportunities) return [];
    return [...new Set(opportunities.map(o => o.created_by).filter(Boolean))];
  }, [opportunities]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const total = filteredOpps.length;
    const won = filteredOpps.filter(o => o.status === 'closed_won').length;
    const lost = filteredOpps.filter(o => o.status === 'closed_lost').length;
    const active = filteredOpps.filter(o => !['closed_won', 'closed_lost'].includes(o.status)).length;
    
    const avgDealSize = filteredOpps.reduce((sum, o) => sum + (o.estimated_value || 0), 0) / total || 0;
    const totalValue = filteredOpps.reduce((sum, o) => sum + (o.estimated_value || 0), 0);
    const wonValue = filteredOpps.filter(o => o.status === 'closed_won').reduce((sum, o) => sum + (o.estimated_value || 0), 0);
    
    const conversionRate = total > 0 ? (won / total) * 100 : 0;
    const winRate = (won + lost) > 0 ? (won / (won + lost)) * 100 : 0;
    
    // Deal velocity (avg days to close)
    const closedDeals = filteredOpps.filter(o => ['closed_won', 'closed_lost'].includes(o.status));
    const avgDaysToClose = closedDeals.length > 0 
      ? closedDeals.reduce((sum, o) => {
          const created = new Date(o.created_date);
          const updated = new Date(o.updated_date);
          return sum + Math.floor((updated - created) / (1000 * 60 * 60 * 24));
        }, 0) / closedDeals.length 
      : 0;

    return {
      total,
      won,
      lost,
      active,
      avgDealSize,
      totalValue,
      wonValue,
      conversionRate,
      winRate,
      avgDaysToClose
    };
  }, [filteredOpps]);

  // Conversion funnel data
  const funnelData = useMemo(() => {
    const stages = ['new', 'contacted', 'due_diligence', 'negotiation', 'closed_won'];
    return stages.map(stage => ({
      stage: stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      count: filteredOpps.filter(o => o.status === stage).length,
      value: filteredOpps.filter(o => o.status === stage).reduce((sum, o) => sum + (o.estimated_value || 0), 0)
    }));
  }, [filteredOpps]);

  // Conversion rates by stage
  const conversionByStage = useMemo(() => {
    const stages = ['new', 'contacted', 'due_diligence', 'negotiation', 'closed_won'];
    const data = [];
    
    for (let i = 0; i < stages.length - 1; i++) {
      const current = filteredOpps.filter(o => o.status === stages[i]).length;
      const next = filteredOpps.filter(o => stages.slice(i + 1).includes(o.status)).length;
      const rate = current > 0 ? (next / current) * 100 : 0;
      
      data.push({
        stage: stages[i].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        rate: parseFloat(rate.toFixed(1))
      });
    }
    
    return data;
  }, [filteredOpps]);

  // Win/Loss reasons
  const winLossReasons = useMemo(() => {
    const reasons = {};
    
    filteredOpps.filter(o => o.status === 'closed_lost').forEach(opp => {
      if (opp.risk_factors && opp.risk_factors.length > 0) {
        opp.risk_factors.forEach(risk => {
          reasons[risk] = (reasons[risk] || 0) + 1;
        });
      }
    });
    
    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [filteredOpps]);

  // Sector distribution
  const sectorDistribution = useMemo(() => {
    const distribution = {};
    filteredOpps.forEach(opp => {
      const sector = opp.target_sector || 'Unknown';
      distribution[sector] = (distribution[sector] || 0) + 1;
    });
    
    return Object.entries(distribution)
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredOpps]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-20 bg-slate-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Time Period</label>
              <Select value={timeFilter} onValueChange={setTimeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="7days">Last 7 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="90days">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Sector</label>
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sectors</SelectItem>
                  {sectors.map(sector => (
                    <SelectItem key={sector} value={sector}>{sector}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Team Member</label>
              <Select value={memberFilter} onValueChange={setMemberFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  {members.map(member => (
                    <SelectItem key={member} value={member}>{member}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Pipeline Value</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  ${(metrics.totalValue / 1000).toFixed(1)}B
                </p>
                <p className="text-xs text-teal-600 mt-1 font-medium">
                  {metrics.total} opportunities
                </p>
              </div>
              <div className="w-12 h-12 bg-teal-600 rounded-full flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Win Rate</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {metrics.winRate.toFixed(1)}%
                </p>
                <p className="text-xs text-blue-600 mt-1 font-medium">
                  {metrics.won} won / {metrics.lost} lost
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                <Target className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Avg Deal Size</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  ${metrics.avgDealSize.toFixed(1)}M
                </p>
                <p className="text-xs text-purple-600 mt-1 font-medium">
                  Won value: ${(metrics.wonValue / 1000).toFixed(1)}B
                </p>
              </div>
              <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Avg Days to Close</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {metrics.avgDaysToClose.toFixed(0)}
                </p>
                <p className="text-xs text-orange-600 mt-1 font-medium">
                  Deal velocity
                </p>
              </div>
              <div className="w-12 h-12 bg-orange-600 rounded-full flex items-center justify-center">
                <Clock className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Deal Funnel by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#14B8A6" name="Opportunities" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversion Rate by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={conversionByStage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip formatter={(value) => `${value}%`} />
                <Legend />
                <Line type="monotone" dataKey="rate" stroke="#3B82F6" strokeWidth={2} name="Conversion %" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Opportunities by Sector</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={sectorDistribution}
                  dataKey="count"
                  nameKey="sector"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label
                >
                  {sectorDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Top Loss Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            {winLossReasons.length > 0 ? (
              <div className="space-y-3">
                {winLossReasons.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{item.reason}</span>
                    <Badge variant="outline" className="bg-red-50 text-red-700">
                      {item.count} deals
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-8">
                No loss data available
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}