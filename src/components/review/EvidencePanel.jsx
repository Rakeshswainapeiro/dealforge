/* eslint-disable react/prop-types */
import { cn } from "@/lib/utils";

// How much weight an evidence reason carries on the AI draft recommendation. The
// evidence itself (documents, calculations, research, comparison) is produced by the
// server's evidence pipeline and is summarised here only as the reasons behind the
// draft. Shown to the Sirius Investment Team only.
//   Verified     - a quote from a submitted document or an external source, or a calculation
//   AI inference - a model's reading of sources; cited but not verified
//   Missing      - nothing was found, readable or researched

const BASIS = {
  verified_evidence: { label: "Verified", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  ai_inference: { label: "AI inference", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  missing: { label: "Missing", cls: "border-slate-300 bg-slate-100 text-slate-700" },
};

function BasisBadge({ basis }) {
  const b = BASIS[basis] || BASIS.missing;
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", b.cls)} data-testid={`basis-${basis}`}>{b.label}</span>;
}

// The extra part of the recommendation card: why the evidence changed (or did not change) the draft.
export function RecommendationEvidence({ recommendation: r }) {
  if (!r?.evidence_available) return null;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="review-evidence-reasons">
      <p className="text-xs font-semibold text-slate-900">
        Evidence behind this draft
        {r.adjusted && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">made more cautious: rules said {r.rules_rating}</span>}
      </p>
      {r.narrative && <p className="text-xs text-slate-700" data-testid="review-narrative">{r.narrative.text} <BasisBadge basis="ai_inference" /></p>}
      <ul className="space-y-1.5">
        {r.evidence_reasons.map((x, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-slate-700"><BasisBadge basis={x.basis} /><span>{x.text}</span></li>
        ))}
        {r.evidence_reasons.length === 0 && <li className="text-xs text-slate-500">No evidence has changed the rule-based draft.</li>}
      </ul>
      <p className="text-[11px] leading-snug text-slate-400">{r.human_decision_note}</p>
    </div>
  );
}
