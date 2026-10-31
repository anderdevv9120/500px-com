// Needs `npm start` (127.0.0.1:5000) and a FRESH `wrangler dev` with default vars (127.0.0.1:8787):
//   cd worker; TMP=$(mktemp -d)
//   npx wrangler d1 migrations apply 500px-guest-uploads --local --persist-to "$TMP"
//   WRANGLER_DISABLE_REQUEST_BODY_DRAINING=1 npx wrangler dev --port 8787 --persist-to "$TMP"
// then: PLAYWRIGHT_MODULE=<path to playwright-core/index.mjs> node tools/uploads-check.mjs
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const origin=process.env.SITE_URL||'http://127.0.0.1:5000';
const api=process.env.API_URL||'http://127.0.0.1:8787';
const errors=[];
const signup=async username=>{
  const r=await fetch(api+'/api/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'secret1'})});
  assert.equal(r.status,201,`signup ${username}`);
  return {name:username,token:(await r.json()).token};
};

// Fixtures: the real JPEG with an APP1 "Exif" segment spliced in after SOI. Its big-endian TIFF IFD0 holds
// Orientation=6, followed by the ASCII marker GPSMARKER.
const base=await fs.readFile('assets/0010-0.jpg');
const exif=Buffer.concat([Buffer.from('Exif\0\0'),Buffer.from('MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\0\0\0\0','latin1'),Buffer.from('GPSMARKER')]);
const orientationOf=bytes=>{ // reads Orientation from the first APP1 right after SOI
  assert.deepEqual([...bytes.subarray(0,4)],[0xFF,0xD8,0xFF,0xE1]);
  const t=12,le=bytes[t]===0x49,dv=new DataView(bytes.buffer,bytes.byteOffset);
  const ifd=t+dv.getUint32(t+4,le);
  for(let n=dv.getUint16(ifd,le),e=ifd+2;n-->0;e+=12)if(dv.getUint16(e,le)===0x0112)return dv.getUint16(e+8,le);
};
assert.equal(orientationOf(Buffer.concat([base.subarray(0,2),Buffer.from([0xFF,0xE1,0,exif.length+2]),exif])),6);
const app1=Buffer.concat([Buffer.from([0xFF,0xE1,0,exif.length+2]),exif]);
const jpeg=Buffer.concat([base.subarray(0,2),app1,base.subarray(2)]);
assert.ok(jpeg.includes('GPSMARKER'));
const mp4=Buffer.concat([Buffer.from('\0\0\0\x18ftypisom','latin1'),Buffer.alloc(2048)]);
const big=Buffer.alloc(21*1024*1024);
const files=[
  {name:'photo.jpg',mimeType:'image/jpeg',buffer:jpeg},
  {name:'clip.mp4',mimeType:'video/mp4',buffer:mp4},
  {name:'big.jpg',mimeType:'image/jpeg',buffer:big},
  {name:'photo.heic',mimeType:'image/heic',buffer:Buffer.from('heic')}
];

try {
  const context=await browser.newContext({viewport:{width:1024,height:900}});
  await context.addInitScript(api=>{try{localStorage.uploadApi=api}catch{}},api); // never upload to production
  // uploads need an account: every page starts signed in as `checker`
  await context.addInitScript(user=>{try{const s=JSON.parse(localStorage['500px-local-demo']||'{}');if(!s.user){s.user=user;localStorage['500px-local-demo']=JSON.stringify(s);}}catch{}},await signup('checker'));
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));

  // upload dialog
  assert.equal((await page.goto(origin+'/upload',{waitUntil:'networkidle'})).status(),200);
  const dialog=page.locator('dialog[open]');
  await dialog.waitFor();
  assert.match(await dialog.textContent(),/Videos up to 95 MB \(temporary limit\)/);
  // each pick appends; an exact repeat (same name and size) is skipped; ✕ removes a card
  const picker=dialog.locator('input[type="file"]');
  const extra={name:'extra.png',mimeType:'image/png',buffer:Buffer.from('extra')};
  await picker.setInputFiles([files[0],files[2]]);
  await picker.setInputFiles([files[1],files[3],files[0],extra]);
  const rows=dialog.locator('.upload-row');
  assert.equal(await rows.count(),5);
  await rows.filter({hasText:'extra.png'}).getByRole('button',{name:'Remove extra.png'}).click();
  assert.equal(await rows.count(),4);
  assert.deepEqual(await rows.locator('.upload-name').allTextContents(),['photo.jpg','big.jpg','clip.mp4','photo.heic']);
  const status=await rows.locator('.upload-status').allTextContents();
  assert.equal(status[0],'Ready');
  assert.match(status[1],/too large/i);
  assert.equal(status[2],'Ready');
  assert.equal(status[3],"HEIC isn't supported — export as JPEG.");
  // previews: photos and videos side by side, rejected files get a plain icon
  assert.match(await rows.nth(0).locator('img.upload-thumb').getAttribute('src'),/^blob:/);
  assert.match(await rows.nth(2).locator('video.upload-thumb').getAttribute('src'),/^blob:/);
  assert.equal(await rows.nth(1).locator('.upload-thumb-icon').count(),1);
  assert.equal(await rows.nth(3).locator('.upload-thumb-icon').count(),1);
  assert.match(await dialog.locator('.upload-summary').textContent(),/^4 files · [\d.]+ MB/);
  assert.match(await rows.nth(0).locator('.upload-size').textContent(),/^\d+ KB$/,'files under 1 MB show KB');
  await dialog.getByLabel('New album').check();
  await dialog.locator('#upload-album-title').fill('Check album');
  // hold each PUT briefly so the locked state is observable
  const isPut=url=>url.pathname.endsWith('/media');
  await page.route(isPut,async route=>{await new Promise(r=>setTimeout(r,400));await route.continue();});
  await dialog.locator('form button[type="submit"]').click();
  // both valid files upload in parallel (pool of 3)
  await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open] .upload-status')].filter(s=>s.textContent.startsWith('Uploading')).length===2);
  assert.equal(await picker.isDisabled(),true,'picker must lock during upload');
  assert.equal(await rows.nth(0).getByRole('button',{name:/^Remove photo\.(webp|jpg)$/}).isDisabled(),true,'remove must lock during upload');
  assert.equal(await dialog.getByRole('button',{name:'Clear all'}).isDisabled(),true,'clear must lock during upload');
  await dialog.locator('.upload-msg').getByText('2 uploaded, 2 failed').waitFor({timeout:30000});
  assert.match(await dialog.locator('.upload-msg a:has-text("View album")').getAttribute('href'),/\/galleries\/guest\?album=/);
  assert.equal(await picker.isDisabled(),false);
  // uploaded files leave the list; failures stay and the dialog now targets the album it just created
  assert.deepEqual(await rows.locator('.upload-name').allTextContents(),['big.jpg','photo.heic']);
  assert.equal(await dialog.getByLabel('Existing album').isChecked(),true);
  const created=new URL(await dialog.locator('.upload-msg a').getAttribute('href'),origin).searchParams.get('album');
  assert.equal(await dialog.locator('#upload-album').inputValue(),created);
  // a second batch sends only the new file, into the same album
  await rows.filter({hasText:'big.jpg'}).getByRole('button',{name:'Remove big.jpg'}).click();
  await rows.filter({hasText:'photo.heic'}).getByRole('button',{name:'Remove photo.heic'}).click();
  await picker.setInputFiles([{name:'second.jpg',mimeType:'image/jpeg',buffer:base}]);
  await dialog.locator('form button[type="submit"]').click();
  await dialog.locator('.upload-msg').getByText('1 uploaded, 0 failed').waitFor({timeout:30000});
  // a clean batch clears the form
  assert.equal(await rows.count(),0,'uploaded files must leave the list');
  assert.equal(await dialog.getByLabel('New album').isChecked(),true,'form must reset after a clean upload');
  await page.unroute(isPut);

  // EXIF is stripped before the bytes reach R2
  const albums=await (await fetch(api+'/api/albums')).json();
  assert.equal(albums.filter(a=>a.title==='Check album').length,1,'second batch created a duplicate album');
  const album=albums.find(a=>a.title==='Check album');
  assert.equal(album.count,3);
  assert.equal(album.id,created);
  const detail=await (await fetch(`${api}/api/albums/${album.id}`)).json();
  const image=detail.media.find(m=>m.title==='photo');
  assert.equal(image.title,'photo');
  const downloaded=await fetch(image.url);
  const bytes=Buffer.from(await downloaded.arrayBuffer());
  assert.ok(!bytes.includes('GPSMARKER'),'GPSMARKER survived upload');
  assert.equal(downloaded.headers.get('content-type'),image.contentType);
  assert.equal(image.size,bytes.length,'stored metadata must match the downloaded file');
  if (image.contentType === 'image/webp') {
    assert.match(new URL(image.url).pathname,/\.webp$/);
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.ok(bytes.length<jpeg.length,'WebP must save bytes');
  } else {
    assert.equal(image.contentType,'image/jpeg');
    assert.match(new URL(image.url).pathname,/\.jpg$/);
    assert.ok(bytes.length>1000&&bytes[0]===0xFF&&bytes[1]===0xD8);
    assert.equal(orientationOf(bytes),6,'EXIF orientation lost');
  }
  const dimensions=await page.evaluate(async url=>{const image=await createImageBitmap(await (await fetch(url)).blob());const size=[image.width,image.height];image.close();return size;},image.url);
  const original=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));const size=[image.width,image.height];image.close();return size;},[...jpeg]);
  assert.deepEqual(dimensions,original,'converted portrait dimensions changed');

  // reopening lists the new album
  await page.goto(origin+'/upload',{waitUntil:'networkidle'});
  const reopened=page.locator('dialog[open]');
  await reopened.waitFor();
  await reopened.locator('#upload-album option',{hasText:'Check album (3)'}).waitFor({state:'attached'});

  // a failed album-list load stays visible after picking files, and submit stays disabled
  const broken=await context.newPage();
  broken.on('pageerror',error=>errors.push(error.message));
  await broken.route(url=>url.pathname==='/api/albums',route=>route.request().method()==='GET'
    ?route.fulfill({status:500,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({error:'Album list exploded'})})
    :route.continue());
  await broken.goto(origin+'/upload',{waitUntil:'networkidle'});
  const brokenDialog=broken.locator('dialog[open]');
  await brokenDialog.locator('.upload-msg').getByText('Album list exploded').waitFor();
  await brokenDialog.locator('input[type="file"]').setInputFiles([files[0]]);
  await brokenDialog.locator('.upload-row .upload-status').getByText('Ready').waitFor();
  assert.equal(await brokenDialog.locator('.upload-msg').textContent(),'Album list exploded');
  assert.equal(await brokenDialog.locator('form button[type="submit"]').isDisabled(),true);
  await brokenDialog.getByRole('button',{name:'Clear all'}).click();
  assert.equal(await brokenDialog.locator('.upload-row').count(),0);
  assert.equal(await brokenDialog.locator('.upload-msg').textContent(),'Album list exploded');
  assert.deepEqual(errors,[]);
  console.log('upload dialog ok');

  // guest gallery
  const title='<img src=x onerror=alert(1)>',author=`"Q" & 'A' 📷`; // author is the account's username
  const owner=await signup(author),auth={authorization:`Bearer ${owner.token}`};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const post=(path,init)=>fetch(api+path,init).then(async r=>{assert.ok(r.ok,`${path} ${r.status}`);return r.json();});
  const seeded=await post('/api/albums',{method:'POST',headers:{'content-type':'application/json',...auth},body:JSON.stringify({title})});
  for(const [file,type,body] of [['a.png','image/png',png],['b.mp4','video/mp4',mp4]])
    await post(`/api/albums/${seeded.id}/media?title=${file}`,{method:'PUT',headers:{'content-type':type,...auth},body});
  const guest=await context.newPage();
  guest.on('pageerror',error=>errors.push(error.message));
  guest.on('dialog',d=>{errors.push('alert: '+d.message());d.dismiss();});
  await guest.clock.install();
  await guest.goto(`${origin}/galleries/guest?album=${seeded.id}`,{waitUntil:'networkidle'});
  await guest.locator('.gallery-photo').first().waitFor();
  assert.equal(await guest.locator('[data-gallery] h1').textContent(),title);
  assert.equal(await guest.locator('img[src="x"]').count(),0);
  assert.equal(await guest.locator('.gallery-photo img').count(),1);
  assert.equal(await guest.locator('.gallery-photo video').count(),1);
  assert.equal(await guest.locator('.gallery-play-badge').count(),1);
  assert.equal(await guest.locator('.gallery-count').textContent(),'2 items');
  assert.equal((await guest.locator('[data-gallery-owner]').textContent()).trim(),author);
  assert.equal(await guest.locator('.gallery-follow').count(),0);
  assert.equal(await guest.locator('[data-gallery-back]').textContent(),`← Galleries by ${author}`);
  assert.equal(await guest.locator('[data-gallery-back]').getAttribute('href'),`/p/guest?user=${encodeURIComponent(author)}&view=galleries`);
  for(const caption of await guest.locator('.gallery-photo figcaption').allTextContents())assert.ok(caption.includes(author),caption);
  await guest.locator('.gallery-photo:has(video) button').click();
  await guest.locator('.local-lightbox video[controls]').waitFor();
  await guest.locator('[data-slide="next"]').click();
  await guest.locator('.local-lightbox img').waitFor();
  assert.equal(await guest.locator('.local-lightbox video').count(),0);
  await guest.keyboard.press('Escape');
  // slideshow: the image advances to the video after 5 s, then holds while that video is playing
  await guest.evaluate(()=>{window.realPaused=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'paused');Object.defineProperty(HTMLMediaElement.prototype,'paused',{get:()=>false,configurable:true});});
  await guest.locator('[data-gallery-action="slideshow"]').click();
  await guest.locator('.local-lightbox img').waitFor();
  await guest.clock.runFor(5000);
  await guest.locator('.local-lightbox video[controls]').waitFor();
  await guest.clock.runFor(10000);
  assert.equal(await guest.locator('.local-lightbox video').count(),1,'slideshow advanced past a playing video');
  await guest.evaluate(()=>Object.defineProperty(HTMLMediaElement.prototype,'paused',window.realPaused));
  await guest.clock.runFor(5000);
  await guest.locator('.local-lightbox img').waitFor();
  await guest.keyboard.press('Escape');
  // missing album, API outage, seeded regression
  await guest.goto(origin+'/galleries/guest?album=nope',{waitUntil:'networkidle'});
  await guest.getByText('Gallery not found').waitFor();
  await guest.route(url=>url.pathname.startsWith('/api/albums/'),route=>route.abort());
  await guest.goto(`${origin}/galleries/guest?album=${seeded.id}`,{waitUntil:'networkidle'});
  await guest.getByText('Guest uploads are unavailable right now.').waitFor();
  await guest.unroute(()=>true);
  await guest.goto(origin+'/galleries/0?owner=MarcoGrassi',{waitUntil:'networkidle'});
  await guest.locator('.gallery-photo').first().waitFor();
  assert.equal(await guest.locator('.gallery-count').textContent(),`${await guest.locator('.gallery-photo').count()} photos`);
  assert.equal(await guest.locator('.gallery-follow').count(),1);
  assert.deepEqual(errors,[]);
  console.log('guest gallery ok');

  // guest profile
  const prof=await context.newPage();
  prof.on('pageerror',error=>errors.push(error.message));
  prof.on('dialog',d=>{errors.push('alert: '+d.message());d.dismiss();});
  const visible=(p,text,exact)=>p.getByText(text,{exact}).filter({visible:true});
  await prof.goto(origin+'/p/guest',{waitUntil:'networkidle'});
  await visible(prof,'Guest uploads',true).first().waitFor();
  assert.equal(await prof.title(),'Guest uploads | 500px');
  assert.equal(await visible(prof,'Marco Grassi').count(),0);
  assert.equal(await prof.locator('[role="tab"][aria-selected="true"]').textContent(),'Galleries');
  assert.equal(await visible(prof,'Quests').count(),0);
  const card=prof.locator(`.local-collection-card[href$="album=${seeded.id}"]`);
  await card.waitFor();
  assert.equal(await card.locator(':scope > span').textContent(),title);
  assert.equal(await prof.locator('img[src="x"]').count(),0);
  await card.click();
  await prof.locator('[data-gallery] h1').waitFor();
  assert.equal(await prof.locator('[data-gallery] h1').textContent(),title);
  await prof.goto(origin+'/p/guest',{waitUntil:'networkidle'});
  await prof.locator('[role="tab"]',{hasText:'Works'}).click();
  const cells=prof.locator('.local-profile-panel .gallery-photo');
  await cells.first().waitFor();
  assert.ok(await cells.count()>=2);
  assert.ok(await cells.locator('video').count()>=1);
  // the first cell opens the lightbox only; an upload dialog must never be created (it would be replaced, so watch for it)
  await prof.evaluate(()=>{window.uploadOpened=false;new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.querySelector?.('#upload-file'))window.uploadOpened=true;}).observe(document.body,{childList:true,subtree:true});});
  await cells.first().locator('button').click();
  await prof.locator('.local-lightbox').waitFor();
  assert.equal(await prof.evaluate(()=>window.uploadOpened),false,'upload dialog opened');
  await prof.keyboard.press('Escape');
  await cells.filter({has:prof.locator('video')}).first().locator('button').click();
  await prof.locator('.local-lightbox video[controls]').waitFor();
  await prof.keyboard.press('Escape');
  await prof.goto(origin+'/discover',{waitUntil:'networkidle'});
  await prof.locator('header button[aria-label="Toggle navigation"]').click(); // logged out, the visible entry to the More items
  assert.equal(await prof.locator('.local-menu a',{hasText:'Guest uploads'}).getAttribute('href'),'/p/guest');
  await prof.goto(origin+'/p/MarcoGrassi',{waitUntil:'networkidle'});
  assert.equal(await visible(prof,'Marco Grassi',true).count()>=1,true);
  assert.equal(await prof.locator('[role="tab"][aria-selected="true"]').textContent(),'Works(353)');
  assert.equal(await prof.locator('.local-profile-panel').count(),0);
  // no albums yet: empty state with an Upload button
  const empty=await context.newPage();
  empty.on('pageerror',error=>errors.push(error.message));
  await empty.route(url=>url.pathname==='/api/albums',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'}));
  await empty.goto(origin+'/p/guest',{waitUntil:'networkidle'});
  await empty.getByText('No uploads yet.').waitFor();
  await empty.locator('.local-profile-panel button',{hasText:'Upload'}).click();
  await empty.locator('dialog[open]').waitFor();
  // API outage: seeded pages still render, guest UI says so
  const down=await context.newPage();
  down.on('pageerror',error=>errors.push(error.message));
  await down.route(api+'/**',route=>route.abort());
  await down.goto(origin+'/p/guest',{waitUntil:'networkidle'});
  await down.getByText('Guest uploads are unavailable right now.').waitFor();
  await down.goto(origin+'/discover',{waitUntil:'networkidle'});
  assert.ok(await down.locator('[data-photo-card]').count()>0);
  await down.goto(origin+'/upload',{waitUntil:'networkidle'});
  await down.locator('dialog[open]').getByText('Uploads are unavailable right now').first().waitFor();
  assert.deepEqual(errors,[]);
  // static export includes the guest routes
  execSync('npm run export:pages',{env:{...process.env,PAGES_BASE_PATH:'/500px-com'},stdio:'pipe'});
  for(const route of ['p/guest','galleries/guest'])await fs.access(`_site/${route}/index.html`);
  // rebase() prefixes root-relative literals; API paths must reach the Worker unprefixed
  assert.ok(!(await fs.readFile('_site/app.js','utf8')).includes('/500px-com/api/'),'exported app.js sends API calls to /500px-com/api/');
  console.log('guest profile ok');
} finally {
  await browser.close();
}
