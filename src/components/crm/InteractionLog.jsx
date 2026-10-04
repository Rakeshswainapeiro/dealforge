import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Calendar, Plus } from "lucide-react";
import { format } from "date-fns";

export default function InteractionLog({ contact }) {
  const [showForm, setShowForm] = useState(false);
  const [newInteraction, setNewInteraction] = useState({
    type: "email",
    date: new Date().toISOString().split('T')[0],
    notes: "",
    outcome: ""
  });
  const [followupDate, setFollowupDate] = useState("");

  const queryClient = useQueryClient();

  const addInteractionMutation = useMutation({
    mutationFn: async () => {
      const interactions = contact.interactions || [];
      const interaction = {
        ...newInteraction,
        id: Date.now().toString()
      };
      
      const updates = {
        interactions: [...interactions, interaction],
        last_interaction_date: newInteraction.date
      };

      if (followupDate) {
        updates.next_followup_date = followupDate;
      }

      return await api.entities.Contact.update(contact.id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setShowForm(false);
      setNewInteraction({
        type: "email",
        date: new Date().toISOString().split('T')[0],
        notes: "",
        outcome: ""
      });
      setFollowupDate("");
    },
  });

  const interactions = contact.interactions || [];

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-indigo-600" />
            Interaction History
          </CardTitle>
          <Button
            onClick={() => setShowForm(!showForm)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Log Interaction
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {showForm && (
          <Card className="border-indigo-200 bg-indigo-50">
            <CardContent className="p-4 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Interaction Type</Label>
                  <Select value={newInteraction.type} onValueChange={(val) => setNewInteraction({...newInteraction, type: val})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="call">Phone Call</SelectItem>
                      <SelectItem value="meeting">Meeting</SelectItem>
                      <SelectItem value="video_call">Video Call</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={newInteraction.date}
                    onChange={(e) => setNewInteraction({...newInteraction, date: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={newInteraction.notes}
                  onChange={(e) => setNewInteraction({...newInteraction, notes: e.target.value})}
                  placeholder="What was discussed..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Outcome</Label>
                <Input
                  value={newInteraction.outcome}
                  onChange={(e) => setNewInteraction({...newInteraction, outcome: e.target.value})}
                  placeholder="e.g., Scheduled follow-up meeting, Sent proposal"
                />
              </div>

              <div className="space-y-2">
                <Label>Schedule Follow-up (Optional)</Label>
                <Input
                  type="date"
                  value={followupDate}
                  onChange={(e) => setFollowupDate(e.target.value)}
                />
              </div>

              <Button
                onClick={() => addInteractionMutation.mutate()}
                disabled={!newInteraction.notes || addInteractionMutation.isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                Save Interaction
              </Button>
            </CardContent>
          </Card>
        )}

        {contact.next_followup_date && (
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 text-amber-900">
              <Calendar className="w-4 h-4" />
              <span className="font-semibold">Next Follow-up:</span>
              <span>{format(new Date(contact.next_followup_date), 'MMMM d, yyyy')}</span>
            </div>
          </div>
        )}

        {interactions.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>No interactions logged yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {[...interactions].reverse().map((interaction) => (
              <div key={interaction.id} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{interaction.type.replace('_', ' ')}</Badge>
                    <span className="text-sm text-slate-600">
                      {format(new Date(interaction.date), 'MMM d, yyyy')}
                    </span>
                  </div>
                </div>
                <p className="text-slate-700 mb-2">{interaction.notes}</p>
                {interaction.outcome && (
                  <p className="text-sm text-slate-600">
                    <strong>Outcome:</strong> {interaction.outcome}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}