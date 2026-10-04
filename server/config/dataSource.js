// ---------------------------------------------------------------------------
// Data-point to source mapping (W5-04 / BRD DOC-05).
//
// Source of truth: the Phase-1 BRD, Documents & Completeness - "Data-point to
// source mapping" accept criterion "Mapping in config; reviewer opens linked
// source".
//
// The mapping is provenance: each memo data point is linked to the artefact or
// captured field it came from, so a reviewer can open the source behind a
// value. It is held in configuration (one link per data point) so an
// administrator can re-point a data point without a code change. Nothing here
// changes a value or blocks a submission.
//
// Pure functions only - no database, no network. See buildSourceMap().
// ---------------------------------------------------------------------------

import {
  DATA_SOURCE_CONFIG_KEY, DATA_SOURCE_VERSION, DATA_SOURCE_DEFAULT_REVISION,
  DATA_SOURCE_VERSION_PREFIX, DATA_SOURCE_TYPES, DATA_SOURCE_TYPE_KEYS,
  DATA_SOURCE_PAGES, DATA_SOURCE_TARGETS, DATA_SOURCE_TARGET_KEYS,
  DATA_SOURCE_MESSAGES,
} from './dataSourceData.js';

export {
  DATA_SOURCE_CONFIG_KEY, DATA_SOURCE_VERSION, DATA_SOURCE_DEFAULT_REVISION,
  DATA_SOURCE_VERSION_PREFIX, DATA_SOURCE_TYPES, DATA_SOURCE_TYPE_KEYS,
  DATA_SOURCE_PAGES, DATA_SOURCE_TARGETS, DATA_SOURCE_TARGET_KEYS,
  DATA_SOURCE_MESSAGES,
};

const TARGET_INDEX = new Map(DATA_SOURCE_TARGETS.map((t) => [t.key, t]));
const PAGE_KEYS = DATA_SOURCE_PAGES.map((p) => p.key);

function targetMeta(key) {
  return TARGET_INDEX.get(key) || { key, label: key, page: 'overview', kind: 'field', ref: null };
}

// The shipped, valid mapping: one link per data point at its default source.
// Deterministic so two calls compare equal.
export function defaultDataSourceConfig() {
  return {
    version: DATA_SOURCE_VERSION,
    revision: DATA_SOURCE_DEFAULT_REVISION,
    source: 'default',
    links: DATA_SOURCE_TARGETS.map((t) => ({
      target: t.key,
      target_label: t.label,
      page: t.page,
      source_type: t.kind,
      source_ref: t.ref,
      note: t.kind === 'document'
        ? 'Taken from the uploaded ' + String(t.ref || '').replace(/_/g, ' ') + ' on the record.'
        : 'Captured directly on the opportunity record.',
    })),
    updated_by: null,
    updated_at: null,
  };
}

// Validate a candidate mapping. Returns { ok, errors } where each error is
// { key, field, message } so the admin editor can point at the offending row.
export function validateDataSourceConfig(config = {}) {
  const errors = [];
  const push = (field, message, key = null) => errors.push({ key, field, message });

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', DATA_SOURCE_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  if (config.links !== undefined && !Array.isArray(config.links)) {
    push('links', 'links must be an array.');
  }
  for (const row of Array.isArray(config.links) ? config.links : []) {
    if (!row || typeof row !== 'object') { push('links', 'Each link must be an object.'); continue; }
    if (!DATA_SOURCE_TARGET_KEYS.includes(row.target)) {
      push('links', DATA_SOURCE_MESSAGES.unknown_target + ' (' + row.target + ')', row.target);
      continue;
    }
    if (row.source_type !== undefined && row.source_type !== null && !DATA_SOURCE_TYPE_KEYS.includes(row.source_type)) {
      push('links', DATA_SOURCE_MESSAGES.unknown_type + ' (' + row.source_type + ')', row.target);
    }
    if (row.page !== undefined && row.page !== null && !PAGE_KEYS.includes(row.page)) {
      push('links', 'Unknown memo page (' + row.page + ')', row.target);
    }
    if (row.source_ref !== undefined && row.source_ref !== null && String(row.source_ref).trim() === '') {
      push('links', 'A source reference is required for ' + row.target + '.', row.target);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Resolve a stored mapping to an effective one, filling any missing data point
// from the shipped default so a partially stored map never loses a link.
export function resolveDataSourceConfig(config = null) {
  const base = defaultDataSourceConfig();
  if (!config || typeof config !== 'object') return base;
  const stored = Array.isArray(config.links) ? config.links : [];
  const byTarget = new Map(stored.filter((r) => r && r.target).map((r) => [r.target, r]));
  const links = base.links.map((row) => {
    const s = byTarget.get(row.target);
    if (!s) return row;
    return {
      ...row,
      source_type: DATA_SOURCE_TYPE_KEYS.includes(s.source_type) ? s.source_type : row.source_type,
      source_ref: s.source_ref !== undefined && s.source_ref !== null && String(s.source_ref).trim() !== ''
        ? String(s.source_ref).trim() : row.source_ref,
      page: PAGE_KEYS.includes(s.page) ? s.page : row.page,
      note: s.note !== undefined && s.note !== null && String(s.note).trim() !== '' ? String(s.note).trim() : row.note,
    };
  });
  return {
    ...base,
    version: config.version || base.version,
    revision: Number.isInteger(config.revision) ? config.revision : base.revision,
    source: config.source || 'stored',
    links,
    updated_by: config.updated_by || null,
    updated_at: config.updated_at || null,
  };
}

// The field-level diff between two mappings, for the audit trail.
export function diffDataSourceConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveDataSourceConfig(before);
  const a = resolveDataSourceConfig(after);
  const bBy = new Map(b.links.map((l) => [l.target, l]));
  for (const row of a.links) {
    const prev = bBy.get(row.target);
    if (!prev) { changes.push({ field: 'link', target: row.target, before: null, after: row.source_ref }); continue; }
    if (prev.source_ref !== row.source_ref) {
      changes.push({ field: 'source_ref', target: row.target, before: prev.source_ref, after: row.source_ref });
    }
    if (prev.source_type !== row.source_type) {
      changes.push({ field: 'source_type', target: row.target, before: prev.source_type, after: row.source_type });
    }
  }
  return changes;
}

// Build the next mapping revision. Mints revision + 1 and the matching SRC-01.N
// version, recording who changed it and when.
export function buildDataSourceConfig(body = {}, { actor = null, base = defaultDataSourceConfig(), at = null } = {}) {
  const resolvedBase = resolveDataSourceConfig(base);
  const linksIn = Array.isArray(body.links) ? body.links : null;
  // Reject an explicitly supplied unknown data point before it is silently
  // dropped, so a typo in the admin editor surfaces as a 400.
  if (linksIn) {
    const unknown = linksIn.filter((r) => r && r.target && !DATA_SOURCE_TARGET_KEYS.includes(r.target));
    if (unknown.length) {
      const e = new Error(DATA_SOURCE_MESSAGES.unknown_target + ' (' + unknown.map((u) => u.target).join(', ') + ')');
      e.status = 400;
      throw e;
    }
  }
  const links = resolvedBase.links.map((row) => {
    if (!linksIn) return row;
    const s = linksIn.find((r) => r && r.target === row.target);
    if (!s) return row;
    return {
      ...row,
      source_type: DATA_SOURCE_TYPE_KEYS.includes(s.source_type) ? s.source_type : row.source_type,
      source_ref: s.source_ref !== undefined && s.source_ref !== null && String(s.source_ref).trim() !== ''
        ? String(s.source_ref).trim() : row.source_ref,
      page: PAGE_KEYS.includes(s.page) ? s.page : row.page,
      note: s.note !== undefined && s.note !== null && String(s.note).trim() !== '' ? String(s.note).trim() : row.note,
    };
  });
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const next = {
    ...resolvedBase,
    version: DATA_SOURCE_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    links,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateDataSourceConfig(next);
  if (!ok) {
    const e = new Error(DATA_SOURCE_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    throw e;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function refLabel(ref) {
  return String(ref || '').replace(/_/g, ' ');
}

// Resolve a single link against the evidence on the record, returning the
// concrete source a reviewer can open. A document link resolves to the current
// submission-document version when it is attached, otherwise it reports the
// source is not yet on the record. A field link resolves to the captured value.
export function resolveLink(link = {}, { documents = [], data = {} } = {}) {
  const type = link.source_type || 'field';
  if (type === 'document') {
    const doc = (documents || []).find((d) => (d.requirement_key || d.key) === link.source_ref);
    if (doc) {
      return {
        ...link,
        resolved: true,
        availability: 'attached',
        source_label: doc.label || refLabel(link.source_ref),
        document_id: doc.id || null,
        version: doc.version ?? null,
        filename: doc.original_name || doc.filename || null,
        url: doc.file_url || null,
        sha256: doc.sha256 || null,
      };
    }
    return { ...link, resolved: false, availability: 'missing', source_label: refLabel(link.source_ref), document_id: null, version: null, filename: null, url: null, sha256: null };
  }
  if (type === 'field') {
    const value = data?.[link.source_ref];
    const present = value !== undefined && value !== null && String(value).trim() !== '';
    return {
      ...link,
      resolved: present,
      availability: present ? 'captured' : 'missing',
      source_label: refLabel(link.source_ref),
      value: present ? value : null,
      document_id: null, version: null, filename: null, url: null, sha256: null,
    };
  }
  // derived / external: provenance is named but has no on-record artefact.
  return { ...link, resolved: true, availability: type, source_label: refLabel(link.source_ref), document_id: null, version: null, filename: null, url: null, sha256: null };
}

// Build the full source map for an opportunity: the effective configuration
// resolved against the record's documents and captured data, grouped by memo
// page in the memo's running order.
export function buildSourceMap({ config = null, documents = [], data = {} } = {}) {
  const resolved = resolveDataSourceConfig(config);
  const links = resolved.links.map((link) => resolveLink(link, { documents, data }));
  const pages = DATA_SOURCE_PAGES.map((p) => ({
    key: p.key,
    label: p.label,
    links: links.filter((l) => l.page === p.key),
  })).filter((p) => p.links.length > 0);
  const missing = links.filter((l) => !l.resolved).map((l) => ({ target: l.target, label: l.target_label, source_ref: l.source_ref }));
  return {
    version: resolved.version,
    revision: resolved.revision,
    source: resolved.source,
    links,
    pages,
    missing,
    disclaimer: DATA_SOURCE_MESSAGES.disclaimer,
  };
}

export default {
  defaultDataSourceConfig, validateDataSourceConfig, resolveDataSourceConfig,
  diffDataSourceConfig, buildDataSourceConfig, resolveLink, buildSourceMap,
};
