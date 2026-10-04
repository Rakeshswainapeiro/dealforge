# W8-03 - Unified admin configuration: versioned, audited (BRD ADM-01)

## What this delivers

There has never been a single configuration store. The screening pipeline is
shaped by more than twenty independently stored areas - the scorecard and its
weights, hurdle rates and thresholds, the mandate and strategy themes, the
document checklist and policy, evidence sufficiency, decision reason codes,
delegation of authority, pipeline metrics and SLAs, notification cadence, the
audit chain, comment visibility, related-party rules, the authentication
policy, data sources, reporting, presentations, templates and the portfolio
register - each with its own router, revision counter and audit action.

Rather than replace those stores (and risk breaking every live screen that
reads them), W8-03 layers a single governed registry over them:

- `server/config/adminConfigData.js` - the vocabulary. Every configurable
  area with its stable `domain` id, the topical `group` it belongs to, the
  AppSettings `key` it is stored under (or null when the area is a table or a
  corpus), the `action` written to the audit trail on a change, the API
  `route` an administrator edits it through, the `code` module that resolves
  it, and whether it is `versioned` and `audited`. It also carries the
  groups, the deployment `ADMIN_CONFIG_VERSION` and the scope note.
- `server/config/adminConfig.js` - the pure logic: `configDomain` (case-
  insensitive lookup), `domainsByGroup`, `registrySummary` (counts by group
  and totals) and `buildAdminConfigPayload` (the grouped registry read shape).
  No database access, so it is cheap to test and safe to import anywhere.
- `server/adminConfig.js` - the read / governance surface mounted at
  `/api/admin-config`: the full registry (admin-only), a flat domain list, one
  area's descriptor with its change history, and a per-area history endpoint.
  History is read straight from the immutable `audit_event` table by the
  area's own action, so a revision is only ever "recorded" if it was truly
  audited.
- `src/api/client.js` - the `adminConfig` client (`registry`, `domains`,
  `domain`, `history`).
- `src/pages/Settings.jsx` - a **Configuration Registry** tab. It groups the
  areas, shows the edit route and versioned flag on each, and renders the
  selected area's audited change history.

The registry is a read layer by design: edits still flow through each area's own
router, so the per-area validation, revision bumping and audit write are
untouched. W8-03 makes the whole configuration surface *visible and governable*
without duplicating any of it.

## How the acceptance criteria are met

**"Admin edits versioned + audited."** Every area is registered with its
revision semantics (`versioned`) and its audit action, and 23 of 23 registered
areas are audited. The registry surfaces each area's change history straight
from `audit_event`, so the audit record is the source of truth rather than a
claim in the UI. The registry itself is administrator-only; a non-administrator
receives 403.

**"Applies only to new screenings."** The scope note shown on every registry
view states the policy and the design enforces it: each screening records the
configuration version it was scored against, so publishing a new baseline never
silently re-scores work in flight. The scope-note wording is asserted by the
tests.

## Evidence

1. `admin_config_registry.png` - the Configuration Registry open in Settings:
   23 configurable areas in 7 groups, 21 versioned and 23 audited, each row
   showing the API route that edits it and its versioned flag, with the
   "new screenings only" scope note at the top.
2. `admin_config_domain_history.png` - an area selected (Scorecard & Weights),
   with the Change history panel reading its audited revisions from the
   immutable audit trail and the governance disclaimer underneath.

## Tests

- `server/tests/adminConfig.test.js` (7) - domain lookup, completeness and
  uniqueness of every registered area, group roll-up, and the scope note.
- `server/tests/adminConfigApi.test.js` (6) - the admin-only registry, the
  403 for a non-administrator, the domain list, per-area history scoped to the
  area's action, and 404 for an unknown area.
