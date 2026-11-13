import { userRoles } from '@/lib/reviewerWorkspace';

export const SIRIUS_ROLES = [
  'sirius_deal_lead',
  'sirius_vertical_head',
  'cio',
  'leadership',
  'cluster_head',
  'opco_signatory',
  'independent_reviewer',
  'ic_member',
  'board_member',
  'group_compliance',
  'admin',
];

export function isSiriusRole(user) {
  if (!user) return false;
  const roles = userRoles(user);
  // Producer roles are subsidiary only
  if (roles.some((r) => r.startsWith('subsidiary_'))) return false;
  if (roles.some((r) => SIRIUS_ROLES.includes(r))) return true;
  if (user.org_id === 'org-sirius-international-holding-limited') return true;
  if (user.organization && user.organization.toLowerCase().includes('sirius')) return true;
  if (user.email && (user.email.endsWith('@sirius.local') || user.email.endsWith('@dealforge.local'))) return true;
  return false;
}
