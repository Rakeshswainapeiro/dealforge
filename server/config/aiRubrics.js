// ---------------------------------------------------------------------------
// Per-tab review rubrics.
//
// A "rubric" is expert guidance that the per-tab AI review (server/config/
// aiReview.js) may apply on four tabs only: Opportunity overview, Rationale and
// fit, Financials and returns, Funding and key asks. This module holds the
// switches, versions and guidance text. Phase status: all four rubric tabs are
// live (version 2): Financials and returns, Funding and key asks, Rationale and
// fit, and Opportunity overview.
//
// Pure functions only - no database, no network, no side effects on import.
//
//   1. WHICH TABS   RUBRIC_TABS. Executive summary, Risks and compliance and
//                   Documents are not rubric tabs and can never be switched on:
//                   every function below returns "off" for them, whatever the
//                   environment or a test override says.
//   2. ON / OFF     one switch per tab, all four ON by default. Override with the environment
//                   variable AI_RUBRIC_TABS ("all", "none", or a comma list of tab
//                   keys, e.g. "financials,funding"); "none" restores the
//                   pre-rubric behaviour exactly. Read at call time.
//   3. VERSIONS     one integer per tab. The version of an ENABLED tab is folded
//                   into that tab's input hash (hashTabInputs), so raising one
//                   tab's version makes only that tab's stored results stale.
//                   A disabled tab contributes nothing to its hash, so switching
//                   a tab off restores its previous hash exactly.
//   4. TOLERANCES   proposed starting values for the rubric checks.
//   5. GUIDANCE     the expert guidance applied to a tab's AI analysis, only
//                   while that tab's rubric is on.
//
// Raising a version is the way to say "the guidance changed; re-run the tab".
// ---------------------------------------------------------------------------

/** The only tabs a rubric may ever apply to. */
export const RUBRIC_TABS = Object.freeze(['opportunity_overview', 'rationale', 'financials', 'funding']);

/** On only for a tab whose guidance has shipped: Financials (Phase 2), Funding (Phase 3), Rationale (Phase 4), Opportunity overview (Phase 5). */
export const RUBRIC_DEFAULT_ENABLED = Object.freeze({
  opportunity_overview: true,
  rationale: true,
  financials: true,
  funding: true,
});

/**
 * Independent per-tab versions. Bump ONE entry when that tab's guidance changes.
 * Never reuse a number. (Only an enabled tab's version is hashed.)
 */
export const RUBRIC_VERSIONS = Object.freeze({
  opportunity_overview: 2, // 2: paraphrased commercial-diligence guidance, four checks on existing fields, claims_evidenced, dd_red_flags and the Not-enough-evidence rules (Phase 5)
  rationale: 2, // 2: paraphrased M&A guidance, two checks, the valuation-basis cross-check and buy_vs_build_reasoned (Phase 4)
  financials: 2, // 2: original guidance, three logic checks, the FX peg check, engine plausibility and assumptions_reasonable (Phase 2)
  funding: 2, // 2: original guidance, three funding checks and funding_plan_holds (Phase 3)
});

/** The environment variable that overrides the default switches. */
export const RUBRIC_ENV_VAR = 'AI_RUBRIC_TABS';

/**
 * Where each tab's guidance comes from. Recorded so the provenance is settled
 * before any text is written. `status` stays 'scaffold' until guidance exists.
 */
export const RUBRIC_SOURCES = Object.freeze({
  opportunity_overview: {
    origin: 'third_party', status: 'active',
    repo: 'gcamilo/management-consulting', path: 'variants/due-diligence.md', license: 'MIT',
    commit: 'dd2d099dc390811015c16ecac306415d62b31008',
    copyright: 'Copyright (c) 2026 (the licence file names no holder)',
    attribution: 'Adapted (paraphrased) from the commercial due diligence variant in https://github.com/gcamilo/management-consulting (MIT).',
    note: 'Paraphrased, not copied. Uses existing intake fields and attached documents only (decision D2): customer concentration, retention, churn and recurring share are not captured anywhere, so they are never inferred and are reported as "Not enough evidence". The skill\'s deliverables (risk matrix, A/B/C/F scorecard, charts, proceed or walk-away recommendation) are not used. The MIT notice is reproduced in docs/ai-rubric-phase0-audit.md.',
  },
  rationale: {
    origin: 'third_party', status: 'active',
    repo: 'alirezarezvani/claude-skills', path: 'c-level-advisor/skills/ma-playbook/SKILL.md', license: 'MIT',
    commit: '91a1ddaab1ae8fe95b8ecd3e98419458db86a992',
    copyright: 'Copyright (c) 2025 Alireza Rezvani',
    attribution: 'Adapted (paraphrased, acquiring side only) from the ma-playbook skill by Alireza Rezvani, https://github.com/alirezarezvani/claude-skills (MIT).',
    note: 'Paraphrased, not copied. The skill\'s illustrative valuation multiples and prices, its sell-side half and its negotiation terms are not used. The MIT notice is reproduced in docs/ai-rubric-phase0-audit.md.',
  },
  financials: {
    origin: 'original', status: 'active',
    repo: null, path: null, license: null, commit: null,
    note: 'Written from standard finance practice and DealForge\'s own configuration. No third-party skill text is used or cited (decision D1, option B).',
  },
  funding: {
    origin: 'original', status: 'active',
    repo: null, path: null, license: null, commit: null,
    note: 'Written from standard funding-review practice and DealForge\'s own configuration (the Sirius funding order in sourcesUses.js). The corporate-treasurer skill was reviewed in full in Phase 0 and no text from it is used, so its attribution requirement is not triggered; a courtesy credit is kept in docs/ai-rubric-phase0-audit.md.',
    reviewed: {
      repo: 'theneoai/awesome-skills', path: 'skills/persona/finance/corporate-treasurer/SKILL.md',
      license: 'MIT with Attribution Requirement', commit: '61fe4f2bb47d6b61505b1b78c2b8ae5fd1ca38dd',
      courtesy_credit: 'Concepts reviewed from Awesome Skills by neo.ai (lucas_hsueh@hotmail.com); no text used.',
    },
  },
});

/**
 * Proposed starting values for checks planned for later phases. Every value is a
 * starting point awaiting Sirius confirmation (the same convention as
 * FINANCIAL_ENGINE_DEFAULTS). Everything the rubric produces is advisory. A
 * threshold below (an FX deviation, an implied holding period, a funding share)
 * is a judgement, so it can only ask for review. A contradiction in the figures
 * themselves (downside better than base, IRR and MOIC of opposite sign,
 * accretion in AED and in bps of opposite sign) is a logical conflict and may
 * fail; it still blocks nothing.
 *
 * Values already owned elsewhere are NOT repeated here and must be read from
 * their owner: return tolerances from FINANCIAL_ENGINE_DEFAULTS.tolerances, the
 * leverage ceiling from RETURN_HURDLES, the sources-equal-uses tolerance from
 * BALANCE_TOLERANCE_PCT.
 */
export const RUBRIC_TOLERANCES = Object.freeze({
  fx: Object.freeze({
    // AED is pegged to USD. A recorded rate this far from the peg is more likely
    // a typing error than a market move.
    peg_aed_per_usd: 3.6725,
    peg_tolerance_pct: 1,
  }),
  returns: Object.freeze({
    // The holding period implied by MOIC and IRR, ln(MOIC) / ln(1 + IRR), in years.
    implied_hold_years_min: 0.5,
    implied_hold_years_max: 15,
    // Downside <= base <= upside is a logical ordering, so it carries no tolerance.
    scenario_order_tolerance_pp: 0,
  }),
  overview: Object.freeze({
    // An EBITDA margin outside this range (in %) is more likely a typing error than a business.
    ebitda_margin_min_pct: -100,
    ebitda_margin_max_pct: 100,
    // Opportunity types for which the target's last-year revenue and EBITDA are expected.
    snapshot_expected_types: Object.freeze(['strategic_acquisition', 'bolt_on', 'distressed_turnaround']),
    // A document counts as holding commercial data only if its text names one of these
    // subjects AND contains a number. A minimal gate against false assurance, not proof.
    commercial_evidence_terms: Object.freeze(['customer', 'client', 'retention', 'churn', 'recurring', 'renewal', 'subscription', 'contract', 'backlog', 'concentration']),
  }),
  rationale: Object.freeze({
    // Valuation methods that rest on projections rather than on what the business has
    // delivered or on observed prices; a valuation resting on one of these alone is
    // review. 'other' says nothing about the basis, so it is review too.
    projection_based_valuation_methods: Object.freeze(['dcf']),
    unspecified_valuation_methods: Object.freeze(['other']),
  }),
  funding: Object.freeze({
    // Review when more than this share of the funding other than Sirius capital is
    // still unconfirmed (indicative, or with no status stated).
    indicative_share_review_pct: 50,
    // The plan should carry a contingency line above this amount (AED mn).
    contingency_min_aed: 0,
  }),
});

/** Values above that still need Sirius sign-off before a check relies on them. */
export const RUBRIC_NEEDS_SIRIUS_CONFIRMATION = Object.freeze(['fx', 'returns', 'funding', 'rationale', 'overview']);

// ---------------------------------------------------------------------------
// Guidance text
//
// Original wording, written from standard financial-review practice for this
// product. It is NOT copied or adapted from any third-party skill. It is the
// reviewer's checklist (it tells the analyst what to look for), not submitted
// material and not a source of figures. Keep each entry short: the analysis
// prompt is truncated from the end, and the guidance is placed near the top.
// Raise the tab's RUBRIC_VERSIONS entry whenever this text changes.
// ---------------------------------------------------------------------------
export const RUBRIC_GUIDANCE_MAX_CHARS = 1800;

/**
 * Fields from OTHER tabs that a rubric tab's checks and prompts also read. They are
 * added to the tab's context only while its rubric is on, so with the rubric off
 * the tab's context, prompts and hash are exactly what they were before. Reading
 * them also means the tab goes stale when they change, which is intended.
 */
export const RUBRIC_EXTRA_KEYS = Object.freeze({
  opportunity_overview: Object.freeze(['opportunity_type']),
  rationale: Object.freeze(['build_buy_partner', 'cost_of_not_doing', 'entry_valuation_method']),
});

export const RUBRIC_GUIDANCE = Object.freeze({
  opportunity_overview: [
    'Reviewer guidance for this tab. It is a checklist of what to look for, not submitted material and not a source of figures.',
    'Judge only from the fields and the attached documents. Where they do not hold the data a point needs, rate that point Not enough evidence and list what to ask for. Never infer a figure.',
    '1. Customers: how concentrated is the revenue, how well are customers kept over time, and how do they regard the business? A missing concentration or retention figure is itself worth stating.',
    '2. Quality of revenue: how much is contracted and recurring rather than one-off, contract length and renewals, whether prices can rise, and how revenue is recognised.',
    '3. Defensibility: how hard it is for a customer to leave, whether the product improves with use, what is proprietary, and what trust the brand commands.',
    '4. Management: the leaders\' record, dependence on a few individuals, and signs of staff turnover.',
    '5. Market: growing or merely being divided, who is gaining or losing ground, and the effect of coming regulation.',
    'Warning signs, each worth a closer look and several together a reason for caution: one customer carrying a large share of revenue, weak or falling retention, growth from one-off sources, reliance on a couple of people, an easily replaced product, leaders who cannot say why customers remain, open disputes, odd revenue recognition, heavy turnover among customer-facing staff, and a market in decline or concentrating among bigger rivals.',
    'Cautions: do not seek only facts that suit the thesis, do not accept management\'s account unchecked, and compare the target with building the capability or doing nothing.',
    'Where the only support is the subsidiary\'s own statement, say so and rate no higher than Adequate. Do not quote benchmark figures from outside the material.',
  ].join('\n'),
  financials: [
    'Reviewer guidance for this tab. It is a checklist of what to look for, not submitted material and not a source of figures.',
    '1. Take the submitted base case as given and ask what must be true for its returns to hold. Does the submission evidence each of those things, or only state them?',
    '2. Where does the value come from? Compare what comes from operating cash flow with what comes from the exit. A return that rests mostly on the exit needs firmer support for the exit multiple.',
    '3. Compare the projected growth and margin path with the history shown. Flag steep early growth, margins that widen sharply, and improvement that arrives only in the final years.',
    '4. Check that profit turns into cash. Ask about capex, working capital and tax where the projections leave them out.',
    '5. Ask how the entry and exit values were reached: which method, which comparables, and whether the exit assumes a better multiple than the entry.',
    '6. Note any departure from the entity cost of capital and whether a reason is given. Take hurdle and plausibility results from the rule-based results; do not recalculate them.',
    '7. Ask whether the downside case is a genuine stress and whether it still returns capital. Say so if no sensitivity is given.',
    '8. Note the reporting currency, the exchange rate used, and any withholding tax, transfer pricing or repatriation point the submission leaves open.',
    'Where the only support is the subsidiary\'s own statement, say so and rate no higher than Adequate. Rate a point with no support at all as Not enough evidence. Do not quote benchmark figures from outside the material.',
  ].join('\n'),
  rationale: [
    'Reviewer guidance for this tab. It is a checklist of what to look for, not submitted material and not a source of figures.',
    '1. Start with the reason. Why this opportunity, why now, why Sirius, and why by acquisition rather than by building the capability or partnering? Is the reason evidenced, or only asserted?',
    '2. Establish what is really being bought: people, technology, customers, market position or a licence. Do the thesis and the price fit that?',
    '3. Judge how hard the combination will be. Is there an integration plan with an owner and a timetable, or only an intention? Say plainly when none is given.',
    '4. See which areas of diligence the submission says were examined (financial, technical, legal, people, market, customers) and which it is silent on.',
    '5. Look at the valuation anchors offered: comparable transactions, the method, and whether the price rests on what the business has delivered or only on what is projected. Do not bring in multiples or prices of your own.',
    '6. Look at people: dependence on a few individuals, and whether the key ones are retained.',
    '7. Check the fit with the Sirius strategy and the entity mandate, and whether the synergies and the effect on portfolio concentration are quantified. Take the mandate results from the rule-based results.',
    'Treat as warning signs: no reason beyond it being a good deal, a clash of cultures that was seen and set aside, key staff not secured before completion, a price built on projections alone, and no integration plan.',
    'Where the only support is the subsidiary\'s own statement, say so and rate no higher than Adequate. Rate a point with no support at all as Not enough evidence. Do not quote benchmark figures from outside the material.',
  ].join('\n'),
  funding: [
    'Reviewer guidance for this tab. It is a checklist of what to look for, not submitted material and not a source of figures.',
    '1. Read the funding plan as a whole. Who pays for what, in what form (own cash, debt, partner capital, Sirius capital), and how firm is each part: secured, committed or only indicative?',
    '2. Test the ask against the plan. Is the Sirius request what remains after the cheaper sources, and does the decision sought match its size? Take the funding-order and sources-equal-uses results from the rule-based results; do not recalculate them.',
    '3. Look for what could break the plan. Does it lean on one source or one lender, does any part wait on an approval or condition not yet met, and does the timing of each draw follow when the money is spent?',
    '4. Ask about the debt terms the submission gives or leaves out: how long the loan runs against the life of what it pays for, whether its currency matches the currency the cash arrives in, how it is repaid, and any covenant or guarantee Sirius would be asked to stand behind.',
    '5. Look for headroom. Is there a contingency or other buffer, and would the plan survive a delay or a cost overrun without a further ask?',
    '6. Compare the budget position, the decision date and the next steps with one another. Are they consistent, and can they be met?',
    'Where the only support is the subsidiary\'s own statement, say so and rate no higher than Adequate. Rate a point with no support at all as Not enough evidence. Do not quote benchmark figures from outside the material.',
  ].join('\n'),
});

/** The extra (other-tab) field keys for a tab, or [] when its rubric is off or it has none. */
export function rubricExtraKeys(tabKey, env = process.env) {
  if (!isRubricEnabled(tabKey, env)) return [];
  return [...(RUBRIC_EXTRA_KEYS[tabKey] || [])];
}

/** The guidance for a tab, or '' when its rubric is off or it has none. */
export function rubricGuidance(tabKey, env = process.env) {
  if (!isRubricEnabled(tabKey, env)) return '';
  return RUBRIC_GUIDANCE[tabKey] || '';
}

// ---------------------------------------------------------------------------
// Switches and versions
// ---------------------------------------------------------------------------

// Test-only overrides; null in production. See _setRubricStateForTesting.
let testState = null;

/** True for the four tabs a rubric can apply to. */
export function isRubricTab(tabKey) {
  return RUBRIC_TABS.includes(tabKey);
}

// Parse AI_RUBRIC_TABS into { all, none, keys } or null when unset/blank.
function parseEnv(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const tokens = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.includes('none')) return { all: false, keys: new Set() };
  if (tokens.includes('all')) return { all: true, keys: new Set() };
  return { all: false, keys: new Set(tokens) };
}

/**
 * Whether a tab's rubric is switched on. Precedence: test override, then the
 * environment, then the defaults. Always false for a non-rubric tab.
 */
export function isRubricEnabled(tabKey, env = process.env) {
  if (!isRubricTab(tabKey)) return false;
  if (testState?.enabled && tabKey in testState.enabled) return testState.enabled[tabKey] === true;
  const fromEnv = parseEnv(env?.[RUBRIC_ENV_VAR]);
  if (fromEnv) return fromEnv.all || fromEnv.keys.has(tabKey);
  return RUBRIC_DEFAULT_ENABLED[tabKey] === true;
}

/** The tab's current rubric version, or 0 for a tab that has no rubric. */
export function rubricVersion(tabKey) {
  if (!isRubricTab(tabKey)) return 0;
  const v = testState?.versions && tabKey in testState.versions ? testState.versions[tabKey] : RUBRIC_VERSIONS[tabKey];
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * What the audit row for a validation or analysis run records about the rubric:
 * `{ rubric_version: <n> }` while the tab's rubric is on, otherwise nothing at all
 * (no key, not null), so a tab without a rubric writes exactly the audit row it
 * always did. It says which guidance produced a result, which the input hash alone
 * cannot (the hash only says whether a result is current).
 */
export function rubricAuditFields(tabKey, env = process.env) {
  const fragment = rubricHashFragment(tabKey, env);
  return fragment.rubric ? { rubric_version: fragment.rubric } : {};
}

/**
 * What a tab adds to its input hash: `{ rubric: <version> }` when its rubric is
 * enabled, otherwise an empty object. It is spread into the hashed object, so for
 * every other tab (and every disabled tab) the hashed object, and therefore the
 * hash, is exactly what it was before this module existed. Do not return
 * `{ rubric: null }` here: a null key would change the hash.
 */
export function rubricHashFragment(tabKey, env = process.env) {
  if (!isRubricEnabled(tabKey, env)) return {};
  const version = rubricVersion(tabKey);
  return version > 0 ? { rubric: version } : {};
}

// ---------------------------------------------------------------------------
// Test hooks (the same convention as tokenManager's _resetTokenStateForTesting).
// ---------------------------------------------------------------------------

/** Force switches and/or versions per tab. Keys outside RUBRIC_TABS can never enable a tab. */
export function _setRubricStateForTesting({ enabled = null, versions = null } = {}) {
  testState = { enabled: enabled ? { ...enabled } : null, versions: versions ? { ...versions } : null };
}

export function _resetRubricStateForTesting() {
  testState = null;
}

export default {
  RUBRIC_TABS, RUBRIC_DEFAULT_ENABLED, RUBRIC_VERSIONS, RUBRIC_ENV_VAR, RUBRIC_SOURCES, RUBRIC_TOLERANCES,
  RUBRIC_NEEDS_SIRIUS_CONFIRMATION, RUBRIC_GUIDANCE, RUBRIC_GUIDANCE_MAX_CHARS, RUBRIC_EXTRA_KEYS,
  isRubricTab, isRubricEnabled, rubricVersion, rubricHashFragment, rubricAuditFields, rubricGuidance, rubricExtraKeys,
};
