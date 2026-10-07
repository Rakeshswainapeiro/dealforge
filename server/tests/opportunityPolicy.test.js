// Opportunity write policy (WF-01, INT-09, PLT-02). Pure.
//   node --test server/tests/opportunityPolicy.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemField, checkCreate, checkUpdate, checkDelete } from '../config/opportunityPolicy.js';
import { INTAKE_FIELDS } from '../config/intakeConfig.js';
import { QUALIFYING_GATE_FIELD_KEYS } from '../config/qualifyingGates.js';

const INFINIA = 'org-infinia';
const preparer = { org_id: INFINIA, roles: ['subsidiary_deal_lead'], descendant_ids: [], granted_org_ids: [] };
const sibling = { org_id: 'org-finstreet', roles: ['subsidiary_deal_lead'], descendant_ids: [], granted_org_ids: [] };
const sirius = { org_id: 'org-sirius', roles: ['sirius_deal_lead'], descendant_ids: [INFINIA], granted_org_ids: [] };
const attested = { ceo: { by: 'ceo@x' }, cfo: { by: 'cfo@x' } };

describe('system fields', () => {
  test('workflow, review and assignment fields are system fields', () => {
    for (const k of ['status', 'status_entered_at', 'submitted_by', 'attestations', 'scorecard', 'hard_filter_review',
      'decision_reason', 'withdrawn_reason', 'gate1_authority', 'dataroom_folder_url', 'sirius_owner_email', 'owner_org_id']) {
      assert.equal(isSystemField(k), true, k);
    }
  });
  test('no capture-form field or gate answer is a system field (the form must be able to save them)', () => {
    for (const k of [...INTAKE_FIELDS.map((f) => f.key), ...QUALIFYING_GATE_FIELD_KEYS]) {
      assert.equal(isSystemField(k), false, k);
    }
  });
  test('form fields are not', () => {
    for (const k of ['opportunity_name', 'total_commitment_aed', 'gate_right_size', 'owner_email', 'narrative_what']) {
      assert.equal(isSystemField(k), false, k);
    }
  });
});

describe('create', () => {
  test('always a draft in the creator\'s org; system fields dropped', () => {
    const r = checkCreate({ opportunity_name: 'X', status: 'proceed_to_gate2', scorecard: { total: 5 } }, { actor: preparer });
    assert.equal(r.ok, true);
    assert.equal(r.data.status, 'draft');
    assert.equal(r.data.scorecard, undefined);
    assert.equal(r.owner_org_id, INFINIA);
    assert.deepEqual(r.dropped.sort(), ['scorecard', 'status']);
  });
  test('cannot create for a sibling', () => {
    assert.equal(checkCreate({ owner_org_id: INFINIA }, { actor: sibling }).status, 403);
  });
  test('Sirius cannot create a subsidiary\'s opportunity', () => {
    assert.equal(checkCreate({ owner_org_id: INFINIA, opportunity_name: 'X' }, { actor: sirius }).status, 403);
  });
});

describe('update', () => {
  const draft = { status: 'draft', opportunity_name: 'A', total_commitment_aed: 150 };
  test('a producer edits a draft', () => {
    const r = checkUpdate(draft, { total_commitment_aed: 160 }, { actor: preparer, ownerOrgId: INFINIA });
    assert.equal(r.ok, true);
    assert.deepEqual(r.patch, { total_commitment_aed: 160 });
    assert.equal(r.material, true);
    assert.equal(r.clearAttestations, false);
  });
  test('re-sending unchanged values (including status) is a no-op', () => {
    const r = checkUpdate({ ...draft, status: 'screening_review' }, { status: 'screening_review', opportunity_name: 'A' }, { actor: preparer, ownerOrgId: INFINIA });
    assert.equal(r.ok, true);
    assert.deepEqual(r.patch, {});
  });
  test('blank-equivalent values do not count as a change', () => {
    assert.deepEqual(checkUpdate({ status: 'draft', x: null }, { x: '' }, { actor: preparer, ownerOrgId: INFINIA }).patch, {});
  });
  test('writing status is refused with a pointer to the workflow', () => {
    const r = checkUpdate(draft, { status: 'proceed_to_gate2' }, { actor: preparer, ownerOrgId: INFINIA });
    assert.equal(r.status, 409);
    assert.match(r.error, /workflow actions/);
  });
  test('writing a reviewer field is refused', () => {
    assert.equal(checkUpdate(draft, { scorecard: { total: 5 } }, { actor: preparer, ownerOrgId: INFINIA }).status, 409);
  });
  test('the owning org never changes', () => {
    assert.equal(checkUpdate(draft, { owner_org_id: 'org-finstreet' }, { actor: preparer, ownerOrgId: INFINIA }).status, 403);
    assert.equal(checkUpdate(draft, { owner_org_id: INFINIA }, { actor: preparer, ownerOrgId: INFINIA }).ok, true);
  });
  test('locked after submission', () => {
    const r = checkUpdate({ ...draft, status: 'screening_review' }, { total_commitment_aed: 999 }, { actor: preparer, ownerOrgId: INFINIA });
    assert.equal(r.status, 409);
    assert.match(r.error, /locked/);
  });
  test('locked on a legacy submitted state too', () => {
    assert.equal(checkUpdate({ ...draft, status: 'submission' }, { total_commitment_aed: 1 }, { actor: preparer, ownerOrgId: INFINIA }).status, 409);
  });
  test('editable again when information is requested', () => {
    assert.equal(checkUpdate({ ...draft, status: 'information_requested' }, { total_commitment_aed: 1 }, { actor: preparer, ownerOrgId: INFINIA }).ok, true);
  });
  test('Sirius cannot edit the subsidiary\'s figures', () => {
    assert.equal(checkUpdate(draft, { total_commitment_aed: 1 }, { actor: sirius, ownerOrgId: INFINIA }).status, 403);
  });
  test('a material change after attestation clears the attestations', () => {
    const r = checkUpdate({ ...draft, attestations: attested }, { total_commitment_aed: 1 }, { actor: preparer, ownerOrgId: INFINIA });
    assert.equal(r.clearAttestations, true);
  });
  test('a non-material change keeps them', () => {
    const r = checkUpdate({ ...draft, attestations: attested }, { owner_email: 'x@y' }, { actor: preparer, ownerOrgId: INFINIA });
    assert.equal(r.ok, true);
    assert.equal(r.clearAttestations, false);
  });
});

describe('delete', () => {
  test('a producer deletes a draft', () => {
    assert.equal(checkDelete({ status: 'draft' }, { actor: preparer, ownerOrgId: INFINIA }).ok, true);
  });
  test('a submitted record is kept', () => {
    assert.equal(checkDelete({ status: 'screening_review' }, { actor: preparer, ownerOrgId: INFINIA }).status, 409);
  });
  test('a sibling or Sirius cannot delete', () => {
    assert.equal(checkDelete({ status: 'draft' }, { actor: sibling, ownerOrgId: INFINIA }).status, 403);
    assert.equal(checkDelete({ status: 'draft' }, { actor: sirius, ownerOrgId: INFINIA }).status, 403);
  });
});
