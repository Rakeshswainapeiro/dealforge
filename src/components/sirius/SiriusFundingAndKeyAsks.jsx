/* eslint-disable react/prop-types */

export default function SiriusFundingAndKeyAsks({ record = {}, gate = {} }) {
  const headline =
    record.funding_headline ||
    'Approval to sign the MoU and negotiate the definitive agreement; funding route to be confirmed (not in FY27 budget).';

  const su = gate?.sources_uses;
  const budget = gate?.budget_status;

  // Key details
  const decisionSought =
    record.decision_sought ||
    'Approval for Oxinus to sign the Eurolink MoU, negotiate the definitive agreement and start BIR EIS certification.';
  const siriusCapitalOrGuarantee =
    record.sirius_capital_or_guarantee ||
    'AED 2.72 mn peak need in 2027: ESAL accruals or Sirius capital, to confirm.';
  const otherSupport =
    record.other_support ||
    'Sirius / IHC contacts in the Philippines; tax and transfer-pricing advice; banking.';
  const nextSteps =
    record.next_steps_timeline ||
    'Sign MoU Oct 2026 \u2192 definitive agreement Q4 2026 \u2192 BIR certification H1 2027 \u2192 billing H2 2027. Decision by Nov 2026.';

  // Funding sources rows
  const sourceRows = su?.sources?.length
    ? su.sources.map((s) => ({
        source: s.label,
        aed: s.aed != null ? s.aed : '',
        status: s.status || 'Not required',
      }))
    : [
        { source: 'Subsidiary internal accruals', aed: record.sources_internal_accruals_aed || '', status: 'Not required' },
        { source: 'Subsidiary debt', aed: record.sources_debt_aed || '', status: 'Not required' },
        { source: 'Partner or co-investor', aed: record.sources_partner_aed || '', status: 'Not required' },
        { source: 'Sirius capital (the ask)', aed: record.ask_aed || '2.72', status: 'Not required' },
      ];

  // Uses rows
  const useRows = su?.uses?.length
    ? su.uses.map((u) => ({
        use: u.label,
        aed: u.aed != null ? u.aed : '0',
      }))
    : [
        { use: 'Purchase price or capex', aed: record.uses_purchase_price_aed || '1.4' },
        { use: 'Entity, licences & legal', aed: record.uses_entity_licences_aed || '0.25' },
        { use: 'Year-1 operating loss (working capital)', aed: record.uses_working_capital_aed || '1.07' },
        { use: 'Contingency (inside entry cost)', aed: record.uses_contingency_aed || '0' },
      ];

  const inBudget =
    budget?.in_budget != null
      ? budget.in_budget
        ? 'Yes'
        : 'No'
      : record.in_approved_budget || 'No';

  const varianceJustification =
    budget?.variance_justification ||
    record.variance_justification ||
    'Not in the FY27 budget; variance approval needed';

  const guarantees =
    record.guarantees_commitments ||
    'None under the MoU; no shared cost without written approval. Revenue share, exclusivity terms and liability to be set in the definitive agreement.';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm space-y-6">
      {/* Title */}
      <h2 className="text-base font-bold text-slate-900 tracking-tight">5. Funding and key asks</h2>

      {/* Blue Headline Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 text-xs font-semibold text-[#1D4ED8]">
        {headline}
      </div>

      {/* Key-Value Pairs */}
      <div className="divide-y divide-slate-100 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0">
          <span className="text-slate-500 font-normal">Decision sought</span>
          <span className="text-slate-900 font-normal leading-relaxed">{decisionSought}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3">
          <span className="text-slate-500 font-normal">Sirius capital or guarantee</span>
          <span className="text-slate-900 font-normal leading-relaxed">{siriusCapitalOrGuarantee}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3">
          <span className="text-slate-500 font-normal">Other support</span>
          <span className="text-slate-900 font-normal leading-relaxed">{otherSupport}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 last:pb-0">
          <span className="text-slate-500 font-normal">Next steps and timeline</span>
          <span className="text-slate-900 font-normal leading-relaxed">{nextSteps}</span>
        </div>
      </div>

      {/* Section: Funding sources */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Funding sources</h3>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                <th className="py-2.5 px-4 text-left">Source</th>
                <th className="py-2.5 px-4 text-left">AED mn</th>
                <th className="py-2.5 px-4 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {sourceRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-2.5 px-4 font-normal text-slate-900">{row.source}</td>
                  <td className="py-2.5 px-4 tabular-nums text-slate-700">{row.aed}</td>
                  <td className="py-2.5 px-4 text-slate-600">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section: Uses */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Uses</h3>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                <th className="py-2.5 px-4 text-left">Use</th>
                <th className="py-2.5 px-4 text-left">AED mn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {useRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-2.5 px-4 font-normal text-slate-900">{row.use}</td>
                  <td className="py-2.5 px-4 tabular-nums text-slate-700">{row.aed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section: Contingency (inside entry cost) & Budget Justification */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">Contingency (inside entry cost)</h3>
        <div className="divide-y divide-slate-100 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 first:pt-0">
            <span className="text-slate-500 font-normal">In the approved budget?</span>
            <span className="text-slate-900 font-normal">{inBudget}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3">
            <span className="text-slate-500 font-normal">Variance justification</span>
            <span className="text-slate-900 font-normal leading-relaxed">{varianceJustification}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[250px_minmax(0,1fr)] gap-2 py-3 last:pb-0">
            <span className="text-slate-500 font-normal">Guarantees and contingent commitments</span>
            <span className="text-slate-900 font-normal leading-relaxed">{guarantees}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
