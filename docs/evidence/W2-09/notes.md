# W2-09 — Cross-border considerations (FIN-08)

**Personas:** preparer (Infinia Deal Lead), analyst (Sirius CIO)
**Feature covered:** the conditional cross-border capture. When the target's
geography names a different country from the owning subsidiary's home country,
the preparer captures FX exposure, the withholding-tax position, the
transfer-pricing position and any repatriation restrictions. The block does not
appear at all for a same-country deal. The captured considerations flow through
to the generated Sirius Part B memo as their own table. Advisory only — a
missing consideration raises a flag, it never blocks submission.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_cross_border_complete.png | preparer (Infinia Deal Lead) | The 4c Cross-border considerations card on a cross-border fixture (India target, UAE home). All four textareas are present and populated — FX exposure, withholding tax, transfer pricing and repatriation restrictions — the badge reads 'Cross-border complete' and the green state fires (FIN-08: for a cross-border deal the four considerations are captured; the fields appear because the target geography differs from the subsidiary's home country). |
| preparer_cross_border_not_applicable.png | preparer (Infinia Deal Lead) | A same-country deal (UAE target, UAE home) shows no cross-border card at all: the 4b valuation card flows straight into section 5 with no 4c block between them. The block is conditional on geography, so a domestic deal is never asked for cross-border positions (FIN-08 accept criterion). |
| analyst_memo_cross_border.png | analyst (Sirius CIO) | The captured considerations flow into the generated Sirius Part B memo (section 4): the 'Cross-border considerations' table lists each consideration with its captured position, followed by the note 'Cross-border deal (Republic of India target vs. United Arab Emirates home): FX exposure, withholding tax, transfer pricing and repatriation restrictions captured.' (FIN-08). |

## How it works

server/config/crossBorder.js is the pure source of truth. CROSS_BORDER_FIELDS maps
the four flat capture keys (cross_border_fx, cross_border_wht,
cross_border_transfer_pricing, cross_border_repatriation) and CROSS_BORDER_ITEMS
carries each consideration's label, short code and advisory message in BRD order.
Geographies are free text, so canonicalCountry() maps both sides onto a country
using the GEOGRAPHY_TAGS table in natureOfBusiness.js before comparison — 'UAE'
and 'United Arab Emirates' resolve to the same country, so a UAE target owned by a
UAE subsidiary is a domestic deal. isCrossBorder() returns true only when both
sides resolve and differ. evaluateCrossBorder(data, { homeCountry }) returns the
applies flag, the canonical target and home countries, the four considerations
with their captured text and presence, the captured count, a complete flag (true
when the block does not apply), a flags list and a summary message. A missing
consideration on a cross-border deal raises a flag; nothing blocks submission.
Because the module is the single place the gate, the capture form and the Sirius
memo read, the conditional behaviour can never disagree between them.

server/gate.js resolves the owning subsidiary's registered geography via
getOrganization(ownerOrg) and evaluates the block on evaluateGate, and exposes
the four field names, the items and the applies condition on GET
/api/gate/fields. server/config/siriusMemo.js builds the memo table from the same
evaluation — a 'Cross-border considerations' table plus the target-vs-home note —
only when the block applies, so a domestic deal's memo carries no cross-border
section. src/pages/SubmitOpportunity.jsx renders the 4c card (data-testid
cross-border-card; cross-border-status, cross-border-fx, cross-border-wht,
cross-border-transfer-pricing, cross-border-repatriation, cross-border-flag,
cross-border-ok) in the financials section under the 4b valuation card, and only
when the gate says the block applies; the four flat keys are filtered out of the
generic section loop so they render once inside the card.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W2-09

Tests: server/tests/crossBorder.test.js (10 pass) plus the FIN-08 integration
cases in server/tests/m2.test.js (the gate config exposes the field names and the
items; a same-country deal does not apply; a cross-border deal with all four
captured is complete; a cross-border deal missing considerations is flagged, not
blocked).

