// Phase 1 lifecycle rules (BRD v2 WF-01, WF-05, WF-08, INT-13, SCR-09). Pure.
//   node --test server/tests/workflowStates.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import W, {
  STATES, STATE_KEYS, FINAL_STATES, SYSTEM_STATES, BOARD_STATES, OPEN_STATES, SUBMIT_CHAIN, TRANSITIONS,
  LEGACY_STATE_MAP, DEFAULT_SLA, normalizeState, isFinalState, isEditableState, findTransition,
  transitionMap, isReviewer, isProducerFor, actorMayTake, availableActions, nextActorFor,
} from '../config/workflowStates.js';

const INFINIA = 'org-infinia';
const FINSTREET = 'org-finstreet';
const preparer = { org_id: INFINIA, roles: ['subsidiary_deal_lead'], descendant_ids: [], granted_org_ids: [] };
const sibling = { org_id: FINSTREET, roles: ['subsidiary_deal_lead'], descendant_ids: [], granted_org_ids: [] };
const siriusLead = { org_id: 'org-sirius', roles: ['sirius_deal_lead'], descendant_ids: [INFINIA, FINSTREET], granted_org_ids: [] };
const icMember = { org_id: 'org-sirius', roles: ['ic_member'], descendant_ids: [INFINIA], granted_org_ids: [] };
const admin = { org_id: 'org-sirius', roles: ['admin'], descendant_ids: [], granted_org_ids: [] };
const DOA_YES = { authorized: true, reason: 'delegated' };
const DOA_NO = { authorized: false, reason: 'A standard ticket is delegated to: sirius_vertical_head.' };

describe('state catalogue', () => {
  test('matches the BRD v2 WF-01 lifecycle in order', () => {
    assert.deepEqual(STATE_KEYS, [
      'draft', 'submitted', 'completeness_check', 'initial_screening', 'screening_review',
      'information_requested', 'on_hold', 'proceed_to_gate2', 'declined', 'withdrawn',
    ]);
  });
  test('the three decision outcomes and withdrawal are final; nothing leaves them', () => {
    assert.deepEqual([...FINAL_STATES].sort(), ['declined', 'proceed_to_gate2', 'withdrawn']);
    for (const s of FINAL_STATES) assert.deepEqual(transitionMap()[s], [], s);
  });
  test('the automatic steps are exactly the submit chain minus its landing state', () => {
    assert.deepEqual(SYSTEM_STATES, SUBMIT_CHAIN.slice(0, 3));
    assert.equal(SUBMIT_CHAIN.at(-1), 'screening_review');
  });
  test('every transition references known states and a known actor kind', () => {
    for (const t of TRANSITIONS) {
      assert.ok(STATE_KEYS.includes(t.from) && STATE_KEYS.includes(t.to), t.from + '->' + t.to);
      assert.ok(['producer', 'reviewer', 'decider', 'system'].includes(t.by));
    }
  });
  test('no pair is declared twice', () => {
    const seen = new Set(TRANSITIONS.map((t) => t.from + '>' + t.to));
    assert.equal(seen.size, TRANSITIONS.length);
  });
  test('board columns are the open and final states, never draft or an automatic step', () => {
    assert.deepEqual([...BOARD_STATES].sort(), [...OPEN_STATES, ...FINAL_STATES].sort());
  });
  test('every open state has a default SLA', () => {
    assert.deepEqual(DEFAULT_SLA.map((s) => s.state).sort(), [...OPEN_STATES].sort());
    for (const s of DEFAULT_SLA) assert.ok(Number.isInteger(s.days) && s.days > 0);
  });
  test('labels exist for every state', () => {
    for (const s of STATES) assert.ok(s.label.length > 0);
  });
});

describe('human in the loop (SCR-09)', () => {
  test('no automatic transition reaches a decision or withdrawal', () => {
    for (const t of TRANSITIONS.filter((x) => x.by === 'system')) {
      assert.ok(!FINAL_STATES.includes(t.to) && t.to !== 'on_hold', t.to);
    }
  });
  test('every Gate-1 decision is a decider move that carries a reason class (WF-05)', () => {
    for (const to of ['proceed_to_gate2', 'on_hold', 'declined']) {
      const rules = TRANSITIONS.filter((t) => t.to === to);
      assert.ok(rules.length > 0);
      for (const r of rules) {
        assert.equal(r.by, 'decider', to);
        assert.ok(r.reason_class, to + ' needs a reason class');
        assert.equal(r.gate1, true);
      }
    }
  });
  test('withdrawal is a producer move with a reason, and only before the decision (INT-13)', () => {
    const rules = TRANSITIONS.filter((t) => t.to === 'withdrawn');
    assert.deepEqual(rules.map((r) => r.from).sort(), [...OPEN_STATES].sort());
    for (const r of rules) { assert.equal(r.by, 'producer'); assert.equal(r.reason_class, 'withdraw'); }
  });
  test('an information request needs a question; resume needs a comment', () => {
    assert.deepEqual(findTransition('screening_review', 'information_requested').requires, ['question']);
    assert.deepEqual(findTransition('on_hold', 'screening_review').requires, ['comment']);
  });
});

describe('legacy states', () => {
  test('every legacy name maps to a known state', () => {
    for (const [legacy, now] of Object.entries(LEGACY_STATE_MAP)) {
      assert.ok(STATE_KEYS.includes(now), legacy);
      assert.equal(STATE_KEYS.includes(legacy), false, legacy + ' must not still be a state');
    }
  });
  test('normalizeState maps legacy names, keeps current ones and defaults to draft', () => {
    assert.equal(normalizeState('submission'), 'screening_review');
    assert.equal(normalizeState('returned'), 'information_requested');
    assert.equal(normalizeState('refinement'), 'proceed_to_gate2');
    assert.equal(normalizeState('on_hold'), 'on_hold');
    assert.equal(normalizeState(undefined), 'draft');
    assert.equal(normalizeState(''), 'draft');
  });
  test('transitions resolve from a legacy state', () => {
    assert.ok(findTransition('returned', 'screening_review'));
    assert.equal(isFinalState('approval'), true);
    assert.equal(isEditableState('returned'), true);
  });
});

describe('editability', () => {
  test('only draft and information requested are editable', () => {
    for (const s of STATE_KEYS) {
      assert.equal(isEditableState(s), ['draft', 'information_requested'].includes(s), s);
    }
  });
});

describe('who may act', () => {
  test('producer = fill role in the owning org (or a grant); a sibling is not', () => {
    assert.equal(isProducerFor(preparer, INFINIA), true);
    assert.equal(isProducerFor(sibling, INFINIA), false);
    assert.equal(isProducerFor({ ...sibling, granted_org_ids: [INFINIA] }, INFINIA), true);
    assert.equal(isProducerFor(siriusLead, INFINIA), false, 'Sirius may read every org but does not produce');
    assert.equal(isProducerFor(admin, INFINIA), true);
    assert.equal(isProducerFor(preparer, null), false);
  });
  test('reviewer = Sirius investment team (or admin); subsidiary and IC are not', () => {
    assert.equal(isReviewer(siriusLead), true);
    assert.equal(isReviewer(admin), true);
    assert.equal(isReviewer(preparer), false);
    assert.equal(isReviewer(icMember), false);
    assert.equal(isReviewer(null), false);
  });
  test('a decision needs the reviewer role AND the Delegation of Authority', () => {
    const proceed = findTransition('screening_review', 'proceed_to_gate2');
    assert.equal(actorMayTake(proceed, siriusLead, INFINIA, { doa: DOA_YES }).allowed, true);
    const notDelegated = actorMayTake(proceed, siriusLead, INFINIA, { doa: DOA_NO });
    assert.equal(notDelegated.allowed, false);
    assert.match(notDelegated.reason, /delegated/);
    assert.equal(actorMayTake(proceed, preparer, INFINIA, { doa: DOA_YES }).allowed, false, 'a subsidiary never decides');
    assert.equal(actorMayTake(proceed, siriusLead, INFINIA, {}).allowed, false, 'unresolved DoA refuses');
  });
  test('system steps cannot be taken by anyone', () => {
    const auto = findTransition('submitted', 'completeness_check');
    assert.equal(actorMayTake(auto, admin, INFINIA).allowed, false);
  });
  test('an unknown move is refused', () => {
    assert.equal(actorMayTake(null, admin, INFINIA).allowed, false);
  });
});

describe('available actions', () => {
  test('Sirius in screening review: information request, hold, decline, proceed - never withdraw', () => {
    const a = availableActions({ state: 'screening_review', actor: siriusLead, ownerOrgId: INFINIA, doa: DOA_YES });
    assert.deepEqual(a.map((x) => x.action).sort(), ['decline', 'hold', 'proceed', 'request_information']);
    assert.ok(a.every((x) => x.allowed));
  });
  test('not delegated: decisions are listed but disabled with the reason', () => {
    const a = availableActions({ state: 'screening_review', actor: siriusLead, ownerOrgId: INFINIA, doa: DOA_NO });
    const proceed = a.find((x) => x.action === 'proceed');
    assert.equal(proceed.allowed, false);
    assert.match(proceed.blocked_reason, /Not delegated/);
    assert.equal(a.find((x) => x.action === 'request_information').allowed, true);
  });
  test('a business block disables just that action', () => {
    const a = availableActions({
      state: 'screening_review', actor: siriusLead, ownerOrgId: INFINIA, doa: DOA_YES,
      blocks: { proceed: 'Independent sign-off required.' },
    });
    assert.equal(a.find((x) => x.action === 'proceed').allowed, false);
    assert.equal(a.find((x) => x.action === 'proceed').blocked_reason, 'Independent sign-off required.');
    assert.equal(a.find((x) => x.action === 'decline').allowed, true);
  });
  test('the subsidiary sees respond and withdraw when information is requested', () => {
    const a = availableActions({ state: 'information_requested', actor: preparer, ownerOrgId: INFINIA });
    assert.deepEqual(a.map((x) => x.action).sort(), ['respond', 'withdraw']);
  });
  test('the subsidiary sees only withdraw while Sirius reviews', () => {
    assert.deepEqual(availableActions({ state: 'screening_review', actor: preparer, ownerOrgId: INFINIA }).map((x) => x.action), ['withdraw']);
  });
  test('a sibling sees nothing', () => {
    assert.deepEqual(availableActions({ state: 'screening_review', actor: sibling, ownerOrgId: INFINIA }), []);
  });
  test('final states offer nothing; submit is never offered as a move', () => {
    for (const s of FINAL_STATES) assert.deepEqual(availableActions({ state: s, actor: admin, ownerOrgId: INFINIA, doa: DOA_YES }), []);
    assert.deepEqual(availableActions({ state: 'draft', actor: preparer, ownerOrgId: INFINIA }), []);
  });
});

describe('next actor', () => {
  test('who the record is waiting on', () => {
    assert.equal(nextActorFor('draft'), 'subsidiary');
    assert.equal(nextActorFor('information_requested'), 'subsidiary');
    assert.equal(nextActorFor('screening_review'), 'sirius');
    assert.equal(nextActorFor('on_hold'), 'sirius');
    assert.equal(nextActorFor('declined'), null);
  });
  test('default export carries the same API', () => {
    assert.equal(W.normalizeState, normalizeState);
  });
});
