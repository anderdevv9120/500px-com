import { checkUpload, cleanText, extensionFor, sniffMatches, sniffMediaType } from './rules.js';

export const json = (data, status = 200) =>
  status === 204 ? new Response(null, { status }) : Response.json(data, { status });

export const error = (status, message) => json({ error: message }, status);

export function withCors(response, request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim());
  const res = new Response(response.body, response);
  if (origin && allowed.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.headers.append('Vary', 'Origin');
  }
  return res;
}

export const toMedia = (row, origin) => ({
  id: row.id,
  albumId: row.album_id,
  kind: row.kind,
  url: `${origin}/media/${row.r2_key}`,
  title: row.title,
  author: row.author,
  contentType: row.content_type,
  size: row.size,
  createdAt: row.created_at,
});

const toAlbum = (row, origin) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  createdAt: row.created_at,
  count: row.count,
  cover: row.cover_key ? { url: `${origin}/media/${row.cover_key}`, kind: row.cover_kind } : null,
});

async function listAlbums(env, origin) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, COUNT(m.id) AS count,
       (SELECT r2_key FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_key,
       (SELECT kind FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_kind
     FROM albums a JOIN media m ON m.album_id = a.id
     GROUP BY a.id ORDER BY a.created_at DESC, a.rowid DESC`,
  ).all();
  return json(results.map((r) => toAlbum(r, origin)));
}

async function getAlbum(env, origin, id) {
  const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
  if (!album) return error(404, 'Album not found');
  const { results } = await env.DB.prepare(
    'SELECT * FROM media WHERE album_id = ? ORDER BY created_at, rowid',
  ).bind(id).all();
  if (!results.length) return error(404, 'Album not found');
  return json({
    id: album.id,
    title: album.title,
    description: album.description,
    createdAt: album.created_at,
    media: results.map((r) => toMedia(r, origin)),
  });
}

async function listMedia(env, origin, url) {
  const asked = parseInt(url.searchParams.get('limit'), 10);
  const limit = Number.isNaN(asked) ? 200 : Math.min(Math.max(asked, 1), 200);
  const { results } = await env.DB.prepare(
    'SELECT * FROM media ORDER BY created_at DESC, rowid DESC LIMIT ?',
  ).bind(limit).all();
  return json(results.map((r) => toMedia(r, origin)));
}

async function createAlbum(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be valid JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return error(400, 'Request body must be a JSON object');
  }
  const title = cleanText(body.title, 60);
  if (!title) return error(400, 'Album title is required');
  const album = {
    id: crypto.randomUUID(),
    title,
    description: cleanText(body.description, 280),
    created_at: Date.now(),
  };
  await env.DB.prepare('INSERT INTO albums (id, title, description, created_at) VALUES (?, ?, ?, ?)')
    .bind(album.id, album.title, album.description, album.created_at)
    .run();
  return json(toAlbum({ ...album, count: 0 }, ''), 201);
}

const HOUR_MS = 60 * 60 * 1000;

async function ipHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function uploadMedia(request, env, origin, url, albumId) {
  const album = await env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(albumId).first();
  if (!album) return error(404, 'Album not found');

  const lengthHeader = request.headers.get('Content-Length');
  if (lengthHeader === null) return error(411, 'Content-Length header is required');
  if (!/^\d+$/.test(lengthHeader)) return error(400, 'Content-Length must be a non-negative integer');
  const size = Number(lengthHeader);
  if (size === 0) return error(400, 'The file is empty');

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const check = checkUpload({ contentType, size });
  if (!check.ok) return error(check.status, check.error);

  // ponytail: cap/rate checks race under concurrent uploads; fine for a demo, use a Durable Object counter if it matters
  const hash = await ipHash(request);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE ip_hash = ? AND created_at > ?')
    .bind(hash, Date.now() - HOUR_MS).first();
  if (n >= Number(env.UPLOADS_PER_HOUR)) return error(429, 'Upload limit reached — try again in an hour.');
  const { used } = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM media').first();
  if (used + size > Number(env.STORAGE_CAP_BYTES)) return error(507, 'Demo storage is full.');

  // ponytail: ext comes from the declared type (the sniff runs after the write); identical to the sniffed ext for images
  const id = crypto.randomUUID();
  const key = `${albumId}/${id}.${extensionFor(contentType)}`;
  const stored = await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });
  try {
    const head = await env.MEDIA.get(key, { range: { offset: 0, length: 16 } });
    const sniffed = sniffMediaType(new Uint8Array(await head.arrayBuffer()));
    if (!sniffMatches(contentType, sniffed)) {
      await env.MEDIA.delete(key);
      return error(415, "That file doesn't look like a supported photo or video.");
    }
    const row = {
      id,
      album_id: albumId,
      r2_key: key,
      kind: check.kind,
      content_type: contentType,
      size: stored.size,
      title: cleanText(url.searchParams.get('title'), 100, 'Untitled'),
      author: cleanText(url.searchParams.get('author'), 40, 'Guest'),
      created_at: Date.now(),
    };
    await env.DB.prepare(
      'INSERT INTO media (id, album_id, r2_key, kind, content_type, size, title, author, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(row.id, row.album_id, row.r2_key, row.kind, row.content_type, row.size, row.title, row.author, hash, row.created_at).run();
    return json(toMedia(row, origin), 201);
  } catch (err) {
    await env.MEDIA.delete(key);
    throw err;
  }
}

async function serveMedia(request, env, key) {
  const object = await env.MEDIA.get(key, { range: request.headers });
  if (!object) return error(404, 'Not found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (request.headers.has('Range') && object.range) {
    // R2Range may echo the request shape: {offset, length?} | {offset?, length} | {suffix}
    const r = object.range;
    const offset = r.offset ?? (r.suffix != null ? object.size - r.suffix : 0);
    const length = r.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

async function route(request, env) {
  const url = new URL(request.url);
  const { origin, pathname } = url;
  const { method } = request;
  if (method === 'OPTIONS') return json(null, 204);

  const albumMatch = pathname.match(/^\/api\/albums\/([^/]+)$/);
  if (pathname === '/api/albums' && method === 'GET') return listAlbums(env, origin);
  if (pathname === '/api/albums' && method === 'POST') return createAlbum(request, env);
  if (albumMatch && method === 'GET') return getAlbum(env, origin, albumMatch[1]);
  const uploadMatch = pathname.match(/^\/api\/albums\/([^/]+)\/media$/);
  if (uploadMatch && method === 'PUT') return uploadMedia(request, env, origin, url, uploadMatch[1]);
  const mediaMatch = pathname.match(/^\/media\/(.+)$/);
  if (mediaMatch && method === 'GET') return serveMedia(request, env, mediaMatch[1]);
  if (pathname === '/api/media' && method === 'GET') return listMedia(env, origin, url);
  return error(404, 'Not found');
}

export default {
  async fetch(request, env, ctx) {
    let response;
    try {
      response = await route(request, env, ctx);
    } catch (err) {
      console.error(err);
      response = error(500, 'Something went wrong');
    }
    return withCors(response, request, env);
  },
};
