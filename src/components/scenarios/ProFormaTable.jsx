import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp } from "lucide-react";

export default function ProFormaTable({ scenario, acquirer }) {
  const totalSynergies = (scenario.synergies?.revenue_synergies || 0) + (scenario.synergies?.cost_synergies || 0);
  const integrationCosts = scenario.synergies?.integration_costs || 0;
  const netSynergies = totalSynergies - integrationCosts;

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-teal-600" />
          Pro-Forma Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Acquirer</TableHead>
              <TableHead className="text-right">Synergies</TableHead>
              <TableHead className="text-right">Pro-Forma</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Revenue ($M)</TableCell>
              <TableCell className="text-right">{acquirer?.revenue?.toFixed(0) || '-'}</TableCell>
              <TableCell className="text-right text-teal-600">+{scenario.synergies?.revenue_synergies || 0}</TableCell>
              <TableCell className="text-right font-semibold">
                {((acquirer?.revenue || 0) + (scenario.synergies?.revenue_synergies || 0)).toFixed(0)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">EBITDA ($M)</TableCell>
              <TableCell className="text-right">{acquirer?.ebitda?.toFixed(0) || '-'}</TableCell>
              <TableCell className="text-right text-teal-600">+{scenario.synergies?.cost_synergies || 0}</TableCell>
              <TableCell className="text-right font-semibold">
                {((acquirer?.ebitda || 0) + (scenario.synergies?.cost_synergies || 0)).toFixed(0)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Integration Costs ($M)</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right text-amber-600">-{integrationCosts}</TableCell>
              <TableCell className="text-right font-semibold">-{integrationCosts}</TableCell>
            </TableRow>
            <TableRow className="bg-slate-50">
              <TableCell className="font-bold">Net Value Creation ($M)</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right font-bold text-teal-600">{netSynergies.toFixed(0)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}