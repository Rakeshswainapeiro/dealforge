import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { pool } from './db.js';
import {
  UPLOAD_DIR,
  s3Enabled,
  storageInfo,
  saveFile,
  readFileForExtraction,
  keyFromUrl,
  buildObjectKey,
  presignPut,
  presignGet,
  filesRouter,
} from './storage.js';
import { UPLOAD_MAX_BYTES, uploadFilter, rateLimit } from './security.js';
import { checkAIProvider, logLLMCall } from './aiGovernance.js';
import { resolveActor } from './users.js';

export { UPLOAD_DIR, filesRouter };

const router = express.Router();

// Abuse limits for the expensive / unauthenticated integration routes (E10.1).
// Declared here, before any route that references them, so the module body
// does not touch them in the temporal dead zone at import time.
// The maxima are overridable so a test run or a load rehearsal can raise them
// without switching the limiter off (RATE_LIMIT_DISABLED), which the E10.1
// rate-limit assertions still rely on being able to trip.
const uploadLimit = rateLimit({ name: 'upload', windowMs: 60_000, max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 30), message: 'Too many uploads; try again shortly.' });
const aiLimit = rateLimit({ name: 'ai', windowMs: 60_000, max: Number(process.env.AI_RATE_LIMIT_MAX || 30), message: 'Too many AI requests; try again shortly.' });
const mailLimit = rateLimit({ name: 'mail', windowMs: 60_000, max: Number(process.env.MAIL_RATE_LIMIT_MAX || 60), message: 'Too many notification requests; try again shortly.' });

function aiConfig({ base_url, api_key, model } = {}) {
  return {
    base: (base_url || process.env.OPENAI_BASE_URL || '').replace(/\/+$/, ''),
    key: api_key || process.env.OPENAI_API_KEY || '',
    model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

function isAiConfigured(override) {
  return Boolean(aiConfig(override).base);
}

const TEXT_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.json', '.md', '.log', '.xml', '.html']);

async function readTextContent(filePath, ext) {
  if (!TEXT_EXTENSIONS.has(ext)) return null;
  const raw = await fsp.readFile(filePath, 'utf8');
  return raw.slice(0, 200_000);
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = cells[index] !== undefined ? cells[index].trim() : '';
    });
    return obj;
  });
}

async function callLLM({ prompt, response_json_schema, file_urls = [], config = {}, add_context_from_internet = false, actor = null }) {
  const { base, key, model } = aiConfig(config);
  if (!base) {
    const error = new Error(
      'AI backend is not configured. Set OPENAI_BASE_URL / OPENAI_API_KEY (and optionally OPENAI_MODEL) on the server.'
    );
    error.status = 400;
    throw error;
  }

  // AI governance (W9-01 / NFR-03): a provider must be approved before it is
  // used when the policy requires it. The check runs before the outbound call
  // so an unapproved endpoint never receives a prompt.
  const gate = await checkAIProvider(base);
  if (!gate.allowed) {
    const error = new Error(gate.reason);
    error.status = 403;
    throw error;
  }

  let finalPrompt = prompt || '';
  if (add_context_from_internet) {
    finalPrompt +=
      '\n\n(Note: internet browsing is not available in local mode; answer from your knowledge.)';
  }
  if (response_json_schema) {
    finalPrompt +=
      '\n\nRespond with ONLY a valid JSON object that conforms to this JSON schema:\n' +
      JSON.stringify(response_json_schema);
  }

  const contentParts = [{ type: 'text', text: finalPrompt }];
  for (const fileUrl of file_urls) {
    const absolute = fileUrl.startsWith('http')
      ? fileUrl
      : `${process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`}${fileUrl}`;
    if (/\.(png|jpe?g|gif|webp)$/i.test(absolute)) {
      contentParts.push({ type: 'image_url', image_url: { url: absolute } });
    } else {
      contentParts.push({ type: 'text', text: `Attached file reference: ${absolute}` });
    }
  }

  const messages = [
    {
      role: 'user',
      content: contentParts.length > 1 ? contentParts : finalPrompt,
    },
  ];

  const body = { model, messages, temperature: 0.2 };
  if (response_json_schema) body.response_format = { type: 'json_object' };

  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const error = new Error(`Failed to reach AI provider at ${base}: ${err.message}`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || response.statusText;
    const error = new Error(`AI provider error (${response.status}): ${detail}`);
    error.status = 502;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content ?? '';
  // Prompt/response logging is governed: redaction and retention come from the
  // resolved policy (NFR-03). A logging failure never breaks the call.
  logLLMCall({
    model, baseUrl: base, actor,
    prompt: finalPrompt, response: typeof content === 'object' ? JSON.stringify(content) : String(content),
    config: gate.config,
  }).catch((err) => console.warn('[db] failed to log llm call:', err.message));

  if (response_json_schema) {
    if (typeof content === 'object') return content;
    try {
      return JSON.parse(content);
    } catch {
      const match = String(content).match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          /* ignore */
        }
      }
      const error = new Error('AI provider did not return valid JSON for the requested schema');
      error.status = 502;
      throw error;
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// InvokeLLM
// ---------------------------------------------------------------------------
router.post('/invoke-llm', aiLimit, async (req, res) => {
  const { prompt, response_json_schema, file_urls, add_context_from_internet, model, base_url, api_key } =
    req.body || {};
  try {
    const actor = await resolveActor(req).catch(() => null);
    const result = await callLLM({
      prompt,
      response_json_schema,
      file_urls,
      add_context_from_internet,
      config: { model, base_url, api_key },
      actor,
    });
    if (typeof result === 'string') return res.json(result);
    return res.json(result);
  } catch (err) {
    console.error('[invoke-llm]', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// UploadFile
// ---------------------------------------------------------------------------
// Size ceiling + extension allow-list (E10.1). The integration upload route is
// unauthenticated for the AI/extraction flows, so it is also rate-limited.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: uploadFilter,
});

router.post('/upload-file', uploadLimit, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const saved = await saveFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    pool
      .query(
        'INSERT INTO uploads (filename, original_name, mimetype, size, storage, object_key) VALUES ($1, $2, $3, $4, $5, $6)',
        [saved.filename, saved.original_name, saved.mimetype, saved.size, saved.storage, saved.key]
      )
      .catch((err) => console.warn('[db] failed to log upload:', err.message));
    return res.json({
      file_url: saved.file_url,
      filename: saved.filename,
      original_name: saved.original_name,
      mimetype: saved.mimetype,
      size: saved.size,
      storage: saved.storage,
    });
  } catch (err) {
    console.error('[upload-file]', err.message);
    return res.status(502).json({ error: `Upload failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// ExtractDataFromUploadedFile
// ---------------------------------------------------------------------------
router.post('/extract-data', aiLimit, async (req, res) => {
  const { file_url, json_schema, model, base_url, api_key } = req.body || {};
  if (!file_url) return res.status(400).json({ status: 'error', details: 'file_url is required' });

  const localPath = await readFileForExtraction(file_url);
  if (!localPath) {
    return res.status(404).json({ status: 'error', details: 'Uploaded file could not be found' });
  }

  const ext = path.extname(localPath).toLowerCase();
  const text = await readTextContent(localPath, ext);

  if (isAiConfigured({ base_url, api_key }) && text != null) {
    try {
      const output = await callLLM({
        prompt:
          'Extract structured data from the following file content. Fill every field you can find; ' +
          'leave fields out only if they are genuinely absent.\n\n' +
          text,
        response_json_schema: json_schema,
        config: { model, base_url, api_key },
      });
      return res.json({ status: 'success', output });
    } catch (err) {
      console.warn('[extract-data] LLM extraction failed, falling back to parsing:', err.message);
    }
  }

  try {
    let output = null;
    if (ext === '.json') {
      const parsed = JSON.parse(text ?? (await fsp.readFile(localPath, 'utf8')));
      output = Array.isArray(parsed) ? parsed[0] ?? {} : parsed;
    } else if (ext === '.csv' || ext === '.tsv') {
      const parsedRows = parseDelimited(text ?? '', ext === '.tsv' ? '\t' : ',');
      const objects = rowsToObjects(parsedRows);
      output = objects[0] ?? {};
    }

    if (output == null) {
      return res.status(422).json({
        status: 'error',
        details:
          `Local extraction supports JSON/CSV/TSV directly. ` +
          `Configure an AI backend (OPENAI_BASE_URL) to extract from ${ext || 'this file type'}.`,
      });
    }
    return res.json({ status: 'success', output });
  } catch (err) {
    return res.status(500).json({ status: 'error', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// SendEmail (Resend API if a key is available, otherwise log-only)
// ---------------------------------------------------------------------------
router.post('/send-email', mailLimit, async (req, res) => {
  const { to, subject, body, from_email, from_name, api_key } = req.body || {};
  if (!to) return res.status(400).json({ error: 'A recipient "to" is required' });

  const key = api_key || process.env.RESEND_API_KEY;
  let status = 'logged';
  if (key) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${from_name || 'DealForge'} <${from_email || 'onboarding@resend.dev'}>`,
          to: [to],
          subject: subject || 'DealForge',
          html: body || '',
        }),
      });
      status = response.ok ? 'sent' : `failed:${response.status}`;
    } catch (err) {
      status = `failed:${err.message}`;
    }
  }

  pool
    .query(
      'INSERT INTO email_logs (to_email, from_email, subject, body, status) VALUES ($1, $2, $3, $4, $5)',
      [to, from_email || null, subject || null, body || null, status]
    )
    .catch((err) => console.warn('[db] failed to log email:', err.message));

  return res.json({ status: 'success', delivered: status === 'sent', detail: status });
});

// ---------------------------------------------------------------------------
// SendSMS (log-only in local mode)
// ---------------------------------------------------------------------------
router.post('/send-sms', mailLimit, async (req, res) => {
  const { to, message } = req.body || {};
  if (!to) return res.status(400).json({ error: 'A recipient "to" is required' });
  await pool
    .query('INSERT INTO sms_logs (to_number, message, status) VALUES ($1, $2, $3)', [
      to,
      message || null,
      'logged',
    ])
    .catch((err) => console.warn('[db] failed to log sms:', err.message));
  return res.json({ status: 'success', delivered: false, detail: 'logged (no SMS provider configured)' });
});

// ---------------------------------------------------------------------------
// GenerateImage
// ---------------------------------------------------------------------------
router.post('/generate-image', aiLimit, async (req, res) => {
  const { prompt, size, model, base_url, api_key } = req.body || {};
  const { base, key, model: cfgModel } = aiConfig({ model, base_url, api_key });
  if (!base) {
    return res
      .status(400)
      .json({ error: 'AI backend is not configured. Set OPENAI_BASE_URL / OPENAI_API_KEY.' });
  }
  if (!prompt) return res.status(400).json({ error: 'A prompt is required' });

  try {
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: model || cfgModel || 'dall-e-3',
        prompt,
        n: 1,
        size: size || '1024x1024',
        response_format: 'b64_json',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res
        .status(502)
        .json({ error: payload?.error?.message || 'Image generation failed' });
    }

    const item = payload?.data?.[0] || {};
    let url = item.url || null;
    if (item.b64_json) {
      const saved = await saveFile({
        buffer: Buffer.from(item.b64_json, 'base64'),
        originalName: 'generated.png',
        mimetype: 'image/png',
      });
      url = saved.file_url;
    }

    await pool
      .query('INSERT INTO image_logs (prompt, url, status) VALUES ($1, $2, $3)', [
        prompt,
        url,
        'generated',
      ])
      .catch((err) => console.warn('[db] failed to log image:', err.message));

    return res.json({ url, status: 'success' });
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach AI provider: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Object storage (S3 / ObjectIO) — direct-to-store presigned URLs
// ---------------------------------------------------------------------------
router.get('/storage-info', (_req, res) => res.json(storageInfo()));

router.post('/presign-upload', async (req, res) => {
  if (!s3Enabled) return res.status(400).json({ error: 'Object storage is not configured' });
  const { filename, content_type, expires_in } = req.body || {};
  const ttl = Math.min(Number(expires_in) || 900, 3600);
  const key = buildObjectKey(filename || 'file');
  try {
    const url = await presignPut(key, content_type || 'application/octet-stream', ttl);
    return res.json({ key, url, file_url: `/api/files/${key}`, expires_in: ttl });
  } catch (err) {
    return res.status(502).json({ error: `Could not sign upload URL: ${err.message}` });
  }
});

router.post('/presign-download', async (req, res) => {
  if (!s3Enabled) return res.status(400).json({ error: 'Object storage is not configured' });
  const { key, file_url, expires_in } = req.body || {};
  const objectKey = key || keyFromUrl(file_url);
  if (!objectKey) return res.status(400).json({ error: 'key or file_url is required' });
  const ttl = Math.min(Number(expires_in) || 900, 3600);
  try {
    return res.json({ url: await presignGet(objectKey, ttl), expires_in: ttl });
  } catch (err) {
    return res.status(502).json({ error: `Could not sign download URL: ${err.message}` });
  }
});

export default router;
