// ---------------------------------------------------------------------------
// Sirius memo → DOCX renderer (REQ-MEMO-01).
//
// Turns the structured document produced by server/config/siriusMemo.js into a
// Word file laid out like the source template: one page per template tab, with
// the same titles, tables and the "Sirius International Holding Limited
// |Confidential" footer. This module only renders — it never reads
// opportunity data or re-derives template logic.
// ---------------------------------------------------------------------------

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, ImageRun,
} from 'docx';
import { MEMO_PAGE_TABS } from './config/siriusMemo.js';

const ACCENT = '0E7490';      // teal band
const ACCENT_DARK = '0B4E63'; // deep teal
const HEAD_FILL = 'E6F4F1';
const BAND_FILL = 'EAF7FA';
const BODY = '1F2937';
const MUTED = '6B7280';
const BORDER = 'D0D5DD';
const PLACEHOLDER = '7A8699';

const CONTENT_W = 9020; // ~ A4 with 1" margins, in DXA

const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function run(text, opts = {}) {
  return new TextRun({
    text: text === undefined || text === null ? '' : String(text),
    bold: !!opts.bold,
    italics: !!opts.italics,
    color: opts.color || BODY,
    size: opts.size || 18,
    font: 'Arial',
  });
}

function para(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [run(text, opts)];
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before || 0, after: opts.after === undefined ? 80 : opts.after, line: 264 },
    children: runs,
  });
}

// A paragraph whose text is the template's grey italic placeholder.
function placeholderPara(text) {
  return para([run(text, { italics: true, color: PLACEHOLDER, size: 17 })]);
}

function cell(children, opts = {}) {
  const content = Array.isArray(children) ? children : [children];
  return new TableCell({
    borders: cellBorders,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    columnSpan: opts.columnSpan,
    rowSpan: opts.rowSpan,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: opts.valign || VerticalAlign.CENTER,
    children: content.map((c) => (typeof c === 'string' ? para(c, opts.textOpts || {}) : c)),
  });
}

function headCell(text, width) {
  return cell([para([run(text, { bold: true, color: 'FFFFFF', size: 17 })], { after: 0 })], {
    fill: ACCENT, width, valign: VerticalAlign.CENTER,
  });
}

function tableWith(columns, rows, widths, opts = {}) {
  const total = (widths || []).reduce((a, b) => a + b, 0) || CONTENT_W;
  const headRow = new TableRow({
    tableHeader: true,
    children: columns.map((c) => headCell(c, widths ? Math.round((widths[columns.indexOf(c)] / total) * CONTENT_W) : Math.round(CONTENT_W / columns.length))),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((value, ci) => {
      const w = widths ? Math.round((widths[ci] / total) * CONTENT_W) : Math.round(CONTENT_W / columns.length);
      const isPlaceholder = String(value) === PLACEHOLDER;
      const isNum = ci > 0;
      return cell(
        [para([run(value, {
          size: 17,
          italics: isPlaceholder,
          color: isPlaceholder ? PLACEHOLDER : BODY,
          bold: opts.boldFirstCol && ci === 0,
        })], { after: 0, align: opts.numericFrom != null && ci >= opts.numericFrom ? AlignmentType.RIGHT : AlignmentType.LEFT })],
        { fill: ri % 2 === 1 ? 'FAFCFD' : undefined, width: w }
      );
    }),
  }));
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    layout: 'fixed',
    rows: [headRow, ...bodyRows],
  });
}

function sectionHeading(text) {
  return para([run(text, { bold: true, color: ACCENT_DARK, size: 21 })], { before: 160, after: 70 });
}

function renderSection(section) {
  switch (section.type) {
    case 'fields': {
      return [
        sectionHeading(section.heading),
        tableWith(
          ['Key facts', ''],
          section.rows.map((r) => [r.label, r.value]),
          [30, 70],
          { boldFirstCol: true }
        ),
      ];
    }
    case 'prose': {
      const hasText = section.text && section.text.trim() && section.text.trim() !== '[]';
      return [
        sectionHeading(section.heading),
        hasText ? para(section.text) : placeholderPara(section.placeholder || ''),
      ];
    }
    case 'bullets': {
      const items = section.items || [];
      const out = [sectionHeading(section.heading)];
      for (const item of items) {
        const isPlaceholder = item.text === PLACEHOLDER;
        out.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 50, line: 258 },
          children: [
            item.label ? run(`${item.label}: `, { bold: true, size: 17 }) : run(''),
            run(item.text, { size: 17, italics: isPlaceholder, color: isPlaceholder ? PLACEHOLDER : BODY }),
          ],
        }));
      }
      return out;
    }
    case 'cards': {
      const cells = (section.cards || []).map((c) => cell(
        [para([run(c.title, { bold: true, color: ACCENT_DARK, size: 18 })], { after: 40 }),
         para([run(c.text, { size: 16, italics: c.text === PLACEHOLDER || !c.text, color: c.text === PLACEHOLDER || !c.text ? PLACEHOLDER : BODY })])],
        { fill: BAND_FILL }
      ));
      return [
        section.heading ? sectionHeading(section.heading) : para('', { after: 40 }),
        new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, layout: 'fixed', rows: [new TableRow({ children: cells })] }),
      ];
    }
    case 'table': {
      const out = [];
      if (section.heading) out.push(sectionHeading(section.heading));
      out.push(tableWith(section.columns, section.rows, section.widths, { numericFrom: section.numericFrom }));
      if (section.note) out.push(para([run(section.note, { italics: true, color: MUTED, size: 16 })], { before: 60 }));
      return out;
    }
    case 'finTable': {
      const header = [section.unit_label || 'AED mn', ...section.periods];
      const rows = section.rows.map((r) => [r.label, ...r.values]);
      return [
        sectionHeading(section.heading),
        tableWith(header, rows, [20, ...section.periods.map(() => 10)], { boldFirstCol: true, numericFrom: 1 }),
      ];
    }
    case 'returnsTable': {
      const header = ['Returns', 'Hurdle', 'Base', 'Upside', 'Downside', 'Meets?'];
      const rows = section.rows.map((r) => [r.label, r.hurdle, r.base, r.upside, r.downside, r.meets]);
      return [tableWith(header, rows, [16, 30, 12, 12, 14, 12], { boldFirstCol: true })];
    }
    case 'keyAsks': {
      const cards = (section.cards || []).map((c) => cell(
        [para([run(`${c.number}`, { bold: true, color: 'FFFFFF', size: 18 })], { after: 30 }),
         para([run(c.title, { bold: true, color: 'FFFFFF', size: 17 })], { after: 50 }),
         para([run(c.text, { size: 15, italics: c.text === PLACEHOLDER, color: 'D7EEF5' })])],
        { fill: ACCENT_DARK }
      ));
      return [
        para([run(section.heading, { bold: true, color: 'FFFFFF', size: 18 })], { before: 120, after: 40, shading: { fill: ACCENT, type: ShadingType.CLEAR } }),
        new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, layout: 'fixed', rows: [new TableRow({ children: cards })] }),
      ];
    }
    case 'fundingTables': {
      const srcHeader = ['Funding — sources', 'AED mn', '%', 'Status'];
      const srcRows = section.sourceRows.map((r) => [r.label, r.aed, r.pct, r.status]);
      const useHeader = ['Uses', 'AED mn'];
      const useRows = section.useRows.map((r) => [r.label, r.aed]);
      const LEFT_W = Math.round(CONTENT_W * 0.57);
      const RIGHT_W = Math.round(CONTENT_W * 0.41);
      const leftCols = [0.38, 0.16, 0.11, 0.35].map((f) => Math.round(LEFT_W * f));
      const rightCols = [0.66, 0.34].map((f) => Math.round(RIGHT_W * f));
      const left = new Table({
        width: { size: LEFT_W, type: WidthType.DXA }, layout: 'fixed',
        rows: [
          new TableRow({ tableHeader: true, children: [headCell(srcHeader[0], leftCols[0]), headCell(srcHeader[1], leftCols[1]), headCell(srcHeader[2], leftCols[2]), headCell(srcHeader[3], leftCols[3])] }),
          ...srcRows.map((r, ri) => new TableRow({ children: [
            cell([para([run(r[0], { size: 16, bold: r[0] === 'Total sources' })], { after: 0 })], { fill: r[0] === 'Total sources' ? HEAD_FILL : (ri % 2 ? 'FAFCFD' : undefined), width: leftCols[0] }),
            cell([para([run(r[1], { size: 16, italics: r[1] === PLACEHOLDER, color: r[1] === PLACEHOLDER ? PLACEHOLDER : BODY })], { after: 0, align: AlignmentType.RIGHT })], { fill: r[0] === 'Total sources' ? HEAD_FILL : undefined, width: leftCols[1] }),
            cell([para([run(r[2], { size: 16 })], { after: 0, align: AlignmentType.RIGHT })], { fill: r[0] === 'Total sources' ? HEAD_FILL : undefined, width: leftCols[2] }),
            cell([para([run(r[3], { size: 15, italics: r[3] === PLACEHOLDER, color: r[3] === PLACEHOLDER ? PLACEHOLDER : BODY })], { after: 0 })], { fill: r[0] === 'Total sources' ? HEAD_FILL : undefined, width: leftCols[3] }),
          ] })),
        ],
      });
      const right = new Table({
        width: { size: RIGHT_W, type: WidthType.DXA }, layout: 'fixed',
        rows: [
          new TableRow({ tableHeader: true, children: [headCell(useHeader[0], rightCols[0]), headCell(useHeader[1], rightCols[1])] }),
          ...useRows.map((r, ri) => new TableRow({ children: [
            cell([para([run(r[0], { size: 16, bold: r[0] === 'Total uses' })], { after: 0 })], { fill: r[0] === 'Total uses' ? HEAD_FILL : (ri % 2 ? 'FAFCFD' : undefined), width: rightCols[0] }),
            cell([para([run(r[1], { size: 16, italics: r[1] === PLACEHOLDER, color: r[1] === PLACEHOLDER ? PLACEHOLDER : BODY })], { after: 0, align: AlignmentType.RIGHT })], { fill: r[0] === 'Total uses' ? HEAD_FILL : undefined, width: rightCols[1] }),
          ] })),
        ],
      });
      // Side-by-side via an outer 2-column table.
      return [
        new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, layout: 'fixed', borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
          rows: [new TableRow({ children: [
            new TableCell({ borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, margins: { top: 0, bottom: 0, left: 0, right: 120 }, width: { size: LEFT_W, type: WidthType.DXA }, children: [left] }),
            new TableCell({ borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, width: { size: RIGHT_W, type: WidthType.DXA }, children: [right] }),
          ] })] }),
      ];
    }
    case 'note':
      return [para([run(section.text, { size: 16, color: BODY })], { before: 40, after: 30 })];
    default:
      return [];
  }
}

function pageTabs(activeIndex) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, layout: 'fixed',
    rows: [new TableRow({
      children: MEMO_PAGE_TABS.map((tab, i) => cell(
        [para([run(`${tab.number}  ${tab.label}`, { bold: i === activeIndex, size: 14, color: i === activeIndex ? 'FFFFFF' : '475569' })], { after: 0, align: AlignmentType.CENTER })],
        { fill: i === activeIndex ? ACCENT_DARK : BAND_FILL }
      )),
    })],
  });
}

function titleBlock(title, caption, headerLine, activeIndex) {
  return [
    para([run(title, { bold: true, color: ACCENT_DARK, size: 30 })], { after: 40 }),
    para([run('', {})], { after: 0 }),
    pageTabs(activeIndex),
    para([run(caption, { italics: true, color: MUTED, size: 15 })], { before: 80, after: 20 }),
  ];
}

// The footer carries the confidentiality line, the page number and - when the
// caller supplies one - the QR verification image (W7-05 / OUT-03). The QR ties
// the printed copy back to the record version + hash it was generated from.
function footerChildren(memo, verification) {
  const line = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      run('Sirius International Holding Limited |Confidential        ', { size: 14, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUTED, font: 'Arial' }),
    ],
  });
  if (!verification || !verification.qr) return [line];
  const qrParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 0 },
    children: [
      new ImageRun({ data: verification.qr, transformation: { width: 58, height: 58 }, type: 'png' }),
    ],
  });
  const caption = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [run('Scan to verify  ' + (verification.version || '') + '  ' + String(verification.hash || '').slice(0, 12), { size: 12, color: MUTED })],
  });
  return [qrParagraph, caption, line];
}

function renderDocument(memo, verification) {
  const children = [];
  memo.pages.forEach((page, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...titleBlock(page.title, page.caption, memo.header, i));
    children.push(...page.sections.flatMap(renderSection));
  });

  const doc = new Document({
    creator: 'DealForge',
    title: `${memo.subsidiary || 'Opportunity'} — Investment Memo`,
    description: memo.source,
    sections: [{
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
      },
      headers: {
        default: new Header({ children: [para([run(memo.header, { size: 15, color: MUTED })], { after: 0, align: AlignmentType.RIGHT })] }),
      },
      footers: {
        default: new Footer({ children: footerChildren(memo, verification) }),
      },
      children,
    }],
  });
  return doc;
}

// Build the DOCX document (returns a docx Document, not yet packed) so tests
// can inspect it. packSiriusMemo() packs it to a Buffer.
export function buildSiriusMemoDocx(memo, verification) {
  return renderDocument(memo, verification);
}

// Pack the document to a Buffer for the HTTP response.
export async function packSiriusMemo(memo, verification) {
  return Packer.toBuffer(renderDocument(memo, verification));
}

export default { packSiriusMemo, buildSiriusMemoDocx };
