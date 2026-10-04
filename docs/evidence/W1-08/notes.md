# W1-08 — Sourcing-channel side-effects

**Personas:** preparer (Infinia Deal Lead)
**Feature covered:** the mandatory sourcing channel and its automatic
side-effects (INT-05) — an IHC / affiliate referral auto-sets the related-party
flag, and a banker / advisor-led process sets a compressed-timeline indicator,
shown on the submission screen and carried into the memo.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| preparer_sourcing_affiliate_related_party.png | preparer (Infinia Deal Lead) | An IHC / affiliate referral sets the related-party flag automatically: the sourcing card reads "Sourcing channel — IHC / affiliate referral" and states the flag is set and an independent reviewer must sign off. |
| preparer_sourcing_banker_compressed_timeline.png | preparer (Infinia Deal Lead) | A banker / advisor-led channel sets the compressed-timeline indicator: the card reads "Sourcing channel — Banker / advisor-led" and names the accelerated diligence and decision window. |

## How it works

server/config/sourcingChannel.js declares the channel field, the
COMPRESSED_TIMELINE_CHANNEL, the related-party and compressed-timeline tags and
messages, and the pure evaluateSourcingChannel(data) — the channel is required
(a blank or unrecognised value is a stop), an IHC / affiliate referral
(related_by_default) auto-sets the related-party flag, and a banker / advisor-led
channel sets the compressed-timeline indicator. server/gate.js returns
sourcing_channel from evaluateGate and GET /api/gate/fields, blocks submission
with 422 until a recognised channel is recorded, and on submit persists
sourcing_tags plus related_party_auto_flag / compressed_timeline. The channel
already feeds the W1-01 self-screen through relatedPartyAnswerFromData, so the
related-party advisory flag fires from the same channel. src/pages/
SubmitOpportunity.jsx renders the sourcing-channel-effects and
sourcing-channel-required alerts; server/config/siriusMemo.js adds a
"Sourcing channel" key-fact and a "Sourcing side-effects" note so the memo
shows the flags too.

Fixtures: seed-related-party — an IHC-affiliate referral that auto-flags a
related-party review; and seed-banker-led — a banker / advisor-led draft that
sets the compressed-timeline indicator.

## Reproduce

    docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
    BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-08

Tests: server/tests/sourcingChannel.test.js (8 pass) and the W1-08 block in
server/tests/m2.test.js (5 pass). Commit: feat(intake): sourcing-channel
side-effects (W1-08).

