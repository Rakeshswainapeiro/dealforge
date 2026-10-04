// ---------------------------------------------------------------------------
// Minimal XLSX reader (W8-05 import), the read counterpart of server/xlsx.js.
//
// The bulk-import row (INTG-03) arrives as the Sirius tracker workbook, so we
// need to read a single-sheet .xlsx without adding a spreadsheet dependency.
// This pulls xl/worksheets/sheet1.xml out of the zip, reads the shared-strings
// table, and returns a row/cell matrix. It handles inline strings, shared
// strings and numbers - enough for a tracker export, not a full Excel engine.
// ---------------------------------------------------------------------------

import JSZip from 'jszip';

function decodeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'").replace(/&#xA;/gi, '\n')
    .replace(/&amp;/g, '&');
}

function colToIndex(ref) {
  const letters = String(ref || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    let text = '';
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(inner)) !== null) text += decodeXml(tm[1]);
    out.push(text);
  }
  return out;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const cells = [];
    const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cRe.exec(rm[1])) !== null) {
      const attrs = cm[1] || cm[3] || '';
      const body = cm[2] || '';
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/);
      const idx = refMatch ? colToIndex(refMatch[1]) : cells.length;
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : 'n';
      let value = '';
      if (type === 'inlineStr') {
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tRe.exec(body)) !== null) value += decodeXml(tm[1]);
      } else {
        const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vMatch ? decodeXml(vMatch[1]) : '';
        value = type === 's' ? (shared[Number(raw)] ?? '') : raw;
      }
      cells[idx] = value;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// Read a .xlsx buffer into a matrix of strings. Uses the first worksheet.
export async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheetFile = zip.file('xl/worksheets/sheet1.xml');
  if (!sheetFile) throw new Error('Unsupported workbook: no xl/worksheets/sheet1.xml');
  const sheetXml = await sheetFile.async('string');
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const shared = sharedFile ? parseSharedStrings(await sharedFile.async('string')) : [];
  const rows = parseSheet(sheetXml, shared);
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export default { readXlsx };
