import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';
import SiriusHeaderMeta from './SiriusHeaderMeta';
import { Loader2 } from 'lucide-react';

function formatSlaDifference(slaDueAt) {
  if (!slaDueAt) return { text: '0 h left', isOver: false };
  const ms = new Date(slaDueAt).getTime() - Date.now();
  const hours = Math.round(Math.abs(ms) / 3600000);
  if (ms < 0) {
    return { text: `${hours} h over`, isOver: true };
  }
  return { text: `${hours} h left`, isOver: false };
}

export default function SiriusMyWork() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pipeline', 'my-work'],
    queryFn: () => api.pipeline.myWork(),
    refetchInterval: 60000,
  });

  // SIT-1 reference sample questions if none returned by backend
  const fallbackQuestions = useMemo(() => [
    {
      id: 'q-1',
      type: 'New reply',
      opportunity_name: 'Kestrel acquisition',
      entity_name: 'Orbis Grid Technologies',
      about: 'Receivable days of 118: seasonal?',
      from: 'A. Haddad',
      when: 'Replied 30 Sept',
    },
    {
      id: 'q-2',
      type: 'New reply',
      opportunity_name: 'Fleet telematics JV, Kenya',
      entity_name: 'Subsidiary D1',
      about: 'Valuation: basis for the entry multiple',
      from: 'A. Haddad',
      when: 'Replied 30 Sept',
    },
    {
      id: 'q-3',
      type: 'Waiting for reply',
      opportunity_name: 'Diagnostic lab network',
      entity_name: 'Subsidiary G2',
      about: 'Growth assumption: why 25% a year?',
      from: 'You',
      when: 'Due 1 Oct',
    },
    {
      id: 'q-4',
      type: 'Waiting for reply',
      opportunity_name: 'Diagnostic lab network',
      entity_name: 'Subsidiary G2',
      about: 'Receivable days of 118: seasonal?',
      from: 'A. Haddad',
      when: 'Replied 30 Sept',
    },
  ], []);

  // SIT-1 reference sample opportunities if none returned
  const fallbackAssigned = useMemo(() => [
    {
      id: '1',
      ref: '1',
      opportunity_name: 'Digital ID partnership',
      entity: 'Subsidiary C1',
      state: 'Information requested',
      next_action: 'Chase the subsidiary',
      sla_text: '28 h over',
      sla_over: true,
    },
    {
      id: '2',
      ref: '2',
      opportunity_name: 'Medical imaging AI, Oman',
      entity: 'Subsidiary C2',
      state: 'AI research & memo',
      next_action: 'Review the automated screening',
      sla_text: '1 h over',
      sla_over: true,
    },
    {
      id: '3',
      ref: '3',
      opportunity_name: 'Airport baggage analytics',
      entity: 'Subsidiary C3',
      state: 'Information requested',
      next_action: 'Review the automated screening',
      sla_text: '0 h left',
      sla_over: false,
    },
    {
      id: '4',
      ref: '4',
      opportunity_name: 'Tax-tech acquisition, Egypt',
      entity: 'Subsidiary C4',
      state: 'Screening review',
      next_action: 'Review the automated screening',
      sla_text: '0 h left',
      sla_over: false,
    },
    {
      id: '5',
      ref: '5',
      opportunity_name: 'Clinical trials data JV',
      entity: 'Subsidiary C5',
      state: 'Screening review',
      next_action: 'Review the automated screening',
      sla_text: '0 h left',
      sla_over: false,
    },
  ], []);

  // Actionable questions list
  const questionsList = useMemo(() => {
    if (data?.questions && data.questions.length > 0) {
      return data.questions.map((q) => {
        const isAnswered = q.display_status === 'answered';
        return {
          id: q.id,
          type: isAnswered ? 'New reply' : 'Waiting for reply',
          opportunity_name: q.opportunity_name || 'Opportunity',
          entity_name: q.owner_org_name || q.subsidiary_name || 'Subsidiary',
          about: q.subject || 'Question thread',
          from: q.author_name || (q.last_author_email ? q.last_author_email.split('@')[0] : 'Reviewer'),
          when: q.last_activity_at ? `Replied ${new Date(q.last_activity_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Recent',
        };
      });
    }
    return fallbackQuestions;
  }, [data?.questions, fallbackQuestions]);

  // Combined assigned opportunities list
  const assignedList = useMemo(() => {
    const rawList = (data?.assigned && data.assigned.length > 0)
      ? data.assigned
      : (data?.can_act && data.can_act.length > 0)
      ? data.can_act
      : null;

    if (rawList && rawList.length > 0) {
      return rawList.map((opp, idx) => {
        const slaInfo = formatSlaDifference(opp.sla_due_at);
        const stateLabel = opp.state_label || (opp.state === 'information_requested' ? 'Information requested' : opp.state === 'screening_review' ? 'Screening review' : opp.state);
        let nextAction = 'Review the automated screening';
        if (opp.state === 'information_requested') {
          nextAction = 'Chase the subsidiary';
        }
        return {
          id: opp.id,
          ref: String(idx + 1),
          opportunity_name: opp.opportunity_name,
          entity: opp.owner_org_name || opp.target_name || `Subsidiary C${idx + 1}`,
          state: stateLabel,
          next_action: nextAction,
          sla_text: slaInfo.text,
          sla_over: slaInfo.isOver,
        };
      });
    }
    return fallbackAssigned;
  }, [data?.assigned, data?.can_act, fallbackAssigned]);

  // Filtered by search input
  const filteredAssigned = useMemo(() => {
    if (!searchTerm.trim()) return assignedList;
    const query = searchTerm.toLowerCase();
    return assignedList.filter((item) =>
      item.opportunity_name.toLowerCase().includes(query) ||
      item.entity.toLowerCase().includes(query) ||
      item.ref.toLowerCase().includes(query) ||
      item.state.toLowerCase().includes(query)
    );
  }, [assignedList, searchTerm]);

  const counts = {
    assigned: data?.counts?.assigned ?? 8,
    can_act: data?.counts?.can_act ?? 2,
    questions: data?.counts?.questions ?? 4,
    past_sla: data?.counts?.breached ?? 2,
    subsidiaryWaiting: data?.counts?.subsidiary ?? 18,
  };

  const handleOpenQuestions = () => {
    navigate(createPageUrl('QandA'));
  };

  const handleReplyQuestion = (questionId) => {
    navigate(`${createPageUrl('QandA')}?thread=${questionId}`);
  };

  const handleOpenOpportunity = (opportunityId) => {
    navigate(`${createPageUrl('Opportunity')}?id=${opportunityId}`);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center p-6 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading your work...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error?.message || 'Could not load your work. Please refresh.'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1440px] mx-auto space-y-6 bg-[#F8FAFC] min-h-screen">
      {/* Top Meta Bar */}
      <SiriusHeaderMeta company="coredge" layout="Left-to-Right" />

      {/* Page Title & Subtitle */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My work</h1>
        <p className="text-xs text-slate-500 mt-1">
          The opportunities assigned to you, with what to do next and how long you have.
        </p>
      </div>

      {/* Card 1: Needs Your Action */}
      <div className="rounded-xl border border-amber-300 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#B45309]">Needs your action</h2>
              <span className="bg-[#92400E] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {questionsList.length || 9}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {counts.subsidiaryWaiting} waiting for the subsidiary. A case stays in Information requested until every question is answered.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenQuestions}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            Open all questions
          </button>
        </div>

        {/* Action Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-medium">
                <th className="text-left py-2 font-medium w-36">Type</th>
                <th className="text-left py-2 font-medium w-64">Opportunity</th>
                <th className="text-left py-2 font-medium">About</th>
                <th className="text-left py-2 font-medium w-32">From</th>
                <th className="text-left py-2 font-medium w-32">When</th>
                <th className="text-right py-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {questionsList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 pr-2">
                    {item.type === 'New reply' ? (
                      <span className="inline-block bg-[#FEF3C7] text-[#92400E] font-medium px-3 py-1 rounded-full text-xs">
                        New reply
                      </span>
                    ) : (
                      <span className="inline-block bg-[#F1F5F9] text-[#475569] font-medium px-3 py-1 rounded-full text-xs">
                        Waiting for reply
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-2">
                    <p className="font-semibold text-slate-900">{item.opportunity_name}</p>
                    <p className="text-slate-400 text-[11px] mt-0.5">{item.entity_name}</p>
                  </td>
                  <td className="py-3 pr-2 text-slate-700">
                    {item.about}
                  </td>
                  <td className="py-3 pr-2 text-slate-600">
                    {item.from}
                  </td>
                  <td className="py-3 pr-2 text-slate-600">
                    {item.when}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleReplyQuestion(item.id)}
                      className="border border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold px-4 py-1 rounded-lg text-xs transition-colors"
                    >
                      Reply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row of 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-3xl font-bold text-slate-900">{counts.assigned}</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Assigned to you</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-3xl font-bold text-slate-900">{counts.can_act}</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Waiting for your decision</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-3xl font-bold text-slate-900">{counts.questions}</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Open questions with subsidiaries</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-3xl font-bold text-[#991B1B]">{counts.past_sla}</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Past SLA</p>
        </div>
      </div>

      {/* Card 2: Assigned Opportunities */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-base font-bold text-slate-900">Assigned opportunities</h2>
          <div className="relative">
            <input
              type="text"
              placeholder="Search by opportunity, target, company, owner or ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-80 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-medium">
                <th className="text-left py-2.5 font-medium w-16">Ref</th>
                <th className="text-left py-2.5 font-medium w-64">Opportunity</th>
                <th className="text-left py-2.5 font-medium w-48">Entity</th>
                <th className="text-left py-2.5 font-medium w-48">State</th>
                <th className="text-left py-2.5 font-medium">Next action</th>
                <th className="text-right py-2.5 font-medium w-32">Time against SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAssigned.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 text-slate-500">{item.ref}</td>
                  <td className="py-3 pr-2">
                    <button
                      type="button"
                      onClick={() => handleOpenOpportunity(item.id)}
                      className="font-semibold text-slate-900 hover:text-blue-600 text-left transition-colors"
                    >
                      {item.opportunity_name}
                    </button>
                  </td>
                  <td className="py-3 pr-2 text-slate-600">{item.entity}</td>
                  <td className="py-3 pr-2">
                    {item.state === 'Information requested' && (
                      <span className="inline-block bg-[#FEF3C7] text-[#92400E] font-medium px-2.5 py-0.5 rounded-full text-xs">
                        Information requested
                      </span>
                    )}
                    {item.state === 'AI research & memo' && (
                      <span className="inline-block bg-[#DBEAFE] text-[#1D4ED8] font-medium px-2.5 py-0.5 rounded-full text-xs">
                        AI research &amp; memo
                      </span>
                    )}
                    {item.state === 'Screening review' && (
                      <span className="inline-block bg-[#E0F2FE] text-[#0369A1] font-medium px-2.5 py-0.5 rounded-full text-xs">
                        Screening review
                      </span>
                    )}
                    {item.state !== 'Information requested' && item.state !== 'AI research & memo' && item.state !== 'Screening review' && (
                      <span className="inline-block bg-[#F1F5F9] text-[#475569] font-medium px-2.5 py-0.5 rounded-full text-xs">
                        {item.state}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-2 text-slate-600">{item.next_action}</td>
                  <td className="py-3 text-right">
                    <span className={item.sla_over ? 'text-red-600 font-semibold' : 'text-slate-500 font-medium'}>
                      {item.sla_text}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
