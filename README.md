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

The site contains 29 captured routes, 188 seeded photographs, 60 Quests, and 708 local assets, including the original Poppins font files and release PDFs. Photography and photographer credits are retained. The shared navigation omits Membership.

## Files

- `index.html`: category selection landing page.
- `pages/`: captured static HTML/CSS documents, route manifest, and reusable login/details fragments.
- `assets/`: locally saved photography, fonts, and campaign artwork.
- `catalog.json`: hard-coded photo and Quest records.
- `app.js`, `styles.css`: browser-local interactions and responsive layout corrections.
- `server.mjs`: dependency-free local file server.
- `worker/`: Cloudflare Worker (R2 + D1) behind guest uploads, with its own `package.json` for `wrangler`.
- `tools/`: optional capture/preparation/browser-inspection utilities. These use an external Puppeteer installation supplied through `PUPPETEER_MODULE`; running the finished site does not require it.

## Demo behavior and limits

Log in / Sign up uses real accounts stored by the Worker (below): a username and a password of at least 6 characters, after checking the terms box. The session token is kept in browser storage; Log out ends it on the Worker too. Password recovery remains demo-only; the captured social and PULSEpx sign-in buttons are removed. Likes, follows, galleries, and comments live in browser storage. Contest submissions do not call a backend; Upload sends files to the guest-uploads Worker (below). Clear the `500px-local-demo` localStorage entry to reset onboarding and demo state.

The original layouts, typography, public copy, and available images were captured from the live site. Feed content is a finite local snapshot. Additional photo/Quest URLs reuse the captured detail layout with seeded titles and images; uncaptured profiles reuse the sample profile. Search uses seeded results, and some filter data is representative. Blog layouts now follow the working ISO Blog reference, with condensed local text as described below. These areas are not a verified pixel-for-pixel copy of all live states.

The leaderboard preserves the live photo strip, rank medals, row layout, descriptions, photographer credits, and engagement counts. Weekly and Monthly each contain their first 50 actual rankings captured on October 28, 2026; they switch independently and do not refresh from the live API. `tools/capture-leaderboard.mjs` owns these fixtures so the general capture/preparation scripts do not replace them with loading placeholders.

The Quests hub contains 60 actual contests captured on October 28, 2026, including 20 Licensing quests. Its static grid replaces the original virtual list. The two hero banners, original filter dialog, combined filters, empty state, four sort orders, mobile app banner, and query-string reloads work locally. Most Joined uses the captured 500px popularity ranking. Dates, countdown labels, rankings, and content remain a fixed snapshot. General capture skips this finished page. Focused browser checks are in `tools/quests-check.mjs`, with desktop/mobile images and results in `screenshots/quests-*`.

All 20 captured Licensing Quest URLs now use a dedicated Juried-style Licensing detail template, with their own title, hero and captured submission dates, an ended state, Introduction/All Entries tabs, sharing, cash-award content, and Licensing rules. The Battle and general Juried samples retain their existing templates. Indexed official pages for [After Hours](https://500px.com/quest/1000005269-after-hours) and [On the Clock](https://500px.com/quest/1000005271-on-the-clock) supplied the sample structure, counts, cash awards and thematic guidance; the browser reference remains inaccessible, so pixel-level parity is unverified. Briefs are condensed/paraphrased, the other contests use representative brief/award text, and entry photos are seeded content. `catalog.json` carries the Licensing route metadata; `tools/prepare.mjs` preserves it when preparing captures. Run `tools/quest-licensing-check.mjs` with the same external `PLAYWRIGHT_MODULE` used by the gallery check. Desktop/mobile evidence is saved as `screenshots/quest-licensing-*`.

App Store, Google Play, social links, support articles, and Getty Images links retain their external destinations. There is no live authentication, email delivery, payment, or licensing purchase integration. Guest uploads are the only publishing path.

Licensing includes the original model release, property release, and contributor agreement PDFs, served locally. All seven guides have working desktop navigation, mobile Table of Contents, section deep links, and a dismissible app banner. Get started and manager links use the existing local login/upload demo; customer support opens local guidance. All five Grant collections open local gallery detail pages. `tools/finish-licensing.mjs` refreshes this snapshot without recapturing unrelated pages. Desktop/mobile evidence and focused check results are under `screenshots/licensing-*`.

Standalone galleries use `/galleries/:id?owner=MarcoGrassi` (or `paweluchorczak`) for profile collections and `/gallery/:id` for Grants. The shared layout includes owner information, photo counts, sharing, a collection-specific slideshow, credited photography, and return links. Fixtures in `pages/galleries.json` reuse captured profile photos and Grant previews; they are representative collections, not complete live galleries. The original gallery reference could not be reached, so visual parity remains unverified. Manager/account screens remain outside scope.

Run `tools/gallery-check.mjs` with `PLAYWRIGHT_MODULE` pointing to an external `playwright-core/index.mjs` installation. It checks gallery routes and interactions at desktop/mobile widths and saves `screenshots/gallery-*` evidence. No browser dependency is required by the finished site.

Commercial Grants reuses all 28 saved photos, with scroll reveals, reduced-motion support, and project navigation below the full mobile header. Run `tools/grants-check.mjs` with the same external `PLAYWRIGHT_MODULE` to check five viewport widths, reveals, navigation, fragment reloads, and local image loading. Screenshots are saved under `screenshots/grants-*`.

The Blog at `/blog` follows the original [ISO listing](https://iso.500px.com/) and [Fog article](https://iso.500px.com/into-the-mist-creating-atmosphere-with-fog-photography/) inspected in desktop and mobile Chrome. It retains the normal black 500px site header above the light Blog content, matching the embedded Blog at `/blog`. The local Open Sans font, photographic feature, five Top Posts, eleven Latest Posts, category menus, footer, and sixteen local article routes remain below it. Articles reuse the inspected hero/reading-column/previous-next layout; the Fog article uses all five captured body photos. Excerpts and article copy are condensed/representative; other stories reuse the template with their own title and photography. Categories filter this finite snapshot and can be empty. Ads, full archives, live social widgets, and Blog search behavior are excluded. Oversized photos are resized locally without changing their proportions. The general capture/preparation scripts preserve the finished Blog.

Run `tools/blog-check.mjs` with the same external `PLAYWRIGHT_MODULE` to verify desktop/mobile routes, menus, sharing, article navigation, missing routes, and login-dialog reuse. It saves `screenshots/blog-results.json` and listing/article/category screenshots. Reference screenshots are saved under `.reference/blog-*`. Chrome DevTools MCP initially had an occupied profile; a subsequent retry independently verified the local listing and Fog article on desktop/mobile, including touch, navigation, sharing, menu/Escape, images, overflow, console messages, and network requests. Manager/account screens and Membership remain excluded.

## Guest uploads (Cloudflare)

Uploading needs an account; Upload opens Log in / Sign up first when you are signed out. Accounts are a username (1–30 characters, case-insensitive, unique) and a password of 6–200 characters, hashed with PBKDF2-SHA256 in the Worker; sessions last 30 days. Each **Choose files** pick adds to a preview list of photos and videos, where files can be removed before uploading. Upload creates a new album or adds to one of your own albums, and later batches in the same dialog go to the album it just created; uploads are credited to your username. Albums appear under **Galleries** on `/p/guest?user=<username>` (**My uploads** in the account menu), on `/p/guest` for everyone, and at `/galleries/guest?album=<id>`, with photos and playable videos in the lightbox. The Worker in `worker/` stores files in R2 and album/media rows in D1. The site stays static, and seeded content never depends on the Worker: if it is down, only the upload dialog and guest pages show an error.

Limits, enforced by the Worker:

- Photos (JPEG, PNG, WebP, GIF, AVIF) up to 20 MB. Videos (MP4, WebM, MOV) up to 95 MB, a **temporary** limit.
- File types are checked by their first bytes after upload, not only by the declared type.
- 50 uploads per visitor per hour (`UPLOADS_PER_HOUR`) and 5 GB total storage (`STORAGE_CAP_BYTES`), both Worker vars in `wrangler.toml`.
- Album title 1–60 characters, description ≤ 280, media title ≤ 100 (defaults to the file name).
- Creating albums and uploading need `Authorization: Bearer <token>` from `POST /api/signup` or `POST /api/login` (`{username, password}` → `{token, username}`); you can only upload into your own albums. `POST /api/logout` ends a session. Reading albums and media stays public; `?user=<username>` filters `GET /api/albums` and `GET /api/media`.
- There is no login throttling yet.
- CORS is limited to `ALLOWED_ORIGINS` (GitHub Pages plus localhost:5000).

Clicking Upload prepares the selected files in the browser before any media upload starts. JPEG and PNG photos are converted to WebP at 90% quality while keeping their dimensions, orientation, and transparency. The list shows “Converting…” during conversion, then updates the filename and size before uploading. Upload stays disabled throughout preparation and upload. If WebP is not smaller, or the browser cannot encode WebP, the original format is kept and the status says “Uploading original…”. GIF, AVIF, existing WebP, and videos pass through unchanged. The 20 MB photo limit applies to the selected file before conversion.

**Known limitation:** JPEG location data (EXIF/GPS) is stripped in the browser before upload; orientation is applied to converted pixels or retained in JPEGs. Video metadata, including GPS, is **not** stripped.

### Local development

The site uses the deployed Worker everywhere, including localhost, so local dev shows the same guest uploads as Pages. Uploads you make locally go to production. To use a local Worker instead, run `localStorage.uploadApi = 'http://127.0.0.1:8787'` in the browser console (`delete localStorage.uploadApi` to switch back); `tools/uploads-check.mjs` sets this itself. Create `worker/.dev.vars` (git-ignored) containing `ADMIN_TOKEN=dev-admin-token`, then run the Worker next to `npm start`:

```sh
cd worker && npm install && npm run migrate:local && npm run dev
```

### Checks

Both checks need a **fresh** local state, so point `--persist-to` at an empty temp directory. `WRANGLER_DISABLE_REQUEST_BODY_DRAINING=1` stops `wrangler dev` from holding the early 413 response until the body is drained. The exact commands are in each file's header.

- `tools/upload-api-check.mjs` checks the Worker API: accounts, sessions, album ownership, albums, uploads, type sniffing, Range requests, rate limit, storage cap, CORS, and admin deletes. Start `wrangler dev` with `--var UPLOADS_PER_HOUR:6 --var STORAGE_CAP_BYTES:60000`, then run it with `CHECK_UPLOADS_PER_HOUR=6 CHECK_STORAGE_CAP=60000`. `API_URL` (default `http://127.0.0.1:8787`) and `ADMIN_TOKEN` (default `dev-admin-token`) are optional.
- `tools/uploads-check.mjs` checks the browser flow: the upload dialog, EXIF stripping, the guest profile, albums, the lightbox, and the exported site. It needs `npm start` and `wrangler dev` with default vars, plus `PLAYWRIGHT_MODULE` pointing at an external `playwright-core/index.mjs`. `SITE_URL` and `API_URL` are optional.
- `tools/image-upload-check.mjs` checks WebP conversion, size savings, transparency, orientation, metadata removal, unsupported encoders, failed conversions, and unchanged media. It needs `npm start` and `PLAYWRIGHT_MODULE`, and intercepts API requests so nothing is uploaded to a Worker.
- `node tools/upload-api-check.mjs --smoke` is safe to run against production. It signs up a `smoke-<timestamp>` account, creates an album, uploads a PNG, lists albums, makes a Range request, then deletes the album. The smoke account stays behind, since there is no user delete endpoint. It requires `API_URL` and `ADMIN_TOKEN`.

### Deploy (one time)

From `worker/`, signed in to the Cloudflare account:

```sh
npx wrangler login
npx wrangler r2 bucket create 500px-guest-media
npx wrangler d1 create 500px-guest-uploads    # paste database_id into wrangler.toml
npm run migrate:remote
npx wrangler secret put ADMIN_TOKEN           # enter a long random value
npm run deploy                                # prints the *.workers.dev URL
```

Set that URL as the production `uploadApi` in `app.js`, then smoke-test:

```sh
API_URL=https://<worker>.workers.dev ADMIN_TOKEN=<token> node tools/upload-api-check.mjs --smoke
```

Later Worker changes only need `npm run deploy`. Schema changes also need `npm run migrate:remote`.

Migration `0002_users.sql` adds accounts and **drops all existing guest albums and media rows**. Their R2 objects stay in `500px-guest-media`; empty the bucket in the Cloudflare dashboard if you want the space back. Run `npm run migrate:remote` before deploying the account-aware Worker.

### Admin deletes

There is no moderation UI. Use the admin token to remove media or a whole album; R2 objects are deleted with their rows:

```sh
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>.workers.dev/api/media/<mediaId>
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>.workers.dev/api/albums/<albumId>
```

Both return `204`, `401` for a missing or wrong token, and `404` for an unknown id. Media ids appear in `GET /api/media` and album ids in `GET /api/albums`.

## Verification

```powershell
npm run lint
```

This performs JavaScript syntax checks; local development needs no bundler or build step. GitHub Pages uses the static export described above. Browser evidence is saved under `screenshots/` in this workspace. User-executable checks are in `UI-CHECKLIST.md`.
