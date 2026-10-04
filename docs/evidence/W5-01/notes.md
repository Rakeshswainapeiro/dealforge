# W5-01 - Type / stage / flag-driven document checklist (DOC-01)

## What this delivers

The document checklist a submission carries is now generated from the
opportunity's type, stage and flags, and every item is classified as
**mandatory**, **conditional** or **optional**. An item blocks a submission only
when its tier is due for this opportunity, its applicability rule matches and it
is marked enforced; conditional items (off-budget budget confirmation, related-party
compliance screen) become due only when their flag trips; optional items are
collected but never block. The checklist is admin-maintainable without code, and
each save mints the next revision (CL-01.N) with an audit event naming the item
changes, so the checklist a gate ran against is always reconstructable. The
shipped default reproduces the standing MVP document gate - business plan,
financials and cap table are mandatory - so nothing new blocks a submission until
an administrator deliberately changes the checklist.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Admin | Document Checklist tab | admin_document_checklist_admin.png | The **Document Checklist** tab in Settings: the **CL-01.1** revision badge, **16 items**, the per-item tier badges (**mandatory** / **optional**) with the **blocks** marker on enforced items, the applicability rule in words (e.g. "applies when greenfield stage is not concept"), and the admin-only per-item tier selector. Saving mints a new revision. |

## How it works

1. server/config/documentChecklistData.js holds the tier vocabulary
   (mandatory / conditional / optional), the applicability-rule keys and the
   shipped per-artefact tier and rule, grounded in the BRD DOC-01 requirement.
2. server/config/documentChecklist.js is the pure module:
   `defaultDocumentChecklist()` (one item per memo evidence artefact),
   `validateDocumentChecklist()`, `resolveDocumentChecklist()` (fallback),
   `diffDocumentChecklist()`, `buildDocumentChecklist()` (mints revision + 1 and
   the `CL-01.N` version), `checklistContext()` and the `evaluateChecklist()`
   evaluator that returns each item's tier, applicability, due-ness, presence and
   blocking verdict plus counts.
3. server/checklist.js is the API: the checklist lives in an AppSettings record
   (setting_key = 'document_checklist_config'), with `GET /api/checklist`,
   `PUT /api/checklist` (admin-only, mints a revision, writes the audit event)
   and `GET /api/checklist/history`.
4. server/gate.js loads the checklist, generates the per-opportunity checklist
   from type / stage / flags and blocks submission on items whose rule is due and
   enforced; it exposes the generated `document_checklist` on the gate result and
   the vocabulary on `GET /api/gate/fields`. A Concept-stage greenfield still
   waives the mandatory pack.
5. src/api/client.js adds the checklist methods and src/pages/Settings.jsx adds
   the **Document Checklist** tab with the revision badge and admin-only editing.

## Validation

- node --test server/tests/documentChecklist.test.js - 24 pass, 4 suites (shipped
  shape, validation, resolve and mint, evaluation).
- BASE_URL=http://localhost:34099 node --test server/tests/*.test.js - 615 pass
  / 143 suites, including the five W5-01 integration cases: a reader sees the
  effective checklist + defaults, a deal lead gets 403 on PUT, an admin edit mints
  revision + 1 and is recorded in history, /api/gate/fields exposes the
  document_checklist block, and a submission with no documents blocks on
  business_plan and financials.
- eslint clean on the touched files; npm run build passes.
- Demo verification: GET /api/checklist on the demo stack returns CL-01.1 with 16
  items and the shipped mandatory / conditional / optional tiers.

## Notes

The checklist draws from the same catalogue as the memo evidence list
(server/config/memoDocumentList.js) so the checklist, the gate and the memo name
one document set. Evidence captured against the demo stack at
http://localhost:34010.
