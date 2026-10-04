// ---------------------------------------------------------------------------
// Data residency posture (W9-03 / BRD NFR-01).
//
// NFR-01 requires that the platform's data sits in, or is lawfully transferred
// to, UAE sovereign hosting. The sign-off itself is a Sirius IT/security
// activity, but the deployment posture can be inspected: which external services
// the platform can reach and whether each is pinned to an approved region. This
// module classifies the deployment's outbound dependencies and reports what is
// still unpinned, so the sign-off is grounded in the real configuration rather
// than prose.
// ---------------------------------------------------------------------------

export const RESIDENCY_VERSION = 'NFR-01.1';

// The regions considered in-jurisdiction for the Sirius deployment. A dependency
// whose region is not in this list, or which has no region pinned, is flagged.
export const APPROVED_REGIONS = ['me-central-1', 'me-central-2', 'uae', 'ae'];

// The outbound dependencies the platform can be configured to use. Local
// storage and an in-boundary self-hosted model keep bytes in-jurisdiction by
// default; a managed object store, a hosted model and an external mail relay are
// where residency has to be pinned.
export const RESIDENCY_DEPENDENCIES = [
  { id: 'postgres', label: 'Postgres (metadata)', kind: 'primary', env: null, in_boundary: true, note: 'The application database; provisioned in the sovereign region with the deployment.' },
  { id: 'storage', label: 'Object storage', kind: 'bytes', env: 'S3_REGION', in_boundary: false, note: 'Local-disk mode keeps bytes on the application host; S3 mode must set S3_REGION to an approved region.' },
  { id: 'ai_model', label: 'Model provider', kind: 'processor', env: 'OPENAI_BASE_URL', in_boundary: false, note: 'A self-hosted in-boundary endpoint (LocalAI) keeps prompts in-jurisdiction; a hosted OpenAI/Azure endpoint does not unless it is a UAE Azure region.' },
  { id: 'mail_relay', label: 'Notification delivery', kind: 'processor', env: 'NOTIFY_BASE_URL', in_boundary: false, note: 'In-app notifications stay in the database; email/SMS relay through the configured endpoint.' },
];

function regionOf(env) {
  if (!env) return null;
  const value = process.env[env];
  return value ? String(value) : null;
}

// Classify the deployment. A dependency is:
//   - in_boundary: it runs inside the sovereign boundary by construction.
//   - pinned: it is configured and its region is approved.
//   - local: it is not configured (so no cross-border transfer happens).
//   - unpinned: it is configured with a region that is not approved, or with no
//     region at all, which is the gap that needs a sign-off decision.
export function classifyResidency(env = process.env) {
  const read = (k) => (k && env[k] ? String(env[k]) : null);
  const deps = RESIDENCY_DEPENDENCIES.map((d) => {
    if (d.in_boundary) {
      return { ...d, configured: true, region: read('S3_REGION') || 'in-boundary', status: 'in_boundary' };
    }
    const configured = Boolean(read(d.env));
    // Storage region is the S3_REGION env; other deps are pinned by their base
    // URL naming a region, which we do not assume, so they default to unpinned
    // unless an explicit residency env overrides.
    let region = null;
    if (d.id === 'storage') region = configured ? read('S3_REGION') : null;
    else region = configured ? (read('DATA_RESIDENCY_REGION') || null) : null;
    let status;
    if (!configured) status = 'local';
    else if (region && APPROVED_REGIONS.includes(String(region).toLowerCase())) status = 'pinned';
    else status = 'unpinned';
    return { ...d, configured, region, status };
  });

  const unpinned = deps.filter((d) => d.status === 'unpinned');
  const inJurisdiction = deps.filter((d) => ['in_boundary', 'local', 'pinned'].includes(d.status));
  return {
    version: RESIDENCY_VERSION,
    approved_regions: APPROVED_REGIONS,
    dependencies: deps,
    summary: {
      total: deps.length,
      in_jurisdiction: inJurisdiction.length,
      unpinned: unpinned.length,
      unpinned_ids: unpinned.map((d) => d.id),
    },
    // The platform posture is clean when no configured dependency is unpinned.
    // The sign-off (the Sirius IT/security decision) is still external.
    posture_satisfied: unpinned.length === 0,
    signoff: {
      status: 'external',
      owner: 'Sirius IT / Security',
      policy: 'A Sirius IT/security sign-off is required for any configured dependency that is not pinned to an approved region.',
    },
  };
}

export default { RESIDENCY_VERSION, APPROVED_REGIONS, RESIDENCY_DEPENDENCIES, classifyResidency };

