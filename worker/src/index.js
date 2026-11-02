import { checkUpload, cleanText, extensionFor, posterTime, sniffMatches, sniffMediaType } from './rules.js';
import catalog from '../../catalog.json' with { type: 'json' };

export const json = (data, status = 200) =>
  status === 204 ? new Response(null, { status }) : Response.json(data, { status, headers:{'Cache-Control':'no-store'} });

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
  description: row.description || '',
  author: row.author,
  ownerId: row.user_id,
  contentType: row.content_type,
  size: row.size,
  posterTime: row.poster_time,
  createdAt: row.created_at,
});

const toAlbum = (row, origin) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  createdAt: row.created_at,
  owner: row.username,
  count: row.count,
  cover: row.cover_key ? { url: `${origin}/media/${row.cover_key}`, kind: row.cover_kind, posterTime: row.cover_poster } : null,
});

// ?user=<username> narrows the public listings to one account
async function listAlbums(env, origin, url) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.username, COUNT(m.id) AS count,
       (SELECT r2_key FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_key,
       (SELECT kind FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_kind,
       (SELECT poster_time FROM media WHERE album_id = a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS cover_poster
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
  if (body.ownerId != null && typeof body.ownerId !== 'string') return error(400, 'Choose an existing user');
  const owner = body.ownerId ? await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(body.ownerId).first() : user;
  if (!owner) return error(400, 'Choose an existing user');
  const album = {
    id: crypto.randomUUID(),
    title,
    description: cleanText(body.description, 280),
    created_at: Date.now(),
  };
  await env.DB.prepare('INSERT INTO albums (id, user_id, title, description, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(album.id, owner.id, album.title, album.description, album.created_at)
    .run();
  return json(toAlbum({ ...album, username: owner.username, count: 0 }, ''), 201);
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
  return { token, username: user.username, isAdmin: user.is_admin === 1 };
}

async function readCredentials(request) {
  const body = await readJson(request);
  const username = cleanText(body?.username, 30);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username) return { invalid: error(400, 'Username is required') };
  if (password.length < 6 || password.length > 200) return { invalid: error(400, 'Password must be 6–200 characters') };
  return { username, password };
}

async function createUser(request, env) {
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
  return json({id: user.id, username, isAdmin: false}, 201);
}

// ponytail: no login throttling; add a per-IP attempt counter (like the upload limit) if accounts get abused
async function login(request, env) {
  const { username, password, invalid } = await readCredentials(request);
  if (invalid) return invalid;
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user || !user.password.includes(':')) return error(401, 'Wrong username or password');
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
    'SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.created_at > ?',
  ).bind(hex(await sha256(token)), Date.now() - SESSION_MS).first();
}

async function uploadMedia(request, env, origin, url, albumId, user) {
  const album = await env.DB.prepare('SELECT a.user_id, u.username FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?').bind(albumId).first();
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
      author: album.username,
      poster_time: check.kind === 'video' ? posterTime(url.searchParams.get('poster')) : 0,
      created_at: Date.now(),
    };
    await env.DB.prepare(
      'INSERT INTO media (id, album_id, r2_key, kind, content_type, size, title, author, poster_time, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(row.id, row.album_id, row.r2_key, row.kind, row.content_type, row.size, row.title, row.author, row.poster_time, hash, row.created_at).run();
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

async function deleteAlbum(env, id) {
  const album = await env.DB.prepare('SELECT user_id FROM albums WHERE id = ?').bind(id).first();
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
  const row = await env.DB.prepare('SELECT m.r2_key, m.album_id, a.user_id FROM media m JOIN albums a ON a.id = m.album_id WHERE m.id = ?').bind(id).first();
  if (!row) return error(404, 'Media not found');
  await env.MEDIA.delete(row.r2_key);
  // an album with no media is invisible everywhere, so drop it with its last item
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM albums WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM media WHERE album_id = ?1)').bind(row.album_id),
  ]);
  return json(null, 204);
}

async function listOverrides(env) {
  const { results } = await env.DB.prepare('SELECT p.*, u.username AS author FROM photo_overrides p LEFT JOIN users u ON u.id = p.user_id').all();
  return results.map(row => ({id: row.id, title: row.title, description: row.description, ownerId: row.user_id, author: row.author, createdAt: row.created_at, deleted: Boolean(row.deleted)}));
}

async function adminUsers(request, env, id) {
  if (request.method === 'GET' && !id) {
    const { results } = await env.DB.prepare('SELECT id, username, is_admin AS isAdmin FROM users ORDER BY is_admin DESC, username').all();
    return json(results);
  }
  if (request.method === 'POST' && !id) return createUser(request, env);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id || '').first();
  if (!user) return error(404, 'User not found');
  if (request.method === 'GET') {
    const owned = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM media m JOIN albums a ON a.id = m.album_id WHERE a.user_id = ?1) + (SELECT COUNT(*) FROM photo_overrides WHERE user_id = ?1 AND deleted = 0) AS n').bind(id).first();
    return json({id:user.id, username:user.username, isAdmin:Boolean(user.is_admin), mediaCount:owned.n});
  }
  if (user.is_admin) return error(403, 'The main admin account is protected');
  if (request.method === 'DELETE') {
    const owned = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM media m JOIN albums a ON a.id = m.album_id WHERE a.user_id = ?1) + (SELECT COUNT(*) FROM photo_overrides WHERE user_id = ?1 AND deleted = 0) AS n').bind(id).first();
    const body = await readJson(request);
    if (owned.n && body?.deleteMedia !== true) return error(409, 'This user has media. Confirm deletion to remove all of their albums, photos and videos.');
    const { results } = await env.DB.prepare('SELECT m.r2_key FROM media m JOIN albums a ON a.id = m.album_id WHERE a.user_id = ?').bind(id).all();
    for (let offset = 0; offset < results.length; offset += 1000) {
      await env.MEDIA.delete(results.slice(offset, offset + 1000).map(row => row.r2_key));
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      env.DB.prepare('UPDATE photo_overrides SET user_id = NULL, deleted = 1 WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM media WHERE album_id IN (SELECT id FROM albums WHERE user_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM albums WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
    return json(null, 204);
  }
  if (request.method !== 'PUT') return error(405, 'Method not allowed');
  const body = await readJson(request);
  const username = cleanText(body?.username, 30);
  if (!username) return error(400, 'Username is required');
  let password = user.password;
  if (body.password) {
    if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 200) return error(400, 'Password must be 6–200 characters');
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    password = `${PBKDF2_ROUNDS}:${salt}:${await pbkdf2(body.password, salt, PBKDF2_ROUNDS)}`;
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(username, id).first();
  if (taken) return error(409, 'That username is taken');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET username = ?, password = ? WHERE id = ?').bind(username, password, id),
    env.DB.prepare('UPDATE media SET author = ? WHERE album_id IN (SELECT id FROM albums WHERE user_id = ?)').bind(username, id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
  ]);
  return json({id, username, isAdmin: false});
}

async function editPhoto(request, env, id, seeded) {
  const source = seeded ? catalog.photos.find(photo => photo.href.split('/').pop() === id)
    : await env.DB.prepare('SELECT m.*, a.user_id FROM media m JOIN albums a ON a.id = m.album_id WHERE m.id = ?').bind(id).first();
  if (!source) return error(404, 'Photo not found');
  if (request.method === 'DELETE') {
    if (!seeded) return deleteMedia(env, id);
    await env.DB.prepare('INSERT INTO photo_overrides (id, title, description, deleted) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET deleted = 1').bind(id, source.title, '').run();
    return json(null, 204);
  }
  if (request.method !== 'PUT') return error(405, 'Method not allowed');
  const body = await readJson(request);
  const title = cleanText(body?.title, 100);
  const description = cleanText(body?.description, 280);
  const createdAt = body?.createdAt;
  if (!title) return error(400, 'Title is required');
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > 8640000000000000) return error(400, 'Choose a valid posting date');
  if (body.ownerId != null && typeof body.ownerId !== 'string') return error(400, 'Choose an existing user');
  const owner = body.ownerId ? await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(body.ownerId).first() : null;
  if ((body.ownerId || !seeded) && !owner) return error(400, 'Choose an existing user');
  if (seeded) {
    await env.DB.prepare('INSERT INTO photo_overrides (id, title, description, user_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, user_id = excluded.user_id, created_at = excluded.created_at, deleted = 0')
      .bind(id, title, description, owner?.id ?? null, createdAt).run();
  } else {
    const statements = [];
    let albumId = source.album_id;
    if (owner.id !== source.user_id) {
      // A single photo moves into a new album; its siblings keep their owner.
      albumId = crypto.randomUUID();
      statements.push(env.DB.prepare('INSERT INTO albums (id, user_id, title, description, created_at) VALUES (?, ?, ?, ?, ?)').bind(albumId, owner.id, title.slice(0, 60), description, createdAt));
    }
    statements.push(env.DB.prepare('UPDATE media SET title = ?, description = ?, created_at = ?, author = ?, album_id = ? WHERE id = ?').bind(title, description, createdAt, owner.username, albumId, id));
    statements.push(env.DB.prepare('DELETE FROM albums WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM media WHERE album_id = ?1)').bind(source.album_id));
    await env.DB.batch(statements);
  }
  return json({id, title, description, createdAt, ownerId: owner?.id ?? null});
}

async function route(request, env) {
  const url = new URL(request.url);
  const { origin, pathname } = url;
  const { method } = request;
  if (method === 'OPTIONS') return json(null, 204);

  if (pathname === '/api/signup') return error(403, 'Registration is disabled');
  if (method === 'POST' && pathname === '/api/login') return login(request, env);
  if (method === 'POST' && pathname === '/api/logout') return logout(request, env);
  if (pathname === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env);
    return user ? json({id: user.id, username: user.username, isAdmin: user.is_admin === 1}) : error(401, 'Log in first');
  }
  if (pathname === '/api/photo-overrides' && method === 'GET') return json(await listOverrides(env));
  if (pathname.startsWith('/api/admin/')) {
    const user = await currentUser(request, env);
    if (!user) return error(401, 'Log in first');
    if (!user.is_admin) return error(403, 'Only the main admin can manage content');
    const users = pathname.match(/^\/api\/admin\/users(?:\/([^/]+))?$/);
    if (users) return adminUsers(request, env, users[1]);
    if (pathname === '/api/admin/media' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT m.*, a.user_id FROM media m JOIN albums a ON a.id = m.album_id ORDER BY m.created_at DESC').all();
      return json(results.map(row => toMedia(row, origin)));
    }
    const photo = pathname.match(/^\/api\/admin\/(seeded|media)\/([^/]+)$/);
    if (photo) return editPhoto(request, env, photo[2], photo[1] === 'seeded');
    return error(404, 'Not found');
  }

  const albumMatch = pathname.match(/^\/api\/albums\/([^/]+)$/);
  const uploadMatch = pathname.match(/^\/api\/albums\/([^/]+)\/media$/);
  if (pathname === '/api/albums' && method === 'GET') return listAlbums(env, origin, url);
  if (albumMatch && method === 'GET') return getAlbum(env, origin, albumMatch[1]);
  if ((pathname === '/api/albums' && method === 'POST') || (uploadMatch && method === 'PUT')) {
    const user = await currentUser(request, env);
    if (!user) return error(401, 'Log in to upload');
    if (!user.is_admin) return error(403, 'Only the main admin can upload');
    return uploadMatch ? uploadMedia(request, env, origin, url, uploadMatch[1], user) : createAlbum(request, env, user);
  }
  const mediaMatch = pathname.match(/^\/media\/(.+)$/);
  if (mediaMatch && method === 'GET') return serveMedia(request, env, mediaMatch[1]);
  if (pathname === '/api/media' && method === 'GET') return listMedia(env, origin, url);
  const mediaIdMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
  if ((albumMatch || mediaIdMatch) && method === 'DELETE') {
    const user = await currentUser(request, env);
    if (!user) return error(401, 'Log in to delete');
    if (!user.is_admin) return error(403, 'Only the main admin can delete');
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
