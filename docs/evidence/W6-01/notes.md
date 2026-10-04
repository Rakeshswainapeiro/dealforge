# W6-01 - Configurable decision reason codes (WF-05)

Accept criterion: *Reason required; declines captured for comparables.*

## What this delivers
Every terminal or revision-triggering decision carries a **reason code** drawn
from a maintained catalogue, plus optional free text. A decision cannot be saved
without one, and declines are grouped by a stable code so the pattern of lost
deals is comparable across mandates.

Four decision classes ship, each with 5-6 codes:

| Class | Raised by | Free text |
| --- | --- | --- |
| Approve | `approve` stage completion (rationale stages) | optional |
| Return for revision | pipeline `returned`, route `return` | optional by default |
| Decline | pipeline `declined` | **required** |
| Withdraw | pipeline `withdrawn` | required |

Decline codes carry `counts_as_decline`, so a comparables view can count how
often each reason recurs (e.g. *returns below hurdle*, *outside mandate*).

## Where it lives
- Config (pure): `server/config/decisionReasons.js`, `server/config/decisionReasonsData.js`
- API: `server/decisionReasons.js` - `GET/PUT /api/decision-reasons`, `GET /api/decision-reasons/history`
- Enforcement: `server/pipeline.js` `transition()` (decline / return / withdraw) and
  `server/workflows.js` `actOnStage()` (return, and any stage that requires a rationale)
- Persistence: `decision_reason`, `decision_reason_label`, `decision_reason_text`,
  `decision_reason_class`, `decision_reason_by`, `decision_reason_at` on the
  opportunity; `reason_code` / `reason_text` on `pipeline_transition`,
  `route_stage` and `workflow_event`; the same fields in the audit after-payload
- UI: Settings -> **Decision Reasons** tab; reason-code selects in the Screening
  Board move dialog and the Opportunity Route action dialog

## How to reproduce
1. Demo stack: `docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build` -> http://localhost:34010
2. As admin, open **Settings -> Decision Reasons**: four classes, each code
   toggleable, `Decline` marked *free text required*, decline codes badged
   *decline comparable*. Toggle a code and **Save revision** to mint `DRC-01.2`.
3. As a reviewer, open an opportunity on the Screening Board and click **Declined**:
   the move dialog shows a **Reason code** select above the comment. Confirm is
   disabled until both a code and a comment are present.
4. The decision is written to the opportunity, the transition history and the
   audit trail with the code, label and free text.

## Evidence
- `admin_decision_reasons_admin.png` - the maintained catalogue with per-code toggles and the revision badge.
- `leadership_decline_reason_required_reviewer.png` - the move-to-Declined dialog with the reason-code select and free-text detail.

## Tests
- `server/tests/decisionReasons.test.js` - 15 unit tests (defaults, validation, resolve with custom codes, JSON coercion, revision minting, options, validity, recording, diff).
- `server/tests/m6.test.js` - integration: reader sees the catalogue + per-class options, deal lead blocked (403), admin edit mints revision + audits + hides a disabled code, a decline without a code is refused (400) and with one is recorded on the record and the transition history.
- Existing suites updated to pass a reason code where they now decline / return / withdraw: `m3`, `m4`, `m5`, `uat`.
