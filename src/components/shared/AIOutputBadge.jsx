import React from 'react';
import { Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

// AI-output labelling (W9-01 / BRD NFR-03). Any surface that renders text a
// model produced shows this badge, with the governance disclaimer on hover, so
// a reader always knows the content is machine-generated. The label text and
// disclaimer come from the resolved governance policy; the shipped defaults are
// used until the config loads so the badge never flashes empty.
export default function AIOutputBadge({ className = '', compact = false }) {
  const { data } = useQuery({
    queryKey: ['ai-governance'],
    queryFn: () => api.aiGovernance.get(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const label = data?.label || 'AI-generated';
  const disclaimer = data?.disclaimer || 'AI-generated. Decision support only; review before relying on it.';
  if (data && data.config && data.config.label_ai_output === false) return null;
  return (
    <span
      className={'inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ' + className}
      title={disclaimer}
      data-testid="ai-output-badge"
    >
      <Sparkles className="h-3 w-3" />
      {compact ? null : label}
    </span>
  );
}
