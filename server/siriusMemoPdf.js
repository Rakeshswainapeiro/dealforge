import QRCode from 'qrcode';
import { MEMO_PAGE_TABS } from './config/siriusMemo.js';

// ---------------------------------------------------------------------------
// Sirius memo -> PDF renderer (BRD v2 OUT-01, OUT-03).
//
// Renders the same structured memo the Word export uses into a PDF, without a
// headless browser or a native dependency: A4 pages, Helvetica, the page tabs,
// tables with wrapped cells, the confidentiality footer with page numbers and
// the scan-to-verify QR code drawn as vector squares. It only renders; it never
// reads opportunity data.
// ---------------------------------------------------------------------------

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 80;
const BOTTOM = MARGIN + FOOTER_H;

const COLORS = {
  accent: [0.055, 0.455, 0.565], dark: [0.043, 0.306, 0.388], body: [0.12, 0.16, 0.22],
  muted: [0.42, 0.45, 0.5], border: [0.82, 0.84, 0.87], head: [0.9, 0.957, 0.945], band: [0.918, 0.969, 0.98], white: [1, 1, 1],
};

// Helvetica advance widths (per 1000 em) for ASCII 32..126; others use 556.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const textWidth = (s, size, bold = false) => {
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? HELV[c - 32] : 556) * (bold ? 1.06 : 1); }
  return (w / 1000) * size;
};

// WinAnsi-safe text: common typographic characters mapped, the rest replaced.
const MAP = { '\u2014': '-', '\u2013': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2022': '-', '\u2026': '...',
  '\u2265': '>=', '\u2264': '<=', '\u2192': '->', '\u00a0': ' ', '\u2212': '-', '\u2713': 'Yes', '\u2717': 'No' };
export function pdfSafe(text) {
  return String(text ?? '').replace(/[\u0080-\uffff]/g, (c) => (MAP[c] !== undefined ? MAP[c] : (c.charCodeAt(0) <= 0xff ? c : '?')));
}
const esc = (t) => pdfSafe(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n\t]+/g, ' ');

function wrap(text, size, width, bold) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (textWidth(next, size, bold) <= width || !line) { line = next; } else { lines.push(line); line = w; }
    while (textWidth(line, size, bold) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && textWidth(line.slice(0, cut), size, bold) > width) cut -= 1;
      lines.push(line.slice(0, cut)); line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

class Writer {
  constructor(memo, verification) {
    this.memo = memo; this.verification = verification; this.pages = []; this.newPage();
  }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = PAGE_H - MARGIN - 14; }
  color(c, fill = true) { this.ops.push(`${c.join(' ')} ${fill ? 'rg' : 'RG'}`); }
  text(x, y, s, { size = 9, bold = false, color = COLORS.body } = {}) {
    this.color(color);
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);
  }
  rect(x, y, w, h, { fill = null, stroke = null } = {}) {
    if (fill) this.color(fill);
    if (stroke) { this.color(stroke, false); this.ops.push('0.5 w'); }
    this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  ensure(h) { if (this.y - h < BOTTOM) this.newPage(); }
  para(s, { size = 9, bold = false, color = COLORS.body, gap = 4, indent = 0 } = {}) {
    for (const line of wrap(s, size, CONTENT_W - indent, bold)) {
      this.ensure(size + 3);
      this.text(MARGIN + indent, this.y, line, { size, bold, color });
      this.y -= size + 3;
    }
    this.y -= gap;
  }
  heading(s) { if (!s) return; this.y -= 4; this.ensure(24); this.para(s, { size: 11, bold: true, color: COLORS.dark, gap: 3 }); }
  table(header, rows, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * CONTENT_W);
    const draw = (cells, { head = false, zebra = false } = {}) => {
      const size = head ? 8 : 8;
      const wrapped = cells.map((c, i) => wrap(c, size, widths[i] - 8, head));
      const h = Math.max(...wrapped.map((l) => l.length)) * (size + 2) + 8;
      this.ensure(h);
      let x = MARGIN;
      cells.forEach((_, i) => {
        this.rect(x, this.y - h + 6, widths[i], h, { fill: head ? COLORS.accent : zebra ? [0.98, 0.99, 0.99] : null, stroke: COLORS.border });
        wrapped[i].forEach((line, j) => this.text(x + 4, this.y - 4 - j * (size + 2), line, { size, bold: head, color: head ? COLORS.white : COLORS.body }));
        x += widths[i];
      });
      this.y -= h;
    };
    if (header) draw(header, { head: true });
    rows.forEach((r, i) => draw(r.map((v) => (v === undefined || v === null ? '' : String(v))), { zebra: i % 2 === 1 }));
    this.y -= 8;
  }
  tabs(active) {
    const w = CONTENT_W / MEMO_PAGE_TABS.length;
    MEMO_PAGE_TABS.forEach((tab, i) => {
      this.rect(MARGIN + i * w, this.y - 6, w, 16, { fill: i === active ? COLORS.dark : COLORS.band });
      const label = `${tab.number}  ${tab.label}`;
      const lw = textWidth(label, 7, i === active);
      this.text(MARGIN + i * w + Math.max(2, (w - lw) / 2), this.y, label, { size: 7, bold: i === active, color: i === active ? COLORS.white : [0.28, 0.33, 0.41] });
    });
    this.y -= 24;
  }
  section(s) {
    switch (s.type) {
      case 'fields':
        this.heading(s.heading); this.table(null, (s.rows || []).map((r) => [r.label, r.value]), [35, 65]); break;
      case 'prose':
        this.heading(s.heading); this.para(s.text || s.placeholder || '', { color: s.text ? COLORS.body : COLORS.muted }); break;
      case 'bullets':
        this.heading(s.heading);
        for (const it of s.items || []) this.para('- ' + (it.label ? it.label + ': ' : '') + (it.text || ''), { indent: 6, gap: 1 });
        this.y -= 4; break;
      case 'cards':
      case 'keyAsks':
        this.heading(s.heading);
        for (const c of s.cards || []) this.para((c.number ? c.number + '. ' : '') + (c.title ? c.title + ': ' : '') + (c.text || ''), { gap: 2 });
        this.y -= 4; break;
      case 'table':
        this.heading(s.heading); this.table(s.columns, s.rows || [], s.widths || (s.columns || []).map(() => 1)); break;
      case 'finTable':
        this.heading(s.heading);
        this.table([s.unit_label || 'AED mn', ...s.periods], (s.rows || []).map((r) => [r.label, ...r.values]), [20, ...s.periods.map(() => 10)]); break;
      case 'returnsTable':
        this.table(['Returns', 'Hurdle', 'Base', 'Upside', 'Downside', 'Meets?'], (s.rows || []).map((r) => [r.label, r.hurdle, r.base, r.upside, r.downside, r.meets]), [16, 30, 12, 12, 14, 12]); break;
      case 'fundingTables':
        this.table(['Sources', 'AED mn', '%', 'Status'], (s.sourceRows || []).map((r) => [r.label, r.aed, r.pct, r.status]), [34, 16, 12, 38]);
        this.table(['Uses', 'AED mn'], (s.useRows || []).map((r) => [r.label, r.aed]), [70, 30]); break;
      case 'note':
        this.para(s.text, { size: 8, color: COLORS.muted }); break;
      default: break;
    }
  }
}

function qrOps(url, x, y, size) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  const ops = [`${COLORS.body.join(' ')} rg`];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.modules.get(r, c)) ops.push(`${(x + c * cell).toFixed(2)} ${(y + size - (r + 1) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
    }
  }
  return ops;
}

/** Render the memo to a PDF Buffer. */
export function renderSiriusMemoPdf(memo, verification = null) {
  const w = new Writer(memo, verification);
  memo.pages.forEach((page, i) => {
    if (i > 0) w.newPage();
    w.text(PAGE_W - MARGIN - textWidth(pdfSafe(memo.header || ''), 7), PAGE_H - 24, memo.header || '', { size: 7, color: COLORS.muted });
    w.para(page.title, { size: 15, bold: true, color: COLORS.dark, gap: 6 });
    w.tabs(i);
    if (page.caption) w.para(page.caption, { size: 7.5, color: COLORS.muted, gap: 6 });
    for (const s of page.sections || []) w.section(s);
  });

  const total = w.pages.length;
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  w.pages.forEach((ops, i) => {
    const footer = [];
    const line = `Sirius International Holding Limited | Confidential        ${i + 1} / ${total}`;
    footer.push(`${COLORS.muted.join(' ')} rg BT /F1 7 Tf ${((PAGE_W - textWidth(line, 7)) / 2).toFixed(2)} 22 Td (${esc(line)}) Tj ET`);
    if (verification?.url) {
      footer.push(...qrOps(verification.url, (PAGE_W - 46) / 2, 40, 46));
      const cap = 'Scan to verify  ' + (verification.version || '') + '  ' + String(verification.hash || '').slice(0, 12);
      footer.push(`${COLORS.muted.join(' ')} rg BT /F1 6 Tf ${((PAGE_W - textWidth(cap, 6)) / 2).toFixed(2)} 32 Td (${esc(cap)}) Tj ET`);
    }
    const stream = [...ops, ...footer].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc((memo.subsidiary || 'Opportunity') + ' - Investment Memo')}) /Producer (DealForge) >>`);

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export default { renderSiriusMemoPdf, pdfSafe };
