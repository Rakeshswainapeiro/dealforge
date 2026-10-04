# W6-02 - Delegation of Authority thresholds by ticket size (WF-08)

Accept criterion: *RACI enforced at Gate 1.*

## What this delivers
The Gate-1 decision - moving a screened item on to Gate 2, or declining it - is
reserved to the party the ticket band makes accountable. Every other role is
refused with 403 and told which band owns the decision and which roles are
delegated it, so the RACI matrix is enforced rather than documented.

Four ordered ticket bands ship, each naming the R/A/C/I each DoA party holds and
the platform roles that may actually take the decision:

| Band | AED mn | Accountable | Delegated roles |
| --- | --- | --- | --- |
| Standard | 0 - 200 | Vertical Head | Sirius Deal Lead, Sirius Vertical Head |
| Elevated | 200 - 400 | CIO | + CIO |
| Investment Committee | 400 - 750 | IC | CIO, IC Member |
| Board | 750 + | Board | Board Member |

A floor is inclusive and a ceiling exclusive, so adjacent bands never both claim
a boundary value. When the ticket size is not captured the standard decision set
applies and the resolution is flagged `unknown_size`, so the board shows the gap
rather than a false authority.

## Where it lives
- Config (pure): `server/config/doa.js`, `server/config/doaData.js`
- API: `server/doa.js` - `GET /api/doa`, `POST /api/doa/resolve`, `PUT /api/doa`
  (admin-only), `GET /api/doa/history`, `GET /api/doa/opportunities/:id`
- Enforcement: `server/pipeline.js` `transition()` - a Gate-1 transition is
  refused with 403 `{ doa, missing: ['doa_authority'] }` when the actor is not
  delegated; an allowed decision stamps `gate1_authority` on the record and
  writes a `gate1_authority_applied` audit event
- Read path: the screening board card carries a `gate1_authority` block and the
  board returns the effective matrix
- UI: Settings -> **Delegation of Authority** tab; the Screening Board detail
  sheet shows the band, its accountable party and whether the current user may
  decide, and disables the Refinement / Declined controls when they may not

## How to reproduce
1. Demo stack: `docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build` -> http://localhost:34010
2. As admin, open **Settings -> Delegation of Authority**: four bands, each with
   its floor / ceiling, a RACI select per party and the delegated roles. Editing a
   band to overlap another raises an inline error and disables **Save revision**;
   a valid edit mints `DOA-01.2`.
3. As the CIO, open *Digital Health Growth Platform* (AED 210mn, Elevated band) on
   the Screening Board: the panel reads *Gate 1 - Elevated band. Accountable: CIO.
   Your role may take the screening decision.* and **Refinement** is enabled.
4. As the Independent Reviewer, open the same item: the panel turns amber and
   **Refinement** is disabled, explaining that only the delegated roles may move
   the item. The server refuses the same move with 403 and the band detail.

## Evidence
- `admin_doa_matrix_admin.png` - the maintained matrix with per-band floors, ceilings, RACI selects and delegated role checkboxes.
- `analyst_gate1_authority_delegated_cio.png` - the CIO (delegated for the Elevated band) sees the green panel and an enabled Refinement control.
- `reviewer_gate1_authority_not_delegated_reviewer.png` - the reviewer (not delegated) sees the amber panel and the disabled Refinement control.

## Tests
- `server/tests/doa.test.js` - 17 unit tests (defaults, RACI completeness, validation incl. overlap / bad ranges / empty roles, partial-store resolve, revision minting, band boundaries, unknown size, above-all, authorised vs refused, decision roles).
- `server/tests/m6.test.js` - integration: reader sees the matrix + default, resolving a size names the accountable party and decides auth, deal lead blocked (403), admin edit mints revision + audits, an overlapping edit is refused (400), and a Gate-1 decision by a non-delegated role is 403 while the delegated role succeeds with `gate1_authority` stamped on the record and audited.
