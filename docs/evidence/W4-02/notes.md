# W4-02 - Entity strategy library: upload & indexing (ENT-02)

## What this delivers

Every entity now has a strategy library. An operator uploads the entity's
strategy document (PDF, DOCX, PPTX, TXT or MD) against the entity (org) and the
server indexes it in-process into citable passages, so the alignment engine has
real source text to quote. The structured strategy profile derived from the
entity's theme and mandate thresholds is versioned, and publishing mints a new
version. This is the foundation the theme-alignment citation (W3-13) and the
per-screening recorded profile version (W4-03) build on.

Upload never fails on an unindexable document: a format the in-process extractor
cannot read keeps its `stored` status and names the reason, and the alignment
engine only ever sees what was actually indexed. Extraction is dependency-free -
DOCX/PPTX are read from the OOXML zip, PDF is best-effort text recovery from the
content stream, and plain text is read directly - so indexing returns in
milliseconds inside the upload request.

## Evidence

| Persona | Feature | Screenshot | What it shows |
| --- | --- | --- | --- |
| Admin | Strategy library documents | admin_strategy_library_documents.png | The **Strategy Library** Settings tab: the indexer version badge **SD-01.1**, the document count, the entity selector, the upload control, and the document table with the Finstreet mandate (.TXT, **indexed**, 5 passages). |
| Admin | Citation search | admin_strategy_citation_search.png | The alignment-engine query box and the returned passages: "2 passage(s) from 1 document(s)", each citing the exact source sentence with its score and matched terms (technology, recurring). |
| Admin | Versioned strategy profile | admin_strategy_versioned_profile.png | The versioned profile card: the mission, sectors, geographies, focus areas and constraints derived from the entity's theme and thresholds, the published version badge and the **Publish new version** action. |

## How it works

1. server/config/strategyIndex.js exports the version (SD-01.1), the accepted
   formats and extensions, the passage sizing, the statuses (indexed / stored /
   failed), the messages, and a dependency-free `extractText`,
   `buildPassages`, `rankPassages` and `bestCitation`.
2. server/strategy.js is mounted at /api/strategy: GET /config, the
   GET/POST/DELETE /documents routes (multer memory upload, scoped object key,
   synchronous indexing), POST /documents/:id/reindex, GET /search,
   GET/POST /profile and GET /profile/history. Every route is org-scoped through
   canViewOrg / canWriteOrg / canConfigure.
3. server/db.js adds the strategy_document and strategy_profile tables and their
   indexes, applied on boot after the M5 schema.
4. server/mvpSeed.js seeds one indexed strategy document per pilot entity
   (Infinia, Finstreet) idempotently on every boot, so the demo has real
   passages to cite even when the sample records already exist.
5. server/themes.js `evaluateAlignment` now returns a `strategy_sources` block
   when a corpus is passed, and server/pipeline.js loads the corpus on the
   screening route - the hook W3-13 uses to quote a passage.
6. src/pages/Settings.jsx adds the **Strategy Library** tab: entity selector,
   upload, the document table with reindex/delete, the citation tester and the
   versioned profile with its publish action.

## Validation

- node --test server/tests/strategyIndex.test.js - 13 pass (format detection,
  extraction for text/OOXML/PDF paths, passage building, ranking and citation).
- BASE_URL=http://localhost:34099 npm run test:server - 558 pass / 129 suites,
  including the four W4-02 integration cases: the indexer shape is exposed, an
  upload indexes into searchable passages with a citation, publishing mints a new
  version and records history, and a sibling entity is denied (403).
- npm run build and eslint clean on the touched files.
- Demo verification: after `docker compose down -v && up -d --build`,
  `GET /api/strategy/search?q=technology%20UAE` on the demo stack returns the
  Infinia strategy passage as a citation.

## Notes

Fixtures: the seeded Infinia Technology Strategy 2026 and Finstreet Financial
Services Mandate 2026 documents (seed-strategy-infinia, seed-strategy-finfstreet)
back the demo citations. Evidence captured against the demo stack at
http://localhost:34010 from the mvp seed profile.
