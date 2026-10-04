# W6-07 - Notification email frequency (NTF-01)

**BRD requirement:** NTF-01 - "Notification email frequency (immediate / daily digest)".
**Acceptance criteria:** User-selectable frequency; entity isolation respected.
**Priority:** Must.

## What this covers

Each user chooses whether event email is delivered as it happens (*immediate*) or
batched into a single *daily digest*. The group can switch the choice off and fix
a default. When a user is on the digest, the email channel is recorded and
deferred rather than sent, and a digest composes that user's own notification
rows. Because the digest only ever groups the rows addressed to that same
recipient, the entity isolation that governs the notification is preserved.

## Evidence

1. **preparer_notification_frequency_user_choice.png** - a subsidiary deal lead
   (deal.lead@infinia.local) selects *Daily digest* for their own inbox; the
   "Effective: daily_digest" indicator reflects the choice.

2. **admin_notification_frequency_policy_admin.png** - the administrator view of
   the group policy (per-user choice on, group default immediate, digest hour 7)
   with the per-user digest preview reporting the caller's own items only.

## How it works

- Policy lives in server/config/notificationFrequency.js (+
  notificationFrequencyData.js): the allowed frequencies, whether users may
  choose, the group default and the digest hour. Stored in AppSettings under
  notification_frequency_config, falling back to the shipped default; an admin
  replaces it (revision + 1, audited).
- The per-user choice is the notification_frequency column on app_user; the HTTP
  route server/notificationFrequency.js (/api/notification-frequency) reads the
  policy and the caller's own choice, lets any user set their own (422 on an
  unknown value or a locked policy) and lets an admin edit the policy.
- GET /api/notification-frequency/digest composes the caller's own digest.
- server/notify.js consults the recipient's effective frequency before the email
  transport call: a digest user's email row is recorded with status *deferred*
  and detail "queued for daily digest" instead of being sent.

## Verification

- server/tests/notificationFrequency.test.js - 10 pure-function cases.
- server/tests/m6.test.js - 6 integration cases (policy read; a user sets and
  round-trips their own frequency; 422 on an unknown value; 403 on a policy
  change by a deal lead; the digest contains only the caller's own rows; an
  admin edit mints revision + 1 and history). Full suite green.
