/* eslint-disable react/prop-types */
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIBadge } from "@/components/ai/AIValidationCard";

// A collapsible card for the Reviewer Workspace rail. The header always shows the
// title, a one-line summary while the card is closed, any status chips (such as
// "Stale") and the card's own action (Re-run, Refresh). Opening and closing is
// controlled by the workspace so the choice survives a tab switch.
//
// `action` sits outside the toggle button, so pressing it never opens or closes
// the card.
export default function RailSection({ title, badge = false, summary = null, chips = null, action = null, open, onToggle, testid, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid={testid}>
      <header className="flex items-center gap-3 px-5 py-3.5">
        <button
          type="button" onClick={onToggle} aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          data-testid={testid ? `${testid}-toggle` : undefined}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          {badge && <AIBadge />}
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-slate-900">{title}</span>
            {!open && summary && <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>}
          </span>
          {chips}
        </button>
        {action}
      </header>
      {open && <div className={cn("px-5 pb-5")}>{children}</div>}
    </section>
  );
}

// A small amber marker for a card whose result is out of date.
export function StaleChip({ label = "Stale" }) {
  return <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800" data-testid="stale-chip">{label}</span>;
}
