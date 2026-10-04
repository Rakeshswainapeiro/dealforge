# W8-04 — Data-room folder link on the opportunity record (BRD INTG-01)

## What the row asked for

Integration, "Virtual data room integration", accept criterion: **folder link
stored on record**. DealForge does not host deal documents — the secure room
(Coneshare and the mainstream file stores Sirius uses) stays the system of
record for documents. The opportunity record needs the durable pointer to the
folder a screening works from.

## What was built

- **Vocabulary + validation** (`server/config/dataroomLink.js`, version
  `INTG-01.1`): a recognised provider list (Coneshare, SharePoint, OneDrive,
  Google Drive, Box, Dropbox, plus a generic fallback) matched on the link host;
  a policy that requires an absolute **https** URL with a host and a 2048-char
  maximum; and pure helpers to detect the provider, validate a link, build the
  flat stored record and describe it for the board.
- **Routes** (`server/pipeline.js`):
  - `GET /api/pipeline/dataroom-providers` — the provider vocabulary.
  - `GET /api/pipeline/opportunities/:id/dataroom-link` — the stored link
    (org-scoped, `canViewOrg`).
  - `PUT /api/pipeline/opportunities/:id/dataroom-link` — store or replace the
    link (`canWriteOrg`), `422` on an invalid/http link, audited as
    `dataroom_link_set`.
  - `DELETE /api/pipeline/opportunities/:id/dataroom-link` — clear the link
    (`canWriteOrg`), audited as `dataroom_link_cleared`.
  The stored pointer also rides on the pipeline card as `dataroom_folder`.
- **UI** (`src/pages/ScreeningBoard.jsx`): a "Data-room folder" panel in the
  opportunity detail sheet. When a link is set it shows the provider badge, the
  label, an **Open folder** action and **Clear**; when empty it shows the editor
  (URL + optional label + **Save link**) with the https reminder.

## Evidence screenshots

| File | Shows |
|---|---|
| `preparer_dataroom_link_set.png` | A link stored on the Vision Care Imaging Platform record: the Coneshare badge, the label, **Open folder**, **Clear**, the stored URL and the replace editor. |
| `preparer_dataroom_link_editor.png` | The same record with no link set: the empty state and the save editor with the "Must be an https URL to the folder…" reminder. |

Both shots were taken against the demo stack (`http://localhost:34010`) after
setting/clearing the link through the API as the owning subsidiary's deal lead.

## Validation

- `server/tests/dataroomLink.test.js` — 10 unit cases (provider detection,
  https/max-length policy, record shape, empty description).
- `server/tests/dataroomLinkApi.test.js` — 4 integration cases (provider list,
  set → read → audit → clear, `422` on http, cross-tenant `403`).
- Full suite: **995 tests / 995 pass / 0 fail**.
