import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Document text and table extraction (Phase 1: PDF, DOCX, PPTX, scanned PDF and
// images with OCR).
//
// Contract: extractDocument({ buffer, filename, mimetype }) never throws. It
// returns
//   { status, format, text, tables, pages, ocr, notes }
// where status is one of
//   'ok'            text was read from the file itself
//   'ocr'           (part of) the text came from OCR; ocr.confidence says how sure
//   'empty'         the file opened but holds no readable text
//   'unsupported'   the format is not handled here
//   'unreadable'    the file is corrupt, encrypted or too large to read
//   'ocr_unavailable' the file is scanned but OCR could not run
// Nothing is guessed: text that could not be read is simply absent, and the
// status says why. A table is { page|slide|index, rows: string[][] }.
//
// Pure of the database and of the network. OCR loads tesseract.js lazily; its
// language data comes from OCR_LANG_PATH when set (offline / in-region), else the
// package default.
// ---------------------------------------------------------------------------

export const EXTRACT_MAX_BYTES = Number(process.env.EXTRACT_MAX_BYTES || 25 * 1024 * 1024);
export const EXTRACT_MAX_PAGES = Number(process.env.EXTRACT_MAX_PAGES || 60);
export const EXTRACT_MAX_CHARS = 400_000;
export const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 15);
// A PDF page with fewer characters than this has no usable text layer: scanned.
export const OCR_MIN_CHARS_PER_PAGE = 25;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'];
export const EXTRACTABLE_EXTENSIONS = ['.pdf', '.docx', '.pptx', ...IMAGE_EXTENSIONS];

const extOf = (name) => {
  const s = String(name || '').toLowerCase();
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(i) : '';
};

function decodeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

const clean = (s) => String(s || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function result(partial) {
  return {
    status: 'unreadable', format: null, text: '', tables: [], pages: 0,
    ocr: { used: false, confidence: null, pages: 0, lang: null }, notes: [], ...partial,
  };
}

// ----------------------------------------------------------------- DOCX / PPTX

function runsText(xml) {
  // Text runs (<w:t> / <a:t>); tabs and breaks inside a paragraph become spaces.
  let out = '';
  const re = /<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>|<(?:w|a):tab\/>|<(?:w|a):br\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out += m[1] !== undefined ? decodeXml(m[1]) : ' ';
  return out;
}

function paragraphs(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = clean(runsText(m[1]));
    if (t) out.push(t);
  }
  return out;
}

function tablesFrom(xml, { tbl, tr, tc, para }) {
  const tables = [];
  const tblRe = new RegExp(`<${tbl}(?:\\s[^>]*)?>([\\s\\S]*?)</${tbl}>`, 'g');
  let t;
  while ((t = tblRe.exec(xml)) !== null) {
    const rows = [];
    const trRe = new RegExp(`<${tr}(?:\\s[^>]*)?>([\\s\\S]*?)</${tr}>`, 'g');
    let r;
    while ((r = trRe.exec(t[1])) !== null) {
      const cells = [];
      const tcRe = new RegExp(`<${tc}(?:\\s[^>]*)?>([\\s\\S]*?)</${tc}>`, 'g');
      let c;
      while ((c = tcRe.exec(r[1])) !== null) cells.push(paragraphs(c[1], para).join(' '));
      if (cells.some((x) => x !== '')) rows.push(cells);
    }
    if (rows.length) tables.push({ rows });
  }
  return tables;
}

async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) return result({ status: 'unreadable', format: 'docx', notes: ['Not a Word document (word/document.xml is missing).'] });
  const xml = await file.async('string');
  const tables = tablesFrom(xml, { tbl: 'w:tbl', tr: 'w:tr', tc: 'w:tc', para: 'w:p' })
    .map((t, i) => ({ index: i + 1, ...t }));
  // Body text in reading order with table content kept in place as rows.
  const body = xml.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, (m) => {
    const tb = tablesFrom(m, { tbl: 'w:tbl', tr: 'w:tr', tc: 'w:tc', para: 'w:p' })[0];
    return tb ? `<w:p><w:r><w:t>${tb.rows.map((r) => r.join(' | ')).join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>` : '';
  });
  const text = paragraphs(body, 'w:p').join('\n');
  return result({ status: text ? 'ok' : 'empty', format: 'docx', text, tables, pages: 1 });
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x) => x.m).sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!slides.length) return result({ status: 'unreadable', format: 'pptx', notes: ['Not a PowerPoint deck (no slides found).'] });
  const parts = [];
  const tables = [];
  for (const s of slides.slice(0, EXTRACT_MAX_PAGES)) {
    const xml = await zip.file(s.n).async('string');
    const slideNo = Number(s.m[1]);
    const noTables = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, '');
    const lines = paragraphs(noTables, 'a:p');
    for (const tb of tablesFrom(xml, { tbl: 'a:tbl', tr: 'a:tr', tc: 'a:tc', para: 'a:p' })) {
      tables.push({ slide: slideNo, index: tables.length + 1, ...tb });
      lines.push(...tb.rows.map((r) => r.join(' | ')));
    }
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${slideNo}.xml`);
    if (notesFile) {
      const notes = paragraphs(await notesFile.async('string'), 'a:p').filter((l) => !/^\d+$/.test(l));
      if (notes.length) lines.push('Speaker notes: ' + notes.join(' '));
    }
    if (lines.length) parts.push(`[Slide ${slideNo}]\n${lines.join('\n')}`);
  }
  const text = parts.join('\n\n');
  const media = Object.keys(zip.files).some((n) => /^ppt\/media\//.test(n));
  const notes = !text && media ? ['The deck holds only images; its text was not read (image OCR is not run on embedded pictures).'] : [];
  return result({ status: text ? 'ok' : 'empty', format: 'pptx', text, tables, pages: slides.length, notes });
}

// ------------------------------------------------------------------------ OCR

let workerPromise = null;
async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langs = String(process.env.OCR_LANGS || 'eng').split(/[+,]/).map((s) => s.trim()).filter(Boolean);
      // Language data is cached outside the repository (OCR_CACHE_PATH to change it).
      const opts = { cachePath: process.env.OCR_CACHE_PATH || path.join(os.tmpdir(), 'dealforge-ocr') };
      if (process.env.OCR_LANG_PATH) opts.langPath = process.env.OCR_LANG_PATH;
      return createWorker(langs.length > 1 ? langs : langs[0] || 'eng', 1, opts);
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

export async function shutdownOcr() {
  if (!workerPromise) return;
  const p = workerPromise; workerPromise = null;
  try { (await p).terminate(); } catch { /* already gone */ }
}

// Recognise one image. Returns { text, confidence } or throws.
export async function ocrImage(png) {
  const worker = await ocrWorker();
  const { data } = await worker.recognize(Buffer.isBuffer(png) ? png : Buffer.from(png));
  return { text: clean(data.text), confidence: Number.isFinite(data.confidence) ? Math.round(data.confidence) : null };
}

const deps = { ocrImage };
export function setExtractDeps(overrides = {}) { Object.assign(deps, overrides); }

// ------------------------------------------------------------------------ PDF

// Group the text items of one page into rows by baseline, and split a row into
// cells where there is a wide horizontal gap. A row with three or more cells is
// treated as a table row; consecutive such rows form a table.
function pageRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5]; const x = it.transform[4]; const w = it.width || 0;
    const row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (row) row.items.push({ x, w, s: it.str }); else rows.push({ y, items: [{ x, w, s: it.str }] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    const cells = [];
    let cur = null; let prevEnd = null;
    for (const it of sorted) {
      if (cur !== null && prevEnd !== null && it.x - prevEnd > 12) { cells.push(cur.trim()); cur = it.s; }
      else cur = cur === null ? it.s : cur + (prevEnd !== null && it.x - prevEnd > 1 ? ' ' : '') + it.s;
      prevEnd = it.x + it.w;
    }
    if (cur !== null) cells.push(cur.trim());
    return cells.filter((c) => c !== '');
  }).filter((c) => c.length);
}

function tablesFromRows(pageNo, rows) {
  const tables = []; let run = [];
  const flush = () => { if (run.length >= 2) tables.push({ page: pageNo, rows: run }); run = []; };
  for (const cells of rows) { if (cells.length >= 3) run.push(cells); else flush(); }
  flush();
  return tables;
}

async function extractPdf(buffer) {
  const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    const encrypted = /password/i.test(err?.message || '') || err?.name === 'PasswordException';
    return result({ status: 'unreadable', format: 'pdf', notes: [encrypted ? 'The PDF is password-protected and was not read.' : 'The PDF could not be opened (corrupt or not a PDF).'] });
  }
  const total = pdf.numPages;
  const limit = Math.min(total, EXTRACT_MAX_PAGES);
  const pageText = []; const tables = []; const scanned = [];
  for (let p = 1; p <= limit; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = pageRows(content.items);
    const text = rows.map((cells) => cells.join('  ')).join('\n');
    pageText[p] = text;
    tables.push(...tablesFromRows(p, rows));
    if (text.replace(/\s/g, '').length < OCR_MIN_CHARS_PER_PAGE) scanned.push(p);
  }
  const notes = [];
  if (total > limit) notes.push(`Only the first ${limit} of ${total} pages were read.`);
  let ocr = { used: false, confidence: null, pages: 0, lang: null };
  let status = 'ok';
  if (scanned.length) {
    const targets = scanned.slice(0, OCR_MAX_PAGES);
    if (scanned.length > targets.length) notes.push(`${scanned.length} pages have no text layer; OCR was run on the first ${targets.length}.`);
    const confidences = [];
    try {
      for (const p of targets) {
        const png = await renderPageAsImage(pdf, p, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 });
        const out = await deps.ocrImage(png);
        if (out.text) { pageText[p] = out.text; if (out.confidence !== null) confidences.push(out.confidence); }
      }
      ocr = { used: true, confidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null, pages: targets.length, lang: process.env.OCR_LANGS || 'eng' };
      status = 'ocr';
      if (ocr.confidence !== null && ocr.confidence < 60) notes.push(`OCR confidence is low (${ocr.confidence}%); figures read from scanned pages must be checked against the original.`);
    } catch (err) {
      status = 'ocr_unavailable';
      notes.push('Some pages are scanned images and OCR could not run: ' + String(err.message || err).slice(0, 200));
    }
  }
  const text = pageText.filter(Boolean).join('\n\n');
  const anyText = text.replace(/\s/g, '').length > 0;
  if (!anyText && status === 'ok') status = 'empty';
  return result({ status, format: 'pdf', text, tables, pages: total, ocr, notes });
}

async function extractImage(buffer, ext) {
  try {
    const out = await deps.ocrImage(buffer);
    const notes = out.confidence !== null && out.confidence < 60 ? [`OCR confidence is low (${out.confidence}%); check against the original.`] : [];
    return result({ status: out.text ? 'ocr' : 'empty', format: ext.slice(1), text: out.text, pages: 1, ocr: { used: true, confidence: out.confidence, pages: 1, lang: process.env.OCR_LANGS || 'eng' }, notes });
  } catch (err) {
    return result({ status: 'ocr_unavailable', format: ext.slice(1), notes: ['OCR could not run: ' + String(err.message || err).slice(0, 200)] });
  }
}

/** Extract text and tables from one file. Never throws. */
export async function extractDocument({ buffer, filename = '', mimetype = '' } = {}) {
  const ext = extOf(filename);
  try {
    if (!buffer || !buffer.length) return result({ status: 'empty', notes: ['The file is empty.'] });
    if (buffer.length > EXTRACT_MAX_BYTES) return result({ status: 'unreadable', format: ext.slice(1) || null, notes: [`The file is larger than the ${Math.round(EXTRACT_MAX_BYTES / 1048576)} MB read limit.`] });
    let out;
    if (ext === '.pdf' || /pdf/i.test(mimetype)) out = await extractPdf(buffer);
    else if (ext === '.docx') out = await extractDocx(buffer);
    else if (ext === '.pptx') out = await extractPptx(buffer);
    else if (IMAGE_EXTENSIONS.includes(ext)) out = await extractImage(buffer, ext);
    else return result({ status: 'unsupported', format: ext.slice(1) || null, notes: ['This file type is not read for extraction.'] });
    if (out.text.length > EXTRACT_MAX_CHARS) { out.text = out.text.slice(0, EXTRACT_MAX_CHARS); out.notes.push('The text was cut at the read limit.'); }
    return out;
  } catch (err) {
    return result({ status: 'unreadable', format: ext.slice(1) || null, notes: ['The file could not be read: ' + String(err.message || err).slice(0, 200)] });
  }
}

export default { extractDocument, setExtractDeps, shutdownOcr, ocrImage, EXTRACTABLE_EXTENSIONS };
