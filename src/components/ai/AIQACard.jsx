/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIBadge } from "./AIValidationCard";

// Q&A about the active tab. The AI answers only from that tab, its documents and
// the Sirius strategy library; an answer it cannot support says so. The thread is
// private to the person asking. "Send to Sirius" turns a question into a normal
// Q&A thread with the Sirius team.
export default function AIQACard({ tabLabel, hasRecord, qa, suggestions = [], loading, asking, error, onAsk, onClear, onSendToSirius }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  const messages = qa?.messages || [];
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user");

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "nearest" }); }, [messages.length, asking]);

  const submit = (question) => {
    const q = (question ?? text).trim();
    if (!q || asking) return;
    // The question stays in the box until the answer arrives, so a failed
    // request (rate limit, provider down) never loses what was typed.
    Promise.resolve(onAsk(q))
      .then(() => setText((current) => (current.trim() === q ? "" : current)))
      .catch(() => {});
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="ai-qa-card" aria-label={`Q&A, ${tabLabel}`}>
      <header className="flex items-center gap-3 px-5 pb-2 pt-4">
        <AIBadge />
        <h3 className="flex-1 text-[15px] font-semibold text-slate-900">Q&amp;A: {tabLabel}</h3>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-slate-500" onClick={onClear} title="Clear this conversation">
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
        )}
      </header>

      {!hasRecord ? (
        <p className="px-5 pb-5 text-sm text-slate-500">Save the draft to ask questions about this tab.</p>
      ) : (
        <div className="space-y-2 px-5 pb-4">
          {loading && messages.length === 0 && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto" data-testid="ai-qa-messages">
            {messages.map((m, i) => (
              <div key={i} className={cn("rounded-lg px-3 py-2 text-xs", m.role === "user" ? "bg-slate-100 text-slate-800" : "bg-blue-50 text-slate-800")}>
                <p className="whitespace-pre-wrap">{m.text || m.answer}</p>
                {m.role === "assistant" && (
                  <>
                    {!m.answerable && <p className="mt-1 font-medium text-amber-700">Not answerable from the material submitted.</p>}
                    {m.answerable && m.grounded === false && (
                      <p className="mt-1 text-[11px] font-medium text-amber-700" data-testid="ai-qa-ungrounded">No source cited. Check this against the submission before relying on it.</p>
                    )}
                    {m.sources?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.sources.map((s) => <span key={s} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-slate-500">{s}</span>)}
                      </div>
                    )}
                    {m.stale && <p className="mt-1 text-[11px] text-amber-700">This tab changed since the answer was given.</p>}
                  </>
                )}
              </div>
            ))}
            {asking && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Thinking...</p>}
            <div ref={endRef} />
          </div>
          {error && <p className="text-xs text-red-600" data-testid="ai-qa-error">{error}</p>}
          {messages.length === 0 && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((q) => (
                <button key={q} type="button" onClick={() => submit(q)} disabled={asking}
                  className="rounded-full border border-slate-300 px-2.5 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          )}
          <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={`Ask about ${tabLabel.toLowerCase()}...`}
              className="h-8 text-xs" data-testid="ai-qa-input" />
            <Button type="submit" size="sm" className="h-8 gap-1 bg-teal-600 px-3 text-xs hover:bg-teal-700" disabled={asking || !text.trim()} data-testid="ai-qa-send">
              <Send className="h-3 w-3" /> Ask
            </Button>
          </form>
          {lastQuestion && (
            <button type="button" className="text-[11px] font-medium text-indigo-600 hover:underline" onClick={() => onSendToSirius(lastQuestion.text)}>
              Send my last question to Sirius
            </button>
          )}
          <p className="pt-1 text-[11px] leading-snug text-slate-400" data-testid="ai-qa-disclaimer">{qa?.disclaimer} {qa?.advisory}</p>
        </div>
      )}
    </section>
  );
}
