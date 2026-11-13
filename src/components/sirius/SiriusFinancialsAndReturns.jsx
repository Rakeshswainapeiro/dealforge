/* eslint-disable react/prop-types */
export default function SiriusFinancialsAndReturns({ record = {} }) {
  const headline =
    record.financials_headline ||
    'New venture: projections only (2027–2031). Base case clears all three hurdles; downside does not clear IRR.';

  // Financial summary table data
  const finRows = [
    { label: 'Revenue', actuals: ['-', '-', '-'], projections: ['0.82', '7.68', '10.27'] },
    { label: 'EBITDA', actuals: ['-', '-', '-'], projections: ['-1.07', '2.03', '2.93'] },
    { label: 'Net income', actuals: ['-', '-', '-'], projections: ['-1.4', '1.27', '1.95'] },
    { label: 'Capex', actuals: ['-', '-', '-'], projections: ['1.65', '0', '0'] },
    { label: 'Free cash flow', actuals: ['-', '-', '-'], projections: ['-2.72', '1.6', '2.28'] },
    { label: 'Net debt / EBITDA', actuals: ['-', '-', '-'], projections: ['-', '-', '-'] },
  ];

  // Returns against Hurdles
  const returnRows = [
    {
      label: 'Equity IRR (%)',
      hurdle: '≥ 25%',
      base: { val: record.return_irr_base != null ? String(record.return_irr_base) : '45', meets: true },
      upside: { val: record.return_irr_upside != null ? String(record.return_irr_upside) : '58', meets: true },
      downside: { val: record.return_irr_downside != null ? String(record.return_irr_downside) : '15', meets: false },
    },
    {
      label: 'ROIC (%)',
      hurdle: '≥ WACC + 5%',
      base: { val: record.return_roic_base != null ? String(record.return_roic_base) : '81', meets: true },
      upside: { val: record.return_roic_upside != null ? String(record.return_roic_upside) : '100', meets: true },
      downside: { val: record.return_roic_downside != null ? String(record.return_roic_downside) : '33', meets: true },
    },
    {
      label: 'Payback (years)',
      hurdle: '≤ 3.5 yrs',
      base: { val: record.return_payback_years != null ? String(record.return_payback_years) : '2.5', meets: true },
      upside: { val: record.return_payback_upside != null ? String(record.return_payback_upside) : '2.5', meets: true },
      downside: { val: record.return_payback_downside != null ? String(record.return_payback_downside) : '3.7', meets: false },
    },
  ];

  const additionalFields = [
    {
      label: 'WACC (%)',
      value: record.wacc_override_pct != null ? String(record.wacc_override_pct) : '10',
    },
    {
      label: "Share of the subsidiary's capital (%)",
      value: record.share_capital_pct || 'Not provided',
    },
    {
      label: 'Leverage (x)',
      value: record.leverage_x || 'Not provided',
    },
    {
      label: 'Entry valuation and basis',
      value:
        record.entry_valuation_basis ||
        'partnership at cost (entry investment AED 1.65 mn)',
    },
    {
      label: 'Exit or value-realisation',
      value:
        record.exit_realisation ||
        'Value held inside ESAL as recurring revenue; buy-out or exit terms to be set in the definitive agreement',
    },
    {
      label: 'Comparables',
      value: record.comparable_transactions || 'None given',
    },
  ];

  const assumptionFields = [
    {
      label: 'Base case',
      value:
        record.assumptions_base_case ||
        '5% share × 85% win rate (about 510 clients); 6-month BIR build before billing; ARPU USD 6.3k Year 1, 5.1k recurring; 70% gross margin; sales, service and partner share 35% of revenue (MoU sets no revenue share yet); fixed opex USD 180k; 8% churn.',
    },
    {
      label: 'Upside and downside',
      value:
        record.assumptions_upside_downside ||
        '20% share (capped at 240 signings a year) / demand × 54% chance the mandate lands as planned.',
    },
  ];

  const crossBorderFields = [
    {
      label: 'FX exposure',
      value: record.cross_border_fx || 'PHP/USD FX risk on revenue; bill in USD where possible.',
    },
    {
      label: 'Withholding tax',
      value: record.cross_border_wht || 'Withholding tax to confirm.',
    },
    {
      label: 'Transfer pricing',
      value: record.cross_border_transfer_pricing || 'Partner revenue share and transfer pricing to confirm.',
    },
    {
      label: 'Repatriation',
      value: record.cross_border_repatriation || 'Cash repatriation from the Philippines to confirm.',
    },
    {
      label: 'Tax rate applied',
      value: record.tax_rate_applied || '25% applied',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      <h2 className="text-base font-bold text-slate-900 tracking-tight">4. Financials and returns</h2>

      {/* Blue Callout Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 text-xs font-semibold text-[#1D4ED8]">
        {headline}
      </div>

      {/* Financial Summary Grid */}
      <div className="space-y-2 overflow-x-auto">
        <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="py-2.5 px-3 text-left font-semibold text-slate-700 w-44">AED mn</th>
              <th colSpan={3} className="py-2.5 px-3 text-center font-semibold text-slate-700 border-l border-r border-slate-200">
                Actual · audited
              </th>
              <th colSpan={3} className="py-2.5 px-3 text-center font-semibold text-blue-600">
                Projections
              </th>
            </tr>
            <tr className="border-b border-slate-200 text-slate-500 font-medium bg-slate-50/30">
              <th className="py-2 px-3 text-left font-medium"></th>
              <th className="py-2 px-3 text-center font-medium border-l border-slate-100">FY2024</th>
              <th className="py-2 px-3 text-center font-medium">FY2025</th>
              <th className="py-2 px-3 text-center font-medium border-r border-slate-200">FY2026</th>
              <th className="py-2 px-3 text-center font-medium">FY2027</th>
              <th className="py-2 px-3 text-center font-medium">FY2028</th>
              <th className="py-2 px-3 text-center font-medium">FY2029</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {finRows.map((r, idx) => (
              <tr key={idx} className="hover:bg-slate-50/50">
                <td className="py-2.5 px-3 font-semibold text-slate-900">{r.label}</td>
                <td className="py-2.5 px-3 text-center border-l border-slate-100">{r.actuals[0]}</td>
                <td className="py-2.5 px-3 text-center">{r.actuals[1]}</td>
                <td className="py-2.5 px-3 text-center border-r border-slate-200">{r.actuals[2]}</td>
                <td className="py-2.5 px-3 text-center">{r.projections[0]}</td>
                <td className="py-2.5 px-3 text-center">{r.projections[1]}</td>
                <td className="py-2.5 px-3 text-center">{r.projections[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Returns against Hurdles */}
      <div className="space-y-3 pt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-900 font-bold border-b border-slate-100">
                <th className="py-2 text-left font-bold w-44">Returns</th>
                <th className="py-2 text-left font-bold w-36">Hurdle</th>
                <th className="py-2 text-center font-bold w-28">Base</th>
                <th className="py-2 text-center font-bold w-28">Upside</th>
                <th className="py-2 text-center font-bold w-28">Downside</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {returnRows.map((r, idx) => (
                <tr key={idx} className="py-3">
                  <td className="py-3 font-semibold text-slate-900">{r.label}</td>
                  <td className="py-3 text-slate-700">{r.hurdle}</td>
                  <td className="py-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <div className="border border-slate-200 rounded px-3 py-1 text-xs text-slate-900 bg-white font-medium min-w-[50px] text-center shadow-sm">
                        {r.base.val}
                      </div>
                      <span className="text-[10px] text-emerald-700 font-semibold mt-1">Meets</span>
                    </div>
                  </td>
                  <td className="py-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <div className="border border-slate-200 rounded px-3 py-1 text-xs text-slate-900 bg-white font-medium min-w-[50px] text-center shadow-sm">
                        {r.upside.val}
                      </div>
                      <span className="text-[10px] text-emerald-700 font-semibold mt-1">Meets</span>
                    </div>
                  </td>
                  <td className="py-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <div className="border border-slate-200 rounded px-3 py-1 text-xs text-slate-900 bg-white font-medium min-w-[50px] text-center shadow-sm">
                        {r.downside.val}
                      </div>
                      <span className={`text-[10px] font-semibold mt-1 ${r.downside.meets ? 'text-emerald-700' : 'text-red-700'}`}>
                        {r.downside.meets ? 'Meets' : 'Does not meet'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MOIC */}
      <div className="pt-2">
        <p className="font-semibold text-slate-900 text-xs">MOIC (x), where relevant</p>
      </div>

      {/* Additional Fields */}
      <div className="divide-y divide-slate-100 text-xs border-t border-slate-100 pt-2">
        {additionalFields.map((f, idx) => (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
            <span className="text-slate-500 font-normal">{f.label}</span>
            <span className="text-slate-900 font-normal leading-relaxed">{f.value}</span>
          </div>
        ))}
      </div>

      {/* Assumptions and scenarios */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Assumptions and scenarios</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {assumptionFields.map((f, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
              <span className="text-slate-500 font-normal">{f.label}</span>
              <span className="text-slate-900 font-normal leading-relaxed">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cross-border */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Cross-border</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {crossBorderFields.map((f, idx) => (
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
