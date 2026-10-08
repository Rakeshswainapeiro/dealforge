# ADR-001: Phase 1 ships on the current stack

- Status: Accepted
- Date: 2026-10-08
- Scope: DealForge Phase 1 (BRD v2)

## Context

The codebase we received is JavaScript end to end: a Vite + React single-page
app, an Express API, PostgreSQL and Better Auth. Moving to Next.js and
TypeScript, and splitting the API into modules, was considered before closing
the Phase 1 gaps.

Phase 1 has a fixed eight-week plan and an acceptance list tied to BRD v2
requirements (WF-01 to WF-08, SCR, SCO, DOC, OUT, DSH, AUD, NTF, PLT, NFR,
INTG, EXP, ACC). None of those requirements depends on the framework or the
language. They depend on correct workflow rules, access control, auditability
and data handling, which can be built and tested on the current stack.

## Decision

Phase 1 is completed on the current stack. No framework or language migration
happens before go-live.

Quality and security are carried by the things that actually enforce them:

- One source of truth for the screening lifecycle (`server/config/workflowStates.js`)
  and one transactional engine for every state change (`server/lifecycle.js`).
- Pure, unit-tested policy modules for each rule set (opportunity write policy,
  routing, connectors, identity), with the HTTP layer kept thin.
- Server-side permission checks before validation on every write, row locks
  and merge updates for concurrent edits, and an append-only audit trail.
- An integration suite run against a fresh database on every change, plus a
  browser walkthrough of the full Phase 1 path per role.
- Production guards at startup (secrets, MFA, residency, sample data, proxy
  trust) and a least-privilege database role.

## Consequences

- Phase 1 can be delivered and accepted on the agreed timeline.
- New code follows the module pattern above, so a later TypeScript migration
  can proceed file by file (the pure `config/` modules first) without a rewrite.
- A migration to TypeScript and a modular API remains a candidate for Phase 2,
  to be decided on its own costs and benefits after go-live.
