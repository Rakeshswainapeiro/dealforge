// ---------------------------------------------------------------------------
// Opportunity Overview pack - pure assembly (W7-04 / BRD OUT-02).
//
// The memo builder (server/config/siriusMemo.js) already emits the six Part B
// pages with their sections. This module turns that model into a *pack*: a
// manifest that proves the six-page order, plus two self-contained downloads
// (print-ready HTML and Markdown) that preserve the template page order.
//
// No database, no network, and no new runtime dependency: the HTML printer
// emits plain, styled markup whose @page/@media print rules put one template
// page per printed sheet. Unlike the .docx export (which needs the `docx`
// package), the HTML pack renders anywhere and prints to PDF from the browser.
// ---------------------------------------------------------------------------

import {
  MEMO_PACK_VERSION, MEMO_PACK_KEY, MEMO_PACK_TITLE, MEMO_PACK_FORMATS,
  PACK_PAGE_ORDER, PACK_PAGE_KEYS, MEMO_PACK_MESSAGES,
} from './memoPackData.js';

export {
  MEMO_PACK_VERSION, MEMO_PACK_KEY, MEMO_PACK_TITLE, MEMO_PACK_FORMATS,
  PACK_PAGE_ORDER, PACK_PAGE_KEYS, MEMO_PACK_MESSAGES,
};

const PLACEHOLDER = '[ ]';

function scalar(value, fallback = PLACEHOLDER) {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s === '' ? fallback : s;
}

function isPlaceholder(value) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' || s === PLACEHOLDER;
}

// Order a memo's pages the way the template prints them. Any page the memo
// carries that is not in PACK_PAGE_ORDER is kept afterwards, so a future
// template addition can never silently vanish; unknown/missing order is the
// only way this differs from a plain copy.
export function orderMemoPages(memo) {
  const pages = Array.isArray(memo?.pages) ? memo.pages : [];
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const ordered = [];
  PACK_PAGE_ORDER.forEach((slot, index) => {
    const page = byKey.get(slot.key);
    if (page) {
      ordered.push({ ...page, number: slot.number, key: slot.key, title: page.title || slot.label, _order: index });
      byKey.delete(slot.key);
    }
  });
  for (const page of byKey.values()) ordered.push({ ...page, _order: ordered.length });
  return ordered;
}

// A short per-page contents summary for the manifest: section headings and how
// many table rows each section carries, so a reviewer can see the pack covers
// the whole template without opening the file.
function summarisePages(pages) {
  return pages.map((page) => ({
    number: page.number,
    key: page.key,
    title: page.title,
    caption: page.caption || null,
    sections: (page.sections || []).map((s) => ({
      type: s.type,
      heading: s.heading || null,
      rows: Array.isArray(s.rows) ? s.rows.length : undefined,
    })),
  }));
}

// The manifest: what the pack contains and (crucially for OUT-02) the exact
// six-page Part B order, with a flag confirming the order is the template's.
export function buildMemoPackManifest(memo) {
  const pages = orderMemoPages(memo);
  const keys = pages.map((p) => p.key);
  const expected = PACK_PAGE_KEYS;
  const inTemplateOrder = keys.length === expected.length && expected.every((k, i) => keys[i] === k);
  return {
    key: MEMO_PACK_KEY,
    version: MEMO_PACK_VERSION,
    title: MEMO_PACK_TITLE,
    header: memo?.header || null,
    subsidiary: memo?.subsidiary || null,
    opportunity_name: memo?.opportunity_name || null,
    confidentiality: memo?.confidentiality || null,
    source: memo?.source || MEMO_PACK_MESSAGES.source,
    generated_at: memo?.generated_at || null,
    page_count: pages.length,
    page_order: keys,
    template_page_order: expected.slice(),
    in_template_order: inTemplateOrder,
    pages: summarisePages(pages),
    formats: MEMO_PACK_FORMATS,
    evidence: memo?.evidence || { present: [], items: [] },
    messages: MEMO_PACK_MESSAGES,
  };
}

// A stable, filename-safe stem for the downloads.
export function packFilenameStem(memo) {
  const base = [memo?.subsidiary, memo?.opportunity_name]
    .filter(Boolean).join(' - ')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return 'Sirius_Opportunity_Overview_' + (base || 'pack');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Markdown render ------------------------------------------------------

function markdownSection(section) {
  const out = [];
  const heading = section.heading ? '### ' + section.heading : null;
  switch (section.type) {
    case 'fields':
      if (heading) out.push(heading);
      out.push('');
      out.push('| Field | Value |');
      out.push('| --- | --- |');
      for (const r of section.rows || []) out.push('| ' + r.label + ' | ' + scalar(r.value) + ' |');
      out.push('');
      break;
    case 'prose':
      if (heading) out.push(heading);
      out.push('');
      out.push(isPlaceholder(section.text) ? '_' + scalar(section.placeholder) + '_' : section.text);
      out.push('');
      break;
    case 'bullets':
      if (heading) out.push(heading);
      out.push('');
      for (const item of section.items || []) {
        const label = item.label ? '**' + item.label + ':** ' : '';
        out.push('- ' + label + scalar(item.text));
      }
      out.push('');
      break;
    case 'cards':
      if (heading) out.push(heading);
      out.push('');
      for (const c of section.cards || []) {
        out.push('**' + c.title + '** - ' + scalar(c.text));
        out.push('');
      }
      break;
    case 'table':
      if (heading) out.push(heading);
      out.push('');
      out.push('| ' + (section.columns || []).join(' | ') + ' |');
      out.push('| ' + (section.columns || []).map(() => '---').join(' | ') + ' |');
      for (const r of section.rows || []) out.push('| ' + r.map((v) => scalar(v)).join(' | ') + ' |');
      if (section.note) out.push('', '_' + section.note + '_');
      out.push('');
      break;
    case 'finTable':
      if (heading) out.push(heading);
      out.push('');
      out.push('| ' + (section.unit_label || 'AED mn') + ' | ' + (section.periods || []).join(' | ') + ' |');
      out.push('| --- | ' + (section.periods || []).map(() => '---').join(' | ') + ' |');
      for (const r of section.rows || []) out.push('| ' + [r.label, ...(r.values || [])].map((v) => scalar(v)).join(' | ') + ' |');
      out.push('');
      break;
    case 'returnsTable':
      out.push('| Returns | Hurdle | Base | Upside | Downside | Meets? |');
      out.push('| --- | --- | --- | --- | --- | --- |');
      for (const r of section.rows || []) out.push('| ' + [r.label, r.hurdle, r.base, r.upside, r.downside, r.meets].map((v) => scalar(v)).join(' | ') + ' |');
      out.push('');
      break;
    case 'keyAsks':
      out.push('### ' + (section.heading || 'Key asks from Sirius'));
      out.push('');
      for (const c of section.cards || []) out.push('**' + c.number + '. ' + c.title + '** - ' + scalar(c.text));
      out.push('');
      break;
    case 'fundingTables':
      out.push('| Funding - sources | AED mn | % | Status |');
      out.push('| --- | --- | --- | --- |');
      for (const r of section.sourceRows || []) out.push('| ' + [r.label, r.aed, r.pct, r.status].map((v) => scalar(v)).join(' | ') + ' |');
      out.push('');
      out.push('| Uses | AED mn |');
      out.push('| --- | --- |');
      for (const r of section.useRows || []) out.push('| ' + [r.label, r.aed].map((v) => scalar(v)).join(' | ') + ' |');
      out.push('');
      break;
    case 'note':
      out.push('_' + scalar(section.text) + '_');
      out.push('');
      break;
    default:
      break;
  }
  return out.join('\n');
}

export function memoPackMarkdown(memo) {
  const pages = orderMemoPages(memo);
  const out = [];
  out.push('# ' + MEMO_PACK_TITLE);
  out.push('');
  out.push(memo?.header || '');
  if (memo?.confidentiality) out.push('', '_' + memo.confidentiality + '_');
  out.push('');
  out.push('> ' + MEMO_PACK_MESSAGES.order_note);
  out.push('');
  out.push('---');
  pages.forEach((page) => {
    out.push('');
    out.push('## Page ' + page.number + ' - ' + page.title);
    if (page.caption) { out.push('', '_' + page.caption + '_'); }
    out.push('');
    for (const section of page.sections || []) out.push(markdownSection(section));
    out.push('\n<!-- page ' + page.number + ' end -->\n');
  });
  out.push('---');
  out.push('');
  out.push('_Source: ' + (memo?.source || MEMO_PACK_MESSAGES.source) + '_');
  return out.join('\n');
}

// ---- HTML render ----------------------------------------------------------

function htmlTable(columns, rows, { numericFrom = null, compact = false } = {}) {
  if (!columns || !columns.length) return '';
  const head = '<tr>' + columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>';
  const body = (rows || []).map((r) => '<tr>' + r.map((v, i) => {
    const empty = isPlaceholder(v);
    const cls = [
      numericFrom != null && i >= numericFrom ? 'num' : '',
      empty ? 'ph' : '',
    ].filter(Boolean).join(' ');
    return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(scalar(v)) + '</td>';
  }).join('') + '</tr>').join('');
  return '<table class="' + (compact ? 'compact' : '') + '"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

function htmlSection(section) {
  const heading = section.heading ? '<h3>' + esc(section.heading) + '</h3>' : '';
  switch (section.type) {
    case 'fields':
      return heading + htmlTable(['Field', 'Value'], (section.rows || []).map((r) => [r.label, r.value]), { compact: true });
    case 'prose': {
      const hasText = section.text && String(section.text).trim() && String(section.text).trim() !== PLACEHOLDER;
      const body = hasText ? esc(section.text) : '<span class="ph">' + esc(scalar(section.placeholder)) + '</span>';
      return heading + '<p>' + body + '</p>';
    }
    case 'bullets':
      return heading + '<ul>' + (section.items || []).map((item) => {
        const label = item.label ? '<strong>' + esc(item.label) + ':</strong> ' : '';
        const empty = isPlaceholder(item.text);
        return '<li>' + label + '<span' + (empty ? ' class="ph"' : '') + '>' + esc(scalar(item.text)) + '</span></li>';
      }).join('') + '</ul>';
    case 'cards':
      return (heading || '') + '<div class="cards">' + (section.cards || []).map((c) =>
        '<div class="card"><div class="card-title">' + esc(c.title) + '</div><div' + (isPlaceholder(c.text) ? ' class="ph"' : '') + '>' + esc(scalar(c.text)) + '</div></div>'
      ).join('') + '</div>';
    case 'table':
      return heading + htmlTable(section.columns, section.rows, { compact: section.compact, numericFrom: section.numericFrom })
        + (section.note ? '<p class="note">' + esc(section.note) + '</p>' : '');
    case 'finTable':
      return heading + htmlTable([section.unit_label || 'AED mn', ...(section.periods || [])],
        (section.rows || []).map((r) => [r.label, ...(r.values || [])]), { numericFrom: 1, compact: true });
    case 'returnsTable':
      return htmlTable(['Returns', 'Hurdle', 'Base', 'Upside', 'Downside', 'Meets?'],
        (section.rows || []).map((r) => [r.label, r.hurdle, r.base, r.upside, r.downside, r.meets]), { compact: true });
    case 'keyAsks':
      return '<div class="asks-band">' + esc(section.heading || 'KEY ASKS FROM SIRIUS') + '</div>'
        + '<div class="cards asks">' + (section.cards || []).map((c) =>
          '<div class="card"><div class="ask-num">' + esc(c.number) + '</div><div class="card-title">' + esc(c.title) + '</div><div' + (isPlaceholder(c.text) ? ' class="ph"' : '') + '>' + esc(scalar(c.text)) + '</div></div>'
        ).join('') + '</div>';
    case 'fundingTables': {
      const sources = htmlTable(['Funding - sources', 'AED mn', '%', 'Status'],
        (section.sourceRows || []).map((r) => [r.label, r.aed, r.pct, r.status]), { numericFrom: 1, compact: true });
      const uses = htmlTable(['Uses', 'AED mn'], (section.useRows || []).map((r) => [r.label, r.aed]), { numericFrom: 1, compact: true });
      return '<div class="two-col"><div>' + sources + '</div><div>' + uses + '</div></div>'
        + (section.heading ? '<h3>' + esc(section.heading) + '</h3>' : '');
    }
    case 'note':
      return '<p class="note">' + esc(section.text) + '</p>';
    default:
      return '';
  }
}

const HTML_STYLE = [
  '* { box-sizing: border-box; }',
  'body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; background: #eef2f5; }',
  '.page { background: #fff; width: 210mm; min-height: 297mm; padding: 16mm 15mm; margin: 8mm auto; box-shadow: 0 1px 4px rgba(0,0,0,.12); position: relative; }',
  '.doc-head { display: flex; justify-content: space-between; font-size: 10px; color: #6b7280; border-bottom: 1px solid #d0d5dd; padding-bottom: 6px; margin-bottom: 14px; }',
  'h1 { font-size: 20px; color: #0b4e63; margin: 0 0 4px; }',
  'h3 { font-size: 13px; color: #0b4e63; margin: 16px 0 6px; }',
  '.caption { font-style: italic; color: #6b7280; font-size: 11px; margin: 2px 0 10px; }',
  '.tabs { display: flex; gap: 3px; margin: 8px 0 4px; }',
  '.tabs span { flex: 1; text-align: center; font-size: 9px; padding: 4px 2px; border-radius: 3px; background: #eaf7fa; color: #475569; }',
  '.tabs span.on { background: #0b4e63; color: #fff; font-weight: bold; }',
  'table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }',
  'th, td { border: 1px solid #d0d5dd; padding: 4px 6px; font-size: 10.5px; text-align: left; vertical-align: top; }',
  'th { background: #e6f4f1; color: #0b4e63; }',
  'td.num { text-align: right; }',
  'table.compact th, table.compact td { font-size: 10px; padding: 3px 5px; }',
  '.cards { display: flex; gap: 8px; margin: 6px 0 10px; }',
  '.cards .card { flex: 1; border: 1px solid #d0d5dd; border-radius: 5px; padding: 7px 8px; font-size: 10.5px; }',
  '.cards .card-title { font-weight: bold; color: #0b4e63; margin-bottom: 3px; }',
  '.cards.asks .card { background: #0b4e63; color: #d7eef5; border: none; }',
  '.cards.asks .card-title { color: #fff; }',
  '.ask-num { background: #0e7490; color: #fff; display: inline-block; border-radius: 3px; padding: 0 5px; font-weight: bold; margin-bottom: 4px; }',
  '.asks-band { background: #0e7490; color: #fff; font-weight: bold; font-size: 12px; padding: 6px 9px; border-radius: 4px; }',
  '.two-col { display: flex; gap: 12px; }',
  '.two-col > div { flex: 1; }',
  '.note { font-style: italic; color: #4b5563; font-size: 10px; margin: 4px 0 8px; }',
  '.ph { color: #7a8699; font-style: italic; }',
  '.foot { position: absolute; bottom: 8mm; left: 15mm; right: 15mm; text-align: center; font-size: 9px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 4px; }',
  '@page { size: A4; margin: 12mm; }',
  '@media print {',
  '  body { background: #fff; }',
  '  .page { width: auto; min-height: 0; margin: 0; box-shadow: none; padding: 0; page-break-after: always; }',
  '  .page:last-child { page-break-after: auto; }',
  '  .foot { position: static; margin-top: 14px; }',
  '}',
].join('\n');

export function memoPackHtml(memo) {
  const pages = orderMemoPages(memo);
  const tabs = PACK_PAGE_ORDER;
  const body = pages.map((page) => {
    const activeIndex = PACK_PAGE_KEYS.indexOf(page.key);
    const tabBar = '<div class="tabs">' + tabs.map((tab, i) =>
      '<span class="' + (i === activeIndex ? 'on' : '') + '">' + tab.number + '  ' + esc(tab.label) + '</span>'
    ).join('') + '</div>';
    const sections = (page.sections || []).map(htmlSection).join('\n');
    return '<section class="page" id="page-' + page.number + '">'
      + '<div class="doc-head"><span>' + esc(memo?.header || '') + '</span><span>' + esc(memo?.confidentiality || '') + '</span></div>'
      + '<h1>' + esc(page.number + '. ' + page.title) + '</h1>'
      + (page.caption ? '<div class="caption">' + esc(page.caption) + '</div>' : '')
      + tabBar
      + sections
      + '<div class="foot">' + esc(memo?.confidentiality || '') + ' - Page ' + page.number + ' of ' + pages.length + '</div>'
      + '</section>';
  }).join('\n');
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(MEMO_PACK_TITLE) + ' - ' + esc(memo?.header || '') + '</title>'
    + '<style>' + HTML_STYLE + '</style></head><body>'
    + body
    + '</body></html>';
}

// Render the pack in the requested format. Returns { mime, extension, body }.
export function renderMemoPack(memo, format = 'html') {
  const fmt = MEMO_PACK_FORMATS.find((f) => f.key === format) || MEMO_PACK_FORMATS[0];
  const body = fmt.key === 'md' ? memoPackMarkdown(memo) : memoPackHtml(memo);
  return { format: fmt.key, mime: fmt.mime, extension: fmt.extension, body };
}

export default {
  orderMemoPages,
  buildMemoPackManifest,
  packFilenameStem,
  memoPackMarkdown,
  memoPackHtml,
  renderMemoPack,
  MEMO_PACK_VERSION,
  MEMO_PACK_KEY,
  MEMO_PACK_TITLE,
  MEMO_PACK_FORMATS,
  PACK_PAGE_ORDER,
  PACK_PAGE_KEYS,
  MEMO_PACK_MESSAGES,
};
