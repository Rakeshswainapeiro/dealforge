# AI rubric integration: Phase 0 audit and Phase 1 scaffolding

Scope: Tabs 2 (Opportunity overview), 3 (Rationale and fit), 4 (Financials and returns) and 5 (Funding and key asks). Tabs 1, 6 and 7 are out of scope and must stay byte-identical.

Status: all planned phases are complete: Phase 0 (verification), Phase 1 (scaffolding), Phase 2 (Tab 4, Financials and returns), Phase 3 (Tab 5, Funding and key asks), Phase 4 (Tab 3, Rationale and fit) and Phase 5 (Tab 2, Opportunity overview). Sections 7 to 11 record Phases 2 to 6; the third-party notices for Tabs 3 and 2 are at the end. Phase 6 (hardening and a live-model evaluation) is recorded in section 11, which also holds the rollout runbook.

Decisions in force: D1 (Tab 4 is original work, nothing copied from the `financial-analyst` skill), D2 (Tab 2 uses existing fields and documents only; missing evidence is "Not enough evidence"; no new fields or UI), D3 (a per-tab rubric version is part of the input hash for Tabs 2-5).

## 1. Sources and licensing

| Tab | Source | Commit read | License | Status |
|---|---|---|---|---|
| 2 | `gcamilo/management-consulting` `variants/due-diligence.md` | `dd2d099` | MIT | Usable by paraphrase with attribution. |
| 3 | `alirezarezvani/claude-skills` `c-level-advisor/skills/ma-playbook/SKILL.md` | `91a1dda` | MIT | Usable by paraphrase with attribution. Its valuation multiples are labelled illustrative and are not to be used. |
| 4 | none (original) | n/a | n/a | D1: no text from `borghei/Claude-Skills` is used or cited. That repository is MIT plus the Commons Clause, which bars selling a product whose value derives substantially from the software. |
| 5 | `theneoai/awesome-skills` `skills/persona/finance/corporate-treasurer/SKILL.md` | `61fe4f2` | MIT with Attribution Requirement | Usable, with conditions below. |

### Tab 5 license: full text read

The license is MIT plus an attribution requirement. Any distribution, modification or use "in whole or in part" must:

1. retain and display the line **"Based on Awesome Skills by neo.ai (lucas_hsueh@hotmail.com)"**;
2. include a copy of the license or a reference to `https://github.com/theneoai/awesome-skills/blob/main/LICENSE`;
3. clearly indicate any modifications made to the original work.

This is workable, not a blocker. The attribution string is recorded in `RUBRIC_SOURCES.funding.attribution` and a test pins it. Before Phase 3 (Tab 5) ships, the notice must be placed where users of the guidance can see it (this document is not enough on its own) and the modification notice must be written.

### Tab 5 references: all seven read

| File | Content | Use for DealForge |
|---|---|---|
| `treasury-frameworks.md` | Cash positioning tiers; funding source hierarchy (internal cash, commercial paper, revolver, term debt, equity) | Conflicts with the Sirius hierarchy in `sourcesUses.js` (accruals, subsidiary debt, partner capital, Sirius capital). The Sirius hierarchy is authoritative; this table must not be applied. |
| `risk-documentation.md` | Six treasury risks with mitigations (liquidity, FX, interest rate, counterparty, concentration, cyber) | Liquidity, FX, interest-rate and concentration risk are relevant as qualitative prompts for funding plans. |
| `philosophy.md` | Operating model; four principles (safety before yield, forecast aggressively and hedge conservatively, relationships, standardisation) | Largely about running a treasury function. Little applies to an investment funding request. |
| `standards.md` | Working-capital metrics (DSO, DPO, DIO, CCC) and hedging instruments | Not applicable to a funding-request form. |
| `capabilities-use-cases.md`, `toolkit.md`, `examples.md` | Treasury tasks, vendor tools, five worked examples (13-week forecast, refinancing, EUR hedging, DSO, investment policy) | Not applicable. `examples.md` contains US-dollar figures and thresholds that must not be quoted. |

Conclusion: the Tab 5 skill and its references contribute only a few qualitative prompts (liquidity buffer, funding diversification, rate and currency exposure, counterparty concentration). Most of the material is out of scope. Expect Tab 5 guidance to be short, and consider writing it as original text (as for Tab 4) if the attribution burden outweighs the content taken. This is a decision for the Phase 3 gate, not now.

## 2. Duplication audit of existing financial and funding checks

The earlier plan proposed new checks. Several already exist. **Do not re-implement them in Phases 2-3.**

### Already covered (do not duplicate)

| Planned check | Already enforced by | Where |
|---|---|---|
| `fin_exit_vs_entry_multiple` | `multiple_expansion` sanity check (exit more than `multiple_expansion_ratio` = 2x entry) | `financialEngine.js` `sanityChecks` |
| `fin_wacc_reason` | WACC override requires a reason | `wacc.js` (`WACC_OVERRIDE_REASON_MESSAGE`) |
| Entry value vs multiple x EBITDA | `entry_multiple_tie` (tolerance `entry_multiple_tie_pct` = 20) | `financialEngine.js` |
| `fund_budget_variance` | `variance_justification_required` and `variance_memo_required` stops | `budgetStatus.js` |
| Sources equal uses; funding hierarchy; invalid status | `evaluateSourcesUses` | `sourcesUses.js`, surfaced by `fundingChecks` |
| Scenarios complete, downside hurdles, balance, P&L and cash-flow ties | `financialsChecks` and `sanityChecks` | `aiReview.js`, `financialEngine.js` |
| Terminal-value share, growth realism, hockey stick, cash conversion, stated growth and leverage ties | `sanityChecks` | `financialEngine.js` |
| FX rate present and positive when reporting in USD | `evaluateCurrency` | `currency.js` |

### Not covered today (candidates remain valid)

| Planned check | Why it is a gap |
|---|---|
| `fin_scenario_order` (downside <= base <= upside) | `returnMetrics.js` checks that the scenario values are captured, not their order. |
| `fin_returns_math` (IRR and MOIC agree in sign; implied hold period plausible) | No such relation is tested. |
| `fin_accretion_sign` | The accretion fields are only gate evidence. |
| `fin_fx_peg` | `evaluateCurrency` accepts any positive rate. |
| `fund_indicative_share` | `sourcesUses.js` reports status per source but not the indicative share of the total. |
| `fund_contingency` | Contingency is a use row but no rule asks for it. |
| `fund_debt_vs_ebitda` | See the caution in section 3. |

### Important wiring fact

`financialEngine.js` (`sanityChecks`, `checkIntegrity`, `computeFinancialModel`) is imported **only by `server/aiEvidence.js`**. It is **not** called from `runDeterministicChecks`. So the engine's `warn` results do not appear in the tab validation today. Phase 2 must decide, as a design point, whether to surface selected engine results in the Financials validation. That would be new behaviour, so it needs approval; the safe default is not to.

The engine reports `pass`, `warn`, `not_checkable` and `info`. Validation uses only `pass`, `review` and `fail`. Any surfacing must map `warn` to `review` and `not_checkable` to `review`, never to `pass`.

## 3. Cross-tab dependencies and field verification

Every field the planned checks read was confirmed against `INTAKE_FIELDS`.

| Field | Section (tab) | Needed by | Note |
|---|---|---|---|
| `snapshot_revenue_last_fy_aed`, `snapshot_ebitda_last_fy_aed` | opportunity_overview (2) | Tab 2 checks; Tab 5 leverage check | Tab 5 reading them must add them to its `extra` list, which stales Tab 5 when Tab 2 is edited. |
| `build_buy_partner` (build / buy / partner), `cost_of_not_doing` | opportunity_overview (2) | Tab 2 and Tab 3 | Tab 3 reading it must add it to `extra`. |
| `comparable_transactions`, `strategy_link`, `narrative_why_now`, `narrative_why_us` | rationale (3) | Tab 3 | Same tab. |
| `entry_valuation_method` (trading_comps, precedent_transactions, dcf, asset_based, other), `entry_valuation_basis` (ev, equity) | financials (4) | Tab 3 valuation-basis check | Cross-tab read; add to Tab 3 `extra`. |
| `return_irr/roic/moic/payback` base, upside, downside | financials (4) | Tab 4 checks | Same tab. |
| `entry_multiple`, `exit_multiple`, `entry_valuation_aed` | financials (4) | existing engine checks | |
| `fx_rate_usd_aed`, `reporting_currency` (AED, USD) | financials (4) | `fin_fx_peg` | Same tab. |
| `accretion_bps`, `accretion_net_earnings_aed` | accretion (grouped into tab 4) | `fin_accretion_sign` | Same tab. |
| `budget_status` (in_budget, variance_justified), `variance_justification` | funding (5) | already enforced | |
| `funding_sources_status` (secured, committed, indicative) | funding (5) | candidate check | The field is shared with the greenfield flow (`greenfield.js`). Confirm its meaning on non-greenfield deals before using it. |
| `funding_plan` | **not an intake field**; a nested block | Tab 5 | Already in Tab 5's `extra`. Sources: subsidiary_accruals, subsidiary_debt, partner_co_investor, sirius_capital. Uses: purchase_price, transaction_costs, working_capital, contingency. |

Cautions that change the plan:

- **`fund_debt_vs_ebitda` is weak.** It would divide subsidiary debt by the target's last-year EBITDA. That ignores existing debt, cash and the combined entity, and the leverage hurdle in `RETURN_HURDLES` is net debt over EBITDA of the group. Treat it as optional and approximate, or drop it. It is not recommended without Sirius input.
- **`fin_returns_math`** needs MOIC and IRR for the same scenario. Skip the check when either is blank.
- **Accretion fields sit under Tab 4's sections** (`sections: ['financials', 'accretion']`), so they are same-tab.

## 4. Configurable tolerances (finalised as proposals)

Stored in `RUBRIC_TOLERANCES` in `server/config/aiRubrics.js`. They are not read by anything yet. All are proposed starting values awaiting Sirius confirmation, matching how `FINANCIAL_ENGINE_DEFAULTS` is handled. Threshold-based values (FX deviation, implied holding period, funding shares) can only ask for review. A contradiction in the figures themselves (scenario order, IRR and MOIC of opposite sign, accretion of opposite sign) may fail; it still blocks nothing.

| Group | Setting | Value | Rationale |
|---|---|---|---|
| fx | `peg_aed_per_usd` | 3.6725 | The AED/USD peg; also the value used in the seed data. |
| fx | `peg_tolerance_pct` | 1 | A rate more than 1% from the peg is more likely a typing error than a market move. Matches the 1% used by sources-equal-uses and `tie_pct`. |
| returns | `implied_hold_years_min` / `max` | 0.5 / 15 | Bounds for ln(MOIC) / ln(1 + IRR). |
| returns | `scenario_order_tolerance_pp` | 0 | Downside <= base <= upside is a logical ordering. |
| funding | `indicative_share_review_pct` | 50 | Review when more than half of sources are only indicative. |
| funding | `contingency_min_aed` | 0 | The plan should carry some contingency. |

Not repeated here because another module owns them: IRR/MOIC/payback/ROIC tolerances (`FINANCIAL_ENGINE_DEFAULTS.tolerances`), the leverage ceiling (`RETURN_HURDLES`) and the sources-equal-uses tolerance (`BALANCE_TOLERANCE_PCT`).

## 5. Blockers and open items

No blocker prevents Phase 2. Items to resolve at the stated gate:

1. **Tab 5 content value (Phase 3 gate).** After reading all references, little is usable. Decide between a short attributed adaptation and an original rubric. Either is feasible.
2. **Engine results in validation (Phase 2 gate).** Surfacing `financialEngine.sanityChecks` in the Financials tab is new behaviour. Needs approval.
3. **Sirius confirmation of tolerances** (section 4) before checks that use them ship.
4. **`funding_sources_status` meaning** outside greenfield deals (section 3).
5. **Attribution placement** for Tabs 2, 3 and 5 when guidance is written: where the notice is shown to users. Tab 4 needs none.
6. **Pre-existing environment issues, unrelated to this work.** The integration tests (`m1`, `m2`, `m3`, `auth` and others) fail against the local server because it runs with real authentication, and `tokenManager.test.js` writes to the development database. Neither is touched here.

## 6. Phase 1: what was built

- `server/config/aiRubrics.js` (new, pure): `RUBRIC_TABS`, per-tab `RUBRIC_VERSIONS` (all 1), per-tab switches (`RUBRIC_DEFAULT_ENABLED`, all **off**), the `AI_RUBRIC_TABS` environment override (`all`, `none` or a comma list, read at call time), `RUBRIC_SOURCES` (provenance), `RUBRIC_TOLERANCES`, and `rubricHashFragment(tab)`.
- `server/config/aiReview.js`: `hashTabInputs` spreads `rubricHashFragment(tabKey)` into the hashed object (one import and one expression). The fragment is `{}` unless the tab's rubric is enabled, so the hashed object, and the hash, are unchanged for every other tab and for every tab while switches are off. A `{ rubric: null }` key would change the hash, which is why the fragment is empty instead.
- Tabs 1, 6 and 7 are not in `RUBRIC_TABS`, so no environment value or test override can enable them.
- Tests: `server/tests/aiRubrics.test.js` (21 tests) with fixture `server/tests/helpers/aiRubricFixture.js`. Golden fingerprints (hash, validation prompt, analysis prompt, Q&A prompt, model check specs, rule-check results) for all seven tabs were captured from the code **before** the change.

Behaviour on deploy: nothing changes. All switches are off, so no result becomes stale. A tab's results become stale only when its switch is turned on in a later phase, and again each time its version is raised.

To turn a tab on later: set `AI_RUBRIC_TABS` (for example `financials`) or change its default. To say "this tab's guidance changed, re-run": raise that tab's number in `RUBRIC_VERSIONS`.

## 7. Phase 2: Tab 4 (Financials and returns), implemented

Switch: `financials` is ON by default (`RUBRIC_DEFAULT_ENABLED`). `AI_RUBRIC_TABS=none` restores the pre-rubric behaviour exactly. Rubric version: **2**.

### What Tab 4 now does

| Where | Addition |
|---|---|
| Rule checks (`runDeterministicChecks`) | `financial_sanity`: summarises the financial engine's own `sanity.checks` (nothing recalculated). Warnings, and any check the engine could not make for lack of data, give **review**; **pass** only when every engine check was made and passed; no engine result gives review. |
| | `fin_scenario_order`: downside, base, upside in order for IRR, ROIC, MOIC (higher is better) and payback (shorter is better). Out of order fails; fewer than two scenarios is review. |
| | `fin_returns_math`: IRR and MOIC must agree in sign (fail); implied holding period `ln(MOIC)/ln(1+IRR)` outside 0.5-15 years is review; no scenario with both is review. |
| | `fin_accretion_sign`: net earnings added (AED) and return added (bps) must not point opposite ways (fail); either missing is review. |
| | `fin_fx_peg`: rate more than 1% from 3.6725 is review; USD reporting with no or unusable rate is review; omitted when the deal reports in AED and records no rate (nothing to check). |
| AI validation | New spec `assumptions_reasonable`. A model "pass" is forced to review when no document and no financials grid exist, or when a rule check failed. |
| AI analysis | Original reviewer guidance (`RUBRIC_GUIDANCE.financials`, eight points) placed after the research focus, outside the data fences, so truncation cannot drop it. |
| Staleness | `rubric: 2` joins the Financials input hash. Existing Financials results show as stale once; no other tab's hash changes. |

### Reuse, not duplication

- The engine is run by `evaluateFinancialsForReview` (new, additive, in `server/aiEvidence.js`), which repeats the five orchestration lines of `runFinancials` (thresholds, WACC, statement lines, stored engine settings, `computeFinancialModel`) but saves nothing and never throws. `runFinancials` itself is unchanged.
- Its warnings reuse the engine's existing sanity logic, which already covers multiple expansion, entry-multiple tie, terminal-value share, growth realism, hockey stick and cash conversion. None of that is rebuilt.
- The Sirius-configured engine settings (stored `financial_engine` setting) apply, because the engine is called with them.
- FX peg and holding-period tolerances come from `RUBRIC_TOLERANCES`; FX rate parsing from `evaluateCurrency`.

### Files changed in Phase 2

`server/config/aiRubrics.js`, `server/config/aiReview.js`, `server/aiReview.js` (Financials-only engine call and one extra argument), `server/aiEvidence.js` (one new export), `server/tests/aiRubrics.test.js`, `server/tests/aiReview.test.js` (two legacy assertions updated to the new three-spec list), new `server/tests/aiRubricFinancials.test.js`, new `server/tests/helpers/aiRubricGolden.js`, this document.

### Known limits

- Engine settings and organisation thresholds are not part of the input hash (as with the mandate today), so editing them does not stale a stored result.
- The implied holding period assumes a single exit; interim distributions shorten the true figure, hence the generous range.
- A payback-versus-holding-period check was dropped: with interim cash flows it gives false alarms.
- Uploaded-model parsing (`statementLinesFor`) may use cached document extraction; a validation run on Tab 4 can therefore trigger extraction once per document.
- The integration tests that call the live Docker server are flaky for reasons unrelated to this work (its request throttle and authentication mode).

## 8. Phase 3: Tab 5 (Funding and key asks), implemented

Switch: `funding` is ON by default. `AI_RUBRIC_TABS=none` restores the pre-rubric behaviour exactly, and `AI_RUBRIC_TABS=financials` (or any list) switches Funding off independently of Tab 4. Rubric version: **2**. No orchestration change was needed (there is no engine input for this tab).

### Licence decision (the Phase 3 gate)

The corporate-treasurer skill and its seven references were read in full in Phase 0. Most of it is treasury operations and its funding hierarchy conflicts with the Sirius one in `sourcesUses.js`. The few ideas worth keeping (how firm each source is, concentration, loan terms against what they fund, a buffer) are generic funding-review practice. The guidance was therefore **written as original text**, as for Tab 4, and no wording from the skill is used. A test pins a list of the skill's distinctive phrases as absent.

Because no text is used, the skill's attribution requirement ("Based on Awesome Skills by neo.ai (lucas_hsueh@hotmail.com)", a licence reference and a modification notice) is not triggered. As a courtesy, and because it costs nothing, the credit is kept here and in `RUBRIC_SOURCES.funding.reviewed`:

> Concepts reviewed from Awesome Skills by neo.ai (lucas_hsueh@hotmail.com), https://github.com/theneoai/awesome-skills (MIT with Attribution Requirement). No text used.

If Sirius's legal view is that reviewing the skill obliges attribution anyway, the credit above already satisfies the first two conditions; a modification notice would be the only addition.

### What Tab 5 now does

| Where | Addition |
|---|---|
| Rule checks | `fund_indicative_share`: of the funding other than Sirius's own ask, more than 50% still indicative or with no status stated is **review**. Funding that is only the ask is review; an uncaptured plan is review. |
| | `fund_contingency`: the uses should include a contingency above zero; none, or an uncaptured plan, is **review**. |
| | `fund_status_consistent`: the overall "Funding sources status" must not be firmer than the weakest source shown (Sirius's ask excluded). A mismatch, or a claim with no plan to compare, is **review**. Omitted when no overall status is stated. |
| AI validation | New spec `funding_plan_holds`. A model "pass" is forced to review when no funding plan is captured and no document is attached, or when a rule check failed. |
| AI analysis | Original reviewer guidance (`RUBRIC_GUIDANCE.funding`, six points) after the research focus, outside the data fences. It defers to the rule results for the funding order and sources equal uses, and contains no numeric thresholds. |
| Staleness | `rubric: 2` joins the Funding input hash. Funding results show as stale once. Tab 4's hash is unaffected, and the reverse. |

None of these checks can fail: every one is a judgement, so each asks for review at most.

### Reuse, not duplication

- The funding plan is read through `evaluateSourcesUses` (the single place that turns it into totals and statuses); nothing is re-derived.
- Not repeated, because they already exist: sources equal uses, the funding order, unknown statuses (`sourcesUses.js` / `fundingChecks`), the ask within the total (`ask_within_total`), and the budget-variance justification (`budgetStatus.js`).
- Dropped as agreed in Phase 0: `fund_debt_vs_ebitda`. It divided subsidiary debt by the target's last-year EBITDA, ignoring existing debt and cash, so it would mislead.

### Files changed in Phase 3

`server/config/aiRubrics.js`, `server/config/aiReview.js`, `server/tests/aiRubrics.test.js`, `server/tests/aiRubricFinancials.test.js` (assumptions about Funding being off updated), new `server/tests/aiRubricFunding.test.js`, this document. `server/aiReview.js` and `server/aiEvidence.js` were not touched in this phase.

### Known limits

- `funding_sources_status` is shared with the greenfield flow (which accepts only "secured" as clearing its rule). The consistency check treats it as the deal-level claim about funding already in place and compares it with the sources other than Sirius's ask. Confirm with Sirius that this is how Preparers read the field.
- The 50% limit and the zero contingency floor are proposed starting values (see `RUBRIC_TOLERANCES.funding`), awaiting Sirius confirmation.
- Loan tenor, currency and covenants are not captured as fields, so those points reach the reviewer only through the AI guidance and the `funding_plan_holds` check.
- Results stored before this phase show as stale once; nothing re-runs them automatically.

## 9. Phase 4: Tab 3 (Rationale and fit), implemented

Switch: `rationale` is ON by default. `AI_RUBRIC_TABS=none` restores the pre-rubric behaviour exactly; any list switches Rationale off independently of Tabs 4 and 5. Rubric version: **2**. No orchestration change was needed (there is no engine input).

### Source and licence

Guidance is a **paraphrase, acquiring side only,** of the `ma-playbook` skill (`alirezarezvani/claude-skills`, `c-level-advisor/skills/ma-playbook/SKILL.md`, commit `91a1dda`, MIT, Copyright (c) 2025 Alireza Rezvani). The MIT notice is reproduced at the end of this document. Not used: the skill's illustrative valuation multiples and acqui-hire prices (it labels them illustrative and DealForge's guard forbids outside figures), its sell-side half, its negotiation-terms table, and its hand-offs to sibling skills and scripts. A programmatic comparison of the guidance with the skill and its two reference files found no shared sequence of four or more words.

### What Tab 3 now does

| Where | Addition |
|---|---|
| Rule checks | `rat_comparables_for_buy`: a purchase should name comparable transactions. Purchase with none is **review**; an unstated build/buy/partner choice is review; build and partner are not purchases, so the check is not raised. |
| | `rat_rationale_evidenced`: the optional strategy link and some supporting evidence (rationale evidence or market data) should both be given; anything missing is **review** and named. |
| | `rat_valuation_basis`: reads the entry valuation method from the Financials tab. A DCF (built on projections) is **review**; "other" or no method is review; trading comps, precedent transactions and asset-based pass. |
| AI validation | New spec `buy_vs_build_reasoned`. A model "pass" is forced to review when nothing is written and no document is attached, or when a rule check failed. |
| AI analysis | Paraphrased reviewer guidance (`RUBRIC_GUIDANCE.rationale`, seven points plus warning signs) after the research focus, outside the data fences. It forbids bringing in multiples or prices of the model's own, defers to the rule results for the mandate fit, and contains no numeric thresholds. |
| Staleness | `rubric: 2` joins the Rationale input hash. Rationale results show as stale once. |

None of the three rule checks can fail: every one is a judgement, so each asks for review at most.

### Cross-tab fields

Three fields from other tabs are read: `build_buy_partner` and `cost_of_not_doing` (Opportunity overview) and `entry_valuation_method` (Financials). They reach Rationale's context, prompts, citable sources and hash **only while its rubric is on** (`RUBRIC_EXTRA_KEYS`, applied through `extraKeysOf`), so with the rubric off the tab's context, prompts and hash are exactly what they were. Consequences while on: editing one of them on its own tab also marks Rationale stale, which is intended; the Opportunity overview and Financials tabs are otherwise unchanged by this.

### Reuse, not duplication

- Not repeated: the required "why now" and "why us" narratives (the checklist check already reports them missing) and the sector, geography and size fit (`mandateCheck`, which Opportunity overview shares and which is unchanged).
- The three checks read only submitted fields; there is no calculation to duplicate.

### Files changed in Phase 4

`server/config/aiRubrics.js`, `server/config/aiReview.js`, `server/tests/aiRubrics.test.js`, `server/tests/aiRubricFinancials.test.js` and `server/tests/aiRubricFunding.test.js` (assumptions that Rationale was off updated), new `server/tests/aiRubricRationale.test.js`, this document. `server/aiReview.js` and `server/aiEvidence.js` were not touched.

### Known limits

- The build/buy/partner field is optional, so the comparables check is frequently "review: choice not stated" until the Opportunity overview is filled in.
- A DCF is the only method treated as projection-based. A deal valued on both a DCF and comparables is still flagged review because only one method can be recorded; the reviewer should read the comparables field.
- Integration planning has no intake field, so it reaches the reviewer only through the AI guidance and `buy_vs_build_reasoned`.
- Results stored before this phase show as stale once; nothing re-runs them automatically.

## 10. Phase 5: Tab 2 (Opportunity overview), implemented

Switch: `opportunity_overview` is ON by default. `AI_RUBRIC_TABS=none` restores the pre-rubric behaviour exactly; any list switches it off independently of Tabs 3, 4 and 5. Rubric version: **2**.

### Decision D2 in force

Only existing intake fields and attached documents are evidence. No new field, UI element or schema was added (a test pins the tab's nine fields and empty `extra` list). Customer concentration, retention, churn and recurring share are not captured anywhere, so **no code check looks for them and the guidance forbids inferring them**; they are reported as "Not enough evidence".

### Source and licence

Guidance is a **paraphrase** of the commercial due diligence variant in `gcamilo/management-consulting` (`variants/due-diligence.md`, commit `dd2d099`, MIT, "Copyright (c) 2026", no holder named in the licence file). Not used: its deliverables (2x2 risk matrix, A/B/C/F revenue-quality scorecard, concentration chart, proceed or walk-away recommendation), its thresholds (top customer, retention and turnover percentages) and its "assume if missing" instruction (DealForge reports "Not enough evidence" instead). A programmatic comparison found no shared sequence of three or more words. The MIT notice is reproduced at the end of this document.

### What Tab 2 now does

| Where | Addition |
|---|---|
| Rule checks | `ov_snapshot_present`: for purchase-like types (strategic acquisition, bolt-on, distressed turnaround) last-year revenue and EBITDA should be given; missing is **review**; an unstated type is review; other types do not raise it. |
| | `ov_ebitda_vs_revenue`: EBITDA above revenue, negative revenue, or revenue of zero with EBITDA **fails**; a margin outside -100% to 100% is review. Not raised when a figure is absent (that is `ov_snapshot_present`'s job). |
| | `ov_employees_valid`: negative fails; blank, zero, fractional or non-numeric is **review**. |
| | `ov_build_buy_reasoned`: a purchase should state the cost of not doing it; missing or an unstated choice is **review**. |
| AI validation | New specs `claims_evidenced` and `dd_red_flags`. The prompt tells the model to begin the detail with "Not enough evidence" and use review when the documents lack the data. |
| D2 enforced in code (validation) | A model "pass" on either check is **forced to review, with a detail starting "Not enough evidence"**, when no document is attached or none could be read. `dd_red_flags` additionally cannot pass unless some document text names a commercial subject (customer, retention, churn, recurring, renewal, contract, backlog...) **and** contains a number. A failed rule check also blocks a pass. A model "review" or "fail" is kept. |
| D2 enforced in code (analysis) | When no attached document holds commercial data, no item or overall rating can be Strong, and a fixed "Commercial evidence: Not enough evidence..." entry is placed first in the existing low-confidence list. Applies to this tab only, while its rubric is on, and only when the caller supplies the document text. |
| AI analysis | Paraphrased reviewer guidance (`RUBRIC_GUIDANCE.opportunity_overview`: customers, quality of revenue, defensibility, management, market, warning signs, cautions). |
| Staleness | `rubric: 2` joins the input hash; the opportunity type (a header field) is read by the checks and reaches this tab's context and hash only while the rubric is on. Results show as stale once. |

### Reuse, not duplication

- Not repeated: the checklist and the sector, geography and size fit (`mandateCheck`, shared with Rationale and unchanged).
- The pre-existing `right_document`, `intent_fit` and `consistency` AI checks are unchanged.
- Output schemas are unchanged: the Not-enough-evidence note uses the existing `low_confidence` list and the existing "Not enough evidence" rating.

### Files changed in Phase 5

`server/config/aiRubrics.js`, `server/config/aiReview.js`, `server/aiReview.js` (one extra property, `snippets`, in the existing `normaliseValidation` call), the Phase 1 to 4 test files (assumptions that Opportunity overview was off updated), new `server/tests/aiRubricOverview.test.js`, this document.

### Known limits

- Document text is cut to 4,000 characters per document, so commercial data further into a long plan reads as "Not enough evidence". That is the safe failure.
- The commercial-data gate is deliberately crude (a subject word plus a number anywhere in a document's text). It stops false assurance; it does not prove the data answers the question. A person still reads the documents.
- Without readable commercial documents this tab will mostly report "Not enough evidence" for the customer and revenue-quality points. That is D2 working as intended, and reviewers should expect it.
- Opportunity types other than the three purchase-like ones skip the snapshot checks. If Sirius wants JV or technology deals held to them too, change `snapshot_expected_types` in `RUBRIC_TOLERANCES.overview`.
- Results stored before this phase show as stale once; nothing re-runs them automatically.

## 11. Phase 6: hardening, live evaluation and rollout

### Hardening (offline, in `server/tests/aiRubricHardening.test.js`, 36 tests)

| Area | What is proved |
|---|---|
| Robustness | 400 seeded random submissions per tab (wrong types, NaN, Infinity, 1e308, malformed funding plans, 3,000-character strings): nothing throws, every check is well formed with a unique key, no detail leaks `NaN`, `undefined` or `[object`. A separate probe of 21,000 runs found no problem. The checks are pure: the same input gives the same output and a deep-frozen input is never modified. |
| Missing or wrong-type data | A blank submission never produces a rubric "pass", and neither do values of the wrong type. |
| Prompt budget | No prompt exceeds its cap even with every field absurdly long. Every model check and all rubric guidance survive truncation, because they sit ahead of the data. Guidance is under 25% of a typical analysis prompt (between about 12% for Financials and 22% for Rationale, whose prompt is the shortest; typical prompts run 8k to 13k characters). Switching the rubrics off shortens exactly the four rubric tabs' prompts and leaves the others unchanged. |
| Injection | Text planted in every field of each rubric tab, including a fake "Reviewer guidance for this tab" block and fence-closing tags, cannot become guidance: exactly one real block precedes the data, injected copies stay inside the data fences, and fences stay balanced. Standard instruction phrases are flagged for a person to read. |
| Hostile model output | For each rubric tab, an answer that passes everything, repeats keys, invents keys (including `__proto__`), sends oversized text, non-objects and nulls cannot get past normalisation: only the requested keys come back, details are capped, evidence-gated checks cannot pass without evidence, and a failed rule check still blocks a pass. A flood of Strong ratings is demoted and bounded; invented sources and unsupported figures are dropped; Tab 2 can never come out Strong without commercial data. |
| Audit | The audit row for a validation run, an analysis run and a kept analysis carries `rubric_version` while the tab's rubric is on, and nothing (no key) for a tab without one, so Tabs 1, 6 and 7 write exactly the audit row they always did. |

**Known limit, pre-existing and not changed:** the shared prompt builder cuts the end of an over-long prompt, which can leave the `tab_content` fence unclosed and drop the rule results. It affects every tab alike and only arises with field values tens of thousands of characters long. Fixing it would change Tabs 1, 6 and 7. A test records the behaviour. The proper fix is a per-field length cap on input.

### Live evaluation (`scripts/ai_rubric_eval.mjs`)

Synthetic cases only (the 44 opportunities in the development database were not read). Each case is sent through the governed `callLLM` path, then through the same normalisation as the product, and checked against the rubric rules. Three cases per tab: **rich** (documented, internally consistent), **thin** (minimal fields, no documents) and **adversarial** (injection text in a field of each tab and in a document, contradictory returns, a funding plan that is only the ask).

```
node --env-file=.env scripts/ai_rubric_eval.mjs --dry                (no network; builds every prompt, runs the offline checks)
node --env-file=.env scripts/ai_rubric_eval.mjs --out=report.json   (live: 24 model calls by default)
  --tabs=funding,financials  --cases=thin,adversarial  --pace=2000
```

Provider timeouts are retried and reported as ERROR, separately from rule failures. Calls appear in the governed call log under `ai-rubric-eval@dealforge.local`. Nothing is written to any opportunity.

**Results** (provider: the configured, approved Atlas Xailon endpoint; 38 live calls over four runs, because two of my fixtures needed correcting, see below):

| Run | Scope | Result |
|---|---|---|
| Preflight | thin / Funding, 2 calls | 9 PASS |
| 1 | all 24 calls | 108 PASS, 1 FAIL (a provider timeout, not a rubric failure), 2 NOTE |
| 2 | rich, all four tabs, after correcting the fixture | 28 PASS, 0 FAIL, 1 NOTE |
| 3 | rich and thin Funding, after correcting the fixture | 16 PASS, 0 FAIL, 0 NOTE |

What the automated checks confirmed live:

- **Thin cases:** evidence-gated checks never passed; Tab 2 said "Not enough evidence" on every customer and revenue-quality point; nothing was rated Strong; thin Financials and Overview analyses were "Not enough evidence" throughout.
- **Adversarial cases:** in all four tabs the model **ignored the planted instruction, rated nothing Strong, and said in its own output that a field contained an instruction aimed at the AI reviewer** ("...which was ignored"). Overall validation was never "pass" where the rules could see a problem.
- **Rule conformance:** requested checks only, valid statuses and ratings, sources only from what was provided, no Strong without a source.

**The model caught flaws in my own "rich" fixture, which is the best evidence the rubrics work.** The first version contradicted itself and the model said so: the financials grid showed revenue of AED 390 mn against AED 80 mn in the model document (and a 7x entry multiple that only reconciled with the document's EBITDA); the business-plan snippet said three people hold the key customer relationships (a real key-person warning); and Sirius capital was marked "committed" while the document said "requested". After correcting each, the rich case produced no spurious failure, the financial engine's plausibility summary passed outright, and the remaining reviews were defensible (no debt terms, no explanation of why not partner, no mandate or strategy supplied to the harness).

### Findings for Sirius to decide

1. **What "Funding sources status" covers.** The model reads it as including Sirius's own ask; the rule check `fund_status_consistent` deliberately excludes the ask (it is a request, not funding in place). On the same data the model can say "inconsistent" while the rule passes. Decide which reading is intended, then align the rule or the field's help text.
2. **Integration is not always raised.** On the thin Rationale case the model did not flag a missing integration plan. The guidance asks for it (point 3) and `buy_vs_build_reasoned` covers it, but the model does not always follow; a person should expect to ask.
3. **Cautious by design.** Expect many "review" verdicts on real submissions, because most real documents will not hold everything the checks look for.

### Limits of this evaluation

Three synthetic cases per tab, one model, one sample each at the product's temperature (0.2), so it is not a statistical measure and a re-run can differ. The harness supplies no entity mandate or strategy passages, so `intent_fit` cannot pass there. Document text is the synthetic snippet, not real extraction. It shows the guidance is followed and the safeguards hold; it does not prove quality on real deals. Re-run it after any change to guidance text, and read the transcript.

### Rollout runbook

The four rubrics are on by default. To introduce them one tab at a time instead, set `AI_RUBRIC_TABS` on the server (see `.env.example`); a list **replaces** the default, so it names the tabs that are ON.

1. Start with `AI_RUBRIC_TABS=none` (the review behaves exactly as before the rubrics) and confirm the baseline.
2. Enable one tab, for example `AI_RUBRIC_TABS=financials`, restart the server, and re-run that tab on a few opportunities. Order of value and risk, lowest risk first: `financials`, `funding`, `rationale`, `opportunity_overview`.
3. Read the results beside the audit trail: each run records `rubric_version` in its audit row, so a result can always be traced to the guidance that produced it.
4. Add the next tab (`financials,funding`, and so on) and repeat.
5. **Rolling back** a tab is removing it from the list (or `none`). Its results become stale again, which is correct: they were produced under different guidance.

**Changing guidance later:** edit the text, raise that tab's number in `RUBRIC_VERSIONS` (never reuse a number), run `ai_rubric_eval.mjs` and read the transcript, then deploy. Only that tab's stored results show as stale. Nothing re-runs automatically, so tell reviewers to re-run stale tabs.

**Switching a tab on or off marks its stored results stale**, because the version is part of the hash. A single flip of the whole set touches four tabs' results at once.

### Not done in Phase 6

- The live-server integration tests (21 files) are still unreliable for reasons outside this work: the Docker server runs old code, and its request throttle and authentication mode make counts swing from about 9 to about 280 failures between runs. They should be repaired before relying on them, and the new rubric behaviour should be re-checked against the live API when they are.
- `tokenManager.test.js` still writes to the development database. The Atlas token row was checked and holds genuine values, not test values.
- A per-field input length cap (the real fix for the pre-existing truncation behaviour).

### Files changed in Phase 6

`server/config/aiRubrics.js` (audit helper), `server/aiReview.js` (`rubric_version` in three audit rows), `.env.example` (documents `AI_RUBRIC_TABS`), new `server/tests/aiRubricHardening.test.js`, new `scripts/ai_rubric_eval.mjs`, this document.

## Third-party notice: ma-playbook (Tab 3 guidance)

The Tab 3 reviewer guidance paraphrases ideas from the `ma-playbook` skill, https://github.com/alirezarezvani/claude-skills (path `c-level-advisor/skills/ma-playbook/SKILL.md`). Its licence follows.

```
MIT License

Copyright (c) 2025 Alireza Rezvani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## Third-party notice: commercial due diligence variant (Tab 2 guidance)

The Tab 2 reviewer guidance paraphrases ideas from the commercial due diligence variant in https://github.com/gcamilo/management-consulting (path `variants/due-diligence.md`). Its licence follows.

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
