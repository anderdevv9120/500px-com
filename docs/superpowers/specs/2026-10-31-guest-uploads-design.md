# Guest photo & video uploads to albums — design

Date: 2026-10-31

## Intent

The 500px recreation is a demo. Today its "Upload photos" dialog shows a preview and then says "Uploads are not sent in this local demo." The goal is a real upload flow from start to finish: any visitor, with no account, uploads photos and videos, either into a new album they create during the upload or into an existing album. What they upload appears on the public site for every visitor. This shows the product working for real. It is not meant to run a production community.

## Goals

- Guests can upload one or more images and/or videos in one go.
- At upload time a guest either creates a new album (title required) or picks an existing guest album.
- Uploaded albums and their media are public and appear in the existing galleries UI: the profile "Galleries" tab cards and the `/galleries/:id` detail page, with the same look, slideshow, share, and lightbox.
- Storage is on Cloudflare (decided by the user).
- The deployed GitHub Pages site and local `npm start` both work.

## Non-goals

- Accounts, login, ownership, or per-user permissions. The existing local demo login stays as it is, and uploading does not require it.
- Video transcoding, server-side thumbnails, or adaptive streaming. Videos play as uploaded.
- Editing/renaming albums or media after upload. Guest-facing delete.
- Likes, comments, or photo detail pages (`/photo/...`) for uploaded media. Lightbox only, the same way Grant galleries work today.
- Changing the seeded galleries in `pages/galleries.json`.

## Anti-goals (failure even if it "works")

- Breaking the existing static site or the GitHub Pages deploy, or making seeded pages depend on the Worker being up. If the API is down, seeded content still renders and only the upload and guest-album features show an error.
- A wide-open bucket that accepts any file type or size. Anyone who finds the URL can post.
- Adding a framework or build step to the front end. It is plain HTML/CSS/JS and stays that way.

## Constraints (from the codebase)

- The front end is plain JS in `app.js` (about 850 lines, single file). The pages are captured HTML in `pages/`. `server.mjs` is a static file server only, and `routes.mjs` maps URLs to pages.
- GitHub Pages export (`tools/export-pages.mjs`) pre-generates a directory index for each known route. `/galleries/<id>` exists only for ids known at export time, so a gallery created at runtime has no exported route. Uploaded albums therefore need a URL that already exists in the export (see "Routing" below).
- The export's `rebase()` rewrites string literals that start with `/` to add the base path. Absolute `https://` URLs are left alone, so the API base URL must be absolute.
- Existing gallery rendering: `renderGallery()` (`app.js:469`) reads `/pages/galleries.json` and handles two kinds of gallery: profile galleries (link to photo pages) and Grant galleries (open the lightbox). The profile Galleries tab (`app.js:~520`) hard-codes the owner per profile page. `lightbox()` (`app.js:289`) renders only `<img>`.
- Existing upload dialog: `upload()` (`app.js:331`). It currently returns `login()` first when there is no user; that gate goes away.
- Node 22 is used in CI. No dependencies are installed today. The only new dependency allowed is `wrangler` for the Worker, as a dev tool.

## How it's built (decided)

- **Cloudflare Worker**: one Worker is the whole backend. Its code and config live in this repo (e.g. `worker/`) and it is deployed with `wrangler`.
- **Cloudflare R2**: stores the uploaded media files.
- **Cloudflare D1**: stores album and media metadata (albums: id, title, description, created_at; media: id, album_id, R2 key, kind image|video, content type, size, title, author name, created_at).
- **Public visibility**: everything uploaded is visible to all visitors.
- **Any guest can add to any guest album**: there is no ownership.
- **Placement**: guest albums appear in the existing galleries UI, not on a new kind of page.

## My calls (Claude's, not confirmed by the user, open to change)

- **Where guest albums are listed**: a shared "Guest uploads" profile, reached at `/p/guest` through the existing profile template. Its Galleries tab lists all guest albums, newest first, as the same `local-collection-card`s. Reason: galleries in this site always belong to a profile, and there are no accounts to own them. The upload success message links straight to the album.
  - `/p/guest` currently falls back to `pages/profile.html`, which is Marco Grassi's captured profile. On `/p/guest`, `app.js` rewrites the header: the name becomes "Guest uploads", the avatar becomes a generic "500px"-style badge like the Grant galleries use, and the bio, follower counts and Follow button are hidden. The Works tab shows all guest media, newest first, and the Quests tab is hidden. The Galleries tab opens by default.
  - Discoverability: add a "Guest uploads" item to the header "More" menu (next to the existing "Upload" item), linking to `/p/guest`.
- **Empty albums**: an album with no media is never listed. The builder chooses whether to hide empty albums or to create an album only together with its first successful upload.
- **Location privacy**: before upload, the browser strips EXIF (APP1) segments from JPEGs so phone GPS data isn't published. Video metadata is not stripped, which is a known limitation.
- **Local development**: `npm start` stays unchanged for seeded content. Upload and guest-album features run against `wrangler dev` (local simulated R2/D1) on its default port. The check scripts target `wrangler dev`, never production. `wrangler` is a dev dependency of `worker/` only, so the root still needs no install.
- **Deploy**: the Worker is deployed by hand with `wrangler deploy` from `worker/`, on a `*.workers.dev` address. The Pages workflow is unchanged.
- **Type sniffing without CPU cost**: the request body streams straight into R2 with no JS byte processing. After the write, the Worker does a ranged read of the first ~16 bytes, checks the magic bytes, and deletes the object and rejects the upload if they don't match. This stays within the Workers Free CPU limit.
- **Routing for runtime albums**: album detail uses one exported route plus a query string, e.g. `/galleries/guest?album=<id>`. `renderGallery()` fetches that album from the Worker and renders it with the existing gallery markup in lightbox mode (as Grants do). Back link: "← Galleries by Guest uploads".
- **Upload dialog**: multi-file input accepting `image/*,video/*`. Album choice: "New album" (title required, ≤60 chars, optional description) or "Existing album" (a select filled from the Worker). Optional "Your name" field, default "Guest". The media title defaults to the filename without its extension. The current Category select is dropped, since nothing uses it. Show progress per file and a clear error per file. A partly successful batch keeps the files that succeeded and reports the ones that failed.
- **Limits** (enforced in the Worker, also checked client-side for fast feedback): images jpeg/png/webp/gif/avif ≤ 20 MB. Videos mp4/webm/quicktime ≤ 95 MB. The video cap is there because Workers reject request bodies over 100 MB on the Free/Pro plans, and staying under it lets uploads stream through the Worker without presigned URLs or an S3 signing library. This replaces the 200 MB figure mentioned in chat. **The upload dialog shows the limits and labels the video cap as temporary**, e.g. "Videos up to 95 MB (temporary limit)" (user decision). Validate the type by sniffing magic bytes as well as the declared type. Album title ≤ 60 chars, description ≤ 280, name ≤ 40. All user text is escaped on render (`escapeHTML` already exists).
- **Moderation**: the Worker has DELETE endpoints for an album and for a media item, protected by an `ADMIN_TOKEN` Worker secret (`Authorization: Bearer`). They are documented in the README as `curl` commands. There is no admin UI.
- **Serving media**: the Worker serves files from R2 with `Range` support (needed for video seeking) and long cache headers. An r2.dev public bucket URL is acceptable if the builder prefers it.
- **CORS**: the Worker allows the GitHub Pages origin and `http://localhost:5000` (configurable via a Worker var).
- **Video display**: grid cells show `<video preload="metadata" muted playsinline>` (the first frame acts as the poster) with a small play badge. The lightbox shows `<video controls>` for video items and `<img>` for images. Slideshow skips the auto-advance timer while a video is playing, or simply keeps the 5 s timer; the builder decides.
- **API base URL**: a single constant in `app.js`, with a different value for local and deployed, decided by hostname or overridable by a query param or the export step. It must be an absolute URL so `rebase()` leaves it alone.

## Abuse and cost limits (decided)

- **Total storage cap: 5 GB.** Before each write, the Worker sums the stored media sizes in D1. If the upload would go past 5 GB, it is rejected with a clear "demo storage is full" message.
- **Rate limit: 50 uploads per visitor per hour,** keyed by client IP (`CF-Connecting-IP`, stored hashed in D1). Going over gets a 429 with a friendly message.
- No CAPTCHA/Turnstile. No automatic retention or purge. Unwanted content is removed reactively with the admin delete endpoints.
- Both limits are Worker vars, so they can be changed without code edits.

## Cloudflare account (decided)

- The user's existing Cloudflare account, on the **Free plan**. Everything has to fit Free-plan limits: 100 MB request body, 10 ms CPU per request, and the free D1/R2 quotas.

## Left to the builder

- Worker routing/handler structure, D1 schema DDL and migration file, R2 key naming (e.g. `<album-id>/<media-id>.<ext>`), and the id format.
- Exact API shape. The minimum needed: list albums (with cover and count), get one album with its media, create album, upload media to an album, serve media, and the two admin deletes.
- Whether upload is one request per file (recommended: simpler progress and partial-failure handling) or a multipart batch.
- How `/p/guest` and `/galleries/guest` are added to `routes.mjs`/the export so both `npm start` and GitHub Pages serve them.
- Styling details within the existing gallery and dialog CSS.
- Verification: follow the repo's existing `tools/*-check.mjs` pattern for a check covering upload → album listing → gallery render, plus a small Worker check for type/size rejection.
