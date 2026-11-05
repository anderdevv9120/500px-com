# 500px — static recreation

Plain HTML, CSS, and JavaScript recreation of the public 500px.com site inspected on October 28, 2026. Membership is excluded from the pages and navigation.

## Run

Requires Node.js 18 or newer. No dependency installation or build is needed.

```powershell
npm start
```

Open **http://localhost:5000**. Set `PORT` to use another port. The Node server only serves static files and maps the original-style URLs to HTML documents. It has no application API.

## GitHub Pages

In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Push these changes to `main`, or run **Deploy to GitHub Pages** from the Actions tab after the workflow is pushed. The workflow exports and publishes `_site/` to **https://anderdevv9120.github.io/500px-com/**.

Deploying the repository directly from a branch does not work: the captured pages use root-relative asset URLs, and their routes depend on the local Node server. `npm run export:pages` copies the public files, prefixes local URLs with `/500px-com`, and creates directory indexes for the captured routes and seeded photos, profiles, Quests, galleries, and Blog articles/categories. Assets, fragments, fonts, and PDFs are included; development tools and reference captures are excluded. The exported browser script also normalizes directory URLs so query filters and fixture lookups work after a refresh. The captured source files remain unchanged.

The export requires Node.js 22 or newer and no dependencies. The workflow obtains the base path from GitHub Pages; for a manual export, set `PAGES_BASE_PATH` to a different path, or an empty string for a domain root. Arbitrary URLs outside the finite snapshot return the exported 404 page. `_site/` is generated and ignored by Git.

## Included

- Category onboarding and For You, Fresh Picks, and Editors' Choice feeds.
- Photo detail pages, photographer profiles, galleries, weekly/monthly leaderboard, and search.
- Quests hub, filters, contest detail pages, entries, and local submission flow.
- Licensing landing page and all seven guides: licensing, contributing, requirements, releases, keywording, content types, and distribution.
- Commercial Grants, with all five original project mosaics, photographer credits, section navigation, and local collection detail pages.
- vivo campaign, app download, About Us, Terms, Privacy, and Licensing Agreement.
- Username/password accounts and photo/video uploads to a Cloudflare Worker. Albums belong to their account and appear on `/p/guest?user=<username>` (`/p/guest` lists everyone's) and at `/galleries/guest?album=<id>`.
- Password visibility/recovery UI, likes, saved galleries, follows, comments, sharing, and slideshow.

The site contains 29 captured routes, the seeded photo catalog (including Grant previews), 60 Quests, and 708 local assets, including the original Poppins font files and release PDFs. Photography and photographer credits are retained. The shared navigation omits Membership.

## Files

- `index.html`: category selection landing page.
- `pages/`: captured static HTML/CSS documents, route manifest, and reusable login/details fragments.
- `assets/`: locally saved photography, fonts, and campaign artwork.
- `catalog.json`: hard-coded photo and Quest records.
- `app.js`, `styles.css`: browser-local interactions and responsive layout corrections.
- `server.mjs`: dependency-free local file server.
- `worker/`: Cloudflare Worker (ImageKit + D1) behind uploads, with its own `package.json` for `wrangler`.
- `tools/`: optional capture/preparation/browser-inspection utilities. These use an external Puppeteer installation supplied through `PUPPETEER_MODULE`; running the finished site does not require it.

## Demo behavior and limits

Log in uses accounts stored by the Worker. Public registration is disabled in the UI and API; only the main admin can create accounts at `/admin/users`. The session token is kept in browser storage; Log out ends it on the Worker too. Password recovery remains demo-only; the captured social and PULSEpx sign-in buttons are removed. Likes, follows, galleries, and comments live in browser storage. Contest submissions do not call a backend; Upload sends files to the guest-uploads Worker (below). Clear the `500px-local-demo` localStorage entry to reset onboarding and demo state.

The original layouts, typography, public copy, and available images were captured from the live site. Feed content is a finite local snapshot. Additional photo/Quest URLs reuse the captured detail layout with seeded titles and images; uncaptured profiles reuse the sample profile. Search uses seeded results, and some filter data is representative. Blog layouts now follow the working ISO Blog reference, with condensed local text as described below. These areas are not a verified pixel-for-pixel copy of all live states.

The leaderboard preserves the live photo strip, rank medals, row layout, descriptions, photographer credits, and engagement counts. Weekly and Monthly each contain their first 50 actual rankings captured on October 28, 2026; they switch independently and do not refresh from the live API. `tools/capture-leaderboard.mjs` owns these fixtures so the general capture/preparation scripts do not replace them with loading placeholders.

The Quests hub contains 60 actual contests captured on October 28, 2026, including 20 Licensing quests. Its static grid replaces the original virtual list. The two hero banners, original filter dialog, combined filters, empty state, four sort orders, mobile app banner, and query-string reloads work locally. Most Joined uses the captured 500px popularity ranking. Dates, countdown labels, rankings, and content remain a fixed snapshot. General capture skips this finished page. Focused browser checks are in `tools/quests-check.mjs`, with desktop/mobile images and results in `screenshots/quests-*`.

All 20 captured Licensing Quest URLs now use a dedicated Juried-style Licensing detail template, with their own title, hero and captured submission dates, an ended state, Introduction/All Entries tabs, sharing, cash-award content, and Licensing rules. The Battle and general Juried samples retain their existing templates. Indexed official pages for [After Hours](https://500px.com/quest/1000005269-after-hours) and [On the Clock](https://500px.com/quest/1000005271-on-the-clock) supplied the sample structure, counts, cash awards and thematic guidance; the browser reference remains inaccessible, so pixel-level parity is unverified. Briefs are condensed/paraphrased, the other contests use representative brief/award text, and entry photos are seeded content. `catalog.json` carries the Licensing route metadata; `tools/prepare.mjs` preserves it when preparing captures. Run `tools/quest-licensing-check.mjs` with the same external `PLAYWRIGHT_MODULE` used by the gallery check. Desktop/mobile evidence is saved as `screenshots/quest-licensing-*`.

App Store, Google Play, social links, support articles, and Getty Images links retain their external destinations. Authentication and admin publishing use the Worker. Email delivery, payment, and licensing purchases remain demo-only.

Licensing includes the original model release, property release, and contributor agreement PDFs, served locally. All seven guides have working desktop navigation, mobile Table of Contents, section deep links, and a dismissible app banner. Get started and manager links use the existing local login/upload demo; customer support opens local guidance. All five Grant collections open local gallery detail pages. `tools/finish-licensing.mjs` refreshes this snapshot without recapturing unrelated pages. Desktop/mobile evidence and focused check results are under `screenshots/licensing-*`.

Standalone galleries use `/galleries/:id?owner=MarcoGrassi` (or `paweluchorczak`) for profile collections and `/gallery/:id` for Grants. The shared layout includes owner information, photo counts, sharing, a collection-specific slideshow, credited photography, and return links. Fixtures in `pages/galleries.json` reuse captured profile photos and Grant previews; they are representative collections, not complete live galleries. The original gallery reference could not be reached, so visual parity remains unverified. Manager/account screens remain outside scope.

Run `tools/gallery-check.mjs` with `PLAYWRIGHT_MODULE` pointing to an external `playwright-core/index.mjs` installation. It checks gallery routes and interactions at desktop/mobile widths and saves `screenshots/gallery-*` evidence. No browser dependency is required by the finished site.

Commercial Grants reuses all 28 saved photos, with scroll reveals, reduced-motion support, and project navigation below the full mobile header. Run `tools/grants-check.mjs` with the same external `PLAYWRIGHT_MODULE` to check five viewport widths, reveals, navigation, fragment reloads, and local image loading. Screenshots are saved under `screenshots/grants-*`.

The Blog at `/blog` follows the original [ISO listing](https://iso.500px.com/) and [Fog article](https://iso.500px.com/into-the-mist-creating-atmosphere-with-fog-photography/) inspected in desktop and mobile Chrome. It retains the normal black 500px site header above the light Blog content, matching the embedded Blog at `/blog`. The local Open Sans font, photographic feature, five Top Posts, eleven Latest Posts, category menus, footer, and sixteen local article routes remain below it. Articles reuse the inspected hero/reading-column/previous-next layout; the Fog article uses all five captured body photos. Excerpts and article copy are condensed/representative; other stories reuse the template with their own title and photography. Categories filter this finite snapshot and can be empty. Ads, full archives, live social widgets, and Blog search behavior are excluded. Oversized photos are resized locally without changing their proportions. The general capture/preparation scripts preserve the finished Blog.

Run `tools/blog-check.mjs` with the same external `PLAYWRIGHT_MODULE` to verify desktop/mobile routes, menus, sharing, article navigation, missing routes, and login-dialog reuse. It saves `screenshots/blog-results.json` and listing/article/category screenshots. Reference screenshots are saved under `.reference/blog-*`. Chrome DevTools MCP initially had an occupied profile; a subsequent retry independently verified the local listing and Fog article on desktop/mobile, including touch, navigation, sharing, menu/Escape, images, overflow, console messages, and network requests. Manager/account screens and Membership remain excluded.

## Guest uploads (Cloudflare)

Only the main admin can publish or manage photos/videos. Open `/admin` for uploaded media and the seeded photo catalog, or `/admin/users` to add, rename, reset passwords, and delete regular users. Existing sample accounts remain in place. Only the main admin can upload, edit titles/descriptions/posting dates, assign owners, or delete content; normal accounts retain login and public viewing. The account menu links admins to both publishing and administration.

Migration `0004_admin.sql` creates the requested `quyenday` account with the supplied initial password (PBKDF2 hash only), protects it from rename/deletion, disables legacy admin-token authorization, adds per-photo descriptions and stores seeded-photo overrides. Apply this migration **before** deploying the new Worker. It preserves existing users, albums and files, except that older sessions for the reserved admin username are revoked. Keep the initial password private and rotate it before sharing this site publicly; the main account is managed directly in D1.

The upload dialog lets the admin choose a user for a new album, or add files to any existing album. A successful photo/video batch shows a notification, including the failed count for partial uploads. Moving one uploaded photo creates an album for its new owner and preserves sibling ownership and file URLs. Each user has an **Albums & media** button linking to their profile's Galleries (albums) and Works tabs. Deleting a user checks their current media count and asks for confirmation; users with media receive a warning that deletion permanently removes all of their albums, photos and videos. Confirmed deletion removes uploaded ImageKit files and hides their assigned seeded photos. Renaming/resetting a regular user revokes its sessions.

Every photo detail, gallery caption and lightbox shows the fixed notice: **All copyrights belong to the owners of Trust Web, may not be reproduced in any way!** This notice is separate from the optional user-defined description shown in the image view modal. Descriptions default to empty; admins may edit each photo's description and posting date. Transferred seeded photos appear under the recipient's Works tab (`/p/guest?user=<username>&view=works`).

The Worker streams uploads to ImageKit's Media Library under `/500px/albums/<albumId>` and stores the returned public URL and file ID in D1. Public listings and album covers use ImageKit URLs with `tr=orig-true` to preserve the already-prepared bytes, size and content type ([original-file delivery](https://imagekit.io/docs/core-delivery-features)); ImageKit handles delivery and video Range requests. Only the Worker holds `IMAGEKIT_PRIVATE_KEY`; no public key or URL endpoint setting is required. Missing credentials return 503; provider failures return a generic 502. Failed D1 inserts delete the newly uploaded file. Album/user cleanup deletes in batches of 100 and records partial progress so failed files keep their metadata for retry.

Seeded photo edits/deletions remain D1 overrides; original static assets stay in the repository. Public pages use the original snapshot if the overrides API is unavailable, so those edits/deletions require a reachable Worker to be reflected. Static assets and original URLs are not access-controlled. ImageKit deletion removes the Media Library asset, but previously cached URLs can remain accessible until their CDN cache expires; this integration does not purge cached variants. See [ImageKit's delete API](https://github.com/imagekit-developer/imagekit-nodejs/blob/master/src/resources/files/files.ts).
Limits, enforced by the Worker:

- Photos (JPEG, PNG, WebP, GIF, AVIF) up to 20 MB. Videos (MP4, WebM, MOV) up to 95 MB, a **temporary** limit.
- File types are checked by their first bytes before sending to ImageKit, not only by the declared type.
- 50 uploads per visitor per hour (`UPLOADS_PER_HOUR`) and 5 GB total storage (`STORAGE_CAP_BYTES`), both Worker vars in `wrangler.toml`.
- Album title 1–60 characters, description ≤ 280, media title ≤ 100 (defaults to the file name).
- Creating albums and uploading need the main admin session from `POST /api/login` (`{username, password}` → `{token, username, isAdmin}`). `POST /api/signup` always returns 403. `GET /api/me` validates a session. An admin can publish into any album, credited to its owner. `POST /api/logout` ends a session. Reading albums and media stays public; `?user=<username>` filters `GET /api/albums` and `GET /api/media`.
- There is no login throttling yet.
- CORS is limited to `ALLOWED_ORIGINS` (`https://trustweb.beauty`, GitHub Pages, and localhost:5000). Redeploy the Worker after changing this list.

Clicking Upload prepares the selected files in the browser before any media upload starts. JPEG and PNG photos are converted to WebP at 90% quality while keeping their dimensions, orientation, and transparency. The list shows “Converting…” during conversion, then updates the filename and size before uploading. Upload stays disabled throughout preparation and upload. If WebP is not smaller, or the browser cannot encode WebP, the original format is kept and the status says “Uploading original…”. GIF, AVIF, existing WebP, and videos pass through unchanged. The 20 MB photo limit applies to the selected file before conversion.

**Known limitation:** JPEG location data (EXIF/GPS) is stripped in the browser before upload; orientation is applied to converted pixels or retained in JPEGs. Video metadata, including GPS, is **not** stripped.

### Local development

All pages, including localhost, default to the deployed Worker, remote D1, and ImageKit storage. Local uploads and admin changes affect production data. An explicit `localStorage.uploadApi` override still takes precedence; clear an old override with `delete localStorage.uploadApi` and reload to restore the remote default. For a local Worker and D1, set `localStorage.uploadApi = 'http://127.0.0.1:8787'`, copy `worker/.dev.vars.example` to the ignored `worker/.dev.vars`, and set an ImageKit private key with media read/write access. Use a disposable ImageKit account for checks; local Workers still upload real files to ImageKit. Run next to `npm start`:

```sh
cd worker && npm install && npm run migrate:local && npm run dev
```

### Checks

API/browser checks need a **fresh** local D1 state and a disposable ImageKit key in `worker/.dev.vars`, so point `--persist-to` at an empty temp directory. `WRANGLER_DISABLE_REQUEST_BODY_DRAINING=1` stops `wrangler dev` from holding the early 413 response until the body is drained. The exact commands are in each file's header. Unit fixtures mock ImageKit and never upload real files.

- `tools/upload-api-check.mjs` checks the Worker API: accounts, sessions, album ownership, albums, uploads, type sniffing, Range requests, rate limit, storage cap, CORS, and admin deletes. Start `wrangler dev` with `--var UPLOADS_PER_HOUR:6 --var STORAGE_CAP_BYTES:60000`, then run it with `CHECK_UPLOADS_PER_HOUR=6 CHECK_STORAGE_CAP=60000`. `API_URL` defaults to `http://127.0.0.1:8787`; `ADMIN_USERNAME`/`ADMIN_PASSWORD` default to the account seeded by migration 0004.
- `tools/uploads-check.mjs` checks the browser flow: the upload dialog, EXIF stripping, the guest profile, albums, the lightbox, and the exported site. It needs `npm start` and `wrangler dev` with default vars, plus `PLAYWRIGHT_MODULE` pointing at an external `playwright-core/index.mjs` and `CHECK_VIDEO_FILE` pointing at a real small MP4 (ImageKit validates media, so synthetic headers are insufficient). `SITE_URL` and `API_URL` are optional.
- `tools/image-upload-check.mjs` checks WebP conversion, size savings, transparency, orientation, metadata removal, unsupported encoders, failed conversions, and unchanged media. It needs `npm start` and `PLAYWRIGHT_MODULE`, and intercepts API requests so nothing is uploaded to a Worker.
- `node tools/upload-api-check.mjs --smoke` is safe to run against production. It logs in as the main admin, creates an album, uploads a PNG, lists albums, makes a Range request, then deletes the album. It requires `API_URL` and `ADMIN_PASSWORD`; `ADMIN_USERNAME` defaults to the main account.

### Deploy (one time)

From `worker/`, signed in to the Cloudflare account:

```sh
npx wrangler login
npx wrangler d1 create 500px-guest-uploads    # paste database_id into wrangler.toml
npx wrangler secret put IMAGEKIT_PRIVATE_KEY # paste private key at the hidden prompt
npm run migrate:remote
npm run deploy                                # prints the *.workers.dev URL
```

Set that URL as the production `uploadApi` in `app.js`, then smoke-test:

```sh
API_URL=https://<worker>.workers.dev ADMIN_PASSWORD=<password> node tools/upload-api-check.mjs --smoke
```

Later Worker changes only need `npm run deploy`. Schema changes also need `npm run migrate:remote`.

### Switching existing R2 uploads to ImageKit

Migration `0005_imagekit.sql` **deletes existing uploaded-media and album rows**, renames `r2_key` to `imagekit_file_id`, and adds the ImageKit URL column. Accounts, sessions and seeded-photo overrides remain intact. R2 objects remain in `500px-guest-media`; no files are copied or deleted. Re-upload media after switching. Existing uploaded-album share links stop resolving. Static catalog images remain local.

Set `IMAGEKIT_PRIVATE_KEY` with `npx wrangler secret put IMAGEKIT_PRIVATE_KEY`, then apply migrations and deploy the Worker together during a maintenance window: the old Worker cannot use the new schema. The R2 binding is removed from `wrangler.toml`; manually retiring the old bucket is a separate action. See [ImageKit API key permissions](https://imagekit.io/docs/api-keys).

Migration `0002_users.sql` adds accounts and **drops all existing guest albums and media rows**. Their R2 objects stay in `500px-guest-media`; empty the bucket in the Cloudflare dashboard if you want the space back. Run `npm run migrate:remote` before deploying the account-aware Worker.

Migration `0003_poster_time.sql` adds `media.poster_time`, the cover frame (in seconds) chosen with the slider under each video in the upload dialog. Run `npm run migrate:remote` before deploying, or uploads will fail on the missing column.

### Admin APIs

All `/api/admin/*` endpoints require the main admin's Bearer session. The old `ADMIN_TOKEN` secret no longer grants access.

- `GET/POST /api/admin/users`, `GET/PUT/DELETE /api/admin/users/:id`: regular-user management. The single-user GET includes `mediaCount`. Deleting a user with content returns 409 unless the DELETE body includes `{deleteMedia: true}` after confirmation; confirmed deletion removes their albums, uploaded files, assigned seeded photos and sessions. Editing/deleting the main admin returns 403.
- `GET /api/admin/media`: all uploaded photos/videos, including owner IDs.
- `PUT/DELETE /api/admin/media/:id`: uploaded-media metadata, ownership and deletion.
- `PUT/DELETE /api/admin/seeded/:photoId`: metadata/ownership overrides and hiding seeded photos.
- Photo updates accept `{title, description, createdAt, ownerId}`; `createdAt` is an integer Unix timestamp in milliseconds. Seeded photos may keep their original credit with `ownerId: null`.
- `GET /api/photo-overrides` is public. Existing `DELETE /api/media/:id` and `DELETE /api/albums/:id` now require the main admin session, and remove ImageKit files with their rows.

`worker/test/admin.test.js` covers the real migrations, admin login, blocked registration, regular-user denials, protected admin, user CRUD, date/owner validation, single-photo transfer, sibling preservation and seeded overrides using in-memory SQLite (Node.js 22.13+). Run it with `npm test` from `worker/`. Browser fixtures use the main admin and can override `ADMIN_USERNAME`/`ADMIN_PASSWORD`; they must point at a disposable local Worker.

## Verification

```powershell
npm run lint
```

This performs JavaScript syntax checks; local development needs no bundler or build step. GitHub Pages uses the static export described above. Browser evidence is saved under `screenshots/` in this workspace. User-executable checks are in `UI-CHECKLIST.md`.
