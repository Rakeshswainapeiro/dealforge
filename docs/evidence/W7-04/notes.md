# W7-04 - Opportunity Overview pack export (OUT-02)

**BRD requirement:** OUT-02 - "Opportunity Overview pack export (six-page Part B order/layout)".
**Acceptance criterion:** Export follows Part B page order.
**Priority:** Should.
**Depends on:** W1-03 (the six-page memo model).

## What this covers

The generated Sirius Investment Framework memo can now be exported as a
self-contained **Opportunity Overview pack** in the template's six-page running
order. Two formats are offered: a print-ready HTML pack (open and print to PDF,
one template page per sheet) and a plain Markdown pack. Both are built from the
same memo model the on-screen preview and the .docx use, so they cannot drift,
and the export route is org-scoped exactly like the pipeline and the .docx memo.

## Evidence

1. **preparer_export_overview_pack_button.png** - the memo dialog
   (deal.lead@infinia.local) now carries the **Export Overview pack** action next
   to **Download .docx**, within the organisation's own visibility.

2. **preparer_pack_six_page_part_b_order.png** - the exported pack opened: page
   1 **Executive summary** with the six-tab template running order across the top
   (1 Executive summary, 2 Opportunity overview, 3 Rationale & fit, 4 Financials
   & returns, 5 Funding & key asks, 6 Risks & compliance) and the
   confidentiality footer - the Part B order and layout.

## How it works

- Vocabulary lives in server/config/memoPackData.js: the pack version, the two
  formats (html, md), and PACK_PAGE_ORDER - the six Part B pages in their exact
  printed order.
- Pure assembly lives in server/config/memoPack.js: orderMemoPages (re-sorts a
  memo's pages into template order, keeping any unknown page afterwards),
  buildMemoPackManifest (page_count, page_order, template_page_order and an
  in_template_order flag that proves the order), packFilenameStem, and memoPackHtml
  / memoPackMarkdown / renderMemoPack. The HTML printer emits styled markup with
  @page and @media print rules so each template page occupies its own printed
  sheet; it needs no new runtime dependency.
- server/memoPack.js (/api/memo-pack) exposes the vocabulary (GET /), the manifest
  (GET /opportunities/:id) and the downloads (GET /opportunities/:id.:format). It
  reads the opportunity through the same canViewOrg rule as the pipeline and the
  memo .docx, so a cross-tenant caller gets 403. Each export is audited as
  'memo_pack_export'.
- The client adds api.memoPack (manifest + download) and a gated button in
  src/components/pipeline/SiriusMemoDialog.jsx behind the new **MemoPack** feature
  flag (part of the reporting feature group), so a deployment can hide the export.

## Verification

- server/tests/memoPack.test.js - 12 pure-function cases (template page order,
  formats, re-sorting a shuffled memo, keeping an unknown page, the manifest
  order flag, HTML's six sections in order, HTML escaping and placeholder
  marking, the Markdown six headings, format selection with unknown defaulting to
  html, filename safety).
- server/tests/m6.test.js - 6 integration cases (vocabulary, manifest in template
  order, HTML download with attachment header and six ordered pages, Markdown
  download, 400 on an unsupported format, 403 for a cross-tenant caller). Full
  suite green (908 pass / 0 fail).
