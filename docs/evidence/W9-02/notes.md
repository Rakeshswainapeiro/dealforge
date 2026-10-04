# W9-02 — Security review / vulnerability scan (BRD NFR-02)

Requirement: **NFR-02** — security review completed, no open critical or high
vulnerabilities at go-live.

## What was done

- **Dependency remediation.** A baseline `npm audit` on the full tree reported 26
  advisories (1 critical, 14 high). A non-breaking `npm audit fix` cleared every
  critical and high advisory. The remaining full-tree findings are 2 moderate and
  2 low, all in the build/dev toolchain or the bundled rich-text editor.
- **Production surface isolated.** The Docker runtime image installs only
  `server/` dependencies (`COPY server/package.json; cd server && npm install
  --omit=dev`), so the `server/` tree is the advisory surface that actually ships.
  `server/` reports **0 advisories**. The frontend advisories live in the dev/
  build toolchain and the Quill editor, which is not used on the deal-flow
  surfaces; they are tracked as accepted residual risk for the next dependency
  bump.
- **Reproducible scanner.** `scripts/security_scan.mjs` (NFR-02.1) runs the
  server-runtime, production and full-tree audits, `node --check` over every
  `server/*.js` file and a grep for injection sinks (`child_process`, `spawn`,
  `dangerouslySetInnerHTML`, `eval`). It prints a summary, writes a JSON report
  and **exits non-zero if any critical/high advisory is open** so it can gate CI.
- **Sink review.** 8 sink hits, all reviewed: `child_process`/`spawn` in
  `server/config/documentPolicy.js` is the operator-configured external antivirus
  scanner; the `dangerouslySetInnerHTML` hit in `src/components/ui/chart.jsx` is
  the shadcn chart theme injection; the rest are regex `.exec()` false positives.
  0 unresolved.
- **Posture catalog.** `server/config/securityPosture.js` records the 13
  controls the review covers (headers, rate limiting, upload allow-list,
  org-trust, RBAC/ABAC, denied-request auditing, session revocation, hash-chained
  audit, AI governance, dependency scan, syntax/sink scan) plus the two external
  go-live dependencies (independent penetration test and UAE data residency,
  which is tracked under W9-03/NFR-01). The gate passes on 0 open critical/high.
- **Surfaced in the console.** The AI Governance settings tab renders the gate,
  the four-stat summary and the full control register so a reviewer can see the
  posture without reading code. `GET /api/ai-governance` now returns
  `security_posture`.

## Scan result (accepted go-live numbers)

| Tree | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| server runtime (ships in the image) | 0 | 0 | 0 | 0 | 0 |
| frontend build (`--omit=dev`) | 0 | 0 | 2 | 0 | 2 |
| full tree (incl. dev) | 0 | 0 | 2 | 2 | 4 |

Open critical/high: **0**. Syntax failures: **0** (59 files). Unresolved sinks:
**0**.

## Accepted residual risk

- `react-quill` / Quill (moderate XSS advisory) — the bundled editor is not used
  on the deal-flow surfaces; the breaking fix lands with the editor dependency
  refresh.
- Remaining moderate/low advisories are dev/build-toolchain only and are not in
  the runtime image.

## External go-live dependencies (not platform controls)

- Independent penetration test — Sirius IT activity, recorded as open.
- UAE data residency / sovereign hosting sign-off — tracked under W9-03/NFR-01.

## Evidence

- `docs/evidence/W9-02/security_scan_report.json` — machine-readable scan output
  from `scripts/security_scan.mjs`.
- `docs/evidence/W9-02/admin_security_posture_summary.png` — the go-live gate and
  advisory summary in the console.
- `docs/evidence/W9-02/admin_security_controls_register.png` — the 13-control
  register with status and evidence pointers.

## Tests

- `server/tests/securityPosture.test.js` — gate logic, clean server runtime,
  control catalog integrity, external-dependency tracking, summary reconciliation.
- `server/tests/aiGovernanceApi.test.js` — `/api/ai-governance` returns a passing
  `security_posture`.
