// Upload content checks (DOC-02). Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentMismatch } from '../security.js';

test('the bytes must match the extension', () => {
  assert.equal(contentMismatch(Buffer.from('%PDF-1.7 x'), 'a.pdf'), null);
  assert.match(contentMismatch(Buffer.from('hello'), 'a.pdf'), /not a valid PDF/);
  assert.equal(contentMismatch(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]), 'a.xlsx'), null);
  assert.match(contentMismatch(Buffer.from('plain'), 'a.docx'), /DOCX/);
});
test('executables never pass, whatever the name', () => {
  assert.match(contentMismatch(Buffer.from('MZ\x90\x00'), 'notes.txt'), /executable/);
  assert.match(contentMismatch(Buffer.from('#!/bin/sh\nrm -rf /'), 'data.csv'), /executable/);
});
test('text types reject binary and HTML', () => {
  assert.equal(contentMismatch(Buffer.from('a,b\n1,2\n'), 'x.csv'), null);
  assert.match(contentMismatch(Buffer.from([0x61, 0x00, 0x62]), 'x.txt'), /binary/);
  assert.match(contentMismatch(Buffer.from('  <!DOCTYPE html><script>1</script>'), 'x.txt'), /HTML/);
  assert.match(contentMismatch(Buffer.from(''), 'x.txt'), /empty/);
});
