# W3-12 - Sanctions / adverse-media confirmation (SCR-08)

## What this delivers

Every opportunity now carries a manual sanctions and adverse-media confirmation
on the record. The preparer records the verdict (clear / adverse / pending), the
screening source, a supporting note, the named reviewer and an evidence
reference, and attaches the screening output as a document. The Screening Board
shows the confirmation as a read-only advisory card so the analyst sees the
verdict and the evidence held before deciding.

The confirmation is advisory, never a gate. The system does not reject an
opportunity on its own: a clear verdict is simply not *satisfied* until both a
note of at least the minimum length and the evidence are on the record, and an
adverse or pending verdict raises a flag for a person to review. This keeps the
MVP rule that submission is blocked only by business plan, financials and the
cap table while still requiring the screening evidence to be documented.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Analyst (Sirius CIO) | Adverse-media advisory card | analyst_analyst_adverse_media_confirmation.png | The "Sanctions / adverse media (advisory)" card on the Vision Care Imaging Platform screening panel: the **clear** badge, the message "Sanctions / adverse-media exposure confirmed clear against the supporting evidence.", "Confirmation note: recorded", and "Evidence on record: yes - source: Dow Jones Risk & Compliance - screened by deal.lead@infinia.local". |
| Preparer (Infinia deal lead) | Confirmation field with evidence | preparer_preparer_adverse_media_form.png | The "6d. Sanctions / adverse-media confirmation" section of the submission form: the verdict select (clear), the screening source, the named screener, the evidence reference (DJR-2026-009812), the confirmation note and the attached screening evidence (seed-inf-vision_adverse_media_evidence.pdf - v1). |

## How it works

1. server/config/adverseMedia.js exports the version (AM-01.1), the statuses
   (clear / adverse / pending), the note minimum, the evidence document key
   (adverse_media_evidence), the field keys, the messages and the single
   non-blocking document requirement, plus
   evaluateAdverseMedia(data, {documents}).
2. A clear verdict is satisfied only when the note meets the minimum length and
   the evidence is present (an uploaded evidence document or a non-blank
   evidence reference). Adverse, pending and unconfirmed verdicts raise flags
   and never reject.
3. server/config/intakeConfig.js adds the five risks-section fields (verdict,
   source, note, evidence reference, reviewer), none of them required.
4. server/gate.js returns adverse_media from evaluateGate and advertises the
   config on GET /api/gate/fields. server/config/screeningPanel.js surfaces the
   block at the top of the panel.
5. server/gate.js now seeds the full memo evidence catalogue (the gate tier
   required, the supporting evidence non-blocking) idempotently on every boot,
   so the adverse-media evidence requirement is offered for upload without
   blocking a submission.
6. src/pages/SubmitOpportunity.jsx renders the confirmation card with an inline
   evidence upload (data-testid="adverse-media-card"), and
   src/pages/ScreeningBoard.jsx renders the advisory card
   (data-testid="adverse-media").

## Validation

- node --test server/tests/adverseMedia.test.js - 8 pass (the verdict
  normalisation, the note/evidence requirement for a clear verdict, and the
  advisory flags for adverse and pending).
- BASE_URL=http://localhost:34099 node --test server/tests/m3.test.js - the five
  SCR-08 cases prove the config is exposed, the evidence requirement is seeded
  without blocking, a clear verdict with note and evidence is satisfied on the
  panel, a clear verdict without evidence is flagged, and an adverse finding is
  flagged without rejecting the opportunity.
- Full server suite (npm run test:server) - 541 pass / 124 suites.
- npm run build and eslint clean on the touched files.

## Notes

Fixtures: the seeded Vision Care Imaging Platform (seed-inf-vision) carries a
clear verdict, the Dow Jones source, the reviewer and the DJR-2026-009812
reference with the screening evidence attached. Evidence captured against the
demo stack at http://localhost:34010 from the mvp seed profile.
