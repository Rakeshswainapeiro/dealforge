// -------------------------------------------------------------------------
// Seeded cast configuration (E2.2 / REQ-RBAC-01).
//
// The users and memberships the app always provisions on boot (the 'base'
// seed profile). Every app_user created here is marked `seeded: true` so the
// cleanup pass (REQ-SEED-02 / W1-11) can distinguish the shipped cast from
// records created during use. The seeded-Sirius set is therefore a publish
// list, not a heuristic: cleanup keeps this set and the org subtree, and
// removes everything else that is marked as seed data.
//
// Memberships name the user by email, not by a fixed membership id, so the
// membership is stable even if the corresponding person row is recreated.
// -------------------------------------------------------------------------

export const SIRIUS_ORG_ID = 'org-sirius-international-holding-limited';
export const INFINIA_ORG_ID = 'org-infinia-technologies-limited';

export const SEEDED_USERS = [
  { id: 'user-admin', email: 'admin@dealforge.local', full_name: 'Local Admin', phone: '+971500000001' },
  { id: 'user-deal-lead', email: 'deal.lead@infinia.local', full_name: 'Infinia Deal Lead', phone: '+971500000002' },
  { id: 'user-cfo', email: 'cfo@infinia.local', full_name: 'Infinia CFO', phone: '+971500000003' },
  { id: 'user-ceo', email: 'ceo@infinia.local', full_name: 'Infinia CEO', phone: '+971500000004' },
  { id: 'user-cluster-head', email: 'cluster.head@sirius.local', full_name: 'Sirius Cluster Head', phone: '+971500000005' },
  { id: 'user-sirius-deal-lead', email: 'deal.lead@sirius.local', full_name: 'Sirius Deal Lead', phone: '+971500000006' },
  { id: 'user-vertical-head', email: 'vertical.head@sirius.local', full_name: 'Sirius Vertical Head', phone: '+971500000007' },
  { id: 'user-cio', email: 'cio@sirius.local', full_name: 'Sirius CIO', phone: '+971500000008' },
  { id: 'user-fahad', email: 'fahad@sirius.local', full_name: 'Fahad (Leadership)', phone: '+971500000009' },
  { id: 'user-aj', email: 'aj@sirius.local', full_name: 'AJ (Leadership)', phone: '+971500000010' },
  { id: 'user-ic', email: 'ic.member@sirius.local', full_name: 'IC Member', phone: '+971500000011' },
  { id: 'user-reviewer', email: 'reviewer@sirius.local', full_name: 'Independent Reviewer', phone: '+971500000012' },
];

// Memberships carry an explicit stable id (the historical convention). The
// email-local-part shortcut is not unique — deal.lead@infinia and
// deal.lead@sirius share a local part — so ids stay explicit.
export const SEEDED_MEMBERSHIPS = [
  { id: 'mem-admin', user_email: 'admin@dealforge.local', org_id: SIRIUS_ORG_ID, roles: ['admin'], can_sign: true, is_primary: true },
  { id: 'mem-deal-lead', user_email: 'deal.lead@infinia.local', org_id: INFINIA_ORG_ID, roles: ['subsidiary_deal_lead'], is_primary: true },
  { id: 'mem-cfo', user_email: 'cfo@infinia.local', org_id: INFINIA_ORG_ID, roles: ['subsidiary_cfo'], can_sign: true, is_primary: true },
  { id: 'mem-ceo', user_email: 'ceo@infinia.local', org_id: INFINIA_ORG_ID, roles: ['subsidiary_ceo'], can_sign: true, is_primary: true },
  { id: 'mem-cluster-head', user_email: 'cluster.head@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['cluster_head', 'opco_signatory'], is_primary: true },
  { id: 'mem-sirius-deal-lead', user_email: 'deal.lead@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['sirius_deal_lead'], is_primary: true },
  { id: 'mem-vertical-head', user_email: 'vertical.head@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['sirius_vertical_head'], is_primary: true },
  { id: 'mem-cio', user_email: 'cio@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['cio'], is_primary: true },
  { id: 'mem-fahad', user_email: 'fahad@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['leadership', 'sirius_vertical_head'], is_primary: true },
  { id: 'mem-aj', user_email: 'aj@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['leadership', 'sirius_vertical_head'], is_primary: true },
  { id: 'mem-ic', user_email: 'ic.member@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['ic_member'], is_primary: true },
  { id: 'mem-reviewer', user_email: 'reviewer@sirius.local', org_id: SIRIUS_ORG_ID, roles: ['independent_reviewer'], is_primary: true },
];

// Emails protected from cleanup (a superset of the seeded cast, so the guard
// also holds any address an operator lists explicitly).
export const PROTECTED_EMAILS = SEEDED_USERS.map((u) => u.email);

export default { SEEDED_USERS, SEEDED_MEMBERSHIPS, PROTECTED_EMAILS };
