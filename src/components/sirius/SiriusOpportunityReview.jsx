/* eslint-disable react/prop-types */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';
import { useToast } from '@/components/ui/use-toast';
import SiriusHeaderMeta from './SiriusHeaderMeta';
import SiriusExecutiveSummary from './SiriusExecutiveSummary';
import SiriusOpportunityOverview from './SiriusOpportunityOverview';
import SiriusRationaleAndFit from './SiriusRationaleAndFit';
import SiriusFinancialsAndReturns from './SiriusFinancialsAndReturns';
import SiriusFundingAndKeyAsks from './SiriusFundingAndKeyAsks';
import SiriusRisksAndCompliance from './SiriusRisksAndCompliance';
import SiriusScorecard from './SiriusScorecard';
import SiriusAuditTrail from './SiriusAuditTrail';
import SiriusDecisionTab from './SiriusDecisionTab';
import SiriusAIValidationCard from './SiriusAIValidationCard';
import SiriusAIAnalysisCard from './SiriusAIAnalysisCard';
import SiriusQACard from './SiriusQACard';
import ReviewSections from '@/components/review/ReviewSections';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';

const TABS = [
  { key: 'executive_summary', label: 'Executive summary', sections: ['header', 'executive_summary'] },
  { key: 'opportunity_overview', label: 'Opportunity overview', sections: ['opportunity_overview'] },
  { key: 'rationale', label: 'Rationale and fit', sections: ['rationale'] },
  { key: 'financials', label: 'Financials and returns', sections: ['financials', 'accretion'] },
  { key: 'funding', label: 'Funding and key asks', sections: ['funding'] },
  { key: 'risks', label: 'Risks and compliance', sections: ['risks'] },
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'decision', label: 'Decision' },
  { key: 'audit', label: 'Audit trail' },
];

export default function SiriusOpportunityReview({ card, record, onMutate }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState('executive_summary');
  const [downloading, setDownloading] = useState(false);

  const id = card.id;

  const fieldsQuery = useQuery({
    queryKey: ['review', 'fields'],
    queryFn: () => api.gate.fields(),
    staleTime: 5 * 60 * 1000,
  });
  const gateQuery = useQuery({
    queryKey: ['review', 'gate', id],
    queryFn: () => api.gate.status(id),
  });
  const documentsQuery = useQuery({
    queryKey: ['review', 'documents', id],
    queryFn: () => api.gate.documents(id),
  });
  const aiQuery = useQuery({
    queryKey: ['review', 'ai', id],
    queryFn: () => api.aiReview.results(id),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });

  const rerun = useMutation({
    mutationFn: (tab) => api.aiReview.validate(id, tab, 'manual'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['review', 'ai', id] });
      onMutate?.();
    },
    onError: (error) => toast({ variant: 'destructive', title: 'AI validation did not run', description: error?.message }),
  });

  const analyse = useMutation({
    mutationFn: (tab) => api.aiReview.analyse(id, tab),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['review', 'ai', id] });
      onMutate?.();
    },
    onError: (error) => toast({ variant: 'destructive', title: 'AI analysis did not run', description: error?.message }),
  });


  const handleDownloadMemo = async () => {
    try {
      setDownloading(true);
      await api.pipeline.downloadMemo(id, 'pdf');
      toast({ title: 'Memo downloaded successfully' });
    } catch {
      try {
        await api.memoPack.download(id, 'html');
      } catch (err) {
        toast({
          variant: 'destructive',
          title: 'Download failed',
          description: err?.message || 'Could not download memo pack',
        });
      }
    } finally {
      setDownloading(false);
    }
  };

  const groups = fieldsQuery.data?.sections || [];
  const gate = gateQuery.data?.gate || null;
  const documents = Array.isArray(documentsQuery.data) ? documentsQuery.data : [];
  const activeTabObject = TABS.find((t) => t.key === activeKey) || TABS[0];
  const isSectionTab = ['executive_summary', 'opportunity_overview', 'rationale', 'financials', 'funding', 'risks'].includes(activeKey);

  const headlineScore = aiQuery.data?.overview?.weighted_score
    ? `${aiQuery.data.overview.weighted_score.toFixed(2)} / 5`
    : '3.55 / 5';

  const headlineIrr = record.return_irr_base != null
    ? `${record.return_irr_base}%`
    : '23.5%';

  const headlinePayback = record.return_payback_years != null
    ? `${record.return_payback_years} yrs`
    : '4.1 yrs';

  const headlineSubmitted = card.submitted_at || card.created_at
    ? new Date(card.submitted_at || card.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '28 Sept 2026';

  const ownerName = card.owner_name || (card.owner_email ? card.owner_email.split('@')[0] : 'Deal Lead A');

  return (
    <div className="p-8 max-w-[1440px] mx-auto space-y-5 bg-[#F8FAFC] min-h-screen">
      {/* Top Meta Bar */}
      <SiriusHeaderMeta company="coredge" layout="Left-to-Right" />

      {/* Main Opportunity Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {card.opportunity_name || 'Philippines market entry'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {card.owner_org_name || 'ESAL Tech'}, {card.opportunity_type || 'Joint venture & partnership'}
          </p>

          {/* Tags */}
          <div className="flex items-center gap-2 mt-2">
            <span className="bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] font-medium px-2.5 py-0.5 rounded-full text-xs">
              {card.state_label || 'Screening review'}
            </span>
            <span className="bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] font-medium px-2.5 py-0.5 rounded-full text-xs">
              {card.sla_breached ? 'SLA Breached' : 'on Track'}
            </span>
          </div>
        </div>

        {/* Back Button */}
        <button
          type="button"
          onClick={() => navigate(createPageUrl('MyWork'))}
          className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      </div>

      {/* Stats & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="bg-[#FEF3C7] text-[#92400E] font-semibold px-2 py-0.5 rounded text-xs">
            AI &nbsp; Conditional Go
          </span>
          <span className="text-slate-500">
            Score <strong className="text-slate-900 font-bold ml-1">{headlineScore}</strong>
          </span>
          <span className="text-slate-500">
            IRR <strong className="text-slate-900 font-bold ml-1">{headlineIrr}</strong>
          </span>
          <span className="text-slate-500">
            Payback <strong className="text-slate-900 font-bold ml-1">{headlinePayback}</strong>
          </span>
          <span className="text-slate-500">
            Questions open <strong className="text-slate-900 font-bold ml-1">{card.open_questions ?? 0}</strong>
          </span>
          <span className="text-slate-500">
            Owner <strong className="text-slate-900 font-bold ml-1">{ownerName}</strong>
          </span>
          <span className="text-slate-500">
            Submitted <strong className="text-slate-900 font-bold ml-1">{headlineSubmitted}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveKey('documents')}
            className={`border bg-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors ${
              activeKey === 'documents'
                ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                : 'border-slate-300 hover:bg-slate-50 text-slate-800'
            }`}
          >
            Documents
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={handleDownloadMemo}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Download Memo
          </button>
        </div>
      </div>

      {/* 9-Tab Navigation Bar */}
      <div className="flex w-full overflow-x-auto border-b border-slate-200 gap-6 text-xs no-scrollbar">
        {TABS.map((tab) => {
          const isActive = activeKey === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveKey(tab.key)}
              className={`pb-3 font-medium whitespace-nowrap transition-colors border-b-2 ${
                isActive
                  ? 'border-blue-600 text-blue-600 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Two Column Workspace Grid */}
      <div className={`grid gap-6 items-start ${isSectionTab ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_390px]' : 'grid-cols-1'}`}>
        {/* Left Column */}
        <div className="min-w-0">
          {activeKey === 'executive_summary' && <SiriusExecutiveSummary record={record} />}
          {activeKey === 'opportunity_overview' && <SiriusOpportunityOverview record={record} />}
          {activeKey === 'rationale' && <SiriusRationaleAndFit record={record} />}
          {activeKey === 'financials' && <SiriusFinancialsAndReturns record={record} gate={gate} />}
          {activeKey === 'funding' && <SiriusFundingAndKeyAsks record={record} gate={gate} />}
          {activeKey === 'risks' && <SiriusRisksAndCompliance record={record} gate={gate} />}
          {activeKey === 'scorecard' && <SiriusScorecard card={card} />}
          {activeKey === 'documents' && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
              <ReviewSections tab={activeTabObject} groups={groups} record={record} gate={gate} documents={documents} />
            </div>
          )}

          {activeKey === 'decision' && <SiriusDecisionTab card={card} />}

          {activeKey === 'audit' && <SiriusAuditTrail card={card} />}
        </div>

        {/* Right Column (Side Panels) */}
        {isSectionTab && (
          <aside className="space-y-4">
            <SiriusAIValidationCard
              tabKey={activeKey}
              result={aiQuery.data?.results?.[activeKey]?.validation}
              loading={aiQuery.isLoading}
              running={rerun.isPending && rerun.variables === activeKey}
              onRerun={() => rerun.mutate(activeKey)}
            />
            <SiriusAIAnalysisCard
              tabKey={activeKey}
              result={aiQuery.data?.results?.[activeKey]?.analysis}
              loading={aiQuery.isLoading}
              running={analyse.isPending && analyse.variables === activeKey}
              onRun={() => analyse.mutate(activeKey)}
            />
            <SiriusQACard
              opportunityId={id}
              sectionKey={activeKey}
              showSampleThread={activeKey === 'executive_summary'}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
