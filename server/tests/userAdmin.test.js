// ---------------------------------------------------------------------------
// User-administration policy unit tests (W8-06 / BRD PLT-05).
//
//   node --test server/tests/userAdmin.test.js
//
// Pure module only. No server required.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_ADMIN_VERSION, USER_ADMIN_POLICY, USER_ADMIN_ACTIONS, USER_ADMIN_ACTION_KEYS,
  USER_STATUSES, USER_STATUS_KEYS, userStatus, isUserActive, accessBlockReason,
  describeUserStatus, shouldRevokeSessions,
} from '../config/userAdmin.js';

describe('user administration policy (PLT-05)', () => {
  test('the version is stamped and the policy closes sessions by default', () => {
    assert.equal(USER_ADMIN_VERSION, 'PLT-05.1');
    assert.equal(USER_ADMIN_POLICY.revoke_sessions_on_deactivate, true);
    assert.equal(USER_ADMIN_POLICY.revoke_sessions_on_ban, true);
    assert.equal(USER_ADMIN_POLICY.block_self_deactivation, true);
    assert.equal(USER_ADMIN_POLICY.deactivation_takes_effect, 'immediately');
  });

  test('every named action is unique and points at an entity', () => {
    assert.equal(new Set(USER_ADMIN_ACTION_KEYS).size, USER_ADMIN_ACTIONS.length);
    for (const a of USER_ADMIN_ACTIONS) {
      assert.ok(a.key && a.entity && a.label, 'action has key, entity and label');
    }
    assert.ok(USER_ADMIN_ACTION_KEYS.includes('deactivate'));
    assert.ok(USER_ADMIN_ACTION_KEYS.includes('reactivate'));
  });
});

describe('user status derivation (PLT-05)', () => {
  test('active, deactivated and banned are distinguished', () => {
    assert.equal(userStatus({ is_active: true }), 'active');
    assert.equal(userStatus({ is_active: false }), 'deactivated');
    assert.equal(userStatus({ is_active: true }, { banned: true }), 'banned');
    // A ban outranks the app flag.
    assert.equal(userStatus({ is_active: false }, { banned: true }), 'banned');
  });

  test('only an active account may act', () => {
    assert.equal(isUserActive({ is_active: true }), true);
    assert.equal(isUserActive({ is_active: false }), false);
    assert.equal(isUserActive({ is_active: true }, { banned: true }), false);
  });

  test('the block reason explains why an account is refused', () => {
    assert.equal(accessBlockReason({ is_active: true }), null);
    assert.equal(accessBlockReason({ is_active: false }).status, 'deactivated');
    assert.equal(accessBlockReason({ is_active: false }).code, 'deactivated');
    assert.match(accessBlockReason({ is_active: false }).message, /deactivated/i);
    assert.equal(accessBlockReason({ is_active: true }, { banned: true }).code, 'banned');
  });

  test('describeUserStatus reports the label and whether sign-in is possible', () => {
    assert.deepEqual(describeUserStatus({ is_active: true }), { status: 'active', label: 'Active', can_authenticate: true });
    assert.equal(describeUserStatus({ is_active: false }).can_authenticate, false);
    assert.equal(USER_STATUS_KEYS.length, USER_STATUSES.length);
  });

  test('session revocation follows the lifecycle policy', () => {
    assert.equal(shouldRevokeSessions('deactivate'), true);
    assert.equal(shouldRevokeSessions('ban'), true);
    assert.equal(shouldRevokeSessions('set_password'), true);
    assert.equal(shouldRevokeSessions('reactivate'), false);
    assert.equal(shouldRevokeSessions('update'), false);
    assert.equal(shouldRevokeSessions('deactivate', { revoke_sessions_on_deactivate: false }), false);
  });
});
