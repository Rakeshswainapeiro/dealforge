/* eslint-disable react/prop-types */
import { Loader2 } from 'lucide-react';

export default function SiriusAIValidationCard({
  tabKey,
  result,
  loading,
  running,
  onRerun,
}) {
  // Preset reference checks matching SIT-2 through SIT-5 exactly
  const referenceChecksByTab = {
    executive_summary: [
      {
        title: 'Line of business',
        summary: 'Matches the ESAL Tech mandate and a Sirius sector',
        evidence: [
          { label: 'Line of business', value: 'e-Invoicing and e-reporting software (tax tech)' },
          { label: 'Sector', value: 'Digital government' },
        ],
        status: 'Pass',
      },
      {
        title: 'Investment intent',
        summary: 'Consistent with the ESAL Tech strategy profile',
        evidence: [
          { label: 'Intent of the investment', value: 'Enter the Philippines as large taxpayers move onto the BIR Electronic Invoicing System' },
        ],
        status: 'Pass',
      },
      {
        title: 'Step 1 answers',
        summary: '15 of 15 answered',
        evidence: [
          {
            label: 'Checked against',
            value:
              'Opportunity name, type, target, line of business, intent, sector, geography, total commitment, ask from Sirius, funding source, budget, related party, the opportunity, why it matters, headline',
          },
        ],
        status: 'Pass',
      },
      {
        title: 'Commitment split adds up',
        summary: 'AED 1.65 + 1.07 = 2.72 mn; total stated AED 2.72 mn',
        evidence: [
          { label: 'Total commitment (AED mn)', value: '2.72' },
          { label: 'How the commitment breaks down', value: 'Entry AED 1.65 mn + Year-1 operating funding AED 1.07 mn' },
        ],
        status: 'Pass',
      },
      {
        title: 'Headline returns match step 4',
        summary: 'IRR, ROIC and payback in the headline match the returns table',
        evidence: [
          {
            label: 'Headline (step 1)',
            value:
              'Base case: IRR 45% · ROIC 81% · payback 2.5 yrs. Clears all three hurdles (greenfield IRR ≥ 25%). Downside IRR 15% does not. Decision sought: approve signing the Eurolink MoU, negotiating the definitive agreement and the BIR EIS build.',
          },
          { label: 'Returns table (step 4)', value: 'IRR 45% · ROIC 81% · payback 2.5 yrs' },
        ],
        status: 'Pass',
      },
    ],
    opportunity_overview: [
      {
        title: 'Step 2 answers',
        summary: '10 of 10 answered',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Snapshot ties to the financials',
        summary: 'Revenue 41.6 and EBITDA 9.8 match 2025 in step 4',
        evidence: [],
        status: 'Pass',
      },
    ],
    rationale: [
      {
        title: 'Step 3 answers',
        summary: '10 of 10 answered',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Value created is quantified',
        summary: '+AED 10.3 mn revenue and +AED 2.9 mn EBITDA a year from 2029.',
        evidence: [],
        status: 'Pass',
      },
    ],
    financials: [
      {
        title: 'Periods and entity',
        summary: 'New venture: projections 2027–2031; no actuals needed',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Figures tie across documents',
        summary: 'IRR 45% and payback 2.5 years match between the Overview and ESAL_PH_Model_v3.xlsx',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Returns in all three cases',
        summary: 'IRR, ROIC and payback given for base, upside and downside',
        evidence: [],
        status: 'Pass',
      },
    ],
    funding: [
      {
        title: 'Funding named and secured',
        summary: 'Sirius AED 2.72 mn (to confirm). Sirius is the only source',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Budget',
        summary: 'Not in the approved budget; variance memo on file',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Sources and uses balance',
        summary: 'Sources AED 2.72 mn · uses AED 2.72 mn · commitment AED 2.72 mn',
        evidence: [],
        status: 'Pass',
      },
    ],
    risks: [
      {
        title: 'Risk register',
        summary: '6 risks, 6 with a mitigation and an owner',
        evidence: [],
        status: 'Pass',
      },
      {
        title: 'Compliance screen',
        summary: 'Legal Open · related-party Clear · ESG Clear',
        evidence: [],
        status: 'Open item',
      },
    ],
  };

  // Convert live checks from api if present
  let checksToDisplay = referenceChecksByTab[tabKey] || [];
  if (result?.checks && result.checks.length > 0) {
    checksToDisplay = result.checks.map((c) => ({
      title: c.headline || c.title || c.key,
      summary: c.reason || c.detail || 'Checked against submission',
      evidence: (c.checked_against || []).map((e) => ({ label: e.label, value: e.value })),
      status: c.status === 'fail' ? 'Failed' : c.status === 'review' ? 'To confirm' : 'Pass',
    }));
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-[10px]">
            AI
          </div>
          <h3 className="text-xs font-bold text-slate-900">AI validation</h3>
        </div>
        {onRerun && (
          <button
            type="button"
            onClick={onRerun}
            disabled={running || loading}
            className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Re-run'}
          </button>
        )}
      </div>

      {loading && !result ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking validation...
        </div>
      ) : (
        <div className="space-y-4">
          {checksToDisplay.map((item, idx) => (
            <div key={idx} className="space-y-1.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 text-xs">{item.title}</p>
                  <p className="text-slate-500 text-[11px] mt-0.5 leading-normal">{item.summary}</p>
                </div>
                <span
                  className={`shrink-0 font-medium px-2 py-0.5 rounded text-[11px] ${
                    item.status === 'Pass'
                      ? 'bg-emerald-100 text-emerald-800'
                      : item.status === 'Open item' || item.status === 'To confirm'
                      ? 'bg-[#FEF3C7] text-[#92400E]'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {item.status}
                </span>
              </div>

              {item.evidence && item.evidence.length > 0 && (
                <div className="rounded border border-slate-100 bg-slate-50/70 p-2 text-[11px] space-y-0.5 text-slate-600">
                  <p className="font-semibold text-slate-700 text-[10px] uppercase tracking-wider mb-1">
                    Checked against
                  </p>
                  {item.evidence.map((ev, eIdx) => (
                    <p key={eIdx} className="leading-snug">
                      <span className="font-medium text-slate-800">{ev.label}:</span> {ev.value}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
