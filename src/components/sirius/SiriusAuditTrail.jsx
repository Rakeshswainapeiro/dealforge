/* eslint-disable react/prop-types */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { formatWhen } from '@/components/review/reviewModel';

const DECISION_ACTIONS = new Set([
  'transition',
  'transition_auto',
  'hard_filter_confirmed',
  'hard_filter_overridden',
  'soft_filter_confirmed',
  'soft_filter_adjusted',
  'disqualifier_cleared',
  'owner_assigned',
  'owner_reassigned',
  'ai_review_accept',
  'ai_review_override',
  'ai_review_clarify',
]);

const AI_DECISION_LABEL = {
  ai_review_accept: 'AI finding accepted',
  ai_review_override: 'AI finding overridden',
  ai_review_clarify: 'Preparer asked about an AI finding',
};

const SCORE_ACTIONS = new Set(['scorecard_scored', 'scorecard_override']);

const FILTERS = [
  { key: 'all', label: 'All activity', test: () => true },
  { key: 'decisions', label: 'Decisions', test: (e) => DECISION_ACTIONS.has(e.action) },
  { key: 'scoring', label: 'Scorecard and overrides', test: (e) => SCORE_ACTIONS.has(e.action) },
];

export default function SiriusAuditTrail({ card }) {
  const id = card.id;
  const [filter, setFilter] = useState('all');
  const query = useQuery({
    queryKey: ['review', 'timeline', id],
    queryFn: () => api.pipeline.timeline(id),
  });

  const events = Array.isArray(query.data?.events) ? query.data.events : [];
  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const shown = events.filter(active.test);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      {/* Title */}
      <h2 className="text-base font-bold text-slate-900 tracking-tight">Audit trail</h2>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the audit trail">
        {FILTERS.map((f) => {
          const count = events.filter(f.test).length;
          const isSelected = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              data-testid={`audit-filter-${f.key}`}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                isSelected
                  ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold shadow-sm'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 font-normal'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Timeline Content */}
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs py-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Loading the audit trail...
        </div>
      ) : query.isError ? (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {query.error?.message || 'The audit trail could not be loaded.'}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">Nothing recorded under this filter yet.</p>
      ) : (
        <ol className="space-y-4 pt-1" data-testid="audit-list">
          {shown.map((e, i) => (
            <li
              key={`${e.ts}-${e.action}-${i}`}
              className="border-l-2 border-slate-200 pl-4 space-y-1 relative"
              data-testid="audit-event"
            >
              {/* Timeline node bullet */}
              <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-slate-300" />

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-900">
                  {AI_DECISION_LABEL[e.action] || e.label}
                </span>
                {e.from && e.to && (
                  <Badge
                    variant="outline"
                    className="text-[11px] font-normal border-slate-200 text-slate-700 bg-slate-50/70"
                  >
                    {String(e.from).replace(/_/g, ' ')} &rarr; {String(e.to).replace(/_/g, ' ')}
                  </Badge>
                )}
                {SCORE_ACTIONS.has(e.action) && e.action === 'scorecard_override' && (
                  <Badge
                    variant="outline"
                    className="border-amber-200 text-amber-700 bg-amber-50 text-[11px] font-normal"
                  >
                    CIO override
                  </Badge>
                )}
              </div>

              <p className="text-[11px] text-slate-500">
                {e.actor_email || 'system'}
                {e.role ? ` (${String(e.role).replace(/_/g, ' ')})` : ''} · {formatWhen(e.ts)}
              </p>

              {e.detail && (
                <p className="text-xs text-slate-700 leading-relaxed mt-1">
                  {e.detail}
                </p>
              )}

              {e.comment && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded p-2.5 mt-1 leading-relaxed">
                  {e.comment}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
