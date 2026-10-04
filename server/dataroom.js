import express from 'express';

// ---------------------------------------------------------------------------
// Coneshare data-room API client
//
// Decision (see docs/DealForge_Storage_and_Dataroom_Reuse_Analysis.md): the
// data room is integrated as an EXTERNAL SERVICE over its REST API — DealForge
// does not fork or re-implement Coneshare. DealForge owns the investment
// workflow/gates/entities; Coneshare owns secure rooms, share links, NDA,
// watermarking, page analytics and the viewer Q&A UX.
//
// Auth mirrors Coneshare's API-key scheme: `Authorization: Bearer cs_live_...`.
// ---------------------------------------------------------------------------
const cfg = {
  base: (process.env.CONESHARE_BASE_URL || '').replace(/\/+$/, ''),
  key: process.env.CONESHARE_API_KEY || '',
  // Coneshare's DRF API is versioned at /api/v1 on the deployment root.
  apiPath: process.env.CONESHARE_API_PATH || '/api/v1',
  timeoutMs: Number(process.env.CONESHARE_TIMEOUT_MS || 15000),
};

export const dataroomEnabled = Boolean(cfg.base);
export function dataroomInfo() {
  return { mode: dataroomEnabled ? 'api' : 'disabled', base: cfg.base || null };
}

async function request(path, { method = 'GET', body, query } = {}) {
  if (!dataroomEnabled) {
    const err = new Error(
      'Data room integration is not configured. Set CONESHARE_BASE_URL (and CONESHARE_API_KEY).'
    );
    err.status = 400;
    throw err;
  }
  const url = new URL(cfg.base + cfg.apiPath + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    if (!res.ok) {
      const detail = payload?.detail || payload?.error || res.statusText;
      const err = new Error(`Data room API error (${res.status}): ${detail}`);
      err.status = res.status === 404 ? 404 : 502;
      throw err;
    }
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Data room API timed out after ${cfg.timeoutMs}ms`);
      e.status = 504;
      throw e;
    }
    throw err.status ? err : Object.assign(new Error(err.message), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

// Thin semantic wrappers over Coneshare's DRF resources. Paths follow the
// documented API surface; adjust here if a deployment exposes a different route.
export const dataroomApi = {
  listDatarooms: (query) => request('/datarooms/', { query }),
  getDataroom: (id) => request(`/datarooms/${id}/`),
  createDataroom: (body) => request('/datarooms/', { method: 'POST', body }),
  updateDataroom: (id, body) => request(`/datarooms/${id}/`, { method: 'PATCH', body }),
  listCollaborators: (id) => request(`/datarooms/${id}/collaborators/`),
  addCollaborator: (id, body) => request(`/datarooms/${id}/collaborators/`, { method: 'POST', body }),
  removeCollaborator: (id, userId) =>
    request(`/datarooms/${id}/collaborators/${userId}/`, { method: 'DELETE' }),
  createShareLink: (body) => request('/share-links/', { method: 'POST', body }),
  listShareLinks: (query) => request('/share-links/', { query }),
  listQnaThreads: (dataroomId, query) => request(`/datarooms/${dataroomId}/qna-threads/`, { query }),
  listVisits: (dataroomId, query) => request(`/datarooms/${dataroomId}/visits/`, { query }),
  request,
};

const router = express.Router();

function sendError(res, err) {
  return res.status(err.status || 502).json({ error: err.message });
}

router.get('/health', async (_req, res) => {
  if (!dataroomEnabled) return res.json({ ...dataroomInfo(), reachable: false });
  try {
    const datarooms = await dataroomApi.listDatarooms();
    const count = Array.isArray(datarooms) ? datarooms.length : datarooms?.count ?? null;
    return res.json({ ...dataroomInfo(), reachable: true, datarooms: count });
  } catch (err) {
    return res.status(200).json({ ...dataroomInfo(), reachable: false, error: err.message });
  }
});

router.get('/datarooms', async (req, res) => {
  try {
    return res.json(await dataroomApi.listDatarooms(req.query));
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/datarooms', async (req, res) => {
  try {
    return res.status(201).json(await dataroomApi.createDataroom(req.body || {}));
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/share-links', async (req, res) => {
  try {
    return res.status(201).json(await dataroomApi.createShareLink(req.body || {}));
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/datarooms/:id/visits', async (req, res) => {
  try {
    return res.json(await dataroomApi.listVisits(req.params.id, req.query));
  } catch (err) {
    return sendError(res, err);
  }
});

export default router;
