// Unit tests for the strategy document indexer (W4-02 / ENT-02). Pure parsing
// and ranking; no server or database required.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  STRATEGY_INDEX_VERSION, STRATEGY_DOC_FORMATS, STRATEGY_STATUS,
  isIndexableFormat, extractText, buildPassages, tokenizeQuery, rankPassages, bestCitation,
} from '../config/strategyIndex.js';

// Build a minimal DOCX/PPTX-shaped ZIP with one stored (method 0) entry.
function zipStore(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // method 0 = stored
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localRec = Buffer.concat([local, nameBuf, data]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralRec = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRec.length, 12);
  eocd.writeUInt32LE(localRec.length, 16);
  return Buffer.concat([localRec, centralRec, eocd]);
}

describe('strategy index configuration', () => {
  test('declares the version, formats and statuses', () => {
    assert.equal(STRATEGY_INDEX_VERSION, 'SD-01.1');
    assert.ok(STRATEGY_DOC_FORMATS.some((f) => f.ext === '.pdf'));
    assert.ok(STRATEGY_DOC_FORMATS.some((f) => f.ext === '.docx'));
    assert.ok(STRATEGY_DOC_FORMATS.some((f) => f.ext === '.pptx'));
    assert.deepEqual([...STRATEGY_STATUS].sort(), ['failed', 'indexed', 'stored']);
  });

  test('knows which formats it can index', () => {
    assert.equal(isIndexableFormat('mandate.pdf'), true);
    assert.equal(isIndexableFormat('deck.PPTX'), true);
    assert.equal(isIndexableFormat('image.jpeg'), false);
  });
});

describe('text extraction', () => {
  test('extracts text from a DOCX container', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Sirius invests in technology platforms.</w:t></w:r></w:p><w:p><w:r><w:t>Geography: UAE and GCC.</w:t></w:r></w:p></w:body></w:document>';
    const buf = zipStore('word/document.xml', xml);
    const out = extractText({ buffer: buf, filename: 'mandate.docx' });
    assert.equal(out.ok, true);
    assert.match(out.text, /technology platforms/);
    assert.match(out.text, /UAE and GCC/);
  });

  test('extracts text from a PPTX deck slide by slide', () => {
    const slideXml = '<p:sld><p:cSld><a:t>Financial services focus</a:t></p:cSld></p:sld>';
    const zip = zipStore('ppt/slides/slide1.xml', slideXml);
    const out = extractText({ buffer: zip, filename: 'deck.pptx' });
    assert.equal(out.ok, true);
    assert.match(out.text, /Financial services focus/);
    assert.match(out.text, /Slide 1/);
  });

  test('recovers text from a plain PDF content stream', () => {
    const content = 'BT /F1 12 Tf (Sirius mandate: technology and healthcare.) Tj ET';
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n%%EOF', 'latin1');
    const out = extractText({ buffer: pdf, filename: 'mandate.pdf' });
    assert.equal(out.ok, true);
    assert.match(out.text, /Sirius mandate/);
  });

  test('recovers text from a FlateDecode PDF content stream', () => {
    const content = 'BT (Flate encoded strategy text.) Tj ET';
    const comp = zlib.deflateRawSync(Buffer.from(content, 'latin1'));
    const head = Buffer.from('%PDF-1.4\nstream\n', 'latin1');
    const tail = Buffer.from('\nendstream\n%%EOF', 'latin1');
    const pdf = Buffer.concat([head, comp, tail]);
    const out = extractText({ buffer: pdf, filename: 'mandate.pdf' });
    assert.equal(out.ok, true);
    assert.match(out.text, /Flate encoded strategy/);
  });

  test('a non-indexable format is reported, not thrown', () => {
    const out = extractText({ buffer: Buffer.from([0xff, 0xd8, 0xff]), filename: 'photo.jpeg' });
    assert.equal(out.ok, false);
    assert.ok(out.reason);
  });
});

describe('passage building', () => {
  test('splits long text into bounded passages', () => {
    const para = ('We target technology platforms with recurring revenue in the UAE. ').repeat(20);
    const passages = buildPassages(para);
    assert.ok(passages.length > 1);
    for (const p of passages) assert.ok(p.length <= 420, 'passage within the cap');
  });

  test('drops fragments below the minimum length', () => {
    assert.deepEqual(buildPassages('hi'), []);
  });
});

describe('passage ranking', () => {
  const passages = [
    'Sirius invests in technology platforms and digital businesses across the UAE.',
    'The financial services mandate covers payments, lending and fintech.',
    'Healthcare and medical clusters are a priority for the group.',
  ];

  test('tokenises a query into meaningful terms', () => {
    assert.deepEqual(tokenizeQuery('Technology, UAE?'), ['technology', 'uae']);
  });

  test('ranks the passage that matches the query terms first', () => {
    const ranked = rankPassages(passages, 'technology UAE');
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].index, 0);
    assert.deepEqual(ranked[0].matched_terms.sort(), ['technology', 'uae']);
  });

  test('an empty query returns no citations', () => {
    assert.deepEqual(rankPassages(passages, ''), []);
  });

  test('bestCitation returns the single strongest passage', () => {
    const c = bestCitation(passages, 'payments lending');
    assert.ok(c);
    assert.equal(c.index, 1);
  });
});

