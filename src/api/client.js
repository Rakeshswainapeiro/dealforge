// DealForge client facade.
//
// One stable surface for entity data, auth and integrations, so feature code
// does not care where data lives:
// - entities.*  -> server API, with browser localStorage as the offline fallback
// - auth.*      -> the current user (session-backed once auth lands)
// - integrations.Core.* -> calls the local Express backend (/api/integrations/*)
// - appLogs.*   -> no-op
//
// Intentionally shaped as a single client object so that every existing
// `import { api } from "@/api/client"` keeps working unchanged.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const ENTITY_PREFIX = 'dealforge.entity.';
const USER_KEY = 'dealforge.user';
const ORG_KEY = 'dealforge.org';

// Postgres-backed entities are the source of truth (REQ-ARCH-01/02). The
// localStorage implementation below is only an offline/dev fallback used when
// the server is unreachable.
let serverAvailable = null;

function orgHeader() {
  try {
    return readRaw(ORG_KEY) || '';
  } catch {
    return '';
  }
}

function actorHeaders() {
  const user = getStoredUser();
  const headers = {};
  if (user?.id) headers['x-user-id'] = user.id;
  if (user?.email) headers['x-user-email'] = user.email;
  const org = orgHeader();
  if (org) headers['x-org-id'] = org;
  return headers;
}

async function serverFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...actorHeaders(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return response.json();
}

async function checkServer() {
  if (serverAvailable !== null) return serverAvailable;
  try {
    await serverFetch('/api/org/me');
    serverAvailable = true;
  } catch {
    serverAvailable = false;
  }
  return serverAvailable;
}

const DEFAULT_USER = {
  id: 'local-user',
  email: 'admin@dealforge.local',
  full_name: 'Local Admin',
  role: 'admin',
  organization: 'DealForge Local',
  department: 'M&A',
  groups: [],
};

const hasStorage = typeof window !== 'undefined' && !!window.localStorage;

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function readRaw(key) {
  if (!hasStorage) return null;
  return window.localStorage.getItem(key);
}

function writeRaw(key, value) {
  if (!hasStorage) return;
  window.localStorage.setItem(key, value);
}

function allEntityNames() {
  if (!hasStorage) return [];
  const names = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(ENTITY_PREFIX)) names.push(key.slice(ENTITY_PREFIX.length));
  }
  return names;
}

function readStore(name) {
  try {
    const parsed = JSON.parse(readRaw(ENTITY_PREFIX + name) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(name, rows) {
  writeRaw(ENTITY_PREFIX + name, JSON.stringify(rows));
}

function getStoredUser() {
  const raw = readRaw(USER_KEY);
  if (!raw) {
    writeRaw(USER_KEY, JSON.stringify(DEFAULT_USER));
    return { ...DEFAULT_USER };
  }
  try {
    return { ...DEFAULT_USER, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_USER };
  }
}

function sortRows(rows, sort) {
  if (!sort || typeof sort !== 'string') return rows;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => {
    if (Array.isArray(value)) return value.includes(row[key]);
    if (value && typeof value === 'object' && value.$in) return value.$in.includes(row[key]);
    return row[key] === value;
  });
}

function makeEntityApi(name) {
  return {
    async list(sort, limit) {
      if (await checkServer()) {
        try {
          const params = new URLSearchParams();
          if (sort) params.set('sort', sort);
          if (typeof limit === 'number') params.set('limit', String(limit));
          const qs = params.toString();
          return await serverFetch(`/api/entities/${name}${qs ? `?${qs}` : ''}`);
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      let rows = readStore(name);
      rows = sortRows(rows, sort);
      if (typeof limit === 'number') rows = rows.slice(0, limit);
      return rows;
    },

    async filter(query = {}, sort, limit) {
      if (await checkServer()) {
        try {
          const params = new URLSearchParams();
          if (Object.keys(query).length) params.set('filter', JSON.stringify(query));
          if (sort) params.set('sort', sort);
          if (typeof limit === 'number') params.set('limit', String(limit));
          const qs = params.toString();
          return await serverFetch(`/api/entities/${name}${qs ? `?${qs}` : ''}`);
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      let rows = readStore(name).filter((row) => matches(row, query));
      rows = sortRows(rows, sort);
      if (typeof limit === 'number') rows = rows.slice(0, limit);
      return rows;
    },

    async get(id) {
      if (await checkServer()) {
        try {
          return await serverFetch(`/api/entities/${name}/${encodeURIComponent(id)}`);
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      return readStore(name).find((row) => row.id === id) || null;
    },

    async create(data) {
      if (await checkServer()) {
        try {
          return await serverFetch(`/api/entities/${name}`, { method: 'POST', body: JSON.stringify(data) });
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      const rows = readStore(name);
      const row = {
        id: uuid(),
        created_date: nowIso(),
        updated_date: nowIso(),
        created_by: getStoredUser().email,
        ...data,
      };
      rows.push(row);
      writeStore(name, rows);
      return row;
    },

    async bulkCreate(items = []) {
      if (await checkServer()) {
        try {
          return await serverFetch(`/api/entities/${name}`, { method: 'POST', body: JSON.stringify(items) });
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      const rows = readStore(name);
      const created = items.map((data) => ({
        id: uuid(),
        created_date: nowIso(),
        updated_date: nowIso(),
        created_by: getStoredUser().email,
        ...data,
      }));
      writeStore(name, rows.concat(created));
      return created;
    },

    async update(id, data) {
      if (await checkServer()) {
        try {
          return await serverFetch(`/api/entities/${name}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
          });
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      const rows = readStore(name);
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`${name} with id "${id}" was not found`);
      rows[index] = { ...rows[index], ...data, id, updated_date: nowIso() };
      writeStore(name, rows);
      return rows[index];
    },

    async delete(id) {
      if (await checkServer()) {
        try {
          return await serverFetch(`/api/entities/${name}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch (err) {
          if (err.status && err.status < 500) throw err;
          serverAvailable = false;
        }
      }
      const rows = readStore(name);
      writeStore(name, rows.filter((row) => row.id !== id));
      return { id };
    },
  };
}

const entityCache = {};

const entities = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      if (!entityCache[name]) entityCache[name] = makeEntityApi(name);
      return entityCache[name];
    },
  }
);

const features = {
  async get() {
    return serverFetch('/api/features').catch((err) => { if (err.status === 401) return null; throw err; });
  },
  async save(overrides) {
    return serverFetch('/api/features', { method: 'PUT', body: JSON.stringify({ features: overrides }) });
  },
};

const auth = {

  // Public, unauthenticated app configuration (feature flags, app name).
  async publicSettings() {
    try {
      const res = await fetch(API_BASE + '/api/auth/public-settings');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  // Resolve the current session-backed actor. Returns null when there is no
  // valid Better Auth session, so the UI can gate on a real login.
  async me() {
    if (!(await this.isAuthenticated())) return null;
    try {
      const identity = await serverFetch('/api/org/me');
      const local = getStoredUser();
      const merged = {
        ...local,
        id: identity.id,
        email: identity.email,
        full_name: identity.full_name,
        organization: identity.org_name,
        role: identity.roles?.[0] || local.role,
        roles: identity.roles || [],
        groups: identity.groups || [],
        can_sign: identity.can_sign,
        org_id: identity.org_id,
        memberships: identity.memberships || [],
      };
      if (merged.email && merged.email !== local.email) writeRaw(USER_KEY, JSON.stringify(merged));
      return merged;
    } catch {
      return null;
    }
  },

  // True when a real Better Auth session cookie is present (same-origin).
  async isAuthenticated() {
    try {
      const res = await fetch(API_BASE + '/api/auth/get-session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      return !!(data && data.session && data.user);
    } catch {
      return false;
    }
  },

  async updateMe(data = {}) {
    const updated = { ...getStoredUser(), ...data };
    writeRaw(USER_KEY, JSON.stringify(updated));
    return updated;
  },

  // Sign in via Better Auth email+password. Returns the session user, or
  // throws with the server's error message on invalid credentials.
  async login(email, password) {
    const res = await fetch(API_BASE + '/api/auth/sign-in/email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data?.message || data?.error || 'Sign-in failed');
      error.status = res.status;
      throw error;
    }
    if (data.user) {
      writeRaw(USER_KEY, JSON.stringify({
        ...getStoredUser(),
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.name,
        role: 'admin',
      }));
    }
    return data.user || null;
  },

  async logout() {
    try {
      await fetch(API_BASE + '/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch { /* best-effort; clear locally regardless */ }
    writeRaw(USER_KEY, JSON.stringify(DEFAULT_USER));
    return true;
  },

  // Sign in via an SSO provider resolved from the email domain. Returns the
  // provider authorization URL the browser should be redirected to.
  async loginWithSso(email, callbackURL = '/') {
    const res = await fetch(API_BASE + '/api/auth/sign-in/sso', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email, callbackURL }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data?.message || data?.error || 'Single sign-on is not available for this account');
      error.status = res.status;
      throw error;
    }
    return data?.url || null;
  },

  redirectToLogin() {
    return true;
  },
};

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}/api/integrations${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach the DealForge backend at ${API_BASE || window.location.origin}. ` +
        `Is the server running? (${err.message})`
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const Core = {
  InvokeLLM(params) {
    return postJson('/invoke-llm', params);
  },

  async UploadFile({ file }) {
    if (!file) throw new Error('No file provided to UploadFile');
    const formData = new FormData();
    formData.append('file', file);
    let response;
    try {
      response = await fetch(`${API_BASE}/api/integrations/upload-file`, {
        method: 'POST',
        body: formData,
      });
    } catch (err) {
      throw new Error(
        `Cannot reach the DealForge backend at ${API_BASE || window.location.origin}. ` +
          `Is the server running? (${err.message})`
      );
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Upload failed with status ${response.status}`);
    return data;
  },

  ExtractDataFromUploadedFile(params) {
    return postJson('/extract-data', params);
  },

  SendEmail(params) {
    return postJson('/send-email', params);
  },

  SendSMS(params) {
    return postJson('/send-sms', params);
  },

  GenerateImage(params) {
    return postJson('/generate-image', params);
  },
};

const appLogs = {
  async logUserInApp() {
    return { status: 'ok' };
  },
};

// ---------------------------------------------------------------------------
// Capture + document gate (E3/E4). Thin wrappers over /api/gate so feature
// code never hand-rolls "what is missing" logic — the server is the gatekeeper.
// ---------------------------------------------------------------------------
const gate = {
  requirements(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/gate/requirements${qs}`);
  },

  saveRequirement(payload) {
    return serverFetch('/api/gate/requirements', { method: 'POST', body: JSON.stringify(payload) });
  },

  status(opportunityId) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/status`);
  },

  // The six-section capture model (INT-06). Read from configuration so the
  // form, the completeness gate and the memo cannot drift apart.
  fields() {
    return serverFetch('/api/gate/fields');
  },

  // Pre-form self-screen (W1-01 / INT-02). Server evaluates the six answers
  // against the floor/appetite rules and returns the decision + stop reasons.
  selfScreen(answers, { opportunityId, orgId } = {}) {
    return serverFetch('/api/gate/self-screen', {
      method: 'POST',
      body: JSON.stringify({ ...answers, opportunity_id: opportunityId || undefined, org_id: orgId || undefined }),
    });
  },

  documents(opportunityId) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/documents`);
  },

  // CEO + CFO attestation gate (W1-06 / INT-09). Records one named attestation
  // for the acting user; the server captures person, timestamp and IP.
  attest(opportunityId, key) {
    return serverFetch(
      `/api/gate/opportunities/${encodeURIComponent(opportunityId)}/attestations/${encodeURIComponent(key)}`,
      { method: 'POST' }
    );
  },

  async uploadDocument(opportunityId, requirementKey, file) {
    const formData = new FormData();
    formData.append('requirement_key', requirementKey);
    formData.append('file', file);
    const response = await fetch(
      `${API_BASE}/api/gate/opportunities/${encodeURIComponent(opportunityId)}/documents`,
      { method: 'POST', headers: actorHeaders(), body: formData }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || `Upload failed with status ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  },

  deleteDocument(documentId) {
    return serverFetch(`/api/gate/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  },

  submit(opportunityId) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/submit`, { method: 'POST' });
  },

  // Gate 1 hard-filter reviewer decision (W3-02 / SCR-03). The system recommends
  // decline; the reviewer confirms or overrides with a written reason.
  reviewHardFilter(opportunityId, decision, reason) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/hard-filter-review`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
  },

  // Gate 1 soft-filter reviewer decision (W3-03 / SCR-04). The system proposes a
  // 1-5 score for each soft filter; the reviewer confirms or adjusts the set and
  // every score carries a written rationale. Scored, never used to kill a deal.
  reviewSoftFilter(opportunityId, { decision, scores, rationales, overallRationale }) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/soft-filter-review`, {
      method: 'POST',
      body: JSON.stringify({ decision, scores, rationales, overall_rationale: overallRationale }),
    });
  },

  // Automatic disqualifier clear (W3-04 / SCR-05). The system raises a named
  // flag; a reviewer clears one or more flags, each with a named reviewer and a
  // reason. A flag is never cleared on the system's own initiative.
  reviewDisqualifiers(opportunityId, clears) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/disqualifier-review`, {
      method: 'POST',
      body: JSON.stringify({ clears }),
    });
  },

  // Gate 2 weighted scorecard (W3-05 / SCO-02). Seven 1-5 criteria with weights
  // summing to 100%; the weighted total clears a 3.5 pass bar.
  scoreScorecard(opportunityId, { scores, notes, comments }) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/scorecard`, {
      method: 'POST',
      body: JSON.stringify({ scores, notes, comments }),
    });
  },

  // Gate 2 CIO override memo (W3-05 / SCO-02): a below-bar total needs a named
  // CIO and a written reason to proceed to Gate 3.
  overrideScorecard(opportunityId, { by, reason }) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/scorecard-override`, {
      method: 'POST',
      body: JSON.stringify({ by, reason }),
    });
  },

  // Gate 2 scorecard configuration admin (W3-08 / SCO-05): inspect the
  // effective criteria/weights/thresholds and publish a new revision.
  scorecardConfig() {
    return serverFetch('/api/gate/scorecard-config');
  },
  saveScorecardConfig(config) {
    return serverFetch('/api/gate/scorecard-config', { method: 'PUT', body: JSON.stringify(config) });
  },

  // Pre-screening quality-score config admin (W3-09 / SCO-01).
  qualityScoreConfig() {
    return serverFetch('/api/gate/quality-score-config');
  },
  saveQualityScoreConfig(config) {
    return serverFetch('/api/gate/quality-score-config', { method: 'PUT', body: JSON.stringify(config) });
  },

  // Portfolio register (W4-01 / ENT-04): the versioned register of existing
  // portfolio companies behind the advisory synergy and conflict checks.
  portfolioRegister() {
    return serverFetch('/api/portfolio-register');
  },
  savePortfolioRegister(config) {
    return serverFetch('/api/portfolio-register', { method: 'PUT', body: JSON.stringify(config) });
  },
  importPortfolioRegister(csv) {
    return serverFetch('/api/portfolio-register/import', { method: 'POST', body: JSON.stringify({ csv }) });
  },
  portfolioRegisterTemplateUrl() {
    return '/api/portfolio-register/template.csv';
  },

  // Sirius group mandate (W4-04 / ENT-03): the versioned, admin-editable group
  // mandate behind screening - sectors, geography, stage, instruments, ticket
  // and the 1bn-people objective.
  mandate() {
    return serverFetch('/api/mandate');
  },
  saveMandate(config) {
    return serverFetch('/api/mandate', { method: 'PUT', body: JSON.stringify(config) });
  },
  mandateHistory() {
    return serverFetch('/api/mandate/history');
  },

  // Document checklist (W5-01 / DOC-01): the type / stage / flag-driven
  // checklist behind the document gate - per-item tier (mandatory, conditional,
  // optional) and applicability rule, admin-editable with a revision per save.
  checklist() {
    return serverFetch('/api/checklist');
  },
  saveChecklist(config) {
    return serverFetch('/api/checklist', { method: 'PUT', body: JSON.stringify(config) });
  },
  checklistHistory() {
    return serverFetch('/api/checklist/history');
  },

  // Document upload policy (W5-02 / DOC-02): the size cap, the accepted-type
  // allow-list and the upload virus-scan settings, admin-editable with a
  // revision per save.
  documentPolicy() {
    return serverFetch('/api/document-policy');
  },
  saveDocumentPolicy(config) {
    return serverFetch('/api/document-policy', { method: 'PUT', body: JSON.stringify(config) });
  },
  documentPolicyHistory() {
    return serverFetch('/api/document-policy/history');
  },

  // Content sufficiency check (W5-03 / DOC-04): the advisory rule set that
  // flags thin content, the effective configuration, and the reviewer override
  // with its written reason.
  sufficiency(opportunityId) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/sufficiency`);
  },
  overrideSufficiency(opportunityId, { key, by, reason }) {
    return serverFetch(`/api/gate/opportunities/${encodeURIComponent(opportunityId)}/sufficiency-override`, {
      method: 'POST',
      body: JSON.stringify({ key, by, reason }),
    });
  },
  sufficiencyConfig() {
    return serverFetch('/api/sufficiency');
  },
  saveSufficiencyConfig(config) {
    return serverFetch('/api/sufficiency', { method: 'PUT', body: JSON.stringify(config) });
  },
  sufficiencyHistory() {
    return serverFetch('/api/sufficiency/history');
  },

  // Data-point to source mapping (W5-04 / DOC-05): the config-held provenance
  // links behind each memo data point, so a reviewer can open the source.
  dataSources() {
    return serverFetch('/api/data-sources');
  },
  saveDataSources(config) {
    return serverFetch('/api/data-sources', { method: 'PUT', body: JSON.stringify(config) });
  },
  dataSourceHistory() {
    return serverFetch('/api/data-sources/history');
  },

  // Document template library (W5-05 / DOC-06): the Investment-Team maintained
  // standard templates, each downloadable in its current version.
  templates() {
    return serverFetch('/api/templates');
  },
  saveTemplates(config) {
    return serverFetch('/api/templates', { method: 'PUT', body: JSON.stringify(config) });
  },
  templateHistory() {
    return serverFetch('/api/templates/history');
  },
  // Downloads a template's current version (docx or csv). Uses the same actor
  // headers as serverFetch so the request is scoped to the signed-in user.
  async downloadTemplate(id) {
    const path = '/api/templates/' + encodeURIComponent(id) + '/download';
    const response = await fetch(API_BASE + path, { headers: actorHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data?.error || 'Template download failed (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : id;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { filename };
  },

  // Decision reason codes (W6-01 / WF-05): the maintained catalogue of reason
  // codes attached to approve / return / decline / withdraw decisions.
  decisionReasons() {
    return serverFetch('/api/decision-reasons');
  },
  saveDecisionReasons(config) {
    return serverFetch('/api/decision-reasons', { method: 'PUT', body: JSON.stringify(config) });
  },
  decisionReasonHistory() {
    return serverFetch('/api/decision-reasons/history');
  },

  // Delegation of Authority (W6-02 / WF-08): the Gate-1 ticket-band matrix,
  // its resolution for a ticket size and the applied authority on a record.
  doa() {
    return serverFetch('/api/doa');
  },
  saveDoa(config) {
    return serverFetch('/api/doa', { method: 'PUT', body: JSON.stringify(config) });
  },
  doaHistory() {
    return serverFetch('/api/doa/history');
  },
  resolveDoa(amountAed, roles) {
    return serverFetch('/api/doa/resolve', {
      method: 'POST',
      body: JSON.stringify({ amount_aed: amountAed, roles }),
    });
  },
  opportunityDoa(opportunityId) {
    return serverFetch(`/api/doa/opportunities/${encodeURIComponent(opportunityId)}`);
  },
};

// ---------------------------------------------------------------------------
// Investment themes & mandate alignment (E5). The server owns scoring; the UI
// ---------------------------------------------------------------------------
// Organisation tree (E2.1). Thin wrappers over /api/org so pages can offer an
// org selector without reimplementing the tree.
// ---------------------------------------------------------------------------
const org = {
  me() {
    return serverFetch('/api/org/me');
  },

  organizations(params = {}) {
    const qs = new URLSearchParams();
    if (params.parent_id) qs.set('parent_id', params.parent_id);
    if (params.type) qs.set('type', params.type);
    if (params.tree) qs.set('tree', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/org/organizations${suffix}`);
  },
};

// Entity & strategy library (W4-02/W4-03/W4-04, ENT-01/ENT-02/ENT-03). Strategy
// documents are uploaded and indexed server-side into citable passages; the
// structured profile is versioned and the group mandate stays admin-editable.
// ---------------------------------------------------------------------------
const strategy = {
  config() {
    return serverFetch('/api/strategy/config');
  },

  documents(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/strategy/documents${qs}`);
  },

  async uploadDocument(orgId, file) {
    const formData = new FormData();
    if (orgId) formData.append('org_id', orgId);
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/api/strategy/documents`, {
      method: 'POST', headers: actorHeaders(), body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Upload failed with status ${response.status}`);
    return data;
  },

  reindexDocument(id) {
    return serverFetch(`/api/strategy/documents/${encodeURIComponent(id)}/reindex`, { method: 'POST' });
  },

  deleteDocument(id) {
    return serverFetch(`/api/strategy/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  search(orgId, q) {
    const qs = new URLSearchParams();
    if (orgId) qs.set('org_id', orgId);
    if (q) qs.set('q', q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/strategy/search${suffix}`);
  },

  profile(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/strategy/profile${qs}`);
  },

  publishProfile(payload) {
    return serverFetch('/api/strategy/profile', { method: 'POST', body: JSON.stringify(payload) });
  },
};

// ---------------------------------------------------------------------------
// Investment themes & mandate alignment (E5). The server owns scoring; the UI
// only renders the flag, strength, reasons and non-blocking signals.
// ---------------------------------------------------------------------------
const themes = {
  get(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/themes${qs}`);
  },

  save(payload) {
    return serverFetch('/api/themes', { method: 'PUT', body: JSON.stringify(payload) });
  },

  saveThresholds(payload) {
    return serverFetch('/api/themes/thresholds', { method: 'PUT', body: JSON.stringify(payload) });
  },

  alignment(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/alignment`);
  },

  recordException(opportunityId, reason) {
    return serverFetch(`/api/themes/exceptions/${encodeURIComponent(opportunityId)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};

// ---------------------------------------------------------------------------
// Screening pipeline & board (E6). All scoping, aging and SLA flags come from
// the server so the board cannot disagree with the state machine.
// ---------------------------------------------------------------------------
const pipeline = {
  states() {
    return serverFetch('/api/pipeline/states');
  },

  board(owner) {
    return serverFetch('/api/pipeline/board' + (owner && owner !== 'all' ? `?owner=${encodeURIComponent(owner)}` : ''));
  },

  awaitingMyReview() {
    return serverFetch('/api/pipeline/awaiting-my-review');
  },

  myOpportunities(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/pipeline/my-opportunities${qs}`);
  },

  rollup(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/pipeline/rollup${qs}`);
  },

  alignment(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/alignment`);
  },

  // The single screening panel (W3-01 / SCR-01). The server composes the whole
  // initial screen (eligibility, hard filters, hurdles, alignment, synergy &
  // conflict, completeness) into one payload; the UI renders it verbatim.
  screening(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/screening`);
  },

  transitions(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/transitions`);
  },

  // Data-room folder link (W8-04 / BRD INTG-01). The opportunity holds a link
  // to the folder a screening works from; the room stays the system of record.
  dataroomProviders() {
    return serverFetch('/api/pipeline/dataroom-providers');
  },

  dataroomLink(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/dataroom-link`);
  },

  setDataroomLink(opportunityId, payload) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/dataroom-link`, {
      method: 'PUT',
      body: JSON.stringify(payload || {}),
    });
  },

  clearDataroomLink(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/dataroom-link`, {
      method: 'DELETE',
    });
  },

  transition(opportunityId, state, options = {}) {
    // Accept either a plain comment string (legacy) or an options object.
    const opts = typeof options === 'string' ? { comment: options } : (options || {});
    const { comment, reasonCode, reasonText, question } = opts;
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/transition`, {
      method: 'POST',
      body: JSON.stringify({ state, comment, reason_code: reasonCode, reason_text: reasonText, question }),
    });
  },

  // Sirius investment memo (REQ-MEMO-01). The server owns the template and
  // assembly; the client only fetches the structured model or the Word file.
  memo(opportunityId) {
    return serverFetch(`/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/memo`);
  },

  // Downloads the memo as .docx. Uses the same actor headers as serverFetch so
  // the request is scoped to the signed-in user's organisations.
  async downloadMemo(opportunityId) {
    const response = await fetch(
      `${API_BASE}/api/pipeline/opportunities/${encodeURIComponent(opportunityId)}/memo.docx`,
      { headers: actorHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data?.error || `Memo download failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : `Sirius_Memo_${opportunityId}.docx`;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { filename };
  },
};


// ---------------------------------------------------------------------------
// Duplicate detection (W1-10 / INT-12). Investment-Team-only: the server returns
// 403 for anyone outside the cross-org reader set, so the UI never has to guess.
// ---------------------------------------------------------------------------
const duplicates = {
  forOpportunity(opportunityId) {
    return serverFetch(`/api/duplicates/opportunities/${encodeURIComponent(opportunityId)}`);
  },

  link(opportunityId, matchId) {
    return serverFetch(`/api/duplicates/opportunities/${encodeURIComponent(opportunityId)}/${encodeURIComponent(matchId)}/link`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  dismiss(opportunityId, matchId, reason) {
    return serverFetch(`/api/duplicates/opportunities/${encodeURIComponent(opportunityId)}/${encodeURIComponent(matchId)}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};

// ---------------------------------------------------------------------------
// Submission route — reusable workflows applied to a submission (E7).
// The server owns stage permissions, required fields and the signature map;
// the UI only renders the map and asks the server to advance a stage.
// ---------------------------------------------------------------------------
const workflows = {
  actions() {
    return serverFetch('/api/workflows/actions');
  },

  list(orgId) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    return serverFetch(`/api/workflows${qs}`);
  },

  get(id) {
    return serverFetch(`/api/workflows/${encodeURIComponent(id)}`);
  },

  save(payload) {
    return serverFetch('/api/workflows', { method: 'POST', body: JSON.stringify(payload) });
  },

  apply(opportunityId, workflowId) {
    return serverFetch(`/api/workflows/apply/${encodeURIComponent(opportunityId)}`, {
      method: 'POST',
      body: JSON.stringify({ workflow_id: workflowId }),
    });
  },

  route(opportunityId) {
    return serverFetch(`/api/workflows/route/${encodeURIComponent(opportunityId)}`);
  },

  signatureMap(opportunityId) {
    return serverFetch(`/api/workflows/signature-map/${encodeURIComponent(opportunityId)}`);
  },

  act(opportunityId, { stageKey, action = 'act', comment, reasonCode, reasonText } = {}) {
    return serverFetch(`/api/workflows/route/${encodeURIComponent(opportunityId)}/act`, {
      method: 'POST',
      body: JSON.stringify({ stage_key: stageKey, action, comment, reason_code: reasonCode, reason_text: reasonText }),
    });
  },

  events(opportunityId) {
    return serverFetch(`/api/workflows/route/${encodeURIComponent(opportunityId)}/events`);
  },
};

// ---------------------------------------------------------------------------
// Q&A / clarification loop (E8). Threads are permissioned and audited server-
// side; the client never filters by org itself.
// ---------------------------------------------------------------------------
const qa = {
  myThreads() {
    return serverFetch('/api/qa/my-threads');
  },

  threads(opportunityId, params = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.awaitingResponse) qs.set('awaiting_response', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/qa/opportunities/${encodeURIComponent(opportunityId)}/threads${suffix}`);
  },

  open(opportunityId, payload) {
    return serverFetch(`/api/qa/opportunities/${encodeURIComponent(opportunityId)}/threads`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  thread(threadId) {
    return serverFetch(`/api/qa/threads/${encodeURIComponent(threadId)}`);
  },

  async attach(threadId, file, { body, isResponse = false } = {}) {
    const formData = new FormData();
    formData.append('file', file);
    if (body) formData.append('body', body);
    formData.append('is_response', isResponse ? 'true' : 'false');
    const response = await fetch(`${API_BASE}/api/qa/threads/${encodeURIComponent(threadId)}/attachments`, {
      method: 'POST', headers: actorHeaders(), body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || `Upload failed with status ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  },

  reply(threadId, body, isResponse = false, visibility) {
    return serverFetch(`/api/qa/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, is_response: isResponse, ...(visibility ? { visibility } : {}) }),
    });
  },

  close(threadId, comment) {
    return serverFetch(`/api/qa/threads/${encodeURIComponent(threadId)}/close`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
  },

  reopen(threadId, comment) {
    return serverFetch(`/api/qa/threads/${encodeURIComponent(threadId)}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
  },

  audit(threadId) {
    return serverFetch(`/api/qa/threads/${encodeURIComponent(threadId)}/audit`);
  },
};

// -------------------------------------------------------------------------
// Internal vs shared comment visibility (W6-04 / BRD AUD-03). The server owns
// the policy and filters internal comments out of every read for a subsidiary
// role; the UI only renders what the server returns.
// -------------------------------------------------------------------------
const commentVisibility = {
  config() {
    return serverFetch('/api/comment-visibility');
  },
  saveConfig(config) {
    return serverFetch('/api/comment-visibility', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    });
  },
  history() {
    return serverFetch('/api/comment-visibility/history');
  },
};

// Hash-chained, tamper-evident audit (W6-05 / BRD AUD-01). The server owns the
// chain policy and does the verification; the UI renders the status and offers
// an administrator the verify action.
// -------------------------------------------------------------------------
const auditChain = {
  config() {
    return serverFetch('/api/audit-chain');
  },
  saveConfig(config) {
    return serverFetch('/api/audit-chain', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    });
  },
  verify() {
    return serverFetch('/api/audit-chain/verify', { method: 'POST' });
  },
  history() {
    return serverFetch('/api/audit-chain/history');
  },
};

// Subsidiary presentation scheduling (W6-06 / BRD WF-07). Captures the scheduled
// date, attendees, outcome and next steps on the opportunity record.
// -------------------------------------------------------------------------
const presentations = {
  config() {
    return serverFetch('/api/presentations');
  },
  saveConfig(config) {
    return serverFetch('/api/presentations', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    });
  },
  history() {
    return serverFetch('/api/presentations/history');
  },
  list(opportunityId) {
    return serverFetch(`/api/presentations/opportunities/${encodeURIComponent(opportunityId)}`);
  },
  create(opportunityId, payload) {
    return serverFetch(`/api/presentations/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },
  update(opportunityId, sessionId, payload) {
    return serverFetch(`/api/presentations/opportunities/${encodeURIComponent(opportunityId)}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload || {}),
    });
  },
};

// Notification email frequency (W6-07 / BRD NTF-01). A user chooses immediate
// or a daily digest; an admin tunes the group policy.
// -------------------------------------------------------------------------
const notificationFrequency = {
  config() {
    return serverFetch('/api/notification-frequency');
  },
  savePreference(frequency) {
    return serverFetch('/api/notification-frequency', {
      method: 'PUT',
      body: JSON.stringify({ frequency }),
    });
  },
  savePolicy(config) {
    return serverFetch('/api/notification-frequency/policy', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    });
  },
  policyHistory() {
    return serverFetch('/api/notification-frequency/policy-history');
  },
  digest(since) {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    return serverFetch(`/api/notification-frequency/digest${q}`);
  },
};

// ---------------------------------------------------------------------------
// Authentication policy (W8-01 / BRD PLT-04). Group MFA mode + enforcement,
// approved local-account domains and registered SSO providers. Admins edit the
// policy; every signed-in user can read it and manage their own second factor.
// ---------------------------------------------------------------------------
const authPolicy = {
  config() {
    return serverFetch('/api/auth-policy');
  },
  providers() {
    return serverFetch('/api/auth-policy/providers');
  },
  savePolicy(config) {
    return serverFetch('/api/auth-policy/policy', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    });
  },
  registerProvider(provider) {
    return serverFetch('/api/auth-policy/providers', {
      method: 'POST',
      body: JSON.stringify(provider || {}),
    });
  },
  removeProvider(providerId) {
    return serverFetch('/api/auth-policy/providers/' + encodeURIComponent(providerId), {
      method: 'DELETE',
    });
  },
  policyHistory() {
    return serverFetch('/api/auth-policy/policy-history');
  },
  // Better Auth two-factor endpoints (same-origin cookie session).
  async mfaStatus() {
    const res = await fetch(API_BASE + '/api/auth/get-session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
    const data = await res.json().catch(() => null);
    return { enabled: Boolean(data?.user?.twoFactorEnabled), user: data?.user || null };
  },
  async enableMfa(password) {
    const res = await fetch(API_BASE + '/api/auth/two-factor/enable', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(password ? { password } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.message || 'Could not start MFA enrolment'); e.status = res.status; throw e; }
    return data;
  },
  async verifyTotp(code) {
    const res = await fetch(API_BASE + '/api/auth/two-factor/verify-totp', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.message || 'Invalid code'); e.status = res.status; throw e; }
    return data;
  },
  async disableMfa(password) {
    const res = await fetch(API_BASE + '/api/auth/two-factor/disable', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(password ? { password } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.message || 'Could not disable MFA'); e.status = res.status; throw e; }
    return data;
  },
};

// ---------------------------------------------------------------------------
// Unified admin configuration registry (W8-03 / BRD ADM-01). A single governed
// read over every tunable that shapes a screening: the area, the route that
// edits it and its audited change history. Admin-only.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Bulk import of in-flight opportunities (W8-05 / BRD INTG-03). A dry-run
// validation report, the load template, and the execute pass. File uploads use
// multipart so the operator can hand over the Sirius tracker workbook.
// ---------------------------------------------------------------------------
const bulkImport = {
  policy() {
    return serverFetch('/api/bulk-import/policy');
  },
  templateUrl() {
    return '/api/bulk-import/template.csv';
  },
  async validate(payload) {
    if (payload?.file) return postBulkFile('/api/bulk-import/validate', payload.file);
    return serverFetch('/api/bulk-import/validate', { method: 'POST', body: JSON.stringify({ csv: payload?.csv || '' }) });
  },
  async execute(payload) {
    if (payload?.file) return postBulkFile('/api/bulk-import/execute', payload.file, true);
    return serverFetch('/api/bulk-import/execute', { method: 'POST', body: JSON.stringify({ csv: payload?.csv || '', confirm: true }) });
  },
};

// ---------------------------------------------------------------------------
// AI governance (W9-01 / BRD NFR-03). The policy and provider register (admin
// editable), the governed-call log, and the roll-up. Read is available to any
// authenticated user so the UI can render the AI-output label.
// ---------------------------------------------------------------------------
const aiGovernance = {
  get() {
    return serverFetch('/api/ai-governance');
  },
  update(config) {
    return serverFetch('/api/ai-governance', { method: 'PUT', body: JSON.stringify({ config }) });
  },
  log(limit = 50) {
    return serverFetch('/api/ai-governance/log?limit=' + limit);
  },
  logStatus() {
    return serverFetch('/api/ai-governance/log/status');
  },
};

async function postBulkFile(path, file, confirm) {
  const formData = new FormData();
  formData.append('file', file);
  if (confirm) formData.append('confirm', 'true');
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: actorHeaders(), body: formData });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Import failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const adminConfig = {
  registry() {
    return serverFetch('/api/admin-config');
  },
  domains() {
    return serverFetch('/api/admin-config/domains');
  },
  domain(domainKey) {
    return serverFetch('/api/admin-config/' + encodeURIComponent(domainKey));
  },
  history(domainKey) {
    return serverFetch('/api/admin-config/' + encodeURIComponent(domainKey) + '/history');
  },
};


// ---------------------------------------------------------------------------
// Related-party review (E9.5 / REQ-GATE-08). The server owns sourcing-channel
// semantics and the disclosure requirement; the UI renders the flag and form.
// ---------------------------------------------------------------------------
const relatedParty = {
  channels() {
    return serverFetch('/api/related-party/channels');
  },

  get(opportunityId) {
    return serverFetch(`/api/related-party/opportunities/${encodeURIComponent(opportunityId)}`);
  },

  save(opportunityId, payload) {
    return serverFetch(`/api/related-party/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload || {}),
    });
  },

  // The independent, non-conflicted sign-off that clears the overlay for the
  // Gate-1 Screening Decision (W6-03 / BRD WF-06).
  signoff(opportunityId, payload) {
    return serverFetch(`/api/related-party/opportunities/${encodeURIComponent(opportunityId)}/signoff`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  // The effective overlay configuration (W6-03 / BRD WF-06).
  config() {
    return serverFetch('/api/related-party');
  },

  saveConfig(config) {
    return serverFetch('/api/related-party', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    });
  },

  history() {
    return serverFetch('/api/related-party/history');
  },
};

// ---------------------------------------------------------------------------
// Notifications (E8.2). The recipient's own inbox by default.
// ---------------------------------------------------------------------------
const notifications = {
  list({ all = false, limit, channels } = {}) {
    const qs = new URLSearchParams();
    if (all) qs.set('all', '1');
    if (limit) qs.set('limit', String(limit));
    if (channels) qs.set('channels', channels);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/notifications${suffix}`);
  },
};

// ---------------------------------------------------------------------------
// Super-admin console (RBAC + tenancy management). All routes require the
// admin role server-side; the client only renders what the server allows.
// ---------------------------------------------------------------------------
const admin = {
  overview() {
    return serverFetch('/api/admin/overview');
  },

  roles() {
    return serverFetch('/api/admin/roles');
  },

  users(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/admin/users${suffix}`);
  },

  user(id) {
    return serverFetch(`/api/admin/users/${encodeURIComponent(id)}`);
  },

  createUser(payload) {
    return serverFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateUser(id, payload) {
    return serverFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  setPassword(id, password) {
    return serverFetch(`/api/admin/users/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  banUser(id, { banned = true, reason } = {}) {
    return serverFetch(`/api/admin/users/${encodeURIComponent(id)}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned, reason }),
    });
  },

  deactivateUser(id) {
    return serverFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  reactivateUser(id) {
    return serverFetch(`/api/admin/users/${encodeURIComponent(id)}/reactivate`, { method: 'POST' });
  },

  userAdminPolicy() {
    return serverFetch('/api/admin/user-admin/policy');
  },

  organizations(params = {}) {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/admin/organizations${suffix}`);
  },

  organization(id) {
    return serverFetch(`/api/admin/organizations/${encodeURIComponent(id)}`);
  },

  memberships(params = {}) {
    const qs = new URLSearchParams();
    if (params.org_id) qs.set('org_id', params.org_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return serverFetch(`/api/admin/memberships${suffix}`);
  },

  createMembership(payload) {
    return serverFetch('/api/admin/memberships', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateMembership(id, payload) {
    return serverFetch(`/api/admin/memberships/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteMembership(id) {
    return serverFetch(`/api/admin/memberships/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  accessGrants() {
    return serverFetch('/api/admin/access-grants');
  },

  createAccessGrant(payload) {
    return serverFetch('/api/admin/access-grants', { method: 'POST', body: JSON.stringify(payload) });
  },

  deleteAccessGrant(id) {
    return serverFetch(`/api/admin/access-grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  tenancyMatrix() {
    return serverFetch('/api/admin/tenancy-matrix');
  },

  audit(limit) {
    const suffix = limit ? `?limit=${limit}` : '';
    return serverFetch(`/api/admin/audit${suffix}`);
  },

  // Sample-data seed control (W1-11 / W1-12). Inspect what seed data is
  // present and clean or (re)load a profile without shelling into the box.
  seedStatus() {
    return serverFetch('/api/admin/seed');
  },

  seedRun(payload) {
    return serverFetch('/api/admin/seed', { method: 'POST', body: JSON.stringify(payload) });
  },
};

// ---------------------------------------------------------------------------
// IHC weekly report (W7-01 / DSH-03). The server owns the column set and the
// export; the client fetches the tracker or downloads the Excel/CSV file.
// ---------------------------------------------------------------------------
const reporting = {
  config() {
    return serverFetch('/api/reporting/config');
  },

  updateConfig(patch) {
    return serverFetch('/api/reporting/config', { method: 'PUT', body: JSON.stringify(patch || {}) });
  },

  configHistory() {
    return serverFetch('/api/reporting/config-history');
  },

  weekly() {
    return serverFetch('/api/reporting/weekly');
  },

  schedule() {
    return serverFetch('/api/reporting/schedule');
  },

  async downloadWeekly(format) {
    const ext = format || 'xlsx';
    const response = await fetch(API_BASE + '/api/reporting/weekly.' + ext, { headers: actorHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data?.error || ('Report download failed (' + response.status + ')'));
      error.status = response.status;
      throw error;
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : ('IHC_Weekly_Tracker.' + ext);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { filename };
  },
};

// ---------------------------------------------------------------------------
// Pipeline dashboard (W7-02 / DSH-01). The server applies the filter set over
// the live board and returns the filtered cards, summary and drill-down.
// ---------------------------------------------------------------------------
const pipelineDashboard = {
  config() {
    return serverFetch('/api/pipeline-dashboard');
  },

  board(filters) {
    const params = new URLSearchParams();
    const f = filters || {};
    for (const key of ['entity', 'cluster', 'sector', 'state', 'owner', 'date', 'drilldown']) {
      const value = f[key];
      if (value == null || value === '') continue;
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const qs = params.toString();
    return serverFetch('/api/pipeline-dashboard/board' + (qs ? '?' + qs : ''));
  },

  updateConfig(patch) {
    return serverFetch('/api/pipeline-dashboard/config', { method: 'PUT', body: JSON.stringify(patch || {}) });
  },

  configHistory() {
    return serverFetch('/api/pipeline-dashboard/config-history');
  },
};

// ---------------------------------------------------------------------------
// Funnel & cycle-time metrics (W7-03 / DSH-04). The server computes the funnel
// conversion, the decline reasons and the stage cycle time for a date range.
// ---------------------------------------------------------------------------
const pipelineMetrics = {
  config() {
    return serverFetch('/api/pipeline-metrics');
  },

  summary(range) {
    const qs = range && range !== 'any' ? '?range=' + encodeURIComponent(range) : '';
    return serverFetch('/api/pipeline-metrics/summary' + qs);
  },

  updateConfig(patch) {
    return serverFetch('/api/pipeline-metrics/config', { method: 'PUT', body: JSON.stringify(patch || {}) });
  },

  configHistory() {
    return serverFetch('/api/pipeline-metrics/config-history');
  },
};


// ---------------------------------------------------------------------------
// Opportunity Overview pack (W7-04 / OUT-02). The pack is the downloadable form
// of the six-page Sirius Part B template. The server owns the page order and the
// rendering, so the manifest and the downloads cannot drift from the memo.
// ---------------------------------------------------------------------------
const memoPack = {
  manifest(opportunityId) {
    return serverFetch(`/api/memo-pack/opportunities/${encodeURIComponent(opportunityId)}`);
  },

  // Downloads the pack (html by default, md optional) with the actor headers so
  // the request is scoped to the signed-in user's organisations.
  async download(opportunityId, format = 'html') {
    const response = await fetch(
      `${API_BASE}/api/memo-pack/opportunities/${encodeURIComponent(opportunityId)}.${format}`,
      { headers: actorHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data?.error || `Pack download failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : `Sirius_Opportunity_Overview_${opportunityId}.${format}`;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { filename };
  },
};

// ---------------------------------------------------------------------------
// Memo QR verification (W7-05 / OUT-03). The server fingerprints the current
// memo and issues a signed verify URL; the public verify call needs no session
// so a scanned phone can confirm the copy against the live record version/hash.
// ---------------------------------------------------------------------------
const memoVerification = {
  vocabulary() {
    return serverFetch('/api/memo-verification');
  },

  issue(opportunityId) {
    return serverFetch(`/api/memo-verification/opportunities/${encodeURIComponent(opportunityId)}`);
  },

  latest(opportunityId) {
    return serverFetch(`/api/memo-verification/opportunities/${encodeURIComponent(opportunityId)}/latest`);
  },

  // The QR image for the issued payload as a blob object URL. Fetched with the
  // actor headers (an <img src> could not carry them), so the caller must
  // revoke the returned URL when done.
  async qrObjectUrl(opportunityId, format = 'png') {
    const response = await fetch(
      `${API_BASE}/api/memo-verification/opportunities/${encodeURIComponent(opportunityId)}/qr.${format}`,
      { headers: actorHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data?.error || `QR request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },

  // Public verify - no actor headers, callable from the unauthenticated page.
  async verify(token) {
    const qs = new URLSearchParams(token || {}).toString();
    const response = await fetch(`${API_BASE}/api/memo-verification/verify?${qs}`);
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ...data };
  },
};

// Named owner and reviewer routing (WF-02 / WF-03).
const routing = {
  get() { return serverFetch('/api/routing'); },
  save(config) { return serverFetch('/api/routing', { method: 'PUT', body: JSON.stringify(config) }); },
  history() { return serverFetch('/api/routing/history'); },
  owners() { return serverFetch('/api/routing/owners'); },
  preview(opportunityId) { return serverFetch(`/api/routing/preview/${encodeURIComponent(opportunityId)}`); },
  reassign(opportunityId, email, reason) {
    return serverFetch(`/api/routing/opportunities/${encodeURIComponent(opportunityId)}/owner`, {
      method: 'POST', body: JSON.stringify({ email, reason }),
    });
  },
};

export const api = {
  routing,
  entities,
  auth,
  features,
  org,
  strategy,
  gate,
  themes,
  pipeline,
  reporting,
  pipelineDashboard,
  pipelineMetrics,
  memoPack,
  memoVerification,
  workflows,
  qa,
  commentVisibility,
  auditChain,
  presentations,
  notificationFrequency,
  authPolicy,
  bulkImport,
  aiGovernance,
  adminConfig,
  relatedParty,
  duplicates,
  notifications,
  admin,
  integrations: { Core },
  appLogs,
  // Escape hatch for local data management (seeding, reset).
  _local: {
    /**
     * Replace the local stores with a dataset keyed by entity name.
     * Records keep their own ids so cross-entity references stay valid.
     * Returns a { EntityName: count } summary.
     */
    async seed(dataset = {}) {
      const user = getStoredUser();
      const stamp = nowIso();
      const counts = {};
      Object.entries(dataset).forEach(([entity, rows]) => {
        if (!Array.isArray(rows)) return;
        const prepared = rows.map((row) => ({
          id: row.id || uuid(),
          created_date: row.created_date || stamp,
          updated_date: row.updated_date || stamp,
          created_by: row.created_by || user.email,
          ...row,
        }));
        writeStore(entity, prepared);
        counts[entity] = prepared.length;
      });
      // Mirror into Postgres when the backend is up (source of truth).
      if (await checkServer()) {
        for (const [entity, rows] of Object.entries(dataset)) {
          if (!Array.isArray(rows)) continue;
          try {
            await serverFetch(`/api/entities/${entity}`, {
              method: 'POST',
              body: JSON.stringify(rows.map((row) => ({ owner_org_id: user.org_id, ...row }))),
            });
          } catch (err) {
            console.warn(`[seed] server seed failed for ${entity}:`, err.message);
          }
        }
      }
      return counts;
    },

    /** Remove all entity records (keeps the local user). */
    clear() {
      allEntityNames().forEach((name) => writeStore(name, []));
      return true;
    },

    /** True when at least one entity record exists. */
    hasData() {
      return allEntityNames().some((name) => readStore(name).length > 0);
    },

    /** Total record count across every store. */
    count() {
      return allEntityNames().reduce((sum, name) => sum + readStore(name).length, 0);
    },

    emptyStores() {
      allEntityNames().forEach((name) => writeStore(name, []));
    },

    reset() {
      allEntityNames().forEach((name) => writeStore(name, []));
      writeRaw(USER_KEY, JSON.stringify(DEFAULT_USER));
    },
  },
};

export default api;
