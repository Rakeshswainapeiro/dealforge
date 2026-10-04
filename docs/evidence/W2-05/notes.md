# W2-05 — Entity WACC with per-opportunity override (FIN-05)

**Personas:** preparer (Infinia Deal Lead), preparer (Finstreet Deal Lead)
**Feature covered:** Sirius sets one cost of capital (WACC) per entity and every
opportunity inherits it. A preparer may override it for a single deal, but only
with a reason: a reasoned override applies and reports its source, while an
override with no reason is flagged rather than applied silently. The effective
WACC feeds the ROIC hurdle (WACC + configured spread), which FIN-04 owns in full.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_wacc_entity_default.png | preparer (Infinia Deal Lead) | An opportunity with no override inherits the entity default: the 4d Cost of capital card reads "Entity default", shows the effective WACC (9% for Infinia) and its source, and compares base ROIC against WACC + spread (FIN-05: default by entity). |
| preparer_wacc_override_with_reason.png | preparer (Finstreet Deal Lead) | A defensible per-deal override: the card reads "Per-deal override", shows the effective WACC (11%) and prints the captured rationale, so an override with a reason is applied and traceable (FIN-05: override requires reason). |
| preparer_wacc_override_missing_reason.png | preparer (Infinia Deal Lead) | The guardrail: an override with no reason is flagged amber ("Override needs a reason") with the reason-required message, never applied silently (FIN-05 accept criterion). |

## How it works

server/config/wacc.js is the pure source of truth. WACC_DEFAULT_PCT is the
shipped house rate (environment-overridable via WACC_DEFAULT_PCT, default 8) so a
deployment can set the cost of capital without a code change. resolveWacc() takes
the opportunity data plus the owning entity's configured rate and returns the
effective WACC, its source (opportunity_override, entity_default or
system_default), whether an override was made, whether its reason is present and
valid, and the message shown in the UI. An override without a reason is recorded
as override_valid: false with the reason-required message. meetsWaccSpread()
compares a return (base ROIC) against WACC + spread and returns null when either
input is missing, so the card shows a placeholder instead of a fabricated verdict.

The entity default lives on the mandate threshold row for the owning org
(mandate_threshold.wacc_pct, added by an idempotent ALTER in server/db.js, falling
back to the global row and then the shipped default). server/themes.js seeds and
returns wacc_pct so Sirius sets it once per entity from the admin ThemeAdmin
screen (a new "Entity WACC (%)" threshold field). server/gate.js resolves the
WACC on evaluateGate against the owner org's thresholds, attaches wacc to the gate
result and exposes the override field, reason field and message on GET
/api/gate/fields as wacc. server/config/intakeConfig.js adds wacc_override_pct and
wacc_override_reason to the financials section (neither required, so the documented
14-key minimum is unchanged). src/pages/SubmitOpportunity.jsx renders the advisory
4d card under the returns card (data-testid wacc-card; wacc-status, wacc-effective,
wacc-source, wacc-roic-summary, wacc-override-reason, wacc-flag).

Fixtures: server/mvpSeed.js sets an entity WACC per fixture org (Infinia 9,
Finstreet 8.5, Sirius 7.5) by merging onto any operator-set thresholds so
re-seeding never resets a configured value. seed-theme-exception (Finstreet) carries
a WACC override with a reason; seed-conflict (Infinia) carries an override with no
reason to demonstrate the advisory flag live.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-05

Tests: server/tests/wacc.test.js (7 pass) and the FIN-05 integration cases in
server/tests/m2.test.js (config exposed, entity-default inheritance, reasoned
override applied, reasonless override flagged).

