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

// Fixtures: the real JPEG with an APP1 "Exif" segment (carrying GPSMARKER) spliced in after SOI.
const base=await fs.readFile('assets/0010-0.jpg');
const exif=Buffer.concat([Buffer.from('Exif\0\0GPSMARKER','latin1')]);
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

  // reopening lists the new album
  await page.goto(origin+'/upload',{waitUntil:'networkidle'});
  const reopened=page.locator('dialog[open]');
  await reopened.waitFor();
  await reopened.locator('#upload-album option',{hasText:'Check album (2)'}).waitFor({state:'attached'});
  assert.deepEqual(errors,[]);
  console.log('upload dialog ok');
} finally {
  await browser.close();
}
