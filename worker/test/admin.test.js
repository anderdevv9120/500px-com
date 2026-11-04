import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

// In-memory SQLite exercises the real migration and SQL without touching Cloudflare.
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of ['0001_init.sql','0002_users.sql','0003_poster_time.sql','0004_admin.sql','0005_imagekit.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const DB = {
    prepare(sql) {
      let values = [];
      const numbered = [];
      sql = sql.replace(/\?(\d+)/g, (_match,index) => { numbered.push(Number(index)-1); return '?'; });
      const args = () => numbered.length ? numbered.map(index=>values[index]) : values;
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...args()) || null; },
        async all() { return {results:sqlite.prepare(sql).all(...args())}; },
        async run() { return sqlite.prepare(sql).run(...args()); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results=[]; for(const statement of statements)results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch(error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const deleted = [];
  const env = {DB, IMAGEKIT_PRIVATE_KEY:'private_test', UPLOADS_PER_HOUR:'50', STORAGE_CAP_BYTES:'5368709120'};
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.headers.Authorization, `Basic ${btoa('private_test:')}`);
    if (url.endsWith('/batch/deleteByFileIds')) {
      const {fileIds}=JSON.parse(init.body); deleted.push(fileIds);
      return Response.json({successfullyDeletedFileIds:fileIds});
    }
    assert.equal(init.method,'DELETE');
    deleted.push(decodeURIComponent(url.split('/').pop()));
    return new Response(null,{status:204});
  });
  const call = (path, method='GET', body, token) => worker.fetch(new Request(`https://test.local${path}`, {
    method, headers:{'Content-Type':'application/json', ...(token && {Authorization:`Bearer ${token}`})},
    ...(body !== undefined && {body:JSON.stringify(body)}),
  }), env);
  return {sqlite,call,deleted,env};
}

test('admin account, registration closure, permissions and user lifecycle', async (t) => {
  const {sqlite,call}=fixture(t);
  try {
    assert.equal((await call('/api/signup','POST',{username:'new',password:'secret1'})).status,403);
    assert.equal((await call('/api/admin/users')).status,401);
    assert.equal((await call('/api/login','POST',{username:'quyenday',password:'wrong-password'})).status,401);
    const admin=await (await call('/api/login','POST',{username:'QUYENDAY',password:'quyenday123'})).json();
    assert.equal(admin.isAdmin,true);
    const users=await (await call('/api/admin/users','GET',undefined,admin.token)).json();
    assert.equal(users.length,1);
    assert.equal(Object.hasOwn(users[0],'password'),false);
    assert.equal((await call(`/api/admin/users/${users[0].id}`,'DELETE',undefined,admin.token)).status,403);
    const created=await call('/api/admin/users','POST',{username:'Alice',password:'secret1',is_admin:1},admin.token);
    assert.equal(created.status,201);
    const alice=await created.json();
    assert.equal(alice.isAdmin,false);
    assert.equal((await call('/api/admin/users','POST',{username:'ALICE',password:'secret1'},admin.token)).status,409);
    const regular=await (await call('/api/login','POST',{username:'Alice',password:'secret1'})).json();
    assert.equal((await call('/api/admin/users','GET',undefined,regular.token)).status,403);
    assert.equal((await call(`/api/admin/users/${alice.id}`,'GET',undefined,regular.token)).status,403);
    assert.equal((await call('/api/admin/users','POST',{username:'B',password:'secret1'},regular.token)).status,403);
    assert.equal((await call('/api/albums','POST',{title:'Blocked'},regular.token)).status,403);
    assert.equal((await call('/api/albums/unknown/media','PUT',{},regular.token)).status,403);
    assert.equal((await call('/api/media/unknown','DELETE',undefined,regular.token)).status,403);
    assert.equal((await call('/api/admin/seeded/SDjF7aAGorn','PUT',{},regular.token)).status,403);
    assert.equal((await call(`/api/admin/users/${alice.id}`,'PUT',{username:'Renamed',password:'changed1'},admin.token)).status,200);
    assert.equal((await call('/api/me','GET',undefined,regular.token)).status,401,'editing a user revokes its sessions');
    assert.equal((await call('/api/login','POST',{username:'Renamed',password:'changed1'})).status,200);
    assert.equal((await call('/api/albums','POST',{title:'Empty album',ownerId:alice.id},admin.token)).status,201);
    assert.equal((await call(`/api/admin/users/${alice.id}`,'DELETE',undefined,admin.token)).status,204);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin=1').get().n,1);
  } finally { sqlite.close(); }
});

test('photo metadata and transfer preserve siblings; seeded overrides persist', async (t) => {
  const {sqlite,call,deleted}=fixture(t);
  try {
    const {token}=await (await call('/api/login','POST',{username:'quyenday',password:'quyenday123'})).json();
    const owner=await (await call('/api/admin/users','POST',{username:'Owner',password:'secret1'},token)).json();
    const album=await (await call('/api/albums','POST',{title:'Album'},token)).json();
    const insert=sqlite.prepare("INSERT INTO media (id, album_id, imagekit_file_id, url, kind, content_type, size, title, author, ip_hash, created_at) VALUES (?, ?, ?, 'https://ik.imagekit.io/test/photo.png', 'image', 'image/png', 10, 'Original', 'quyenday', 'ip', 1000)");
    insert.run('one',album.id,'one.png'); insert.run('two',album.id,'two.png');
    assert.equal(sqlite.prepare('SELECT description FROM media WHERE id=?').get('one').description,'');
    assert.equal((await (await call('/api/media')).json()).find(photo=>photo.id==='one').description,'');
    const edit={title:'Updated <title>',description:'Description',createdAt:1700000000000,ownerId:owner.id};
    for(const createdAt of [null,'yesterday',-1,1.5,8640000000000001]) {
      assert.equal((await call('/api/admin/media/one','PUT',{...edit,createdAt},token)).status,400);
    }
    assert.equal((await call('/api/admin/media/one','PUT',{...edit,ownerId:'missing'},token)).status,400);
    assert.equal((await call('/api/admin/media/one','PUT',edit,token)).status,200);
    const one=sqlite.prepare('SELECT m.*, a.user_id FROM media m JOIN albums a ON a.id=m.album_id WHERE m.id=?').get('one');
    assert.equal(one.user_id,owner.id); assert.equal(one.title,edit.title); assert.equal(one.created_at,edit.createdAt);
    assert.equal(sqlite.prepare('SELECT album_id FROM media WHERE id=?').get('two').album_id,album.id);
    const listing=await (await call('/api/media?user=Owner')).json();
    assert.equal(listing[0].description,edit.description);
    assert.equal(listing[0].url,'https://ik.imagekit.io/test/photo.png');
    assert.equal((await (await call('/api/albums?user=Owner')).json())[0].cover.url,listing[0].url);
    assert.equal((await call('/api/admin/media/one','PUT',{...edit,description:''},token)).status,200);
    assert.equal((await (await call('/api/media?user=Owner')).json())[0].description,'');
    assert.equal((await call(`/api/admin/users/${owner.id}`,'DELETE',undefined,token)).status,409,'owned photos require explicit confirmation');
    assert.equal((await call('/api/admin/media/one','DELETE',undefined,token)).status,204);
    assert.deepEqual(deleted,['one.png']);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM albums WHERE id=?').get(one.album_id).n,0);
    assert.equal((await call('/api/admin/seeded/SDjF7aAGorn','PUT',edit,token)).status,200);
    const overrides=await (await call('/api/photo-overrides')).json();
    assert.equal(overrides[0].author,'Owner'); assert.equal(overrides[0].title,edit.title);
    assert.equal(overrides[0].description,edit.description);
    assert.equal((await call('/api/admin/seeded/SDjF7aAGorn','PUT',{...edit,description:''},token)).status,200);
    assert.equal((await (await call('/api/photo-overrides')).json())[0].description,'');
    assert.equal((await call(`/api/admin/users/${owner.id}`,'DELETE',undefined,token)).status,409);
    assert.equal((await call('/api/admin/seeded/SDjF7aAGorn','DELETE',undefined,token)).status,204);
    assert.equal((await (await call('/api/photo-overrides')).json())[0].deleted,true);
    assert.equal((await call(`/api/admin/users/${owner.id}`,'DELETE',undefined,token)).status,204);
    assert.equal((await call('/api/admin/seeded/not-a-photo','PUT',edit,token)).status,404);
  } finally { sqlite.close(); }
});

test('confirmed user deletion removes owned uploads, albums, sessions and seeded photos only', async (t) => {
  const {sqlite,call,deleted}=fixture(t);
  try {
    const {token}=await (await call('/api/login','POST',{username:'quyenday',password:'quyenday123'})).json();
    const owner=await (await call('/api/admin/users','POST',{username:'Owner',password:'secret1'},token)).json();
    const session=await (await call('/api/login','POST',{username:'Owner',password:'secret1'})).json();
    const album=await (await call('/api/albums','POST',{title:'Owned album',ownerId:owner.id},token)).json();
    await call('/api/albums','POST',{title:'Empty album',ownerId:owner.id},token);
    const other=await (await call('/api/albums','POST',{title:'Keep admin album'},token)).json();
    const insert=sqlite.prepare("INSERT INTO media (id, album_id, imagekit_file_id, kind, content_type, size, title, author, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, 10, 'Media', 'Owner', 'ip', 1000)");
    for(let i=0;i<1001;i++) insert.run(`owned-${i}`,album.id,`owned-${i}`,i%2?'video':'image',i%2?'video/mp4':'image/png');
    insert.run('keep',other.id,'keep.png','image','image/png');
    const seededId='SDjF7aAGorn';
    assert.equal((await call(`/api/admin/seeded/${seededId}`,'PUT',{title:'Transferred',description:'',ownerId:owner.id,createdAt:1000},token)).status,200);
    const path=`/api/admin/users/${owner.id}`;
    const detail=await (await call(path,'GET',undefined,token)).json();
    assert.equal(detail.mediaCount,1002);
    assert.equal(Object.hasOwn(detail,'password'),false);
    for(const body of [undefined,{deleteMedia:false},{deleteMedia:'true'}]) {
      assert.equal((await call(path,'DELETE',body,token)).status,409);
    }
    assert.deepEqual(deleted,[]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM media').get().n,1002);
    assert.equal((await call('/api/admin/users/trust-web-admin','DELETE',{deleteMedia:true},token)).status,403);
    assert.equal((await call(path,'DELETE',{deleteMedia:true},token)).status,204);
    assert.deepEqual(deleted.map(keys=>keys.length),[100,100,100,100,100,100,100,100,100,100,1]);
    assert.equal(new Set(deleted.flat()).size,1001);
    assert.equal(deleted.flat().includes('keep.png'),false);
    for(const table of ['users','sessions','albums']) {
      assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table==='users'?'id':'user_id'}=?`).get(owner.id).n,0);
    }
    assert.equal(sqlite.prepare('SELECT id FROM media').get().id,'keep');
    assert.equal(sqlite.prepare('SELECT id FROM albums').get().id,other.id);
    const override=sqlite.prepare('SELECT user_id, deleted FROM photo_overrides WHERE id=?').get(seededId);
    assert.equal(override.user_id,null); assert.equal(override.deleted,1);
    assert.equal((await call('/api/me','GET',undefined,session.token)).status,401);
  } finally { sqlite.close(); }
});

test('failed file cleanup keeps the user and metadata available for retry', async (t) => {
  const {sqlite,call}=fixture(t);
  try {
    const {token}=await (await call('/api/login','POST',{username:'quyenday',password:'quyenday123'})).json();
    const owner=await (await call('/api/admin/users','POST',{username:'Owner',password:'secret1'},token)).json();
    const album=await (await call('/api/albums','POST',{title:'Album',ownerId:owner.id},token)).json();
    sqlite.prepare("INSERT INTO media (id, album_id, imagekit_file_id, kind, content_type, size, title, author, ip_hash, created_at) VALUES ('one', ?, 'one.png', 'image', 'image/png', 10, 'Photo', 'Owner', 'ip', 1000)").run(album.id);
    t.mock.method(globalThis,'fetch',async()=>{throw Error('Storage unavailable');});
    assert.equal((await call(`/api/admin/users/${owner.id}`,'DELETE',{deleteMedia:true},token)).status,502);
    assert.equal(sqlite.prepare('SELECT id FROM users WHERE id=?').get(owner.id).id,owner.id);
    assert.equal(sqlite.prepare('SELECT album_id FROM media WHERE id=?').get('one').album_id,album.id);
  } finally { sqlite.close(); }
});

test('upload stores ImageKit identity and URL; a failed D1 insert cleans up the file', async (t) => {
  const {sqlite,call,env}=fixture(t);
  try {
    const {token}=await (await call('/api/login','POST',{username:'quyenday',password:'quyenday123'})).json();
    const album=await (await call('/api/albums','POST',{title:'ImageKit album'},token)).json();
    const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
    const deleted=[];
    let uploads=0;
    t.mock.method(globalThis,'fetch',async (url,init)=>{
      if(init.method==='DELETE') {deleted.push(url); return new Response(null,{status:204});}
      const form=await new Request(url,init).formData();
      assert.equal(form.get('folder'),`/500px/albums/${album.id}`);
      uploads++;
      return Response.json({fileId:`file-${uploads}`,url:`https://ik.imagekit.io/test/${form.get('fileName')}`,size:png.length});
    });
    const upload=()=>worker.fetch(new Request(`https://test.local/api/albums/${album.id}/media?title=Photo`,{
      method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/png','Content-Length':String(png.length)},body:png,
    }),env);
    const response=await upload();
    assert.equal(response.status,201);
    const media=await response.json();
    assert.equal(new URL(media.url).searchParams.get('tr'),'orig-true');
    assert.equal(sqlite.prepare('SELECT imagekit_file_id FROM media WHERE id=?').get(media.id).imagekit_file_id,'file-1');
    assert.equal((await (await call(`/api/albums/${album.id}`)).json()).media[0].url,media.url);
    sqlite.exec("CREATE TRIGGER fail_media BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT, 'Insert failed'); END");
    assert.equal((await upload()).status,500);
    assert.deepEqual(deleted,['https://api.imagekit.io/v1/files/file-2']);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM media').get().n,1);
  } finally { sqlite.close(); }
});

test('ImageKit migration clears old upload rows and preserves accounts and seeded edits', () => {
  const sqlite=new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys = ON');
    for(const name of ['0001_init.sql','0002_users.sql','0003_poster_time.sql','0004_admin.sql'])
      sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
    sqlite.exec("INSERT INTO albums VALUES ('old','trust-web-admin','Old album','',1000)");
    sqlite.exec("INSERT INTO media (id,album_id,r2_key,kind,content_type,size,title,author,ip_hash,created_at) VALUES ('old','old','old.png','image','image/png',10,'Photo','quyenday','ip',1000)");
    sqlite.exec("INSERT INTO photo_overrides (id,title,description) VALUES ('seeded','Edited','Description')");
    sqlite.exec(readFileSync(new URL('../migrations/0005_imagekit.sql',import.meta.url),'utf8'));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM albums').get().n,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    assert.equal(sqlite.prepare('SELECT title FROM photo_overrides').get().title,'Edited');
    assert.doesNotThrow(()=>sqlite.prepare('SELECT imagekit_file_id,url FROM media'));
  } finally {sqlite.close();}
});
