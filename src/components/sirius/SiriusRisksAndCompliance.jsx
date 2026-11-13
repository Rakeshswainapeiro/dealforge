/* eslint-disable react/prop-types */

export default function SiriusRisksAndCompliance({ record = {}, gate = {} }) {
  const headline =
    record.risks_headline ||
    'Main risks are BIR timing, certification and closing the definitive agreement; each is tied to staged spend.';

  // Risks register rows
  const riskRows = gate?.risks?.length
    ? gate.risks
    : [
        {
          num: 1,
          risk: 'BIR EIS timeline or scope slips',
          category: 'Regulatory',
          likelihood: 'Medium',
          impact: 'High',
          mitigation: 'Stage spend to BIR milestones',
          owner: 'CEO',
        },
        {
          num: 2,
          risk: 'BIR certification takes longer',
          category: 'Technical',
          likelihood: 'Medium',
          impact: 'High',
          mitigation: 'Start sandbox early; dedicated build squad',
          owner: 'CTO / Operations Lead',
        },
        {
          num: 3,
          risk: 'Definitive agreement not concluded (MoU can end on 30 days\u2019 notice)',
          category: 'Partner',
          likelihood: 'Medium',
          impact: 'High',
          mitigation: 'Agree term sheet early; milestones and exit terms in agreement',
          owner: 'Head of Partnerships',
        },
        {
          num: 4,
          risk: 'Exclusivity limits other partners (1 yr + 6-month non-circumvention)',
          category: 'Contractual',
          likelihood: 'Medium',
          impact: 'Medium',
          mitigation: 'Performance targets and step-out rights in definitive agreement',
          owner: 'Head of Partnerships',
        },
        {
          num: 5,
          risk: 'Low realisable revenue (VAT compliance about 70%) and price competition',
          category: 'Commercial',
          likelihood: 'Medium',
          impact: 'Medium',
          mitigation: 'Focus on large taxpayers; competitive pricing',
          owner: 'Head of Sales',
        },
        {
          num: 6,
          risk: 'FX and cash repatriation (PHP)',
          category: 'Financial',
          likelihood: 'Medium',
          impact: 'Medium',
          mitigation: 'Bill in USD where possible; WHT / TP advice',
          owner: 'CFO',
        },
      ];

  // Compliance screen rows
  const complianceRows = [
    {
      screen: 'Legal and regulatory',
      status: 'Open',
      comment: 'MoU to be signed by Oxinus; definitive agreement and BIR certification pending.',
    },
    {
      screen: 'Related-party',
      status: 'Clear',
      comment: 'Eurolink is a third party',
    },
    {
      screen: 'ESG and reputational',
      status: 'Clear',
      comment: 'MoU includes anti-bribery and data-privacy commitments.',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      {/* Title */}
      <h2 className="text-base font-bold text-slate-900 tracking-tight">6. Risks and compliance</h2>

      {/* Blue Headline Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 text-xs font-semibold text-[#1D4ED8]">
        {headline}
      </div>

      {/* Risk Register Table */}
      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
              <th className="py-2.5 px-3 text-left w-8">#</th>
              <th className="py-2.5 px-3 text-left">Risk</th>
              <th className="py-2.5 px-3 text-left">Risk</th>
              <th className="py-2.5 px-3 text-left">Likelihood</th>
              <th className="py-2.5 px-3 text-left">Impact</th>
              <th className="py-2.5 px-3 text-left">Mitigation</th>
              <th className="py-2.5 px-3 text-left">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {riskRows.map((r) => (
              <tr key={r.num} className="hover:bg-slate-50/50">
                <td className="py-3 px-3 text-slate-500 align-top">{r.num}</td>
                <td className="py-3 px-3 font-normal text-slate-900 leading-relaxed align-top max-w-[220px]">
                  {r.risk}
                </td>
                <td className="py-3 px-3 text-slate-700 align-top">{r.category}</td>
                <td className="py-3 px-3 text-slate-700 align-top">{r.likelihood}</td>
                <td className="py-3 px-3 text-slate-700 align-top">{r.impact}</td>
                <td className="py-3 px-3 text-slate-700 leading-relaxed align-top max-w-[200px]">
                  {r.mitigation}
                </td>
                <td className="py-3 px-3 text-slate-700 align-top">{r.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Section: Compliance screen */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Compliance screen</h3>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                <th className="py-2.5 px-4 text-left">Screen</th>
                <th className="py-2.5 px-4 text-left w-28">Status</th>
                <th className="py-2.5 px-4 text-left">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {complianceRows.map((c, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-2.5 px-4 font-semibold text-slate-900">{c.screen}</td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {c.status}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 leading-relaxed">{c.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
