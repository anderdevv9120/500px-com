// Run against a FRESH `wrangler dev` (the media section fills the rate limit and storage cap).
// From worker/ (PowerShell or Git Bash), with <tmp> an empty temp dir:
//   npx wrangler d1 migrations apply 500px-guest-uploads --local --persist-to <tmp>
//   WRANGLER_DISABLE_REQUEST_BODY_DRAINING=1 npx wrangler dev --port 8787 --persist-to <tmp> --var UPLOADS_PER_HOUR:6 --var STORAGE_CAP_BYTES:60000
// (the env var stops wrangler dev holding every response until the request body is drained, which would hide the early 413)
// then from the repo root:
//   CHECK_UPLOADS_PER_HOUR=6 CHECK_STORAGE_CAP=60000 node tools/upload-api-check.mjs
// (cap must sit between the size of assets/0072-zeiss-badge-hGfrjZ9e.png (44174 B) and twice that.)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';

const API = process.env.API_URL || 'http://127.0.0.1:8787';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';

const UPLOADS_PER_HOUR = Number(process.env.CHECK_UPLOADS_PER_HOUR);
const STORAGE_CAP = Number(process.env.CHECK_STORAGE_CAP);

const call = (path, init) => fetch(API + path, init);
const postAlbum = (body) =>
  call('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- albums ----
{
  const res = await postAlbum({ title: '  Trip  ', description: 'd' });
  assert.equal(res.status, 201);
  const album = await res.json();
  assert.equal(album.title, 'Trip');
  assert.equal(album.description, 'd');
  assert.equal(album.count, 0);
  assert.equal(album.cover, null);

  const blank = await postAlbum({ title: '   ' });
  assert.equal(blank.status, 400);
  assert.equal(typeof (await blank.json()).error, 'string');

  const long = await postAlbum({ title: 'x'.repeat(61) });
  assert.equal(long.status, 201);
  assert.equal((await long.json()).title.length, 60);

  const list = await (await call('/api/albums')).json();
  assert.ok(!list.some((a) => a.id === album.id), 'empty album must not be listed');

  assert.equal((await call(`/api/albums/${album.id}`)).status, 404);
  assert.equal((await call('/api/albums/does-not-exist')).status, 404);

  const ok = await call('/api/albums', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5000' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5000');

  const evil = await call('/api/albums', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  console.log('albums: ok');
}

// ---- media ----
{
  assert.ok(UPLOADS_PER_HOUR >= 2 && STORAGE_CAP > 0, 'set CHECK_UPLOADS_PER_HOUR and CHECK_STORAGE_CAP to the values given to wrangler dev');
  assert.equal((await (await call('/api/media')).json()).length, 0, 'media section needs a fresh wrangler state');

  const album = await (await postAlbum({ title: 'Media album' })).json();
  const png = await readFile(new URL('../assets/0072-zeiss-badge-hGfrjZ9e.png', import.meta.url));
  assert.ok(STORAGE_CAP > png.length + 5 * 32 && STORAGE_CAP < 2 * png.length, 'CHECK_STORAGE_CAP must be between 1x and 2x the PNG size');
  const put = (id, query, type, body, headers = {}) =>
    call(`/api/albums/${id}/media?${query}`, { method: 'PUT', headers: { 'Content-Type': type, ...headers }, body });
  const tiny = Buffer.concat([png.subarray(0, 8), Buffer.alloc(24)]);

  const res = await put(album.id, 'title=%3Cb%3Ex%3C%2Fb%3E&author=', 'image/png', png);
  assert.equal(res.status, 201);
  const media = await res.json();
  assert.equal(media.kind, 'image');
  assert.equal(media.author, 'Guest');
  assert.equal(media.title, '<b>x</b>');
  assert.equal(media.contentType, 'image/png');
  assert.equal(media.size, png.length);
  assert.ok(media.url.startsWith(`${API}/media/${album.id}/${media.id}.png`), media.url);

  const albums = await (await call('/api/albums')).json();
  const listed = albums.find((a) => a.id === album.id);
  assert.equal(listed.count, 1);
  assert.equal(listed.cover.kind, 'image');

  const full = await call(new URL(media.url).pathname);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.ok(full.headers.get('cache-control').includes('immutable'));
  assert.equal((await full.arrayBuffer()).byteLength, png.length);

  const ranged = await call(new URL(media.url).pathname, { headers: { Range: 'bytes=0-3' } });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 4);
  assert.equal(ranged.headers.get('content-range'), `bytes 0-3/${png.length}`);
  const n = png.length;
  const open = await call(new URL(media.url).pathname, { headers: { Range: 'bytes=0-' } });
  assert.equal(open.status, 206);
  assert.equal(open.headers.get('content-range'), `bytes 0-${n - 1}/${n}`);
  assert.equal((await open.arrayBuffer()).byteLength, n);
  const suffix = await call(new URL(media.url).pathname, { headers: { Range: 'bytes=-4' } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), `bytes ${n - 4}-${n - 1}/${n}`);
  assert.equal((await suffix.arrayBuffer()).byteLength, 4);
  assert.equal((await call(`/media/${album.id}/missing.png`)).status, 404);

  const fake = await put(album.id, 'title=fake', 'image/jpeg', Buffer.from('not an image at all'));
  assert.equal(fake.status, 415);
  assert.equal(typeof (await fake.json()).error, 'string');
  assert.equal((await (await call(`/api/albums/${album.id}`)).json()).media.length, 1);

  assert.equal((await put(album.id, 'title=h', 'image/heic', tiny)).status, 415);
  assert.equal((await put(album.id, 'title=p', 'application/pdf', tiny)).status, 415);
  assert.equal((await put('does-not-exist', 'title=x', 'image/png', tiny)).status, 404);
  assert.equal((await put(album.id, 'title=p', 'image/png; charset=binary', tiny)).status, 201);
  assert.equal((await put(album.id, 'title=e', 'image/png', Buffer.alloc(0))).status, 400);

  // fetch cannot set Content-Length by hand, so send only headers and never the body
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${API}/api/albums/${album.id}/media?title=big`,
      { method: 'PUT', headers: { 'Content-Type': 'image/png', 'Content-Length': 20971521 } },
      (r) => { r.resume(); resolve(r.statusCode); req.destroy(); },
    );
    req.on('error', (e) => (req.destroyed ? null : reject(e)));
    req.flushHeaders();
  });
  assert.equal(status, 413);

  // storage cap, checked while the rate limit still has room (cap is checked after it)
  const full507 = await put(album.id, 'title=again', 'image/png', png);
  assert.equal(full507.status, 507);
  assert.equal(typeof (await full507.json()).error, 'string');

  // 2 rows so far (png + charset one); fill up to the limit, then one more
  for (let i = 2; i < UPLOADS_PER_HOUR; i++) {
    assert.equal((await put(album.id, `title=t${i}`, 'image/png', tiny)).status, 201);
  }
  const limited = await put(album.id, 'title=over', 'image/png', tiny);
  assert.equal(limited.status, 429);
  assert.equal(typeof (await limited.json()).error, 'string');
  console.log('media: ok');
}

// ---- admin ----
{
  const del = (path, token) =>
    call(path, { method: 'DELETE', headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } });
  const png = await readFile(new URL('../assets/0072-zeiss-badge-hGfrjZ9e.png', import.meta.url));
  const tiny = Buffer.concat([png.subarray(0, 8), Buffer.alloc(24)]);

  // the media section left the rate limit full and storage near the cap: free it by deleting its rows
  const leftovers = await (await call('/api/media')).json();
  assert.ok(leftovers.length >= 1);
  const [first, ...rest] = leftovers;
  const firstPath = `/api/media/${first.id}`;
  assert.equal((await del(firstPath)).status, 401);
  assert.equal((await del(firstPath, 'wrong')).status, 401);
  assert.equal((await call(new URL(first.url).pathname)).status, 200, 'rejected delete must not remove the object');
  assert.equal((await del(firstPath, ADMIN_TOKEN)).status, 204);
  assert.equal((await call(new URL(first.url).pathname)).status, 404);
  assert.equal((await del(firstPath, ADMIN_TOKEN)).status, 404);
  for (const m of rest) assert.equal((await del(`/api/media/${m.id}`, ADMIN_TOKEN)).status, 204);
  assert.equal((await (await call('/api/media')).json()).length, 0);

  const album = await (await postAlbum({ title: 'Doomed' })).json();
  const urls = [];
  for (const body of [png.subarray(0, 100), tiny]) {
    const res = await call(`/api/albums/${album.id}/media?title=d`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body });
    assert.equal(res.status, 201);
    urls.push(new URL((await res.json()).url).pathname);
  }
  const albumPath = `/api/albums/${album.id}`;
  assert.equal((await del(albumPath)).status, 401);
  assert.equal((await del(albumPath, 'wrong')).status, 401);
  assert.equal((await call(albumPath)).status, 200);
  assert.equal((await del(albumPath, ADMIN_TOKEN)).status, 204);
  assert.equal((await call(albumPath)).status, 404);
  for (const u of urls) assert.equal((await call(u)).status, 404);
  assert.equal((await del(albumPath, ADMIN_TOKEN)).status, 404);

  assert.equal((await del('/api/media/does-not-exist', ADMIN_TOKEN)).status, 404);
  assert.equal((await del('/api/albums/does-not-exist', ADMIN_TOKEN)).status, 404);
  assert.equal((await del('/api/media/does-not-exist')).status, 401, 'auth is checked before existence');
  console.log('admin: ok');
}
