// ---------------------------------------------------------------------------
// Data-room folder link unit tests (W8-04 / BRD INTG-01).
//
//   node --test server/tests/dataroomLink.test.js
//
// Pure module: provider detection, policy enforcement and the stored record
// shape. No server is needed.
// ---------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  providerForUrl, validateDataroomLink, buildDataroomLinkRecord,
  describeDataroomLink, DATAROOM_PROVIDER_KEYS, DATAROOM_LINK_VERSION,
} from '../config/dataroomLink.js';

describe('data-room provider detection (INTG-01)', () => {
  test('recognises the mainstream providers by host', () => {
    assert.equal(providerForUrl('https://app.coneshare.com/s/abc').key, 'coneshare');
    assert.equal(providerForUrl('https://sirius.sharepoint.com/sites/deal').key, 'sharepoint');
    assert.equal(providerForUrl('https://drive.google.com/drive/folders/x').key, 'google_drive');
    assert.equal(providerForUrl('https://sirius.box.com/f/1').key, 'box');
  });

  test('falls back to generic for an unknown or unparseable host', () => {
    assert.equal(providerForUrl('https://rooms.internal.example/folder').key, 'generic');
    assert.equal(providerForUrl('not a url').key, 'generic');
    assert.ok(DATAROOM_PROVIDER_KEYS.includes('generic'));
  });
});

describe('data-room link validation (INTG-01)', () => {
  test('accepts an https folder link and names its provider', () => {
    const r = validateDataroomLink('https://app.coneshare.com/s/abc');
    assert.equal(r.ok, true);
    assert.equal(r.provider, 'coneshare');
    assert.equal(r.url, 'https://app.coneshare.com/s/abc');
  });

  test('rejects http links and invalid URLs', () => {
    assert.equal(validateDataroomLink('http://app.coneshare.com/s/abc').ok, false);
    assert.match(validateDataroomLink('http://x.com').errors.join(' '), /https/i);
    assert.equal(validateDataroomLink('not a url').ok, false);
    assert.equal(validateDataroomLink('').ok, false);
  });

  test('rejects a link longer than the policy maximum', () => {
    const long = 'https://app.coneshare.com/' + 'x'.repeat(3000);
    assert.equal(validateDataroomLink(long).ok, false);
  });

  test('honours a relaxed https policy', () => {
    const r = validateDataroomLink('http://rooms.internal/x', { policy: { require_https: false, require_host: true, max_length: 2048 } });
    assert.equal(r.ok, true);
  });
});

describe('data-room stored record (INTG-01)', () => {
  test('builds a flat, self-describing record with the actor', () => {
    const built = buildDataroomLinkRecord(
      { url: 'https://sirius.sharepoint.com/sites/diligence', label: 'Diligence room' },
      { actor: { email: 'admin@dealforge.local' }, at: '2026-02-01T09:00:00.000Z' }
    );
    assert.equal(built.ok, true);
    const r = built.record;
    assert.equal(r.dataroom_folder_url, 'https://sirius.sharepoint.com/sites/diligence');
    assert.equal(r.dataroom_folder_label, 'Diligence room');
    assert.equal(r.dataroom_provider, 'sharepoint');
    assert.equal(r.dataroom_provider_label, 'SharePoint');
    assert.equal(r.dataroom_link_version, DATAROOM_LINK_VERSION);
    assert.equal(r.dataroom_linked_at, '2026-02-01T09:00:00.000Z');
    assert.equal(r.dataroom_linked_by, 'admin@dealforge.local');
  });

  test('defaults the label to the provider name', () => {
    const built = buildDataroomLinkRecord({ url: 'https://app.coneshare.com/s/abc' });
    assert.equal(built.record.dataroom_folder_label, 'Coneshare folder');
  });

  test('refuses to build a record from an invalid link', () => {
    assert.equal(buildDataroomLinkRecord({ url: 'http://x' }).ok, false);
  });

  test('describeDataroomLink returns null when no link is stored', () => {
    assert.equal(describeDataroomLink({}), null);
    assert.equal(describeDataroomLink({ opportunity_name: 'X' }), null);
    const d = describeDataroomLink({ dataroom_folder_url: 'https://app.coneshare.com/s/abc' });
    assert.equal(d.provider, 'coneshare');
    assert.equal(d.url, 'https://app.coneshare.com/s/abc');
  });
});
