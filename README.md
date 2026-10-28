# 500px — static recreation

Plain HTML, CSS, and JavaScript recreation of the public 500px.com site inspected on October 28, 2026. Membership is excluded from the pages and navigation.

## Run

Requires Node.js 18 or newer. No dependency installation or build is needed.

```powershell
npm start
```

Open **http://localhost:5000**. Set `PORT` to use another port. The Node server only serves static files and maps the original-style URLs to HTML documents. It has no application API.

## Included

- Category onboarding and For You, Fresh Picks, and Editors' Choice feeds.
- Photo detail pages, photographer profiles, galleries, weekly/monthly leaderboard, and search.
- Quests hub, filters, contest detail pages, entries, and local submission flow.
- Licensing landing page and all seven guides: licensing, contributing, requirements, releases, keywording, content types, and distribution.
- Commercial Grants, with all five original project mosaics, photographer credits, and section navigation; original full collections open on 500px.
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

The original layouts, typography, public copy, and available images were captured from the live site. Feed content is a finite local snapshot. Additional photo/Quest URLs reuse the captured detail layout with seeded titles and images; uncaptured profiles reuse the sample profile. Search uses seeded results, and some filter data is representative. The live Blog route returned an empty body, so Blog articles are illustrative local content. These areas are not a verified pixel-for-pixel copy of all live states.

The leaderboard preserves the live photo strip, rank medals, row layout, descriptions, photographer credits, and engagement counts. Weekly and Monthly each contain their first 50 actual rankings captured on October 28, 2026; they switch independently and do not refresh from the live API. `tools/capture-leaderboard.mjs` owns these fixtures so the general capture/preparation scripts do not replace them with loading placeholders.

The Quests hub contains 60 actual contests captured on October 28, 2026, including 20 Licensing quests. Its static grid replaces the original virtual list. The two hero banners, original filter dialog, combined filters, empty state, four sort orders, mobile app banner, and query-string reloads work locally. Most Joined uses the captured 500px popularity ranking. Dates, countdown labels, rankings, and content remain a fixed snapshot. General capture skips this finished page. Focused browser checks are in `tools/quests-check.mjs`, with desktop/mobile images and results in `screenshots/quests-*`.

App Store, Google Play, social links, support articles, and Getty Images links retain their external destinations. There is no live authentication, email delivery, payment, image publishing, or licensing purchase integration.

Licensing includes the original model release, property release, and contributor agreement PDFs, served locally. All seven guides have working desktop navigation, mobile Table of Contents, section deep links, and a dismissible app banner. Get started and manager links use the existing local login/upload demo; customer support opens local guidance. The five full Grant galleries remain external. `tools/finish-licensing.mjs` refreshes this snapshot without recapturing unrelated pages. Desktop/mobile evidence and focused check results are under `screenshots/licensing-*`.

## Verification

```powershell
npm run lint
```

This performs JavaScript syntax checks; the project has no bundler or build step. Browser evidence is saved under `screenshots/` in this workspace. User-executable checks are in `UI-CHECKLIST.md`.
