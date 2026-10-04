# W9-01 — AI governance (NFR-03)

**Persona:** Administrator (`admin@dealforge.local`)
**Surface:** Settings → **AI Governance**

## What the shots show

The platform calls an OpenAI-compatible model for deal analysis. NFR-03 requires
that this is governed: prompts and outputs are logged, model output is labelled
as AI-generated, and a provider is approved in writing before it is used.

In `admin_ai_governance_policy.png` the policy is rendered as switches, each one
the thing an auditor asks about:

- **Log prompts / Log responses** — every model call is written to `llm_logs`.
- **Redact emails / Redact secrets** — the stored copy has email addresses,
  bearer tokens, API keys and `password=`/`token=` fragments replaced before it
  is persisted, so the log is useful without holding personal data or keys.
- **Label AI output** — surfaces that render model text show the
  `AI-generated` badge with the disclaimer on hover.
- **Require provider approval** — an unapproved endpoint is refused *before* a
  prompt leaves the server.
- **Human review required** — the governance stance recorded with the policy.

The **provider approval register** table lists each provider with its data
residency, approval status and approver. `LocalAI / self-hosted` is approved by
default because no data leaves the boundary; the hosted providers start
**pending** and must be approved deliberately.

In `admin_ai_governance_provider_approval.png` the admin has approved the
**OpenAI** provider: the register records `approved_by: admin@dealforge.local`
with a date, the approval roll-up moves to **Approved 2 · Pending 2**, and the
save confirmation reports **revision 2**. Approval is a versioned, audited edit.

## How it works

- `server/config/aiGovernance.js` owns the policy, the provider register and the
  pure helpers (resolve, validate, build, diff, `redactForLog`,
  `providerIdForBase`, `isProviderApproved`, `approvalSummary`).
- `server/aiGovernance.js` exposes `/api/ai-governance` (GET policy + label +
  approval summary to any authenticated user; PUT admin-only and audited as
  `entity: ai_governance`), `/api/ai-governance/log` and `/log/status` (admin).
- The LLM call path (`server/integrations.js`) checks the provider *before* the
  outbound call (403 when unapproved) and writes a redacted, attributed row via
  `logLLMCall`. Retention is enforced by `purgeExpiredLLMLogs` on boot and daily.
- `src/components/shared/AIOutputBadge.jsx` is the shared AI-output label; it is
  placed on the Deal Memo Generator and reads the label/disclaimer from config.
