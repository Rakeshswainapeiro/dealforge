import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolveActor } from './users.js';
import { canViewOrg } from './rbac.js';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Storage configuration
//
// ObjectIO exposes a wire-compatible S3 API (:9000), so it is configured here
// exactly like any S3 endpoint. The same settings work unchanged against MinIO,
// Cloudflare R2 or AWS S3 — the S3 API is the contract, not the vendor.
// ---------------------------------------------------------------------------
const cfg = {
  endpoint: (process.env.S3_ENDPOINT || '').replace(/\/+$/, ''),
  region: process.env.S3_REGION || 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  bucket: process.env.S3_BUCKET || 'dealforge',
  prefix: (process.env.S3_PREFIX || 'dealforge').replace(/^\/+|\/+$/g, ''),
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
  publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
};

export const s3Enabled = Boolean(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey);
export const storageMode = s3Enabled ? 's3' : 'local';

let client = null;
function s3() {
  if (!client) {
    client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  return client;
}

export function storageInfo() {
  return {
    mode: storageMode,
    endpoint: s3Enabled ? cfg.endpoint : null,
    bucket: s3Enabled ? cfg.bucket : null,
    prefix: s3Enabled ? cfg.prefix : null,
  };
}

// ---------------------------------------------------------------------------
// Key / URL helpers
// ---------------------------------------------------------------------------
export function buildObjectKey(originalName = 'file') {
  const ext = path.extname(originalName || '');
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${cfg.prefix}/${stamp}/${crypto.randomUUID()}${ext}`;
}

// Per-org (and per-opportunity) key prefix (E4.3 / REQ-ARCH-03). Segments are
// sanitised so a caller-supplied org id can never escape its namespace.
export function scopedObjectKey({ orgId, opportunityId, originalName = 'file' } = {}) {
  const clean = (v) => String(v || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  const ext = path.extname(originalName || '');
  const segments = [cfg.prefix, 'org', clean(orgId) || 'unscoped'];
  if (opportunityId) segments.push('opportunity', clean(opportunityId));
  segments.push(`${crypto.randomUUID()}${ext}`);
  return segments.join('/');
}

// A file_url returned to clients is always an app-relative path served by the
// backend, so RBAC can be enforced in one place regardless of storage mode.
export function appFileUrl(key) {
  return `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// Accepts an app file URL (/api/files/<key>), an s3://bucket/key URI, or a raw key.
export function keyFromUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  let value = fileUrl;
  try {
    if (value.startsWith('http')) value = new URL(value).pathname;
  } catch {
    /* ignore */
  }
  if (value.startsWith('/api/files/')) return decodeURIComponent(value.slice('/api/files/'.length));
  if (value.startsWith('s3://')) return value.slice(5).split('/').slice(1).join('/');
  if (value.startsWith('/uploads/')) return null; // local file, not an object key
  if (value.startsWith('/')) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Object operations
// ---------------------------------------------------------------------------
export async function ensureBucket() {
  if (!s3Enabled) return false;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    return true;
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchBucket') {
      try {
        await s3().send(new CreateBucketCommand({ Bucket: cfg.bucket }));
        console.log(`[storage] created bucket "${cfg.bucket}"`);
        return true;
      } catch (createErr) {
        console.warn(`[storage] could not create bucket "${cfg.bucket}": ${createErr.message}`);
        return false;
      }
    }
    console.warn(`[storage] bucket check failed: ${err.message}`);
    return false;
  }
}

export async function putObject(key, body, contentType) {
  await s3().send(
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType })
  );
  return key;
}

export async function getObjectStream(key) {
  const out = await s3().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  return { body: out.Body, contentType: out.ContentType, contentLength: out.ContentLength };
}

export async function getObjectBuffer(key) {
  const out = await s3().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

export async function deleteObject(key) {
  await s3().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

export async function presignPut(key, contentType, expiresIn = 900) {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }),
    { expiresIn }
  );
}

export async function presignGet(key, expiresIn = 900) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn });
}

// ---------------------------------------------------------------------------
// Unified file persistence (S3 when configured, local disk otherwise)
// ---------------------------------------------------------------------------
export async function saveFile({ buffer, originalName, mimetype, key: providedKey }) {
  if (s3Enabled) {
    const key = providedKey || buildObjectKey(originalName);
    await putObject(key, buffer, mimetype);
    return {
      storage: 's3',
      key,
      filename: path.basename(key),
      original_name: originalName,
      mimetype,
      size: buffer.length,
      file_url: appFileUrl(key),
    };
  }
  const filename = `${Date.now()}-${crypto.randomUUID()}${path.extname(originalName || '')}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return {
    storage: 'local',
    key: null,
    filename,
    original_name: originalName,
    mimetype,
    size: buffer.length,
    file_url: `/uploads/${filename}`,
  };
}

export async function readFileForExtraction(fileUrl) {
  if (s3Enabled) {
    const key = keyFromUrl(fileUrl);
    if (key) {
      const buffer = await getObjectBuffer(key);
      const tmp = path.join(UPLOAD_DIR, `.extract-${crypto.randomUUID()}${path.extname(key)}`);
      await fs.promises.writeFile(tmp, buffer);
      return tmp;
    }
  }
  // local fallback
  if (!fileUrl) return null;
  if (typeof fileUrl === 'string' && fileUrl.startsWith('file://')) {
    return fileUrl.replace('file://', '');
  }
  if (typeof fileUrl === 'string' && !fileUrl.startsWith('http') && fs.existsSync(fileUrl)) {
    return fileUrl;
  }
  const candidate = path.join(UPLOAD_DIR, path.basename(String(fileUrl).split('?')[0]));
  return fs.existsSync(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// /api/files/* — authenticated streaming gateway in front of the object store
//
// Kept as a single choke point so per-object RBAC / audit can be added here
// without touching every feature. Range requests are supported for media.
// ---------------------------------------------------------------------------
export const filesRouter = express.Router();

// Resolve the acting identity so /api/files can enforce the same org scoping
// as every other route: a key under `org/<id>/...` is only readable by a user
// who may view that org. This is the single choke point for document RBAC.
filesRouter.use(async (req, _res, next) => {
  try { req.actor = await resolveActor(req); } catch { req.actor = null; }
  next();
});

filesRouter.get('/*', async (req, res) => {
  const key = decodeURIComponent(req.params[0] || '');
  if (!key) return res.status(400).json({ error: 'A file key is required' });
  if (!s3Enabled) return res.status(404).json({ error: 'Object storage is not configured' });

  // Org-scoped keys carry their owner org in the path (org/<orgId>/...).
  const match = key.match(/(?:^|\/)org\/([^/]+)(?:\/|$)/);
  if (match) {
    if (!req.actor) return res.status(401).json({ error: 'Authentication required' });
    const ownerOrg = match[1];
    const allowed = canViewOrg(req.actor.membership, ownerOrg, {
      descendantIds: req.actor.descendant_ids || [],
      grantedOrgIds: req.actor.granted_org_ids || [],
    });
    if (!allowed) return res.status(403).json({ error: 'Not permitted to read this object' });
  }

  try {
    const params = { Bucket: cfg.bucket, Key: key };
    if (req.query.download === '1') {
      params.ResponseContentDisposition = `attachment; filename="${path.basename(key)}"`;
    }
    if (req.headers.range) params.Range = req.headers.range;

    const out = await s3().send(new GetObjectCommand(params));
    if (out.ContentType) res.setHeader('Content-Type', out.ContentType);
    if (out.ContentLength != null) res.setHeader('Content-Length', out.ContentLength);
    if (out.ContentRange) res.setHeader('Content-Range', out.ContentRange);
    if (out.AcceptRanges) res.setHeader('Accept-Ranges', out.AcceptRanges);
    if (out.ContentRange) res.status(206);
    out.Body.on('error', () => res.destroy());
    out.Body.pipe(res);
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === 'NoSuchKey') return res.status(404).json({ error: 'Not found' });
    console.error('[files]', err.message);
    return res.status(502).json({ error: 'Storage error' });
  }
});
