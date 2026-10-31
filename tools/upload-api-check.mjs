// Run against `wrangler dev`: node tools/upload-api-check.mjs
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://127.0.0.1:8787';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';

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
