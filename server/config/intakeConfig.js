// ---------------------------------------------------------------------------
// Opportunity intake configuration (REQ-SUB-01, REQ-SUB-02, REQ-SUB-03,
// REQ-RULE-02/03/05/07).
//
// The submission is a fixed six-page Opportunity Overview (BRD §3.1–§3.2) plus
// the header key facts and the two-level Accretion Statement (§3.3). This module
// is the single source of truth for that structure: the ordered sections, the
// structured fields each section captures, and the appetite/floor/hurdle
// constants the self-screen and gate checks read. gate.js derives
// OPPORTUNITY_FIELDS from here so the capture form, the completeness gate and
// the generated memo cannot drift apart.
//
// `required: true` marks a field the document gate blocks on. The established
// header + narrative minimum stays required; the newly added six-section fields
// are captured and scored for section progress but do not yet block submission
// (blocking is delivered by the qualifying-gate checklist, W1-05).
// ---------------------------------------------------------------------------

// Ordered sections of the submission pack. `number` is the BRD page order.
export const OVERVIEW_SECTIONS = [
  { key: 'header',               number: 0, label: 'Key facts (header)',            description: 'Deal identity, size and funding basics (§3.1).' },
  { key: 'executive_summary',    number: 1, label: 'Executive summary',             description: 'One page: opportunity, decision sought, headline value and returns, recommendation (§3.2.1).' },
  { key: 'opportunity_overview', number: 2, label: 'Opportunity overview',          description: 'What / where / deal shape / status, target snapshot and why the subsidiary wants it (§3.2.2).' },
  { key: 'rationale',            number: 3, label: 'Rationale & strategic fit',     description: 'Why this / why now / why us with evidence, strategy link and value at two levels (§3.2.3).' },
  { key: 'financials',           number: 4, label: 'Financials & returns vs hurdles', description: 'Summary model, three-scenario returns, entry valuation and exit (§3.2.4).' },
  { key: 'funding',              number: 5, label: 'Funding & key asks',            description: 'Key asks, funding sources and status, budget status, next steps and timeline (§3.2.5).' },
  { key: 'risks',                number: 6, label: 'Risks & compliance',            description: 'Risk register with named owners and the legal / related-party / ESG compliance screen (§3.2.6).' },
  { key: 'accretion',            number: 7, label: 'Accretion statement',           description: 'Two-level accretion: subsidiary net earnings and bps, plus the Sirius-portfolio rationale (§3.3, REQ-SUB-02).' },
];

export const SECTION_KEYS = OVERVIEW_SECTIONS.map((s) => s.key);

// Eligible opportunity types (REQ-RULE-03 / D2 §3) and the outside-appetite
// types the self-screen stops (REQ-RULE-04 / D2 §3).
export const ELIGIBLE_TYPES = [
  { value: 'strategic_acquisition', label: 'Strategic acquisition' },
  { value: 'organic_expansion', label: 'Organic expansion & capex' },
  { value: 'greenfield', label: 'Greenfield / new venture' },
  { value: 'jv_partnership', label: 'JV & partnership' },
  { value: 'bolt_on', label: 'Bolt-on / consolidation' },
  { value: 'structured_financial', label: 'Structured / financial' },
  { value: 'technology_ip', label: 'Technology / IP & resources' },
];

export const OUTSIDE_APPETITE_TYPES = [
  { value: 'passive_punt', label: 'Passive, non-strategic punt' },
  { value: 'distressed_turnaround', label: 'Turnaround / distressed without a resourced plan' },
  { value: 'related_party_governance', label: 'Related-party failing arm\'s-length governance' },
];

// Sourcing channels (REQ-GATE-08). Canonical here so the capture form and the
// related-party auto-flag read the same list.
export const SOURCING_CHANNELS = [
  { value: 'ihc_affiliate_referral', label: 'IHC / affiliate referral', related_by_default: true },
  { value: 'banker_advisor', label: 'Banker / advisor-led', related_by_default: false },
  { value: 'proprietary', label: 'Proprietary / direct', related_by_default: false },
  { value: 'portfolio_bolt_on', label: 'Portfolio-company bolt-on', related_by_default: false },
  { value: 'government_dge', label: 'Government / DGE-adjacent', related_by_default: false },
];

// Floor, appetite and hurdle constants (REQ-RULE-02/05/07). All bracketed
// numbers are configuration, not hard-coded at the call site (REQ-RULE-10).
export const MIN_COMMITMENT_AED_MN = 10;
export const BELOW_FLOOR_EXCEPTION_IRR = 35;

export const RETURN_HURDLES = [
  { key: 'equity_irr',  label: 'Equity IRR',                threshold: 20, greenfield: 25, unit: '%',  comparator: 'gte' },
  { key: 'roic',        label: 'ROIC (>= WACC + 5%)',       threshold: null,               unit: '%',  comparator: 'gte' },
  { key: 'payback',     label: 'Payback',                   threshold: 3.5,                unit: 'yrs', comparator: 'lte' },
  { key: 'concentration', label: 'Single-deal concentration', threshold: 35,               unit: '%',  comparator: 'lte' },
  { key: 'leverage',    label: 'Net debt / EBITDA',         threshold: 3,                  unit: 'x',  comparator: 'lte' },
];

// The structured capture model. Every entry becomes an OPPORTUNITY_FIELDS row
// (gate.js) and a rendered input (SubmitOpportunity.jsx). `type` drives the
// input control; `options` is required for select fields.
export const INTAKE_FIELDS = [
  // --- header: key facts (§3.1) ------------------------------------------
  { key: 'opportunity_name',      label: 'Opportunity name',          section: 'header', type: 'text',   required: true },
  { key: 'opportunity_type',      label: 'Opportunity type',          section: 'header', type: 'select', required: true,
    options: [...ELIGIBLE_TYPES, ...OUTSIDE_APPETITE_TYPES] },
  { key: 'target_name',           label: 'Target / counterparty',     section: 'header', type: 'text',   required: true },
  { key: 'sector',                label: 'Sector',                    section: 'header', type: 'text',   required: true },
  { key: 'geography',             label: 'Geography',                 section: 'header', type: 'text',   required: true },
  { key: 'total_commitment_aed',  label: 'Total commitment (AED mn)', section: 'header', type: 'number', required: true },
  { key: 'ask_aed',               label: 'Ask from Sirius (AED mn)',  section: 'header', type: 'number', required: true },
  { key: 'funding_source',        label: 'Funding source',            section: 'header', type: 'text',   required: true },
  { key: 'in_approved_budget',    label: 'In approved budget?',       section: 'header', type: 'select', required: true,
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  { key: 'target_signing_close',  label: 'Target signing / close',    section: 'header', type: 'text',   required: true },
  { key: 'sourcing_channel',      label: 'Sourcing channel',          section: 'header', type: 'select', options: SOURCING_CHANNELS.map(({ value, label }) => ({ value, label })) },
  { key: 'related_party_disclosure', label: 'Related-party / affiliate involvement', section: 'header', type: 'textarea' },

  // --- narrative essentials (retained minimum set) -----------------------
  { key: 'narrative_what',        label: 'What (narrative)',          section: 'executive_summary', type: 'textarea', required: true },
  { key: 'narrative_why_now',     label: 'Why now (narrative)',       section: 'rationale',         type: 'textarea', required: true },
  { key: 'narrative_why_us',      label: 'Why us (narrative)',        section: 'rationale',         type: 'textarea', required: true },
  { key: 'decision_sought',       label: 'Decision sought',           section: 'funding',           type: 'textarea', required: true },

  // --- 1. executive summary (§3.2.1) -------------------------------------
  { key: 'exec_summary_recommendation', label: 'Recommendation',      section: 'executive_summary', type: 'textarea' },
  { key: 'exec_summary_headline_value', label: 'Headline value',      section: 'executive_summary', type: 'textarea' },

  // --- 2. opportunity overview (§3.2.2) ----------------------------------
  { key: 'snapshot_founded',            label: 'Founded',             section: 'opportunity_overview', type: 'text' },
  { key: 'snapshot_hq',                 label: 'Headquarters',        section: 'opportunity_overview', type: 'text' },
  { key: 'snapshot_employees',          label: 'Employees',           section: 'opportunity_overview', type: 'number' },
  { key: 'snapshot_revenue_last_fy_aed', label: 'Revenue last FY (AED mn)', section: 'opportunity_overview', type: 'number' },
  { key: 'snapshot_ebitda_last_fy_aed', label: 'EBITDA last FY (AED mn)',  section: 'opportunity_overview', type: 'number' },
  { key: 'snapshot_current_ownership',  label: 'Current ownership',   section: 'opportunity_overview', type: 'text' },
  { key: 'strategic_objective',         label: 'Strategic objective',  section: 'opportunity_overview', type: 'textarea' },
  { key: 'build_buy_partner',           label: 'Build / buy / partner', section: 'opportunity_overview', type: 'select',
    options: [
      { value: 'build', label: 'Build' },
      { value: 'buy', label: 'Buy' },
      { value: 'partner', label: 'Partner' },
    ] },
  { key: 'cost_of_not_doing',           label: 'Cost of not doing it', section: 'opportunity_overview', type: 'textarea' },

  // --- 3. rationale & strategic fit (§3.2.3) -----------------------------
  { key: 'rationale_evidence',      label: 'Why this (evidence)',       section: 'rationale', type: 'textarea' },
  { key: 'market_data_evidence',    label: 'Market data & validation',  section: 'rationale', type: 'textarea' },
  { key: 'comparable_transactions', label: 'Comparable transactions',   section: 'rationale', type: 'textarea' },
  { key: 'strategy_link',           label: 'Link to Sirius strategy',   section: 'rationale', type: 'textarea' },
  { key: 'concentration_impact',    label: 'Portfolio concentration impact', section: 'rationale', type: 'textarea' },

  // --- 4. financials & returns (§3.2.4) ----------------------------------
  { key: 'financials_summary_attached', label: 'Financial summary attached?', section: 'financials', type: 'select',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  { key: 'statements_3_attached',   label: 'Three-statement model attached?', section: 'financials', type: 'select',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  { key: 'return_irr_base',         label: 'Equity IRR — base (%)',     section: 'financials', type: 'number' },
  { key: 'return_irr_upside',       label: 'Equity IRR — upside (%)',   section: 'financials', type: 'number' },
  { key: 'return_irr_downside',     label: 'Equity IRR — downside (%)', section: 'financials', type: 'number' },
  { key: 'return_roic_base',        label: 'ROIC — base (%)',           section: 'financials', type: 'number' },
  { key: 'return_roic_upside',      label: 'ROIC — upside (%)',         section: 'financials', type: 'number' },
  { key: 'return_roic_downside',    label: 'ROIC — downside (%)',       section: 'financials', type: 'number' },
  { key: 'return_payback_years',    label: 'Payback — base (years)',     section: 'financials', type: 'number' },
  { key: 'return_payback_upside',   label: 'Payback — upside (years)',   section: 'financials', type: 'number' },
  { key: 'return_payback_downside', label: 'Payback — downside (years)', section: 'financials', type: 'number' },
  { key: 'return_moic_base',        label: 'MOIC — base (x)',            section: 'financials', type: 'number' },
  { key: 'return_moic_upside',      label: 'MOIC — upside (x)',          section: 'financials', type: 'number' },
  { key: 'return_moic_downside',    label: 'MOIC — downside (x)',        section: 'financials', type: 'number' },
  // Per-opportunity WACC override (W2-05 / FIN-05). The entity default applies
  // unless the preparer overrides it; an override requires a reason. Neither
  // field blocks submission — a missing reason is flagged for review.
  { key: 'wacc_override_pct',       label: 'WACC override (%; entity default applies if blank)', section: 'financials', type: 'number' },
  { key: 'wacc_override_reason',    label: 'WACC override reason',      section: 'financials', type: 'textarea' },
  { key: 'entry_valuation_aed',     label: 'Entry valuation (AED mn)',  section: 'financials', type: 'number' },
  { key: 'entry_multiple',          label: 'Entry multiple (x)',        section: 'financials', type: 'number' },
  { key: 'exit_route',              label: 'Exit route',                section: 'financials', type: 'text' },
  { key: 'exit_timing',             label: 'Exit timing',               section: 'financials', type: 'text' },
  // Entry valuation and exit (W2-08 / FIN-09). The basis states whether the
  // entry figure is EV or equity value and the method how it was derived; the
  // comparable set is captured as a nested block (valuation_comparables) and
  // the exit carries a target multiple. All advisory — a partial capture is
  // flagged, never blocked.
  { key: 'entry_valuation_basis',   label: 'Entry valuation basis',     section: 'financials', type: 'select',
    options: [
      { value: 'ev', label: 'Enterprise value (EV)' },
      { value: 'equity', label: 'Equity value' },
    ] },
  { key: 'entry_valuation_method',  label: 'Valuation method',          section: 'financials', type: 'select',
    options: [
      { value: 'trading_comps', label: 'Trading comparables' },
      { value: 'precedent_transactions', label: 'Precedent transactions' },
      { value: 'dcf', label: 'Discounted cash flow' },
      { value: 'asset_based', label: 'Asset-based' },
      { value: 'other', label: 'Other (state in the rationale)' },
    ] },
  { key: 'exit_multiple',           label: 'Exit multiple (x)',         section: 'financials', type: 'number' },
  // Cross-border considerations (W2-09 / FIN-08). Captured only when the target
  // geography differs from the owning subsidiary's home country; all four are
  // advisory free-text, so none is marked required (the 14-key minimum stands).
  { key: 'cross_border_fx',               label: 'FX exposure',               section: 'financials', type: 'textarea' },
  { key: 'cross_border_wht',              label: 'Withholding tax',           section: 'financials', type: 'textarea' },
  { key: 'cross_border_transfer_pricing', label: 'Transfer pricing',          section: 'financials', type: 'textarea' },
  { key: 'cross_border_repatriation',     label: 'Repatriation restrictions', section: 'financials', type: 'textarea' },
  // Reporting currency and per-opportunity FX rate (W2-10 / NFR-08). Figures
  // are AED mn by default; a deal reported in USD records the rate used (AED
  // per USD) so every figure is reproducible against the AED base. Neither
  // field blocks submission — a missing rate is flagged for review.
  { key: 'reporting_currency',           label: 'Reporting currency',    section: 'financials', type: 'select',
    options: [
      { value: 'AED', label: 'AED — UAE dirham (Sirius base)' },
      { value: 'USD', label: 'USD — US dollar' },
    ] },
  { key: 'fx_rate_usd_aed',              label: 'FX rate (AED per USD; required when reporting in USD)', section: 'financials', type: 'number' },
  // Below-floor exception inputs (W1-02 / INT-03). Only required when a
  // sub-floor ticket takes the exception route; the IRR is read from
  // return_irr_base above, so the two fields together satisfy the rule.
  { key: 'below_floor_synergy_case', label: 'Portfolio-synergy statement (below-floor exception)', section: 'financials', type: 'textarea' },

  // --- 5. funding & key asks (§3.2.5) ------------------------------------
  { key: 'sirius_capital_aed',      label: 'Sirius capital / guarantee (AED mn)', section: 'funding', type: 'number' },
  { key: 'funding_sources_status',  label: 'Funding sources status',    section: 'funding', type: 'select',
    options: [
      { value: 'secured', label: 'Secured' },
      { value: 'committed', label: 'Committed' },
      { value: 'indicative', label: 'Indicative' },
    ] },
  { key: 'budget_status',           label: 'Budget status',             section: 'funding', type: 'select',
    options: [
      { value: 'in_budget', label: 'In approved budget' },
      { value: 'variance_justified', label: 'Off-budget, variance justified' },
    ] },
  // Budget status (W2-07 / FIN-07). The line reference is captured when the deal
  // is in the approved budget; the variance justification is captured when it is
  // off-budget, where a variance-memo upload also becomes mandatory.
  { key: 'budget_line_reference',   label: 'Budget line reference',      section: 'funding', type: 'text' },
  { key: 'variance_justification',  label: 'Variance justification (off-budget)', section: 'funding', type: 'textarea' },
  { key: 'decision_by_date',        label: 'Decision-by date',          section: 'funding', type: 'text' },
  { key: 'next_steps',              label: 'Next steps & timeline',     section: 'funding', type: 'textarea' },

  // Greenfield extra tests (W1-07 / INT-10). Only required when the opportunity
  // is a greenfield / new venture; the gate reads them only for that type.
  { key: 'greenfield_stage', label: 'Greenfield stage', section: 'funding', type: 'select',
    options: [
      { value: 'concept', label: 'Concept' },
      { value: 'feasibility', label: 'Feasibility' },
      { value: 'initiate', label: 'Initiate' },
    ] },
  { key: 'greenfield_benefit', label: 'Quantified benefit & why now (greenfield)', section: 'funding', type: 'textarea' },
  { key: 'greenfield_secured_funding_source', label: 'Secured funding source (greenfield)', section: 'funding', type: 'text' },

  // --- 6. risks & compliance (§3.2.6) ------------------------------------
  { key: 'risk_register',           label: 'Risk register (5–8 risks with named owners)', section: 'risks', type: 'textarea' },
  { key: 'compliance_legal',        label: 'Legal & regulatory',        section: 'risks', type: 'select',
    options: [{ value: 'clear', label: 'Clear' }, { value: 'open', label: 'Open' }] },
  { key: 'compliance_related_party', label: 'Related-party',            section: 'risks', type: 'select',
    options: [{ value: 'clear', label: 'Clear' }, { value: 'open', label: 'Open' }] },
  { key: 'compliance_esg',          label: 'ESG & reputational',        section: 'risks', type: 'select',
    options: [{ value: 'clear', label: 'Clear' }, { value: 'open', label: 'Open' }] },

  // Gate 1 hard-filter confirmations (W3-02 / SCR-03). Two are manual
  // compliance verdicts and one is the portfolio-conflict mitigation verdict
  // with a named reviewer. None is required (the documented 14-key minimum
  // stands); an unconfirmed filter is flagged, never a silent pass.
  { key: 'hard_filter_sanctions',   label: 'Sanctions / export-control / reputational', section: 'risks', type: 'select',
    options: [
      { value: 'clear', label: 'Clear — no exposure' },
      { value: 'exposure', label: 'Exposure identified' },
    ] },
  { key: 'hard_filter_sanctions_note', label: 'Sanctions / exposure note', section: 'risks', type: 'textarea' },
  { key: 'hard_filter_structuring', label: 'ADGM / DIFC-compatible structuring', section: 'risks', type: 'select',
    options: [
      { value: 'compatible', label: 'Compatible' },
      { value: 'exception_needed', label: 'Exception needed' },
    ] },
  { key: 'hard_filter_structuring_note', label: 'Structuring note', section: 'risks', type: 'textarea' },
  { key: 'hard_filter_portfolio_conflict', label: 'Portfolio conflict', section: 'risks', type: 'select',
    options: [
      { value: 'none', label: 'None with an existing holding' },
      { value: 'mitigated', label: 'Mitigated with a named reviewer' },
      { value: 'unmitigable', label: 'Un-mitigable' },
    ] },
  { key: 'hard_filter_conflict_reviewer', label: 'Conflict reviewer (named)', section: 'risks', type: 'text' },

  // Sanctions / adverse-media manual confirmation (W3-12 / SCR-08). Sanctions
  // and adverse-media screening is a manual, human-verified step: the analyst
  // records a verdict, the source of the screen and a supporting note, and
  // attaches the evidence. None is required (the documented 14-key minimum
  // stands); an unconfirmed exposure is flagged, never a silent pass.
  { key: 'adverse_media_confirmation', label: 'Sanctions / adverse-media confirmation', section: 'risks', type: 'select',
    options: [
      { value: 'clear', label: 'Clear — no adverse media or sanctions exposure' },
      { value: 'adverse', label: 'Adverse media / sanctions exposure identified' },
      { value: 'pending', label: 'Pending — screening not complete' },
    ] },
  { key: 'adverse_media_source', label: 'Screening source / provider', section: 'risks', type: 'text' },
  { key: 'adverse_media_note', label: 'Adverse-media confirmation note', section: 'risks', type: 'textarea' },
  { key: 'adverse_media_evidence_reference', label: 'Evidence reference (report id / link)', section: 'risks', type: 'text' },
  { key: 'adverse_media_reviewed_by', label: 'Screened by (named)', section: 'risks', type: 'text' },

  // --- Gate 1 soft filters (W3-03 / SCR-04): scored, never used to kill ----
  // The three soft filters are scored 1-5. Two are proposed from structured
  // data; the third reads the captured management-interaction verdict. The
  // notes are the evidence for a proposed score. None is required (the
  // documented 14-key minimum stands); a blank verdict proposes neutral.
  { key: 'soft_filter_adjacency_note', label: 'Portfolio adjacency note', section: 'risks', type: 'textarea' },
  { key: 'soft_filter_national_priorities_note', label: 'UAE national-priorities note', section: 'risks', type: 'textarea' },
  { key: 'soft_filter_management_openness', label: 'Management openness to an active investor', section: 'risks', type: 'select',
    options: [
      { value: 'open', label: 'Open — receptive to an active investor' },
      { value: 'neutral', label: 'Neutral — depends on terms' },
      { value: 'resistant', label: 'Reluctant — prefers a passive holder' },
    ] },
  { key: 'soft_filter_management_openness_note', label: 'Management openness note', section: 'risks', type: 'textarea' },

  // --- Automatic disqualifiers (W3-04 / SCR-05): flags a reviewer must clear --
  // The five automatic disqualifiers. Each is recorded here; a present
  // disqualifier raises a flag that a reviewer clears with a named reviewer and
  // a reason. None is required (the documented 14-key minimum stands); an
  // unrecorded disqualifier is not evaluated, never a silent clear.
  { key: 'disqualifier_sanctions_pep', label: 'Sanctions / PEP exposure without mitigation', section: 'risks', type: 'select',
    options: [
      { value: 'no', label: 'No — no unmitigated exposure' },
      { value: 'yes', label: 'Yes — exposure present' },
    ] },
  { key: 'disqualifier_sanctions_pep_note', label: 'Sanctions / PEP note', section: 'risks', type: 'textarea' },
  { key: 'disqualifier_minority_protections', label: 'No enforceable minority protections', section: 'risks', type: 'select',
    options: [
      { value: 'no', label: 'No — protections are enforceable' },
      { value: 'yes', label: 'Yes — no enforceable protections' },
    ] },
  { key: 'disqualifier_minority_protections_note', label: 'Minority-protections note', section: 'risks', type: 'textarea' },
  { key: 'disqualifier_valuation_premium_pct', label: 'Valuation premium over the tightest comparable (%)', section: 'risks', type: 'number' },
  { key: 'disqualifier_valuation_premium_note', label: 'Valuation-premium note', section: 'risks', type: 'textarea' },
  { key: 'disqualifier_undisclosed_related_party', label: 'Undisclosed related party found after Gate 1', section: 'risks', type: 'select',
    options: [
      { value: 'no', label: 'No — none found' },
      { value: 'yes', label: 'Yes — one found' },
    ] },
  { key: 'disqualifier_undisclosed_related_party_note', label: 'Undisclosed related-party note', section: 'risks', type: 'textarea' },
  { key: 'disqualifier_licence_transferable', label: 'Material licence is non-transferable', section: 'risks', type: 'select',
    options: [
      { value: 'no', label: 'No — the licence is transferable' },
      { value: 'yes', label: 'Yes — the licence is non-transferable' },
    ] },
  { key: 'disqualifier_licence_transferable_note', label: 'Licence-transferability note', section: 'risks', type: 'textarea' },

  // --- accretion statement (§3.3, REQ-SUB-02) ----------------------------
  { key: 'accretion_net_earnings_aed', label: 'Adds net earnings (AED mn)', section: 'accretion', type: 'number' },
  { key: 'accretion_bps',              label: 'Adds return (bps)',         section: 'accretion', type: 'number' },
  { key: 'sirius_accretion_rationale', label: 'Accretive to the Sirius portfolio because…', section: 'accretion', type: 'textarea' },
];

export const INTAKE_FIELD_KEYS = INTAKE_FIELDS.map((f) => f.key);

export function sectionsWithFields() {
  return OVERVIEW_SECTIONS.map((section) => ({
    ...section,
    fields: INTAKE_FIELDS.filter((f) => f.section === section.key),
  }));
}

export function fieldsForSection(sectionKey) {
  return INTAKE_FIELDS.filter((f) => f.section === sectionKey);
}

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Per-section capture progress for a set of opportunity data, in page order. */
export function sectionProgress(data = {}) {
  return OVERVIEW_SECTIONS.map((section) => {
    const fields = fieldsForSection(section.key);
    const present = fields.filter((f) => !isBlank(data[f.key])).length;
    return {
      key: section.key,
      number: section.number,
      label: section.label,
      present,
      total: fields.length,
      complete: fields.length > 0 && present === fields.length,
      progress: fields.length === 0 ? 0 : Math.round((present / fields.length) * 100),
    };
  });
}

/** True when the type is outside appetite (REQ-RULE-04 / self-screen W1-01). */
export function isOutsideAppetite(type) {
  return OUTSIDE_APPETITE_TYPES.some((t) => t.value === type);
}

/** True when the total commitment clears the AED 10mn floor (REQ-RULE-02). */
export function clearsFloor(totalCommitmentAedMn) {
  const n = Number(totalCommitmentAedMn);
  if (Number.isNaN(n)) return false;
  return n >= MIN_COMMITMENT_AED_MN;
}

export default {
  OVERVIEW_SECTIONS, SECTION_KEYS, INTAKE_FIELDS, INTAKE_FIELD_KEYS,
  ELIGIBLE_TYPES, OUTSIDE_APPETITE_TYPES, MIN_COMMITMENT_AED_MN,
  BELOW_FLOOR_EXCEPTION_IRR, RETURN_HURDLES,
  sectionsWithFields, fieldsForSection, sectionProgress, isOutsideAppetite, clearsFloor,
};
