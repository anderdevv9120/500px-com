// Needs `npm start` (127.0.0.1:5000) and a FRESH `wrangler dev` with default vars (127.0.0.1:8787):
//   cd worker; TMP=$(mktemp -d)
//   npx wrangler d1 migrations apply 500px-guest-uploads --local --persist-to "$TMP"
//   WRANGLER_DISABLE_REQUEST_BODY_DRAINING=1 npx wrangler dev --port 8787 --persist-to "$TMP"
// then: PLAYWRIGHT_MODULE=<path to playwright-core/index.mjs> node tools/uploads-check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const origin=process.env.SITE_URL||'http://127.0.0.1:5000';
const api=process.env.API_URL||'http://127.0.0.1:8787';
const errors=[];

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
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));

  // upload dialog
  assert.equal((await page.goto(origin+'/upload',{waitUntil:'networkidle'})).status(),200);
  const dialog=page.locator('dialog[open]');
  await dialog.waitFor();
  assert.match(await dialog.textContent(),/Videos up to 95 MB \(temporary limit\)/);
  await dialog.locator('input[type="file"]').setInputFiles(files);
  const rows=dialog.locator('.upload-row');
  assert.equal(await rows.count(),4);
  const status=await rows.locator('.upload-status').allTextContents();
  assert.equal(status[0],'Ready');
  assert.equal(status[1],'Ready');
  assert.match(status[2],/too large/i);
  assert.equal(status[3],"HEIC isn't supported — export as JPEG.");
  await dialog.getByLabel('New album').check();
  await dialog.locator('#upload-album-title').fill('Check album');
  await dialog.locator('form button[type="submit"]').click();
  await dialog.locator('.upload-msg').getByText('2 uploaded, 2 failed').waitFor({timeout:30000});
  assert.match(await dialog.locator('.upload-msg a:has-text("View album")').getAttribute('href'),/\/galleries\/guest\?album=/);

  // EXIF is stripped before the bytes reach R2
  const albums=await (await fetch(api+'/api/albums')).json();
  const album=albums.find(a=>a.title==='Check album');
  assert.equal(album.count,2);
  const detail=await (await fetch(`${api}/api/albums/${album.id}`)).json();
  const image=detail.media.find(m=>m.kind==='image');
  assert.equal(image.title,'photo');
  const bytes=Buffer.from(await (await fetch(image.url)).arrayBuffer());
  assert.ok(bytes.length>1000&&bytes[0]===0xFF&&bytes[1]===0xD8);
  assert.ok(!bytes.includes('GPSMARKER'),'GPSMARKER survived upload');
  assert.equal(orientationOf(bytes),6,'EXIF orientation lost');

  // reopening lists the new album
  await page.goto(origin+'/upload',{waitUntil:'networkidle'});
  const reopened=page.locator('dialog[open]');
  await reopened.waitFor();
  await reopened.locator('#upload-album option',{hasText:'Check album (2)'}).waitFor({state:'attached'});

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
  assert.deepEqual(errors,[]);
  console.log('upload dialog ok');

  // guest gallery
  const title='<img src=x onerror=alert(1)>',author=`"Q" & 'A' 📷`;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const post=(path,init)=>fetch(api+path,init).then(async r=>{assert.ok(r.ok,`${path} ${r.status}`);return r.json();});
  const seeded=await post('/api/albums',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title})});
  for(const [file,type,body] of [['a.png','image/png',png],['b.mp4','video/mp4',mp4]])
    await post(`/api/albums/${seeded.id}/media?title=${file}&author=${encodeURIComponent(author)}`,{method:'PUT',headers:{'content-type':type},body});
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
  assert.equal((await guest.locator('[data-gallery-owner]').textContent()).trim(),'Guest uploads');
  assert.equal(await guest.locator('.gallery-follow').count(),0);
  assert.equal(await guest.locator('[data-gallery-back]').textContent(),'← Galleries by Guest uploads');
  assert.equal(await guest.locator('[data-gallery-back]').getAttribute('href'),'/p/guest?view=galleries');
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
} finally {
  await browser.close();
}
