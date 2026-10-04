# W3-11 - Portfolio synergy (SCR-06)

## What this delivers

Every screened opportunity now carries an advisory synergy view against the
group's portfolio register (W4-01), so the reviewer can see at a glance which
existing operating companies the target sits alongside. The panel ranks the
register by overlap weight and lists the top matches, each named with the
reasons it surfaced.

An overlap is scored, not binary. The evaluator weights the overlap kinds the
same way the register tags them: same sector 3, shared geography 2, shared
capability 2, related party 1. The strongest match in the list fixes the
cluster strength (high at 5+, medium at 3+, low below), and every row carries a
plain-language rationale ("X operates in the same sector (Technology); shares
the UAE geography.").

Every synergy claim is explicitly marked as needing the operating company's
sign-off - the row shows "requires operating-company sign-off" and the check
rationale repeats "every claim requires operating-company sign-off". Synergy is
a reason to look closer, never a reason to proceed on its own, so the marker is
attached to each claim rather than buried in a footnote.

The list is bounded (five matches by default) so the panel stays readable, and
the count of all matches is shown regardless, so nothing is hidden by the cap.
The register and the cap are versioned configuration.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | Portfolio synergies card | analyst_portfolio_synergy_list.png | The "Portfolio synergies (advisory)" card on the Vision Care Imaging Platform screening panel: the 5 matches badge and the ranked matches (ADI Chain, Coredge, Infinia, Oxinus, SAIF) each tagged HIGH with its rationale ("X operates in the same sector (Technology); shares the UAE geography.") and the "REQUIRES OPERATING-COMPANY SIGN-OFF" marker on every row. |

## How it works

1. server/config/portfolioAnalysis.js exports the version (PA-01.1), the result
   cap (SYNERGY_MAX_RESULTS = 5), the sign-off marker and kinds, and
   evaluatePortfolioSynergy(data, {portfolio, thresholds}). It ranks the
   register companies by weighted overlap and returns the cluster strength plus
   a per-row {company_id, company, cluster, sector, geography, kinds,
   capability_overlap, weight, strength, rationale, signoff,
   requires_operating_company_signoff}.
2. server/gate.js evaluates the synergy once per record and returns
   portfolio_synergy from evaluateGate. The block carries synergy_count, the
   bounded synergies list, the sign-off marker and a plain-text message.
3. GET /api/gate/fields advertises the portfolio_analysis config block
   (version, cap, signoff marker, synergy kinds) so the UI and the panel share
   one source of truth.
4. server/config/screeningPanel.js exposes portfolio_synergy at the top of the
   panel and folds the twin facts into the synergy & conflict check, adding a
   synergy evidence ref per matched company.
5. src/pages/ScreeningBoard.jsx renders the "Portfolio synergies (advisory)"
   card (data-testid="portfolio-synergy") whenever the block is present, with a
   per-company row (data-testid="portfolio-synergy-<company_id>").

## Validation

- node --test server/tests/portfolioAnalysis.test.js - 12 pass (the overlap
  weighting and strength bands, the bounded top-N list, the sign-off marker on
  every row, and the capability overlap roll-up).
- BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js - the
  W3-11 case proves the Technology/UAE target returns five sign-off-marked
  synergy matches naming the register companies and the panel exposes the
  block, while an unrelated sector returns no matches.
- npm run build and eslint clean on the touched files.

## Notes

Fixtures: the seeded Vision Care Imaging Platform (Infinia, Technology/UAE)
matches five Technology register companies (ADI Chain, Coredge, Infinia,
Oxinus, SAIF), all high strength on sector and geography. Evidence captured
against the demo stack at http://localhost:34010 from the mvp seed profile.
