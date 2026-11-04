import { sniffMatches, sniffMediaType } from './rules.js';

export class MediaStorageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const unavailable = () => new MediaStorageError(502, 'Media storage is unavailable. Try again.');
const authorization = (env) => {
  if (!env.IMAGEKIT_PRIVATE_KEY) throw new MediaStorageError(503, 'Media storage is not configured');
  return `Basic ${btoa(`${env.IMAGEKIT_PRIVATE_KEY}:`)}`;
};

async function imagekitFetch(url, init) {
  try { return await fetch(url, init); }
  catch { throw unavailable(); }
}

export async function uploadImageKit(env, request, { fileName, folder, contentType, size }) {
  const auth = authorization(env);
  if (!request.body) throw new MediaStorageError(400, 'The file is empty');
  const reader = request.body.getReader();
  const chunks = [], head = new Uint8Array(16);
  let headSize = 0, received = 0;
  while (headSize < head.length) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    const bytes = value.subarray(0, head.length - headSize);
    head.set(bytes, headSize); headSize += bytes.length;
    received += value.length;
  }
  if (!sniffMatches(contentType, sniffMediaType(head.subarray(0, headSize)))) {
    await reader.cancel();
    throw new MediaStorageError(415, "That file doesn't look like a supported photo or video.");
  }
  if (received > size) {
    await reader.cancel();
    throw new MediaStorageError(400, 'File size does not match Content-Length');
  }

  // Stream multipart data: a 95 MB video must not be buffered in Worker memory.
  const boundary = `imagekit-${crypto.randomUUID()}`, encoder = new TextEncoder();
  const fields = { fileName, folder, useUniqueFileName: 'true', overwriteFile: 'false' };
  const prefix = encoder.encode(Object.entries(fields).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('') +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  let sizeError;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(prefix); for (const chunk of chunks) controller.enqueue(chunk); chunks.length = 0; },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (!done) received += value.length;
      if (received > size || (done && received !== size)) {
        sizeError = new MediaStorageError(400, 'File size does not match Content-Length');
        controller.error(sizeError);
        await reader.cancel();
      } else if (done) { controller.enqueue(suffix); controller.close(); }
      else controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  let response;
  try {
    response = await imagekitFetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body, duplex: 'half',
    });
  } catch (error) { await reader.cancel().catch(() => {}); throw sizeError || error; }
  if (sizeError) throw sizeError;
  if (!response.ok) { await reader.cancel(); throw unavailable(); }
  const file = await response.json().catch(() => null);
  if (typeof file?.fileId !== 'string' || !file.fileId) throw unavailable();
  let deliveryUrl;
  try { deliveryUrl = new URL(file.url); } catch {}
  if (deliveryUrl?.protocol !== 'https:' || file.size !== size) {
    await deleteImageKitFile(env, file.fileId);
    throw unavailable();
  }
  // Preserve the existing byte/size/type contract after browser-side preparation.
  deliveryUrl.searchParams.set('tr', 'orig-true');
  file.url = deliveryUrl.href;
  return file;
}

// shortcut: cached CDN variants expire naturally; add cache purging if immediate URL revocation is required.
export async function deleteImageKitFile(env, id) {
  const response = await imagekitFetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: authorization(env) },
  });
  if (!response.ok && response.status !== 404) throw unavailable();
}

export async function deleteStoredMedia(env, rows) {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const ids = rows.slice(offset, offset + 100).map(row => row.imagekit_file_id);
    const response = await imagekitFetch('https://api.imagekit.io/v1/files/batch/deleteByFileIds', {
      method: 'POST', headers: { Authorization: authorization(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ fileIds: ids }),
    });
    if (!response.ok) throw unavailable();
    const result = await response.json().catch(() => null);
    const deleted = Array.isArray(result?.successfullyDeletedFileIds) ? ids.filter(id => result.successfullyDeletedFileIds.includes(id)) : [];
    // Save partial progress so retrying cannot discard files that failed to delete.
    if (deleted.length) await env.DB.prepare(`DELETE FROM media WHERE imagekit_file_id IN (${deleted.map(() => '?').join(',')})`).bind(...deleted).run();
    if (deleted.length !== ids.length) throw unavailable();
  }
}
