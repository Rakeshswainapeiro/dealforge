# W5-03 — Content sufficiency check (DOC-04)

BRD requirement **DOC-04** (Documents & Completeness, Should): a content
sufficiency check that flags thin content — for example a model missing cash
flow, fewer than three years of history, or no downside case — advisory to both
the preparer before submission and the reviewer after, with a reviewer override
that carries a written reason.

## What was built

1. `server/config/sufficiencyData.js` holds the vocabulary and the shipped
   default: the six advisory rules (cash flow present, at least three years of
   history, downside scenario present, three-statement model attached, risk
   register attached, market data attached), the categories, the BRD example
   keys, the minimum-history threshold and the operator wording.
2. `server/config/sufficiency.js` is the pure module —
   `defaultSufficiencyConfig`, `validateSufficiencyConfig`,
   `resolveSufficiencyConfig`, `diffSufficiencyConfig`,
   `buildSufficiencyConfig` (mints revision + 1 and the matching `SUF-01.N`
   version), `evaluateSufficiency`, `buildSufficiencyOverride` (a written
   reason of at least ten characters) and `sufficiencyOverridesFromData`. The
   evaluator reads only the evidence other modules already produce — the
   financial matrix, the three-statement model, the return metrics and the
   attached document keys — and never re-derives a rule. Every finding is a flag
   with its observed and expected value; nothing blocks.
3. `server/sufficiency.js` holds the configuration in an AppSettings record
   (`setting_key = 'sufficiency_config'`) and exposes `GET /api/sufficiency`,
   `PUT /api/sufficiency` (admin-only, mints a revision, writes the
   `sufficiency_config_updated` audit event) and `GET /api/sufficiency/history`.
   Mounted in `server/index.js`.
4. `server/gate.js` evaluates the check on every `evaluateGate` and returns it
   as the `sufficiency` block on the gate result and on `/api/gate/fields`. It
   adds three routes: `GET
   /api/gate/opportunities/:id/sufficiency` (the check for one opportunity),
   `POST .../sufficiency-override` (a reviewer, CIO, admin or leadership seat
   records an override with a written reason; the override is stored on the
   opportunity and audited) and `GET .../sufficiency/history`.
5. `server/config/screeningPanel.js` names the open sufficiency flags on the
   single screening panel's completeness check with a `sufficiency` reference
   each — the reviewer-post half of the criterion.
6. `src/api/client.js` adds the sufficiency methods; `src/pages/Settings.jsx`
   adds the admin **Sufficiency Check** tab (revision badge, the minimum-history
   threshold and a per-rule enable toggle); `src/pages/SubmitOpportunity.jsx`
   renders the preparer-side card with each flag's observed and expected value.

## Validation

- `node --test server/tests/sufficiency.test.js` — 27 pass, 5 suites (shipped
  configuration, validation, resolve and mint, evaluation, reviewer override).
- `BASE_URL=http://localhost:34099 node --test server/tests/*.test.js` — 674
  pass / 155 suites, including the four W5-03 integration cases in
  `server/tests/m6.test.js`: a reader sees the effective configuration and the
  shipped default, a deal lead gets 403 on PUT, an admin edit mints revision + 1
  and is recorded in history, and the gate flags thin content on a draft while a
  reviewer override with a reason clears the flag and is audited.
- eslint clean on the touched files; `npm run build` passes.
- Demo verification: `GET /api/sufficiency` on the demo stack returns `SUF-01.1`
  with the three-year threshold and the BRD example rules enabled.

## Notes

The check is advisory end to end: a flag is raised, never enforced, and a
reviewer override with a written reason clears it. The rules and the
minimum-history threshold are admin-editable, so a change mints a new revision
without a code change. Evidence captured against the demo stack at
http://localhost:34010.

