/* eslint-disable react/prop-types */

export default function SiriusRationaleAndFit({ record = {} }) {
  const headline =
    record.rationale_headline ||
    'A large mandated market with clear timing; the partner model gives speed and limits capital at risk.';

  const inBriefFields = [
    {
      label: 'Why this?',
      value:
        record.rationale_evidence ||
        'Large mandated market: about 20,700 enterprises in scope. Clearance-style model needs a certified, integrated provider. Recurring subscription revenue at about 70% gross margin. Market 2027: TAM USD 166 mn; enterprise SAM USD 85 mn.',
    },
    {
      label: 'Why now?',
      value:
        record.narrative_why_now ||
        'Phase-1 deadline 31 Dec 2026; firms must be ready from Jan 2027. EIS build-out runs through 2027, so early certified providers win. Eurolink MoU finalised; signing by Oxinus due Oct 2026. Model confidence MEDIUM: 54% chance the mandate lands as dated.',
    },
    {
      label: 'Why us?',
      value:
        record.narrative_why_us ||
        'Proven provider with live UAE clients. Verinvo built for multi-country formats. Eurolink brings local relationships we can\'t build quickly alone. Model rates the Philippines VIABLE with positive expected cash.',
    },
  ];

  const strategicFitFields = [
    {
      label: 'core mandate',
      value:
        record.strategy_link ||
        'Tax-tech provider; same service, new region.',
    },
    {
      label: 'What it adds',
      value:
        record.fit_what_it_adds ||
        'First step into ASEAN; Singapore a natural follow-on.',
    },
    {
      label: 'Build, buy or partner, and why',
      value:
        record.fit_build_buy_partner ||
        'Diversifies away from GCC-only revenue.',
    },
    {
      label: 'capability',
      value:
        record.fit_capability ||
        'Builds clearance-model know-how reusable in KSA, Poland and Italy.',
    },
  ];

  const valueCreatedFields = [
    {
      label: 'Value to your company',
      value:
        record.value_to_company ||
        '+AED 10.3 mn revenue and +AED 2.9 mn EBITDA a year from 2029.',
    },
    {
      label: 'Value to the Sirius portfolio',
      value:
        record.value_to_sirius ||
        'Entry into ASEAN tax tech with limited capital at risk; option to scale regionally; raises platform exit value.',
    },
    {
      label: 'Capital at risk',
      value:
        record.capital_at_risk ||
        'AED 2.72 mn peak; under the MoU each party bears its own costs.',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      <h2 className="text-base font-bold text-slate-900 tracking-tight">3. Rationale and fit</h2>

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

      {/* Strategic fit */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Strategic fit</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {strategicFitFields.map((f, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
              <span className="text-slate-500 font-normal">{f.label}</span>
              <span className="text-slate-900 font-normal leading-relaxed">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Value created at two levels */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Value created at two levels</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {valueCreatedFields.map((f, idx) => (
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
