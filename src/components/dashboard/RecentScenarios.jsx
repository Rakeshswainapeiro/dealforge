import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitMerge, Calendar } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useTranslation } from "@/lib/i18n";

export default function RecentScenarios({ scenarios, loading }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentScenarios')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array(5).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const statusColors = {
    draft: "bg-slate-100 text-slate-800",
    active: "bg-teal-100 text-teal-800",
    completed: "bg-emerald-100 text-emerald-800",
    archived: "bg-amber-100 text-amber-800",
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <GitMerge className="w-5 h-5 text-teal-600" />
          {t('dashboard.recentScenarios')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {scenarios.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {t('dashboard.noScenarios')}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {scenarios.slice(0, 5).map((scenario) => (
              <Link
                key={scenario.id}
                to={createPageUrl("Scenarios")}
                className="block p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-slate-900">{scenario.name}</h4>
                    <div className="flex items-center gap-2 mt-1 text-sm text-slate-600">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(scenario.updated_date), "MMM d, yyyy")}
                    </div>
                  </div>
                  <Badge className={statusColors[scenario.status]}>
                    {scenario.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
