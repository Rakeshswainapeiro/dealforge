// AI governance policy (W9-01 / BRD NFR-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAIGovernanceConfig, resolveAIGovernanceConfig, validateAIGovernanceConfig,
  buildAIGovernanceConfig, diffAIGovernanceConfig, redactForLog, providerIdForBase,
  providerForBase, isProviderApproved, approvalSummary,
  AI_GOVERNANCE_VERSION, AI_GOVERNANCE_POLICY, AI_OUTPUT_LABEL,
} from '../config/aiGovernance.js';

test('default policy logs prompts/responses, redacts and labels AI output', () => {
  const cfg = defaultAIGovernanceConfig();
  assert.equal(cfg.version, AI_GOVERNANCE_VERSION);
  assert.equal(cfg.source, 'default');
  assert.equal(cfg.log_prompts, true);
  assert.equal(cfg.log_responses, true);
  assert.equal(cfg.redact_emails, true);
  assert.equal(cfg.label_ai_output, true);
  assert.equal(cfg.require_provider_approval, true);
  assert.equal(cfg.retention_days, 365);
  assert.equal(AI_OUTPUT_LABEL, 'AI-generated');
  assert.ok(cfg.providers.some((p) => p.id === 'openai' && p.approval_status === 'pending'));
  assert.ok(cfg.providers.some((p) => p.id === 'localai' && p.approval_status === 'approved'));
});

test('resolve falls back to the default for junk and coerces providers', () => {
  assert.deepEqual(resolveAIGovernanceConfig('nope'), defaultAIGovernanceConfig());
  const stored = resolveAIGovernanceConfig(JSON.stringify({ source: 'stored', retention_days: 30, providers: [{ id: 'openai', approval_status: 'bogus' }] }));
  assert.equal(stored.source, 'stored');
  assert.equal(stored.retention_days, 30);
  assert.equal(stored.providers[0].approval_status, 'pending');
});

test('validate rejects bad field types, ranges and statuses', () => {
  assert.equal(validateAIGovernanceConfig({}).ok, true);
  assert.equal(validateAIGovernanceConfig({ log_prompts: 'yes' }).ok, false);
  assert.equal(validateAIGovernanceConfig({ retention_days: 0 }).ok, false);
  assert.equal(validateAIGovernanceConfig({ log_max_chars: 5 }).ok, false);
  assert.equal(validateAIGovernanceConfig({ providers: 'x' }).ok, false);
  assert.equal(validateAIGovernanceConfig({ providers: [{ id: 'x', approval_status: 'nope' }] }).ok, false);
  assert.equal(validateAIGovernanceConfig(null).ok, false);
});

test('build mints a revision, records the actor and flips a provider to approved', () => {
  const base = defaultAIGovernanceConfig();
  const providers = base.providers.map((p) => (p.id === 'openai' ? { ...p, approval_status: 'approved' } : p));
  const next = buildAIGovernanceConfig(
    { log_prompts: false, providers },
    { actor: { email: 'admin@dealforge.local' }, base, at: '2026-06-01T00:00:00.000Z' }
  );
  assert.equal(next.revision, 2);
  assert.equal(next.version, 'NFR-03.1');
  assert.equal(next.log_prompts, false);
  assert.equal(next.source, 'stored');
  assert.equal(next.updated_by, 'admin@dealforge.local');
  assert.equal(providerForBase(next, 'https://api.openai.com/v1').approval_status, 'approved');
});

test('diff reports only the changed fields', () => {
  const before = defaultAIGovernanceConfig();
  const after = { ...before, log_prompts: false, retention_days: 30 };
  const fields = diffAIGovernanceConfig(before, after).map((c) => c.field).sort();
  assert.deepEqual(fields, ['log_prompts', 'retention_days']);
});

test('redactForLog strips secrets and emails and honours the length cap', () => {
  const out = redactForLog('Authorization: Bearer sk-abcdefghijklmnop123456 and contact jane.doe@example.com', AI_GOVERNANCE_POLICY);
  assert.ok(!out.includes('jane.doe@example.com'), 'email redacted');
  assert.ok(out.includes('[redacted-email]'));
  assert.ok(!/sk-abcdefghijklmnop123456/.test(out), 'key redacted');
  assert.ok(out.includes('Bearer [redacted]'));
  const capped = redactForLog('x'.repeat(50), { ...AI_GOVERNANCE_POLICY, log_max_chars: 100 });
  assert.equal(capped.length, 50);
});

test('provider id maps known endpoints and approvals gate use', () => {
  assert.equal(providerIdForBase('https://api.openai.com/v1'), 'openai');
  assert.equal(providerIdForBase('https://my.openai.azure.com/openai'), 'azure_openai');
  assert.equal(providerIdForBase('http://localhost:1234/v1'), 'localai');
  assert.equal(providerIdForBase('https://llm.internal.example/v1'), 'custom');

  const cfg = defaultAIGovernanceConfig();
  assert.equal(isProviderApproved(cfg, 'https://api.openai.com/v1'), false, 'openai pending by default');
  assert.equal(isProviderApproved(cfg, 'http://localhost:1234/v1'), true, 'self-hosted approved by default');

  const summary = approvalSummary(cfg);
  assert.equal(summary.total > 0, true);
  assert.ok(summary.approved_ids.includes('localai'));
});
