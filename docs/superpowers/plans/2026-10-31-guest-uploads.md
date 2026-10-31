# Guest Photo & Video Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any visitor upload photos and videos without logging in, into a new or existing album. Uploads are stored on Cloudflare R2/D1 and shown publicly in the existing galleries UI.

**Architecture:** One Cloudflare Worker (`worker/`) is the whole backend. It handles album/media JSON endpoints, streams upload bodies straight into R2, serves media with Range support, and keeps metadata in D1. The static site (GitHub Pages and local `npm start`) calls the Worker from `app.js` using an absolute API base URL. Guest albums render through the existing `/galleries/:id` and `/p/:user` templates at the fixed routes `/galleries/guest?album=<id>` and `/p/guest`.

**Tech Stack:** Plain browser JS (`app.js`, no build). Cloudflare Workers (ES module syntax), R2, D1, and `wrangler` (dev dependency of `worker/` only). Tests use `node:test` for pure Worker rules, a Node `fetch` script against `wrangler dev` for the API, and a Playwright check script (external `PLAYWRIGHT_MODULE`, same as the existing `tools/*-check.mjs`) for the UI.

**Spec:** `docs/superpowers/specs/2026-10-31-guest-uploads-design.md`

## Global Constraints

- No front-end framework or build step. The root `package.json` gets no dependencies. `wrangler` lives only in `worker/package.json` devDependencies.
- Image types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`, ≤ 20 MB (20 × 1024 × 1024 bytes).
- Video types: `video/mp4`, `video/webm`, `video/quicktime`, ≤ 95 MB (95 × 1024 × 1024 bytes).
- Text limits: album title required, 1–60 chars (trimmed). Description ≤ 280. Author name ≤ 40, default `"Guest"`. Media title defaults to the filename without its extension, ≤ 100.
- The upload dialog copy must include the limits and say the video cap is temporary: `Photos up to 20 MB · Videos up to 95 MB (temporary limit)`.
- Storage cap: 5 GB total (`STORAGE_CAP_BYTES = 5368709120`). Rate limit: 50 uploads per visitor per hour (`UPLOADS_PER_HOUR = 50`), keyed by SHA-256 of `CF-Connecting-IP`. Both are Worker vars, not constants.
- Admin deletes require `Authorization: Bearer <ADMIN_TOKEN>`, where `ADMIN_TOKEN` is a Worker secret.
- CORS allow-list var `ALLOWED_ORIGINS = "https://anderdevv9120.github.io,http://localhost:5000,http://127.0.0.1:5000"`.
- Must fit the Workers **Free plan**: the request body streams to R2 with no JS byte processing, and the type sniff is a post-write ranged read of the first 16 bytes.
- The API base URL in `app.js` must be an absolute `http(s)://` string. `tools/export-pages.mjs` `rebase()` rewrites root-relative literals.
- All user-provided text is rendered through the existing `escapeHTML` (`app.js:5`).
- Seeded content must never depend on the Worker. If the API fails, only upload and guest-album UI show an error.
- Local dev and all checks target `wrangler dev` (`http://127.0.0.1:8787`), never production.

## Review Focus

1. **Hostile or odd text in titles, filenames and names** (`<img src=x onerror=alert(1)>`, quotes, emoji). It renders literally everywhere: grid, gallery header, lightbox caption, album select, profile card. Test in Task 6.
2. **A batch where one file fails** (e.g. one 21 MB photo among valid ones). The valid files upload, the failed one is listed with its reason, and the album exists with the files that succeeded. Test in Task 5.
3. **Worker unreachable.** Seeded pages and seeded galleries render normally. The upload dialog shows "Uploads are unavailable right now" instead of hanging. `/p/guest` Galleries shows an unavailable message. Test in Task 7, using Playwright `page.route` to abort API calls.
4. **Declared type lies** (a text file sent as `image/jpeg`). The Worker returns 415 and the R2 object is deleted. Test in Task 3.
5. **iPhone HEIC/HEIC-like files picked through `accept="image/*"`.** The dialog rejects them before upload with "HEIC isn't supported — export as JPEG." Test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/package.json` | `"type":"module"`, devDependency `wrangler`, scripts `dev`, `test`, `deploy`, `migrate:local`, `migrate:remote` |
| `worker/wrangler.toml` | name `500px-guest-uploads`, R2 binding `MEDIA` → bucket `500px-guest-media`, D1 binding `DB` → db `500px-guest-uploads`, vars `ALLOWED_ORIGINS`, `STORAGE_CAP_BYTES`, `UPLOADS_PER_HOUR` |
| `worker/migrations/0001_init.sql` | D1 schema |
| `worker/src/rules.js` | Pure validation: type sniffing, size/type limits, text cleaning. No bindings. |
| `worker/src/index.js` | Fetch handler: routing, CORS, D1/R2 access |
| `worker/test/rules.test.js` | `node:test` unit tests for `rules.js` |
| `tools/upload-api-check.mjs` | Node `fetch` integration check against `wrangler dev` |
| `tools/uploads-check.mjs` | Playwright UI check (needs `npm start` + `wrangler dev`) |
| `app.js` | API client, upload dialog, guest gallery render, video in grid/lightbox, `/p/guest`, More-menu item |
| `styles.css` | Small additions: per-file upload rows, video play badge, lightbox video |
| `tools/export-pages.mjs:29` | Add `/p/guest`, `/galleries/guest` to the explicit route set |
| `package.json` | Extend `lint` with `node --check` for the new JS files |
| `README.md` | Worker setup, local dev, deploy, admin delete `curl` examples, new checks |
| `.gitignore` | Add `worker/node_modules/`, `worker/.wrangler/` |

`routes.mjs` needs no change. `/p/guest` already resolves to `profile` and `/galleries/guest` to `gallery`.

## API Contract (shared by Tasks 2–7)

Every JSON error response is `{ "error": string }`, where the string is a human-readable message that is safe to show in the UI.

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/albums` | — | 200 `Album[]`, newest first, **only albums with ≥1 media** | — |
| `GET /api/albums/:id` | — | 200 `AlbumDetail` | 404 (missing or empty) |
| `GET /api/media?limit=200` | — | 200 `Media[]` newest first across albums (limit capped at 200) | — |
| `POST /api/albums` | JSON `{title, description?}` | 201 `Album` (count 0, cover null) | 400 |
| `PUT /api/albums/:id/media?title=&author=` | raw file body, `Content-Type`, `Content-Length` required | 201 `Media` | 400, 404, 411 (no length), 413, 415, 429, 507 (storage full) |
| `GET /media/:key` | optional `Range` | 200 / 206, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable` | 404 |
| `DELETE /api/albums/:id` | Bearer token | 204 (also deletes its media rows and R2 objects) | 401, 404 |
| `DELETE /api/media/:id` | Bearer token | 204 | 401, 404 |
| `OPTIONS *` | — | 204 with CORS headers for allowed origins | — |

Types (JSON, camelCase):
- `Album = {id, title, description, createdAt, count, cover: {url, kind} | null}`
- `AlbumDetail = {id, title, description, createdAt, media: Media[]}`, with media oldest first (upload order)
- `Media = {id, albumId, kind: "image"|"video", url, title, author, contentType, size, createdAt}`, where `url` is absolute (`<worker origin>/media/<key>`)
- ids are `crypto.randomUUID()`. The R2 key is `<albumId>/<mediaId>.<ext>`, with ext taken from the sniffed type.

---

### Task 1: Worker validation rules

**Files:**
- Create: `worker/package.json`, `worker/src/rules.js`, `worker/test/rules.test.js`
- Modify: `.gitignore` (add `worker/node_modules/`, `worker/.wrangler/`)

**Interfaces:**
- Produces (all named exports of `worker/src/rules.js`):
  - `LIMITS = { image: {maxBytes: 20971520, types: [...]}, video: {maxBytes: 99614720, types: [...]} }`
  - `kindForType(contentType: string) -> "image" | "video" | null`
  - `checkUpload({contentType: string, size: number}) -> {ok: true, kind} | {ok: false, status: 413|415, error: string}`
  - `sniffMediaType(bytes: Uint8Array) -> string | null` returns one of the allowed MIME types, or null
  - `sniffMatches(declared: string, sniffed: string | null) -> boolean`. This is true when the sniffed type is in the same kind as the declared one: any sniffed video type matches any declared video type (mp4/quicktime share `ftyp`), and image types must match exactly.
  - `cleanText(value: unknown, max: number, fallback?: string) -> string` trims, removes control chars, caps at `max`, and returns `fallback ?? ""` when empty
  - `extensionFor(mime: string) -> string`

- [ ] **Step 1: Create `worker/package.json`** with `"type":"module"`, `"private":true`, devDependency `wrangler` (current 4.x), scripts `test: node --test test/`, `dev: wrangler dev --port 8787`, `deploy: wrangler deploy`, `migrate:local: wrangler d1 migrations apply 500px-guest-uploads --local`, `migrate:remote: wrangler d1 migrations apply 500px-guest-uploads --remote`. Run `npm install` in `worker/`. Add the two `.gitignore` lines.

- [ ] **Step 2: Write failing tests in `worker/test/rules.test.js`**

```js
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
```

- [ ] **Step 3: Run** `npm test` in `worker/`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `worker/src/rules.js`** with the exports above. Sniff by checking the byte signatures shown in the tests. For `ftyp` boxes, read the 4-char brand at offset 8: `avif`/`avis` → avif, `qt  ` → quicktime, any other non-HEIF brand → mp4, `heic`/`heix`/`mif1`/`msf1` → null.

- [ ] **Step 5: Run** `npm test`. Expected: all pass.

- [ ] **Step 6: Commit** `feat(worker): add upload validation rules`

---

### Task 2: Worker scaffold, schema, CORS and album endpoints

**Files:**
- Create: `worker/wrangler.toml`, `worker/migrations/0001_init.sql`, `worker/src/index.js`, `tools/upload-api-check.mjs`

**Interfaces:**
- Consumes: `cleanText` from Task 1.
- Produces: `export default { fetch(request, env, ctx) }` in `worker/src/index.js`. The endpoints `GET /api/albums`, `GET /api/albums/:id`, `GET /api/media`, `POST /api/albums`, and `OPTIONS` follow the API Contract. Internal helpers used by later tasks: `json(data, status = 200) -> Response`, `error(status, message) -> Response`, `withCors(response, request, env) -> Response`, `toMedia(row, origin) -> Media`.
- The check script is `tools/upload-api-check.mjs`, with env `API_URL` (default `http://127.0.0.1:8787`) and `ADMIN_TOKEN` (default `dev-admin-token`). Later tasks add sections to it.

- [ ] **Step 1: Write `wrangler.toml`** with `name = "500px-guest-uploads"`, `main = "src/index.js"`, a current `compatibility_date`, `[[r2_buckets]] binding="MEDIA" bucket_name="500px-guest-media"`, `[[d1_databases]] binding="DB" database_name="500px-guest-uploads" database_id="REPLACE_AFTER_d1_create" migrations_dir="migrations"`, and `[vars]` for `ALLOWED_ORIGINS`, `STORAGE_CAP_BYTES`, `UPLOADS_PER_HOUR` with the Global Constraints values. Create `worker/.dev.vars` with `ADMIN_TOKEN=dev-admin-token` and git-ignore `worker/.dev.vars`.

- [ ] **Step 2: Write `migrations/0001_init.sql`**:
  - `albums(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`
  - `media(id TEXT PRIMARY KEY, album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE, r2_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('image','video')), content_type TEXT NOT NULL, size INTEGER NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`
  - indexes on `media(album_id, created_at)`, `media(ip_hash, created_at)`, `media(created_at)`

  Run `npm run migrate:local`. Expected: migration applied.

- [ ] **Step 3: Write the failing section "albums" in `tools/upload-api-check.mjs`** (plain `node:assert/strict`, top-level await):
  - `POST /api/albums {title:'  Trip  ', description:'d'}` → 201, `title === 'Trip'`, `count === 0`, `cover === null`
  - `POST /api/albums {title:'   '}` → 400 with an `error` string
  - `POST /api/albums {title:'x'.repeat(61)}` → 201 with title length 60 (cleaned, not rejected)
  - `GET /api/albums` → the new empty album is **not** listed
  - `GET /api/albums/<new id>` → 404 (empty)
  - `GET /api/albums/does-not-exist` → 404
  - `OPTIONS /api/albums` with `Origin: http://localhost:5000` → 204 and `Access-Control-Allow-Origin: http://localhost:5000`. With `Origin: https://evil.example` → no `Access-Control-Allow-Origin` header

- [ ] **Step 4: Run** `npm run dev` in `worker/` (background), then `node tools/upload-api-check.mjs`. Expected: FAIL.

- [ ] **Step 5: Implement `worker/src/index.js`**: route by method + path, use D1 prepared statements, and wrap every response in `withCors` (methods `GET,POST,PUT,DELETE,OPTIONS`, headers `Content-Type,Authorization`). Listing joins a count and the newest media row as the cover. Unknown routes → 404 JSON.

- [ ] **Step 6: Run** the check. Expected: "albums" section passes.

- [ ] **Step 7: Commit** `feat(worker): add album endpoints, schema and CORS`

---

### Task 3: Media upload, serving, rate limit and storage cap

**Files:**
- Modify: `worker/src/index.js`, `tools/upload-api-check.mjs`

**Interfaces:**
- Consumes: `checkUpload`, `sniffMediaType`, `sniffMatches`, `cleanText`, `extensionFor` (Task 1), plus `json`, `error`, `withCors`, `toMedia` (Task 2).
- Produces: `PUT /api/albums/:id/media` and `GET /media/:key` per the API Contract.

Order of checks in `PUT` (cheapest first, no body read until all pass):
1. Album exists, else 404.
2. `Content-Length` present, else 411.
3. `checkUpload` passes, else 413/415.
4. Rate limit: count of `media` with this `ip_hash` in the last hour < `UPLOADS_PER_HOUR`, else 429 `"Upload limit reached — try again in an hour."`
5. `SUM(size) + Content-Length ≤ STORAGE_CAP_BYTES`, else 507 `"Demo storage is full."`
6. `env.MEDIA.put(key, request.body, {httpMetadata:{contentType}})`.
7. `env.MEDIA.get(key, {range:{offset:0, length:16}})` → `sniffMediaType`. If `!sniffMatches`, delete the object and return 415 `"That file doesn't look like a supported photo or video."`
8. Insert the row and return 201 `Media`.

Mark the check-then-write race with `// ponytail: cap/rate checks race under concurrent uploads; fine for a demo, use a Durable Object counter if it matters`.

- [ ] **Step 1: Write the failing section "media"** in the check script. Restart `wrangler dev` with `--var UPLOADS_PER_HOUR:6 --var STORAGE_CAP_BYTES:<N>` so the limits can be hit. The check reads the same values from env `CHECK_UPLOADS_PER_HOUR`/`CHECK_STORAGE_CAP`, and starts from a fresh local state (`--persist-to` a temp dir, then run migrations into it).
  - Upload a real PNG (`assets/0072-zeiss-badge-hGfrjZ9e.png`) with `title=<b>x</b>&author=` → 201, `kind:'image'`, `author === 'Guest'`, `title === '<b>x</b>'` (stored raw; escaping is the UI's job)
  - `GET /api/albums` now lists the album with `count 1` and `cover.kind 'image'`
  - `GET media.url` → 200, `content-type: image/png`, `cache-control` contains `immutable`
  - `GET media.url` with `Range: bytes=0-3` → 206, body length 4, `content-range: bytes 0-3/<size>`
  - Upload text bytes `"not an image at all"` as `image/jpeg` → 415. Then `GET /api/albums/<id>` still shows exactly 1 media (Review Focus 4)
  - Upload `image/heic` → 415. `application/pdf` → 415
  - Send `Content-Length: 20971521` as `image/png` → 413, returned without the body being read. Use `node:http` `request()` here, since `fetch` forbids setting `Content-Length`: send the headers, read the response, then destroy the request.
  - PUT to a missing album → 404
  - Fill to the rate limit, then one more → 429 with an `error` string
  - Storage cap: with a small `STORAGE_CAP_BYTES`, an upload that would exceed it → 507

- [ ] **Step 2: Run** the check. Expected: "media" fails.

- [ ] **Step 3: Implement** the `PUT` (order above) and `GET /media/:key` (pass the `Range` header to `env.MEDIA.get(key, {range: request.headers})`, return 206 with `Content-Range` when ranged, and set `Accept-Ranges: bytes` and an immutable cache). The IP hash is the hex SHA-256 of `CF-Connecting-IP` (fallback `"local"`) via `crypto.subtle.digest`.

- [ ] **Step 4: Run** the check. Expected: albums + media pass.

- [ ] **Step 5: Commit** `feat(worker): add media upload, serving, rate limit and storage cap`

---

### Task 4: Admin deletes

**Files:**
- Modify: `worker/src/index.js`, `tools/upload-api-check.mjs`

**Interfaces:**
- Consumes: Task 2/3 helpers.
- Produces: `DELETE /api/albums/:id`, `DELETE /api/media/:id` per the API Contract. Token comparison is constant-time (compare SHA-256 digests of both strings).

- [ ] **Step 1: Write the failing section "admin"**:
  - `DELETE /api/media/<id>` with no header → 401. With `Bearer wrong` → 401
  - With `Bearer ${ADMIN_TOKEN}` → 204. Afterwards `GET media.url` → 404
  - `DELETE /api/albums/<id>` (album with 2 media) → 204. Afterwards `GET /api/albums/<id>` → 404, and both media URLs → 404
  - Deleting a missing id → 404

- [ ] **Step 2: Run.** Expected: "admin" fails.
- [ ] **Step 3: Implement.** Album delete removes its R2 objects (`env.MEDIA.delete(keys[])`) and then its rows.
- [ ] **Step 4: Run.** Expected: all sections pass.
- [ ] **Step 5: Commit** `feat(worker): add admin delete endpoints`

---

### Task 5: Upload dialog (real uploads)

**Files:**
- Modify: `app.js` (`upload()` at `app.js:331-343`, plus new helpers near the top), `styles.css`
- Create: `tools/uploads-check.mjs`

**Interfaces:**
- Consumes: the API Contract.
- Produces (top-level in `app.js`, used by Tasks 6–7):
  - `const uploadApi`: `'http://127.0.0.1:8787'` when `location.hostname` is `localhost` or `127.0.0.1`, otherwise the deployed `https://500px-guest-uploads.<subdomain>.workers.dev` (placeholder until Task 8)
  - `api(path: string, options?: RequestInit) -> Promise<any>` fetches `uploadApi + path`. It parses JSON and throws `Error(body.error || 'Uploads are unavailable right now')` on network failure or a non-2xx response.
  - `clientCheck(file: File) -> string | null` returns an error message or null, mirroring the Global Constraints limits. HEIC/HEIF (by type or `.heic/.heif` extension) → `"HEIC isn't supported — export as JPEG."`
  - `stripJpegExif(buffer: ArrayBuffer) -> Blob` drops APP1 (`FFE1`) segments before SOS. Non-JPEG input is returned unchanged as a Blob.
  - `putMedia(albumId, file, {title, author}, onProgress(fraction)) -> Promise<Media>` uses `XMLHttpRequest` for upload progress and rejects with the server's `error` message.

Dialog behavior:
- Remove the `if (!state.user) return login();` gate.
- Heading `Upload photos & videos`. Limits copy exactly as in Global Constraints.
- File input `multiple`, `accept="image/*,video/*"`.
- Radio pair "New album" / "Existing album". New: title (required, maxlength 60) and description (maxlength 280). Existing: a `<select>` filled from `GET /api/albums` (title + count). If the list is empty, disable "Existing album". If the request fails, show the API error inline and disable submit.
- "Your name" (optional, maxlength 40, placeholder "Guest").
- Selecting files lists one row per file (name, size, and either an error from `clientCheck` or "Ready"). Invalid files are marked and skipped, not blocking.
- Submit: create the album if needed, then upload valid files **sequentially**, updating each row's `<progress>`. A failed file shows its message and the rest continue. At the end, show `"N uploaded, M failed"`, plus a link `View album` → `/galleries/guest?album=<id>` when N ≥ 1. The dialog stays open.
- Remove the old "not sent in this local demo" toast.

- [ ] **Step 1: Write the failing check `tools/uploads-check.mjs`**, section "upload dialog". It needs `npm start` and `wrangler dev` (fresh state). Playwright launch matches `tools/grants-check.mjs:5-7`. Fixtures are built in-script as buffers:
  - JPEG = bytes of `assets/0010-0.jpg` with an `FFE1` APP1 `Exif\0\0` segment containing the ASCII marker `GPSMARKER` spliced in after SOI
  - MP4 = `\0\0\0\x18ftypisom` + 2 KB zeros
  - big = a 21 MB buffer named `big.jpg`
  - `photo.heic`

  Assertions:
  - visiting `/upload` without logging in opens a dialog containing `Videos up to 95 MB (temporary limit)`
  - set files [jpeg, mp4, big, heic] → rows show "Ready", "Ready", a size error, and `HEIC isn't supported — export as JPEG.`
  - choose "New album", title `Check album`, submit → summary `2 uploaded, 2 failed`, a `View album` link whose href contains `/galleries/guest?album=` (Review Focus 2 and 5)
  - fetching the uploaded JPEG's URL (from `GET /api/albums/<id>`) returns bytes that do **not** contain `GPSMARKER`
  - reopen the dialog → "Existing album" select contains `Check album (2)`

- [ ] **Step 2: Run** with `PLAYWRIGHT_MODULE=… node tools/uploads-check.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and dialog in `app.js`, plus styles for the file rows and progress in `styles.css` (reuse the existing dialog form styles).
- [ ] **Step 4: Run** the check. Expected: "upload dialog" passes. `npm run lint` passes.
- [ ] **Step 5: Commit** `feat: send guest uploads to the Cloudflare worker`

---

### Task 6: Guest album gallery page with video

**Files:**
- Modify: `app.js` (`renderGallery()` at `app.js:469-491`, `lightbox()` at `app.js:289-302`, the gallery-photo click handler at `app.js:538-539`), `styles.css`, `tools/uploads-check.mjs`

**Interfaces:**
- Consumes: `api`, `uploadApi` (Task 5), and `AlbumDetail`/`Media` from the API Contract.
- Produces:
  - `mediaFigure(item, index, {lightbox: boolean}) -> string` is the HTML for one gallery cell, used for both seeded photos and guest media. For a video it renders `<video src preload="metadata" muted playsinline>` plus a `.gallery-play-badge` span.
  - Gallery items gain an optional `kind` (`'image'` default | `'video'`). `lightbox()` renders `<video controls playsinline>` for video items and `<img>` otherwise, and the caption keeps `title · author`.

Behavior: when the path's last segment is `guest`, `renderGallery()` reads `album` from the query string and fetches `GET /api/albums/:id`. It maps media to `{src:url, title, author, kind}` and renders the existing gallery markup in lightbox mode (like Grants). Header details:
- the owner row is "Curated by Guest uploads" with the `500px` badge avatar and no Follow button
- the back link is `← Galleries by Guest uploads` → `/p/guest?view=galleries`
- the count reads `N items`

If the album is missing or empty, show the existing "Gallery not found" block. If the API fails, show "Guest uploads are unavailable right now." in the same block. Slideshow keeps the 5 s timer but doesn't advance while a lightbox video is playing.

- [ ] **Step 1: Add the failing section "guest gallery"** to `tools/uploads-check.mjs`. Seed through the API directly: an album titled `<img src=x onerror=alert(1)>`, author `"Q" & 'A' 📷`, 1 PNG + 1 MP4 stub. Then:
  - visit `/galleries/guest?album=<id>` → `h1` textContent equals the raw title string, and no `img[src="x"]` exists (Review Focus 1)
  - `.gallery-photo img` count 1, `.gallery-photo video` count 1, `.gallery-play-badge` count 1
  - the figcaption text contains `"Q" & 'A' 📷`
  - clicking the video cell opens the lightbox containing `video[controls]`. Next arrow → an `img`
  - `/galleries/guest?album=nope` → text `Gallery not found`
  - a seeded gallery `/galleries/0?owner=MarcoGrassi` still renders its photo count unchanged (regression)
  - no `pageerror` events

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the check and the existing `tools/gallery-check.mjs`. Expected: both pass.
- [ ] **Step 5: Commit** `feat: render guest albums with photos and videos`

---

### Task 7: `/p/guest` profile, More menu, export routes

**Files:**
- Modify: `app.js` (profile tab handler `app.js:516-526`, initialize near `app.js:677`, More-menu items `app.js:576`), `tools/export-pages.mjs:29`, `tools/uploads-check.mjs`

**Interfaces:**
- Consumes: `api`, `mediaFigure`, and the `lightbox` video support (Tasks 5–6).
- Produces: `isGuestProfile = pageName.startsWith('profile') && location.pathname.replace(/\/$/,'').endsWith('/p/guest')`, and `renderGuestProfile() -> Promise<void>`.

Behavior on `/p/guest`:
- `document.title` = `Guest uploads | 500px`. The captured name span (the `Marco Grassi` heading in `pages/profile.html`) reads `Guest uploads`. The avatar is replaced by the `500px` badge. Bio, follower/following counts, Follow/Message buttons and the Quests tab are hidden.
- The Galleries tab opens by default, with or without `?view=galleries`.
- Galleries tab: cards from `GET /api/albums` (same `local-collection-card` markup; cover is `<img>` or a `<video preload="metadata" muted>`) linking to `/galleries/guest?album=<id>`. No albums → "No guest uploads yet." plus an Upload button that calls `upload()`. API error → "Guest uploads are unavailable right now."
- Works tab: the seeded masonry is hidden and replaced by `GET /api/media` items in a `local-grid` using `mediaFigure` (lightbox mode).
- Header "More" menu: add `{label:'Guest uploads', href:'/p/guest'}` right after the existing `Upload` item.
- Export: add `'/p/guest'` and `'/galleries/guest'` to the `routes` set at `tools/export-pages.mjs:29`.

- [ ] **Step 1: Add the failing section "guest profile"** to `tools/uploads-check.mjs`:
  - `/p/guest` → visible text `Guest uploads`, no visible text `Marco Grassi`, and the Galleries tab is `aria-selected="true"`
  - a card linking to the album seeded in Task 6 exists, and clicking it lands on that album's `h1`
  - Works tab → at least 2 media cells, including 1 `video`
  - open the header "More" menu on `/discover` → it contains a `Guest uploads` link to `/p/guest`
  - `/p/MarcoGrassi` still shows `Marco Grassi` and opens on Works (regression)
  - API down (`page.route(uploadApi + '/**', r => r.abort())`): `/p/guest` Galleries shows `Guest uploads are unavailable right now.`, `/discover` renders its seeded grid with no `pageerror`, and the upload dialog shows `Uploads are unavailable right now` (Review Focus 3)
  - `PAGES_BASE_PATH=/500px-com npm run export:pages` → `_site/p/guest/index.html` and `_site/galleries/guest/index.html` exist

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tools/uploads-check.mjs`, `tools/gallery-check.mjs` and `tools/browser-check.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: add guest uploads profile and navigation`

---

### Task 8: Docs, lint, and Cloudflare deploy

**Files:**
- Modify: `package.json` (`lint`), `README.md`, `app.js` (production `uploadApi` URL), `worker/wrangler.toml` (real `database_id`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Extend `lint`** with `node --check` for `worker/src/index.js`, `worker/src/rules.js`, `tools/upload-api-check.mjs` and `tools/uploads-check.mjs`. Run `npm run lint`. Expected: exit 0.
- [ ] **Step 2: README.** Replace "Local demo … upload preview" in **Included**, and add a "Guest uploads (Cloudflare)" section covering:
  - what it does, and the limits (video limit labelled temporary)
  - local dev: `cd worker && npm install && npm run migrate:local && npm run dev` alongside `npm start`
  - the two checks and their env vars
  - one-time deploy commands (Step 3)
  - admin delete `curl` examples for media and album
  - a known limitation: video metadata (incl. GPS) is not stripped
- [ ] **Step 3: Deploy (the user runs the interactive login; everything else in-session).** These steps need the user's Cloudflare account:
  1. `! cd worker && npx wrangler login` (user runs it)
  2. `npx wrangler r2 bucket create 500px-guest-media`
  3. `npx wrangler d1 create 500px-guest-uploads` → paste the `database_id` into `wrangler.toml`
  4. `npm run migrate:remote`
  5. `npx wrangler secret put ADMIN_TOKEN` (the user enters a strong value)
  6. `npm run deploy` → note the `*.workers.dev` URL

  Set it as the production `uploadApi` in `app.js`.
- [ ] **Step 4: Smoke-test production.** Run `API_URL=<workers.dev url> ADMIN_TOKEN=<token> node tools/upload-api-check.mjs --smoke`. Add a `--smoke` flag in the check that runs only: create album → upload PNG → list → Range GET → admin delete of the album. This leaves no data behind. Expected: pass. `OPTIONS` from `https://anderdevv9120.github.io` returns the allow-origin header.
- [ ] **Step 5: Commit** `docs: document guest uploads and point app at deployed worker`
