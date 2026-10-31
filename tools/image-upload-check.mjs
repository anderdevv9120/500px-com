// Needs npm start and PLAYWRIGHT_MODULE pointing to playwright-core/index.mjs. No Worker or real uploads.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
try {
  const page = await browser.newPage();
  const errors = [];
  let uploads = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.uploadApi = 'http://127.0.0.1:8787'; });
  await page.route('http://127.0.0.1:8787/**', async route => {
    const request = route.request(), bytes = request.postDataBuffer();
    const headers = {'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, PUT, OPTIONS', 'access-control-allow-headers':'Content-Type'};
    if (request.method() === 'PUT') uploads++;
    const body = request.method() === 'POST' ? {id:'test'} : bytes ? {type:request.headers()['content-type'], bytes:[...bytes]} : [];
    await route.fulfill({status:200, headers, contentType:'application/json', body:JSON.stringify(body)});
  });
  await page.goto((process.env.SITE_URL || 'http://127.0.0.1:5000') + '/upload', {waitUntil:'networkidle'});
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 320, 180);
    gradient.addColorStop(0, 'red'); gradient.addColorStop(1, 'blue');
    ctx.fillStyle = gradient; ctx.fillRect(80, 0, 240, 180);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const send = (blob, name = 'photo.png') => putMedia('test', new File([blob], name, {type:blob.type}), {title:'photo', author:'Guest'}, () => {});
    const inspect = async response => {
      const bytes = new Uint8Array(response.bytes), bitmap = await createImageBitmap(new Blob([bytes], {type:response.type}));
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return {type:response.type, signature:String.fromCharCode(...bytes.slice(8, 12)), size:bytes.length, width:canvas.width, height:canvas.height, alpha:ctx.getImageData(0, 0, 1, 1).data[3]};
    };
    const converted = await inspect(await send(png));
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 80, 180);
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1));
    const raw = new Uint8Array(await jpeg.arrayBuffer());
    const exif = new Uint8Array([0xFF,0xE1,0,43,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0,...new TextEncoder().encode('GPSMARKER')]);
    const oriented = new Blob([raw.slice(0, 2), exif, raw.slice(2)], {type:'image/jpeg'});
    const portraitResponse = await send(oriented, 'portrait.jpg');
    const portrait = await inspect(portraitResponse);
    const hasGps = new TextDecoder().decode(new Uint8Array(portraitResponse.bytes)).includes('GPSMARKER');

    const toBlob = HTMLCanvasElement.prototype.toBlob;
    // Simulate an encoder without WebP support, then an output larger than the source.
    HTMLCanvasElement.prototype.toBlob = function(callback) { toBlob.call(this, callback, 'image/png'); };
    const unsupported = await send(png);
    const jpegFallback = await send(oriented, 'portrait.jpg');
    const fallbackOrientation = await inspect(jpegFallback);
    HTMLCanvasElement.prototype.toBlob = function(callback) { callback(new Blob([new Uint8Array(png.size + 1)], {type:'image/webp'})); };
    const larger = await send(png);
    HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); };
    let encodeError = '';
    try { await send(png); } catch (error) { encodeError = error.message; }
    HTMLCanvasElement.prototype.toBlob = toBlob;
    let decodeError = '';
    try { await send(new Blob(['broken'], {type:'image/png'})); } catch (error) { decodeError = error.message; }
    const unchanged = [];
    for (const type of ['image/webp', 'image/gif', 'image/avif', 'video/mp4']) {
      unchanged.push(await send(new Blob(['original'], {type})));
    }
    return {converted, pngSize:png.size, portrait, hasGps, unsupported, pngBytes:[...new Uint8Array(await png.arrayBuffer())], jpegFallbackHasGps:new TextDecoder().decode(new Uint8Array(jpegFallback.bytes)).includes('GPSMARKER'), fallbackOrientation, larger, encodeError, decodeError, unchanged};
  });
  assert.equal(result.converted.type, 'image/webp');
  assert.equal(result.converted.signature, 'WEBP');
  assert.ok(result.converted.size < result.pngSize);
  assert.deepEqual([result.converted.width, result.converted.height, result.converted.alpha], [320, 180, 0]);
  assert.equal(result.portrait.type, 'image/webp');
  assert.deepEqual([result.portrait.width, result.portrait.height], [180, 320]);
  assert.equal(result.hasGps, false);
  for (const output of [result.unsupported, result.larger]) {
    assert.equal(output.type, 'image/png');
    assert.deepEqual(output.bytes, result.pngBytes);
  }
  assert.equal(result.jpegFallbackHasGps, false);
  assert.equal(result.fallbackOrientation.type, 'image/jpeg');
  assert.deepEqual([result.fallbackOrientation.width, result.fallbackOrientation.height], [180, 320]);
  assert.match(result.encodeError, /convert|encod/i);
  assert.match(result.decodeError, /decode|image|source/i);
  for (const [index, type] of ['image/webp', 'image/gif', 'image/avif', 'video/mp4'].entries()) {
    assert.equal(result.unchanged[index].type, type);
    assert.equal(Buffer.from(result.unchanged[index].bytes).toString(), 'original');
  }
  assert.equal(uploads, 9, 'failed conversions must not upload');
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    canvas.getContext('2d').fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const dialog = page.locator('dialog[open]');
  await dialog.locator('input[type="file"]').setInputFiles([
    {name:'image.png', mimeType:'image/png', buffer:Buffer.from(png)},
    {name:'broken.png', mimeType:'image/png', buffer:Buffer.from('broken')},
    {name:'clip.mp4', mimeType:'video/mp4', buffer:Buffer.from('video')}
  ]);
  await dialog.locator('#upload-album-title').fill('Conversion check');
  await dialog.locator('button[type="submit"]').click();
  await dialog.locator('.upload-msg').getByText('2 uploaded, 1 failed').waitFor();
  assert.equal(await dialog.locator('.upload-row').count(), 1);
  assert.equal(await dialog.locator('.upload-name').textContent(), 'broken.png');
  assert.equal(await dialog.locator('.upload-row.bad').count(), 1);
  assert.equal(await dialog.locator('button[type="submit"]').isEnabled(), true);
  assert.equal(uploads, 11);
  assert.deepEqual(errors, []);
  console.log('image uploads ok: WebP bytes, size, dimensions, transparency, orientation, metadata, fallback, errors, passthrough');
} finally {
  await browser.close();
}
