# W8-06 — User administration hardening (PLT-05)

**Persona:** Administrator (`admin@dealforge.local`)
**Surface:** Super Admin Console → **Users**

## What the shots show

The accept criterion is *"deactivated users lose access immediately"*. The
console now derives one lifecycle status per account and the refusal is enforced
wherever a request resolves to an actor, so a deactivation takes effect on the
very next request rather than at the next sign-in.

`admin_users_status_list.png` — the user list with the **Status** column:
every seeded account reads `active` (green) and the fixture account
`w8-06-fixture@dealforge.local` reads `deactivated` (outlined). The status is a
single derived key rather than two flags the operator has to reconcile.

`admin_deactivation_reactivate.png` — the deactivated account's manage sheet.
The header carries the `deactivated` badge, the summary shows **0 active
session(s)** (deactivation revoked the account's live sessions), and the
lifecycle control has flipped from *Deactivate* to **Reactivate**. The helper
text states the effect plainly: *"Access ends on the next request and live
sessions are revoked."*

## How it works

- `server/config/userAdmin.js` holds the pure vocabulary: `USER_ADMIN_VERSION`
  (`PLT-05.1`), the lifecycle **policy** (`revoke_sessions_on_deactivate`,
  `revoke_sessions_on_ban`, `revoke_sessions_on_password_change`,
  `block_self_deactivation`, `deactivation_takes_effect: 'immediately'`), the
  named **actions** every console operation maps to (so "all actions are
  audited" is enforced by the catalog), the three **statuses** and the helpers
  `userStatus`, `isUserActive`, `accessBlockReason`, `describeUserStatus` and
  `shouldRevokeSessions`.
- `server/users.js` enforces the status in `buildActor`, the single place a
  request becomes an actor: an account whose `app_user.is_active` is false or
  whose Better Auth `user.banned` is set resolves to **no actor**, and a
  presented session for such an account is refused rather than falling through
  to the default-admin identity. Every guard that requires an actor then returns
  401 on the next call.
- `server/admin.js` reads the lifecycle policy (`GET
  /api/admin/user-admin/policy`), revokes sessions per the policy on deactivate,
  ban, password change and the active-flag branch of a profile edit, adds
  `POST /users/:id/reactivate`, and decorates each user with `status`,
  `status_label` and `can_authenticate`.
- `src/pages/SuperAdmin.jsx` badges the derived status and swaps the Deactivate
  control for **Reactivate** on a deactivated account, reporting the number of
  sessions revoked on each action.

## Tests

- `server/tests/userAdmin.test.js` — 7 pass (policy, action catalog, status
  derivation, block reasons, revocation rules).
- `server/tests/userAdminApi.test.js` — 3 pass (the versioned policy, a full
  deactivate → blocked-on-next-request → reactivate → audited cycle, and that a
  deactivated account cannot be resurrected by the default-identity fallback).
