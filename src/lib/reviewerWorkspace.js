// Who gets the read-only Reviewer Workspace (/opportunity?id=...).
//
// It is the Sirius investment-team reviewer roles, mirroring REVIEWER_ROLES on the
// server (server/config/workflowStates.js; a server test keeps the two in step).
// Subsidiary roles (Preparer, CEO, CFO) never get it, so their experience is
// unchanged. This only chooses what is shown; every write is still checked on the
// server, which refuses a Sirius user's edit to a submitted opportunity.
export const REVIEWER_WORKSPACE_ROLES = ['sirius_deal_lead', 'sirius_vertical_head', 'cio', 'leadership', 'cluster_head'];

export const SIRIUS_ROLES = [
  ...REVIEWER_WORKSPACE_ROLES,
  'admin',
  'opco_signatory',
  'independent_reviewer',
  'ic_member',
  'board_member',
  'group_compliance',
];

export function userRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) return user.roles;
  return user.role ? [user.role] : [];
}

export function isSiriusRole(user) {
  if (!user) return false;
  const roles = userRoles(user);
  if (roles.some((r) => r.startsWith('subsidiary_'))) return false;
  if (roles.some((r) => SIRIUS_ROLES.includes(r))) return true;
  if (user.org_id === 'org-sirius-international-holding-limited') return true;
  if (user.organization && user.organization.toLowerCase().includes('sirius')) return true;
  if (user.email && (user.email.endsWith('@sirius.local') || user.email.endsWith('@dealforge.local'))) return true;
  return false;
}

export function isReviewerWorkspaceUser(user) {
  return isSiriusRole(user);
}

// A submitted opportunity is anything past the draft. Legacy state names
// (submission, screening, ...) are all past it too.
export function isSubmittedStatus(status) {
  return Boolean(status) && status !== 'draft';
}
