// Test support: attestations are recorded through their own endpoint by the
// person who signs (INT-09), never written in the create payload. Integration
// suites that build a "fully attested" draft pass `attestations` in the create
// body as a shorthand; this wrapper strips it and signs through the real
// endpoint, as the Infinia CEO and CFO (or the admin for another subsidiary).
//
//   async function rawApi(path, opts) { ... }
//   const api = withAttestationSigning(rawApi);

const SIGNERS = { ceo: ['user-ceo', 'user-admin'], cfo: ['user-cfo', 'user-admin'] };

export function withAttestationSigning(rawApi) {
  return async function api(path, opts = {}) {
    const body = opts.body;
    const isCreate = (opts.method || 'GET').toUpperCase() === 'POST'
      && path === '/api/entities/DealOpportunity'
      && body && typeof body === 'object' && 'attestations' in body;
    if (!isCreate) return rawApi(path, opts);

    const { attestations, ...rest } = body;
    const created = await rawApi(path, { ...opts, body: rest });
    const keys = attestations && typeof attestations === 'object' ? Object.keys(attestations) : [];
    if (created.status !== 201 || !created.data?.id || !keys.length) return created;

    for (const key of keys) {
      for (const user of SIGNERS[key] || ['user-admin']) {
        const signed = await rawApi('/api/gate/opportunities/' + created.data.id + '/attestations/' + key, { method: 'POST', user });
        if (signed.status === 201) break;
      }
    }
    const fresh = await rawApi('/api/entities/DealOpportunity/' + created.data.id, { user: opts.user });
    return fresh.status === 200 ? { ...created, data: fresh.data } : created;
  };
}

export default withAttestationSigning;
