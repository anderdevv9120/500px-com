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
- Local demo login, password visibility/recovery UI, upload preview, likes, saved galleries, follows, comments, sharing, and slideshow.

The site contains 29 captured routes, 188 seeded photographs, 60 Quests, and 708 local assets, including the original Poppins font files and release PDFs. Photography and photographer credits are retained. The shared navigation omits Membership.

## Files

- `index.html`: category selection landing page.
- `pages/`: captured static HTML/CSS documents, route manifest, and reusable login/details fragments.
- `assets/`: locally saved photography, fonts, and campaign artwork.
- `catalog.json`: hard-coded photo and Quest records.
- `app.js`, `styles.css`: browser-local interactions and responsive layout corrections.
- `server.mjs`: dependency-free local file server.
- `tools/`: optional capture/preparation/browser-inspection utilities. These use an external Puppeteer installation supplied through `PUPPETEER_MODULE`; running the finished site does not require it.

## Demo behavior and limits

Login accepts a sample username and a sample password of at least four characters after checking the terms box. It creates a local demo session. Passwords are neither saved nor sent. Likes, follows, galleries, and comments live in browser storage. Upload previews and contest submissions do not call a backend. Clear the `500px-local-demo` localStorage entry to reset onboarding and demo state.

The original layouts, typography, public copy, and available images were captured from the live site. Feed content is a finite local snapshot. Additional photo/Quest URLs reuse the captured detail layout with seeded titles and images; uncaptured profiles reuse the sample profile. Search uses seeded results, and some filter data is representative. Blog layouts now follow the working ISO Blog reference, with condensed local text as described below. These areas are not a verified pixel-for-pixel copy of all live states.

The leaderboard preserves the live photo strip, rank medals, row layout, descriptions, photographer credits, and engagement counts. Weekly and Monthly each contain their first 50 actual rankings captured on October 28, 2026; they switch independently and do not refresh from the live API. `tools/capture-leaderboard.mjs` owns these fixtures so the general capture/preparation scripts do not replace them with loading placeholders.

The Quests hub contains 60 actual contests captured on October 28, 2026, including 20 Licensing quests. Its static grid replaces the original virtual list. The two hero banners, original filter dialog, combined filters, empty state, four sort orders, mobile app banner, and query-string reloads work locally. Most Joined uses the captured 500px popularity ranking. Dates, countdown labels, rankings, and content remain a fixed snapshot. General capture skips this finished page. Focused browser checks are in `tools/quests-check.mjs`, with desktop/mobile images and results in `screenshots/quests-*`.

All 20 captured Licensing Quest URLs now use a dedicated Juried-style Licensing detail template, with their own title, hero and captured submission dates, an ended state, Introduction/All Entries tabs, sharing, cash-award content, and Licensing rules. The Battle and general Juried samples retain their existing templates. Indexed official pages for [After Hours](https://500px.com/quest/1000005269-after-hours) and [On the Clock](https://500px.com/quest/1000005271-on-the-clock) supplied the sample structure, counts, cash awards and thematic guidance; the browser reference remains inaccessible, so pixel-level parity is unverified. Briefs are condensed/paraphrased, the other contests use representative brief/award text, and entry photos are seeded content. `catalog.json` carries the Licensing route metadata; `tools/prepare.mjs` preserves it when preparing captures. Run `tools/quest-licensing-check.mjs` with the same external `PLAYWRIGHT_MODULE` used by the gallery check. Desktop/mobile evidence is saved as `screenshots/quest-licensing-*`.

App Store, Google Play, social links, support articles, and Getty Images links retain their external destinations. There is no live authentication, email delivery, payment, image publishing, or licensing purchase integration.

Licensing includes the original model release, property release, and contributor agreement PDFs, served locally. All seven guides have working desktop navigation, mobile Table of Contents, section deep links, and a dismissible app banner. Get started and manager links use the existing local login/upload demo; customer support opens local guidance. All five Grant collections open local gallery detail pages. `tools/finish-licensing.mjs` refreshes this snapshot without recapturing unrelated pages. Desktop/mobile evidence and focused check results are under `screenshots/licensing-*`.

Standalone galleries use `/galleries/:id?owner=MarcoGrassi` (or `paweluchorczak`) for profile collections and `/gallery/:id` for Grants. The shared layout includes owner information, photo counts, sharing, a collection-specific slideshow, credited photography, and return links. Fixtures in `pages/galleries.json` reuse captured profile photos and Grant previews; they are representative collections, not complete live galleries. The original gallery reference could not be reached, so visual parity remains unverified. Manager/account screens remain outside scope.

Run `tools/gallery-check.mjs` with `PLAYWRIGHT_MODULE` pointing to an external `playwright-core/index.mjs` installation. It checks gallery routes and interactions at desktop/mobile widths and saves `screenshots/gallery-*` evidence. No browser dependency is required by the finished site.

The Blog at `/blog` follows the original [ISO listing](https://iso.500px.com/) and [Fog article](https://iso.500px.com/into-the-mist-creating-atmosphere-with-fog-photography/) inspected in desktop and mobile Chrome. It includes the light theme, local Open Sans font, photographic feature, five Top Posts, eleven Latest Posts, category menus, footer, and sixteen local article routes. Articles reuse the inspected hero/reading-column/previous-next layout; the Fog article uses all five captured body photos. Excerpts and article copy are condensed/representative; other stories reuse the template with their own title and photography. Categories filter this finite snapshot and can be empty. Ads, full archives, live social widgets, and Blog search behavior are excluded. Oversized photos are resized locally without changing their proportions. The general capture/preparation scripts preserve the finished Blog.

Run `tools/blog-check.mjs` with the same external `PLAYWRIGHT_MODULE` to verify desktop/mobile routes, menus, sharing, article navigation, missing routes, and signup-dialog reuse. It saves `screenshots/blog-results.json` and listing/article/category screenshots. Reference screenshots are saved under `.reference/blog-*`. Chrome DevTools MCP initially had an occupied profile; a subsequent retry independently verified the local listing and Fog article on desktop/mobile, including touch, navigation, sharing, menu/Escape, images, overflow, console messages, and network requests. Manager/account screens and Membership remain excluded.

## Verification

```powershell
npm run lint
```

This performs JavaScript syntax checks; local development needs no bundler or build step. GitHub Pages uses the static export described above. Browser evidence is saved under `screenshots/` in this workspace. User-executable checks are in `UI-CHECKLIST.md`.
