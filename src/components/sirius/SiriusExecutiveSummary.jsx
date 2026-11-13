/* eslint-disable react/prop-types */

export default function SiriusExecutiveSummary({ record = {} }) {
  const headline =
    record.exec_summary_headline_value ||
    'Buy 60% of Kestrel to add software to Orbis meters and enter East Africa.';

  const fields = [
    {
      label: 'Opportunity type',
      value: record.opportunity_type || 'Strategic acquisition',
    },
    {
      label: 'Sourcing channel',
      value: record.sourcing_channel || 'Portfolio company bolt-on',
    },
    {
      label: 'Target or counterparty',
      value: record.target_name || 'Kestrel Metering Analytics Ltd',
    },
    {
      label: 'Sector',
      value: record.sector || 'Energy digitalisation',
    },
    {
      label: 'Line of business',
      value: record.line_of_business || 'Utility data analytics (SaaS)',
    },
    {
      label: 'Intent of the investment',
      value: record.investment_intent || 'Add a software layer to Orbis hardware and enter East Africa',
    },
    {
      label: 'Country or geography',
      value: record.geography || 'Kenya, East Africa',
    },
    {
      label: 'Total commitment (AED mn)',
      value: record.total_commitment_aed != null ? String(record.total_commitment_aed) : '182',
    },
    {
      label: 'Ask from Sirius',
      value: record.ask_sirius || (record.ask_aed != null ? `Approval to proceed to signing · AED ${record.ask_aed}mn equity` : 'Approval to proceed to signing · AED 90mn equity'),
    },
    {
      label: 'Funding source',
      value: record.funding_source || 'Orbis accruals AED 62mn (secured) · Orbis debt AED 30mn (committed) · Sirius AED 90mn',
    },
    {
      label: 'In the approved budget?',
      value: record.in_approved_budget === true ? 'Yes' : 'No',
    },
    {
      label: 'Target signing or close',
      value: record.target_signing_close || '2027-02',
    },
    {
      label: 'Is an IHC-affiliated or other related party involved?',
      value: record.related_party_disclosure ? 'Yes' : 'No',
    },
    {
      label: 'Budget reference',
      value: record.budget_line_reference || record.budget_reference || 'Variance memo VM-2026-014, approved by the Orbis board',
    },
    {
      label: 'The opportunity',
      value: record.narrative_what || 'Orbis acquires 60% of Kestrel Metering Analytics, a Nairobi software company that turns smart-meter data into revenue protection, load forecasting and billing-quality tools for utilities.',
    },
    {
      label: 'Why it matters',
      value: record.why_it_matters || record.narrative_why_now || 'Adds about AED 6.2mn net earnings to Orbis by FY27 and about 2 points of EBITDA margin. Gives Sirius an East Africa platform with recurring revenue.',
    },
    {
      label: 'Headline returns and recommendation',
      value: record.headline_returns_recommendation || record.exec_summary_recommendation || 'Base IRR 23.5%, ROIC 14.6%, payback 4.1 years. Approval to proceed to signing.',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      <h2 className="text-base font-bold text-slate-900 tracking-tight">1. Executive summary</h2>

      {/* Blue Callout Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 text-xs font-semibold text-[#1D4ED8]">
        {headline}
      </div>

      {/* 2-Column Key Value Grid */}
      <div className="divide-y divide-slate-100 text-xs">
        {fields.map((f, idx) => (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
            <span className="text-slate-500 font-normal">{f.label}</span>
            <span className="text-slate-900 font-normal leading-relaxed">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
