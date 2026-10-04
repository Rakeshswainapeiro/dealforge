# W9-03 — UAE data residency / sovereign hosting (BRD NFR-01)

Requirement: **NFR-01** — the platform and its data dependencies are hosted in
the UAE, and that hosting posture is signed off by Sirius IT/security.

## What the platform can prove by itself

`server/config/residency.js` classifies every dependency the running instance
actually talks to against the approved sovereign regions
(`me-central-1`, `me-central-2`, `uae`, `ae`). The pure classifier is unit
tested in `server/tests/residency.test.js` (7 tests). The result is surfaced in
two places a reviewer can inspect:

- `GET /api/health` now returns a `residency` block.
- The **Settings → AI Governance** tab renders a `Data residency (NFR-01)`
  panel (`data-testid="data-residency"`) alongside the security posture.

## Result (this instance)

| Dependency | Kind | Status |
|---|---|---|
| Postgres (metadata) | primary | in-boundary |
| Object storage | bytes | local (S3 mode must pin `S3_REGION`) |
| Model provider | endpoint | local (self-hosted in-boundary) |
| Notification delivery | relay | **unpinned** (relay endpoint must be a UAE provider) |

The panel shows a red `1 unpinned - sign-off external` badge when any configured
dependency is unpinned, which is the honest signal a reviewer needs.

## What is external

The **hosting sign-off** is a Sirius IT/security activity, not a code artifact.
It is tracked as an open go-live dependency in the W9-02 security control
register (control `uae_data_residency`, status `External`). This row is therefore
recorded as **Blocked** on the external sign-off; the platform-side posture is
inspectable and complete.

## Evidence

- `admin_data_residency_posture.png` — Settings → AI Governance, residency panel
  with the external-sign-off badge.
