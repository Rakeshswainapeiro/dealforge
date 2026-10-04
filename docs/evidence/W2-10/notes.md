# W2-10 — Reporting currency and per-opportunity FX rate (NFR-08)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** every financial figure carries a currency and a unit, and
the FX rate used is recorded per opportunity. The whole page-4 financial matrix
is captured in millions, so the unit is always ‘mn’. AED is the Sirius base: a
default deal is reported in AED mn and no rate is needed. Where the mandate
works in USD, the preparer reports in USD and records the AED-per-USD rate used
so every figure is reproducible against the AED base. A USD deal with no rate is
flagged — advisory, never blocked — matching the financials workstream pattern.
The chosen currency and unit flow through to the generated Sirius Part B memo.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_currency_complete_usd.png | preparer (Infinia Deal Lead) | A USD-reported deal (US Water Infrastructure Platform) with the FX rate recorded: the ‘Reporting currency & FX rate’ card sits at the top of the financials section, the badge reads ‘Currency complete’, the unit note reads ‘Matrix unit: USD mn · FX rate 3.6725 AED/USD’, and the green state names the rate used. The section 4a heading reads ‘Financial summary (USD mn)’ (NFR-08: currency and unit shown on every financial field; FX rate recorded). |
| preparer_currency_default_aed.png | preparer (Infinia Deal Lead) | The default AED base (Vision Care Imaging Platform): the reporting currency is AED, the FX rate field is disabled with ‘Applies only when reporting in USD’, the unit note reads ‘Matrix unit: AED mn’ and the card is complete with no advisory flags. No rate is asked for on a base-currency deal (NFR-08: figures in AED mn by default). |
| preparer_currency_flag_missing_rate.png | preparer (Infinia Deal Lead) | A USD-reported deal with no rate captured (US Cold-chain Logistics Bolt-on): the badge reads ‘FX rate missing’ and the amber advisory flag asks for the AED-per-USD rate. The draft is never blocked — the flag is advisory evidence (NFR-08). |
| analyst_memo_currency_label.png | analyst (Sirius CIO) | The USD-reported deal flows into the generated Sirius Part B memo: the page-4 financial matrix is headed ‘Financials (USD mn)’ with the unit column reading ‘USD mn’ next to every figure, and the note beneath the returns table reads ‘Reporting currency & units: USD mn · FX rate 3.6725 AED/USD.’ (NFR-08: currency and unit shown on every financial field). |

## How it works

server/config/currency.js is the pure source of truth. BASE_CURRENCY is ‘AED’ and
BASE_UNIT is ‘mn’; REPORTING_CURRENCIES lists the currencies a deal may be
reported in (AED the base, USD where the mandate works in dollars). CURRENCY_FIELDS
maps the two flat capture keys: reporting_currency and fx_rate_usd_aed (AED per
USD). normaliseCurrency() uppercases the choice and falls back to the base for a
blank or unknown value, so an unset deal is an AED deal. evaluateCurrency(data)
returns the canonical currency, the unit, whether a rate is required (a non-base
currency), whether a rate is present and valid (a positive number), the
currency + unit label (‘AED mn’ / ‘USD mn’), a complete flag, a flags list and a
summary message. A USD deal without a rate raises an fx_rate_missing flag; a
non-positive rate raises fx_rate_invalid. toBaseCurrency(value, {currency,
fx_rate}) converts a USD amount into the AED base at the recorded rate and returns
null when a conversion is impossible. Nothing blocks submission — the rate is
advisory evidence.

server/gate.js evaluates the block on evaluateGate and exposes the base currency,
the two field names and the currency options on GET /api/gate/fields. The page-4
matrix builder in server/config/siriusMemo.js labels the finTable section
‘Financials (<label>)’ and sets its unit column to the label, and adds a
‘Reporting currency & units’ note beneath the returns table; the same is written
into the exported DOCX by server/siriusMemoDocx.js and rendered in the on-screen
memo by src/components/pipeline/SiriusMemoDialog.jsx. src/pages/SubmitOpportunity.jsx
renders the ‘Reporting currency & FX rate’ card at the top of the financials
section (data-testid currency-card; currency-status, currency-select,
currency-fx-rate, currency-unit-note, currency-flag, currency-ok), makes the
section 4a heading read the chosen currency + unit, disables the rate field on the
base currency and filters the two flat keys out of the generic section loop so
they render once inside the card.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-10

Tests: server/tests/currency.test.js (8 pass) plus the NFR-08 integration cases in
server/tests/m2.test.js (the gate config exposes the base currency and the two
field names; a default deal reports in AED mn with no flags; a USD deal with a
recorded rate is complete; a USD deal without a rate is flagged, not blocked).

