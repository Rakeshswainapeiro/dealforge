import { pool } from './db.js';

// ---------------------------------------------------------------------------
// Organisation tree (REQ-ORG-01/02, E2.1).
//
// Rows are seeded from the real Sirius subtree (src/data/siriusOrgTree.js) on
// first boot. Each node carries a materialised `path` of ancestor ids
// ('/root/.../self') so descendant scoping is a single indexed prefix query.
// ---------------------------------------------------------------------------

function computePath(byId, id) {
  const parts = [];
  const seen = new Set();
  let cursor = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    parts.unshift(cursor);
    cursor = node.parent_id;
  }
  return '/' + parts.join('/');
}

export async function seedOrganizations(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Insert parents before children by level so the FK is always satisfiable.
    const ordered = [...nodes].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    for (const n of ordered) {
      const path = computePath(byId, n.id);
      await client.query(
        `INSERT INTO organization
           (id, name, type, parent_id, path, level, ownership_pct, geography, principal_activities, source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           parent_id = EXCLUDED.parent_id,
           path = EXCLUDED.path,
           level = EXCLUDED.level,
           ownership_pct = EXCLUDED.ownership_pct,
           geography = EXCLUDED.geography,
           principal_activities = EXCLUDED.principal_activities,
           source = EXCLUDED.source,
           updated_at = now()`,
        [
          n.id,
          n.name,
          n.type || 'subsidiary',
          n.parent_id || null,
          path,
          n.level ?? 0,
          n.ownership_pct ?? null,
          n.geography || null,
          n.principal_activities || null,
          n.source || null,
        ]
      );
    }
    await client.query('COMMIT');
    return ordered.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listOrganizations({ parentId, type } = {}) {
  const where = [];
  const params = [];
  if (parentId !== undefined) {
    params.push(parentId);
    where.push(`parent_id IS NOT DISTINCT FROM $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  const sql = `SELECT * FROM organization ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY level, name`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getOrganization(id) {
  const { rows } = await pool.query('SELECT * FROM organization WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function descendantIds(orgId) {
  if (!orgId) return [];
  const { rows } = await pool.query(
    `SELECT id FROM organization WHERE id = $1 OR path LIKE (
       (SELECT path FROM organization WHERE id = $1) || '/%'
     )`,
    [orgId]
  );
  return rows.map((r) => r.id);
}

export async function ancestorIds(orgId) {
  const node = await getOrganization(orgId);
  if (!node?.path) return [];
  return node.path.split('/').filter(Boolean);
}

// Build a nested tree from flat rows.
export function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function organizationTree() {
  return buildTree(await listOrganizations());
}
