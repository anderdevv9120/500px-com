// Needs npm start and PLAYWRIGHT_MODULE pointing to playwright-core/index.mjs. No Worker or real uploads.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
try {
  const page = await browser.newPage();
  const errors = [];
  let uploads = 0;
  let uploadGate = Promise.resolve();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.uploadApi = 'http://127.0.0.1:8787'; });
  await page.route('http://127.0.0.1:8787/**', async route => {
    const request = route.request(), bytes = request.postDataBuffer();
    const headers = {'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, PUT, OPTIONS', 'access-control-allow-headers':'Content-Type'};
    if (request.method() === 'PUT') { uploads++; await uploadGate; }
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
    const send = async (blob, name = 'photo.png') => putMedia('test', await prepareMedia(new File([blob], name, {type:blob.type})), {title:'photo', author:'Guest'}, () => {});
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
    const photo = await (await fetch('/assets/0010-0.jpg')).blob();
    const qualities = [];
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) { qualities.push(quality); toBlob.call(this, callback, type, quality); };
    const compressed = await prepareMedia(new File([photo], 'photo.jpg', {type:'image/jpeg'}));
    HTMLCanvasElement.prototype.toBlob = toBlob;
    const realPhoto = {qualities, sourceSize:photo.size, size:compressed.size, name:compressed.name, type:compressed.type};
    return {realPhoto, converted, pngSize:png.size, portrait, hasGps, unsupported, pngBytes:[...new Uint8Array(await png.arrayBuffer())], jpegFallbackHasGps:new TextDecoder().decode(new Uint8Array(jpegFallback.bytes)).includes('GPSMARKER'), fallbackOrientation, larger, encodeError, decodeError, unchanged};
  });
  assert.deepEqual(result.realPhoto.qualities, [0.9], 'conversion must use only 90% quality');
  assert.equal(result.realPhoto.name, 'photo.jpg');
  assert.equal(result.realPhoto.type, 'image/jpeg');
  assert.equal(result.realPhoto.size, result.realPhoto.sourceSize, 'keep the original when 90% WebP is larger');
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
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args) {
      window.finishConversion = () => { HTMLCanvasElement.prototype.toBlob = toBlob; toBlob.apply(this, args); };
    };
  });
  const dialog = page.locator('dialog[open]');
  await dialog.locator('input[type="file"]').setInputFiles([
    {name:'image.png', mimeType:'image/png', buffer:Buffer.from(result.pngBytes)},
    {name:'broken.png', mimeType:'image/png', buffer:Buffer.from('broken')},
    {name:'clip.mp4', mimeType:'video/mp4', buffer:Buffer.from('video')}
  ]);
  const submit = dialog.locator('button[type="submit"]');
  assert.equal(await submit.isEnabled(), true, 'selecting files must not start conversion');
  assert.equal(await page.evaluate(() => typeof window.finishConversion), 'undefined');
  assert.equal(await dialog.locator('.upload-name').first().textContent(), 'image.png');
  assert.equal(uploads, 9);
  await dialog.locator('input[type="file"]').setInputFiles({name:'image.png', mimeType:'image/png', buffer:Buffer.from(result.pngBytes)});
  assert.equal(await dialog.locator('.upload-row').count(), 3, 'repeated selections must be deduplicated');
  await dialog.locator('#upload-album-title').fill('Conversion check');
  let releaseUploads;
  uploadGate = new Promise(resolve => { releaseUploads = resolve; });
  await submit.click();
  await page.waitForFunction(() => typeof window.finishConversion === 'function');
  await dialog.locator('.upload-status').getByText('Converting…', {exact:true}).waitFor();
  assert.equal(await submit.isDisabled(), true, 'Upload must stay disabled during conversion');
  assert.equal(uploads, 9, 'media uploads must wait for conversion');
  await page.evaluate(() => window.finishConversion());
  await dialog.locator('.upload-name').getByText('image.webp', {exact:true}).waitFor();
  const convertedRow = dialog.locator('.upload-row').filter({has:page.getByText('image.webp', {exact:true})});
  assert.equal(await convertedRow.locator('.upload-size').textContent(), `${Math.max(1, Math.round(result.converted.size / 1024))} KB`);
  await dialog.locator('.upload-status').getByText('Uploading…', {exact:true}).first().waitFor();
  assert.equal(await submit.isDisabled(), true, 'Upload must stay disabled while media is uploading');
  const disabledStyle = await submit.evaluate(button => ({opacity:getComputedStyle(button).opacity, cursor:getComputedStyle(button).cursor}));
  assert.ok(Number(disabledStyle.opacity) < 1, 'Upload must look disabled while media is uploading');
  assert.equal(disabledStyle.cursor, 'default');
  releaseUploads();
  await dialog.locator('.upload-msg').getByText('2 uploaded, 1 failed').waitFor();
  assert.equal(await dialog.locator('.upload-row').count(), 1);
  assert.equal(await dialog.locator('.upload-name').textContent(), 'broken.png');
  assert.equal(await dialog.locator('.upload-row.bad').count(), 1);
  assert.equal(await dialog.locator('button[type="submit"]').isEnabled(), true);
  assert.equal(await submit.evaluate(button => getComputedStyle(button).opacity), '1');
  assert.equal(uploads, 11);
  await page.setViewportSize({width:390, height:844});
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args) {
      window.finishConversion = () => { HTMLCanvasElement.prototype.toBlob = toBlob; toBlob.apply(this, args); };
    };
    delete window.finishConversion;
  });
  await dialog.locator('input[type="file"]').setInputFiles([
    {name:'clear.png', mimeType:'image/png', buffer:Buffer.from(result.pngBytes)},
    {name:'queued.png', mimeType:'image/png', buffer:Buffer.from(result.pngBytes)}
  ]);
  assert.equal(await page.evaluate(() => typeof window.finishConversion), 'undefined');
  assert.equal(await submit.isEnabled(), true);
  await dialog.locator('.upload-clear').click();
  await dialog.locator('input[type="file"]').setInputFiles({name:'mobile.png', mimeType:'image/png', buffer:Buffer.from(result.pngBytes)});
  uploadGate = new Promise(resolve => { releaseUploads = resolve; });
  await submit.click();
  await page.waitForFunction(() => typeof window.finishConversion === 'function');
  assert.equal(uploads, 11, 'mobile uploads must also wait for conversion');
  await page.evaluate(() => window.finishConversion());
  await dialog.locator('.upload-name').getByText('mobile.webp', {exact:true}).waitFor();
  releaseUploads();
  await dialog.locator('.upload-msg').getByText('1 uploaded, 0 failed').waitFor();
  assert.equal(await submit.isEnabled(), true);
  assert.equal(uploads, 12);
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback) { toBlob.call(this, callback, 'image/png'); };
  });
  await dialog.locator('input[type="file"]').setInputFiles({name:'original.png', mimeType:'image/png', buffer:Buffer.from(result.pngBytes)});
  await dialog.locator('#upload-album-title').fill('Original format check');
  uploadGate = new Promise(resolve => { releaseUploads = resolve; });
  await submit.click();
  await dialog.locator('.upload-status').getByText('Uploading original…', {exact:true}).waitFor();
  assert.equal(await dialog.locator('.upload-name').textContent(), 'original.png');
  releaseUploads();
  await dialog.locator('.upload-msg').getByText('1 uploaded, 0 failed').waitFor();
  assert.equal(uploads, 13);
  assert.deepEqual(errors, []);
  console.log('image uploads ok: WebP bytes, size, dimensions, transparency, orientation, metadata, fallback, errors, passthrough');
} finally {
  await browser.close();
}
