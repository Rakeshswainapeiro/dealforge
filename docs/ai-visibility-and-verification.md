# Internal AI assessment: who sees it, and how it was verified

Scope: the Preparer vs Sirius Investment Team split for AI validation, AI analysis, screening, scores and
recommendations, plus the automatic per-tab review that runs after a Preparer submits. The submission form,
its tabs, fields, document uploads and the submission workflow were not changed.

## 1. Authorised roles today

The single source of truth is `REVIEWER_ROLES` in `server/config/workflowStates.js`, plus administrators
(`isReviewer()`). `server/config/aiVisibility.js` (`canSeeInternalAssessment`) applies it on the server for
every route below. The frontend mirrors it only to decide what to draw
(`src/lib/reviewerWorkspace.js`, `Opportunity.jsx`, `ScreeningBoard.jsx`).

| Role | Internal AI / screening access | Needs business confirmation? |
|---|---|---|
| `sirius_deal_lead` | Yes | No |
| `sirius_vertical_head` | Yes | No |
| `cio` | Yes | No |
| `leadership` (Fahad / AJ) | Yes | No |
| `cluster_head` ("Cluster / Vertical Head") | Yes | **Yes.** Confirm this is a Sirius-side role and not a subsidiary cluster role. |
| `admin` | Yes (via `isReviewer`) | **Yes.** Confirm administrators, a technical role, should read deal assessments. |
| `subsidiary_deal_lead` (Preparer) | No | No |
| `subsidiary_cfo`, `subsidiary_ceo` | No | No |
| `opco_signatory` | No | **Yes.** Operating-company side; confirm none is needed. |
| `ic_member` | **No** | **Yes.** Investment Committee members may need the recommendation. |
| `board_member` | **No** | **Yes.** Confirm whether the board sees AI output or only the memo. |
| `group_compliance` | **No** | **Yes.** Compliance may need the sanctions / adverse-media findings. |
| `independent_reviewer` | **No** | **Yes.** The related-party independent sign-off may need the assessment. |

`ic_member`, `board_member`, `group_compliance` and `independent_reviewer` can read every organisation's
opportunities (cross-org read) but are refused the internal AI results today. If the business confirms any of
them, add the role to `REVIEWER_ROLES`; every route follows, and `server/tests/aiVisibility*.test.js` cover it.

## 2. What a Preparer can and cannot reach (server-enforced)

| Surface | Preparer |
|---|---|
| `/api/ai-review/*` (validate, analyse, ask, results, recommendation, run-all, tab review, review-history) | 403 on every route; model never called |
| `/api/pipeline/opportunities/:id/screening`, `/alignment` | 403 |
| `/api/gate/opportunities/:id/{sufficiency, *-review/history, scorecard/history}` | 403 |
| `/api/gate/opportunities/:id/status` | 200, with the Sirius blocks set to `null` (scorecard, hard/soft filters, disqualifiers, sufficiency, portfolio conflict/synergy, mandate fit). Submission checks are kept. |
| `/api/entities/AIReviewResult`, `/AIReviewDecision` | 403 read; writes refused for everyone |
| `/api/entities/DealOpportunity` | Reviewer fields (`scorecard`, `*_review`, `sufficiency_overrides`) removed from the Preparer's copy |
| `/api/audit`, opportunity timeline | AI and reviewer-assessment events hidden |
| Memo and memo pack | 200, without the strategic-alignment reading |
| `/api/integrations/{invoke-llm, extract-data, generate-image}` | 403 |
| Q&A, information requests, status, own documents | Unchanged (own organisation only; a sibling subsidiary gets 403) |

Browser check as Preparer: the seven-tab form, fields, progress rail, document list, qualifying gates,
attestations and the "Sirius has requested information" panel are present; no AI card appears; the board
detail panel shows owner, questions, data-room and move actions only; the opportunity page shows submission,
status, timeline, questions and documents.

## 3. Verification results (latest code, disposable database)

Run on `HEAD + working tree` against a fresh database `dealforge_verify` on port 34100 (not the Docker build,
not the shared dev database).

| Suite | Result |
|---|---|
| In-process server tests (all files that do not need a server) | 968 / 968 pass at the previous run; re-run results in the delivery summary |
| 20 live-HTTP suites (`admin` ... `userAdminApi`), limiter off | 448 / 450 pass |
| `rate limiting (E10.1)` (needs the limiter on) | passes when run with the limiter on |
| `seedCleanup` (needs `SEED_TEST=1`) | 5 / 5 pass |
| `Auth policy (PLT-04)`: "an admin can register, list and remove an OIDC provider" | **Fails: `Provider domain has not been verified`.** It fails identically on the unmodified `HEAD`; Better Auth SSO requires a verified domain. Not caused by this work. |

Notes: `aiGovernanceApi`, which `docs/known-test-gaps.md` listed as 5 of 7 failing, passes in full here.
The `m3` connectors test leaves the `grata` connector enabled, so a second run on the same database fails;
use a fresh database per run.

## 4. Observations that need a business decision (not changed)

1. **Hurdle table on the Preparer's Financials tab** ("Hurdles not met", per-scenario Y/N against Sirius
   thresholds) is computed from the Preparer's own inputs and is existing form behaviour. It is the one place a
   pass/fail against Sirius criteria is still visible to a Preparer.
2. **Explanatory copy on the Risks tab** (hard filters, soft filters, disqualifiers) describes the reviewer
   process ("the system proposes a score and the reviewer confirms"). It exposes no result, but it is existing form text.
3. **Decision note and reason** (for example "Returns below hurdle") are shown to the Preparer once Sirius declines.
   This is status information, but confirm it is intended.
4. **`GET /api/org/memberships`** returns all 16 memberships to any signed-in user, including a Preparer, so the
   Sirius role roster is visible. It is organisation structure data, not assessment data.
5. **Navigation** shows Screening Board, Pipeline Dashboard, Funnel, IHC Weekly Report, Group Structure and
   Settings to a Preparer. None shows internal AI output now; whether they should appear is a product choice.
6. **Dashboard** (legacy Company / MergerScenario entities) and **Group Structure** (bundled organisation tree)
   carry no assessment data.

## 5. Separate pending Phase 1 requirements

> Update: document extraction, OCR, web research, comparison, the financial engine and the evidence-informed recommendation are now implemented. See `docs/ai-evidence-phase1.md`. The list below is the state before that work; what still applies is the SME workflow and provider approval.

These limits are in `AI_Architecture_Investigation.md` and `Phase_1_Codebase_Gap_Analysis.md` and are still open:

- **Document processing:** PDF, DOCX and PPTX are not parsed; there is no OCR, no readability verdict and no
  content-based categorisation. The AI reads form fields, `.txt/.md/.csv/.tsv/.json` and `.xlsx` only. The default
  virus scan is a heuristic, not an antivirus engine.
- **Web research:** none. No search or browse call is made; `add_context_from_internet` is a stub. Findings cite
  only submitted documents and Sirius strategy passages. The 15 licensed-tool connectors ship disabled.
- **Recommendation:** Go / Conditional Go / No-Go is rule-based, not LLM-generated.
- **Financial engine:** IRR, ROIC, payback and MOIC are typed in, not computed from the model.
- **SME validation workflow:** not built.
- **AI provider:** OpenAI, Azure OpenAI and custom endpoints default to "pending approval" in AI governance until
  an administrator approves them. Without an approved provider only the rule-based checks run (the review shows
  "No AI backend is configured" or "not approved").
