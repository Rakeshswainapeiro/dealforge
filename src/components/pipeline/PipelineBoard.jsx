import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertCircle, ArrowRight, Flame } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

export default function PipelineBoard({ opportunities, onSelectOpportunity }) {
  const queryClient = useQueryClient();

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      return await api.entities.DealOpportunity.update(id, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealOpportunities'] });
    },
  });

  const columns = [
    { status: 'new', title: 'New', color: 'bg-blue-50', headerColor: 'bg-blue-500' },
    { status: 'contacted', title: 'Contacted', color: 'bg-indigo-50', headerColor: 'bg-indigo-500' },
    { status: 'due_diligence', title: 'Due Diligence', color: 'bg-purple-50', headerColor: 'bg-purple-500' },
    { status: 'negotiation', title: 'Negotiation', color: 'bg-amber-50', headerColor: 'bg-amber-500' },
    { status: 'closed_won', title: 'Closed Won', color: 'bg-emerald-50', headerColor: 'bg-emerald-500' },
    { status: 'closed_lost', title: 'Closed Lost', color: 'bg-slate-50', headerColor: 'bg-slate-400' }
  ];

  const onDragEnd = (result) => {
    if (!result.destination) return;
    
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId;
    
    updateStatusMutation.mutate({ id: draggableId, status: newStatus });
  };

  const priorityColors = {
    high: "bg-red-100 text-red-800 border-red-300",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
    low: "bg-emerald-100 text-emerald-800 border-emerald-300"
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 overflow-x-auto pb-4">
        {columns.map(column => {
          const columnOpps = opportunities.filter(o => o.status === column.status);
          return (
            <div key={column.status} className="min-w-[280px]">
              <Card className={`${column.color} border-2 border-slate-200 mb-3`}>
                <CardHeader className={`p-3 ${column.headerColor} text-white rounded-t-lg`}>
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>{column.title}</span>
                    <Badge className="bg-white/20 text-white border-white/30">{columnOpps.length}</Badge>
                  </CardTitle>
                </CardHeader>
              </Card>
              
              <Droppable droppableId={column.status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-3 min-h-[400px] p-2 rounded-lg transition-colors ${
                      snapshot.isDraggingOver ? 'bg-slate-200/50' : 'bg-transparent'
                    }`}
                  >
                    {columnOpps.map((opp, index) => (
                      <Draggable key={opp.id} draggableId={opp.id} index={index}>
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            onClick={() => onSelectOpportunity(opp)}
                            className={`border-2 transition-all cursor-pointer ${
                              snapshot.isDragging 
                                ? 'shadow-2xl rotate-2 scale-105 border-blue-400' 
                                : 'border-slate-200 hover:shadow-lg hover:border-blue-300'
                            } ${opp.priority === 'high' ? 'ring-2 ring-red-400 ring-opacity-50' : ''}`}
                          >
                            <CardContent className="p-4 space-y-3">
                              <div>
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <h4 className="font-semibold text-slate-900 text-sm leading-tight flex-1">
                                    {opp.target_name}
                                  </h4>
                                  <div className="flex items-center gap-1">
                                    {opp.priority === 'high' && (
                                      <Flame className="w-4 h-4 text-red-500" />
                                    )}
                                    <Badge className={`text-[10px] px-1.5 py-0 border ${priorityColors[opp.priority]}`}>
                                      {opp.priority}
                                    </Badge>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-600 mb-2">{opp.target_sector}</p>
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1">
                                    <TrendingUp className="w-3 h-3 text-emerald-600" />
                                    <span className="font-semibold text-emerald-700">
                                      Score: {opp.strategic_fit_score}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3 text-amber-600" />
                                    <span className="font-semibold text-amber-700">
                                      Risk: {opp.risk_score}
                                    </span>
                                  </div>
                                </div>

                                {opp.estimated_value && (
                                  <div className="text-xs text-slate-700">
                                    <span className="font-semibold">${opp.estimated_value.toFixed(0)}M</span>
                                  </div>
                                )}

                                {opp.next_steps && (
                                  <div className="pt-2 border-t border-slate-200">
                                    <div className="flex items-start gap-1">
                                      <ArrowRight className="w-3 h-3 text-blue-600 mt-0.5 flex-shrink-0" />
                                      <p className="text-xs text-slate-700 line-clamp-2 leading-tight">
                                        {opp.next_steps}
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}