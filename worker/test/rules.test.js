import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpload, cleanText, posterTime, sniffMatches, sniffMediaType } from '../src/rules.js';

const MB = 1024 * 1024;
const bytes = (arr) => Uint8Array.from(arr);
const ascii = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0));

test('sniffs magic bytes', () => {
  assert.equal(sniffMediaType(bytes([0xFF,0xD8,0xFF,0xE0])), 'image/jpeg');
  assert.equal(sniffMediaType(bytes([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])), 'image/png');
  assert.equal(sniffMediaType(ascii('GIF89a')), 'image/gif');
  assert.equal(sniffMediaType(ascii('RIFF\0\0\0\0WEBP')), 'image/webp');
  assert.equal(sniffMediaType(ascii('\0\0\0\x1cftypavif')), 'image/avif');
  assert.equal(sniffMediaType(ascii('\0\0\0\x18ftypisom')), 'video/mp4');
  assert.equal(sniffMediaType(ascii('\0\0\0\x14ftypqt  ')), 'video/quicktime');
  assert.equal(sniffMediaType(bytes([0x1A,0x45,0xDF,0xA3])), 'video/webm');
  assert.equal(sniffMediaType(ascii('\0\0\0\x18ftypheic')), null);
  assert.equal(sniffMediaType(ascii('hello world, not media')), null);
});
test('limits by kind', () => {
  assert.deepEqual(checkUpload({contentType:'image/png', size:20*MB}), {ok:true, kind:'image'});
  assert.equal(checkUpload({contentType:'image/png', size:20*MB+1}).status, 413);
  assert.deepEqual(checkUpload({contentType:'video/mp4', size:95*MB}), {ok:true, kind:'video'});
  assert.equal(checkUpload({contentType:'video/mp4', size:95*MB+1}).status, 413);
  assert.equal(checkUpload({contentType:'image/heic', size:1}).status, 415);
  assert.equal(checkUpload({contentType:'application/pdf', size:1}).status, 415);
});
test('declared vs sniffed', () => {
  assert.equal(sniffMatches('video/quicktime', 'video/mp4'), true);
  assert.equal(sniffMatches('image/png', 'image/jpeg'), false);
  assert.equal(sniffMatches('image/jpeg', null), false);
});
test('cleans text', () => {
  assert.equal(cleanText('  hi\u0000 there ', 60), 'hi there');
  assert.equal(cleanText('x'.repeat(70), 60).length, 60);
  assert.equal(cleanText('   ', 40, 'Guest'), 'Guest');
  assert.equal(cleanText(undefined, 40, 'Guest'), 'Guest');
});
test('poster time', () => {
  assert.equal(posterTime('3.6'), 4);
  assert.equal(posterTime(null), 0);
  assert.equal(posterTime('-5'), 0);
  assert.equal(posterTime('NaN'), 0);
  assert.equal(posterTime('Infinity'), 0);
  assert.equal(posterTime('1e9'), 86400);
});
