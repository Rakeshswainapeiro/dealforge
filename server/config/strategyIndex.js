// ---------------------------------------------------------------------------
// Strategy document indexing configuration (W4-02 / BRD ENT-02).
//
// The alignment engine (SCR-02) reasons over the owning entity's strategy
// documents, not just the structured theme row. This module is the pure core:
// it turns an uploaded file (PDF / DOCX / PPTX / plain text) into text, splits
// that text into citable passages and ranks the passages against a query. The
// router (server/strategy.js) owns storage, versioning and the database; this
// module owns the parsing and scoring so both can be unit-tested in isolation.
//
// Extraction is dependency-free: DOCX/PPTX are ZIP containers whose XML we read
// with Node's zlib, and PDF text is recovered from uncompressed and
// FlateDecode content streams on a best-effort basis. When a format cannot be
// indexed the document is still stored and the caller reports the reason — an
// upload never fails because of extraction.
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';

export const STRATEGY_INDEX_VERSION = 'SD-01.1';

// Formats the indexer understands. Anything else is stored but not indexed.
export const STRATEGY_DOC_FORMATS = [
  { ext: '.pdf', label: 'PDF', indexable: true },
  { ext: '.docx', label: 'Word document', indexable: true },
  { ext: '.pptx', label: 'PowerPoint deck', indexable: true },
  { ext: '.txt', label: 'Plain text', indexable: true },
  { ext: '.md', label: 'Markdown', indexable: true },
];

export const STRATEGY_DOC_EXTENSIONS = STRATEGY_DOC_FORMATS.map((f) => f.ext);

// A passage is the unit a rationale cites. Roughly a sentence/paragraph window
// kept small enough to quote and large enough to carry meaning.
export const STRATEGY_PASSAGE_MAX_CHARS = 420;
export const STRATEGY_PASSAGE_MIN_CHARS = 40;
export const STRATEGY_INDEX_MAX_CHARS = 400_000;
export const STRATEGY_CITATION_MAX = 5;

export const STRATEGY_STATUS = ['indexed', 'stored', 'failed'];

export const STRATEGY_MESSAGES = {
  no_profile: 'No published strategy profile is on record for this entity.',
  indexed: 'Strategy document indexed and available to the alignment engine.',
  stored_only: 'Strategy document stored; this format could not be indexed for alignment.',
  unsupported: 'This file type is not one the strategy indexer reads.',
};

function extOf(filename = '') {
  const dot = String(filename).lastIndexOf('.');
  return dot < 0 ? '' : String(filename).slice(dot).toLowerCase();
}

export function isIndexableFormat(filename) {
  const ext = extOf(filename);
  return STRATEGY_DOC_FORMATS.some((f) => f.ext === ext && f.indexable);
}

function decodeEntities(s = '') {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// --- ZIP container reader (DOCX / PPTX) ------------------------------------
//
// Reads the central directory so entries written with a trailing data
// descriptor (sizes withheld in the local header) still resolve correctly.
function readZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = [];
  // End Of Central Directory: signature 0x06054b50, searched from the tail.
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const comp = buf.slice(dataStart, dataStart + entry.compSize);
  try {
    if (entry.method === 0) return comp;
    if (entry.method === 8) return zlib.inflateRawSync(comp);
  } catch {
    return null;
  }
  return null;
}

function xmlToText(xml, { paragraphTag } = {}) {
  let s = String(xml);
  // Mark paragraph boundaries so passages do not run together.
  if (paragraphTag) s = s.replace(new RegExp('</' + paragraphTag + '>', 'g'), '\n');
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  s = s.replace(/<w:br\b[^>]*\/?>/g, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractDocx(buffer) {
  const entries = readZipEntries(buffer);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return { ok: false, reason: 'No word/document.xml in the archive.' };
  const xml = readZipEntry(buffer, doc);
  if (!xml) return { ok: false, reason: 'The document XML could not be decompressed.' };
  const text = xmlToText(xml.toString('utf8'), { paragraphTag: 'w:p' });
  return { ok: Boolean(text), text, reason: text ? null : 'The document carried no readable text.' };
}

function extractPptx(buffer) {
  const entries = readZipEntries(buffer)
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/(\d+)\.xml$/)?.[1] || 0);
      const nb = Number(b.name.match(/(\d+)\.xml$/)?.[1] || 0);
      return na - nb;
    });
  if (!entries.length) return { ok: false, reason: 'No slides were found in the archive.' };
  const parts = [];
  entries.forEach((e, i) => {
    const xml = readZipEntry(buffer, e);
    if (!xml) return;
    const text = xmlToText(xml.toString('utf8'));
    if (text) parts.push('Slide ' + (i + 1) + '\n' + text);
  });
  const text = parts.join('\n\n').trim();
  return { ok: Boolean(text), text, reason: text ? null : 'The slides carried no readable text.' };
}

// --- PDF text recovery -----------------------------------------------------
//
// Best-effort: pull the readable text out of content streams. Content streams
// are either plain or FlateDecode-compressed; text lives in Tj / TJ string
// operands. This is not a layout engine — it recovers quotable sentences, which
// is what the citation step needs.
function pdfStreamsToString(buf) {
  const out = [];
  const marker = Buffer.from('stream');
  let idx = 0;
  while (true) {
    const at = buf.indexOf(marker, idx);
    if (at < 0) break;
    let start = at + marker.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf(Buffer.from('endstream'), start);
    if (end < 0) break;
    const raw = buf.slice(start, end);
    let text = null;
    try { text = zlib.inflateRawSync(raw).toString('latin1'); } catch { text = null; }
    if (!text) {
      const s = raw.toString('latin1');
      if (/BT[\s\S]*ET/.test(s)) text = s;
    }
    if (text) out.push(text);
    idx = end + 9;
  }
  return out.join('\n');
}

function pdfContentToText(content) {
  const pieces = [];
  // Tj and TJ operators carry the visible strings; capture the parenthesised
  // operands, honouring escaped parentheses.
  const re = /\(((?:\\.|[^\\()])*)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1]
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t');
    if (raw.trim()) pieces.push(raw);
  }
  return pieces.join(' ');
}

function extractPdf(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const content = pdfStreamsToString(buf);
  if (!content) return { ok: false, reason: 'No content streams could be read from the PDF.' };
  const text = pdfContentToText(content).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { ok: Boolean(text), text, reason: text ? null : 'The PDF text could not be recovered (it may be scanned images).' };
}

function extractPlain(buffer) {
  const text = (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)).toString('utf8').trim();
  return { ok: Boolean(text), text, reason: text ? null : 'The file was empty.' };
}

// Public: turn a stored file into indexable text. Never throws.
export function extractText({ buffer, filename = '', format } = {}) {
  const ext = (format || extOf(filename)).toLowerCase();
  if (!buffer) return { ok: false, ext, text: null, reason: 'No file content was provided.' };
  try {
    if (ext === '.docx') return { ext, ...extractDocx(buffer) };
    if (ext === '.pptx') return { ext, ...extractPptx(buffer) };
    if (ext === '.pdf') return { ext, ...extractPdf(buffer) };
    if (ext === '.txt' || ext === '.md') return { ext, ...extractPlain(buffer) };
    return { ok: false, ext, text: null, reason: STRATEGY_MESSAGES.unsupported };
  } catch (err) {
    return { ok: false, ext, text: null, reason: 'Extraction failed: ' + err.message };
  }
}

// --- Passage building & ranking --------------------------------------------

// Split text into citable passages. Blank lines break passages first, then long
// paragraphs are windowed on sentence boundaries so no quote is unwieldy.
export function buildPassages(text, { maxChars = STRATEGY_PASSAGE_MAX_CHARS, minChars = STRATEGY_PASSAGE_MIN_CHARS } = {}) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const blocks = clean.split(/\n\s*\n/).flatMap((b) => b.split(/\n/)).map((s) => s.trim()).filter(Boolean);
  const passages = [];
  for (const block of blocks) {
    if (block.length <= maxChars) { if (block.length >= minChars) passages.push(block); continue; }
    const sentences = block.match(/[^.!?]+[.!?]?/g) || [block];
    let window = '';
    for (const s of sentences) {
      if ((window + ' ' + s).trim().length > maxChars && window) { passages.push(window.trim()); window = ''; }
      window = (window + ' ' + s).trim();
    }
    if (window.trim().length >= minChars) passages.push(window.trim());
  }
  return passages;
}

export function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

// Rank passages against a query. Returns the top matches with a score and the
// matched terms, so a rationale can name why a passage was cited. Deterministic:
// ties break on the passage's original position.
export function rankPassages(passages = [], query, { limit = STRATEGY_CITATION_MAX } = {}) {
  const terms = Array.isArray(query) ? query.map((t) => String(t).toLowerCase()) : tokenizeQuery(query);
  const unique = Array.from(new Set(terms));
  if (!unique.length) return [];
  const scored = passages.map((p, index) => {
    const text = typeof p === 'string' ? p : p.text;
    const hay = String(text || '').toLowerCase();
    const matched = unique.filter((t) => hay.includes(t));
    let score = 0;
    for (const t of matched) score += 1 + Math.min(3, hay.split(t).length - 1) * 0.25;
    return {
      index: typeof p === 'string' ? index : (p.index ?? index),
      text,
      score: Number(score.toFixed(3)),
      matched_terms: matched,
      // Carry the source through when the caller passed tagged passages (the
      // strategy corpus attaches document_id / document_name), so a rationale
      // can name the document a passage was quoted from (W3-13).
      document_id: typeof p === 'string' ? null : (p.document_id ?? null),
      document_name: typeof p === 'string' ? null : (p.document_name ?? null),
    };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit);
}

// The single best citation for a query, or null. `source` lets a caller label
// which document a passage came from.
export function bestCitation(passages = [], query) {
  const [top] = rankPassages(passages, query, { limit: 1 });
  return top || null;
}

export default {
  STRATEGY_INDEX_VERSION,
  STRATEGY_DOC_FORMATS,
  STRATEGY_DOC_EXTENSIONS,
  STRATEGY_STATUS,
  STRATEGY_MESSAGES,
  STRATEGY_PASSAGE_MAX_CHARS,
  STRATEGY_PASSAGE_MIN_CHARS,
  STRATEGY_CITATION_MAX,
  isIndexableFormat,
  extractText,
  buildPassages,
  tokenizeQuery,
  rankPassages,
  bestCitation,
};
