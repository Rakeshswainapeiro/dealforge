// Pure-function tests for the Opportunity Overview pack (W7-04 / BRD OUT-02).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSiriusMemo } from '../config/siriusMemo.js';
import {
  MEMO_PACK_FORMATS,
  PACK_PAGE_ORDER,
  PACK_PAGE_KEYS,
  orderMemoPages,
  buildMemoPackManifest,
  packFilenameStem,
  memoPackHtml,
  memoPackMarkdown,
  renderMemoPack,
} from '../config/memoPack.js';

function sampleMemo() {
  return buildSiriusMemo({
    opportunity: {
      data: {
        opportunity_name: 'Test Opportunity',
        total_commitment_aed: 120,
        ask_aed: 40,
        narrative_what: 'A bolt-on acquisition of a regional logistics platform.',
      },
    },
    org: { name: 'Infinia Technologies Limited' },
  });
}

describe('memo pack vocabulary (W7-04)', () => {
  test('the six template pages are declared in the Part B order', () => {
    assert.deepEqual(PACK_PAGE_KEYS, ['executive_summary', 'overview', 'rationale', 'financials', 'funding', 'risks']);
    assert.deepEqual(PACK_PAGE_ORDER.map((p) => p.number), [1, 2, 3, 4, 5, 6]);
  });

  test('html and markdown are the offered formats', () => {
    assert.deepEqual(MEMO_PACK_FORMATS.map((f) => f.key), ['html', 'md']);
    assert.equal(MEMO_PACK_FORMATS[0].mime.startsWith('text/html'), true);
  });
});

describe('memo pack ordering (W7-04)', () => {
  test('orderMemoPages sorts a shuffled memo back into template order', () => {
    const memo = sampleMemo();
    memo.pages = [memo.pages[3], memo.pages[0], memo.pages[5], memo.pages[1], memo.pages[4], memo.pages[2]];
    const ordered = orderMemoPages(memo);
    assert.deepEqual(ordered.map((p) => p.key), PACK_PAGE_KEYS);
    assert.deepEqual(ordered.map((p) => p.number), [1, 2, 3, 4, 5, 6]);
  });

  test('orderMemoPages keeps an unknown page after the template six', () => {
    const memo = sampleMemo();
    memo.pages = [...memo.pages, { number: 99, key: 'appendix', title: 'Appendix', sections: [] }];
    const ordered = orderMemoPages(memo);
    assert.equal(ordered.length, 7);
    assert.equal(ordered[6].key, 'appendix');
  });
});

describe('memo pack manifest (W7-04)', () => {
  test('a normal memo is reported in template order with six pages', () => {
    const man = buildMemoPackManifest(sampleMemo());
    assert.equal(man.page_count, 6);
    assert.equal(man.in_template_order, true);
    assert.deepEqual(man.page_order, PACK_PAGE_KEYS);
    assert.deepEqual(man.template_page_order, PACK_PAGE_KEYS);
    assert.equal(man.pages.length, 6);
    assert.ok(man.pages[0].sections.length >= 1);
  });

  test('a memo missing a page is flagged out of template order', () => {
    const memo = sampleMemo();
    memo.pages = memo.pages.filter((p) => p.key !== 'risks');
    const man = buildMemoPackManifest(memo);
    assert.equal(man.page_count, 5);
    assert.equal(man.in_template_order, false);
  });

  test('the manifest carries the source, confidentiality and evidence', () => {
    const man = buildMemoPackManifest(sampleMemo());
    assert.ok(man.source && man.source.includes('Part B'));
    assert.equal(man.confidentiality, 'Sirius International Holding Limited |Confidential');
    assert.ok(man.evidence);
  });
});

describe('memo pack render (W7-04)', () => {
  test('the HTML pack has one section per template page, in order', () => {
    const html = memoPackHtml(sampleMemo());
    assert.equal((html.match(/<section/g) || []).length, 6);
    for (let n = 1; n <= 6; n += 1) assert.ok(html.includes('id="page-' + n + '"'), 'page ' + n);
    assert.ok(html.indexOf('id="page-1"') < html.indexOf('id="page-6"'));
    // Print rules give each page its own sheet.
    assert.ok(html.includes('@media print'));
    assert.ok(html.includes('page-break-after'));
  });

  test('the HTML pack escapes markup and marks empty fields as placeholders', () => {
    const memo = sampleMemo();
    memo.header = '<script>alert(1)</script>';
    const html = memoPackHtml(memo);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('class="ph"'));
  });

  test('the Markdown pack has the six pages as level-2 headings in order', () => {
    const md = memoPackMarkdown(sampleMemo());
    const headings = md.split('\n').filter((l) => l.startsWith('## Page '));
    assert.equal(headings.length, 6);
    assert.match(headings[0], /^## Page 1 - /);
    assert.match(headings[5], /^## Page 6 - /);
  });

  test('renderMemoPack selects the format and defaults unknown to html', () => {
    const html = renderMemoPack(sampleMemo(), 'html');
    assert.equal(html.format, 'html');
    assert.equal(html.extension, 'html');
    const md = renderMemoPack(sampleMemo(), 'md');
    assert.equal(md.format, 'md');
    assert.equal(renderMemoPack(sampleMemo(), 'pdf').format, 'html');
  });

  test('packFilenameStem is filename-safe', () => {
    const stem = packFilenameStem(sampleMemo());
    assert.match(stem, /^Sirius_Opportunity_Overview_/);
    assert.equal(/[^A-Za-z0-9_]/.test(stem), false);
  });
});
