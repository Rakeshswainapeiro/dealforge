// ---------------------------------------------------------------------------
// Data-room folder link vocabulary + validation (W8-04 / BRD INTG-01).
//
// Source of truth: the Phase-1 BRD, Integration - "Virtual data room
// integration" with the accept criterion "folder link stored on record".
//
// DealForge does not host deal documents: the secure room (Coneshare and the
// mainstream file stores Sirius uses) stays the system of record for documents.
// What the opportunity record needs is the durable pointer to the folder a
// screening works from - so a reviewer opens the live room in one click, and
// the retained record explains which room the evidence came from.
//
// This module holds the provider vocabulary and the pure validation / shaping
// helpers. The route that persists the link lives in server/pipeline.js.
// ---------------------------------------------------------------------------

export const DATAROOM_LINK_VERSION = 'INTG-01.1';

// Recognised providers, matched on the link host. 'generic' covers any other
// https folder URL (an internal share, a self-hosted room) so the feature is not
// locked to a single vendor.
export const DATAROOM_PROVIDERS = [
  { key: 'coneshare', label: 'Coneshare', hosts: ['coneshare.com'] },
  { key: 'sharepoint', label: 'SharePoint', hosts: ['sharepoint.com'] },
  { key: 'onedrive', label: 'OneDrive', hosts: ['onedrive.live.com', '1drv.ms'] },
  { key: 'google_drive', label: 'Google Drive', hosts: ['drive.google.com', 'docs.google.com'] },
  { key: 'box', label: 'Box', hosts: ['box.com', 'app.box.com'] },
  { key: 'dropbox', label: 'Dropbox', hosts: ['dropbox.com'] },
  { key: 'generic', label: 'Other', hosts: [] },
];
export const DATAROOM_PROVIDER_KEYS = DATAROOM_PROVIDERS.map((p) => p.key);

// Policy: a folder link is an external pointer, so it must be an https URL.
// http is accepted only when the deployment explicitly relaxes the policy
// (e.g. an on-premise room reachable over the internal network).
export const DATAROOM_LINK_POLICY = {
  require_https: true,
  require_host: true,
  max_length: 2048,
};

export const DATAROOM_LINK_MESSAGES = {
  invalid_url: 'The data-room link must be a valid absolute URL.',
  https_required: 'The data-room link must use https.',
  host_required: 'The data-room link must include a host.',
  too_long: 'The data-room link is longer than the maximum allowed length.',
  scope_note:
    'The data room stays the system of record for documents; the opportunity holds a '
    + 'link to the folder a screening works from. Setting or clearing the link is audited.',
};

// Identify the provider behind a link by its host, falling back to 'generic'.
export function providerForUrl(rawUrl) {
  let host = '';
  try { host = new URL(String(rawUrl || '')).hostname.toLowerCase(); } catch { return DATAROOM_PROVIDERS[DATAROOM_PROVIDERS.length - 1]; }
  for (const p of DATAROOM_PROVIDERS) {
    if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) return p;
  }
  return DATAROOM_PROVIDERS[DATAROOM_PROVIDERS.length - 1];
}

// Parse + validate. Returns { ok, url, provider, errors }.
export function validateDataroomLink(rawUrl, { policy = DATAROOM_LINK_POLICY } = {}) {
  const errors = [];
  const value = String(rawUrl == null ? '' : rawUrl).trim();
  if (!value) return { ok: false, url: null, provider: null, errors: [DATAROOM_LINK_MESSAGES.invalid_url] };
  if (value.length > policy.max_length) errors.push(DATAROOM_LINK_MESSAGES.too_long);

  let parsed = null;
  try { parsed = new URL(value); } catch { errors.push(DATAROOM_LINK_MESSAGES.invalid_url); }
  if (parsed) {
    if (!parsed.hostname && policy.require_host) errors.push(DATAROOM_LINK_MESSAGES.host_required);
    if (policy.require_https && parsed.protocol !== 'https:') errors.push(DATAROOM_LINK_MESSAGES.https_required);
    if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(DATAROOM_LINK_MESSAGES.invalid_url);
  }
  const ok = errors.length === 0;
  return {
    ok,
    url: ok ? value : null,
    provider: ok ? providerForUrl(value).key : null,
    errors,
  };
}

// The stored shape written onto the opportunity record. Kept flat and explicit
// so a reader never has to re-derive the provider or the label.
export function buildDataroomLinkRecord(input = {}, { actor = null, at = new Date().toISOString() } = {}) {
  const check = validateDataroomLink(input.url);
  if (!check.ok) return { ok: false, errors: check.errors };
  const provider = providerForUrl(check.url);
  const label = String(input.label || '').trim() || provider.label + ' folder';
  return {
    ok: true,
    record: {
      dataroom_folder_url: check.url,
      dataroom_folder_label: label,
      dataroom_provider: provider.key,
      dataroom_provider_label: provider.label,
      dataroom_link_version: DATAROOM_LINK_VERSION,
      dataroom_linked_at: at,
      dataroom_linked_by: actor?.email || null,
    },
  };
}

// A short human description for the board / audit trail.
export function describeDataroomLink(data = {}) {
  const url = data.dataroom_folder_url;
  if (!url) return null;
  return {
    url,
    label: data.dataroom_folder_label || null,
    provider: data.dataroom_provider || providerForUrl(url).key,
    provider_label: data.dataroom_provider_label || providerForUrl(url).label,
  };
}

export default {
  DATAROOM_LINK_VERSION, DATAROOM_PROVIDERS, DATAROOM_PROVIDER_KEYS,
  DATAROOM_LINK_POLICY, DATAROOM_LINK_MESSAGES,
  providerForUrl, validateDataroomLink, buildDataroomLinkRecord, describeDataroomLink,
};
