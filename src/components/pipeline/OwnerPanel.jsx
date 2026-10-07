import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, UserCheck, Users } from "lucide-react";

// Named Sirius owner and routed reviewers (WF-02 / WF-03), with re-assignment.
// The server decides who may re-assign (the owner or an Investment Team lead);
// the form is offered to the Sirius team while the opportunity is with Sirius.
export default function OwnerPanel({ card }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");

  const ownersQuery = useQuery({
    queryKey: ["routing", "owners"],
    queryFn: () => api.routing.owners(),
    enabled: open,
    staleTime: 60 * 1000,
  });

  const reassign = useMutation({
    mutationFn: () => api.routing.reassign(card.id, email, reason.trim()),
    onSuccess: (result) => {
      setOpen(false);
      setEmail("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      toast({ title: "Owner re-assigned", description: `${result.owner_name || result.owner_email} now owns this opportunity.` });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not re-assign", description: error?.message }),
  });

  const reviewers = Array.isArray(card.assigned_reviewers) ? card.assigned_reviewers : [];
  const owners = (ownersQuery.data?.owners || []).filter((o) => o.email !== card.sirius_owner_email);

  return (
    <div className="mt-6 rounded-lg border border-slate-200 p-3 space-y-2" data-testid="owner-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <UserCheck className="h-4 w-4 text-teal-600" /> Sirius owner
        </p>
        {card.assigned_to_me && (
          <Badge variant="outline" className="bg-teal-50 text-teal-800 border-teal-200">Routed to you</Badge>
        )}
      </div>
      <p className="text-sm text-slate-700" data-testid="owner-name">
        {card.sirius_owner_name || card.sirius_owner_email || "Unassigned"}
        {card.sirius_owner_rule && (
          <span className="ml-2 text-xs text-slate-500">
            {card.sirius_owner_rule === "manual" ? "re-assigned" : `rule: ${card.sirius_owner_rule.replace(/_/g, " ")}`}
          </span>
        )}
      </p>
      {reviewers.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
          <Users className="h-3.5 w-3.5" /> Reviewers:
          {reviewers.map((r) => (
            <Badge key={r.email} variant="outline" className="font-normal">
              {r.name || r.email}
            </Badge>
          ))}
        </p>
      )}
      {card.can_review && !open && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="owner-reassign-open">
          Re-assign
        </Button>
      )}
      {open && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          {ownersQuery.isLoading ? (
            <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading the team...</p>
          ) : (
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="owner-reassign-select"
            >
              <option value="">Choose the new owner...</option>
              {owners.map((o) => (
                <option key={o.email} value={o.email}>
                  {o.full_name} ({o.open_count} open)
                </option>
              ))}
            </select>
          )}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for the hand-over"
            data-testid="owner-reassign-reason"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              disabled={!email || reason.trim().length < 5 || reassign.isPending}
              onClick={() => reassign.mutate()}
              data-testid="owner-reassign-submit"
            >
              {reassign.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Re-assign
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
