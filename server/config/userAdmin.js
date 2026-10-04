// ---------------------------------------------------------------------------
// User administration policy (W8-06 / BRD PLT-05).
//
// Source of truth: the Phase-1 BRD, Platform & Access - "User administration"
// with the accept criterion "Deactivated users lose access immediately".
//
// The super-admin console already manages app users, memberships, tenancy
// mappings, cross-org grants and the Better Auth identity behind each account.
// What this module governs is the *lifecycle*: an account has a status, every
// admin action is a named (and audited) operation, and a non-active account is
// refused at the single point where a request resolves to an actor - so a
// deactivation takes effect on the very next request rather than at the next
// sign-in.
//
// This module is pure: no database access, so the console, the actor resolver
// and the tests all read the same vocabulary.
// ---------------------------------------------------------------------------

export const USER_ADMIN_VERSION = 'PLT-05.1';

export const USER_ADMIN_CONFIG_KEY = 'user_admin_policy';

// Account status, derived from the two flags the identity layer keeps:
// `app_user.is_active` (the application's own switch) and the Better Auth
// `user.banned` flag (a hard block that also survives an SSO sign-in).
export const USER_STATUSES = [
  { key: 'active', label: 'Active' },
  { key: 'deactivated', label: 'Deactivated' },
  { key: 'banned', label: 'Banned' },
];
export const USER_STATUS_KEYS = USER_STATUSES.map((s) => s.key);

// Lifecycle policy. Every effect that closes an existing session is on by
// default: the accept criterion is immediate loss of access, so a switch that
// is off is the surprising case, not the other way round.
export const USER_ADMIN_POLICY = {
  revoke_sessions_on_deactivate: true,
  revoke_sessions_on_ban: true,
  revoke_sessions_on_password_change: true,
  revoke_sessions_on_password_reset_by_admin: true,
  block_self_deactivation: true,
  deactivation_takes_effect: 'immediately',
};

// The named operations the console performs. Each maps to the audit action
// written on the entity it changes, so "all actions are audited" is a property
// of this catalog rather than a convention spread across the route file.
export const USER_ADMIN_ACTIONS = [
  { key: 'create', entity: 'app_user', label: 'Create user' },
  { key: 'update', entity: 'app_user', label: 'Edit profile' },
  { key: 'deactivate', entity: 'app_user', label: 'Deactivate' },
  { key: 'reactivate', entity: 'app_user', label: 'Reactivate' },
  { key: 'ban', entity: 'app_user', label: 'Ban' },
  { key: 'unban', entity: 'app_user', label: 'Unban' },
  { key: 'set_password', entity: 'app_user', label: 'Set password' },
  { key: 'resync_identity', entity: 'app_user', label: 'Re-sync identity' },
  { key: 'membership_create', entity: 'membership', label: 'Map to organisation' },
  { key: 'membership_update', entity: 'membership', label: 'Change roles / groups' },
  { key: 'membership_delete', entity: 'membership', label: 'Remove organisation mapping' },
  { key: 'grant_create', entity: 'access_grant', label: 'Grant cross-org access' },
  { key: 'grant_delete', entity: 'access_grant', label: 'Revoke cross-org access' },
];
export const USER_ADMIN_ACTION_KEYS = USER_ADMIN_ACTIONS.map((a) => a.key);

export const USER_ADMIN_MESSAGES = {
  inactive: 'This account is deactivated. Contact an administrator to restore access.',
  banned: 'This account has been blocked. Contact an administrator.',
  scope_note:
    'Deactivating or banning an account revokes its live sessions and refuses it on the '
    + 'next request, so access ends immediately. Every user, membership and cross-org '
    + 'grant change is written to the immutable audit trail.',
};

// --- pure helpers ---------------------------------------------------------

// One account's lifecycle status from the app flag and the auth flag.
export function userStatus(user, { banned = false } = {}) {
  if (banned) return 'banned';
  if (user && user.is_active === false) return 'deactivated';
  return 'active';
}

export function isUserActive(user, auth = {}) {
  return userStatus(user, auth) === 'active';
}

// Why an account is refused, or null when it may proceed. Returned to the
// console so it can explain the block without re-deriving the rule.
export function accessBlockReason(user, auth = {}) {
  const status = userStatus(user, auth);
  if (status === 'banned') return { status, code: 'banned', message: USER_ADMIN_MESSAGES.banned };
  if (status === 'deactivated') return { status, code: 'deactivated', message: USER_ADMIN_MESSAGES.inactive };
  return null;
}

// A read shape for the console: the status key, its label and whether the
// account can currently authenticate.
export function describeUserStatus(user, auth = {}) {
  const status = userStatus(user, auth);
  const meta = USER_STATUSES.find((s) => s.key === status) || USER_STATUSES[0];
  return { status, label: meta.label, can_authenticate: status === 'active' };
}

// Whether a lifecycle change should revoke the account's live sessions.
export function shouldRevokeSessions(action, policy = USER_ADMIN_POLICY) {
  if (action === 'deactivate') return Boolean(policy.revoke_sessions_on_deactivate);
  if (action === 'ban') return Boolean(policy.revoke_sessions_on_ban);
  if (action === 'set_password') return Boolean(policy.revoke_sessions_on_password_change);
  return false;
}

export default {
  USER_ADMIN_VERSION, USER_ADMIN_POLICY, USER_ADMIN_ACTIONS, USER_ADMIN_MESSAGES,
  USER_STATUSES, userStatus, isUserActive, accessBlockReason, describeUserStatus, shouldRevokeSessions,
};
