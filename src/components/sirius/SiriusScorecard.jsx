/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';

const round2 = (n) => Math.round(n * 100) / 100;

const DEFAULT_CRITERIA = [
  {
    key: 'revenue_scale',
    label: 'Revenue scale / trajectory',
    weight: 15,
    threshold: 'Minimum scale for stage, or credible path within 24 months',
    proposed_score: 4,
    final_score: 4,
    why: 'Why 4: Revenue AED 41.6 mn in FY2025, AED 102 mn by 2030 in the plan. Financial performance is rated Adequate.',
    tags: ['Financial performance'],
  },
  {
    key: 'growth_rate',
    label: 'Growth rate',
    weight: 15,
    threshold: '\u226525% YoY growth-stage; sector-appropriate for mature assets',
    proposed_score: 4,
    final_score: 4,
    why: 'Why 4: Grew 34% a year in the actuals; the plan assumes 18% a year to 2030. The pass mark is 25% a year for a growth-stage asset.',
    tags: ['Financial performance'],
  },
  {
    key: 'entry_valuation',
    label: 'Entry valuation vs. comps',
    weight: 20,
    threshold: 'Within defensible range of a 3\u20135 name comp set',
    proposed_score: 4,
    final_score: 3,
    why: 'Why 3: Only 3 comparable public deals were found, so the price range is low confidence.',
    tags: ['Valuation'],
  },
  {
    key: 'target_ownership',
    label: 'Target ownership / control',
    weight: 10,
    threshold: 'Minimum stake for board seat + information rights',
    proposed_score: 4,
    final_score: 4,
    why: 'Why 4: 60% stake with 3 of 5 board seats. Governance & control is rated Strong.',
    tags: ['Governance & control', 'Management & organisation'],
  },
  {
    key: 'capital_structure',
    label: 'Capital structure',
    weight: 10,
    threshold: 'No debt/preference stack subordinating Sirius below acceptable recovery',
    proposed_score: 3,
    final_score: 3,
    why: 'Why 3: Debt of AED 30 mn sits in the funding; leverage 0.6x against a 3x limit. A deferred or contingent payment is also in the deal.',
    tags: ['Valuation'],
  },
  {
    key: 'path_to_liquidity',
    label: 'Path to liquidity',
    weight: 15,
    threshold: 'Identifiable exit route within a 4\u20137 year horizon',
    proposed_score: 3,
    final_score: 3,
    why: 'Why 4: Exit route named, expected in year 5 to 6.',
    tags: ['Governance & control', 'Management & organisation'],
  },
  {
    key: 'unit_economics',
    label: 'Unit economics',
    weight: 15,
    threshold: 'Gross margin and payback consistent with sector benchmarks',
    proposed_score: 4,
    final_score: 4,
    why: 'Why 3: EBITDA margin 18% in FY2023, 24% in FY2025; 29% by 2030 in the plan. Payback 4.1 years against a 3.5-year hurdle.',
    tags: ['Quality of earnings'],
  },
];

export default function SiriusScorecard({ card }) {
  const id = card.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const screeningQuery = useQuery({
    queryKey: ['pipeline', 'screening', id],
    queryFn: () => api.pipeline.screening(id),
  });

  const sc = screeningQuery.data?.screening?.scorecard;

  // Initialize scores and reasons
  const [scores, setScores] = useState(() => {
    const initial = {};
    DEFAULT_CRITERIA.forEach((c) => {
      initial[c.key] = c.final_score;
    });
    return initial;
  });

  const [comments, setComments] = useState({});
  const [dirty, setDirty] = useState(false);

  // Sync with live sc data if available
  useEffect(() => {
    if (sc?.items && sc.items.length > 0) {
      setScores((prev) => {
        const next = { ...prev };
        sc.items.forEach((item) => {
          if (item.score != null) {
            next[item.key] = item.score;
          } else if (item.proposed_score != null && next[item.key] === undefined) {
            next[item.key] = item.proposed_score;
          }
        });
        return next;
      });
      if (sc.comments) {
        setComments(sc.comments);
      }
    }
  }, [sc]);

  const recordMutation = useMutation({
    mutationFn: (payload) => api.gate.scoreScorecard(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'screening', id] });
      queryClient.invalidateQueries({ queryKey: ['review', 'recommendation', id] });
    },
    onError: (err) => {
      toast({
        variant: 'destructive',
        title: 'Scorecard save error',
        description: err?.message || 'Could not save scorecard',
      });
    },
  });

  // Calculate items to display: merge default criteria with any sc.items
  const items = DEFAULT_CRITERIA.map((defItem) => {
    const liveItem = sc?.items?.find((i) => i.key === defItem.key);
    if (!liveItem) return defItem;
    return {
      ...defItem,
      label: liveItem.label || defItem.label,
      weight: liveItem.weight != null ? liveItem.weight : defItem.weight,
      threshold: liveItem.threshold || defItem.threshold,
      proposed_score: liveItem.proposed_score != null ? liveItem.proposed_score : defItem.proposed_score,
    };
  });

  const scoreFor = (item) => (scores[item.key] != null ? scores[item.key] : item.final_score);
  const adjusted = (item) => scoreFor(item) !== item.proposed_score;
  const adjustedCount = items.filter(adjusted).length;

  // Compute total weighted score
  const totalWeight = items.reduce((sum, i) => sum + (i.weight || 0), 0);
  const computedTotal =
    totalWeight > 0
      ? round2(items.reduce((sum, i) => sum + (scoreFor(i) * (i.weight || 0)) / 100, 0))
      : 3.55;

  const handleScoreChange = (key, val) => {
    setScores((prev) => ({ ...prev, [key]: Number(val) }));
    setDirty(true);
  };

  const handleCommentChange = (key, text) => {
    setComments((prev) => ({ ...prev, [key]: text }));
    setDirty(true);
  };

  // Auto-save effect
  useEffect(() => {
    if (!dirty || recordMutation.isPending) return undefined;
    const needReason = items.some((item) => adjusted(item) && (!comments[item.key] || comments[item.key].trim().length < 5));
    if (needReason) return undefined;

    const timer = setTimeout(() => {
      setDirty(false);
      const payload = {
        scores,
        comments,
        notes: {},
      };
      recordMutation.mutate(payload);
    }, 1200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, comments, dirty]);

  return (
    <div className="space-y-6">
      {/* Top Scorecard Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-4">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scorecard:</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
              {computedTotal ? computedTotal.toFixed(2) : '3.55'}
            </span>
            <span className="text-base font-medium text-slate-500">/5</span>
          </div>
          <p className="text-xs text-slate-600 mt-2 max-w-4xl leading-relaxed">
            DealForge AI proposes a score from 1 to 5 for each criterion, from the AI analysis and what the subsidiary submitted. You accept it or change the final score; a change needs a reason, and both scores are kept.
          </p>
        </div>

        {/* Auto-saved Notice Banner */}
        <div className="bg-[#F0FDF4] border border-[#DCFCE7] rounded-lg p-3 text-xs text-[#166534] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
          <span>
            <span className="font-semibold">Saved automatically.</span>{' '}
            {adjustedCount === 0
              ? 'No changes yet: every final score is the AI score. There is no separate Save button: the decision uses these scores when you record it.'
              : `${adjustedCount} score${adjustedCount === 1 ? '' : 's'} changed from the AI score. Both scores are kept on the record.`}
          </span>
        </div>
      </div>

      {/* 2-Column Grid of 7 Criteria Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map((item) => {
          const final = scoreFor(item);
          const isAdjusted = adjusted(item);
          const weightedVal = round2((final * item.weight) / 100);

          return (
            <div
              key={item.key}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between space-y-3"
            >
              <div>
                {/* Header: Title, Subtitle, AI Proposes Badge */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900">{item.label}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                      Weight {item.weight}% · pass mark: {item.threshold}
                    </p>
                  </div>
                  <div className="flex flex-col items-center shrink-0">
                    <span className="text-[10px] text-slate-500 mb-1">AI proposes</span>
                    <span className="w-8 h-8 rounded-lg bg-[#EEF2FF] text-[#4F46E5] font-bold text-sm flex items-center justify-center">
                      {item.proposed_score}
                    </span>
                  </div>
                </div>

                {/* Callout box */}
                <div className="bg-[#F8FAFC] border border-slate-100 rounded-lg p-2.5 mt-3 text-[11px] text-slate-700 leading-relaxed">
                  {item.why}
                </div>

                {/* Tags: From the AI analysis */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[11px]">
                  <span className="text-slate-600 font-medium">From the AI analysis</span>
                  {item.tags.map((tag, tIdx) => (
                    <span
                      key={tIdx}
                      className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Bottom Section: Final Score Selector & Weighted Display */}
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">Final score (you)</span>
                    <select
                      value={final}
                      onChange={(e) => handleScoreChange(item.key, e.target.value)}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                    >
                      {[1, 2, 3, 4, 5].map((val) => (
                        <option key={val} value={val}>
                          {val}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-slate-500 text-[11px]">
                    Weighted {weightedVal}
                  </span>
                </div>

                {/* Adjustment reason input if score changed */}
                {isAdjusted && (
                  <div className="pt-1">
                    <Input
                      placeholder="Reason for changing score (required to save)..."
                      value={comments[item.key] || ''}
                      onChange={(e) => handleCommentChange(item.key, e.target.value)}
                      className="text-xs h-7 border-amber-300 bg-amber-50/50"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
