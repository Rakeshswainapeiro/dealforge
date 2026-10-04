// ---------------------------------------------------------------------------
// RBAC — roles, org scoping and permission checks (REQ-RBAC-01..04).
//
// Permissions are evaluated as (role x org layer x action/stage). The matrix
// here is the single source of truth used by every server route; the client
// only renders what the server allows.
// ---------------------------------------------------------------------------

// Node types in the organisation tree (REQ-ORG-01).
export const ORG_TYPES = [
  'group',
  'platform',
  'holding',
  'fund_vehicle',
  'cluster',
  'subsidiary',
  'portfolio_company',
  'project',
];

// Roles (REQ-RBAC-01).
export const ROLES = [
  'subsidiary_deal_lead',
  'subsidiary_cfo',
  'subsidiary_ceo',
  'cluster_head',
  'opco_signatory',
  'sirius_deal_lead',
  'sirius_vertical_head',
  'leadership',
  'cio',
  'independent_reviewer',
  'ic_member',
  'board_member',
  'group_compliance',
  'admin',
];

// Human labels for the UI / seeds.
export const ROLE_LABELS = {
  subsidiary_deal_lead: 'Subsidiary Deal Lead',
  subsidiary_cfo: 'Subsidiary CFO',
  subsidiary_ceo: 'Subsidiary CEO',
  cluster_head: 'Cluster / Vertical Head',
  opco_signatory: 'Operating-Company Signatory',
  sirius_deal_lead: 'Sirius Deal Lead',
  sirius_vertical_head: 'Sirius Vertical Head',
  leadership: 'Leadership (Fahad / AJ)',
  cio: 'CIO',
  independent_reviewer: 'Independent Reviewer',
  ic_member: 'IC Member',
  board_member: 'Board Member',
  group_compliance: 'Group Compliance',
  admin: 'Admin',
};

// Which roles may act at which workflow stage action (E7.2 / REQ-WF-02).
// 'fill' is the producing layer, 'review'/'sign'/'approve' move upward.
export const STAGE_ACTIONS = ['fill', 'review', 'sign', 'approve'];

export const ACTION_ROLES = {
  fill: ['subsidiary_deal_lead', 'subsidiary_cfo', 'subsidiary_ceo'],
  review: ['cluster_head', 'opco_signatory', 'sirius_deal_lead', 'sirius_vertical_head', 'cio'],
  sign: ['subsidiary_ceo', 'subsidiary_cfo', 'opco_signatory'],
  approve: ['leadership', 'sirius_vertical_head', 'cio', 'ic_member', 'board_member'],
};

// Roles with a read-only, all-orgs view (Sirius investment team & governance).
export const CROSS_ORG_READ_ROLES = [
  'sirius_deal_lead',
  'sirius_vertical_head',
  'leadership',
  'cio',
  'ic_member',
  'board_member',
  'group_compliance',
  'admin',
];

// Roles that can configure workflows / themes / thresholds (REQ-RBAC-02).
export const ADMIN_ROLES = ['admin'];

export function primaryRole(membership) {
  const roles = membership?.roles || [];
  if (roles.includes('admin')) return 'admin';
  return roles[0] || null;
}

export function hasRole(membership, role) {
  return (membership?.roles || []).includes(role);
}

export function hasAnyRole(membership, roles = []) {
  return roles.some((r) => hasRole(membership, r));
}

export function canActAtStage(membership, action) {
  const allowed = ACTION_ROLES[action] || [];
  return hasAnyRole(membership, allowed) || hasRole(membership, 'admin');
}

export function canSign(membership) {
  return Boolean(membership?.can_sign) || hasRole(membership, 'admin');
}

// Returning a submission for revision is available to whoever can act at the
// stage, plus any reviewer or approver in the route — the investment team can
// always send work back to the producing layer (REQ-FLOW-01/02).
export function canReturnAtStage(membership, action) {
  return canActAtStage(membership, action) || canActAtStage(membership, 'review') || canActAtStage(membership, 'approve');
}

export function canConfigure(membership) {
  return hasAnyRole(membership, ADMIN_ROLES);
}

export function isCrossOrgReader(membership) {
  return hasAnyRole(membership, CROSS_ORG_READ_ROLES);
}

// Visibility (REQ-RBAC-03): own org + descendants, plus explicit grants, plus
// the cross-org read roles. Siblings are never implicitly visible.
export function canViewOrg(membership, targetOrgId, { descendantIds = [], grantedOrgIds = [] } = {}) {
  if (!membership) return false;
  if (isCrossOrgReader(membership)) return true;
  if (!targetOrgId) return false;
  if (targetOrgId === membership.org_id) return true;
  if (descendantIds.includes(targetOrgId)) return true;
  if (grantedOrgIds.includes(targetOrgId)) return true;
  return false;
}

export function canWriteOrg(membership, targetOrgId, { descendantIds = [], grantedOrgIds = [] } = {}) {
  if (!membership) return false;
  if (hasRole(membership, 'admin')) return true;
  if (isCrossOrgReader(membership)) return true;
  if (!targetOrgId) return false;
  if (targetOrgId === membership.org_id) return true;
  if (descendantIds.includes(targetOrgId)) return true;
  if (grantedOrgIds.includes(targetOrgId)) return true;
  return false;
}
