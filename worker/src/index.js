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
  owner: row.username,
  count: row.count,
  cover: row.cover_key ? { url: `${origin}/media/${row.cover_key}`, kind: row.cover_kind } : null,
});

// ?user=<username> narrows the public listings to one account
async function listAlbums(env, origin, url) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.username, COUNT(m.id) AS count,
       (SELECT r2_key FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_key,
       (SELECT kind FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_kind
     FROM albums a JOIN media m ON m.album_id = a.id JOIN users u ON u.id = a.user_id
     WHERE ?1 IS NULL OR u.username = ?1
     GROUP BY a.id ORDER BY a.created_at DESC, a.rowid DESC`,
  ).bind(url.searchParams.get('user')).all();
  return json(results.map((r) => toAlbum(r, origin)));
}

async function getAlbum(env, origin, id) {
  const album = await env.DB.prepare('SELECT a.*, u.username FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?').bind(id).first();
  if (!album) return error(404, 'Album not found');
  const { results } = await env.DB.prepare(
    'SELECT * FROM media WHERE album_id = ? ORDER BY created_at, rowid',
  ).bind(id).all();
  if (!results.length) return error(404, 'Album not found');
  return json({
    id: album.id,
    title: album.title,
    description: album.description,
    owner: album.username,
    createdAt: album.created_at,
    media: results.map((r) => toMedia(r, origin)),
  });
}

async function listMedia(env, origin, url) {
  const asked = parseInt(url.searchParams.get('limit'), 10);
  const limit = Number.isNaN(asked) ? 200 : Math.min(Math.max(asked, 1), 200);
  const { results } = await env.DB.prepare(
    `SELECT m.* FROM media m JOIN albums a ON a.id = m.album_id JOIN users u ON u.id = a.user_id
     WHERE ?2 IS NULL OR u.username = ?2 ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?1`,
  ).bind(limit, url.searchParams.get('user')).all();
  return json(results.map((r) => toMedia(r, origin)));
}

const readJson = (request) => request.json()
  .then((body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : null), () => null);

async function createAlbum(request, env, user) {
  const body = await readJson(request);
  if (!body) return error(400, 'Request body must be a JSON object');
  const title = cleanText(body.title, 60);
  if (!title) return error(400, 'Album title is required');
  const album = {
    id: crypto.randomUUID(),
    title,
    description: cleanText(body.description, 280),
    created_at: Date.now(),
  };
  await env.DB.prepare('INSERT INTO albums (id, user_id, title, description, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(album.id, user.id, album.title, album.description, album.created_at)
    .run();
  return json(toAlbum({ ...album, username: user.username, count: 0 }, ''), 201);
}

const HOUR_MS = 60 * 60 * 1000;

const encode = (text) => new TextEncoder().encode(text);
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encode(text)));
// equal-length digests, no early exit: neither content nor length leaks via timing
const sameDigest = (a, b) => a.length === b.length && a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
const bearer = (request) => (request.headers.get('Authorization') || '').match(/^Bearer (.*)$/)?.[1] ?? '';

const ipHash = async (request) => hex(await sha256(request.headers.get('CF-Connecting-IP') || 'local'));

// ---- accounts ----
// ponytail: 50k PBKDF2 rounds (~7 ms) to fit the free plan's 10 ms CPU budget; raise PBKDF2_ROUNDS
// (workerd caps it at 100k) on a paid plan. Rounds are stored per hash, so old passwords keep working.
const PBKDF2_ROUNDS = 50000;
const SESSION_MS = 30 * 24 * HOUR_MS;

async function pbkdf2(password, salt, rounds) {
  const key = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encode(salt), iterations: rounds }, key, 256));
}

async function startSession(env, user) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)')
    .bind(hex(await sha256(token)), user.id, Date.now()).run();
  return { token, username: user.username };
}

async function readCredentials(request) {
  const body = await readJson(request);
  const username = cleanText(body?.username, 30);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username) return { invalid: error(400, 'Username is required') };
  if (password.length < 6 || password.length > 200) return { invalid: error(400, 'Password must be 6–200 characters') };
  return { username, password };
}

async function signup(request, env) {
  const { username, password, invalid } = await readCredentials(request);
  if (invalid) return invalid;
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const user = { id: crypto.randomUUID(), username };
  try {
    await env.DB.prepare('INSERT INTO users (id, username, password, created_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, username, `${PBKDF2_ROUNDS}:${salt}:${await pbkdf2(password, salt, PBKDF2_ROUNDS)}`, Date.now()).run();
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return error(409, 'That username is taken');
    throw err;
  }
  return json(await startSession(env, user), 201);
}

// ponytail: no login throttling; add a per-IP attempt counter (like the upload limit) if accounts get abused
async function login(request, env) {
  const { username, password, invalid } = await readCredentials(request);
  if (invalid) return invalid;
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user) return error(401, 'Wrong username or password');
  const [rounds, salt, stored] = user.password.split(':');
  if (!sameDigest(encode(await pbkdf2(password, salt, Number(rounds))), encode(stored))) return error(401, 'Wrong username or password');
  return json(await startSession(env, user));
}

async function logout(request, env) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hex(await sha256(bearer(request)))).run();
  return json(null, 204);
}

async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  return env.DB.prepare(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.created_at > ?',
  ).bind(hex(await sha256(token)), Date.now() - SESSION_MS).first();
}

async function uploadMedia(request, env, origin, url, albumId, user) {
  const album = await env.DB.prepare('SELECT user_id FROM albums WHERE id = ?').bind(albumId).first();
  if (!album) return error(404, 'Album not found');
  if (album.user_id !== user.id) return error(403, 'You can only upload to your own albums');

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
      author: user.username,
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

async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const [a, b] = await Promise.all([sha256(bearer(request)), sha256(env.ADMIN_TOKEN)]);
  return sameDigest(a, b);
}

async function deleteAlbum(env, id) {
  const album = await env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(id).first();
  if (!album) return error(404, 'Album not found');
  const { results } = await env.DB.prepare('SELECT r2_key FROM media WHERE album_id = ?').bind(id).all();
  // ponytail: R2 delete takes up to 1000 keys per call; fine for a demo capped by storage, chunk if it ever matters
  if (results.length) await env.MEDIA.delete(results.map((r) => r.r2_key));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media WHERE album_id = ?').bind(id),
    env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(id),
  ]);
  return json(null, 204);
}

async function deleteMedia(env, id) {
  const row = await env.DB.prepare('SELECT r2_key FROM media WHERE id = ?').bind(id).first();
  if (!row) return error(404, 'Media not found');
  await env.MEDIA.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
  return json(null, 204);
}

async function route(request, env) {
  const url = new URL(request.url);
  const { origin, pathname } = url;
  const { method } = request;
  if (method === 'OPTIONS') return json(null, 204);

  if (method === 'POST' && pathname === '/api/signup') return signup(request, env);
  if (method === 'POST' && pathname === '/api/login') return login(request, env);
  if (method === 'POST' && pathname === '/api/logout') return logout(request, env);

  const albumMatch = pathname.match(/^\/api\/albums\/([^/]+)$/);
  const uploadMatch = pathname.match(/^\/api\/albums\/([^/]+)\/media$/);
  if (pathname === '/api/albums' && method === 'GET') return listAlbums(env, origin, url);
  if (albumMatch && method === 'GET') return getAlbum(env, origin, albumMatch[1]);
  if ((pathname === '/api/albums' && method === 'POST') || (uploadMatch && method === 'PUT')) {
    const user = await currentUser(request, env);
    if (!user) return error(401, 'Log in to upload');
    return uploadMatch ? uploadMedia(request, env, origin, url, uploadMatch[1], user) : createAlbum(request, env, user);
  }
  const mediaMatch = pathname.match(/^\/media\/(.+)$/);
  if (mediaMatch && method === 'GET') return serveMedia(request, env, mediaMatch[1]);
  if (pathname === '/api/media' && method === 'GET') return listMedia(env, origin, url);
  const mediaIdMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
  if ((albumMatch || mediaIdMatch) && method === 'DELETE') {
    if (!(await isAdmin(request, env))) return error(401, 'Admin token required');
    return albumMatch ? deleteAlbum(env, albumMatch[1]) : deleteMedia(env, mediaIdMatch[1]);
  }
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
