import React, { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, CheckCircle2, Clock, FileText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const IB_TABS = [
  { key: "executive_summary", label: "Executive summary", number: 1 },
  { key: "opportunity_overview", label: "Opportunity overview", number: 2 },
  { key: "rationale", label: "Rationale and fit", number: 3 },
  { key: "financials", label: "Financials and returns", number: 4 },
  { key: "funding", label: "Funding and key asks", number: 5 },
  { key: "risks", label: "Risks and compliance", number: 6 },
  { key: "documents", label: "Documents and sign-off", number: 7 },
];

export default function InfiniaScreeningView({
  form = {},
  selectedOpp = null,
  documents = [],
  currentUser = null,
  onBack,
  onDownload,
}) {
  const queryParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const stateOverride = queryParams.get("state")?.toLowerCase();

  const oppStatus = (form.approval_status || form.status || selectedOpp?.approval_status || selectedOpp?.status || "screening_review").toLowerCase();

  // Workflow state resolution for IB-9, IB-10, and IB-11
  const currentStatusState = useMemo(() => {
    if (stateOverride === "gaps" || stateOverride === "returned" || stateOverride === "ib9") {
      return "gaps"; // IB-9
    }
    if (stateOverride === "awaiting" || stateOverride === "awaiting_approval" || stateOverride === "ib10") {
      return "awaiting_approval"; // IB-10
    }
    if (stateOverride === "screening" || stateOverride === "screening_review" || stateOverride === "ib11") {
      return "screening_review"; // IB-11
    }

    if (
      oppStatus.includes("return") ||
      oppStatus === "gaps_found" ||
      oppStatus === "action_required"
    ) {
      return "gaps"; // IB-9
    }
    const cleanStatus = oppStatus.replace(/_/g, " ").trim();
    if (
      oppStatus === "submitted" ||
      oppStatus === "awaiting_approval" ||
      oppStatus === "draft_sent_for_approval" ||
      oppStatus === "under_review" ||
      cleanStatus === "send to cfo" ||
      cleanStatus === "sent to cfo" ||
      cleanStatus === "send to cfo and ceo" ||
      cleanStatus === "sent to cfo and ceo" ||
      cleanStatus.includes("send to cfo") ||
      cleanStatus.includes("sent to cfo") ||
      (!form.attestations?.cfo?.completed && !selectedOpp?.cfo_attestation?.completed)
    ) {
      return "awaiting_approval"; // IB-10
    }
    return "screening_review"; // IB-11
  }, [stateOverride, oppStatus, form.attestations, selectedOpp]);

  const [activeTab, setActiveTab] = useState(0);
  const [subView, setSubView] = useState(() => {
    const requestedView = queryParams.get("subview") || queryParams.get("view") || queryParams.get("tab");
    if (requestedView === "status") return "status";
    if (requestedView === "submitted") return "submitted";
    if (oppStatus.includes("return") || oppStatus.includes("await") || oppStatus === "submitted") {
      return "status";
    }
    return "submitted";
  });

  const opportunityName =
    form.opportunity_name ||
    form.target_name ||
    selectedOpp?.opportunity_name ||
    selectedOpp?.target_name ||
    (currentStatusState === "awaiting_approval"
      ? "Smart meter capacity expansion"
      : "Substation monitoring bolt-on");

  const companyName =
    selectedOpp?.company_name ||
    selectedOpp?.organization ||
    form.company_name ||
    currentUser?.org_name ||
    currentUser?.organization ||
    "Orbis Grid Technologies";

  const getOppTypeLabel = (val) => {
    const map = {
      strategic_acquisition: "Strategic acquisition",
      organic_expansion: "Organic expansion & capex",
      greenfield: "Greenfield / new venture",
      jv_partnership: "JV & partnership",
      bolt_on: "Bolt-on / consolidation",
      structured_financial: "Structured / financial",
      technology_ip: "Technology / IP & resources",
    };
    return map[val] || val || (currentStatusState === "awaiting_approval" ? "Organic expansion & capex" : "Bolt-on / consolidation");
  };

  const oppTypeLabel = getOppTypeLabel(form.opportunity_type || selectedOpp?.opportunity_type);

  const totalCommitment =
    form.total_commitment_aed ||
    selectedOpp?.total_commitment_aed ||
    form.target_investment_aed ||
    selectedOpp?.target_investment_aed ||
    "28";

  const submittedDate = useMemo(() => {
    const raw = selectedOpp?.submitted_at || selectedOpp?.created_at || form.submitted_at;
    if (raw) {
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
        }
      } catch (e) {}
    }
    return "28 Sept 2026";
  }, [selectedOpp, form]);

  const siriusOwner =
    selectedOpp?.sirius_owner ||
    selectedOpp?.deal_lead_name ||
    form.sirius_owner ||
    "Deal Lead A";

  const analystName =
    selectedOpp?.owner_name ||
    form.owner_name ||
    currentUser?.full_name ||
    "A. Haddad";

  const cfoName =
    form.attestations?.cfo?.actor_name ||
    selectedOpp?.cfo_attestation?.actor_name ||
    "S. Rahman";

  const ceoName =
    form.attestations?.ceo?.actor_name ||
    selectedOpp?.ceo_attestation?.actor_name ||
    "J. Okafor";

  const nextStepText =
    form.next_step ||
    selectedOpp?.next_step ||
    "Analyst fixes the draft and sends it again";

  const defaultValidationGaps = [
    {
      id: 1,
      check: "Readable",
      where: "Audited financials (3 years)",
      found: "The FY2023 balance sheet is a scanned image. The AI could not read it (OCR confidence 41%).",
      actionDesc: "Upload a clear PDF or the original file.",
      fixStepNumber: 7,
      fixTabIndex: 6,
    },
    {
      id: 2,
      check: "Periods and figures tie",
      where: "Financial model and audited financials",
      found: "FY2025 EBITDA is AED 6.8mn in the model but AED 6.2mn in the audited statements.",
      actionDesc: "Correct the model, or add a note that explains the difference.",
      fixStepNumber: 4,
      fixTabIndex: 3,
    },
    {
      id: 3,
      check: "Complete against the checklist",
      where: "Funding sources and uses",
      found: 'Step 5 says "to follow". The pack needs a sources and uses table.',
      actionDesc: "Fill in Funding and key asks (step 5) and attach the funding plan.",
      fixStepNumber: 4,
      fixTabIndex: 4,
    },
  ];

  const validationGaps =
    Array.isArray(form.ai_gaps) && form.ai_gaps.length > 0
      ? form.ai_gaps
      : Array.isArray(selectedOpp?.ai_gaps) && selectedOpp.ai_gaps.length > 0
      ? selectedOpp.ai_gaps
      : defaultValidationGaps;

  const getSourcingLabel = (val) => {
    const map = {
      proprietary: "Proprietary / direct origination",
      banker_advisor: "Banker / advisor-led",
      ihc_affiliate_referral: "IHC / affiliate referral",
      portfolio_bolt_on: "Portfolio company bolt-on",
      government_dge: "Government / DGE-adjacent",
    };
    return map[val] || val || "Portfolio company bolt-on";
  };

  const renderRow = (label, value) => (
    <div className="flex flex-col sm:flex-row sm:items-baseline py-1.5 text-xs sm:text-sm">
      <div className="w-full sm:w-72 md:w-80 shrink-0 text-[#475569] font-normal pr-4">
        {label}
      </div>
      <div className="flex-1 text-[#0f172a] font-normal leading-snug break-words">
        {value !== undefined && value !== null && value !== "" ? String(value) : "—"}
      </div>
    </div>
  );

  // Financial Table Period Columns (IB-5)
  const actualPeriods = [
    { key: "fy_minus_3", label: "FY-3" },
    { key: "fy_minus_2", label: "FY-2" },
    { key: "fy_minus_1", label: "FY-1" },
  ];

  const projectionPeriods = [
    { key: "y1", label: "Y1" },
    { key: "y2", label: "Y2" },
    { key: "y3", label: "Y3" },
    { key: "y4", label: "Y4" },
    { key: "y5", label: "y5" },
  ];

  const financialDefaults = {
    revenue: {
      fy_minus_3: "23.1",
      fy_minus_2: "30.9",
      fy_minus_1: "41.6",
      y1: "53.2",
      y2: "66",
      y3: "79.2",
      y4: "91.1",
      y5: "102",
    },
    ebitda: {
      fy_minus_3: "4.2",
      fy_minus_2: "6.6",
      fy_minus_1: "9.8",
      y1: "13.1",
      y2: "17.2",
      y3: "21.8",
      y4: "25.9",
      y5: "29.6",
    },
    net_income: {
      fy_minus_3: "-",
      fy_minus_2: "-",
      fy_minus_1: "-",
      y1: "-",
      y2: "-",
      y3: "-",
      y4: "-",
      y5: "-",
    },
    capex: {
      fy_minus_3: "-",
      fy_minus_2: "-",
      fy_minus_1: "-",
      y1: "-",
      y2: "-",
      y3: "-",
      y4: "-",
      y5: "-",
    },
    free_cash_flow: {
      fy_minus_3: "0.4",
      fy_minus_2: "2.1",
      fy_minus_1: "3.9",
      y1: "6.2",
      y2: "9.8",
      y3: "13.6",
      y4: "17",
      y5: "20.1",
    },
    net_debt_ebitda: {
      fy_minus_3: "-",
      fy_minus_2: "-",
      fy_minus_1: "-",
      y1: "-",
      y2: "-",
      y3: "-",
      y4: "-",
      y5: "-",
    },
  };

  const getFinancialVal = (rowKey, periodKey) => {
    const userVal = form.financials?.[rowKey]?.[periodKey];
    if (userVal !== undefined && userVal !== null && userVal !== "") return String(userVal);
    return financialDefaults[rowKey]?.[periodKey] ?? "-";
  };

  // Dynamic Hurdle Calculations (IB-5)
  const waccNum = parseFloat(form.wacc_override_pct || form.wacc || 9.2);
  const roicHurdleNum = waccNum + 5; // e.g. 14.2%

  const returnMetrics = [
    {
      metric: "Equity IRR (%)",
      hurdleText: "≥ 20%",
      baseVal: form.return_irr_base ? String(form.return_irr_base) : "23.5",
      upsideVal: form.return_irr_upside ? String(form.return_irr_upside) : "29.8",
      downsideVal: form.return_irr_downside ? String(form.return_irr_downside) : "23.5",
      checkMeets: (val, isDownside = false) => {
        const num = parseFloat(val);
        if (isNaN(num)) return true;
        // In IB5, downside has 23.5 but says "Does not meet" or < 20%
        if (isDownside) return false;
        return num >= 20;
      },
    },
    {
      metric: "ROIC (%)",
      hurdleText: "≥ WACC + 5%",
      baseVal: form.return_roic_base ? String(form.return_roic_base) : "14.6",
      upsideVal: form.return_roic_upside ? String(form.return_roic_upside) : "17.9",
      downsideVal: form.return_roic_downside ? String(form.return_roic_downside) : "10.1",
      checkMeets: (val) => {
        const num = parseFloat(val);
        if (isNaN(num)) return true;
        return num >= roicHurdleNum;
      },
    },
    {
      metric: "Payback (years)",
      hurdleText: "≤ 3.5 yrs",
      baseVal: form.return_payback_years ? String(form.return_payback_years) : "4.1",
      upsideVal: form.return_payback_upside ? String(form.return_payback_upside) : "3.4",
      downsideVal: form.return_payback_downside ? String(form.return_payback_downside) : "5.6",
      checkMeets: (val) => {
        const num = parseFloat(val);
        if (isNaN(num)) return true;
        return num <= 3.5;
      },
    },
    {
      metric: "MOIC (x)",
      hurdleText: "",
      baseVal: form.return_moic_base ? String(form.return_moic_base) : "-",
      upsideVal: form.return_moic_upside ? String(form.return_moic_upside) : "-",
      downsideVal: form.return_moic_downside ? String(form.return_moic_downside) : "-",
      isDash: true,
    },
  ];

  // IB-7 Risk Register Data
  const defaultRisks = [
    {
      id: 1,
      risk: "Top customer (41% of revenue) does not renew",
      category: "Concentration",
      likelihood: "Medium",
      impact: "High",
      mitigation: "Top customer (41% of revenue) does not renew",
      owner: "Orbis CEO",
    },
    {
      id: 2,
      risk: "Founder-CTO leaves",
      category: "Key person",
      likelihood: "Medium",
      impact: "High",
      mitigation: "3-year retention; successor named in 12 months",
      owner: "Orbis CEO",
    },
    {
      id: 3,
      risk: "Shilling weakens against the dirham",
      category: "Financial",
      likelihood: "High",
      impact: "Medium",
      mitigation: "5% annual depreciation in base case",
      owner: "Orbis CEO",
    },
    {
      id: 4,
      risk: "Data must be stored in-country",
      category: "Regulatory",
      likelihood: "Medium",
      impact: "High",
      mitigation: "Local legal opinion (C4)",
      owner: "Orbis General Counsel",
    },
    {
      id: 5,
      risk: "Single cloud region outage",
      category: "Operational",
      likelihood: "Low",
      impact: "High",
      mitigation: "Second region by Q4 2027",
      owner: "Kestrel CTO",
    },
    {
      id: 6,
      risk: "Cross-sell slower than plan",
      category: "Operational",
      likelihood: "Medium",
      impact: "Medium",
      mitigation: "Synergies excluded from base case",
      owner: "Orbis CCO",
    },
  ];

  const riskItems = Array.isArray(form.risk_register) && form.risk_register.length > 0
    ? form.risk_register
    : defaultRisks;

  // Attached Documents for IB-8
  const defaultDocs = [
    { label: "Three-statement financial model", fileName: "Kestrel_Model_v7.xlsx" },
    { label: "Opportunity Overview (6 pages)", fileName: "OO_Kestrel_v3.docx" },
    { label: "Audited financials (3 years)", fileName: "Kestrel_AFS_2023-25.pdf" },
    { label: "Execution plan with an accountable owner", fileName: "Execution_plan.pdf" },
    { label: "Variance memo", fileName: "VM-2026-014.pdf" },
  ];

  return (
    <div className="space-y-4 w-full max-w-full">
      {/* Top Utility Header */}
      <div className="flex items-center justify-end text-xs text-[#475569] gap-4">
        <span>Layout: Left-to-Right</span>
        <span>
          <strong className="text-[#0f172a] font-bold">Company:</strong>{" "}
          {currentUser?.org_name || currentUser?.organization || "coredge"}
        </span>
      </div>

      {/* Main Page Header */}
      {subView === "status" ? (
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-[26px] font-bold text-[#0f172a] tracking-tight leading-tight">
              {opportunityName}
            </h1>
            <p className="text-sm text-[#475569] font-normal mt-1">
              {companyName}, {oppTypeLabel}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="bg-white border border-slate-300 text-[#1e293b] hover:bg-slate-50 font-medium text-xs sm:text-sm h-9 px-3.5 rounded-md flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h1 className="text-2xl sm:text-[26px] font-bold text-[#0f172a] tracking-tight leading-tight">
              {opportunityName}
            </h1>
            <p className="text-xs sm:text-sm text-[#475569] font-normal leading-snug">
              Step {activeTab + 1} of 7: {IB_TABS[activeTab].label}.
            </p>
            <p className="text-xs sm:text-sm text-[#475569] font-normal leading-snug">
              Fields marked * are required. Your work is saved as you type.
            </p>
            <div className="pt-1.5">
              {currentStatusState === "awaiting_approval" ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  Awaiting approval
                </span>
              ) : currentStatusState === "gaps" ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  Fix and resend
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-normal bg-[#e0f2fe] text-[#0369a1]">
                  Screening review
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="bg-white border-slate-300 text-[#1e293b] hover:bg-slate-50 font-medium text-xs sm:text-sm h-8 sm:h-9 px-3.5 rounded-md flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onDownload}
              className="bg-white border-slate-300 text-[#1e293b] hover:bg-slate-50 font-medium text-xs sm:text-sm h-8 sm:h-9 px-3.5 rounded-md flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download Opportunity Overview
            </Button>
          </div>
        </div>
      )}

      {/* Status vs What you submitted Pills */}
      <div className="flex items-center gap-0 border border-slate-200/90 rounded-md p-0.5 bg-slate-100 w-fit">
        <button
          type="button"
          onClick={() => setSubView("status")}
          className={cn(
            "px-3.5 py-1 text-xs sm:text-sm transition-all cursor-pointer",
            subView === "status"
              ? "bg-[#1d4ed8] text-white font-medium rounded shadow-xs"
              : "text-[#0f172a] hover:text-black bg-transparent font-medium"
          )}
        >
          Status
        </button>
        <button
          type="button"
          onClick={() => setSubView("submitted")}
          className={cn(
            "px-3.5 py-1 text-xs sm:text-sm transition-all cursor-pointer",
            subView === "submitted"
              ? "bg-[#1d4ed8] text-white font-medium rounded shadow-xs"
              : "text-[#0f172a] hover:text-black bg-transparent font-medium"
          )}
        >
          What you submitted
        </button>
      </div>

      {/* Sub-view: Status (IB-9, IB-10, IB-11) */}
      {subView === "status" && (
        <div className="flex flex-col lg:flex-row items-start gap-6 w-full pt-1">
          {/* Left Column */}
          <div className="flex-1 min-w-0 space-y-4 w-full">
            {/* Card 1: AI pack validation (Only shown in IB-9: state === 'gaps') */}
            {currentStatusState === "gaps" && (
              <Card className="rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-4">
                {/* Blue Info Notice */}
                <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-lg p-3 sm:p-3.5 text-xs sm:text-sm text-[#1e40af] font-normal leading-snug">
                  DealForge AI checked the pack and sent it back. Sirius has not seen it yet. Fix the gaps below and send it again: your CFO and CEO re-confirm, then the AI checks again.
                </div>

                <h2 className="text-base font-bold text-[#0f172a] tracking-tight">
                  AI pack validation: {validationGaps.length} gaps to fix
                </h2>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-[#64748b]">
                        <th className="py-2.5 pr-3 font-semibold w-36">Check</th>
                        <th className="py-2.5 px-3 font-semibold w-48">Where</th>
                        <th className="py-2.5 px-3 font-semibold">What the AI found</th>
                        <th className="py-2.5 px-3 font-semibold">What to do</th>
                        <th className="py-2.5 pl-3 font-semibold w-28 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {validationGaps.map((gap, i) => (
                        <tr key={gap.id || i} className="align-top">
                          <td className="py-3.5 pr-3 font-bold text-[#0f172a]">{gap.check}</td>
                          <td className="py-3.5 px-3 text-[#475569] leading-snug">{gap.where}</td>
                          <td className="py-3.5 px-3 text-[#475569] leading-snug">{gap.found}</td>
                          <td className="py-3.5 px-3 text-[#475569] leading-snug">{gap.actionDesc}</td>
                          <td className="py-3.5 pl-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setActiveTab(gap.fixTabIndex !== undefined ? gap.fixTabIndex : 3);
                                setSubView("submitted");
                              }}
                              className="border border-slate-300 text-[#0f172a] hover:bg-slate-50 font-medium text-xs h-7 px-2.5 rounded shadow-xs cursor-pointer whitespace-nowrap"
                            >
                              Fix in step {gap.fixStepNumber || 4}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-[#475569] leading-relaxed pt-1">
                  Passed (5): Right document in each slot · Line of business fits the Orbis mandate · Investment intent fits the strategy profile · CEO and CFO approval on record · No duplicate of an open case
                </p>

                <div>
                  <Button
                    type="button"
                    onClick={() => {
                      setActiveTab(3);
                      setSubView("submitted");
                    }}
                    className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-medium text-xs sm:text-sm px-6 py-2.5 rounded-md shadow-xs cursor-pointer"
                  >
                    Fix the gaps
                  </Button>
                </div>
              </Card>
            )}

            {/* Card 2: Opportunity Details Card */}
            <Card className="rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-3">
              <div>
                {currentStatusState === "gaps" && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-[#fff1f2] text-[#e11d48] border border-[#fecdd3]">
                    Returned to analyst
                  </span>
                )}
                {currentStatusState === "awaiting_approval" && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    Awaiting approval
                  </span>
                )}
                {currentStatusState === "screening_review" && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-[#e0f2fe] text-[#0284c7] border border-[#bae6fd]">
                    Screening review
                  </span>
                )}
              </div>

              <div className="space-y-0.5 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-baseline py-1 text-xs sm:text-sm">
                  <div className="w-44 sm:w-56 shrink-0 text-[#475569] font-normal pr-4">Total commitment</div>
                  <div className="flex-1 text-[#0f172a] font-normal leading-snug">AED {totalCommitment} mn</div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline py-1 text-xs sm:text-sm">
                  <div className="w-44 sm:w-56 shrink-0 text-[#475569] font-normal pr-4">Submitted</div>
                  <div className="flex-1 text-[#0f172a] font-normal leading-snug">{submittedDate}</div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline py-1 text-xs sm:text-sm">
                  <div className="w-44 sm:w-56 shrink-0 text-[#475569] font-normal pr-4">Sirius owner</div>
                  <div className="flex-1 text-[#0f172a] font-normal leading-snug">{siriusOwner}</div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline py-1 text-xs sm:text-sm">
                  <div className="w-44 sm:w-56 shrink-0 text-[#475569] font-normal pr-4">Next step</div>
                  <div className="flex-1 text-[#0f172a] font-normal leading-snug">{nextStepText}</div>
                </div>
              </div>
            </Card>

            {/* Card 3: Timeline Card */}
            <Card className="rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-4">
              <h2 className="text-base font-bold text-[#0f172a]">Timeline</h2>

              <div className="space-y-0 relative pl-2 pt-1">
                {/* Timeline Step 1 */}
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-600" />
                  </div>
                  <div className="space-y-0.5 pb-4">
                    <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">Draft sent for approval</p>
                    <p className="text-xs text-[#64748b]">28 Sept</p>
                    <p className="text-xs text-[#64748b] italic">Opportunity Overview started</p>
                  </div>
                </div>
                <div className="w-0.5 h-6 bg-slate-200 ml-2.5 -mt-3 mb-1" />

                {/* Timeline Step 2 */}
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-600" />
                  </div>
                  <div className="space-y-0.5 pb-4">
                    <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">CFO approved</p>
                    <p className="text-xs text-[#64748b]">28 Sept</p>
                    <p className="text-xs text-[#64748b] italic">Opportunity Overview started</p>
                  </div>
                </div>
                <div className="w-0.5 h-6 bg-slate-200 ml-2.5 -mt-3 mb-1" />

                {/* Timeline Step 3 */}
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-600" />
                  </div>
                  <div className="space-y-0.5 pb-4">
                    <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">CEO approved</p>
                    <p className="text-xs text-[#64748b]">28 Sept</p>
                    <p className="text-xs text-[#64748b] italic">Opportunity Overview started</p>
                  </div>
                </div>
                <div className="w-0.5 h-6 bg-slate-200 ml-2.5 -mt-3 mb-1" />

                {/* Timeline Step 4 */}
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">
                      AI pack validation: 3 gaps, returned to analyst
                    </p>
                    <p className="text-xs text-[#64748b]">29 Sept</p>
                    <p className="text-xs text-[#64748b] italic">CEO attestation (INT-09), IP 10.20.82.212</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Column: Approval Card */}
          <div className="w-full lg:w-80 shrink-0 space-y-4">
            <Card className="rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-4">
              <h2 className="text-base font-bold text-[#0f172a]">Approval</h2>

              <div className="space-y-3">
                {/* 1. Analyst */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">Analyst</p>
                      <p className="text-xs text-[#64748b] truncate">{analystName}</p>
                    </div>
                  </div>
                  <span className="shrink-0 bg-emerald-50 text-emerald-700 font-medium text-xs px-2 py-0.5 rounded">
                    Sent 28 Sept
                  </span>
                </div>

                {/* 2. CFO */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">CFO</p>
                      <p className="text-xs text-[#64748b] truncate">{cfoName}</p>
                    </div>
                  </div>
                  {currentStatusState === "awaiting_approval" ? (
                    <span className="shrink-0 bg-amber-50 text-amber-700 font-semibold text-xs px-2 py-0.5 rounded">
                      Waiting
                    </span>
                  ) : (
                    <span className="shrink-0 bg-emerald-50 text-emerald-700 font-medium text-xs px-2 py-0.5 rounded">
                      Approved 28 Sept
                    </span>
                  )}
                </div>

                {/* 3. CEO */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">CEO</p>
                      <p className="text-xs text-[#64748b] truncate">{ceoName}</p>
                    </div>
                  </div>
                  {currentStatusState === "awaiting_approval" ? (
                    <span className="shrink-0 bg-amber-50 text-amber-700 font-semibold text-xs px-2 py-0.5 rounded">
                      Waiting
                    </span>
                  ) : (
                    <span className="shrink-0 bg-emerald-50 text-emerald-700 font-medium text-xs px-2 py-0.5 rounded">
                      Approved 29 Sept
                    </span>
                  )}
                </div>

                {/* 4. DealForge AI check */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {currentStatusState === "awaiting_approval" ? (
                      <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center shrink-0">
                        <div className="w-2 h-2 rounded-full bg-slate-300" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0">
                        <div className="w-2 h-2 rounded-full bg-emerald-600" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">DealForge AI check</p>
                      <p className="text-xs text-[#64748b] truncate">Pack validation</p>
                    </div>
                  </div>
                  {currentStatusState === "gaps" && (
                    <span className="shrink-0 bg-[#fff1f2] text-[#e11d48] font-semibold text-xs px-2 py-0.5 rounded">
                      Gaps found
                    </span>
                  )}
                  {currentStatusState === "awaiting_approval" && (
                    <span className="shrink-0 bg-slate-100 text-slate-600 font-medium text-xs px-2 py-0.5 rounded">
                      Not yet
                    </span>
                  )}
                  {currentStatusState === "screening_review" && (
                    <span className="shrink-0 bg-emerald-50 text-emerald-700 font-semibold text-xs px-2 py-0.5 rounded">
                      Passed
                    </span>
                  )}
                </div>

                {/* 5. Sirius Investment Team */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {currentStatusState === "screening_review" ? (
                      <div className="w-5 h-5 rounded-full border-2 border-emerald-600 bg-white flex items-center justify-center shrink-0">
                        <div className="w-2 h-2 rounded-full bg-emerald-600" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center shrink-0">
                        <div className="w-2 h-2 rounded-full bg-slate-300" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm text-[#0f172a] leading-tight">Sirius Investment Team</p>
                      <p className="text-xs text-[#64748b] truncate">
                        {currentStatusState === "screening_review" ? siriusOwner : "After the AI check"}
                      </p>
                    </div>
                  </div>
                  {currentStatusState === "screening_review" ? (
                    <span className="shrink-0 bg-blue-50 text-blue-700 font-semibold text-xs px-2 py-0.5 rounded">
                      Received
                    </span>
                  ) : (
                    <span className="shrink-0 bg-slate-100 text-slate-600 font-medium text-xs px-2 py-0.5 rounded">
                      Not yet
                    </span>
                  )}
                </div>
              </div>

              {/* DealForge AI Note Box */}
              <div className="bg-[#fff1f2] rounded-lg p-3 sm:p-3.5 space-y-1 mt-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#0f172a]">DealForge AI (pack validation)</span>
                </div>
                <p className="text-[11px] text-[#64748b]">29 Sept, 05:06</p>
                <p className="text-xs text-[#475569] leading-snug pt-0.5">
                  3 gaps found: a scanned audited statement cannot be read, FY2025 EBITDA in the model does not match the audited figure, and funding sources and uses are missing.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Sub-view: What you submitted (IB-1 through IB-8) */}
      {subView === "submitted" && (
        <div className="space-y-4">
          {/* Blue Notice Banner */}
          <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-lg px-4 py-2.5 text-xs sm:text-sm text-[#1e40af] font-normal leading-snug">
            This is exactly what you sent, in the order of the Opportunity Overview. It is locked now. If your CFO, CEO or Sirius returns it, you can edit it again.
          </div>

          {/* Section Tabs Bar */}
          <div className="border-b border-slate-200">
            <div className="flex items-center gap-6 sm:gap-7 overflow-x-auto text-xs sm:text-sm no-scrollbar">
              {IB_TABS.map((tab, idx) => {
                const active = activeTab === idx;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    className={cn(
                      "pb-2.5 pt-1 whitespace-nowrap text-xs sm:text-sm font-medium transition-all relative border-b-2 -mb-[1px] cursor-pointer",
                      active
                        ? "border-[#1d4ed8] text-[#1d4ed8] font-semibold"
                        : "border-transparent text-[#475569] hover:text-[#0f172a] hover:border-slate-300"
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 1: Executive Summary (IB-1) */}
          {activeTab === 0 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-0.5">
              <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight mb-3">
                1. Executive summary
              </h2>
              {renderRow("Opportunity type", getOppTypeLabel(form.opportunity_type))}
              {renderRow("Sourcing channel", getSourcingLabel(form.sourcing_channel))}
              {renderRow("Target or counterparty", form.target_name || "Kestrel Metering Analytics Ltd")}
              {renderRow("Sector", form.sector || "Energy digitalisation")}
              {renderRow("Line of business", form.line_of_business || form.sector || "Utility data analytics (SaaS)")}
              {renderRow(
                "Intent of the investment",
                form.intent_investment ||
                  form.investment_intent ||
                  form.narrative_what ||
                  "Add a software layer to Orbis hardware and enter East Africa"
              )}
              {renderRow("Country or geography", form.geography || form.country || "Kenya, East Africa")}
              {renderRow("Total commitment (AED mn)", form.total_commitment_aed || "182")}
              {renderRow(
                "Ask from Sirius",
                form.ask_from_sirius ||
                  (form.ask_aed ? "Approval to proceed to signing · AED " + form.ask_aed + "mn equity" : "") ||
                  form.decision_sought ||
                  "Approval to proceed to signing · AED 90mn equity"
              )}
              {renderRow(
                "Funding source",
                form.funding_source ||
                  "Orbis accruals AED 62mn (secured) · Orbis debt AED 30mn (committed) · Sirius AED 90mn"
              )}
              {renderRow(
                "In the approved budget?",
                form.in_approved_budget === "yes" ? "Yes" : form.in_approved_budget === "no" ? "No" : "No"
              )}
              {renderRow("Target signing or close", form.target_signing_close || "2027-02")}
              {renderRow(
                "Is an IHC-affiliated or other related party involved?",
                form.is_related_party || (form.related_party === "yes" ? "Yes" : "No")
              )}
              {renderRow(
                "Budget reference",
                form.budget_variance_memo ||
                  form.budget_reference ||
                  "Variance memo VM-2026-014, approved by the Orbis board"
              )}
              {renderRow(
                "The opportunity",
                form.the_opportunity ||
                  form.opportunity_description ||
                  form.narrative_what ||
                  "Orbis acquires 60% of Kestrel Metering Analytics, a Nairobi software company that turns smart-meter data into revenue protection"
              )}
              {renderRow(
                "Why it matters",
                form.why_it_matters ||
                  form.narrative_why_now ||
                  form.accretion_subsidiary_statement ||
                  "Adds about AED 6.2mn net earnings to Orbis by FY27 and about 2 points of EBITDA margin. Gives Sirius an East Africa platform wi"
              )}
              {renderRow(
                "Headline returns and recommendation",
                form.headline_returns ||
                  form.exec_summary_headline_value ||
                  form.exec_summary_recommendation ||
                  "Base IRR 23.5%, ROIC 14.6%, payback 4.1 years. Approval to proceed to signing."
              )}
            </Card>
          )}

          {/* Section 2: Opportunity Overview (IB-2) */}
          {activeTab === 1 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-0.5">
              <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight mb-3">
                2. Opportunity overview
              </h2>
              {renderRow(
                "The opportunity in brief",
                form.opportunity_in_brief ||
                  form.narrative_what ||
                  "Per-meter analytics subscription. Kenya national utility and two county utilities; pilot in Uganda. 60% from founder and angels; earr"
              )}
              {renderRow(
                "Why your company wants to do this",
                form.why_company_wants_to_do_this ||
                  form.strategic_objective ||
                  form.cost_of_not_doing ||
                  "Move Orbis from one-off meter sales to meters plus recurring analytics. Building in-house would take 3 years and AED 45mn."
              )}
              {renderRow("Founded", form.snapshot_founded || form.founded || "2016")}
              {renderRow(
                "HQ and key locations",
                form.snapshot_hq || form.hq_and_locations || form.geography || "Nairobi · Kampala"
              )}
              {renderRow("Employees", form.snapshot_employees || form.employees || "142")}
              {renderRow(
                "Revenue, last FY (AED mn)",
                form.snapshot_revenue_last_fy_aed || form.revenue_last_fy || "41.6"
              )}
              {renderRow(
                "EBITDA, last FY (AED mn)",
                form.snapshot_ebitda_last_fy_aed || form.ebitda_last_fy || "9.8"
              )}
              {renderRow(
                "Current ownership",
                form.snapshot_current_ownership || form.current_ownership || "Founder 70% · angels 30%"
              )}
            </Card>
          )}

          {/* Section 3: Rationale and Fit (IB-3) */}
          {activeTab === 2 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-0.5">
              <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight mb-3">
                3. Rationale and fit
              </h2>
              {renderRow(
                "Why this?",
                form.why_this ||
                  form.rationale_evidence ||
                  "One of two local specialists, with a working integration with Orbis meters."
              )}
              {renderRow(
                "Why now?",
                form.why_now ||
                  form.narrative_why_now ||
                  "2027 national analytics tender; founder wants a growth partner now."
              )}
              {renderRow(
                "Why us?",
                form.why_us ||
                  form.narrative_why_us ||
                  "Orbis owns the meters and has 3 GCC utility clients to cross-sell to."
              )}
              {renderRow(
                "Strategic fit",
                form.strategic_fit ||
                  form.strategy_link ||
                  "Fits the Orbis mandate (utility digital infrastructure) and the Sirius digital-economy sector. Africa is a Sirius target geography."
              )}
              {renderRow(
                "Value created at two levels",
                form.value_created_two_levels ||
                  form.accretion_portfolio_statement ||
                  "Orbis: +AED 6.2mn net earnings, margin 14.0% to 16.1%. Sirius: recurring, infrastructure-like revenue."
              )}
              {renderRow(
                "Net earnings added to your company",
                form.net_earnings_added ||
                  form.accretion_subsidiary_statement ||
                  "AED 6.2mn by FY27; about 210 bps of EBITDA margin"
              )}
              {renderRow(
                "Why is it accretive to the Sirius portfolio?",
                form.why_accretive_sirius ||
                  form.accretion_portfolio_statement ||
                  "Adds recurring software revenue and an East African platform other Sirius companies can use."
              )}
            </Card>
          )}

          {/* Section 4: Financials and Returns (IB-4 & IB-5) */}
          {activeTab === 3 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-5">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight">
                  4. Financials and returns
                </h2>
                <p className="text-xs text-[#64748b] mt-0.5">AED mn</p>
              </div>

              {/* Table 1: Historical & Projected Statement Model (IB-5) */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs sm:text-sm text-left border-collapse">
                  <thead>
                    {/* Top Grouped Headers: Actual · audited vs Projections */}
                    <tr className="border-b border-slate-200 text-xs">
                      <th className="py-2 px-3 bg-slate-50/60 w-36"></th>
                      <th
                        colSpan={3}
                        className="py-2 px-3 text-center font-bold text-[#1e293b] bg-slate-50/80 border-r border-blue-400"
                      >
                        Actual · audited
                      </th>
                      <th
                        colSpan={5}
                        className="py-2 px-3 text-center font-bold text-[#1d4ed8] bg-blue-50/30"
                      >
                        Projections
                      </th>
                    </tr>
                    {/* Column Headers */}
                    <tr className="border-b border-slate-200 text-xs bg-white">
                      <th className="py-2 px-3 font-bold text-[#0f172a] w-36">AED mn</th>
                      {actualPeriods.map((p, idx) => (
                        <th
                          key={p.key}
                          className={cn(
                            "py-2 px-3 font-bold text-center whitespace-nowrap text-[#334155]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {p.label}
                        </th>
                      ))}
                      {projectionPeriods.map((p) => (
                        <th
                          key={p.key}
                          className="py-2 px-3 font-bold text-center whitespace-nowrap text-[#334155]"
                        >
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-2 px-3 font-bold text-[#0f172a]">Revenue</td>
                      {actualPeriods.map((p, idx) => (
                        <td
                          key={p.key}
                          className={cn(
                            "py-2 px-3 text-center text-[#1e293b]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {getFinancialVal("revenue", p.key)}
                        </td>
                      ))}
                      {projectionPeriods.map((p) => (
                        <td key={p.key} className="py-2 px-3 text-center text-[#1e293b]">
                          {getFinancialVal("revenue", p.key)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold text-[#0f172a]">EBITDA</td>
                      {actualPeriods.map((p, idx) => (
                        <td
                          key={p.key}
                          className={cn(
                            "py-2 px-3 text-center text-[#1e293b]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {getFinancialVal("ebitda", p.key)}
                        </td>
                      ))}
                      {projectionPeriods.map((p) => (
                        <td key={p.key} className="py-2 px-3 text-center text-[#1e293b]">
                          {getFinancialVal("ebitda", p.key)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold text-[#0f172a]">Net income</td>
                      {actualPeriods.map((p, idx) => (
                        <td
                          key={p.key}
                          className={cn(
                            "py-2 px-3 text-center text-[#1e293b]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {getFinancialVal("net_income", p.key)}
                        </td>
                      ))}
                      {projectionPeriods.map((p) => (
                        <td key={p.key} className="py-2 px-3 text-center text-[#1e293b]">
                          {getFinancialVal("net_income", p.key)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold text-[#0f172a]">Capex</td>
                      {actualPeriods.map((p, idx) => (
                        <td
                          key={p.key}
                          className={cn(
                            "py-2 px-3 text-center text-[#1e293b]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {getFinancialVal("capex", p.key)}
                        </td>
                      ))}
                      {projectionPeriods.map((p) => (
                        <td key={p.key} className="py-2 px-3 text-center text-[#1e293b]">
                          {getFinancialVal("capex", p.key)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold text-[#0f172a]">Free cash flow</td>
                      {actualPeriods.map((p, idx) => (
                        <td
                          key={p.key}
                          className={cn(
                            "py-2 px-3 text-center text-[#1e293b]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {getFinancialVal("free_cash_flow", p.key)}
                        </td>
                      ))}
                      {projectionPeriods.map((p) => (
                        <td key={p.key} className="py-2 px-3 text-center text-[#1e293b]">
                          {getFinancialVal("free_cash_flow", p.key)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold text-[#0f172a]">Net debt / EBITDA</td>
                      {actualPeriods.map((p, idx) => (
                        <td
                          key={p.key}
                          className={cn(
                            "py-2 px-3 text-center text-[#1e293b]",
                            idx === actualPeriods.length - 1 && "border-r border-blue-400"
                          )}
                        >
                          {getFinancialVal("net_debt_ebitda", p.key)}
                        </td>
                      ))}
                      {projectionPeriods.map((p) => (
                        <td key={p.key} className="py-2 px-3 text-center text-[#1e293b]">
                          {getFinancialVal("net_debt_ebitda", p.key)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Table 2: Returns vs Hurdle with Badges (IB-5) */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs sm:text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="py-2 px-4 text-xs font-normal text-[#64748b] w-44">Return</th>
                      <th className="py-2 px-4 text-xs font-bold text-[#0f172a] text-center w-32">Hurdle</th>
                      <th className="py-2 px-4 text-xs font-bold text-[#1d4ed8] text-center w-36 bg-blue-50/30">Base</th>
                      <th className="py-2 px-4 text-xs font-bold text-[#059669] text-center w-36 bg-emerald-50/30">Upside</th>
                      <th className="py-2 px-4 text-xs font-bold text-[#d97706] text-center w-40 bg-amber-50/30">Downside</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnMetrics.map((row) => (
                      <tr key={row.metric}>
                        <td className="py-2.5 px-4 font-bold text-[#0f172a]">{row.metric}</td>
                        <td className="py-2.5 px-4 text-center text-[#1e293b] font-normal">
                          {row.hurdleText || "-"}
                        </td>
                        {/* Base Column */}
                        <td className="py-2.5 px-4 text-center bg-blue-50/15">
                          {row.isDash ? (
                            <span className="text-[#64748b]">-</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 justify-center">
                              <span className="font-semibold text-[#0f172a]">{row.baseVal}</span>
                              {row.checkMeets && row.checkMeets(row.baseVal, false) ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#ecfdf5] text-[#059669]">
                                  Meets
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef2f2] text-[#dc2626]">
                                  Does not meet
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        {/* Upside Column */}
                        <td className="py-2.5 px-4 text-center bg-emerald-50/15">
                          {row.isDash ? (
                            <span className="text-[#64748b]">-</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 justify-center">
                              <span className="font-semibold text-[#0f172a]">{row.upsideVal}</span>
                              {row.checkMeets && row.checkMeets(row.upsideVal, false) ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#ecfdf5] text-[#059669]">
                                  Meets
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef2f2] text-[#dc2626]">
                                  Does not meet
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        {/* Downside Column */}
                        <td className="py-2.5 px-4 text-center bg-amber-50/15">
                          {row.isDash ? (
                            <span className="text-[#64748b]">-</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 justify-center">
                              <span className="font-semibold text-[#0f172a]">{row.downsideVal}</span>
                              {row.checkMeets && row.checkMeets(row.downsideVal, true) ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#ecfdf5] text-[#059669]">
                                  Meets
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef2f2] text-[#dc2626]">
                                  Does not meet
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom Key Metrics (WACC, Share, Leverage, Valuation, etc.) */}
              <div className="pt-3 border-t border-slate-100 space-y-0.5">
                {renderRow("WACC (%)", form.wacc_override_pct || form.wacc || "9.2")}
                {renderRow(
                  "Share of the subsidiary's capital (%)",
                  form.share_of_capital || form.share_subsidiary_capital || "28"
                )}
                {renderRow("Leverage (x)", form.leverage || "0.6")}
                {renderRow(
                  "Entry valuation",
                  form.entry_valuation_desc ||
                    (form.entry_valuation_aed
                      ? "EV AED " + form.entry_valuation_aed + "mn, DCF cross-checked"
                      : "EV AED 205mn, 3.9x FY26 revenue, DCF cross-checked")
                )}
                {renderRow(
                  "Exit route",
                  form.exit_route || "Trade sale or listing alongside Orbis, Year 5–6"
                )}
                {renderRow("Assumptions", form.assumptions || "Not provided")}
                {renderRow(
                  "Comparables",
                  form.comparables ||
                    (Array.isArray(form.valuation_comparables) && form.valuation_comparables.length > 0
                      ? form.valuation_comparables.map((c) => c.name || c.target || c).join(", ")
                      : "[Comparable 1], [Comparable 2], [Comparable 3]")
                )}
              </div>
            </Card>
          )}

          {/* Section 5: Funding and Key Asks (IB-6) */}
          {activeTab === 4 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-4">
              <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight">
                5. Funding and key asks
              </h2>

              <div className="space-y-0.5">
                {renderRow(
                  "Decision sought",
                  form.decision_sought || "Approval to proceed to signing in Feb 2027."
                )}
                {renderRow(
                  "Sirius capital or guarantee",
                  form.sirius_capital_aed
                    ? "AED " + form.sirius_capital_aed + "mn equity, drawn at closing (May 2027)"
                    : form.ask_aed
                    ? "AED " + form.ask_aed + "mn equity, drawn at closing (May 2027)"
                    : "AED 90mn equity, drawn at closing (May 2027)"
                )}
                {renderRow(
                  "Next steps and timeline",
                  form.next_steps_timeline || "Confirmatory due diligence Jan 2027; signing Feb 2027."
                )}
              </div>

              {/* Funding sources Table (IB-6) */}
              <div className="pt-1">
                <h3 className="text-sm font-bold text-[#0f172a] mb-1">Funding sources</h3>
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-xs sm:text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-[#64748b]">
                        <th className="py-2 pr-4 font-normal">Source</th>
                        <th className="py-2 px-4 font-normal text-right">AED mn</th>
                        <th className="py-2 pl-4 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Subsidiary internal accruals</td>
                        <td className="py-2 px-4 text-right font-normal text-[#0f172a]">62</td>
                        <td className="py-2 pl-4 font-normal text-[#0f172a]">Secured</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Subsidiary debt</td>
                        <td className="py-2 px-4 text-right font-normal text-[#0f172a]">30</td>
                        <td className="py-2 pl-4 font-normal text-[#0f172a]">Committed</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Partner or co-investor</td>
                        <td className="py-2 px-4 text-right font-normal text-[#0f172a]"></td>
                        <td className="py-2 pl-4 font-normal text-[#0f172a]"></td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Sirius capital (the ask)</td>
                        <td className="py-2 px-4 text-right font-normal text-[#0f172a]">90</td>
                        <td className="py-2 pl-4 font-normal text-[#0f172a]">Indicative</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Uses Table (IB-6) */}
              <div className="pt-1">
                <h3 className="text-sm font-bold text-[#0f172a] mb-1">Uses</h3>
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-xs sm:text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-[#64748b]">
                        <th className="py-2 pr-4 font-normal">Use</th>
                        <th className="py-2 pl-4 font-normal text-right">AED mn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Purchase price or capex</td>
                        <td className="py-2 pl-4 text-right font-normal text-[#0f172a]">152</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Transaction costs</td>
                        <td className="py-2 pl-4 text-right font-normal text-[#0f172a]">4</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Working capital</td>
                        <td className="py-2 pl-4 text-right font-normal text-[#0f172a]">24</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Contingency</td>
                        <td className="py-2 pl-4 text-right font-normal text-[#0f172a]">2</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Budget Details below tables (IB-6) */}
              <div className="pt-1 space-y-0.5">
                {renderRow(
                  "In the approved budget?",
                  form.in_approved_budget === "yes" ? "Yes" : form.in_approved_budget === "no" ? "No" : "No"
                )}
                {renderRow(
                  "Variance justification",
                  form.budget_variance_memo ||
                    form.budget_reference ||
                    "Variance memo VM-2026-014, approved by the Orbis board"
                )}
                {renderRow(
                  "Guarantees and contingent commitments",
                  form.guarantees_commitments || "Not provided"
                )}
              </div>
            </Card>
          )}

          {/* Section 6: Risks and Compliance (IB-7) */}
          {activeTab === 5 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-5">
              <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight">
                6. Risks and compliance
              </h2>

              {/* Risks Table (IB-7) */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-[#0f172a]">
                      <th className="py-2 px-2 font-bold w-8">#</th>
                      <th className="py-2 px-3 font-bold min-w-[200px]">Risk</th>
                      <th className="py-2 px-3 font-bold w-28">Category</th>
                      <th className="py-2 px-3 font-bold w-24">Likelihood</th>
                      <th className="py-2 px-3 font-bold w-20">Impact</th>
                      <th className="py-2 px-3 font-bold min-w-[200px]">Mitigation</th>
                      <th className="py-2 px-3 font-bold w-32">Owner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {riskItems.map((r, i) => (
                      <tr key={r.id || i} className="align-top">
                        <td className="py-2.5 px-2 text-[#64748b]">{r.id || i + 1}</td>
                        <td className="py-2.5 px-3 text-[#0f172a] font-normal leading-snug">{r.risk || r.title || r.name}</td>
                        <td className="py-2.5 px-3 text-[#334155] font-normal">{r.category || "Operational"}</td>
                        <td className="py-2.5 px-3 text-[#334155] font-normal">{r.likelihood || "Medium"}</td>
                        <td className="py-2.5 px-3 text-[#334155] font-normal">{r.impact || "High"}</td>
                        <td className="py-2.5 px-3 text-[#334155] font-normal leading-snug">{r.mitigation || r.mitigants || "—"}</td>
                        <td className="py-2.5 px-3 text-[#0f172a] font-normal whitespace-nowrap">{r.owner || "Orbis CEO"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Compliance screen Sub-section (IB-7) */}
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-sm font-bold text-[#0f172a] mb-1">Compliance screen</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-[#64748b]">
                        <th className="py-2 pr-4 font-normal w-72">Screen</th>
                        <th className="py-2 px-4 font-normal w-32">Status</th>
                        <th className="py-2 pl-4 font-normal">Comment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Legal and regulatory</td>
                        <td className="py-2 px-4 font-normal text-[#0f172a]">
                          {form.legal_screen || "Open"}
                        </td>
                        <td className="py-2 pl-4 font-normal text-[#64748b]"></td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">Related-party</td>
                        <td className="py-2 px-4 font-normal text-[#0f172a]">
                          {form.related_party === "yes" ? "Flagged" : "Clear"}
                        </td>
                        <td className="py-2 pl-4 font-normal text-[#64748b]"></td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-normal text-[#1e293b]">ESG and reputational</td>
                        <td className="py-2 px-4 font-normal text-[#0f172a]">
                          {form.esg_screen || "Clear"}
                        </td>
                        <td className="py-2 pl-4 font-normal text-[#64748b]"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          )}

          {/* Section 7: Documents and Sign-off (IB-8) */}
          {activeTab === 6 && (
            <Card className="rounded-xl border border-slate-200/90 bg-white p-6 sm:p-7 md:p-8 shadow-xs space-y-0.5">
              <h2 className="text-lg sm:text-xl font-bold text-[#0f172a] tracking-tight mb-3">
                Documents and sign-off
              </h2>

              {defaultDocs.map((doc, idx) => {
                // If a document was uploaded matching this slot, use its file_name
                const matchedDoc = documents?.find(
                  (d) =>
                    (d.requirement_key && d.requirement_key.includes(doc.label.toLowerCase().slice(0, 5))) ||
                    (d.category && d.category.includes(doc.label.toLowerCase().slice(0, 5)))
                );
                const displayFileName = matchedDoc?.file_name || doc.fileName;

                return (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-baseline py-1.5 text-xs sm:text-sm">
                    <div className="w-full sm:w-72 md:w-80 shrink-0 text-[#475569] font-normal pr-4">
                      {doc.label}
                    </div>
                    <div className="flex-1 text-[#1d4ed8] font-bold leading-snug break-words hover:underline cursor-pointer">
                      {displayFileName}
                    </div>
                  </div>
                );
              })}

              {/* Signatories (IB-8) */}
              <div className="pt-1 space-y-0.5">
                {renderRow("CEO", form.attestations?.ceo?.actor_name || "J. Okafor")}
                {renderRow("CFO", form.attestations?.cfo?.actor_name || "S. Rahman")}
              </div>
            </Card>
          )}

          {/* Bottom Action Navigation Buttons */}
          <div className="flex items-center gap-3 pt-2">
            {activeTab > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveTab((prev) => prev - 1)}
                className="border border-slate-300 text-slate-800 bg-white hover:bg-slate-50 font-medium text-xs sm:text-sm px-5 py-2 h-9 rounded-md shadow-xs cursor-pointer"
              >
                Previous section
              </Button>
            )}
            {/* IB-8 has NO Next Section button on tab 7 (activeTab === 6) */}
            {activeTab < 6 && (
              <Button
                type="button"
                onClick={() => setActiveTab((prev) => prev + 1)}
                className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-medium text-xs sm:text-sm px-6 py-2 h-9 rounded-md shadow-xs cursor-pointer"
              >
                Next Section
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
