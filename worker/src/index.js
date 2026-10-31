import { cleanText } from './rules.js';

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

async function route(request, env) {
  const url = new URL(request.url);
  const { origin, pathname } = url;
  const { method } = request;
  if (method === 'OPTIONS') return json(null, 204);

  const albumMatch = pathname.match(/^\/api\/albums\/([^/]+)$/);
  if (pathname === '/api/albums' && method === 'GET') return listAlbums(env, origin);
  if (pathname === '/api/albums' && method === 'POST') return createAlbum(request, env);
  if (albumMatch && method === 'GET') return getAlbum(env, origin, albumMatch[1]);
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
