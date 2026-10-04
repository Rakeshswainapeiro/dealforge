# W5-05 - Document templates (DOC-06)

Accept criterion: *Current versions downloadable, Investment-Team maintained.*

## What this delivers
A Template Library the Investment Team maintains from Settings, listing the four
standard submission templates. Each is rendered on demand from the same
configuration the memo, financials grid and qualifying gates use, so a download
is always the current version:

| Template | Format | Source of truth it renders |
| --- | --- | --- |
| Opportunity Overview | .docx | `server/config/siriusMemo.js` page tabs, titles, captions |
| Three-statement financial model | .csv | `server/config/financials.js` 8 rows x 8 periods |
| Risk register | .csv | risk-section columns, 5-8 named-owner rows |
| Qualifying-gate checklist | .csv | `server/config/qualifyingGates.js` 10 gates + evidence |

## Where it lives
- Config (pure): `server/config/templateLibrary.js`, `server/config/templateLibraryData.js`
- Renderers (pure): `server/templateRender.js`
- API: `server/templates.js` - `GET/PUT /api/templates`, `GET /api/templates/history`, `GET /api/templates/:id/download`
- UI: Settings -> **Template Library** tab (`src/pages/Settings.jsx`), client methods in `src/api/client.js`

## How to reproduce
1. Demo stack: `docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build` -> http://localhost:34010
2. Sign in as admin, open **Settings -> Template Library**: four rows, each with
   format, owner, version (TPL-01.1) and a Download button.
3. Click **Download** on any row - the browser saves the current version
   (`Sirius_Opportunity_Overview.docx`, `Sirius_Financial_Model.csv`, ...).
4. Toggle a template off and **Save revision**: the row leaves the list and
   `TPL-01.2` is minted and audited.

## Evidence
- `admin_template_library_admin.png` - the maintained library and its revision badge.
- `preparer_template_library_download_preparer.png` - a template row with format, owner, version and Download.

## Tests
- `server/tests/templateLibrary.test.js` - 12 unit tests (validation, resolve, revision minting, diff, catalogue, renderers).
- `server/tests/m6.test.js` - integration: reader sees the library, deal lead blocked (403), admin edit mints revision + audits + hides disabled, each template downloads a current version with the right content type, unknown id 404.
