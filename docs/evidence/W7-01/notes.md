# W7-01 - IHC weekly report (DSH-03)

**BRD requirement:** DSH-03 - "IHC weekly report reproducing Friday tracker columns, Excel export, optional weekly schedule".
**Acceptance criterion:** Columns match agreed tracker; exportable; schedulable.
**Priority:** Must.

## What this covers

The group Investment Holding Committee keeps a standing Friday deal tracker. This workstream reproduces that tracker from the live pipeline rather than retyping it: the agreed column set in order, an Excel/CSV export, and an optional weekly schedule. The column set, the tracked stages and the schedule are configuration (AppSettings 'reporting_config'), versioned and audited, so the group can retune the pack without a deploy.

## Evidence

1. **leadership_ihc_weekly_tracker_leadership.png** - the group leadership view (fahad@sirius.local) of the weekly tracker: fourteen opportunities with subsidiary, commitment (AED mn), stage, owner, age and SLA columns, plus the summary banner (14 opportunities, AED 2,230 mn). The nav shows the new **IHC Weekly Report** menu.

2. **admin_ihc_reporting_configuration_admin.png** - the admin configuration: the fourteen Friday tracker columns in the agreed order, the seven tracked stages, the shipped version (RPT-01.1) and the audited save.

## How it works

- Policy lives in server/config/reportingData.js + server/config/reporting.js (pure): the column vocabulary, the value resolution from a pipeline card, the schedule validation, the summary and the CSV serialisation. Held in AppSettings under 'reporting_config', falling back to the shipped default; an admin edit mints revision + 1 and is audited.
- server/reporting.js (/api/reporting) exposes the config, its history, the weekly tracker JSON, the Excel/CSV exports and the schedule. It composes the tracker from the same screening board the Investment Team reads, so a subsidiary's rows never leak past the actor's org scope.
- The Excel workbook is written by server/xlsx.js, a minimal dependency-free XLSX writer (uses the JSZip already shipped with the server), so no new runtime package was added. Verified by opening the file with openpyxl: the sheet carries the banner and the tracker table.
- The page renders at src/pages/Reporting.jsx (/Reporting), registered in pages.config.js and gated by the new 'reporting' feature group.

## Verification

- server/tests/reporting.test.js - 10 pure-function cases (columns, clamping, revision minting, money rendering, decision text, summary, CSV escaping, schedule key).
- server/tests/m6.test.js - 5 integration cases (tracker column order, config vocabulary, 403 for non-admin, xlsx export, audited revision edit). Full suite green (856 pass / 0 fail).
- Excel export opened with openpyxl: sheet "IHC Weekly Tracker", 14 data rows, AED mn commitment column.
