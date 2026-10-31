const MB = 1024 * 1024;

export const LIMITS = {
  image: { maxBytes: 20 * MB, types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] },
  video: { maxBytes: 95 * MB, types: ['video/mp4', 'video/webm', 'video/quicktime'] },
};

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function kindForType(contentType) {
  for (const kind of Object.keys(LIMITS)) {
    if (LIMITS[kind].types.includes(contentType)) return kind;
  }
  return null;
}

export function checkUpload({ contentType, size }) {
  const kind = kindForType(contentType);
  if (!kind) return { ok: false, status: 415, error: `Unsupported file type: ${contentType}` };
  if (size > LIMITS[kind].maxBytes) {
    return { ok: false, status: 413, error: `${kind} is larger than ${LIMITS[kind].maxBytes / MB} MB` };
  }
  return { ok: true, kind };
}

const startsWith = (bytes, signature, offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);
const codes = (str) => [...str].map((c) => c.charCodeAt(0));

export function sniffMediaType(bytes) {
  if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
  if (startsWith(bytes, codes('GIF8'))) return 'image/gif';
  if (startsWith(bytes, codes('RIFF')) && startsWith(bytes, codes('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, [0x1A, 0x45, 0xDF, 0xA3])) return 'video/webm';
  if (startsWith(bytes, codes('ftyp'), 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return null;
    return 'video/mp4';
  }
  return null;
}

export function sniffMatches(declared, sniffed) {
  if (!sniffed) return false;
  const kind = kindForType(declared);
  if (kind === 'video') return kindForType(sniffed) === 'video';
  return declared === sniffed;
}

export function cleanText(value, max, fallback) {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
    : '';
  return text || (fallback ?? '');
}

export function extensionFor(mime) {
  return EXTENSIONS[mime];
}
