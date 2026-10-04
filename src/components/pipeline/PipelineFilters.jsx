import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export default function PipelineFilters({ filters, onFilterChange, opportunities }) {
  const sectors = [...new Set(opportunities.map(o => o.target_sector))];
  
  return (
    <Card className="border-slate-200">
      <CardContent className="p-6">
        <div className="grid md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Sector</Label>
            <Select value={filters.sector} onValueChange={(val) => onFilterChange({...filters, sector: val})}>
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

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={filters.opportunity_type} onValueChange={(val) => onFilterChange({...filters, opportunity_type: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="acquisition">Acquisition</SelectItem>
                <SelectItem value="merger">Merger</SelectItem>
                <SelectItem value="strategic_partnership">Strategic Partnership</SelectItem>
                <SelectItem value="asset_purchase">Asset Purchase</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={filters.status} onValueChange={(val) => onFilterChange({...filters, status: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="pursuing">Pursuing</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={filters.priority} onValueChange={(val) => onFilterChange({...filters, priority: val})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}