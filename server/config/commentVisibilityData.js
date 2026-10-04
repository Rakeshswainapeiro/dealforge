// ---------------------------------------------------------------------------
// Internal vs shared comment visibility vocabulary (W6-04 / BRD AUD-03).
//
// Source of truth: the Phase-1 BRD, Audit Trail - "Internal vs shared comments"
// with the accept criterion "internal comments are never visible to subsidiary
// roles".
//
// Every clarification comment (a Q&A thread or an individual message) carries a
// visibility of 'shared' or 'internal'. A comment marked internal belongs to the
// Sirius / group investment layer and must never reach a subsidiary-only user,
// while a shared comment is visible to everyone who can already see the owning
// organisation. The enforcement is server-side so the guarantee does not depend
// on the client.
//
// The rule set lives in configuration so Group Compliance can retune who counts
// as the subsidiary layer without a deploy. This module is vocabulary only; the
// pure resolution and enforcement functions live in config/commentVisibility.js
// and the HTTP route in server/commentVisibility.js.
// ---------------------------------------------------------------------------

import { CROSS_ORG_READ_ROLES } from '../rbac.js';

export const COMMENT_VISIBILITY_CONFIG_KEY = 'comment_visibility_config';
export const COMMENT_VISIBILITY_VERSION = 'CVD-01.1';
export const COMMENT_VISIBILITY_VERSION_PREFIX = 'CVD-01.';
export const COMMENT_VISIBILITY_DEFAULT_REVISION = 1;
export const COMMENT_VISIBILITY_OWNER = 'Group Compliance / Investment Team';

// The two visibilities a thread or message can carry.
export const COMMENT_VISIBILITIES = [
  {
    key: 'shared',
    label: 'Shared',
    description: 'Visible to the owning subsidiary and every participant who can already see the opportunity.',
  },
  {
    key: 'internal',
    label: 'Internal (group only)',
    description: 'Never shown to a subsidiary role: hidden from the thread list, the thread detail and notifications.',
  },
];

export const COMMENT_VISIBILITY_KEYS = COMMENT_VISIBILITIES.map((v) => v.key);

// What a comment defaults to when the author does not choose. Shared keeps the
// pre-existing behaviour, so nothing changes until someone marks a comment
// internal.
export const DEFAULT_MESSAGE_VISIBILITY = 'shared';
export const DEFAULT_THREAD_VISIBILITY = 'shared';

// The roles that make up the producing subsidiary layer. A user who holds only
// these roles (and no cross-org read role) may never see an internal comment.
export const DEFAULT_SUBSIDIARY_ROLES = [
  'subsidiary_deal_lead',
  'subsidiary_cfo',
  'subsidiary_ceo',
  'cluster_head',
  'opco_signatory',
];

// A cross-org reader always sees internal comments, whatever else they hold, so
// an administrator or group compliance officer reviewing a subsidiary's thread
// is never locked out of the internal notes.
export const COMMENT_VISIBILITY_CROSS_ORG_ROLES = [...CROSS_ORG_READ_ROLES];

export const COMMENT_VISIBILITY_MESSAGES = {
  config_invalid: 'The comment visibility configuration is invalid.',
  subsidiary_minimum_roles:
    'At least one subsidiary role must be named while the internal-comment restriction is switched on.',
  cross_org_conflict:
    'A cross-org reader role cannot also be listed as a subsidiary role; the restriction would be contradictory.',
  internal_hidden:
    'This comment is internal to the group investment team and is not visible to subsidiary roles.',
  invalid_visibility: 'A comment visibility must be either shared or internal.',
  disclaimer:
    'Internal comments are maintained by the group investment team. They are filtered out of every ' +
    'read and every notification for a subsidiary-only user, so the restriction cannot be bypassed from the client.',
};

export default {
  COMMENT_VISIBILITY_CONFIG_KEY,
  COMMENT_VISIBILITY_VERSION,
  COMMENT_VISIBILITIES,
  COMMENT_VISIBILITY_KEYS,
  DEFAULT_MESSAGE_VISIBILITY,
  DEFAULT_THREAD_VISIBILITY,
  DEFAULT_SUBSIDIARY_ROLES,
  COMMENT_VISIBILITY_CROSS_ORG_ROLES,
  COMMENT_VISIBILITY_MESSAGES,
};
