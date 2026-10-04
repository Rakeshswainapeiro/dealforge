# W5-04 — Data-point to source mapping (DOC-05)

BRD requirement **DOC-05** (Documents & Completeness, Should): a data-point to
source mapping, held in config, where a data point links to the source it came
from so a reviewer can open the linked source.

## What was built

1. `server/config/dataSourceData.js` holds the vocabulary and the shipped
   default: the source types (field, document, derived, external), the memo
   pages, and one link per memo data point at its sensible default — a captured
   field key or a submission-document requirement key.
2. `server/config/dataSource.js` is the pure module — `defaultDataSourceConfig`,
   `validateDataSourceConfig`, `resolveDataSourceConfig` (fills a missing link
   from the shipped default), `diffDataSourceConfig`, `buildDataSourceConfig`
   (mints `revision + 1` and the matching `SRC-01.N` version, rejects an unknown
   data point with a 400), `resolveLink` (resolves a link against the record's
   documents and captured data — a document link to its current attachment and
   openable URL, a field link to its captured value, reporting availability as
   attached/captured/missing) and `buildSourceMap` (the links grouped by memo
   page in running order plus the still-missing sources).
3. `server/dataSource.js` holds the mapping in an AppSettings record
   (`setting_key = 'data_source_config'`) and exposes `GET /api/data-sources`,
   `PUT /api/data-sources` (admin-only, mints a revision, writes the
   `data_source_config_updated` audit event) and `GET /api/data-sources/history`.
   Mounted in `server/index.js`.
4. `server/pipeline.js` attaches the resolved `source_map` to every generated
   memo (`GET .../memo`), so the memo carries its own provenance. `server/gate.js`
   now returns an openable `file_url` for a locally stored document version, so
   an "Open source" link works in local mode as well as against object storage.
5. `src/api/client.js` adds the three methods; `src/pages/Settings.jsx` adds the
   admin Source Mapping tab (one editable row per data point, with the revision
   badge and Save revision); `src/components/pipeline/SiriusMemoDialog.jsx`
   renders the memo's source map grouped by page, each value with its source
   type/ref, its availability badge and an Open source link where a document is
   attached.

The mapping is provenance only: it never changes a value and never blocks a
submission.

## How it works

- **Admin (Settings → Source Mapping):** each memo data point is listed with its
  source type and source reference. Saving mints the next `SRC-01.N` revision
  and audits the change; the shipped default fills any link left unset.
- **Reviewer (Screening Board → Create Sirius memo):** the memo preview ends
  with a Data-point source map grouped by memo page. A document-backed value
  shows `vN attached` with an **Open source** link; a field-backed value shows
  `captured`; a value whose source is not yet on the record shows `not on record`,
  and the header counts how many sources are outstanding.

## Evidence

- `admin_data_source_mapping_admin.png` — the Source Mapping tab: all 16 memo
  data points mapped to their source type and reference (`SRC-01.1`).
- `reviewer_memo_data_point_sources_reviewer.png` — the generated memo's
  data-point source map: attached documents show `v1 attached` with an Open
  source link, captured fields show `captured`, and outstanding sources show
  `not on record`.

## Tests

- `server/tests/dataSource.test.js` — 19 pass / 6 suites (shipped mapping,
  validation, resolve fallback, revision minting and diff, per-link resolution,
  `buildSourceMap` grouping and ordering).
- `server/tests/m6.test.js` — 4 W5-04 integration cases (a reader sees the
  effective mapping and default; a deal lead gets 403 on PUT; an admin edit mints
  revision + 1 and is audited; the memo carries a source map that links an
  attached document and a captured field).
