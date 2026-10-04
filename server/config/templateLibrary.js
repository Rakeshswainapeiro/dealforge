// ---------------------------------------------------------------------------
// Document template library configuration (W5-05 / DOC-06).
//
// Source of truth: the Phase-1 BRD, Documents & Completeness - "Document
// templates" with accept criterion "Current versions downloadable,
// Investment-Team maintained".
//
// The catalogue itself (which templates exist) is code, because each one has a
// renderer. What lives in configuration is the maintained metadata an
// administrator can tune without a deploy: the label, the owner and the
// description shown on the download screen, plus a per-template availability
// flag. Reads fall back to the shipped default so nothing changes until an
// administrator edits it.
//
// Pure functions only - no database, no network. The HTTP route lives in
// server/templates.js; the renderers in templateDocx.js / templateCsv.js.
// ---------------------------------------------------------------------------

import {
  TEMPLATE_LIBRARY_CONFIG_KEY, TEMPLATE_LIBRARY_VERSION, TEMPLATE_LIBRARY_DEFAULT_REVISION,
  TEMPLATE_LIBRARY_VERSION_PREFIX, TEMPLATE_LIBRARY_OWNER, TEMPLATE_LIBRARY,
  TEMPLATE_LIBRARY_IDS, RISK_REGISTER_COLUMNS, GATE_CHECKLIST_COLUMNS,
  TEMPLATE_LIBRARY_MESSAGES, findTemplate,
} from './templateLibraryData.js';

export {
  TEMPLATE_LIBRARY_CONFIG_KEY, TEMPLATE_LIBRARY_VERSION, TEMPLATE_LIBRARY_DEFAULT_REVISION,
  TEMPLATE_LIBRARY_VERSION_PREFIX, TEMPLATE_LIBRARY_OWNER, TEMPLATE_LIBRARY,
  TEMPLATE_LIBRARY_IDS, RISK_REGISTER_COLUMNS, GATE_CHECKLIST_COLUMNS,
  TEMPLATE_LIBRARY_MESSAGES, findTemplate,
};

// A stored AppSettings value can arrive as an object or as the JSON string the
// writer persisted. Normalise both before resolving.
function coerce(config) {
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

// The shipped, valid library: one entry per template at its default owner,
// label and description, every template enabled. Deterministic so two calls
// compare equal.
export function defaultTemplateLibraryConfig() {
  return {
    version: TEMPLATE_LIBRARY_VERSION,
    revision: TEMPLATE_LIBRARY_DEFAULT_REVISION,
    source: 'default',
    templates: TEMPLATE_LIBRARY.map((t) => ({
      id: t.id,
      label: t.label,
      category: t.category,
      format: t.format,
      filename: t.filename,
      description: t.description,
      owner: t.owner,
      enabled: true,
    })),
    updated_by: null,
    updated_at: null,
  };
}

// Validate a candidate library. Returns { ok, errors } where each error is
// { key, field, message } so the admin editor can point at the offending row.
export function validateTemplateLibraryConfig(config = {}) {
  const errors = [];
  const push = (field, message, key = null) => errors.push({ key, field, message });

  config = coerce(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    push('config', TEMPLATE_LIBRARY_MESSAGES.config_invalid);
    return { ok: false, errors };
  }
  if (config.templates !== undefined && !Array.isArray(config.templates)) {
    push('templates', 'templates must be an array.');
  }
  for (const row of Array.isArray(config.templates) ? config.templates : []) {
    if (!row || typeof row !== 'object') { push('templates', 'Each template must be an object.'); continue; }
    if (!TEMPLATE_LIBRARY_IDS.includes(row.id)) {
      push('templates', TEMPLATE_LIBRARY_MESSAGES.unknown_template + ' (' + row.id + ')', row.id);
      continue;
    }
    if (row.label !== undefined && String(row.label).trim() === '') {
      push('templates', 'A label is required for ' + row.id + '.', row.id);
    }
    if (row.owner !== undefined && String(row.owner).trim() === '') {
      push('templates', 'An owner is required for ' + row.id + '.', row.id);
    }
    if (row.enabled !== undefined && typeof row.enabled !== 'boolean') {
      push('templates', 'enabled must be true or false for ' + row.id + '.', row.id);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Resolve a stored library to an effective one, filling any template the store
// omits from the shipped default so a partial store never loses a template.
export function resolveTemplateLibraryConfig(config = null) {
  const base = defaultTemplateLibraryConfig();
  config = coerce(config);
  if (!config || typeof config !== 'object') return base;
  const stored = Array.isArray(config.templates) ? config.templates : [];
  const byId = new Map(stored.filter((r) => r && r.id).map((r) => [r.id, r]));
  const templates = base.templates.map((row) => {
    const s = byId.get(row.id);
    if (!s) return row;
    return {
      ...row,
      label: s.label !== undefined && String(s.label).trim() !== '' ? String(s.label).trim() : row.label,
      description: s.description !== undefined && String(s.description).trim() !== '' ? String(s.description).trim() : row.description,
      owner: s.owner !== undefined && String(s.owner).trim() !== '' ? String(s.owner).trim() : row.owner,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : row.enabled,
    };
  });
  return {
    ...base,
    version: config.version || base.version,
    revision: Number.isInteger(config.revision) ? config.revision : base.revision,
    source: config.source || 'stored',
    templates,
    updated_by: config.updated_by || null,
    updated_at: config.updated_at || null,
  };
}

// The field-level diff between two libraries, for the audit trail.
export function diffTemplateLibraryConfig(before = {}, after = {}) {
  const changes = [];
  const b = resolveTemplateLibraryConfig(before);
  const a = resolveTemplateLibraryConfig(after);
  const bById = new Map(b.templates.map((t) => [t.id, t]));
  for (const row of a.templates) {
    const prev = bById.get(row.id);
    if (!prev) { changes.push({ field: 'template', id: row.id, before: null, after: row.label }); continue; }
    for (const field of ['label', 'description', 'owner', 'enabled']) {
      if (prev[field] !== row[field]) {
        changes.push({ field, id: row.id, before: prev[field], after: row[field] });
      }
    }
  }
  return changes;
}

// Build the next library revision. Mints revision + 1 and the matching TPL-01.N
// version, recording who changed it and when.
export function buildTemplateLibraryConfig(body = {}, { actor = null, base = defaultTemplateLibraryConfig(), at = null } = {}) {
  body = coerce(body) || {};
  const resolvedBase = resolveTemplateLibraryConfig(base);
  const rowsIn = Array.isArray(body.templates) ? body.templates : null;
  if (rowsIn) {
    const unknown = rowsIn.filter((r) => r && r.id && !TEMPLATE_LIBRARY_IDS.includes(r.id));
    if (unknown.length) {
      const e = new Error(TEMPLATE_LIBRARY_MESSAGES.unknown_template + ' (' + unknown.map((u) => u.id).join(', ') + ')');
      e.status = 400;
      throw e;
    }
  }
  const templates = resolvedBase.templates.map((row) => {
    if (!rowsIn) return row;
    const s = rowsIn.find((r) => r && r.id === row.id);
    if (!s) return row;
    return {
      ...row,
      label: s.label !== undefined && String(s.label).trim() !== '' ? String(s.label).trim() : row.label,
      description: s.description !== undefined && String(s.description).trim() !== '' ? String(s.description).trim() : row.description,
      owner: s.owner !== undefined && String(s.owner).trim() !== '' ? String(s.owner).trim() : row.owner,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : row.enabled,
    };
  });
  const revision = (Number.isInteger(resolvedBase.revision) ? resolvedBase.revision : 0) + 1;
  const next = {
    ...resolvedBase,
    version: TEMPLATE_LIBRARY_VERSION_PREFIX + revision,
    revision,
    source: 'stored',
    templates,
    updated_by: actor?.email || actor?.id || null,
    updated_at: at || new Date().toISOString(),
  };
  const { ok, errors } = validateTemplateLibraryConfig(next);
  if (!ok) {
    const e = new Error(TEMPLATE_LIBRARY_MESSAGES.config_invalid + ' ' + errors.map((x) => x.message).join(' '));
    e.status = 400;
    throw e;
  }
  return next;
}

// The effective catalogue for the download screen: the maintained metadata
// joined to the renderer's static facts (format, filename, category), each with
// its resolved download URL. Only enabled templates are listed.
export function templateCatalogue(config = null, { basePath = '/api/templates' } = {}) {
  const resolved = resolveTemplateLibraryConfig(config);
  return resolved.templates
    .filter((row) => row.enabled !== false)
    .map((row) => {
      const meta = findTemplate(row.id) || {};
      return {
        id: row.id,
        label: row.label,
        description: row.description,
        category: row.category,
        format: row.format,
        filename: row.filename || meta.filename,
        owner: row.owner,
        enabled: row.enabled !== false,
        version: resolved.version,
        // Provenance of the maintained metadata, so the screen can show whether
        // the row is still the shipped default or has been re-pointed.
        maintained: resolved.source === 'stored',
        download_url: basePath + '/' + row.id + '/download',
      };
    });
}

export default {
  defaultTemplateLibraryConfig, validateTemplateLibraryConfig,
  resolveTemplateLibraryConfig, diffTemplateLibraryConfig,
  buildTemplateLibraryConfig, templateCatalogue,
  TEMPLATE_LIBRARY_CONFIG_KEY, TEMPLATE_LIBRARY_VERSION,
};
