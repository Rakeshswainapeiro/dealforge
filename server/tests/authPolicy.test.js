// ---------------------------------------------------------------------------
// Authentication policy pure functions (W8-01 / BRD PLT-04).
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAuthPolicy, resolveAuthPolicy, validateAuthPolicy, validateProvider,
  normalizeProvider, providersFromEnv, mergeProviders, redactProvider,
  diffAuthPolicy, buildAuthPolicy, mfaRequiredForRoles, isLocalDomainAllowed,
  providerForDomain, sessionMfaSatisfied, MFA_MODE_KEYS, SSO_PROVIDER_KINDS,
} from '../config/authPolicy.js';

describe('auth policy config', () => {
  test('default policy advertises MFA without enforcing it', () => {
    const d = defaultAuthPolicy();
    assert.equal(d.mfa_mode, 'required_admins');
    assert.equal(d.enforce_mfa, false);
    assert.equal(d.enforce_local_domain_allowlist, false);
    assert.ok(d.local_account_domains.includes('sirius.local'));
    assert.deepEqual(d.providers, []);
    assert.equal(validateAuthPolicy(d).ok, true);
  });

  test('resolveAuthPolicy coerces an unknown MFA mode to the default', () => {
    const c = resolveAuthPolicy({ mfa_mode: 'nonsense', enforce_mfa: true });
    assert.equal(c.mfa_mode, 'required_admins');
    assert.equal(c.enforce_mfa, true);
  });

  test('resolveAuthPolicy accepts a JSON string and ignores non-objects', () => {
    assert.equal(resolveAuthPolicy('{"mfa_mode":"off"}').mfa_mode, 'off');
    assert.equal(resolveAuthPolicy(null).mfa_mode, 'required_admins');
    assert.equal(resolveAuthPolicy('{not json').mfa_mode, 'required_admins');
  });

  test('every declared MFA mode validates', () => {
    for (const mode of MFA_MODE_KEYS) {
      assert.equal(validateAuthPolicy({ mfa_mode: mode }).ok, true, mode);
    }
  });
});

describe('SSO providers', () => {
  test('normalizeProvider keeps a stable shape and defaults source to runtime', () => {
    const p = normalizeProvider({ provider_id: 'corp', kind: 'OIDC', domain: 'Corp.example' });
    assert.equal(p.provider_id, 'corp');
    assert.equal(p.kind, 'oidc');
    assert.equal(p.domain, 'corp.example');
    assert.equal(p.source, 'runtime');
    assert.equal(p.enabled, true);
  });

  test('validateProvider requires the protocol-specific fields', () => {
    const oidc = validateProvider({ provider_id: 'a', kind: 'oidc', domain: 'x.com' });
    assert.ok(oidc.some((e) => e.field === 'client_id'));
    assert.ok(oidc.some((e) => e.field === 'client_secret'));
    const saml = validateProvider({ provider_id: 'b', kind: 'saml', domain: 'x.com' });
    assert.ok(saml.some((e) => e.field === 'entry_point'));
    assert.ok(saml.some((e) => e.field === 'cert'));
    const ok = validateProvider({ provider_id: 'c', kind: 'oidc', domain: 'x.com', issuer: 'https://idp.x.com', client_id: 'id', client_secret: 's' });
    assert.deepEqual(ok, []);
  });

  test('validateProvider rejects an unknown kind', () => {
    const errs = validateProvider({ provider_id: 'x', kind: 'kerberos', domain: 'x.com' });
    assert.ok(errs.some((e) => e.field === 'kind'));
  });

  test('providersFromEnv reads the SSO_<ID>_* convention', () => {
    const providers = providersFromEnv({
      SSO_PROVIDERS: 'corp, partner',
      SSO_CORP_KIND: 'oidc',
      SSO_CORP_LABEL: 'Sirius Corp',
      SSO_CORP_ISSUER: 'https://idp.sirius.local',
      SSO_CORP_DOMAIN: 'sirius.local',
      SSO_CORP_CLIENT_ID: 'cid',
      SSO_CORP_CLIENT_SECRET: 'secret',
      SSO_PARTNER_KIND: 'saml',
      SSO_PARTNER_ENTRY_POINT: 'https://idp.partner.com/sso',
      SSO_PARTNER_CERT: 'CERT',
      SSO_PARTNER_DOMAIN: 'partner.com',
    });
    assert.equal(providers.length, 2);
    assert.equal(providers[0].provider_id, 'corp');
    assert.equal(providers[0].source, 'env');
    assert.equal(providers[0].domain, 'sirius.local');
    assert.equal(providers[1].kind, 'saml');
  });

  test('providersFromEnv returns nothing when unconfigured', () => {
    assert.deepEqual(providersFromEnv({}), []);
  });

  test('mergeProviders lets runtime override env by provider id', () => {
    const env = [{ provider_id: 'corp', kind: 'oidc', domain: 'a.com', source: 'env' }];
    const runtime = [{ provider_id: 'corp', kind: 'oidc', domain: 'b.com' }];
    const merged = mergeProviders(runtime, env);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].domain, 'b.com');
  });

  test('redactProvider strips secrets but reports their presence', () => {
    const r = redactProvider({ provider_id: 'corp', kind: 'oidc', domain: 'a.com', client_secret: 's', cert: 'c' });
    assert.equal(r.has_client_secret, true);
    assert.equal(r.has_cert, true);
    assert.equal(r.client_secret, undefined);
    assert.equal(r.cert, undefined);
  });

  test('providerForDomain matches an enabled provider by domain', () => {
    const providers = [
      { provider_id: 'a', kind: 'oidc', domain: 'a.com', enabled: true },
      { provider_id: 'b', kind: 'oidc', domain: 'b.com', enabled: false },
    ];
    assert.equal(providerForDomain('x@a.com', providers).provider_id, 'a');
    assert.equal(providerForDomain('x@b.com', providers), null);
    assert.equal(providerForDomain('x@c.com', providers), null);
  });
});

describe('enforcement helpers', () => {
  test('mfaRequiredForRoles follows the mode', () => {
    assert.equal(mfaRequiredForRoles(['admin'], { mfa_mode: 'off' }), false);
    assert.equal(mfaRequiredForRoles(['admin'], { mfa_mode: 'optional' }), false);
    assert.equal(mfaRequiredForRoles(['admin'], { mfa_mode: 'required_admins' }), true);
    assert.equal(mfaRequiredForRoles(['analyst'], { mfa_mode: 'required_admins' }), false);
    assert.equal(mfaRequiredForRoles(['analyst'], { mfa_mode: 'required_all' }), true);
  });

  test('isLocalDomainAllowed is permissive until enforcement is on', () => {
    assert.equal(isLocalDomainAllowed('x@nope.com', { enforce_local_domain_allowlist: false }), true);
    const enforced = { enforce_local_domain_allowlist: true, local_account_domains: ['sirius.local'] };
    assert.equal(isLocalDomainAllowed('x@sirius.local', enforced), true);
    assert.equal(isLocalDomainAllowed('x@nope.com', enforced), false);
  });

  test('sessionMfaSatisfied is a no-op unless enforcement is on', () => {
    assert.equal(sessionMfaSatisfied({ roles: ['admin'], hasMfa: false }, { mfa_mode: 'required_admins', enforce_mfa: false }), true);
    const on = { mfa_mode: 'required_admins', enforce_mfa: true };
    assert.equal(sessionMfaSatisfied({ roles: ['admin'], hasMfa: false }, on), false);
    assert.equal(sessionMfaSatisfied({ roles: ['admin'], hasMfa: true }, on), true);
    assert.equal(sessionMfaSatisfied({ roles: ['analyst'], hasMfa: false }, on), true);
  });
});

describe('policy lifecycle', () => {
  test('buildAuthPolicy mints the next revision and stamps the actor', () => {
    const base = defaultAuthPolicy();
    const next = buildAuthPolicy({ mfa_mode: 'required_all' }, { actor: { email: 'a@b.com' }, base, at: '2026-01-01T00:00:00.000Z' });
    assert.equal(next.revision, base.revision + 1);
    assert.equal(next.mfa_mode, 'required_all');
    assert.equal(next.source, 'configured');
    assert.equal(next.updated_by, 'a@b.com');
  });

  test('buildAuthPolicy preserves a secret omitted from a redacted round-trip', () => {
    const base = resolveAuthPolicy({
      providers: [{ provider_id: 'corp', kind: 'oidc', domain: 'a.com', issuer: 'https://idp', client_id: 'id', client_secret: 'kept' }],
    });
    const next = buildAuthPolicy({ providers: [{ provider_id: 'corp', kind: 'oidc', domain: 'a.com', issuer: 'https://idp', client_id: 'id' }] }, { base });
    assert.equal(next.providers[0].client_secret, 'kept');
  });

  test('diffAuthPolicy reports the changed fields', () => {
    const before = defaultAuthPolicy();
    const after = buildAuthPolicy({ mfa_mode: 'off', enforce_mfa: true }, { base: before });
    const fields = diffAuthPolicy(before, after).map((c) => c.field);
    assert.ok(fields.includes('mfa_mode'));
    assert.ok(fields.includes('enforce_mfa'));
  });

  test('validateAuthPolicy reports an invalid provider', () => {
    const { ok, errors } = validateAuthPolicy({ providers: [{ provider_id: 'x', kind: 'oidc', domain: 'a.com' }] });
    assert.equal(ok, false);
    assert.ok(errors.length >= 1);
  });

  test('SSO_PROVIDER_KINDS covers oidc and saml', () => {
    assert.deepEqual(SSO_PROVIDER_KINDS, ['oidc', 'saml']);
  });
});
