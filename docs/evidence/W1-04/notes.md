# W1-04 — Accretion Statement structured fields

**Persona:** preparer (Infinia Deal Lead, `deal.lead@infinia.local`)
**Feature covered:** the two-level Accretion Statement (§3.3, REQ-SUB-02) and its
mandatory structured fields.

## Shot

| File | What it proves |
|------|----------------|
| `preparer_accretion_statement.png` | The Accretion statement (§3.3) section with its three structured fields populated on the worked fixture — Adds net earnings 18 (AED mn), Adds return 120 (bps), and the Sirius-portfolio rationale — and the section indicator 3/3 (100%). |

## How it works

`intakeConfig.js` declares the `accretion` section and its fields
(`accretion_net_earnings_aed`, `accretion_bps`, `sirius_accretion_rationale`); the
gate scores them and `server/siriusMemoDocx.js` renders them into the memo, so the
capture form and the generated memo stay in step.

## Reproduce

```
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-04
```

## Tests

`server/tests/intake.test.js` accretion case; commit `064caee`.
