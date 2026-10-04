# W1-06 — CEO + CFO attestation gate

**Personas:** preparer (Infinia Deal Lead), ceo (Infinia CEO)
**Feature covered:** the two named attestations required before submission
(INT-09) — each recorded with the signer's name, timestamp and IP, each on the
audit log, with a configurable attestation text.

## Shots

| File | Persona | What it proves |
|------|---------|----------------|
| `preparer_attestations_all_ready.png` | preparer (Infinia Deal Lead) | A completed fixture shows the "Both recorded" state: the CEO and CFO cards each name the signer, the time (5 Jan 2026, 13:00) and the IP (10.0.0.1). |
| `ceo_attestation_one_signed.png` | ceo (Infinia CEO) | On a draft with neither attestation the CEO signs their own card: it flips to "Recorded" and the status drops to "1 outstanding" while the CFO card stays outstanding. |
| `preparer_attestation_submit_blocked.png` | preparer (Infinia Deal Lead) | Submitting while both are outstanding is refused: the form shows the attestation block and a "Submission blocked" result rather than success. |

## How it works

`server/config/attestations.js` declares the CEO and CFO role specs (with
their subsidiary equivalents), the configurable `attestation_text` app setting
and the default texts, and the pure `evaluateAttestations` that requires a
`by` and an `at` per role. `server/gate.js` loads the configured texts,
returns `attestations` from `evaluateGate` and `GET /api/gate/fields`, and
serves `POST /api/opportunities/:id/attestations/:key` — the actor must hold
the matching role (or admin) and have write access to the owning org, and the
record stores `by`, `name`, `role`, `at`, `ip` and `text` and writes an
`attestation_recorded` audit row. The submit route returns 422 with the
attestation message and a `submit_blocked` audit until both are present.
`src/pages/SubmitOpportunity.jsx` renders the attestation card.

Fixture: `seed-attestation-missing` — a complete draft (`Gulf Industrial
Controls LLC`, AED 95mn) whose only remaining blocker is the missing pair of
attestations.

## Reproduce

```
docker compose -p dealforge-demo -f docker-compose.demo.yml up --build
BASE=http://localhost:34010 node scripts/capture_evidence.mjs --only=W1-06
```

Tests: `server/tests/attestations.test.js` (8 pass) and the W1-06 block in
`server/tests/m2.test.js` (4 pass). Commit: `feat(intake): CEO and CFO
attestation gate (W1-06)`.
