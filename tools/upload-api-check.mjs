// Requires worker/.dev.vars with an ImageKit key for a disposable media library.
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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'quyenday';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'quyenday123';
let ADMIN_TOKEN;

const UPLOADS_PER_HOUR = Number(process.env.CHECK_UPLOADS_PER_HOUR);
const STORAGE_CAP = Number(process.env.CHECK_STORAGE_CAP);

const call = (path, init) => fetch(API + path, init);
const postJson = (path, body, token) => call(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
});
const login = async (username = ADMIN_USERNAME, password = ADMIN_PASSWORD) => {
  const res = await postJson('/api/login', { username, password });
  assert.equal(res.status, 200);
  return (await res.json()).token;
};
const createUser = async (username, password = 'secret1') => {
  const res = await postJson('/api/admin/users', { username, password }, ADMIN_TOKEN);
  assert.equal(res.status, 201);
  return login(username, password);
};
let token; // the account every section below uploads as
const postAlbum = (body, as = token) => postJson('/api/albums', body, as);

// ---- smoke (production-safe: everything it creates is deleted) ----
//   API_URL=https://<worker>.workers.dev ADMIN_PASSWORD=<password> node tools/upload-api-check.mjs --smoke
if (process.argv.includes('--smoke')) {
  assert.ok(process.env.ADMIN_PASSWORD, 'set ADMIN_PASSWORD for production smoke checks');
  const site = 'https://anderdevv9120.github.io';
  const pre = await call('/api/albums', { method: 'OPTIONS', headers: { Origin: site } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), site);

  token = ADMIN_TOKEN = await login();
  const created = await postAlbum({ title: 'Smoke test' });
  assert.equal(created.status, 201);
  const albumPath = `/api/albums/${(await created.json()).id}`;
  try {
    const png = await readFile(new URL('../assets/0072-zeiss-badge-hGfrjZ9e.png', import.meta.url));
    const res = await call(`${albumPath}/media?title=smoke`, { method: 'PUT', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: png });
    assert.equal(res.status, 201);
    const media = await res.json();
    const albums = await (await call('/api/albums')).json();
    assert.equal(albums.find((a) => a.id === media.albumId)?.count, 1);
    const ranged = await fetch(media.url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-3/${png.length}`);
  } finally {
    const del = await call(albumPath, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    assert.equal(del.status, 204, 'smoke album was not deleted — remove it by hand');
  }
  assert.equal((await call(albumPath)).status, 404);
  console.log('smoke: ok');
  process.exit(0);
}

// ---- accounts ----
{
  const name = ADMIN_USERNAME;
  token = ADMIN_TOKEN = await login();
  assert.match(token, /^[0-9a-f]{64}$/);

  assert.equal((await postJson('/api/signup', { username: name.toUpperCase(), password: 'secret1' })).status, 403);
  assert.equal((await postJson('/api/signup', { username: 'bob', password: '12345' })).status, 403);
  assert.equal((await postJson('/api/signup', { username: '   ', password: 'secret1' })).status, 403);
  assert.equal((await postJson('/api/signup', ['nope'])).status, 403);

  const ok = await postJson('/api/login', { username: name.toUpperCase(), password: ADMIN_PASSWORD });
  assert.equal(ok.status, 200);
  const session = await ok.json();
  assert.equal(session.username, name);
  assert.notEqual(session.token, token);
  assert.equal((await postJson('/api/login', { username: name, password: 'secret2' })).status, 401);
  assert.equal((await postJson('/api/login', { username: 'nobody-here', password: 'secret1' })).status, 401);

  assert.equal((await postAlbum({ title: 'x' }, null)).status, 401);
  assert.equal((await postAlbum({ title: 'x' }, 'f'.repeat(64))).status, 401);
  assert.equal((await postAlbum({ title: 'x' }, session.token)).status, 201);
  assert.equal((await call('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })).status, 204);
  assert.equal((await postAlbum({ title: 'x' }, session.token)).status, 401, 'logged-out token must stop working');
  assert.equal((await postAlbum({ title: 'x' })).status, 201, 'other sessions keep working');
  console.log('accounts: ok');
}

// ---- albums ----
{
  const res = await postAlbum({ title: '  Trip  ', description: 'd' });
  assert.equal(res.status, 201);
  const album = await res.json();
  assert.equal(album.title, 'Trip');
  assert.equal(album.description, 'd');
  assert.equal(album.count, 0);
  assert.equal(album.cover, null);
  assert.equal(album.owner, ADMIN_USERNAME);

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
  const put = (id, query, type, body, as = token) =>
    call(`/api/albums/${id}/media?${query}`, { method: 'PUT', headers: { 'Content-Type': type, ...(as && { Authorization: `Bearer ${as}` }) }, body });
  const tiny = await readFile(new URL('../assets/0410-IE9JII6Z1Ys.png', import.meta.url));
  assert.ok(STORAGE_CAP > png.length + UPLOADS_PER_HOUR * tiny.length && STORAGE_CAP < 2 * png.length, 'CHECK_STORAGE_CAP must fit one PNG plus the small fixtures, but not two PNGs');

  const res = await put(album.id, 'title=%3Cb%3Ex%3C%2Fb%3E&author=Spoof', 'image/png', png);
  assert.equal(res.status, 201);
  const media = await res.json();
  assert.equal(media.kind, 'image');
  assert.equal(media.author, album.owner, 'author is the account, not a query param');
  assert.equal(media.title, '<b>x</b>');
  assert.equal(media.contentType, 'image/png');
  assert.equal(media.size, png.length);
  assert.equal(new URL(media.url).protocol, 'https:');
  assert.ok(new URL(media.url).pathname.includes(`/500px/albums/${album.id}/`), media.url);

  const albums = await (await call('/api/albums')).json();
  const listed = albums.find((a) => a.id === album.id);
  assert.equal(listed.count, 1);
  assert.equal(listed.cover.kind, 'image');
  assert.equal(listed.owner, album.owner);
  assert.equal((await (await call(`/api/albums?user=${album.owner}`)).json()).length, 1);
  assert.equal((await (await call('/api/albums?user=nobody-here')).json()).length, 0);
  assert.equal((await (await call(`/api/media?user=${album.owner}`)).json()).length, 1);
  assert.equal((await (await call('/api/media?user=nobody-here')).json()).length, 0);
  assert.equal((await (await call(`/api/albums/${album.id}`)).json()).owner, album.owner);

  const mallory = await createUser(`mallory${Date.now()}`);
  assert.equal((await put(album.id, 'title=m', 'image/png', png, mallory)).status, 403, "can't upload into someone else's album");
  assert.equal((await put(album.id, 'title=m', 'image/png', png, null)).status, 401);

  const full = await fetch(media.url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.equal((await full.arrayBuffer()).byteLength, png.length);

  const ranged = await fetch(media.url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 4);
  assert.equal(ranged.headers.get('content-range'), `bytes 0-3/${png.length}`);
  const n = png.length;
  const open = await fetch(media.url, { headers: { Range: 'bytes=0-' } });
  assert.equal(open.status, 206);
  assert.equal(open.headers.get('content-range'), `bytes 0-${n - 1}/${n}`);
  assert.equal((await open.arrayBuffer()).byteLength, n);
  const suffix = await fetch(media.url, { headers: { Range: 'bytes=-4' } });
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
      { method: 'PUT', headers: { 'Content-Type': 'image/png', 'Content-Length': 20971521, Authorization: `Bearer ${token}` } },
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
  const tiny = await readFile(new URL('../assets/0410-IE9JII6Z1Ys.png', import.meta.url));

  // the media section left the rate limit full and storage near the cap: free it by deleting its rows
  const leftovers = await (await call('/api/media')).json();
  assert.ok(leftovers.length >= 1);
  const [first, ...rest] = leftovers;
  const firstPath = `/api/media/${first.id}`;
  assert.equal((await del(firstPath)).status, 401);
  assert.equal((await del(firstPath, 'wrong')).status, 401);
  assert.equal((await fetch(first.url)).status, 200, 'rejected delete must not remove the object');
  assert.equal((await del(firstPath, ADMIN_TOKEN)).status, 204);
  assert.equal((await (await call('/api/media')).json()).some(m => m.id === first.id), false);
  assert.equal((await del(firstPath, ADMIN_TOKEN)).status, 404);
  for (const m of rest) assert.equal((await del(`/api/media/${m.id}`, ADMIN_TOKEN)).status, 204);
  assert.equal((await (await call('/api/media')).json()).length, 0);

  const album = await (await postAlbum({ title: 'Doomed' })).json();
  const mediaIds = [];
  for (const body of [png, tiny]) {
    const res = await call(`/api/albums/${album.id}/media?title=d`, { method: 'PUT', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body });
    assert.equal(res.status, 201);
    mediaIds.push((await res.json()).id);
  }
  const albumPath = `/api/albums/${album.id}`;
  assert.equal((await del(albumPath)).status, 401);
  assert.equal((await del(albumPath, 'wrong')).status, 401);
  assert.equal((await call(albumPath)).status, 200);
  assert.equal((await del(albumPath, ADMIN_TOKEN)).status, 204);
  assert.equal((await call(albumPath)).status, 404);
  const remaining = await (await call('/api/media')).json();
  for (const id of mediaIds) assert.equal(remaining.some(m => m.id === id), false);
  assert.equal((await del(albumPath, ADMIN_TOKEN)).status, 404);

  assert.equal((await del('/api/media/does-not-exist', ADMIN_TOKEN)).status, 404);
  assert.equal((await del('/api/albums/does-not-exist', ADMIN_TOKEN)).status, 404);
  assert.equal((await del('/api/media/does-not-exist')).status, 401, 'auth is checked before existence');
  console.log('admin: ok');
}
