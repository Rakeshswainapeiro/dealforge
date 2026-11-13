/* eslint-disable react/prop-types */

export default function SiriusOpportunityOverview({ record = {} }) {
  const headline =
    record.opportunity_overview_headline ||
    'Kestrel is the only local specialist already integrated with Orbis meters.';

  const inBriefFields = [
    {
      label: 'What',
      value:
        record.overview_what ||
        record.narrative_what ||
        'Kestrel Metering Analytics: meter-data analytics software for electricity and water utilities. 68% recurring revenue, 34% annual growth.',
    },
    {
      label: 'Where',
      value:
        record.overview_where ||
        record.geography ||
        'Kenya (national utility and two county water utilities), pilot in Uganda, pipeline of two utilities in Tanzania.',
    },
    {
      label: 'Deal shape',
      value:
        record.overview_deal_shape ||
        'Acquisition of a 60% stake with 3 of 5 board seats. Founder keeps 40% with tag-along rights.',
    },
    {
      label: 'Status',
      value:
        record.overview_status ||
        'Term sheet agreed. Signing Feb 2027, close May 2027, subject to Sirius approval.',
    },
    {
      label: 'Pricing or commercial terms',
      value:
        record.overview_pricing_terms ||
        'AED 120 mn for 60%, plus an earn-out of up to AED 32 mn in 2028 tied to FY2027 recurring revenue.',
    },
    {
      label: 'The opportunity in brief',
      value:
        record.overview_brief ||
        'Per-meter analytics subscription. Kenya national utility and two county utilities; pilot in Uganda. 60% from founder and angels; earn-out up to AED 32mn.',
    },
  ];

  const whyCompanyFields = [
    {
      label: 'Strategic objective',
      value:
        record.strategic_objective ||
        'Add a software layer to Orbis meters and enter East Africa.',
    },
    {
      label: 'What it adds',
      value:
        record.why_what_it_adds ||
        'Revenue of AED 41.6 mn in FY2025; cross-sell to Orbis GCC clients worth AED 9 mn by Year 3.',
    },
    {
      label: 'Build, buy or partner, and why',
      value:
        record.build_buy_partner ||
        'Buy: Kestrel already has a working integration with Orbis meters (5,000-meter pilot, 2025). Building would take 3 years.',
    },
    {
      label: 'Cost of not doing it',
      value:
        record.cost_of_not_doing ||
        'The 2027 national analytics tender. A tender win would raise the price; a competitor could buy Kestrel first.',
    },
    {
      label: 'What it re-uses',
      value:
        record.why_what_it_reuses ||
        'Orbis meters, GCC client base and field teams.',
    },
    {
      label: 'Why your company wants to do this',
      value:
        record.why_company_wants ||
        'Move Orbis from one-off meter sales to meters plus recurring analytics. Building in-house would take 3 years and AED 45mn.',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      <h2 className="text-base font-bold text-slate-900 tracking-tight">2. Opportunity overview</h2>

      {/* Blue Callout Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 text-xs font-semibold text-[#1D4ED8]">
        {headline}
      </div>

      {/* The opportunity in brief */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-900">The opportunity in brief</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {inBriefFields.map((f, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
              <span className="text-slate-500 font-normal">{f.label}</span>
              <span className="text-slate-900 font-normal leading-relaxed">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Why your company wants to do this */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Why your company wants to do this</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {whyCompanyFields.map((f, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
              <span className="text-slate-500 font-normal">{f.label}</span>
              <span className="text-slate-900 font-normal leading-relaxed">{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
