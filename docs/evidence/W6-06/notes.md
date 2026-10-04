# W6-06 - Presentation scheduling capture (WF-07)

**BRD requirement:** WF-07 - "Subsidiary presentation scheduling (date, attendees, outcome, next steps)".
**Acceptance criterion:** Captured on record.
**Priority:** Should.

## What this covers

A subsidiary presents a live deal to the group investment layer before it is
screened. This change captures each presentation as a durable session on the
opportunity record: when it is scheduled, who attends, and - once held - the
outcome and the next steps. The session is written to the audit trail on every
create or update.

## Evidence

1. **preparer_presentation_capture_preparer.png** - the owning Infinia deal lead
   (deal.lead@infinia.local) schedules a presentation on the Vision Care Imaging
   Platform opportunity: a scheduled date, the group attendees and a format. The
   panel confirms the session was captured on record.

2. **analyst_presentation_outcome_recorded.png** - the group layer
   (cio@sirius.local) records the outcome and next steps once the session has
   been held. The recorded-sessions list shows the session moved to *completed*
   with its outcome ("Proceed to Gate 1 with the value-enhancement plan.") and
   next steps ("CIO to table the IC pack at the next monthly committee.").

## How it works

- Policy lives in server/config/presentationSessions.js (+
  presentationSessionsData.js): the statuses, formats, required fields
  (scheduled_at, attendees) and the rule that a completed session needs an
  outcome. Stored in AppSettings under presentation_session_config, falling
  back to the shipped default; an admin can replace it (revision + 1, audited).
- The HTTP route server/presentationSessions.js (/api/presentations) exposes
  the policy, the config history, and opportunity-scoped session CRUD. It
  enforces org scope: a subsidiary may manage its own presentations, while a
  cross-org role (group deal lead, CIO, IC member, admin) may see and manage
  any.
- The panel renders on the Opportunity Route page (src/pages/OpportunityRoute.jsx).

## Verification

- server/tests/presentationSessions.test.js - 11 pure-function cases.
- server/tests/m6.test.js - 6 integration cases (policy read, 403 on policy
  change, 422 on missing fields, own-org manage, outcome-required-on-complete,
  audited config edit). Full suite green.
