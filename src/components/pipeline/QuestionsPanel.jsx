import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, MessagesSquare } from "lucide-react";

// Questions on one opportunity (WF-04): every thread with its status, due date
// and owner, and a form to ask a question without changing the screening state.
// A formal information request that unlocks the record is a board action.
const STATUS = {
  open: "bg-emerald-100 text-emerald-800 border-emerald-200",
  answered: "bg-indigo-100 text-indigo-800 border-indigo-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function QuestionsPanel({ card }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");

  const threadsQuery = useQuery({
    queryKey: ["qa", "threads", card.id],
    queryFn: () => api.qa.threads(card.id),
  });
  const threads = threadsQuery.data?.threads || [];

  const ask = useMutation({
    mutationFn: () => api.qa.open(card.id, {
      subject: subject.trim(), body: body.trim(), requires_response: true, due_at: due || undefined,
    }),
    onSuccess: () => {
      setAsking(false); setSubject(""); setBody(""); setDue("");
      queryClient.invalidateQueries({ queryKey: ["qa"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      toast({ title: "Question sent", description: "The subsidiary has been notified in the portal." });
    },
    onError: (error) => toast({ variant: "destructive", title: "Question not sent", description: error?.message }),
  });

  return (
    <div className="mt-6 rounded-lg border border-slate-200 p-3 space-y-2" data-testid="questions-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MessagesSquare className="h-4 w-4 text-teal-600" /> Questions
          {card.open_questions > 0 && <Badge variant="outline">{card.open_questions} open</Badge>}
          {card.overdue_questions > 0 && (
            <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">{card.overdue_questions} overdue</Badge>
          )}
        </p>
        {!asking && !card.is_final && (
          <Button size="sm" variant="outline" onClick={() => setAsking(true)} data-testid="ask-question-open">Ask a question</Button>
        )}
      </div>
      {threadsQuery.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading...</p>
      ) : threads.length === 0 ? (
        <p className="text-xs text-slate-500">No questions on this opportunity yet.</p>
      ) : (
        <ul className="space-y-1">
          {threads.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
              <a className="text-teal-700 hover:underline" href={createPageUrl("QandA") + "?thread=" + t.id}>{t.subject}</a>
              <Badge variant="outline" className={STATUS[t.display_status] || STATUS.open}>{t.display_status}</Badge>
              {t.kind === "information_request" && <Badge variant="outline">information request</Badge>}
              {t.due_at && t.display_status === "open" && (
                <span className={t.overdue ? "text-xs text-red-700" : "text-xs text-slate-500"}>
                  due {new Date(t.due_at).toLocaleDateString()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" data-testid="ask-question-subject" />
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your question..." data-testid="ask-question-body" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-600" htmlFor="ask-due">Due</label>
            <Input id="ask-due" type="date" className="h-8 w-40" value={due} onChange={(e) => setDue(e.target.value)} />
            <Button
              size="sm"
              className="ml-auto bg-teal-600 hover:bg-teal-700"
              disabled={!subject.trim() || !body.trim() || ask.isPending}
              onClick={() => ask.mutate()}
              data-testid="ask-question-send"
            >
              {ask.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Send question
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
          <p className="text-xs text-slate-500">
            A question does not change the screening state. To unlock the record for changes, use “Request information”.
          </p>
        </div>
      )}
    </div>
  );
}
