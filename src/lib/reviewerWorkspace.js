// Who gets the read-only Reviewer Workspace (/opportunity?id=...).
//
// It is the Sirius investment-team reviewer roles, mirroring REVIEWER_ROLES on the
// server (server/config/workflowStates.js; a server test keeps the two in step).
// Administrators are left out on purpose: they keep the screens they have today.
// Subsidiary roles (Preparer, CEO, CFO) never get it, so their experience is
// unchanged. This only chooses what is shown; every write is still checked on the
// server, which refuses a Sirius user's edit to a submitted opportunity.
export const REVIEWER_WORKSPACE_ROLES = ['sirius_deal_lead', 'sirius_vertical_head', 'cio', 'leadership', 'cluster_head'];

export function userRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) return user.roles;
  return user.role ? [user.role] : [];
}

export function isReviewerWorkspaceUser(user) {
  return userRoles(user).some((r) => REVIEWER_WORKSPACE_ROLES.includes(r));
}

// A submitted opportunity is anything past the draft. Legacy state names
// (submission, screening, ...) are all past it too.
export function isSubmittedStatus(status) {
  return Boolean(status) && status !== 'draft';
}
