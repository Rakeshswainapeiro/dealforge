# Reviewer Workspace: write-path browser test (Step B)

Run on 2 Nov 2026 against the local dev stack, in a real browser session.

## Test data
- Four disposable clones of `seed-scorecard-below` (`zz-disposable-a` to `-d`), created and removed by SQL.
- No real record was changed. Falcon (`df034310-...`) is still `screening_review` with no threads and no decisions. The seeded records are unchanged.

## Results
| Path | User | Result | Evidence in the audit log |
|---|---|---|---|
| Record scorecard | Sirius Deal Lead | Passed. The board's rule applied: three adjusted criteria needed a comment before **Record** enabled. | `scorecard_scored`, total 2.7, outcome `override_required` |
| CIO override (not the CIO) | Sirius Deal Lead | Blocked. The override button is disabled and the form says only the CIO can file it. | none written |
| CIO override | Sirius CIO | Passed. | `scorecard_override`, by `cio@sirius.local`, reason, `at` timestamp |
| Proceed to Gate 2 (not delegated) | Sirius CIO | Blocked by the Delegation of Authority rule: "A standard ticket (AED 190mn) is delegated to sirius_deal_lead, sirius_vertical_head." | none written |
| Proceed to Gate 2 | Sirius Deal Lead | Passed, reason code `override_with_memo` required. State became `proceed_to_gate2`. | `transition`, `gate1_authority_applied`, `notify` |
| Request information | Sirius Deal Lead | Passed. State became `information_requested`; a shared question was opened with the subsidiary. | `transition`, shared Q&A thread |
| Put on hold | Sirius Deal Lead | Passed, reason code `capital_timing` required. State became `on_hold`. | `transition` |
| Decline | Sirius Deal Lead | Passed, reason code `governance_concern` required. State became `declined`. | `transition` |
| Audit trail tab | Sirius Deal Lead | Shows each event with user, time and reasons: the override line reads "Named CIO ... Reason ... Recorded at ... Total". | read-only |

All checks ran through the existing endpoints and rules. No permission, DoA or workflow code was changed.

## Found and fixed during the test
A CIO override of a score that is below a lens floor still made the draft recommendation No-Go, which contradicted "an override is a condition, not a rejection". It is now a named condition (owner, CIO and date), as it already was for a total below the bar. A seed with a failed hard filter still correctly reads No-Go. Two tests cover this.

## Cleanup
- Removed: the four clones and their dependent rows (transitions, screening records, notifications, Q&A threads, messages and participants), plus the three QA TEST Q&A threads from the earlier Q&A test.
- Not removable: 13 audit rows for the test records (`audit_event` rejects update and delete by trigger). They only reference ids that no longer exist.

## Not covered
- Live-HTTP suites are still pending (see `known-test-gaps.md`).
- Related-party overlay and a second-reviewer sign-off were not exercised.
- The audit log's `role` column is empty for these events (existing behaviour), so the Audit trail tab shows the user without a role for them.
