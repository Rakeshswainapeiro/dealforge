# W8-05 — Bulk import of in-flight opportunities with validation report (INTG-03)

**Persona:** Administrator (`admin@dealforge.local`)
**Surface:** Settings → **Bulk Import**

## What the shot shows

The one-off load of deals already in flight from the Sirius tracker spreadsheet.
The operator uploads the export, and every row is validated against the shipped
capture vocabulary and the organisation tree **before** anything is created. The
report names each row that cannot be loaded and why; nothing is silently dropped.

In `admin_bulk_import_report.png` the sample tracker holds four data rows and the
report reads **Rows 4 · Valid 2 · Warnings 0 · Errors 2**:

- `#2 Sunrise Diagnostics Platform` — valid (healthcare, in-appetite type).
- `#3 Gulf Cold Chain Logistics` — valid (bolt-on, KSA, finstreet org).
- `#4 (no name)` — error: *Opportunity name is required.*
- `#5 Falcon Renewables` — error: *negative commitment, unknown org id, and
  `crypto_punt` is not in the shipped vocabulary.*

The `Mystery column` header the reader does not recognise is listed under
**Ignored unknown columns**, so a stale tracker column is reported rather than
mistaken for a capture field. The version stamp `INTG-03.1` and the scope note
state the import is a bounded one-off (`max 500 rows`) and that loaded records
are created through the audited entity API so they carry the same create audit
as a person-entered deal.

## How it works

- `POST /api/bulk-import/validate` (admin only) is the dry run and returns the
  row-level report; `POST /api/bulk-import/execute` creates only the importable
  rows and audits the whole load (`entity: bulk_import`).
- `.xlsx`, `.xls` and `.csv` uploads are accepted; `GET /template.csv` and the
  **Download template (CSV)** button give the operator the exact column shape.
- Rows that fail validation, name an unknown organisation, or fall outside the
  importing admin's write scope are skipped and surfaced in the report.
