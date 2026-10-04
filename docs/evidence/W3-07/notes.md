# W3-07 - System-proposed scores (SCO-03)

## What this delivers

For every Gate 2 criterion the system proposes a 1-5 score from the structured
data already on the record, and the reviewer confirms or adjusts it. Both the
proposal and the final score are stored so a later reader can see what the
system suggested and what the reviewer decided. An adjustment away from the
proposal requires a written comment (at least 10 characters), so every
deviation from the system's view is explained.

Proposals are derived in server/config/scorecard.js (proposeScorecardItem):

| Criterion | Proposed from | Mapping |
| --- | --- | --- |
| Revenue scale / trajectory | snapshot revenue last FY | >=200mn 5, >=100mn 4, >=50mn 3, else 2 |
| Growth rate | latest captured growth % in the financial matrix | >=35 5, >=25 4, >=15 3, >=5 2, else 1 |
| Entry valuation vs. comps | method, entry multiple, comparables count | >=3 comps 4, >=1 comp 3 |
| Target ownership / control | captured current ownership | neutral 3 pending the stake |
| Capital structure | captured leverage (net debt / EBITDA) | <=2x 4, <=3x 3, else 2 |
| Path to liquidity | captured exit route / timing | both 4, one 3 |
| Unit economics | snapshot EBITDA margin | >=25% 4, >=15% 3, else 2 |

A criterion with no supporting data is proposed neutral (3) with no refs, never
a silent pass. A proposal alone does not count: the scorecard stays
awaiting_review and no total or outcome is computed until the reviewer captures
a score. Every proposal carries the evidence refs it read.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | System-proposed scores | analyst_system_proposed_scores.png | Each of the seven criteria shows its proposal and band (e.g. revenue scale Proposed: 4/5, growth Proposed: 3/5); the outcome reads "Not scored" until the reviewer confirms. |
| Analyst (Sirius CIO) | Adjustment needs a comment | analyst_adjustment_comment_required.png | Choosing a score above the proposal flags the row "Adjusted" and reveals a comment box ("Comment required when adjusting the proposal (min 10 chars)"). |

## How it works

1. The board loads each criterion with its proposed_score, proposed_label and
   proposed_refs from the derived data.
2. The reviewer keeps the proposal or picks another 1-5 value.
3. On capture, buildScorecard compares each final score to the proposal; a
   difference without a comment of at least 10 characters is refused (400).
4. The stored record keeps scores, proposed_scores, comments and adjusted keys;
   the audit event carries the same, so the deviation is traceable.

## Validation

- node --test server/tests/scorecard.test.js - 24 pass (6 new SCO-03 cases).
- BASE_URL=... node --test server/tests/m3.test.js - the SCO-03 integration case
  passes (proposal exposure, exact-confirm acceptance, adjustment refusal and
  adjustment-with-comment acceptance).
- npm run build and eslint clean.

## Notes

- The proposal mapping is configuration and pure; a recalibrated band moves the
  proposal without a code change.
- Evidence captured against the demo stack at http://localhost:34010 from the
  mvp seed profile.
