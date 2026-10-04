import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pencil, Trash2, Calendar, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function SimulationList({ simulations, companies, onSelect, onEdit, onDelete, canModify, loading }) {
  if (loading) {
    return (
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="border-slate-200">
            <CardContent className="p-6">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const statusColors = {
    draft: "bg-slate-100 text-slate-800",
    running: "bg-blue-100 text-blue-800",
    completed: "bg-emerald-100 text-emerald-800",
    archived: "bg-amber-100 text-amber-800"
  };

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {simulations.map((sim) => {
        const acquirer = companies.find(c => c.id === sim.merger_parties?.acquirer_id);
        const targets = sim.merger_parties?.target_ids?.map(id => 
          companies.find(c => c.id === id)
        ).filter(Boolean) || [];

        return (
          <Card
            key={sim.id}
            className="border-slate-200 hover:shadow-lg transition-shadow cursor-pointer group"
            onClick={() => onSelect(sim)}
          >
            <CardHeader className="border-b border-slate-100">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <CardTitle className="text-lg group-hover:text-teal-600 transition-colors">
                    {sim.name}
                  </CardTitle>
                  {sim.description && (
                    <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                      {sim.description}
                    </p>
                  )}
                </div>
                <Badge className={statusColors[sim.status]}>
                  {sim.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-600">
                    {sim.market_definition?.product_market || "No market defined"}
                  </span>
                </div>
                {acquirer && (
                  <div className="text-sm text-slate-600">
                    <span className="font-semibold">{acquirer.name}</span>
                    {targets.length > 0 && (
                      <span> acquiring {targets.map(t => t.name).join(", ")}</span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar className="w-3 h-3" />
                  Updated {new Date(sim.updated_date).toLocaleDateString()}
                </div>
              </div>

              {canModify(sim) && (
                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(sim);
                    }}
                    className="flex-1"
                  >
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete ${sim.name}?`)) {
                        onDelete(sim.id);
                      }
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {simulations.length === 0 && (
        <div className="col-span-full text-center py-12">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Play className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-500">
            No simulations yet. Create your first merger simulation to analyze competitive effects.
          </p>
        </div>
      )}
    </div>
  );
}