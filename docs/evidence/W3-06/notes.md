# W3-06 - Two-lens floor (SCO-04)

## What this delivers

The seven Gate-2 scorecard criteria group into two lenses: a **strategic lens**
(revenue scale / trajectory, growth rate, target ownership / control, path to
liquidity - weight 55%) and a **financial lens** (entry valuation vs. comps,
capital structure, unit economics - weight 45%). Each lens carries its own
weighted sub-total on the same 1-5 scale and both must clear a shared **3.0
floor**. A deal whose overall weighted total clears the 3.5 pass bar but whose
strategic or financial sub-total sits below the floor is flagged
below_lens_floor and requires the explicit CIO override memo before it can
proceed. A strong strategic case can never mask a weak financial one.

The lens grouping, floor and the derived sub-totals live in
server/config/scorecard.js (SCORECARD_LENSES, SCORECARD_LENS_FLOOR,
evaluateLenses), so the board, the gate and the tests read one source. The lens
definition rides along in GET /api/gate/fields under scorecard.lenses.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | Two-lens sub-totals | analyst_two_lens_subtotals.png | The strategic lens reads 4.27/5 and the financial lens 3.89/5 on the Regional Cold-chain Platform; both clear the 3.0 floor. |
| Analyst (Sirius CIO) | Lens below floor, override | analyst_lens_below_floor_override.png | The Digital Health Growth Platform: strategic 5.0 (clears), financial 2/5 (below floor), and the 3.65 weighted total clears the 3.5 bar, yet the deal is flagged and the CIO override memo control is shown. |

## How it works

1. A reviewer scores the seven criteria on the Screening Board.
2. evaluateScorecard groups the criteria into the two lenses and computes each
   weighted sub-total.
3. If the weighted total clears 3.5 and both lens sub-totals clear 3.0, the
   outcome is proceed.
4. If either lens sub-total is below 3.0, the outcome is override_required
   even when the total clears the bar; a named CIO and a written reason are
   needed to record proceed_override.

## Validation

- node --test server/tests/scorecard.test.js - 18 pass (6 new lens cases).
- BASE_URL=... node --test server/tests/m3.test.js - the two-lens floor
  integration case passes.
- npm run build and eslint clean.

## Notes

- The lens grouping and the 3.0 floor are configuration. A recalibrated set can
  move criteria between lenses or change the floor without a code change (feeding
  SCO-05, W3-08).
- Evidence captured against the demo stack at http://localhost:34010 from the
  mvp seed profile.
