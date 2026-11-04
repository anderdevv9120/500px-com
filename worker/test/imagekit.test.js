import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteImageKitFile, deleteStoredMedia, uploadImageKit } from '../src/imagekit.js';

const env = { IMAGEKIT_PRIVATE_KEY: 'private_test' };
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,1,2,3]);
const options = { fileName:'photo.png', folder:'/500px/albums/album', contentType:'image/png', size:png.length };
const request = (bytes = png) => new Request('https://test.local/upload', {method:'PUT', body:bytes, duplex:'half'});
const file = {fileId:'file-1', url:'https://ik.imagekit.io/test/500px/albums/album/photo.png', size:png.length};

test('streams multipart bytes and checks signatures across chunk boundaries', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://upload.imagekit.io/api/v1/files/upload');
    assert.equal(init.headers.Authorization, `Basic ${btoa('private_test:')}`);
    const form = await new Request(url, init).formData();
    assert.equal(form.get('fileName'), options.fileName);
    assert.equal(form.get('folder'), options.folder);
    assert.equal(form.get('overwriteFile'), 'false');
    assert.equal(form.get('useUniqueFileName'), 'true');
    assert.equal(form.get('file').type, 'image/png');
    assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), png);
    return Response.json(file);
  });
  const fragmented = new ReadableStream({start(controller) {
    for (const byte of png) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  }});
  assert.deepEqual(await uploadImageKit(env, request(fragmented), options), {...file, url:`${file.url}?tr=orig-true`});
});

test('missing credentials and invalid signatures fail before provider calls', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected provider call'); });
  await assert.rejects(uploadImageKit({}, request(), options), {status:503});
  await assert.rejects(uploadImageKit(env, request(new TextEncoder().encode('not an image')), options), {status:415});
  await assert.rejects(uploadImageKit(env, request(), {...options, size:1}), {status:400});
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('streamed size mismatches and provider failures return generic errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    await new Response(init.body).arrayBuffer();
    return Response.json(file);
  });
  await assert.rejects(uploadImageKit(env, request(), {...options, size:png.length + 1}), {status:400});
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider detail', {status:401}));
  await assert.rejects(uploadImageKit(env, request(), options), {status:502, message:'Media storage is unavailable. Try again.'});
  t.mock.method(globalThis, 'fetch', async () => { throw Error('private provider detail'); });
  await assert.rejects(uploadImageKit(env, request(), options), {status:502});
});

test('invalid upload metadata cleans up the newly uploaded provider file', async (t) => {
  const deleted = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'DELETE') { deleted.push(url); return new Response(null, {status:204}); }
    await new Response(init.body).arrayBuffer();
    return Response.json({...file, url:'http://invalid.local/file'});
  });
  await assert.rejects(uploadImageKit(env, request(), options), {status:502});
  assert.deepEqual(deleted, ['https://api.imagekit.io/v1/files/file-1']);
});

test('single-file delete tolerates missing files; failed deletes preserve metadata', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {status:404}));
  await deleteImageKitFile(env, 'missing');
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {status:503}));
  await assert.rejects(deleteImageKitFile(env, 'file-1'), {status:502});
});

test('bulk cleanup records only successful IDs before reporting partial failure', async (t) => {
  const deleted = [];
  const storageEnv = {...env, DB:{prepare() { return {bind(...ids) {deleted.push(...ids); return this;}, async run() {}}; }}};
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {fileIds:['one','two']});
    return Response.json({successfullyDeletedFileIds:['one','unrelated']}, {status:207});
  });
  await assert.rejects(deleteStoredMedia(storageEnv, [{imagekit_file_id:'one'}, {imagekit_file_id:'two'}]), {status:502});
  assert.deepEqual(deleted, ['one']);
});
