/* eslint-disable react/prop-types */
import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

export default function SiriusAIAnalysisCard({
  tabKey,
  result,
  loading,
  running,
  onRun,
}) {
  const [openSections, setOpenSections] = useState({
    r1: false,
    r2: false,
    r3: false,
  });

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [softFilterScores, setSoftFilterScores] = useState({
    adjacency: '3',
    nationalPriorities: '4',
    managementOpenness: '3',
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-[10px]">
            AI
          </div>
          <h3 className="text-xs font-bold text-slate-900">AI analysis</h3>
        </div>
        {onRun && (
          <button
            type="button"
            onClick={onRun}
            disabled={running || loading}
            className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Re-run'}
          </button>
        )}
      </div>

      {loading && !result ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading analysis...
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          {/* TAB 1: EXECUTIVE SUMMARY (SIT-2) */}
          {tabKey === 'executive_summary' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 text-xs font-medium">AI recommendation</span>
                  <span className="bg-[#FEF3C7] text-[#92400E] font-semibold px-2 py-0.5 rounded text-[11px]">
                    Conditional Go
                  </span>
                </div>
                <p className="mt-2 text-xs font-medium text-slate-800">
                  Score 3.15, below the 3.5 pass bar. Proceed only if the named conditions are met.
                </p>
                <div className="mt-3 space-y-1.5 text-xs text-slate-700">
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span>Hard filters: 4 of 5 passed, sanctions to confirm by hand</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Payback 2.5 yrs (at most 3.5)</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Equity IRR 45% (at least 25%)</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>ROIC 81% (at least 15.0%)</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>No automatic disqualifier</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span>Weighted score 3.15 / 5 (bar 3.5)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OPPORTUNITY OVERVIEW (SIT-3) */}
          {tabKey === 'opportunity_overview' && (
            <div className="space-y-4">
              {/* Metrics */}
              <div className="space-y-2 border-b border-slate-100 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 text-xs">Revenue growth, plan years 1 to 3</p>
                    <p className="text-slate-400 text-[11px]">2027 to 2029 · new venture, from a small first year</p>
                  </div>
                  <span className="font-bold text-slate-900 text-xs">254% a year</span>
                </div>
                <div className="flex items-start justify-between pt-1">
                  <div>
                    <p className="font-semibold text-slate-900 text-xs">Break-even (EBITDA)</p>
                    <p className="text-slate-400 text-[11px]">Year 2 of the plan</p>
                  </div>
                  <span className="font-bold text-slate-900 text-xs">2028</span>
                </div>
              </div>

              {/* Rubric 1 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    1 &nbsp; Business &amp; market overview (local vs global)
                  </span>
                  <span className="bg-[#FEF3C7] text-[#92400E] font-medium px-2 py-0.5 rounded text-[11px]">
                    Adequate
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Kestrel is one of two specialist utility-analytics providers in East Africa, in a market where local delivery and regulatory familiarity count for more than scale.
                </p>
                <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Adequate:</span> Rated Adequate: the market size in step 2 is the subsidiary&apos;s own estimate and no independent source was found on the open web.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> An independent estimate of the market size · Named competitors in Philippines and their pricing
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> Share the study behind the market size. · Name the main competitors and how pricing compares.
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection('r1')}
                    className="text-blue-600 hover:text-blue-800 font-medium text-[11px] flex items-center gap-1 mt-1"
                  >
                    {openSections.r1 ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    More: what the AI found, what would change the rating, sources
                  </button>
                  {openSections.r1 && (
                    <div className="mt-2 space-y-1.5 text-[11px] text-slate-600">
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Independent market size</p>
                        <p>None found on the open web; only the subsidiary&apos;s figure</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Regional reach</p>
                        <p>Kampala office opened in 2024 with a pilot at a Ugandan distribution company. Pipeline includes two utilities in Tanzania. Revenue outside Kenya is still under 5%.</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Competitors</p>
                        <p>Mentioned but not named in the pack</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Pricing evidence</p>
                        <p>Price list given; no customer contract in the pack to confirm it</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">What would change the rating:</p>
                        <p>Would move up with an independent market estimate; would drop if a competitor moves first.</p>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">Opportunity Overview p.2</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">industry reports (web)</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">regulator and utility publications (web)</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">competitor websites</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Rubric 2 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    2 &nbsp; Management &amp; organisation
                  </span>
                  <span className="bg-[#FEF3C7] text-[#92400E] font-medium px-2 py-0.5 rounded text-[11px]">
                    Adequate
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  No named lead for the new market yet.
                </p>
                <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Adequate:</span> Rated Adequate because the delivery team for the new market is not yet named; the partner model leans on Eurolink Network International Corp. for local presence.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> Named lead for the new market, with CV · Who on the partner side runs sales and the regulator relationship
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> Name the country lead and share the CV. · Share the partner&apos;s team and roles.
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection('r2')}
                    className="text-blue-600 hover:text-blue-800 font-medium text-[11px] flex items-center gap-1 mt-1"
                  >
                    {openSections.r2 ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    More: what the AI found, what would change the rating, sources
                  </button>
                  {openSections.r2 && (
                    <div className="mt-2 space-y-1.5 text-[11px] text-slate-600">
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Named leaders</p>
                        <p>None named</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Registry check</p>
                        <p>Registered entity: none yet (partnership)</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Reliance on the partner</p>
                        <p>High: local presence comes from the partner</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">What would change the rating:</p>
                        <p>Would move to Strong once a named, experienced lead is in place.</p>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">company registry (web)</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">competitor websites</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Low-confidence points */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Low-confidence points</p>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="font-medium text-slate-800 text-[11px]">Market size</p>
                    <p className="text-slate-400 text-[10px]">The subsidiary&apos;s own estimate; no independent source found</p>
                  </div>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    Low
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="font-medium text-slate-800 text-[11px]">Pricing</p>
                    <p className="text-slate-400 text-[10px]">No customer contract in the pack to confirm it</p>
                  </div>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    Low
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RATIONALE AND FIT (SIT-4) */}
          {tabKey === 'rationale' && (
            <div className="space-y-4">
              {/* Rubric 1 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    1 &nbsp; Business &amp; market overview (local vs global)
                  </span>
                  <span className="bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded text-[11px]">
                    Strong
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  3 of 4 alignment dimensions fit; geography does not fully.
                </p>
                <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Adequate:</span> 3 of 4 alignment dimensions are aligned. Geography: partly.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> A reasoned exception for a geography outside the Sirius target list
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> Explain why this geography should be an exception to the Sirius target list.
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection('r1')}
                    className="text-blue-600 hover:text-blue-800 font-medium text-[11px] flex items-center gap-1 mt-1"
                  >
                    {openSections.r1 ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    More: what the AI found, what would change the rating, sources
                  </button>
                  {openSections.r1 && (
                    <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                      <div className="border border-slate-100 bg-white p-1.5 rounded">
                        <span className="font-semibold text-slate-800">Sector:</span> Aligned against the Sirius mandate
                      </div>
                      <div className="border border-slate-100 bg-white p-1.5 rounded">
                        <span className="font-semibold text-slate-800">Geography:</span> Partly against the Sirius mandate
                      </div>
                      <div className="border border-slate-100 bg-white p-1.5 rounded">
                        <span className="font-semibold text-slate-800">Strategy:</span> Aligned against the strategy profile
                      </div>
                      <div className="border border-slate-100 bg-white p-1.5 rounded">
                        <span className="font-semibold text-slate-800">Portfolio:</span> Aligned against the portfolio register
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">strategy profile</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">Sirius mandate</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Rubric 2 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    2 &nbsp; Value created for the subsidiary
                  </span>
                  <span className="bg-[#FEF3C7] text-[#92400E] font-medium px-2 py-0.5 rounded text-[11px]">
                    Adequate
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  The uplift is quantified and the capital at risk is limited.
                </p>
                <div className="bg-[#F0FDF4] border border-[#DCFCE7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Strong:</span> Rated Strong: the subsidiary puts a figure on the uplift and caps the capital at risk; the AI could not check the figure against the subsidiary&apos;s own budget.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> Subsidiary&apos;s own budget, to check the uplift
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> Share the subsidiary budget with and without this opportunity.
                </div>
              </div>

              {/* Rubric 3 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    3 &nbsp; Synergies: why this, why now
                  </span>
                  <span className="bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded text-[11px]">
                    Strong
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  The timing case is clear but uncertain.
                </p>
                <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Adequate:</span> Rated Adequate: the timing case is clear, but the subsidiary&apos;s own model gives only a 54% chance the mandate lands as dated.
                </div>
              </div>

              {/* Strategy and mandate alignment */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-900 text-xs">Strategy and mandate alignment</p>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <div>
                    <p className="font-medium text-slate-800">3 of 4 dimensions aligned</p>
                    <p className="text-slate-400 text-[10px]">Sector, Geography, Strategy, Portfolio. Not aligned: Geography</p>
                  </div>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    Partly
                  </span>
                </div>
              </div>

              {/* Soft filters: AI proposes, you confirm */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Soft filters: AI proposes, you confirm</p>
                
                <div className="space-y-1">
                  <p className="font-medium text-slate-800 text-[11px]">Adjacency to portfolio companies...</p>
                  <p className="text-slate-400 text-[10px]">
                    AI proposes 3: No Sirius portfolio company found in Philippines (portfolio register); step 3 re-uses the subsidiary&apos;s own platform, which helps but is not portfolio adjacency
                  </p>
                  <div className="flex justify-end">
                    <select
                      value={softFilterScores.adjacency}
                      onChange={(e) => setSoftFilterScores({ ...softFilterScores, adjacency: e.target.value })}
                      className="border border-slate-200 rounded px-2 py-1 text-xs bg-white text-slate-800 focus:outline-none"
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <p className="font-medium text-slate-800 text-[11px]">Alignment with UAE national priorities</p>
                  <p className="text-slate-400 text-[10px]">
                    AI proposes 4: Builds on UAE clients and takes UAE capability abroad (step 3)
                  </p>
                  <div className="flex justify-end">
                    <select
                      value={softFilterScores.nationalPriorities}
                      onChange={(e) => setSoftFilterScores({ ...softFilterScores, nationalPriorities: e.target.value })}
                      className="border border-slate-200 rounded px-2 py-1 text-xs bg-white text-slate-800 focus:outline-none"
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <p className="font-medium text-slate-800 text-[11px]">Management openness to an active investor</p>
                  <p className="text-slate-400 text-[10px]">
                    AI proposes 3: Partner-led; Sirius influence runs through the partner agreement, not a board seat
                  </p>
                  <div className="flex justify-end">
                    <select
                      value={softFilterScores.managementOpenness}
                      onChange={(e) => setSoftFilterScores({ ...softFilterScores, managementOpenness: e.target.value })}
                      className="border border-slate-200 rounded px-2 py-1 text-xs bg-white text-slate-800 focus:outline-none"
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                  </div>
                </div>

                <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-2.5 text-[11px] text-[#15803D] mt-2">
                  <p className="font-semibold">● Saved automatically.</p>
                  <p className="text-[10px] mt-0.5 text-[#166534]">
                    No changes yet; every score is the AI score. Both scores are kept in the audit trail.
                  </p>
                </div>
              </div>

              {/* Synergies and conflicts */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Synergies and conflicts</p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-800">No synergies</span>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium border border-emerald-200">
                    No conflict
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: FINANCIALS AND RETURNS (SIT-5) */}
          {tabKey === 'financials' && (
            <div className="space-y-4">
              {/* Top metrics */}
              <div className="space-y-2 border-b border-slate-100 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 text-xs">Revenue growth, plan</p>
                    <p className="text-slate-400 text-[11px]">2027 to 2031</p>
                  </div>
                  <span className="font-bold text-slate-900 text-xs">88% a year</span>
                </div>
                <div className="flex items-start justify-between pt-1">
                  <div>
                    <p className="font-semibold text-slate-900 text-xs">EBITDA margin, last plan year</p>
                    <p className="text-slate-400 text-[11px]">2031</p>
                  </div>
                  <span className="font-bold text-slate-900 text-xs">29%</span>
                </div>
                <div className="flex items-start justify-between pt-1">
                  <div>
                    <p className="font-semibold text-slate-900 text-xs">Largest cash need</p>
                    <p className="text-slate-400 text-[11px]">Cumulative free cash flow at its lowest</p>
                  </div>
                  <span className="font-bold text-slate-900 text-xs">AED 2.72 mn</span>
                </div>
              </div>

              {/* Rubric 1 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    1 &nbsp; Financial performance
                  </span>
                  <span className="bg-[#FEF3C7] text-[#92400E] font-medium px-2 py-0.5 rounded text-[11px]">
                    Adequate
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Base case clears the hurdles; the downside does not.
                </p>
                <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Adequate:</span> Base case: IRR 45% against a 25% hurdle, payback 2.5 years against 3.5. Downside IRR 15% does not clear it, so the rating stops at Adequate.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> No operating history: every figure is a plan · Monthly cash plan for the first year
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> Share the monthly cash plan for the first year. · What would you do if the downside case happens?
                </div>
              </div>

              {/* Rubric 2 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    2 &nbsp; Quality of earnings
                  </span>
                  <span className="bg-[#FEF2F2] text-[#991B1B] font-medium px-2 py-0.5 rounded text-[11px] border border-red-200">
                    Concern
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Earnings are a forecast built on a few key assumptions.
                </p>
                <div className="bg-[#FEF2F2] border border-red-100 rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Strong:</span> Rated Concern because the revenue rests on assumptions not yet tested in this market, and the downside weights demand by a 54% chance.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> Evidence for the win rate and price assumptions (letters of intent, pilot customers) · Sensitivity of returns to a 6-month delay
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> Share any customer letters of intent or pilots. · Run the returns with a 6-month delay to first billing.
                </div>
              </div>

              {/* Other hurdle checks */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Other hurdle checks</p>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="font-medium text-slate-800 text-[11px]">Concentration: at most 35% of the company&apos;s capital</p>
                    <p className="text-slate-400 text-[10px]">Share not given in step 4</p>
                  </div>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    To confirm
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="font-medium text-slate-800 text-[11px]">Leverage: at most 3x net debt / EBITDA</p>
                    <p className="text-slate-400 text-[10px]">No debt in the funding</p>
                  </div>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium border border-emerald-200">
                    Meets
                  </span>
                </div>
                <p className="text-[11px] text-amber-700 mt-1">Valuation: not applicable; entry at cost.</p>
              </div>

              {/* Cross-border points to confirm */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Cross-border points to confirm</p>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-800 text-[11px]">FX</span>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium border border-emerald-200">
                    Covered
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-800 text-[11px]">Withholding tax</span>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    To confirm
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-800 text-[11px]">Transfer pricing</span>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    To confirm
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-800 text-[11px]">Repatriation</span>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
                    To confirm
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-800 text-[11px]">Tax rate</span>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium border border-emerald-200">
                    Covered
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: FUNDING AND KEY ASKS (SIT-6) */}
          {tabKey === 'funding' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between py-1 text-[11px] border-b border-slate-100">
                <span className="text-slate-800">Sirius share of the funding</span>
                <span className="font-bold text-slate-900">100%</span>
              </div>
              <div className="flex items-center justify-between py-1 text-[11px] border-b border-slate-100">
                <span className="text-slate-800">Other sources secured or committed</span>
                <span className="text-slate-700">No other sources</span>
              </div>
              <div className="flex items-center justify-between py-1 text-[11px] border-b border-slate-100">
                <span className="text-slate-800">Guarantees or contingent payments</span>
                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-medium">
                  Pass
                </span>
              </div>
              <div className="flex items-center justify-between py-1 text-[11px]">
                <span className="text-slate-800">In the approved budget</span>
                <span className="bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 rounded text-[11px] font-medium">
                  No: variance needed
                </span>
              </div>
            </div>
          )}

          {/* TAB 6: RISKS AND COMPLIANCE (SIT-7) */}
          {tabKey === 'risks' && (
            <div className="space-y-4">
              {/* Rubric 1: Key risks */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    1 &nbsp; Key risks
                  </span>
                  <span className="bg-[#FEE2E2] text-[#991B1B] font-medium px-2 py-0.5 rounded text-[11px]">
                    Concern
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  6 risks in the register; 3 with high impact.
                </p>
                <div className="bg-[#FEF2F2] border border-[#FEE2E2] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Concern:</span> Rated Concern because 3 high-impact risks are mitigated only by staging or negotiation so far.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> A date to close the open legal item · Dates for each high-impact mitigation
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> When will the open legal items close? · Give a date for each high-impact mitigation.
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection('r_risk1')}
                    className="text-blue-600 hover:text-blue-800 font-medium text-[11px] flex items-center gap-1 mt-1"
                  >
                    {openSections.r_risk1 ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    More: what the AI found, what would change the rating, sources
                  </button>
                  {openSections.r_risk1 && (
                    <div className="mt-2 space-y-1.5 text-[11px] text-slate-600">
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">High-impact risks</p>
                        <p>3 of 6: regulatory, technical, partner</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Mitigations with a date</p>
                        <p>0 of 3</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Owners named</p>
                        <p>6 of 6</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">What would change the rating:</p>
                        <p>Would improve once the high-impact risks have firm dates and owners signed off.</p>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">ESAL_PH_Risk_Register.xlsx</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">open web: regulator publications</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Rubric 2: Governance & control */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    2 &nbsp; Governance &amp; control
                  </span>
                  <span className="bg-[#FEF3C7] text-[#92400E] font-medium px-2 py-0.5 rounded text-[11px]">
                    Adequate
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  1 compliance item is still open.
                </p>
                <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded p-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">Why Adequate:</span> Rated Adequate: legal is still open in the compliance screen.
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Missing:</span> Date to close the legal item
                </div>
                <div className="text-[11px] text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Ask the subsidiary:</span> When will the open legal items close?
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection('r_risk2')}
                    className="text-blue-600 hover:text-blue-800 font-medium text-[11px] flex items-center gap-1 mt-1"
                  >
                    {openSections.r_risk2 ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    More: what the AI found, what would change the rating, sources
                  </button>
                  {openSections.r_risk2 && (
                    <div className="mt-2 space-y-1.5 text-[11px] text-slate-600">
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Open items</p>
                        <p>Legal</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">Control and exit terms</p>
                        <p>Not yet written: left to a later agreement</p>
                      </div>
                      <div className="border border-slate-100 bg-white p-2 rounded">
                        <p className="font-semibold text-slate-800">What would change the rating:</p>
                        <p>Would move to Strong once every compliance item is clear.</p>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">legal questionnaire (pack)</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Hard filters */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Hard filters</p>
                <div className="flex items-center justify-between py-1 text-[11px]">
                  <span className="text-slate-800">4 of 5 passed</span>
                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-medium">
                    Pass
                  </span>
                </div>
              </div>

              {/* Other checks */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <p className="font-semibold text-slate-900 text-xs">Other checks</p>
                <div className="flex items-center justify-between py-1 text-[11px]">
                  <div>
                    <p className="font-medium text-slate-800">Automatic disqualifiers</p>
                    <p className="text-slate-400 text-[10px]">Sanctions / PEP waits for the manual check above</p>
                  </div>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium border border-emerald-200">
                    None flagged
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 text-[11px]">
                  <span className="font-medium text-slate-800">Related party</span>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium border border-emerald-200">
                    None flagged
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* FALLBACK FOR OTHER TABS */}
          {tabKey !== 'executive_summary' &&
            tabKey !== 'opportunity_overview' &&
            tabKey !== 'rationale' &&
            tabKey !== 'financials' &&
            tabKey !== 'funding' &&
            tabKey !== 'risks' && (
              <div className="text-slate-500 text-xs py-2">
                AI analysis for {tabKey.replace(/_/g, ' ')} is active and monitored.
              </div>
            )}
        </div>
      )}
    </div>
  );
}
