# W3-10 - Portfolio conflict & concentration (SCR-07)

## What this delivers

Every screened opportunity is now checked against the group's portfolio register
(W4-01) for overlap and concentration, and the screening panel names the
affected companies instead of showing a bare pass/fail. Two signals ride on the
panel:

- **Conflict / overlap flags.** A target that shares a sector or geography with
  an existing holding (or is the same named entity) raises a per-company flag
  with a severity. A flag is *un-mitigable* only when the target name itself is
  already in the register (a same-name / duplicate situation); a sector-and-
  geography overlap with a different company is a high-severity flag that a
  strategic investor can deliberately accept, so it does not, by itself, turn
  the check into a fail.
- **Sector concentration.** The panel computes the post-deal share of the
  portfolio in the target's sector against a configurable ceiling (35% by
  default) and names the breach. When the register rows carry capital figures
  and the deal carries a commitment, the basis is capital; otherwise it falls
  back to a count basis (matching holdings plus this deal over the portfolio
  size plus one) so the figure is always present.

The check is advisory. The panel states it in plain text: the system never
rejects an opportunity on its own; the reviewer confirms whether any overlap is
un-mitigable. The synergy & conflict check fails only when an un-mitigable
conflict is present, flags when there is any overlap, and passes when the
portfolio is clear.

The ceiling and the register are versioned configuration. Editing the register
(W4-01) or the ceiling changes the next screen without a deploy.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | Portfolio conflict & concentration card | analyst_portfolio_conflict_concentration.png | The "Portfolio conflict & concentration (advisory)" card on the Vision Care Imaging Platform screening panel: the 5 overlaps badge, the "Technology concentration (count)" row reading "37.5% / 35% ceiling" in red for the breach, and the five per-company overlap rows (ADI Chain, SAIF, Coredge, Infinia, Oxinus) each tagged HIGH with the "both operate in Technology in UAE" reason, above the advisory disclaimer. |

## How it works

1. server/config/portfolioAnalysis.js is the pure evaluator. It exports the
   version (PA-01.1), the concentration ceiling (CONCENTRATION_MAX_SECTOR_PCT
   = 35), the conflict kinds, and evaluatePortfolioConflict(data, {portfolio})
   plus evaluatePortfolioConcentration(...).
2. server/gate.js evaluates the register-grounded conflict and concentration
   once per record and returns portfolio_conflict from evaluateGate. The block
   carries flag_count, unmitigable_count, the exposure flags (each
   {company_id, company, kinds, severity, reason, unmitigable}), the
   concentration figure and a plain-text message.
3. GET /api/gate/fields advertises a portfolio_analysis config block (version,
   ceiling, cap, signoff marker, kinds) so the UI and the panel share one source
   of truth. No new endpoint is needed; the block rides on the gate every screen
   and the memo already read.
4. server/config/screeningPanel.js composes the synergy & conflict check from
   the block and now also exposes portfolio_conflict at the top of the panel so
   the board can render the card directly.
5. src/pages/ScreeningBoard.jsx renders the "Portfolio conflict &
   concentration (advisory)" card (data-testid="portfolio-conflict") whenever
   the block is present.

## Validation

- node --test server/tests/portfolioAnalysis.test.js - 12 pass (weighted overlap
  ranking, a same-name target marked un-mitigable while a sector/geo overlap is
  a high flag only, the capital-vs-count concentration basis, the ceiling breach
  boundary, and the clear-portfolio pass).
- BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js - the
  W3-10 case proves the Technology/UAE target names the overlapping companies,
  reports the 37.5% concentration breach and the panel exposes the block, while
  an unrelated sector reports zero flags but still a concentration figure.
- npm run build and eslint clean on the touched files.

## Notes

Fixtures: the seeded Vision Care Imaging Platform (Infinia, Technology/UAE) is
the demo target - it overlaps five Technology register companies and tips the
sector over the 35% ceiling. Evidence captured against the demo stack at
http://localhost:34010 from the mvp seed profile.
