// Unit tests for the identity & access policy (BRD PLT-02, PLT-04, NFR-02).
// Pure functions - no server or database required.
//   node --test server/tests/identityPolicy.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_API_ROUTES, isPublicApiRoute, headerIdentityEnabled, startupConfigErrors,
  KNOWN_DEFAULT_SECRETS, MIN_SECRET_LENGTH, allowedCorsOrigins, isCorsOriginAllowed,
  trustProxySetting, effectiveMfaPolicy, PUBLISHED_PASSWORDS,
} from '../config/identityPolicy.js';

const GOOD_SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('isPublicApiRoute (deny by default)', () => {
  test('health, auth, memo verify and i18n are public', () => {
    assert.equal(isPublicApiRoute('GET', '/api/health'), true);
    assert.equal(isPublicApiRoute('HEAD', '/api/health'), true, 'HEAD behaves like GET');
    assert.equal(isPublicApiRoute('POST', '/api/auth/sign-in/email'), true);
    assert.equal(isPublicApiRoute('GET', '/api/auth/get-session'), true);
    assert.equal(isPublicApiRoute('GET', '/api/auth'), true);
    assert.equal(isPublicApiRoute('GET', '/api/auth/public-settings'), true);
    assert.equal(isPublicApiRoute('GET', '/api/memo-verification/verify?ref=abc'), true, 'query string ignored');
    assert.equal(isPublicApiRoute('GET', '/api/i18n'), true);
    assert.equal(isPublicApiRoute('GET', '/api/i18n/locales/'), true, 'trailing slash ignored');
  });

  test('everything else is private', () => {
    assert.equal(isPublicApiRoute('GET', '/api/pipeline/board'), false);
    assert.equal(isPublicApiRoute('POST', '/api/integrations/upload-file'), false);
    assert.equal(isPublicApiRoute('GET', '/api/org/me'), false);
    assert.equal(isPublicApiRoute('GET', '/api/memo-verification'), false, 'only /verify is public');
    assert.equal(isPublicApiRoute('GET', '/api/memo-verification/opportunities/x'), false);
  });

  test('method must match for method-specific public routes', () => {
    assert.equal(isPublicApiRoute('POST', '/api/health'), false);
    assert.equal(isPublicApiRoute('DELETE', '/api/memo-verification/verify'), false);
    assert.equal(isPublicApiRoute('PUT', '/api/i18n'), false);
  });

  test('prefix rules do not match look-alike paths', () => {
    assert.equal(isPublicApiRoute('GET', '/api/authx/anything'), false);
    assert.equal(isPublicApiRoute('GET', '/api/auth-policy'), false, 'auth-policy is an app route, not Better Auth');
    assert.equal(isPublicApiRoute('GET', '/api/healthz'), false);
  });

  test('empty or missing input is private', () => {
    assert.equal(isPublicApiRoute(undefined, undefined), false);
    assert.equal(isPublicApiRoute('GET', ''), false);
    assert.equal(isPublicApiRoute('GET', '/'), false);
  });

  test('accepts a custom route list', () => {
    const routes = [{ method: 'GET', prefix: '/api/open/' }];
    assert.equal(isPublicApiRoute('GET', '/api/open/x', routes), true);
    assert.equal(isPublicApiRoute('GET', '/api/health', routes), false);
  });

  test('the public list is frozen', () => {
    assert.ok(Object.isFrozen(PUBLIC_API_ROUTES));
  });
});

describe('headerIdentityEnabled', () => {
  test('off by default', () => {
    assert.equal(headerIdentityEnabled({}), false);
    assert.equal(headerIdentityEnabled(), false);
  });
  test('on only with the explicit flag outside production', () => {
    assert.equal(headerIdentityEnabled({ AUTH_ALLOW_HEADER_IDENTITY: '1' }), true);
    assert.equal(headerIdentityEnabled({ AUTH_ALLOW_HEADER_IDENTITY: '1', NODE_ENV: 'development' }), true);
    assert.equal(headerIdentityEnabled({ AUTH_ALLOW_HEADER_IDENTITY: 'true' }), false, 'only the exact value 1');
  });
  test('never in production, even with the flag', () => {
    assert.equal(headerIdentityEnabled({ AUTH_ALLOW_HEADER_IDENTITY: '1', NODE_ENV: 'production' }), false);
  });
});

describe('startupConfigErrors', () => {
  const prodBase = { NODE_ENV: 'production', BETTER_AUTH_SECRET: GOOD_SECRET, PUBLIC_BASE_URL: 'https://dealforge.example.ae', DEFAULT_USER_PASSWORD: 'a-private-pass-phrase-123' };

  test('a safe production configuration has no errors', () => {
    assert.deepEqual(startupConfigErrors(prodBase), []);
  });

  test('missing secret', () => {
    assert.match(startupConfigErrors({ ...prodBase, BETTER_AUTH_SECRET: '' }).join(), /not set/);
    assert.match(startupConfigErrors({}).join(), /not set/);
    assert.match(startupConfigErrors().join(), /not set/);
  });

  test('AUTH_SECRET is accepted as an alternative name', () => {
    assert.deepEqual(startupConfigErrors({ ...prodBase, BETTER_AUTH_SECRET: undefined, AUTH_SECRET: GOOD_SECRET }), []);
  });

  test('every published default secret is rejected', () => {
    for (const s of KNOWN_DEFAULT_SECRETS) {
      assert.match(startupConfigErrors({ ...prodBase, BETTER_AUTH_SECRET: s }).join(), /published default/);
    }
  });

  test('short secret is rejected; boundary length is accepted', () => {
    assert.match(startupConfigErrors({ ...prodBase, BETTER_AUTH_SECRET: 'a'.repeat(MIN_SECRET_LENGTH - 1) }).join(), /at least/);
    assert.deepEqual(startupConfigErrors({ ...prodBase, BETTER_AUTH_SECRET: 'a'.repeat(MIN_SECRET_LENGTH) }), []);
  });

  test('production refuses test-only switches', () => {
    const errs = (extra) => startupConfigErrors({ ...prodBase, ...extra }).join(' | ');
    assert.match(errs({ AUTH_ALLOW_HEADER_IDENTITY: '1' }), /AUTH_ALLOW_HEADER_IDENTITY/);
    assert.match(errs({ ADMIN_ALLOW_HEADER_AUTH: '1' }), /ADMIN_ALLOW_HEADER_AUTH/);
    assert.match(errs({ RATE_LIMIT_DISABLED: '1' }), /Rate limiting/);
    assert.match(errs({ AUTH_RATE_LIMIT_DISABLED: '1' }), /Rate limiting/);
  });

  test('production requires an https PUBLIC_BASE_URL', () => {
    assert.match(startupConfigErrors({ ...prodBase, PUBLIC_BASE_URL: '' }).join(), /https/);
    assert.match(startupConfigErrors({ ...prodBase, PUBLIC_BASE_URL: 'http://dealforge.example.ae' }).join(), /https/);
  });

  test('production refuses sample data, the published password and switching MFA off', () => {
    const errs = (extra) => startupConfigErrors({ ...prodBase, ...extra }).join(' | ');
    assert.match(errs({ SEED_PROFILE: 'mvp' }), /SEED_PROFILE=mvp/);
    assert.match(errs({ DEFAULT_USER_PASSWORD: PUBLISHED_PASSWORDS[0] }), /DEFAULT_USER_PASSWORD/);
    assert.match(errs({ DEFAULT_USER_PASSWORD: '' }), /DEFAULT_USER_PASSWORD/);
    assert.equal(errs({ DEFAULT_USER_PASSWORD: '', SEED_PROFILE: 'off' }), '', 'no seeded cast, no password needed');
    assert.match(errs({ MFA_ENFORCE: '0' }), /MFA_ENFORCE/);
    assert.match(errs({ TRUST_PROXY: 'true' }), /TRUST_PROXY/);
  });

  test('outside production only the secret is checked', () => {
    assert.deepEqual(startupConfigErrors({
      BETTER_AUTH_SECRET: GOOD_SECRET, AUTH_ALLOW_HEADER_IDENTITY: '1', RATE_LIMIT_DISABLED: '1', PUBLIC_BASE_URL: 'http://localhost:34000',
    }), []);
    assert.equal(startupConfigErrors({ BETTER_AUTH_SECRET: 'short' }).length, 1);
  });
});

describe('CORS allow-list', () => {
  test('production: only the public URL and configured extras', () => {
    const list = allowedCorsOrigins({
      NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://dealforge.example.ae/', CORS_ALLOWED_ORIGINS: 'https://admin.example.ae, ,https://b.example.ae/',
    });
    assert.deepEqual(list, ['https://dealforge.example.ae', 'https://admin.example.ae', 'https://b.example.ae']);
  });

  test('non-production also allows local dev ports, without duplicates', () => {
    const list = allowedCorsOrigins({ PUBLIC_BASE_URL: 'http://localhost:34000' });
    assert.ok(list.includes('http://localhost:5173'));
    assert.equal(list.filter((o) => o === 'http://localhost:34000').length, 1);
  });

  test('empty configuration', () => {
    assert.deepEqual(allowedCorsOrigins({ NODE_ENV: 'production' }), []);
    assert.ok(allowedCorsOrigins().length > 0, 'defaults to dev origins outside production');
  });

  test('origin matching', () => {
    const allowed = ['https://dealforge.example.ae'];
    assert.equal(isCorsOriginAllowed('https://dealforge.example.ae', allowed), true);
    assert.equal(isCorsOriginAllowed('https://dealforge.example.ae/', allowed), true);
    assert.equal(isCorsOriginAllowed('https://evil.example.com', allowed), false);
    assert.equal(isCorsOriginAllowed('https://dealforge.example.ae.evil.com', allowed), false);
    assert.equal(isCorsOriginAllowed(undefined, allowed), true, 'no Origin header = not a cross-origin browser call');
    assert.equal(isCorsOriginAllowed('', allowed), true);
  });
});

describe('proxy trust and MFA in production (NFR-02, PLT-04)', () => {
  test('never trusts every proxy; one hop in production by default', () => {
    assert.equal(trustProxySetting({ NODE_ENV: 'production' }), 1);
    assert.equal(trustProxySetting({}), 'loopback');
    assert.equal(trustProxySetting({ TRUST_PROXY: '2' }), 2);
    assert.equal(trustProxySetting({ TRUST_PROXY: 'false' }), false);
    assert.equal(trustProxySetting({ TRUST_PROXY: 'true', NODE_ENV: 'production' }), 1);
    assert.equal(trustProxySetting({ TRUST_PROXY: '10.0.0.0/8' }), '10.0.0.0/8');
  });
  test('production always enforces MFA for at least administrators', () => {
    const p = effectiveMfaPolicy({ mfa_mode: 'off', enforce_mfa: false }, { NODE_ENV: 'production' });
    assert.equal(p.enforce_mfa, true);
    assert.equal(p.mfa_mode, 'required_admins');
    assert.equal(effectiveMfaPolicy({ mfa_mode: 'required_all', enforce_mfa: false }, { NODE_ENV: 'production' }).mfa_mode, 'required_all');
    assert.deepEqual(effectiveMfaPolicy({ mfa_mode: 'off', enforce_mfa: false }, {}), { mfa_mode: 'off', enforce_mfa: false });
  });
});
