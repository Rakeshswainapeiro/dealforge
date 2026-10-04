# W6-03 - Related-party overlay: arm's-length documentation and independent sign-off (WF-06)

Accept criterion: *case cannot reach the Screening Decision without an independent sign-off; conflicted users are ineligible.*

## What this delivers
A related-party flag - set either from an affiliate sourcing channel or from the
review itself - becomes an enforced governance gate on the Gate-1 Screening
Decision. A flagged deal cannot be moved on to Gate 2 or declined until a
disclosure is on file, a written arm's-length basis and its evidence note are
recorded, and an independent reviewer - in a role the configuration delegates and
not conflicted with the deal - has signed off.

A conflicted user (the deal's preparer, or anyone the review names as conflicted)
is ineligible both to sign off and to take the decision. The refusal carries the
overlay verdict so the interface can explain what is outstanding.

## Where it lives
- Config (pure): `server/config/relatedParty.js`, `server/config/relatedPartyData.js`
- API: `server/relatedParty.js` - `GET /api/related-party` (config + bases),
  `PUT /api/related-party` (admin-only), `GET /api/related-party/history`,
  `GET/PUT /api/related-party/opportunities/:id`, and
  `POST /api/related-party/opportunities/:id/signoff`
- Enforcement: `server/pipeline.js` `transition()` - a Gate-1 move on a flagged
  deal is refused with 403 `{ related_party, conflicted, missing: ['independent_signoff'] }`
  while the overlay is blocked or the actor is conflicted; an allowed decision
  stamps `related_party_overlay` on the record and writes a
  `related_party_overlay_applied` audit event
- Read path: the screening board card carries a `related_party_overlay` block
  and the board returns the effective overlay config
- UI: Settings -> **Related-Party Overlay** tab; the opportunity route carries
  the overlay record form and the independent sign-off control, and the
  Screening Board detail sheet explains the block and disables the decision
  controls

## How to reproduce
1. Demo stack: `docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build` -> http://localhost:34010
2. As admin, open **Settings -> Related-Party Overlay**: the four enforcement
   switches, the delegated sign-off roles and the accepted arm's-length bases.
   Saving mints `RPT-01.N`.
3. As the preparer, open *Affiliate Referral - Digital Assets Custody* from
   Intake: the overlay reads **Open**, lists the outstanding arm's-length items
   and shows the disclosure / basis / evidence form.
4. As the Independent Reviewer, the same route shows the sign-off control. On the
   Screening Board the flagged card carries an amber overlay panel and the
   Refinement / Declined controls are disabled. The server refuses the same move
   with 403 and the overlay verdict; after `POST .../signoff` it succeeds and the
   record is stamped `signed_off`.

## Evidence
- `admin_related_party_overlay_admin.png` - the maintained overlay with the four enforcement switches, delegated sign-off roles and accepted arm's-length bases.
- `preparer_arm_length_record_preparer.png` - the overlay record on the opportunity route: status, outstanding items and the arm's-length basis / evidence form.
- `reviewer_independent_signoff_reviewer.png` - the independent sign-off control available to the non-conflicted, delegated reviewer.
- `reviewer_gate1_decision_blocked_no_signoff.png` - the screening board panel that blocks the decision while the overlay is open.

## Tests
- `server/tests/relatedParty.test.js` - 12 unit tests (defaults, validation, revision minting, overlay resolution, conflicted-user detection, sign-off and decision eligibility).
- `server/tests/m6.test.js` - integration: reader sees the overlay config + default, deal lead blocked (403), admin edit mints revision + audits, a flagged deal's Gate-1 decision is refused until the arm's-length record and independent sign-off are in place, and a conflicted user is ineligible to sign off or decide.
